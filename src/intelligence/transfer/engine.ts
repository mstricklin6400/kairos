/**
 * The Intelligence Transfer Engine — Milestone 10.
 *
 * Decides how relevant evidence from elsewhere is to a given profile, and
 * what — if anything — Kairos should do with it.
 *
 * **TRANSFER IS NOT TRUTH.** This engine never writes a `Finding`. The
 * strongest action it can produce is `run_experiment` on the receiving
 * profile, which the Science Engine then evaluates on that profile's own
 * evidence. Everything it emits is an assessment or a recommendation.
 *
 * Depends only on the `IntelligenceStore` port.
 */
import { randomUUID } from 'node:crypto';
import { daysBetween } from '../science/statistics.js';
import type { IsoDateTime } from '../common/types.js';
import type { AnalysisLimitation, Finding } from '../science/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import { computeSimilarity } from './similarity.js';
import {
  DEFAULT_TRANSFER_POLICY,
  type EvidenceSourceClass,
  type NegativeTransferRisk,
  type PeerCohort,
  type SimilarityProfile,
  type TransferAssessment,
  type TransferCandidate,
  type TransferContext,
  type TransferPolicy,
  type TransferRecommendation,
  type TransferRelevance,
} from './types.js';

export interface TransferEngineOptions {
  readonly policy?: Partial<TransferPolicy>;
  readonly now?: () => IsoDateTime;
}

/** Relevance ordered weakest → strongest, for ceiling comparisons. */
const RELEVANCE_ORDER: readonly TransferRelevance[] = [
  'contraindicated',
  'irrelevant',
  'insufficiently_comparable',
  'hypothesis_only',
  'weakly_relevant',
  'moderately_relevant',
  'strongly_relevant',
  'directly_applicable',
];

function capRelevance(value: TransferRelevance, ceiling: TransferRelevance): TransferRelevance {
  return RELEVANCE_ORDER.indexOf(value) > RELEVANCE_ORDER.indexOf(ceiling) ? ceiling : value;
}

export class IntelligenceTransferEngine {
  private readonly policy: TransferPolicy;
  private readonly now: () => IsoDateTime;

