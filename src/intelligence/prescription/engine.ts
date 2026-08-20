/**
 * The Social Prescription Engine — Milestone 11.
 *
 * Assembles a curated, evidence-backed strategy package for ONE profile by
 * reading the systems beneath it — Science, Adaptive Strategy, Transfer,
 * Audience, Research, Measurement — and never inventing strategy of its
 * own. If a claim is in a prescription, some upstream system produced it
 * and the prescription cites it.
 *
 * Produces machine-readable domain output. No dashboard, no publishing, no
 * LLM, no content generation: hook *patterns* come from evidence; example
 * executions are caller-supplied illustrations that structurally cannot
 * carry evidence.
 *
 * Depends only on the `IntelligenceStore` port and the engines above it.
 */
import { randomUUID } from 'node:crypto';
import type { GrowthObjective, IsoDateTime } from '../common/types.js';
import type { AnalysisLimitation, Finding } from '../science/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import { AdaptiveStrategyEngine } from '../adaptive/engine.js';
import { ScienceEngine } from '../science/engine.js';
import {
  classifyFinding,
  classifyTransfer,
  computeRecommendationPriority,
  describeEvidenceClass,
  diffIds,
  evidenceClassRank,
  isStale,
  servesObjective,
} from './compose.js';
import {
  DEFAULT_PRESCRIPTION_POLICY,
  type AudiencePrescription,
  type CadencePrescription,
  type ContentPrescription,
  type CtaPrescription,
  type EvidenceClass,
  type HookPrescription,
  type OfferPrescription,
  type PlatformPrescription,
  type PrescriptionExample,
  type PrescriptionExperiment,
  type PrescriptionPolicy,
  type PrescriptionRecommendation,
  type PrescriptionSection,
  type PrescriptionSectionKey,
  type PrescriptionUnknown,
  type SocialPrescription,
} from './types.js';

export interface PrescriptionEngineOptions {
  readonly policy?: Partial<PrescriptionPolicy>;
  readonly now?: () => IsoDateTime;
  readonly scienceEngine?: ScienceEngine;
  readonly adaptiveEngine?: AdaptiveStrategyEngine;
}

/** Illustrative executions a caller may attach to a hook pattern. Never evidence. */
export interface ExampleLibrary {
  readonly byHookFamily?: Readonly<Record<string, readonly string[]>>;
}

const SECTION_TITLES: Readonly<Record<PrescriptionSectionKey, string>> = {
  who: 'Who to speak to',
  what: 'What to publish',
  how: 'How to say it',
  where: 'Where to publish',
  when: 'How often',
  what_not_to_do: 'What not to do',
  what_to_test: 'What to test next',
  what_we_dont_know: "What we don't know",
};

export class SocialPrescriptionEngine {
  private readonly policy: PrescriptionPolicy;
  private readonly now: () => IsoDateTime;
  private readonly science: ScienceEngine;
  private readonly adaptive: AdaptiveStrategyEngine;

  constructor(
    private readonly store: IntelligenceStore,
    options: PrescriptionEngineOptions = {},
  ) {
    this.policy = { ...DEFAULT_PRESCRIPTION_POLICY, ...options.policy };
    this.now = options.now ?? (() => new Date().toISOString());
    this.science = options.scienceEngine ?? new ScienceEngine(this.store, { now: this.now });
    this.adaptive =
      options.adaptiveEngine ??
      new AdaptiveStrategyEngine(this.store, { now: this.now, scienceEngine: this.science });
  }

  getPolicy(): PrescriptionPolicy {
    return this.policy;
  }

  /** Counts how often this profile has rejected the same claim — feeds the failure penalty. */
  private async countObjectiveFailures(profileId: string, statement: string): Promise<number> {
    const rejected = await this.store.listFindings({ profileId, status: 'rejected' });
    return rejected.filter((f) => f.statement === statement).length;
  }

