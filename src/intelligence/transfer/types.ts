/**
 * Intelligence Transfer Engine domain types — Milestone 10.
 *
 * Answers one question: *evidence exists that something worked somewhere
 * else — how relevant is it to THIS profile?*
 *
 * THE CORE PRINCIPLE
 * ------------------------------------------------------------------------
 * **TRANSFER IS NOT TRUTH.** A finding from another account, battle, niche,
 * audience or platform can never become a validated first-party finding for
 * the receiving profile. Transferred intelligence may influence
 * prioritization, seed hypotheses, suggest experiments, improve cold-start
 * strategy and reduce wasted exploration. It may not masquerade as
 * first-party validation.
 *
 * Structurally: this module produces `TransferAssessment` and
 * `TransferRecommendation` records. It never writes a `Finding`, and the
 * strongest action it can recommend is running an experiment on the
 * receiving profile — which the Science Engine then evaluates on that
 * profile's own evidence.
 *
 * PRIVACY
 * ------------------------------------------------------------------------
 * Comparability is assessed on marketing-relevant, aggregate, behavioral
 * dimensions only. No type here has a field for a sensitive personal
 * characteristic, and there is no per-individual record of any kind —
 * transfer compares PROFILES and COHORTS, never people.
 */
import type {
  AccountStage,
  Confidence,
  ContentFormat,
  GrowthObjective,
  IsoDateTime,
  Platform,
} from '../common/types.js';
import type { OfferType } from '../profiles/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { BattleEvidenceReference } from '../battle/types.js';

/**
 * How relevant transferred evidence is to the receiving profile.
 *
 * `contraindicated` is distinct from `irrelevant`: irrelevant evidence
 * simply doesn't apply, whereas contraindicated evidence actively argues
 * AGAINST doing the thing here — typically because the receiving profile's
 * own evidence contradicts it. `insufficiently_comparable` means Kairos
 * cannot tell, which is different from either.
 */
export type TransferRelevance =
  | 'directly_applicable'
  | 'strongly_relevant'
  | 'moderately_relevant'
  | 'weakly_relevant'
  | 'hypothesis_only'
  | 'irrelevant'
  | 'contraindicated'
  | 'insufficiently_comparable';

/**
 * The class of evidence being transferred, which bounds how far it can
 * travel. Deliberately NOT a simple numeric ranking — objective match,
 * measurement quality, recency and context still matter, and a strong
 * matched-peer result can outweigh a weak first-party one on a different
 * question. What the class does guarantee is that first-party evidence is
 * never silently outranked on its own profile: see
 * `TransferPolicy.firstPartyDominates`.
 */
export type EvidenceSourceClass =
  | 'first_party'
  | 'matched_peer'
  | 'niche'
  | 'platform'
  | 'cross_niche'
  | 'research';

/** The dimensions along which two profiles are compared. */
export type TransferDimensionKey =
  | 'platform'
  | 'niche'
  | 'subNiche'
  | 'audience'
  | 'audienceBehavior'
  | 'businessModel'
  | 'offerType'
  | 'objective'
  | 'accountStage'
  | 'accountSize'
  | 'contentFormat'
  | 'postingCapacity'
  | 'voicePositioning'
  | 'geography'
  | 'experimentalConditions'
  | 'measurementQuality'
  | 'evidenceFreshness';

/**
 * How one dimension compared. `unknown` is a first-class outcome and is
 * NEVER treated as a match — a dimension Kairos cannot compare is excluded
 * from the similarity denominator and counted against coverage instead, so
 * missing information lowers confidence rather than silently inflating
 * similarity.
 */
export type DimensionComparison = 'match' | 'partial' | 'mismatch' | 'unknown';

/** One explainable dimension-level comparison. This is what makes similarity auditable. */
export interface TransferDimension {
  readonly key: TransferDimensionKey;
  readonly comparison: DimensionComparison;
  /** The source (donor) value, as a display string. Absent when unknown. */
  readonly sourceValue?: string;
  /** The target (receiving) value. Absent when unknown. */
  readonly targetValue?: string;
  readonly weight: number;
  /** `weight * matchStrength`, contributed to the numerator. 0 for mismatch/unknown. */
  readonly contribution: number;
  /** Plain-language reason, composed deterministically — no LLM. */
  readonly note: string;
}

/**
 * A fully decomposed similarity result. There is deliberately no opaque
 * single number: `overallSimilarity` is always accompanied by the
 * dimension-by-dimension breakdown that produced it, and by
 * `dimensionCoverage` saying how much was actually knowable.
 *
 * A similarity of 0.9 computed over two of seventeen dimensions is a very
 * different claim from 0.9 over all seventeen, and the model refuses to let
 * those look the same.
 */