  constructor(
    private readonly store: IntelligenceStore,
    options: TransferEngineOptions = {},
  ) {
    this.policy = {
      ...DEFAULT_TRANSFER_POLICY,
      ...options.policy,
      dimensionWeights: {
        ...DEFAULT_TRANSFER_POLICY.dimensionWeights,
        ...(options.policy?.dimensionWeights ?? {}),
      },
    };
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getPolicy(): TransferPolicy {
    return this.policy;
  }

  /**
   * Assembles the receiving profile's context from stored records.
   * `accountStage` has no home on `SocialProfile`, so it is supplied by the
   * caller rather than inferred; follower count comes from the latest
   * profile measurement snapshot when one exists.
   */
  async buildTransferContext(
    profileId: string,
    overrides: Partial<TransferContext> = {},
  ): Promise<TransferContext | null> {
    const profile = await this.store.getProfile(profileId);
    if (!profile) return null;

    const snapshots = await this.store.listProfileMeasurementSnapshots({ profileId });
    const latestFollowerCount = [...snapshots]
      .reverse()
      .find((s) => s.followersCount !== undefined)?.followersCount;
    const segments = await this.store.listObservedSegments({ profileId });
    const findings = await this.store.listFindings({ profileId });

    return {
      profileId,
      platform: profile.platform,
      niche: profile.market.niche,
      subNiche: profile.market.subNiche,
      declaredAudience: profile.audience.primaryAudience,
      observedSegmentIds: segments.map((s) => s.id),
      objective: profile.objectives.primary,
      followerCount: latestFollowerCount,
      offerTypes: profile.monetization.offers
        .filter((o) => o.active)
        .map((o) => o.type)
        .filter((t): t is NonNullable<typeof t> => t !== undefined),
      postsPerDay: profile.strategy.postingFrequency.postsPerDay,
      postsPerWeek: profile.strategy.postingFrequency.postsPerWeek,
      positioning: profile.identity.positioning,
      geographicFocus: profile.market.geographicFocus,
      // Formats this profile's own evidence concerns — derived from its
      // findings rather than assumed from the platform.
      typicalContentFormats: [
        ...new Set(
          findings
            .map((f) => f.contentFormat)
            .filter((format): format is NonNullable<typeof format> => format !== undefined),
        ),
      ],
      hasFirstPartyEvidence: findings.length > 0,
      ...overrides,
    };
  }

  /** Builds a transfer candidate from a stored `Finding`, preserving its provenance. */
  candidateFromFinding(
    finding: Finding,
    input: {
      readonly sourceClass: EvidenceSourceClass;
      readonly sourceObserved?: boolean;
      readonly sourceAudienceDescription?: string;
      readonly sourceOfferTypes?: TransferCandidate['sourceOfferTypes'];
      readonly sourceFollowerCount?: number;
      readonly sourcePositioning?: string;
      readonly sourceGeographicFocus?: readonly string[];
      readonly battleProvenance?: TransferCandidate['battleProvenance'];
    },
  ): TransferCandidate {
    return {
      id: `cand_${randomUUID()}`,
      findingId: finding.id,
      statement: finding.statement,
      sourceClass: input.sourceClass,
      sourceProfileId: finding.profileId,
      sourcePlatform: finding.platform,
      sourceNiche: finding.niche,
      sourceSubNiche: finding.subNiche,
      sourceObjective: finding.objective,
      sourceAccountStage: finding.accountStage,
      sourceAudienceDescription: input.sourceAudienceDescription,
      sourceObserved: input.sourceObserved ?? false,
      sourceOfferTypes: input.sourceOfferTypes ?? [],
      sourceFollowerCount: input.sourceFollowerCount,
      sourcePositioning: input.sourcePositioning,
      sourceGeographicFocus: input.sourceGeographicFocus,
      // Content DNA now travels on the finding itself.
      sourceContentFormat: finding.contentFormat,
      sourceHookFamily: finding.hookFamily,
      confidence: finding.confidence,
      sampleSize: finding.sampleSize,
      lastValidatedAt: finding.lastValidatedAt,
      observationWindowEnd: finding.observationWindow?.to,
      // Caveats travel with the evidence — see Finding.limitations.
      limitations: finding.limitations ?? [],
      battleProvenance: input.battleProvenance,
    };
  }

  /**
   * Detects reasons NOT to transfer confidently. These are risks, not mere
   * absences of similarity: each one argues actively against applying the
   * evidence here.
   */
  async detectNegativeTransfer(
    candidate: TransferCandidate,
    context: TransferContext,
    similarity: SimilarityProfile,
  ): Promise<NegativeTransferRisk[]> {
    const risks: NegativeTransferRisk[] = [];

    if (candidate.isLeaderboardPosition) {
      risks.push({
        reason: 'leaderboard_not_evidence',
        severity: 1,
        explanation:
          'This is a competition standing, not a scientific finding. A leaderboard position is never transferable evidence.',
      });
    }

    if (
      candidate.sourceObjective !== undefined &&
      candidate.sourceObjective !== context.objective
    ) {
      risks.push({
        reason: 'objective_mismatch',
        severity: 0.8,
        explanation: `Evidence targets "${candidate.sourceObjective}" but this profile optimizes for "${context.objective}". A result that moves one objective may do nothing for another.`,
      });
    }

    if (
      candidate.sourcePlatform !== undefined &&
      candidate.sourcePlatform !== context.platform
    ) {
      risks.push({
        reason: 'platform_mechanics_incompatible',
        severity: 0.6,
        explanation: `Evidence came from ${candidate.sourcePlatform}; this profile is on ${context.platform}. Distribution mechanics differ between platforms.`,
      });
    }

    const stageDimension = similarity.dimensions.find((d) => d.key === 'accountStage');
    if (stageDimension?.comparison === 'mismatch') {
      risks.push({
        reason: 'account_stage_mismatch',
        severity: 0.6,
        explanation: `Account stages differ (${candidate.sourceAccountStage} vs ${context.accountStage}). Advice that works at one stage routinely fails at another.`,
      });
    }

    const offerDimension = similarity.dimensions.find((d) => d.key === 'offerType');
    if (offerDimension?.comparison === 'mismatch') {
      risks.push({
        reason: 'offer_incompatible',
        severity: 0.5,
        explanation: 'The offer types differ, so a conversion result may not carry across.',
      });
    }

    const behaviorDimension = similarity.dimensions.find((d) => d.key === 'audienceBehavior');
    if (behaviorDimension?.comparison === 'mismatch') {
      risks.push({
        reason: 'audience_behavior_differs',
        severity: 0.5,
        explanation: 'Observed audience behavior differs between the two profiles.',
      });
    }

    const ageDays = daysBetween(candidate.lastValidatedAt, this.now());
    if (ageDays > this.policy.stalenessDays) {
      risks.push({
        reason: 'stale_evidence',
        severity: 0.5,
        explanation: `Evidence was last validated ${ageDays} days ago, beyond the ${this.policy.stalenessDays}-day staleness window. Platforms change.`,
      });
    }

    // The strongest signal of all: this profile's OWN evidence disagrees.
    const ownFindings = await this.store.listFindings({ profileId: context.profileId });
    const contradicting = ownFindings.find(
      (f) => f.statement === candidate.statement && f.status === 'rejected',
    );
    if (contradicting) {
      risks.push({
        reason: 'conflicting_first_party_evidence',
        severity: 1,
        explanation: `This profile already tested "${candidate.statement}" and rejected it. First-party evidence outranks transferred evidence on its own profile.`,
      });
    }

    return risks;
  }

  /** Maps similarity, coverage, source class and risk onto a relevance verdict. */
  private decideRelevance(
    candidate: TransferCandidate,
    similarity: SimilarityProfile,
    risks: readonly NegativeTransferRisk[],
  ): TransferRelevance {
    // A leaderboard position or contradicted claim is never transferable,
    // whatever the similarity says.
    if (risks.some((r) => r.reason === 'leaderboard_not_evidence')) return 'irrelevant';
    if (this.policy.firstPartyDominates && risks.some((r) => r.reason === 'conflicting_first_party_evidence')) {
      return 'contraindicated';
    }

    // Too little was comparable to make any confident claim.
    if (similarity.dimensionCoverage < this.policy.minimumDimensionCoverage) {
      return 'insufficiently_comparable';
    }

    // A wrong-objective result answers a different question.
    if (risks.some((r) => r.reason === 'objective_mismatch')) return 'hypothesis_only';

    let relevance: TransferRelevance;
    const s = similarity.overallSimilarity;
    if (s >= this.policy.directlyApplicableThreshold) relevance = 'directly_applicable';
    else if (s >= this.policy.stronglyRelevantThreshold) relevance = 'strongly_relevant';
    else if (s >= this.policy.moderatelyRelevantThreshold) relevance = 'moderately_relevant';
    else if (s >= this.policy.weaklyRelevantThreshold) relevance = 'weakly_relevant';
    else relevance = 'irrelevant';

    // Cross-niche evidence is capped however well other dimensions line up.
    if (candidate.sourceClass === 'cross_niche') {
      relevance = capRelevance(relevance, this.policy.crossNicheMaxRelevance);
    }
    // Research and playbook-grade evidence can seed a test, never a
    // confident application.
    if (candidate.sourceClass === 'research') {
      relevance = capRelevance(relevance, 'hypothesis_only');
    }
    // Only the profile's own evidence can ever be "directly applicable".
    if (candidate.sourceClass !== 'first_party') {
      relevance = capRelevance(relevance, 'strongly_relevant');
    }
    // Stale evidence cannot be strong evidence.
    if (risks.some((r) => r.reason === 'stale_evidence')) {
      relevance = capRelevance(relevance, 'weakly_relevant');
    }

    return relevance;
  }

  /** Maps relevance onto what Kairos should actually do. */
  private buildRecommendation(
    candidate: TransferCandidate,
    relevance: TransferRelevance,
    similarity: SimilarityProfile,
  ): TransferRecommendation {
    const hypothesis = `For this profile: ${candidate.statement}`;
    switch (relevance) {
      case 'directly_applicable':
        return {
          action: 'apply_with_confidence',
          reason: 'This profile\'s own validated evidence applies directly.',
          priority: 0.9,
        };
      case 'strongly_relevant':
      case 'moderately_relevant':
        return {
          action: 'run_experiment',
          reason: `Comparable on ${similarity.matchedDimensions.length} dimension(s); worth testing here before relying on it.`,
          proposedHypothesisStatement: hypothesis,
          priority: relevance === 'strongly_relevant' ? 0.75 : 0.55,
        };
      case 'weakly_relevant':
      case 'hypothesis_only':
        return {
          action: 'seed_hypothesis',
          reason: 'Useful as a starting hypothesis only — the evidence does not carry over on its own.',
          proposedHypothesisStatement: hypothesis,
          priority: 0.35,
        };
      case 'insufficiently_comparable':
        return {
          action: 'collect_more_evidence',
          reason: 'Too few dimensions could be compared to judge relevance. Gather more context first.',
          priority: 0.3,
        };
      case 'contraindicated':
        return {
          action: 'do_not_transfer',
          reason: 'This profile\'s own evidence contradicts the claim. Do not apply it here.',
          priority: 0,
        };
      case 'irrelevant':
      default:
        return { action: 'do_not_transfer', reason: 'The evidence does not apply to this profile.', priority: 0 };
    }
  }

  /**
   * The full assessment: what evidence, from where, why it might and might
   * not apply, which dimensions matched and differed, how fresh it is, what
   * is unknown, and what to do.
   */
  async assessTransfer(candidate: TransferCandidate, context: TransferContext): Promise<TransferAssessment> {
    const now = this.now();
    const similarity = computeSimilarity(candidate, context, this.policy, now);
    const risks = await this.detectNegativeTransfer(candidate, context, similarity);
    const relevance = this.decideRelevance(candidate, similarity, risks);
    const recommendation = this.buildRecommendation(candidate, relevance, similarity);
    const evidenceAgeDays = daysBetween(candidate.lastValidatedAt, now);

    const whyItMightApply = similarity.dimensions
      .filter((d) => d.comparison === 'match' || d.comparison === 'partial')
      .map((d) => d.note);
    const whyItMightNotApply = [
      ...similarity.dimensions.filter((d) => d.comparison === 'mismatch').map((d) => d.note),
      ...risks.map((r) => r.explanation),
    ];
    const unknowns = similarity.unknownDimensions.map(
      (key) => `${key} is unknown for one or both profiles, so it could not be compared.`,
    );

    // Confidence in the ASSESSMENT — driven by how much was knowable, not by
    // how strong the underlying claim is.
    const assessmentConfidence = Math.max(0, Math.min(1, similarity.dimensionCoverage * (1 - risks.length * 0.1)));

    const limitations: AnalysisLimitation[] = [...similarity.limitations, ...candidate.limitations];
    if (evidenceAgeDays > this.policy.stalenessDays) limitations.push('platform_change');

    const assessment: TransferAssessment = {
      id: `xfer_${randomUUID()}`,
      candidateId: candidate.id,
      findingId: candidate.findingId,
      targetProfileId: context.profileId,
      sourceClass: candidate.sourceClass,
      relevance,
      similarity,
      assessmentConfidence,
      whyItMightApply,
      whyItMightNotApply,
      negativeTransferRisks: risks,
      unknowns,
      evidenceAgeDays,
      recommendation,
      // Battle provenance travels with the assessment.
      battleProvenance: candidate.battleProvenance,
      limitations: [...new Set(limitations)],
      policyVersion: this.policy.policyVersion,
      createdAt: now,
      schemaVersion: 1,
    };

    await this.store.saveTransferAssessment(assessment);
    return assessment;
  }

  /** Assesses many candidates, strongest recommendation first. */
  async assessMany(
    candidates: readonly TransferCandidate[],
    context: TransferContext,
  ): Promise<TransferAssessment[]> {
    const assessments: TransferAssessment[] = [];
    for (const candidate of candidates) {
      assessments.push(await this.assessTransfer(candidate, context));
    }
    return assessments.sort((a, b) =>
      b.recommendation.priority !== a.recommendation.priority
        ? b.recommendation.priority - a.recommendation.priority
        : a.id.localeCompare(b.id),
    );
  }

  /**
   * Cold start: a profile with no performance history of its own.
   *
   * Returns the honest framing — Kairos does NOT know what works for this
   * profile yet — plus the most promising starting hypotheses drawn from
   * comparable profiles. Every one is a hypothesis to test, never a
   * validated answer.
   */
  async buildColdStartGuidance(
    context: TransferContext,
    candidates: readonly TransferCandidate[],
  ): Promise<{
    isColdStart: boolean;
    statement: string;
    startingHypotheses: readonly { statement: string; sourceClass: EvidenceSourceClass; relevance: TransferRelevance; assessmentId: string }[];
    limitations: readonly AnalysisLimitation[];
  }> {
    const isColdStart = !context.hasFirstPartyEvidence;
    const assessments = await this.assessMany(candidates, context);
    const usable = assessments.filter(
      (a) => a.recommendation.action === 'run_experiment' || a.recommendation.action === 'seed_hypothesis',
    );

    return {
      isColdStart,
      statement: isColdStart
        ? 'We do not know what works for this profile yet. Based on evidence from comparable profiles, these are the most promising starting hypotheses — each one still needs testing here.'
        : 'This profile already has first-party evidence, which takes precedence over transferred evidence.',
      startingHypotheses: usable.map((a) => ({
        statement: a.recommendation.proposedHypothesisStatement ?? a.findingId,
        sourceClass: a.sourceClass,
        relevance: a.relevance,
        assessmentId: a.id,
      })),
      limitations: isColdStart ? ['small_sample', 'unknown_attribution'] : [],
    };
  }

  /**
   * Turns an assessment into a `Hypothesis` for the RECEIVING profile.
   *
   * This is the only bridge from transfer into the science pipeline, and it
   * deliberately produces a hypothesis at `proposed` with `source:
   * 'research'` — never a `Finding`. The Science Engine must still validate
   * it on this profile's own evidence.
   */
  async seedHypothesisFromAssessment(
    assessment: TransferAssessment,
    input: { readonly dependentMetric: Parameters<IntelligenceStore['saveHypothesis']>[0]['dependentMetric']; readonly independentVariable: string },
  ): Promise<{ ok: true; hypothesisId: string } | { ok: false; error: string }> {
    if (assessment.recommendation.action === 'do_not_transfer') {
      return { ok: false, error: 'This assessment recommends against transfer; it cannot seed a hypothesis.' };
    }
    const statement = assessment.recommendation.proposedHypothesisStatement;
    if (!statement) {
      return { ok: false, error: 'This assessment produced no hypothesis statement to seed from.' };
    }

    const id = `hyp_${randomUUID()}`;
    await this.store.saveHypothesis({
      id,
      statement,
      scope: { level: 'profile', profileId: assessment.targetProfileId },
      profileId: assessment.targetProfileId,
      independentVariable: input.independentVariable,
      dependentMetric: input.dependentMetric,
      controlVariables: [],
      // Untested here, whatever it showed elsewhere.
      status: 'proposed',
      confidence: Math.min(0.3, assessment.assessmentConfidence),
      source: 'research',
      supportingExperimentIds: [],
      contradictingExperimentIds: [],
      createdAt: this.now(),
    });
    return { ok: true, hypothesisId: id };
  }

  // ---- Peer cohorts -----------------------------------------------------

  async createPeerCohort(
    input: Omit<PeerCohort, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<PeerCohort> {
    const cohort: PeerCohort = {
      ...input,
      id: input.id ?? `cohort_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.savePeerCohort(cohort);
    return cohort;
  }

  /** Historical assessments for a profile, newest first. Never overwritten. */
  async listAssessments(targetProfileId: string): Promise<TransferAssessment[]> {
    return this.store.listTransferAssessments({ targetProfileId });
  }
}
