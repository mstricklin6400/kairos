/**
 * Social Prescription Engine domain types — Milestone 11.
 *
 * Turns Kairos intelligence into a curated, evidence-backed strategy package
 * for ONE specific profile. This is where the commercial promise lands:
 *
 *   "Don't give me generic social advice. Tell me what I should do, for my
 *    business, audience, niche, platform and objective — and tell me why."
 *
 * A prescription is NOT generated content and NOT a generic playbook. Every
 * recommendation carries the evidence class that earned it, and the engine
 * draws exclusively from the systems beneath it (Science, Adaptive Strategy,
 * Transfer, Audience, Research, Measurement) rather than inventing strategy
 * of its own.
 *
 * TWO SEPARATIONS THIS MODULE EXISTS TO ENFORCE
 * ------------------------------------------------------------------------
 * 1. **Pattern vs. execution.** "Question-led problem hooks perform well"
 *    is a supported pattern. "Are you making this credit mistake?" is one
 *    possible execution of it. The first can carry evidence; the second
 *    never can. `PrescriptionExample` deliberately has no evidence class or
 *    confidence — see its doc.
 *
 * 2. **Evidence classes never collapse.** "Validated on your profile" and
 *    "supported by comparable profiles" are different claims and stay
 *    different. There is no single blended certainty score anywhere in this
 *    model.
 */
import type {
  AccountStage,
  Confidence,
  ContentFormat,
  GrowthObjective,
  HookFamily,
  IsoDateTime,
  Platform,
} from '../common/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { PerformanceMetric } from '../performance/types.js';

/**
 * How well-supported a recommendation is, and BY WHAT. These are distinct
 * kinds of claim, deliberately never averaged into one number:
 *
 * - `validated_on_profile`   — this profile tested it and it held.
 * - `promising_on_profile`   — this profile's own evidence leans that way, not yet validated.
 * - `comparable_profiles`    — transferred from peers judged comparable. Not first-party proof.
 * - `research_informed`      — from a claim/principle. A hypothesis, never a result.
 * - `experimental`           — proposed as a test; no result yet.
 * - `unknown`                — no evidence either way; stated so plainly.
 */
export type EvidenceClass =
  | 'validated_on_profile'
  | 'promising_on_profile'
  | 'comparable_profiles'
  | 'research_informed'
  | 'experimental'
  | 'unknown';

/** Which part of the prescription a recommendation belongs to. */
export type PrescriptionSectionKey =
  | 'who'
  | 'what'
  | 'how'
  | 'where'
  | 'when'
  | 'what_not_to_do'
  | 'what_to_test'
  | 'what_we_dont_know';

/**
 * The evidence behind one recommendation, by reference. Ids point at real
 * stored records so any claim can be traced to what produced it — the
 * prescription never restates evidence it cannot cite.
 */
export interface PrescriptionEvidence {
  readonly evidenceClass: EvidenceClass;
  readonly findingIds: readonly string[];
  readonly segmentFindingIds: readonly string[];
  readonly transferAssessmentIds: readonly string[];
  readonly strategyPrincipleIds: readonly string[];
  readonly hypothesisIds: readonly string[];
  readonly experimentIds: readonly string[];
  readonly recommendationIds: readonly string[];
  /** Sample behind the claim, where one exists. Absent for research/unknown. */
  readonly sampleSize?: number;
  /** Confidence WITHIN this evidence class. Never comparable across classes. */
  readonly confidence?: Confidence;
  /** When the underlying evidence was last validated — drives staleness. */
  readonly lastValidatedAt?: IsoDateTime;
  /** Battle season/protocol provenance, when the evidence came from a battle. */
  readonly battleSeasonId?: string;
  readonly battleProtocolVersion?: string;
}

/**
 * An illustrative execution — a sample hook, a phrasing, a post shape.
 *
 * Deliberately carries **no** `evidenceClass`, `confidence` or sample: an
 * example is a demonstration of a pattern, never itself evidence. Claiming
 * a specific sentence is "scientifically proven" is exactly the error this
 * type exists to make structurally impossible.
 */
export interface PrescriptionExample {
  readonly text: string;
  /** The pattern this illustrates — that pattern may carry evidence; this does not. */
  readonly illustratesPattern: string;
  readonly note: string;
}

/** One actionable item in a prescription. */
export interface PrescriptionRecommendation {
  readonly id: string;
  readonly section: PrescriptionSectionKey;
  /** The pattern-level claim. Never final copy. */
  readonly statement: string;
  readonly rationale: string;
  readonly evidence: PrescriptionEvidence;
  /** Operational ordering within the section. Not a probability. */
  readonly priority: number;
  readonly limitations: readonly AnalysisLimitation[];
  /** Illustrative executions. Explicitly not evidence — see `PrescriptionExample`. */
  readonly examples: readonly PrescriptionExample[];
  /** Set when the underlying evidence is stale and should be re-tested before reuse. */
  readonly needsRevalidation: boolean;
}

/** A grouped set of recommendations, with the section's own caveats. */
export interface PrescriptionSection {
  readonly key: PrescriptionSectionKey;
  readonly title: string;
  readonly summary: string;
  readonly recommendations: readonly PrescriptionRecommendation[];
  readonly limitations: readonly AnalysisLimitation[];
}

/** Something Kairos explicitly does not know for this profile. */
export interface PrescriptionUnknown {
  readonly topic: string;
  readonly reason: string;
  readonly howToResolve: string;
}

