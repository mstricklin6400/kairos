/**
 * The Science Engine's vocabulary: experiments, their results, the hypotheses
 * they test and the findings they produce.
 *
 * Milestone 1 ships the nouns. No analysis, scoring or lifecycle logic runs
 * yet — and nothing here executes anything. CreatorOS publishes; an Experiment
 * only records what was published, why, and what came back.
 */
import type {
  AccountStage,
  Confidence,
  ContentTone,
  ContentFormat,
  ControversyLevel,
  CtaType,
  EmotionalDriver,
  GrowthObjective,
  HookFamily,
  IsoDateTime,
  KnowledgeScope,
  KnowledgeSourceType,
  LengthClass,
  Platform,
} from '../common/types.js';
import type { PerformanceMetric } from '../performance/types.js';

/**
 * The structured description of what a post actually *was*. This is what makes
 * two posts comparable, and therefore what makes learning possible at all.
 */
export interface ContentDna {
  readonly topic: string;
  readonly subtopic?: string;
  readonly hookFamily: HookFamily;
  readonly format: ContentFormat;
  readonly tone: ContentTone;
  readonly lengthClass: LengthClass;
  readonly emotionalDriver?: EmotionalDriver;
  readonly controversyLevel?: ControversyLevel;
  readonly ctaType?: CtaType;
}

/** How this experiment is constructed as a test rather than just a post. */
export interface ExperimentDesign {
  readonly hypothesisId?: string;
  /** Arm label within a paired test, e.g. `A` / `B` / `control`. */
  readonly variant?: string;
  /** Links counterpart arms so they are compared to each other, not to noise. */
  readonly pairId?: string;
  /** The one thing deliberately held constant across the pair. */
  readonly controlVariable?: string;
  /** The things deliberately varied. Empty means observational, not a test. */
  readonly testVariables: readonly string[];
}

/**
 * The hand-off boundary. Kairos records identifiers; CreatorOS owns the act of
 * scheduling and publishing.
 */
export interface ExperimentExecution {
  readonly scheduledAt?: IsoDateTime;
  readonly publishedAt?: IsoDateTime;
  /** CreatorOS post id, once CreatorOS has one. */
  readonly creatorOsPostId?: string;
}

/**
 * What came back. Every field is optional because no platform exposes every
 * metric, and a missing metric must stay distinguishable from a zero.
 *
 * Business metrics (`leads`, `sales`, `revenue`) are trackable but never
 * required.
 */
export interface ExperimentResult {
  readonly impressions?: number;
  readonly views?: number;
  readonly likes?: number;
  readonly replies?: number;
  readonly comments?: number;
  readonly reposts?: number;
  readonly shares?: number;
  readonly saves?: number;
  readonly bookmarks?: number;
  readonly profileVisits?: number;
  readonly clicks?: number;
  readonly followersGained?: number;
  readonly leads?: number;
  readonly sales?: number;
  readonly revenue?: number;
  /** ISO 4217, required in practice whenever `revenue` is set. */
  readonly currency?: string;
  readonly measuredAt?: IsoDateTime;
}

/** One deliberate, described publish whose purpose is to produce evidence. */
export interface Experiment {
  readonly id: string;
  readonly profileId: string;
  readonly platform: Platform;
  readonly niche: string;
  readonly subNiche?: string;
  readonly audienceSegmentId?: string;
  readonly objective: GrowthObjective;
  readonly contentDna: ContentDna;
  readonly design: ExperimentDesign;
  readonly execution: ExperimentExecution;
  /** Absent until measurement has happened. */
  readonly results?: ExperimentResult;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * `inconclusive` is a real outcome and is deliberately distinct from
 * `rejected` — "we could not tell" is not "it is false".
 */
export type HypothesisStatus =
  | 'proposed'
  | 'testing'
  | 'supported'
  | 'rejected'
  | 'inconclusive';

/**
 * A testable claim: one independent variable, one dependent metric, explicit
 * controls, an explicit scope.
 *
 * Supporting *and* contradicting experiments are both tracked. A hypothesis
 * that only records its supporters is a belief system, not science.
 */
export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly scope: KnowledgeScope;
  readonly profileId?: string;
  readonly platform?: Platform;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly audienceSegmentId?: string;
  readonly objective?: GrowthObjective;
  /** What is being manipulated, e.g. `hookFamily`. */
  readonly independentVariable: string;
  /** What is expected to move as a result. */
  readonly dependentMetric: PerformanceMetric;
  /** What is held steady so the result means something. */
  readonly controlVariables: readonly string[];
  readonly status: HypothesisStatus;
  readonly confidence: Confidence;
  readonly source: KnowledgeSourceType;
  readonly supportingExperimentIds: readonly string[];
  readonly contradictingExperimentIds: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly lastTestedAt?: IsoDateTime;
}

/**
 * How much something actually moved.
 *
 * Deliberately not a bare number: `0.31` alone is ambiguous. Naming the metric
 * and distinguishing absolute from relative change makes
 * `{ metric: 'replies', relativeChange: 0.31 }` unambiguously "about +31%
 * replies".
 */
export interface EffectSize {
  readonly metric: PerformanceMetric;
  /** Raw difference, in the metric's own units. */
  readonly absoluteChange?: number;
  /** Proportional difference — `0.31` means +31%, `-0.2` means −20%. */
  readonly relativeChange?: number;
  /** Unit for `absoluteChange` where it is not self-evident, e.g. `USD`. */
  readonly unit?: string;
}

/** `decaying` exists because platforms change and knowledge perishes. */
export type FindingStatus = 'promising' | 'validated' | 'rejected' | 'decaying';

/**
 * What survives testing: a statement plus the evidence that earns it.
 *
 * Findings are scoped, not universal. The same statement may be `validated` at
 * profile scope and `rejected` at platform scope, and both records are correct.
 */
export interface Finding {
  readonly id: string;
  readonly statement: string;
  readonly scope: KnowledgeScope;
  readonly platform?: Platform;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly profileId?: string;
  readonly audienceSegmentId?: string;
  readonly accountStage?: AccountStage;
  readonly objective?: GrowthObjective;
  readonly sampleSize: number;
  readonly confidence: Confidence;
  readonly effectSize?: EffectSize;
  readonly status: FindingStatus;
  readonly sourceExperimentIds: readonly string[];
  readonly createdAt: IsoDateTime;
  /** Age is half of trust — a finding nobody has re-tested is decaying. */
  readonly lastValidatedAt: IsoDateTime;
}