  /** Builds one recommendation from a first-party finding. */
  private async recommendationFromFinding(
    finding: Finding,
    section: PrescriptionSectionKey,
    objective: GrowthObjective,
    now: IsoDateTime,
    examples: readonly PrescriptionExample[] = [],
  ): Promise<PrescriptionRecommendation> {
    const evidenceClass = classifyFinding(finding, this.policy);
    const stale = isStale(finding.lastValidatedAt, now, this.policy);
    const metric = finding.effectSize?.metric;
    const serves = metric === undefined ? true : servesObjective(metric, objective);
    const failures = await this.countObjectiveFailures(finding.profileId ?? '', finding.statement);

    return {
      id: `prec_${randomUUID()}`,
      section,
      statement: finding.statement,
      rationale: serves
        ? `${describeEvidenceClass(evidenceClass)} (sample ${finding.sampleSize}).`
        : `${describeEvidenceClass(evidenceClass)}, but measured on ${metric}, which does not speak to your ${objective} objective — deprioritized.`,
      evidence: {
        evidenceClass,
        findingIds: [finding.id],
        segmentFindingIds: [],
        transferAssessmentIds: [],
        strategyPrincipleIds: [],
        hypothesisIds: [],
        experimentIds: finding.sourceExperimentIds,
        recommendationIds: [],
        sampleSize: finding.sampleSize,
        confidence: finding.confidence,
        lastValidatedAt: finding.lastValidatedAt,
      },
      priority: computeRecommendationPriority({
        evidenceClass,
        confidence: finding.confidence,
        servesObjective: serves,
        isStale: stale,
        repeatedObjectiveFailures: failures,
        policy: this.policy,
      }),
      // Caveats travel with the recommendation, as they do onto the Finding.
      limitations: finding.limitations ?? [],
      examples,
      needsRevalidation: stale,
    };
  }

  /** WHO — declared vs. observed audience, kept explicitly distinct. */
  private async buildAudienceSection(profileId: string): Promise<AudiencePrescription> {
    const profile = await this.store.getProfile(profileId);
    const segments = await this.store.listObservedSegments({ profileId });
    const segmentFindings = await this.store.listSegmentFindings({ profileId, status: 'supported' });

    const prioritySegmentId = segmentFindings[0]?.segmentId ?? segments[0]?.id;
    const uncertainties: string[] = [];
    if (segments.length === 0) {
      uncertainties.push('No observed audience segments yet — only the audience you declared at onboarding is known.');
    }
    if (segmentFindings.length === 0 && segments.length > 0) {
      uncertainties.push('Segments have been observed but none has supported findings yet.');
    }

    return {
      declaredAudience: profile?.audience.primaryAudience,
      observedSegmentIds: segments.map((s) => s.id),
      prioritySegmentId,
      declaredVsObservedNote:
        segments.length === 0
          ? 'Nothing observed yet, so the declared audience is unconfirmed — it remains a hypothesis about who responds.'
          : `${segments.length} observed segment(s) exist alongside your declared audience. Observed behavior, not the declared description, is what evidence here rests on.`,
      uncertainties,
    };
  }

  /** WHAT — pillars, formats, topics, honoring declared constraints. */
  private async buildContentPrescription(profileId: string): Promise<ContentPrescription> {
    const profile = await this.store.getProfile(profileId);
    const plan = await this.adaptive.getLatestPlan(profileId);

    const pillars = (plan?.contentAllocation ?? []).map((a) => ({
      pillarId: a.pillarId,
      share: a.share,
      reason: a.reason,
    }));

    return {
      pillars,
      // Formats are not carried on a Finding, so none are asserted rather
      // than guessed. A later milestone can reach through to Experiment DNA.
      recommendedFormats: [],
      topicsToEmphasize: [],
      topicsToAvoid: profile?.identity.styleConstraints ?? [],
    };
  }

  /** HOW — hook patterns, each with its evidence class and separate examples. */
  private async buildHookPrescriptions(
    profileId: string,
    examples: ExampleLibrary,
  ): Promise<HookPrescription[]> {
    const findings = await this.store.listFindings({ profileId });
    const hooks: HookPrescription[] = [];

    for (const finding of findings) {
      if (finding.status === 'rejected') continue;
      const evidenceClass = classifyFinding(finding, this.policy);
      if (evidenceClass === 'unknown') continue;
      // Hook family is not a structured field on a Finding; the statement is
      // the pattern, and it is presented as such rather than parsed.
      const family = finding.statement;
      hooks.push({
        hookFamily: family,
        evidenceClass,
        rationale: describeEvidenceClass(evidenceClass),
        examples: (examples.byHookFamily?.[family] ?? []).map((text) => ({
          text,
          illustratesPattern: family,
          note: 'Illustrative execution only. The pattern is supported; this specific wording is not itself evidence.',
        })),
      });
    }
    return hooks;
  }

  /** WHEN — cadence, flagged when it merely restates declared capacity. */
  private async buildCadence(profileId: string): Promise<CadencePrescription> {
    const profile = await this.store.getProfile(profileId);
    const capacity = profile?.strategy.postingFrequency;
    return {
      postsPerDay: capacity?.postsPerDay,
      postsPerWeek: capacity?.postsPerWeek,
      evidenceClass: 'unknown',
      rationale:
        'Based on the capacity you stated at onboarding. No timing or cadence evidence has been gathered for this profile yet.',
      // The honest flag: this is not a performance finding.
      fromStatedCapacityOnly: true,
    };
  }

