/**
 * The Adaptive Strategy Engine — Milestone 8.
 *
 *   SCIENCE ENGINE    — "What did the evidence show?"
 *   ADAPTIVE STRATEGY — "What should this profile do next?"   ← this module
 *   CREATOROS         — "Execute the approved action."
 *
 * Depends only on the `IntelligenceStore` PORT and the `ScienceEngine`
 * service — never on the JSONL adapter, and never re-deriving evidence the
 * Science Engine already owns. Baselines, effect sizes, confidence,
 * hypothesis evaluation, finding emission and decay assessment are all
 * READ from the Science Engine, never recalculated here.
 *
 * Everything this engine produces is a PROPOSAL. Recommendations are always
 * created `proposed`; nothing is auto-approved, nothing is published, and
 * no content is written — the engine decides what KIND of test or pattern
 * to pursue ("test a quantified-outcome hook"), never the final copy.
 *
 * No LLM is involved anywhere in this path.
 */
import { randomUUID } from 'node:crypto';
import type { GrowthObjective, IsoDateTime } from '../common/types.js';
import type { Finding } from '../science/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import type { AnalysisLimitation } from '../science/analysisTypes.js';
import { ScienceEngine } from '../science/engine.js';
import {
  DEFAULT_STRATEGY_POLICY,
  type AdaptiveStrategyPlan,
  type ExperimentAllocation,
  type NextBestAction,
  type PillarAllocation,
  type RecommendationBasis,
  type RecommendationStatus,
  type StrategyConstraint,
  type StrategyPolicy,
  type StrategyRecommendation,
  type StrategyUnknown,
} from './types.js';
import {
  computeInformationGain,
  computePriorityScore,
  deriveConstraints,
  exceedsCapacity,
  isTopicForbidden,
  postingCapacityCeiling,
  recommendContentAllocation,
  violatesActiveExperiment,
} from './policy.js';

export interface AdaptiveStrategyEngineOptions {
  readonly policy?: Partial<StrategyPolicy>;
  /** Injected for deterministic tests; defaults to the system clock. */
  readonly now?: () => IsoDateTime;
  /** Supply a configured Science Engine; one is constructed over the same store otherwise. */
  readonly scienceEngine?: ScienceEngine;
}

const EMPTY_BASIS: RecommendationBasis = {
  findingIds: [],
  segmentFindingIds: [],
  hypothesisIds: [],
  experimentIds: [],
  strategyPrincipleIds: [],
  strategyClaimIds: [],
  audienceSegmentIds: [],
  constraintIds: [],
  rationale: '',
};

export class AdaptiveStrategyEngine {
  private readonly policy: StrategyPolicy;
  private readonly now: () => IsoDateTime;
  private readonly science: ScienceEngine;

  constructor(
    private readonly store: IntelligenceStore,
    options: AdaptiveStrategyEngineOptions = {},
  ) {
    this.policy = { ...DEFAULT_STRATEGY_POLICY, ...options.policy };
    this.now = options.now ?? (() => new Date().toISOString());
    this.science = options.scienceEngine ?? new ScienceEngine(store, { now: this.now });
  }

  getPolicy(): StrategyPolicy {
    return this.policy;
  }

  /** Every constraint currently binding this profile. */
  async evaluateStrategyConstraints(profileId: string): Promise<StrategyConstraint[]> {
    const profile = await this.store.getProfile(profileId);
    if (!profile) return [];
    const experiments = await this.store.listExperiments({ profileId });
    // An experiment that has been published but carries no results yet is
    // treated as in flight, and its variables are protected.
    const active = experiments.filter((e) => e.execution.publishedAt !== undefined && e.results === undefined);
    return deriveConstraints(profile, active);
  }

  /**
   * Exploration/exploitation split for this profile, from its declared
   * `experimentMode`. Configurable via `StrategyPolicy.explorationRatio` —
   * never a hard-coded scientific claim about how much testing is correct.
   */
  buildExperimentAllocation(experimentMode: ExperimentModeLike): ExperimentAllocation {
    const explorationShare = this.policy.explorationRatio[experimentMode];
    return {
      experimentMode,
      explorationShare,
      exploitationShare: 1 - explorationShare,
      reason: `Experiment mode "${experimentMode}" allocates ${Math.round(explorationShare * 100)}% of capacity to exploration under policy ${this.policy.policyVersion}.`,
    };
  }