export interface SimilarityProfile {
  readonly dimensions: readonly TransferDimension[];
  /** Weighted match share across KNOWN dimensions only, 0..1. */
  readonly overallSimilarity: number;
  /** Share of total dimension weight that could actually be compared, 0..1. */
  readonly dimensionCoverage: number;
  readonly matchedDimensions: readonly TransferDimensionKey[];
  readonly mismatchedDimensions: readonly TransferDimensionKey[];
  readonly unknownDimensions: readonly TransferDimensionKey[];
  readonly limitations: readonly AnalysisLimitation[];
}

/** Why transferring would be actively risky, not merely unhelpful. */
export type NegativeTransferReason =
  | 'objective_mismatch'
  | 'platform_mechanics_incompatible'
  | 'audience_behavior_differs'
  | 'offer_incompatible'
  | 'account_stage_mismatch'
  | 'stale_evidence'
  | 'conflicting_first_party_evidence'
  | 'leaderboard_not_evidence';

export interface NegativeTransferRisk {
  readonly reason: NegativeTransferReason;
  /** 0..1 operational severity. Not a probability. */
  readonly severity: number;
  readonly explanation: string;
}

/**
 * The context of the profile RECEIVING evidence. Assembled from stored
 * records plus caller-supplied facts Kairos does not store (account stage
 * has no home on `SocialProfile`), so nothing here is inferred.
 */
export interface TransferContext {
  readonly profileId: string;
  readonly platform: Platform;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly declaredAudience?: string;
  /** Observed segment ids — behavioral evidence, distinct from the declared audience. */
  readonly observedSegmentIds: readonly string[];
  readonly objective: GrowthObjective;
  readonly accountStage?: AccountStage;
  readonly followerCount?: number;
  readonly offerTypes: readonly OfferType[];
  readonly postsPerDay?: number;
  readonly postsPerWeek?: number;
  readonly positioning?: string;
  readonly geographicFocus?: readonly string[];
  /** Formats this profile's own evidence actually concerns. Derived, never assumed. */
  readonly typicalContentFormats: readonly ContentFormat[];
  /** Whether this profile has any first-party findings at all — drives cold-start handling. */
  readonly hasFirstPartyEvidence: boolean;
}

/**
 * A piece of evidence proposed for transfer, with everything needed to
 * judge whether it travels. Battle-sourced evidence keeps its
 * `battleProvenance` attached all the way through.
 */
export interface TransferCandidate {
  readonly id: string;
  /** The `Finding.id` this evidence comes from. Required — transfer operates on findings, never on rankings. */
  readonly findingId: string;
  readonly statement: string;
  readonly sourceClass: EvidenceSourceClass;
  /** The profile the evidence came from, when it came from one. */
  readonly sourceProfileId?: string;
  readonly sourcePlatform?: Platform;
  readonly sourceNiche?: string;
  readonly sourceSubNiche?: string;
  readonly sourceObjective?: GrowthObjective;
  readonly sourceAccountStage?: AccountStage;
  readonly sourceAudienceDescription?: string;
  readonly sourceObserved: boolean;
  readonly sourceOfferTypes: readonly OfferType[];
  readonly sourceFollowerCount?: number;
  readonly sourcePositioning?: string;
  readonly sourceGeographicFocus?: readonly string[];
  /** Content DNA the donor evidence concerns, where the finding recorded it. */
  readonly sourceContentFormat?: ContentFormat;
  readonly sourceHookFamily?: string;
  readonly confidence: Confidence;
  readonly sampleSize: number;
  /** When the evidence was last validated — drives the freshness dimension. */
  readonly lastValidatedAt: IsoDateTime;
  readonly observationWindowEnd?: IsoDateTime;
  readonly limitations: readonly AnalysisLimitation[];
  /** Retained in full when the evidence came out of a battle. */
  readonly battleProvenance?: BattleEvidenceReference;
  /**
   * Set when the "evidence" is actually a competition standing rather than a
   * scientific finding. Such a candidate is always rejected — see
   * `leaderboard_not_evidence`.
   */
  readonly isLeaderboardPosition?: boolean;
}

/** What Kairos should do with a piece of transferred evidence. */
export type TransferAction =
  | 'apply_with_confidence'
  | 'seed_hypothesis'
  | 'run_experiment'
  | 'deprioritize'
  | 'do_not_transfer'
  | 'collect_more_evidence';