  /** WHERE — platform notes, asserted only where evidence exists. */
  private async buildPlatformGuidance(profileId: string): Promise<PlatformPrescription> {
    const profile = await this.store.getProfile(profileId);
    const findings = await this.store.listFindings({ profileId });
    const platformFindings = findings.filter((f) => f.platform === profile?.platform && f.status !== 'rejected');
    return {
      platform: profile!.platform,
      notes: platformFindings.map((f) => f.statement),
      evidenceClass: platformFindings.length > 0 ? 'promising_on_profile' : 'unknown',
    };
  }

  /** Offer guidance, tied to actual offers. */
  private async buildOfferPrescriptions(profileId: string): Promise<OfferPrescription[]> {
    const profile = await this.store.getProfile(profileId);
    const active = (profile?.monetization.offers ?? []).filter((o) => o.active);
    if (active.length === 0) {
      return [
        {
          statement: 'No active offer is configured, so no conversion or offer strategy can be prescribed yet.',
          evidenceClass: 'unknown',
          rationale: 'Add an offer before conversion-focused recommendations become meaningful.',
        },
      ];
    }
    return active.map((offer) => ({
      offerId: offer.id,
      statement: `Offer "${offer.name}" is active and can be tested against your ${profile!.objectives.primary} objective.`,
      evidenceClass: 'unknown' as EvidenceClass,
      rationale: 'No first-party conversion evidence for this offer yet.',
    }));
  }

  /** WHAT TO TEST — unresolved hypotheses and transfer-seeded candidates. */
  private async buildExperiments(profileId: string, objective: GrowthObjective): Promise<PrescriptionExperiment[]> {
    const experiments: PrescriptionExperiment[] = [];

    for (const hypothesis of await this.store.listHypotheses({ profileId })) {
      if (hypothesis.status === 'supported' || hypothesis.status === 'rejected') continue;
      experiments.push({
        hypothesisId: hypothesis.id,
        statement: hypothesis.statement,
        independentVariable: hypothesis.independentVariable,
        dependentMetric: hypothesis.dependentMetric,
        rationale:
          hypothesis.status === 'inconclusive'
            ? 'Evidence so far is conflicting; more is needed to decide it.'
            : 'Registered but not yet resolved for this profile.',
        informationGain: servesObjective(hypothesis.dependentMetric, objective) ? 0.8 : 0.3,
      });
    }

    for (const assessment of await this.store.listTransferAssessments({ targetProfileId: profileId })) {
      if (assessment.recommendation.action !== 'run_experiment' && assessment.recommendation.action !== 'seed_hypothesis') {
        continue;
      }
      experiments.push({
        transferAssessmentId: assessment.id,
        statement: assessment.recommendation.proposedHypothesisStatement ?? assessment.findingId,
        rationale: `${describeEvidenceClass(classifyTransfer(assessment))} — worth testing here before relying on it.`,
        informationGain: assessment.recommendation.priority,
      });
    }

    return experiments.sort((a, b) => b.informationGain - a.informationGain);
  }

