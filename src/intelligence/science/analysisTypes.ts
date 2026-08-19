/**
 * Science Engine domain types — Milestone 7. The vocabulary for turning
 * stored evidence into defensible, scoped, revisable conclusions.
 *
 * THE EVIDENCE LADDER — never skip a rung
 * ------------------------------------------------------------------------
 *   RAW OBSERVATION      → AnalyticalObservation (a read model, not storage)
 *          ↓
 *   COMPARISON           → ComparisonResult
 *          ↓
 *   REPEATED EVIDENCE    → HypothesisEvidence, accumulated
 *          ↓
 *   HYPOTHESIS EVALUATION→ HypothesisEvaluation
 *          ↓
 *   SCOPED FINDING       → Finding (`./types.ts`, unchanged)
 *          ↓
 *   REVALIDATION         → FindingFreshness / RevalidationCandidate
 *
 * The scientific question is never "did this post get a lot of views." It
 * is: compared with what relevant baseline or control did this result
 * differ, by how much, for which metric, under what scope, with how much
 * evidence, and what conclusion is justified?
 *
 * Nothing in this module calls an LLM, generates content, mutates strategy,
 * or touches CreatorOS.
 */
import type {
  AccountStage,
  Confidence,
  GrowthObjective,
  IsoDateTime,
  KnowledgeScope,
  Platform,
} from '../common/types.js';
import type { BaselineComparisonScope, PerformanceBaseline, PerformanceMetric } from '../performance/types.js';
import type { AnalysisLimitation, EffectSize } from './types.js';

/**
 * Where an `AnalyticalObservation` was read from. Milestone 6 deliberately
 * left `PostMeasurement` and `ExperimentObservation` as parallel stored
 * types; this names which one a given analytical row came from, so lineage
 * survives normalization.
 */
export type ObservationSourceType = 'post_measurement' | 'experiment_observation' | 'attribution_event';

/**
 * One metric reading, flattened for analysis. A READ MODEL, not a stored
 * entity: built on demand from `PostMeasurement` /`ExperimentObservation` /
 * `AttributionEvent` records and never written back. The source record is
 * never mutated, and `sourceRecordId` always points at it.
 *
 * One stored record with five populated metrics produces five
 * `AnalyticalObservation` rows — a metric that was absent produces no row
 * at all, so "missing" never silently becomes "zero" anywhere downstream.
 */
export interface AnalyticalObservation {
  readonly id: string;
  readonly profileId: string;
  readonly experimentId?: string;
  readonly creatorOsPostId?: string;
  readonly audienceSegmentId?: string;
  readonly metric: PerformanceMetric;
  readonly value: number;
  readonly measuredAt: IsoDateTime;
  readonly sourceType: ObservationSourceType;
  readonly sourceRecordId: string;
}

/**
 * Configurable thresholds governing every judgment the engine makes.
 *
 * These defaults are OPERATIONAL STARTING POINTS, NOT SCIENTIFIC LAWS.
 * "20 posts is enough" is not a fact about the universe; it is a policy
 * choice that should be revisited per profile, per platform, and as
 * evidence accumulates. Every consumer may override any field.
 */
export interface SciencePolicy {
  /** Observations required before a baseline is considered usable at all. */
  readonly minimumBaselineSample: number;
  /** Distinct supporting/contradicting experiments required to move a hypothesis off `testing`. */
  readonly minimumHypothesisSample: number;
  /** Completed pairs required before paired evidence can support a finding. */
  readonly minimumPairedSample: number;
  /** Relative change at or above which a result counts as a breakout, e.g. `0.25` = +25%. */
  readonly breakoutThreshold: number;
  /** Relative change at or below which a result counts as a failure, e.g. `-0.25` = −25%. */
  readonly failureThreshold: number;
  /** Operational confidence required before a `Finding` may be `validated`. */
  readonly minimumConfidenceForFinding: number;
  /** Days after `lastValidatedAt` at which a finding becomes due for revalidation. */
  readonly revalidationWindowDays: number;
  /** Days after `lastValidatedAt` at which a finding is treated as decaying. */
  readonly decayWindowDays: number;
}