/** A test worth running, surfaced from unresolved hypotheses and information gain. */
export interface PrescriptionExperiment {
  readonly hypothesisId?: string;
  readonly transferAssessmentId?: string;
  readonly statement: string;
  readonly independentVariable?: string;
  readonly dependentMetric?: PerformanceMetric;
  readonly rationale: string;
  /** Operational value-of-information score. Not a probability. */
  readonly informationGain: number;
}

/** WHO: audience guidance, keeping declared and observed distinct. */
export interface AudiencePrescription {
  readonly declaredAudience?: string;
  readonly observedSegmentIds: readonly string[];
  readonly prioritySegmentId?: string;
  /** Where declared belief and observed behavior appear to diverge. */
  readonly declaredVsObservedNote: string;
  readonly uncertainties: readonly string[];
}

/** WHAT: content pillars, topics, formats, mix. */
export interface ContentPrescription {
  readonly pillars: readonly { readonly pillarId: string; readonly share: number; readonly reason: string }[];
  readonly recommendedFormats: readonly ContentFormat[];
  readonly topicsToEmphasize: readonly string[];
  readonly topicsToAvoid: readonly string[];
}

/** HOW: hook families — patterns, with examples kept separate. */
export interface HookPrescription {
  readonly hookFamily: HookFamily;
  readonly evidenceClass: EvidenceClass;
  readonly rationale: string;
  readonly examples: readonly PrescriptionExample[];
}

/** HOW: call-to-action guidance. */
export interface CtaPrescription {
  readonly ctaType: string;
  readonly evidenceClass: EvidenceClass;
  readonly rationale: string;
}

/** WHERE: platform-specific guidance. */
export interface PlatformPrescription {
  readonly platform: Platform;
  readonly notes: readonly string[];
  readonly evidenceClass: EvidenceClass;
}

/** WHEN: cadence — only where evidence or stated capacity supports it. */
export interface CadencePrescription {
  readonly postsPerDay?: number;
  readonly postsPerWeek?: number;
  readonly evidenceClass: EvidenceClass;
  readonly rationale: string;
  /** True when this simply restates declared capacity rather than resting on performance evidence. */
  readonly fromStatedCapacityOnly: boolean;
}

/** Offer/monetization guidance, tied to the profile's actual offers. */
export interface OfferPrescription {
  readonly offerId?: string;
  readonly statement: string;
  readonly evidenceClass: EvidenceClass;
  readonly rationale: string;
}

/** What changed between two prescription versions, and why. */
export interface PrescriptionVersion {
  readonly version: number;
  readonly generatedAt: IsoDateTime;
  /** Evidence after this timestamp was not considered. */
  readonly evidenceCutoff: IsoDateTime;
  readonly supersedesPrescriptionId?: string;
  readonly changeReason?: string;
  readonly evidenceAdded: readonly string[];
  readonly evidenceRemoved: readonly string[];
  readonly recommendationsAdded: readonly string[];
  readonly recommendationsRemoved: readonly string[];
}

/**
 * The full package for one profile at one point in time.
 *
 * Explicitly a snapshot, not standing truth: superseded prescriptions are
 * retained (`PrescriptionVersion.supersedesPrescriptionId`) so the reasoning
 * behind an earlier recommendation survives it being replaced.
 */
export interface SocialPrescription {
  readonly id: string;
  readonly profileId: string;
  readonly objective: GrowthObjective;
  readonly platform: Platform;
  readonly niche?: string;
  readonly accountStage?: AccountStage;
  readonly sections: readonly PrescriptionSection[];
  readonly audience: AudiencePrescription;
  readonly content: ContentPrescription;
  readonly hooks: readonly HookPrescription[];
  readonly ctas: readonly CtaPrescription[];
  readonly platformGuidance: PlatformPrescription;
  readonly cadence: CadencePrescription;
  readonly offers: readonly OfferPrescription[];
  readonly experimentsToRun: readonly PrescriptionExperiment[];
  readonly unknowns: readonly PrescriptionUnknown[];
  readonly limitations: readonly AnalysisLimitation[];
  /** Recommendations whose evidence has gone stale and needs re-testing. */
  readonly revalidationNeeded: readonly string[];
  readonly versionInfo: PrescriptionVersion;
  readonly policyVersion: string;
  readonly schemaVersion: number;
}

/** Configurable thresholds. Operational assumptions, not measured facts. */
export interface PrescriptionPolicy {
  /** Days after which underlying evidence is treated as stale. */
  readonly stalenessDays: number;
  /** Minimum confidence for a first-party finding to be presented as validated. */
  readonly validatedConfidenceThreshold: number;
  /** Max recommendations surfaced per section. */
  readonly maxRecommendationsPerSection: number;
  /**
   * When true, a recommendation whose evidence sits at a shallower funnel
   * tier than the profile's objective is deprioritized rather than led with
   * — an engagement win does not answer a revenue question.
   */
  readonly enforceObjectiveDepth: boolean;
  readonly policyVersion: string;
}

export const DEFAULT_PRESCRIPTION_POLICY: PrescriptionPolicy = {
  stalenessDays: 120,
  validatedConfidenceThreshold: 0.7,
  maxRecommendationsPerSection: 8,
  enforceObjectiveDepth: true,
  policyVersion: 'prescription-v1',
};