  /**
   * Assembles the prescription.
   *
   * Every section is built from stored evidence via the engines beneath;
   * where no evidence exists the prescription says so rather than filling
   * the gap.
   */
  async buildPrescription(
    profileId: string,
    options: { readonly examples?: ExampleLibrary; readonly changeReason?: string } = {},
  ): Promise<SocialPrescription | null> {
    const profile = await this.store.getProfile(profileId);
    if (!profile) return null;

    const now = this.now();
    const objective = profile.objectives.primary;
    const findings = await this.store.listFindings({ profileId });
    const transfers = await this.store.listTransferAssessments({ targetProfileId: profileId });

    // ---- WHAT / HOW: first-party findings ----
    const positive = findings.filter((f) => f.status === 'validated' || f.status === 'promising');
    const whatRecs: PrescriptionRecommendation[] = [];
    for (const finding of positive) {
      whatRecs.push(await this.recommendationFromFinding(finding, 'what', objective, now));
    }

    // ---- WHAT NOT TO DO: rejected findings and contraindicated transfers ----
    const notRecs: PrescriptionRecommendation[] = [];
    for (const finding of findings.filter((f) => f.status === 'rejected')) {
      notRecs.push({
        id: `prec_${randomUUID()}`,
        section: 'what_not_to_do',
        statement: `Avoid: ${finding.statement}`,
        rationale: `Tested on your profile and rejected (sample ${finding.sampleSize}).`,
        evidence: {
          evidenceClass: 'validated_on_profile',
          findingIds: [finding.id], segmentFindingIds: [], transferAssessmentIds: [],
          strategyPrincipleIds: [], hypothesisIds: [], experimentIds: finding.sourceExperimentIds,
          recommendationIds: [], sampleSize: finding.sampleSize, confidence: finding.confidence,
          lastValidatedAt: finding.lastValidatedAt,
        },
        priority: 0.6,
        limitations: finding.limitations ?? [],
        examples: [],
        needsRevalidation: false,
      });
    }
    for (const assessment of transfers.filter((t) => t.relevance === 'contraindicated')) {
      notRecs.push({
        id: `prec_${randomUUID()}`,
        section: 'what_not_to_do',
        statement: `Do not adopt transferred advice: ${assessment.findingId}`,
        rationale: assessment.recommendation.reason,
        evidence: {
          evidenceClass: 'comparable_profiles',
          findingIds: [assessment.findingId], segmentFindingIds: [], transferAssessmentIds: [assessment.id],
          strategyPrincipleIds: [], hypothesisIds: [], experimentIds: [], recommendationIds: [],
        },
        priority: 0.5,
        limitations: assessment.limitations,
        examples: [],
        needsRevalidation: false,
      });
    }

    // ---- Transferred evidence, never presented as first-party ----
    const transferRecs: PrescriptionRecommendation[] = transfers
      .filter((t) => t.relevance !== 'contraindicated' && t.relevance !== 'irrelevant')
      .map((assessment) => {
        const evidenceClass = classifyTransfer(assessment);
        return {
          id: `prec_${randomUUID()}`,
          section: 'what' as PrescriptionSectionKey,
          statement: assessment.recommendation.proposedHypothesisStatement ?? assessment.findingId,
          rationale: `${describeEvidenceClass(evidenceClass)}. ${assessment.recommendation.reason}`,
          evidence: {
            evidenceClass,
            findingIds: [assessment.findingId], segmentFindingIds: [], transferAssessmentIds: [assessment.id],
            strategyPrincipleIds: [], hypothesisIds: [], experimentIds: [], recommendationIds: [],
            confidence: assessment.assessmentConfidence,
            battleSeasonId: assessment.battleProvenance?.seasonId,
            battleProtocolVersion: assessment.battleProvenance?.protocolVersion,
          },
          priority: computeRecommendationPriority({
            evidenceClass,
            confidence: assessment.assessmentConfidence,
            servesObjective: true,
            isStale: false,
            policy: this.policy,
          }),
          limitations: assessment.limitations,
          examples: [],
          needsRevalidation: false,
        };
      });

    const sortAndCap = (recs: PrescriptionRecommendation[]): PrescriptionRecommendation[] =>
      [...recs]
        .sort((a, b) =>
          b.priority !== a.priority
            ? b.priority - a.priority
            : evidenceClassRank(b.evidence.evidenceClass) - evidenceClassRank(a.evidence.evidenceClass),
        )
        .slice(0, this.policy.maxRecommendationsPerSection);

    const audience = await this.buildAudienceSection(profileId);
    const content = await this.buildContentPrescription(profileId);
    const hooks = await this.buildHookPrescriptions(profileId, options.examples ?? {});
    const cadence = await this.buildCadence(profileId);
    const platformGuidance = await this.buildPlatformGuidance(profileId);
    const offers = await this.buildOfferPrescriptions(profileId);
    const experimentsToRun = await this.buildExperiments(profileId, objective);

    // ---- Unknowns, stated rather than filled in ----
    const unknowns: PrescriptionUnknown[] = [];
    if (positive.length === 0) {
      unknowns.push({
        topic: 'What works for this profile',
        reason: 'No validated or promising first-party findings exist yet.',
        howToResolve: 'Run the experiments listed under "What to test next".',
      });
    }
    if (audience.observedSegmentIds.length === 0) {
      unknowns.push({
        topic: 'Who actually responds',
        reason: 'No observed audience segments have been recorded.',
        howToResolve: 'Collect audience signals from comments, replies and conversions.',
      });
    }
    if (cadence.fromStatedCapacityOnly) {
      unknowns.push({
        topic: 'Optimal cadence and timing',
        reason: 'Cadence guidance currently restates your stated capacity; no timing evidence exists.',
        howToResolve: 'Run a posting-frequency or timing experiment.',
      });
    }

    const allRecs = [...sortAndCap([...whatRecs, ...transferRecs]), ...sortAndCap(notRecs)];
    const revalidationNeeded = allRecs.filter((r) => r.needsRevalidation).map((r) => r.id);

    const limitations: AnalysisLimitation[] = [];
    if (positive.length === 0) limitations.push('small_sample');
    if (audience.observedSegmentIds.length === 0) limitations.push('unknown_attribution');

    const sections: PrescriptionSection[] = [
      {
        key: 'who', title: SECTION_TITLES.who,
        summary: audience.declaredVsObservedNote, recommendations: [], limitations: [],
      },
      {
        key: 'what', title: SECTION_TITLES.what,
        summary: `${sortAndCap([...whatRecs, ...transferRecs]).length} recommendation(s), each labelled with the evidence that earned it.`,
        recommendations: sortAndCap([...whatRecs, ...transferRecs]), limitations: [],
      },
      {
        key: 'how', title: SECTION_TITLES.how,
        summary: `${hooks.length} hook pattern(s). Examples are illustrations, never evidence.`,
        recommendations: [], limitations: [],
      },
      {
        key: 'where', title: SECTION_TITLES.where,
        summary: `Guidance for ${platformGuidance.platform}.`, recommendations: [], limitations: [],
      },
      {
        key: 'when', title: SECTION_TITLES.when, summary: cadence.rationale, recommendations: [], limitations: [],
      },
      {
        key: 'what_not_to_do', title: SECTION_TITLES.what_not_to_do,
        summary: `${notRecs.length} approach(es) to avoid.`, recommendations: sortAndCap(notRecs), limitations: [],
      },
      {
        key: 'what_to_test', title: SECTION_TITLES.what_to_test,
        summary: `${experimentsToRun.length} open question(s).`, recommendations: [], limitations: [],
      },
      {
        key: 'what_we_dont_know', title: SECTION_TITLES.what_we_dont_know,
        summary: `${unknowns.length} explicit unknown(s).`, recommendations: [], limitations: [],
      },
    ];

    // ---- Versioning: never erase the previous prescription ----
    const previous = await this.getLatestPrescription(profileId);
    const previousEvidence = previous
      ? previous.sections.flatMap((s) => s.recommendations.flatMap((r) => r.evidence.findingIds))
      : [];
    const currentEvidence = allRecs.flatMap((r) => r.evidence.findingIds);
    const previousRecStatements = previous
      ? previous.sections.flatMap((s) => s.recommendations.map((r) => r.statement))
      : [];
    const currentRecStatements = allRecs.map((r) => r.statement);

    const evidenceDiff = diffIds(previousEvidence, currentEvidence);
    const recDiff = diffIds(previousRecStatements, currentRecStatements);

    const prescription: SocialPrescription = {
      id: `rx_${randomUUID()}`,
      profileId,
      objective,
      platform: profile.platform,
      niche: profile.market.niche,
      sections,
      audience,
      content,
      hooks,
      ctas: [] as CtaPrescription[],
      platformGuidance,
      cadence,
      offers,
      experimentsToRun,
      unknowns,
      limitations,
      revalidationNeeded,
      versionInfo: {
        version: (previous?.versionInfo.version ?? 0) + 1,
        generatedAt: now,
        evidenceCutoff: now,
        supersedesPrescriptionId: previous?.id,
        changeReason: options.changeReason,
        evidenceAdded: evidenceDiff.added,
        evidenceRemoved: evidenceDiff.removed,
        recommendationsAdded: recDiff.added,
        recommendationsRemoved: recDiff.removed,
      },
      policyVersion: this.policy.policyVersion,
      schemaVersion: 1,
    };

    await this.store.saveSocialPrescription(prescription);
    return prescription;
  }

  /** The current prescription for a profile. Earlier versions are retained. */
  async getLatestPrescription(profileId: string): Promise<SocialPrescription | null> {
    const all = await this.store.listSocialPrescriptions({ profileId });
    if (all.length === 0) return null;
    return all.reduce((latest, p) => (p.versionInfo.version > latest.versionInfo.version ? p : latest));
  }

  /** Full history, oldest first. Nothing is ever erased. */
  async getPrescriptionHistory(profileId: string): Promise<SocialPrescription[]> {
    const all = await this.store.listSocialPrescriptions({ profileId });
    return [...all].sort((a, b) => a.versionInfo.version - b.versionInfo.version);
  }
}