  /**
   * How many times a pattern (identified by a finding's statement) has been
   * rejected for this profile. Failure is memory, not noise: a repeatedly
   * rejected approach should not keep resurfacing as a fresh idea.
   */
  async countPatternFailures(profileId: string, statement: string): Promise<number> {
    const findings = await this.store.listFindings({ profileId, status: 'rejected' });
    return findings.filter((f) => f.statement === statement).length;
  }

  /**
   * Recommendations derived from findings that are stale or decaying.
   * Reuses the Science Engine's own revalidation logic rather than
   * re-implementing decay assessment.
   */
  async recommendRevalidations(profileId: string, objective: GrowthObjective): Promise<StrategyRecommendation[]> {
    const candidates = await this.science.identifyRevalidationCandidates(profileId, this.now());
    const recommendations: StrategyRecommendation[] = [];

    for (const candidate of candidates) {
      const isFinding = candidate.subjectType === 'finding';
      recommendations.push(
        this.buildRecommendation({
          profileId,
          objective,
          recommendationType: 'revalidation',
          action: 'revalidate_finding',
          reason: isFinding
            ? `Re-test this finding before relying on it again: ${candidate.reason}`
            : `Gather more evidence to resolve this inconclusive hypothesis: ${candidate.reason}`,
          confidence: 0.5,
          priorityScore: computePriorityScore({
            objectiveRelevant: true,
            confidence: 0.5,
            informationGain: candidate.freshness === 'decaying' ? 0.8 : 0.6,
          }),
          basis: {
            ...EMPTY_BASIS,
            findingIds: isFinding ? [candidate.subjectId] : [],
            hypothesisIds: isFinding ? [] : [candidate.subjectId],
            rationale: candidate.reason,
          },
          limitations: candidate.freshness === 'decaying' ? ['small_sample'] : [],
        }),
      );
    }
    return recommendations;
  }

  /**
   * Recommendations derived from the profile's own findings.
   *
   * Objective-first: a finding whose objective doesn't match the profile's
   * is heavily deprioritized rather than treated as a win. A pattern that
   * produces replies is valuable for a `conversation` profile and largely
   * beside the point for a `traffic` one.
   */
  async recommendFromFindings(
    profileId: string,
    objective: GrowthObjective,
    constraints: readonly StrategyConstraint[],
  ): Promise<StrategyRecommendation[]> {
    const findings = await this.store.listFindings({ profileId });
    const recommendations: StrategyRecommendation[] = [];

    for (const finding of findings) {
      const objectiveRelevant = finding.objective === undefined || finding.objective === objective;
      const failures = await this.countPatternFailures(profileId, finding.statement);
      const failurePenalty = failures >= this.policy.failureMemoryThreshold ? 0.5 : 0;

      const gain = computeInformationGain({
        subjectType: 'finding',
        subjectId: finding.id,
        confidence: finding.confidence,
        dependentMetric: finding.effectSize?.metric,
        objective,
      });

      const { action, type, reason, status } = this.classifyFinding(finding, objectiveRelevant, failures);
      if (status === 'skip') continue;

      recommendations.push(
        this.buildRecommendation({
          profileId,
          objective,
          recommendationType: type,
          action,
          reason,
          confidence: finding.confidence,
          audienceSegmentId: finding.audienceSegmentId,
          priorityScore: computePriorityScore({
            objectiveRelevant,
            confidence: finding.confidence,
            informationGain: gain.score,
            stalenessPenalty: this.science.assessFindingFreshness(finding, this.now()) === 'current' ? 0 : 0.15,
            failurePenalty,
          }),
          basis: {
            ...EMPTY_BASIS,
            findingIds: [finding.id],
            experimentIds: finding.sourceExperimentIds,
            audienceSegmentIds: finding.audienceSegmentId ? [finding.audienceSegmentId] : [],
            constraintIds: constraints.map((c) => c.id),
            rationale: objectiveRelevant
              ? `Finding is scoped to this profile and bears on its ${objective} objective.`
              : `Finding targets ${finding.objective}, not this profile's ${objective} objective, so it is deprioritized.`,
          },
          limitations: finding.sampleSize < this.policy.thinEvidenceSampleThreshold ? ['small_sample'] : [],
        }),
      );
    }
    return recommendations;
  }