/** Conservative operational defaults. See `SciencePolicy` — these are choices, not laws. */
export const DEFAULT_SCIENCE_POLICY: SciencePolicy = {
  minimumBaselineSample: 5,
  minimumHypothesisSample: 3,
  minimumPairedSample: 3,
  breakoutThreshold: 0.25,
  failureThreshold: -0.25,
  minimumConfidenceForFinding: 0.7,
  revalidationWindowDays: 90,
  decayWindowDays: 180,
};

/**
 * Which metrics actually answer a given objective's question. Explicit and
 * inspectable rather than buried in if/else, and overrideable per call —
 * see `resolveObjectiveMetrics` in `engine.ts`.
 *
 * This is what stops "post got a lot of views" from counting as success for
 * a revenue objective. Deeper-funnel data is NOT universally stronger
 * evidence (see §8 of the architecture doc): the relevant metric is the one
 * matching the hypothesis, the dependent variable and the objective.
 */
export type ObjectiveMetricPolicy = Readonly<Record<GrowthObjective, readonly PerformanceMetric[]>>;

export const DEFAULT_OBJECTIVE_METRICS: ObjectiveMetricPolicy = {
  reach: ['impressions', 'views'],
  conversation: ['replies', 'comments'],
  amplification: ['reposts', 'shares'],
  followers: ['followersGained'],
  traffic: ['clicks', 'profileVisits'],
  lead: ['leads'],
  sale: ['sales'],
  revenue: ['revenue'],
  // No retention/repeat-purchase metric exists in `PerformanceMetric` yet;
  // revenue is the closest available proxy and is named explicitly rather
  // than silently invented. A real retention metric is a deliberate future
  // domain decision, not something this policy should fabricate.
  retention: ['revenue'],
};

/** Which side of the baseline a result fell on. Never itself a verdict — see `OutcomeVerdict`. */
export type ComparisonDirection = 'above' | 'below' | 'near_baseline';

/**
 * Re-exported from `./types.js`, where it is defined so that `Finding`
 * itself can carry limitations without this module and that one importing
 * each other. Every existing consumer keeps importing it from here.
 */
export type { AnalysisLimitation } from './types.js';

/**
 * How one observation compared with its baseline. Being `above` baseline is
 * NOT the same as being a winner — that judgment additionally requires the
 * right metric for the objective, an adequate baseline sample, and an
 * effect large enough to matter (see `OutcomeVerdict` / `detectOutcome`).
 */