export interface TransferRecommendation {
  readonly action: TransferAction;
  readonly reason: string;
  /** Present when the action is to test it here — the hypothesis statement to register. */
  readonly proposedHypothesisStatement?: string;
  readonly priority: number;
}

/**
 * The full, explainable verdict on one transfer. Answers, in order: what
 * evidence, from where, why it might apply, why it might not, which
 * dimensions matched, which differed, how fresh it is, what is unknown, and
 * what to do about it.
 */
export interface TransferAssessment {
  readonly id: string;
  readonly candidateId: string;
  readonly findingId: string;
  readonly targetProfileId: string;
  readonly sourceClass: EvidenceSourceClass;
  readonly relevance: TransferRelevance;
  readonly similarity: SimilarityProfile;
  /** Operational confidence in the ASSESSMENT, not in the underlying claim. */
  readonly assessmentConfidence: Confidence;
  readonly whyItMightApply: readonly string[];
  readonly whyItMightNotApply: readonly string[];
  readonly negativeTransferRisks: readonly NegativeTransferRisk[];
  readonly unknowns: readonly string[];
  readonly evidenceAgeDays: number;
  readonly recommendation: TransferRecommendation;
  /** Battle provenance travels with the assessment when present. */
  readonly battleProvenance?: BattleEvidenceReference;
  readonly limitations: readonly AnalysisLimitation[];
  readonly policyVersion: string;
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * A group of profiles judged comparable enough to pool evidence from —
 * the "matched peer" source class made concrete. Membership is explicit and
 * criteria are recorded, never inferred silently.
 */
export interface PeerCohort {
  readonly id: string;
  readonly name: string;
  readonly profileIds: readonly string[];
  readonly criteria: readonly string[];
  readonly niche?: string;
  readonly platform?: Platform;
  readonly objective?: GrowthObjective;
  readonly accountStage?: AccountStage;
  readonly limitations: readonly AnalysisLimitation[];
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * Configurable weights and thresholds. Documented as OPERATIONAL
 * ASSUMPTIONS, not measured facts — the same caveat that governs
 * `SciencePolicy` and `StrategyPolicy`.
 */
export interface TransferPolicy {
  readonly dimensionWeights: Readonly<Record<TransferDimensionKey, number>>;
  /** Similarity at or above which evidence may be `directly_applicable`. */
  readonly directlyApplicableThreshold: number;
  readonly stronglyRelevantThreshold: number;
  readonly moderatelyRelevantThreshold: number;
  readonly weaklyRelevantThreshold: number;
  /** Coverage below which no verdict stronger than `insufficiently_comparable` is allowed. */
  readonly minimumDimensionCoverage: number;
  /** Days after which evidence is treated as stale. */
  readonly stalenessDays: number;
  /**
   * When true, conflicting first-party evidence on the receiving profile
   * downgrades transferred evidence to `contraindicated`. First-party
   * evidence normally dominates on its own profile.
   */
  readonly firstPartyDominates: boolean;
  /** Ceiling on relevance for cross-niche evidence, however similar other dimensions look. */
  readonly crossNicheMaxRelevance: TransferRelevance;
  readonly policyVersion: string;
}

/**
 * Default weights. Objective, niche and platform carry the most weight
 * because they most often decide whether a result travels at all;
 * geography carries little because it is rarely the operative variable in
 * social performance and is frequently unknown.
 *
 * These are starting points for tuning, not measured coefficients.
 */
export const DEFAULT_TRANSFER_POLICY: TransferPolicy = {
  dimensionWeights: {
    objective: 1.0,
    niche: 0.9,
    platform: 0.9,
    audienceBehavior: 0.8,
    accountStage: 0.7,
    audience: 0.6,
    offerType: 0.6,
    businessModel: 0.6,
    subNiche: 0.5,
    measurementQuality: 0.5,
    evidenceFreshness: 0.5,
    accountSize: 0.4,
    contentFormat: 0.4,
    experimentalConditions: 0.4,
    postingCapacity: 0.3,
    voicePositioning: 0.2,
    geography: 0.1,
  },
  directlyApplicableThreshold: 0.9,
  stronglyRelevantThreshold: 0.75,
  moderatelyRelevantThreshold: 0.55,
  weaklyRelevantThreshold: 0.35,
  minimumDimensionCoverage: 0.4,
  stalenessDays: 180,
  firstPartyDominates: true,
  crossNicheMaxRelevance: 'hypothesis_only',
  policyVersion: 'transfer-v1',
};