  /** Maps a finding's standing onto the action it justifies. */
  private classifyFinding(
    finding: Finding,
    objectiveRelevant: boolean,
    failures: number,
  ): { action: NextBestAction; type: StrategyRecommendation['recommendationType']; reason: string; status: 'keep' | 'skip' } {
    if (failures >= this.policy.failureMemoryThreshold) {
      return {
        action: 'deprioritize_pattern',
        type: 'content',
        reason: `This approach has been rejected ${failures} times for this profile; deprioritize it unless conditions have changed.`,
        status: 'keep',
      };
    }
    switch (finding.status) {
      case 'validated':
        return finding.confidence >= this.policy.minimumConfidenceToExploit
          ? {
              action: 'repeat_validated_pattern',
              type: 'content',
              reason: `Validated for this profile at confidence ${finding.confidence.toFixed(2)} — reuse this pattern while it holds.`,
              status: 'keep',
            }
          : {
              action: 'collect_more_evidence',
              type: 'wait_for_evidence',
              reason: `Marked validated but confidence (${finding.confidence.toFixed(2)}) is below the exploitation threshold; gather more evidence first.`,
              status: 'keep',
            };
      case 'promising':
        return {
          action: 'run_experiment',
          type: 'experiment',
          reason: 'Promising but not yet validated for this profile — run a further test before relying on it.',
          status: 'keep',
        };
      case 'rejected':
        return {
          action: 'deprioritize_pattern',
          type: 'content',
          reason: 'Rejected for this profile; do not reintroduce it without a deliberate revalidation.',
          status: 'keep',
        };
      case 'decaying':
        return {
          action: 'revalidate_finding',
          type: 'revalidation',
          reason: 'This finding is decaying; re-test before continuing to rely on it.',
          status: 'keep',
        };
      default:
        return { action: 'do_nothing_yet', type: 'other', reason: '', status: objectiveRelevant ? 'keep' : 'skip' };
    }
  }

  /**
   * Candidate experiments seeded by outside knowledge (`StrategyPrinciple`,
   * Milestone 5). A playbook claim NEVER becomes a validated action: it can
   * only ever produce `run_experiment`, and only when this profile has no
   * first-party evidence of its own on the subject. First-party evidence
   * always outranks imported advice.
   */
  async recommendExperiments(
    profileId: string,
    objective: GrowthObjective,
    constraints: readonly StrategyConstraint[],
  ): Promise<StrategyRecommendation[]> {
    const principles = await this.store.listStrategyPrinciples({ status: 'hypothesis' });
    const ownFindings = await this.store.listFindings({ profileId });
    const recommendations: StrategyRecommendation[] = [];

    for (const principle of principles) {
      // Outside advice is only worth testing if this profile hasn't already
      // answered the question with its own evidence.
      const alreadyAnswered = ownFindings.some((f) => f.statement === principle.name);
      if (alreadyAnswered) continue;
      if (isTopicForbidden(principle.name, constraints)) continue;
      if (violatesActiveExperiment(principle.applicableObjectives.map(String), constraints)) continue;

      const objectiveRelevant =
        principle.applicableObjectives.length === 0 || principle.applicableObjectives.includes(objective);

      const gain = computeInformationGain({
        subjectType: 'principle',
        subjectId: principle.id,
        confidence: principle.confidence,
        objective,
      });

      recommendations.push(
        this.buildRecommendation({
          profileId,
          objective,
          recommendationType: 'experiment',
          action: 'run_experiment',
          reason: `Untested here: "${principle.name}". Treat as a candidate experiment, not established practice.`,
          confidence: principle.confidence,
          priorityScore: computePriorityScore({
            objectiveRelevant,
            confidence: principle.confidence,
            informationGain: gain.score,
          }),
          basis: {
            ...EMPTY_BASIS,
            strategyPrincipleIds: [principle.id],
            strategyClaimIds: principle.supportingClaimIds ?? [],
            constraintIds: constraints.map((c) => c.id),
            rationale: `Seeded from a ${principle.sourceType} principle with no first-party evidence for this profile yet.`,
          },
          limitations: ['small_sample'],
        }),
      );
    }
    return recommendations;
  }