export interface ComparisonResult {
  readonly id: string;
  readonly profileId: string;
  readonly experimentId?: string;
  readonly observationId: string;
  readonly metric: PerformanceMetric;
  readonly observedValue: number;
  readonly baselineMedian: number;
  readonly baselineSampleSize: number;
  readonly comparisonScope: BaselineComparisonScope;
  readonly absoluteDifference: number;
  /** Absent when the baseline is zero — a relative change against zero is undefined, never `Infinity`/`NaN`. */
  readonly relativeDifference?: number;
  readonly effectSize: EffectSize;
  readonly direction: ComparisonDirection;
  readonly limitations: readonly AnalysisLimitation[];
  readonly measuredAt: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

/**
 * The verdict on one experiment against its own registered objective.
 * `insufficient_evidence` is a real, common, valuable outcome — notably
 * when the dependent metric simply wasn't reported. Missing is not zero,
 * and missing is never `failure`.
 */
export type OutcomeVerdict = 'winner' | 'failure' | 'neutral' | 'insufficient_evidence';

export interface OutcomeAssessment {
  readonly experimentId: string;
  readonly profileId: string;
  readonly objective: GrowthObjective;
  /** The metric the verdict was actually decided on — always one the objective maps to. */
  readonly decidedOnMetric?: PerformanceMetric;
  readonly verdict: OutcomeVerdict;
  readonly comparison?: ComparisonResult;
  /**
   * Metrics that moved but did NOT decide the verdict. Reported for
   * transparency and future hypothesis generation only — a secondary metric
   * can never rescue or overturn the registered dependent metric's result.
   * See the no-p-hacking rule in the architecture doc.
   */
  readonly exploratoryComparisons: readonly ComparisonResult[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly assessedAt: IsoDateTime;
}

/**
 * One arm-vs-arm comparison within a paired experiment (`pairId`/`variant`
 * on `ExperimentDesign`). A single pair is evidence, never proof — see
 * `SciencePolicy.minimumPairedSample`.
 */
export interface PairedComparison {
  readonly pairId: string;
  readonly profileId: string;
  readonly metric: PerformanceMetric;
  readonly variantA: { readonly experimentId: string; readonly variant: string; readonly value: number };
  readonly variantB: { readonly experimentId: string; readonly variant: string; readonly value: number };
  readonly absoluteDifference: number;
  readonly relativeDifference?: number;
  /** The `experimentId` of the higher-scoring arm, or `null` when they tie. */
  readonly winnerExperimentId: string | null;
  readonly limitations: readonly AnalysisLimitation[];
  readonly createdAt: IsoDateTime;
}

/**
 * One traceable piece of evidence for or against a hypothesis. Exists so a
 * hypothesis is never merely a bare list of experiment ids with no
 * explanation of *why* each one counted.
 */
export interface HypothesisEvidence {
  readonly id: string;
  readonly hypothesisId: string;
  readonly experimentId: string;
  readonly profileId: string;
  readonly comparisonId?: string;
  readonly metric: PerformanceMetric;
  readonly direction: ComparisonDirection;
  readonly effectSize: EffectSize;
  /** Whether this evidence supports the hypothesis. `false` is retained permanently — contradictory evidence is never deleted. */
  readonly supports: boolean;
  readonly measuredAt: IsoDateTime;
  readonly notes?: string;
  readonly sourceIds: readonly string[];
  readonly createdAt: IsoDateTime;
}

/** The outcome of evaluating one hypothesis against its accumulated evidence. */
export interface HypothesisEvaluation {
  readonly hypothesisId: string;
  readonly status: 'proposed' | 'testing' | 'supported' | 'rejected' | 'inconclusive';
  readonly supportingCount: number;
  readonly contradictingCount: number;
  /** Operational confidence, 0..1 — see `computeOperationalConfidence`. Not a statistical probability. */
  readonly confidence: Confidence;
  readonly limitations: readonly AnalysisLimitation[];
  readonly evaluatedAt: IsoDateTime;
}

/** Whether a finding still earns its place, or needs re-testing. */
export type FindingFreshness = 'current' | 'due_for_revalidation' | 'decaying';

export interface RevalidationCandidate {
  readonly subjectType: 'finding' | 'hypothesis';
  readonly subjectId: string;
  readonly profileId?: string;
  readonly freshness: FindingFreshness;
  readonly reason: string;
  readonly lastValidatedAt?: IsoDateTime;
}

/** What an analysis was about. */
export type ScienceSubjectType = 'experiment' | 'hypothesis' | 'profile' | 'pair';

/**
 * A machine-readable analysis result suitable for a future dashboard. Not
 * UI, not prose — a structured record carrying its own limitations and
 * lineage so a reader can always tell how much the conclusion is worth.
 */
export interface ScienceReport {
  readonly id: string;
  readonly subjectType: ScienceSubjectType;
  readonly subjectId: string;
  readonly profileId: string;
  readonly objective?: GrowthObjective;
  readonly metric?: PerformanceMetric;
  readonly baseline?: PerformanceBaseline;
  readonly comparisons: readonly ComparisonResult[];
  readonly evidenceSummary: {
    readonly observationCount: number;
    readonly supportingCount: number;
    readonly contradictingCount: number;
  };
  /** A conservative, deterministically-composed sentence. No LLM, no grand causal prose. */
  readonly conclusion: string;
  readonly verdict?: OutcomeVerdict;
  readonly confidence: Confidence;
  readonly limitations: readonly AnalysisLimitation[];
  /** Ids of every record this report was derived from — observations, comparisons, experiments. */
  readonly lineage: readonly string[];
  readonly createdAt: IsoDateTime;
}

/** Context for emitting a `Finding` — the scope facts the caller knows and the engine must not invent. */
export interface FindingEmissionContext {
  readonly profileId: string;
  readonly platform?: Platform;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly audienceSegmentId?: string;
  readonly accountStage?: AccountStage;
  readonly objective?: GrowthObjective;
  /** Overrides the default profile-level scope. Broader scopes require evidence the caller must actually have. */
  readonly scope?: KnowledgeScope;
}