  /**
   * Recommendations from observed audience segments. Only acts where
   * segment evidence actually exists — a profile with no observed segments
   * gets a `collect_more_evidence` suggestion, never a fabricated segment.
   * Declared audience (`SocialProfile.audience`) is read-only here.
   */
  async recommendAudienceActions(
    profileId: string,
    objective: GrowthObjective,
  ): Promise<StrategyRecommendation[]> {
    const segments = await this.store.listObservedSegments({ profileId });
    const segmentFindings = await this.store.listSegmentFindings({ profileId });
    const recommendations: StrategyRecommendation[] = [];

    if (segments.length === 0) {
      return [
        this.buildRecommendation({
          profileId,
          objective,
          recommendationType: 'audience',
          action: 'collect_more_evidence',
          reason: 'No observed audience segments yet — collect audience signals before targeting any segment.',
          confidence: 0,
          priorityScore: computePriorityScore({ objectiveRelevant: true, confidence: 0, informationGain: 0.7 }),
          basis: { ...EMPTY_BASIS, rationale: 'No ObservedAudienceSegment records exist for this profile.' },
          limitations: ['small_sample', 'unknown_attribution'],
        }),
      ];
    }

    for (const finding of segmentFindings) {
      if (finding.status !== 'supported') continue;
      recommendations.push(
        this.buildRecommendation({
          profileId,
          objective,
          recommendationType: 'audience',
          action: 'target_segment',
          reason: `Segment-specific evidence supports targeting this segment: ${finding.statement}`,
          confidence: finding.confidence,
          audienceSegmentId: finding.segmentId,
          priorityScore: computePriorityScore({
            objectiveRelevant: true,
            confidence: finding.confidence,
            informationGain: 0.4,
          }),
          basis: {
            ...EMPTY_BASIS,
            segmentFindingIds: [finding.id],
            audienceSegmentIds: [finding.segmentId],
            experimentIds: finding.supportingExperimentIds,
            rationale: 'Derived from a supported SegmentFinding; scope stays profile + segment.',
          },
          limitations: [],
        }),
      );
    }
    return recommendations;
  }

  /** Deterministic ranking: highest priority first, ties broken by id so output is stable. */
  rankNextActions(recommendations: readonly StrategyRecommendation[]): StrategyRecommendation[] {
    return [...recommendations].sort((a, b) =>
      b.priorityScore !== a.priorityScore ? b.priorityScore - a.priorityScore : a.id.localeCompare(b.id),
    );
  }

  /** A machine-readable explanation of one recommendation, assembled from its stored basis. */
  explainRecommendation(recommendation: StrategyRecommendation): {
    action: NextBestAction;
    objective: GrowthObjective;
    confidence: number;
    rationale: string;
    evidence: RecommendationBasis;
    limitations: readonly AnalysisLimitation[];
  } {
    return {
      action: recommendation.action,
      objective: recommendation.objective,
      confidence: recommendation.confidence,
      rationale: recommendation.basis.rationale,
      evidence: recommendation.basis,
      limitations: recommendation.limitations,
    };
  }

  /**
   * Builds the current strategy snapshot for one profile and persists it.
   *
   * A profile with no evidence at all gets an honest plan: unknowns,
   * limitations, and `collect_more_evidence`/`run_experiment` actions —
   * never a fabricated set of "what works."
   *
   * `supersedesPlanId` links to the previous plan, which is retained: a new
   * plan never erases the reasoning behind the old one.
   */
  async buildAdaptiveStrategyPlan(profileId: string): Promise<AdaptiveStrategyPlan | null> {
    const profile = await this.store.getProfile(profileId);
    if (!profile) return null;

    const objective = profile.objectives.primary;
    const constraints = await this.evaluateStrategyConstraints(profileId);
    const now = this.now();

    const [fromFindings, fromRevalidation, fromPrinciples, fromAudience] = await Promise.all([
      this.recommendFromFindings(profileId, objective, constraints),
      this.recommendRevalidations(profileId, objective),
      this.recommendExperiments(profileId, objective, constraints),
      this.recommendAudienceActions(profileId, objective),
    ]);

    let recommendations = this.rankNextActions([
      ...fromFindings,
      ...fromRevalidation,
      ...fromPrinciples,
      ...fromAudience,
    ]);

    const limitations: AnalysisLimitation[] = [];
    const unknowns: StrategyUnknown[] = [];

    if (recommendations.length === 0) {
      // Nothing to act on is a legitimate answer, stated explicitly.
      recommendations = [
        this.buildRecommendation({
          profileId,
          objective,
          recommendationType: 'wait_for_evidence',
          action: 'do_nothing_yet',
          reason: 'No evidence yet supports changing strategy for this profile. Publish, measure, and revisit.',
          confidence: 0,
          priorityScore: 0,
          basis: { ...EMPTY_BASIS, rationale: 'No findings, principles, segments or revalidation candidates apply.' },
          limitations: ['small_sample'],
        }),
      ];
      limitations.push('small_sample');
      unknowns.push({
        topic: `What drives ${objective} for this profile`,
        reason: 'No profile-specific evidence has accumulated yet.',
        suggestedAction: 'run_experiment',
      });
    }

    const validated = (await this.store.listFindings({ profileId, status: 'validated' })).length;
    if (validated === 0) {
      unknowns.push({
        topic: 'Validated patterns',
        reason: 'This profile has no validated findings yet, so no pattern can be exploited with confidence.',
        suggestedAction: 'collect_more_evidence',
      });
    }

    const observedSegments = await this.store.listObservedSegments({ profileId });
    if (observedSegments.length === 0) {
      unknowns.push({
        topic: 'Who actually responds',
        reason: 'No observed audience segments exist; only the owner-declared audience is known.',
        suggestedAction: 'collect_more_evidence',
      });
      limitations.push('unknown_attribution');
    }

    const contentAllocation: PillarAllocation[] = recommendContentAllocation({
      currentAllocations: profile.strategy.currentAllocations,
      evidenceByPillar: {},
      policy: this.policy,
    });

    const previous = await this.getLatestPlan(profileId);
    const plan: AdaptiveStrategyPlan = {
      id: `plan_${randomUUID()}`,
      profileId,
      objective,
      recommendations,
      contentAllocation,
      experimentAllocation: this.buildExperimentAllocation(profile.strategy.experimentMode),
      revalidationItems: (await this.science.identifyRevalidationCandidates(profileId, now)).map((c) => c.subjectId),
      unknowns,
      limitations,
      constraints,
      ...(previous ? { supersedesPlanId: previous.id } : {}),
      version: (previous?.version ?? 0) + 1,
      createdAt: now,
      policyVersion: this.policy.policyVersion,
      schemaVersion: 1,
    };

    for (const recommendation of recommendations) {
      await this.store.saveStrategyRecommendation(recommendation);
    }
    await this.store.saveAdaptiveStrategyPlan(plan);
    return plan;
  }

  /** The most recent plan for a profile, or `null`. Earlier plans are retained. */
  async getLatestPlan(profileId: string): Promise<AdaptiveStrategyPlan | null> {
    const plans = await this.store.listAdaptiveStrategyPlans({ profileId });
    if (plans.length === 0) return null;
    return plans.reduce((latest, plan) => (plan.version > latest.version ? plan : latest));
  }

  /**
   * Moves a recommendation through its lifecycle. This is the human-approval
   * seam: the engine only ever creates `proposed`; a person (or a future
   * approval surface) advances it, and only then does CreatorOS execute.
   */
  async setRecommendationStatus(
    recommendationId: string,
    status: RecommendationStatus,
  ): Promise<StrategyRecommendation | null> {
    const existing = await this.store.getStrategyRecommendation(recommendationId);
    if (!existing) return null;
    const updated: StrategyRecommendation = { ...existing, status };
    await this.store.saveStrategyRecommendation(updated);
    return updated;
  }

  private buildRecommendation(input: {
    profileId: string;
    objective: GrowthObjective;
    recommendationType: StrategyRecommendation['recommendationType'];
    action: NextBestAction;
    reason: string;
    confidence: number;
    priorityScore: number;
    basis: RecommendationBasis;
    limitations: readonly AnalysisLimitation[];
    audienceSegmentId?: string;
  }): StrategyRecommendation {
    const createdAt = this.now();
    const expiry = new Date(Date.parse(createdAt) + this.policy.recommendationTtlDays * 86_400_000);
    return {
      id: `rec_${randomUUID()}`,
      profileId: input.profileId,
      objective: input.objective,
      recommendationType: input.recommendationType,
      action: input.action,
      // Always proposed. The engine never approves or executes its own advice.
      status: 'proposed',
      priorityScore: input.priorityScore,
      reason: input.reason,
      basis: input.basis,
      confidence: input.confidence,
      limitations: input.limitations,
      audienceSegmentId: input.audienceSegmentId,
      createdAt,
      expiresAt: expiry.toISOString(),
      policyVersion: this.policy.policyVersion,
      schemaVersion: 1,
    };
  }
}

/** Local alias so the allocation helper doesn't force a profiles import into every caller. */
type ExperimentModeLike = 'conservative' | 'balanced' | 'discovery';

export { computeInformationGain, deriveConstraints, exceedsCapacity, postingCapacityCeiling, recommendContentAllocation };
