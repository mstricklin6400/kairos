/**
 * Adaptive Strategy Engine domain types — Milestone 8.
 *
 * The division of labour this module completes:
 *
 *   SCIENCE ENGINE    — "What did the evidence show?"
 *   ADAPTIVE STRATEGY — "What should this profile do next?"
 *   CREATOROS         — "Execute the approved action."
 *
 * This module answers only the middle question, for ONE profile at a time:
 * given this objective, platform, niche, audience, account stage, evidence
 * and active experiments — what is the most justified next action?
 *
 * Nothing here publishes, generates content, calls an LLM, or executes
 * anything. A recommendation is a proposal; execution is always a separate,
 * later, human-approved step.
 *
 * UNKNOWN IS A VALID ANSWER. When evidence is insufficient the engine
 * recommends `run_experiment`, `collect_more_evidence` or `do_nothing_yet`.
 * It never fabricates "this is what works."
 */
import type {
  Confidence,
  GrowthObjective,
  IsoDateTime,
} from '../common/types.js';
import type { ExperimentMode } from '../profiles/types.js';
import type { AnalysisLimitation } from '../science/analysisTypes.js';

/**
 * What kind of move a recommendation proposes. Deliberately broader than
 * "make a post": the right next move is frequently to gather evidence, or
 * to change nothing at all.
 */
export type NextBestAction =
  | 'run_experiment'
  | 'repeat_validated_pattern'
  | 'revalidate_finding'
  | 'explore_new_pattern'
  | 'collect_more_evidence'
  | 'target_segment'
  | 'deprioritize_pattern'
  | 'adjust_content_mix'
  | 'test_offer'
  | 'test_cta'
  | 'test_hook'
  | 'test_format'
  | 'do_nothing_yet';

/** The broad category a recommendation falls into, for grouping and filtering. */
export type RecommendationType =
  | 'content'
  | 'experiment'
  | 'revalidation'
  | 'audience'
  | 'offer'
  | 'posting_cadence'
  | 'engagement'
  | 'conversion'
  | 'research'
  | 'wait_for_evidence'
  | 'other';

/**
 * A recommendation's lifecycle. `proposed` is where everything starts and
 * where everything stays until a human moves it — the engine never
 * self-approves and never executes.
 */
export type RecommendationStatus =
  | 'proposed'
  | 'approved'
  | 'active'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'superseded';

/**
 * Why a recommendation exists, in machine-readable form. This is what makes
 * "why does Kairos recommend this?" answerable — a future Social Genome
 * surface reads this, not a generated explanation.
 *
 * Every id here points at a real stored record. Nothing is invented.
 */
export interface RecommendationBasis {
  readonly findingIds: readonly string[];
  readonly segmentFindingIds: readonly string[];
  readonly hypothesisIds: readonly string[];
  readonly experimentIds: readonly string[];
  readonly strategyPrincipleIds: readonly string[];
  readonly strategyClaimIds: readonly string[];
  readonly audienceSegmentIds: readonly string[];
  /** Constraint ids that shaped or restricted this recommendation. */
  readonly constraintIds: readonly string[];
  /** Plain-language summary of the reasoning, composed deterministically — no LLM. */
  readonly rationale: string;
}

/**
 * One proposed next move for one profile.
 *
 * `confidence` is inherited from the underlying evidence (Science Engine
 * operational confidence) — it is NOT a probability that the action will
 * succeed, and is never presented as one. `priorityScore` is likewise an
 * operational ranking number, not a statistical quantity.
 */
export interface StrategyRecommendation {
  readonly id: string;
  readonly profileId: string;
  readonly objective: GrowthObjective;
  readonly recommendationType: RecommendationType;
  readonly action: NextBestAction;
  readonly status: RecommendationStatus;
  /** Operational ranking score, higher is more urgent. Not a probability. */
  readonly priorityScore: number;
  /** One conservative sentence describing what to do. Never final copy. */
  readonly reason: string;
  readonly basis: RecommendationBasis;
  readonly confidence: Confidence;
  readonly limitations: readonly AnalysisLimitation[];
  /** The audience segment this action targets, when evidence supports one. Never inferred without it. */
  readonly audienceSegmentId?: string;
  readonly createdAt: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
  readonly policyVersion: string;
  readonly schemaVersion: number;
}

/**
 * How aggressively this profile should explore vs. exploit. Reuses the
 * existing `ExperimentMode` vocabulary (`conservative` | `balanced` |
 * `discovery`) rather than inventing a second one.
 *
 * The split values below are CONFIGURABLE OPERATIONAL CHOICES, not
 * scientific truths — the same caveat that governs `SciencePolicy`.
 */
export interface StrategyPolicy {
  /** Share of recommended capacity spent on exploration, per experiment mode. 0..1. */
  readonly explorationRatio: Readonly<Record<ExperimentMode, number>>;
  /** A finding needs at least this confidence before `repeat_validated_pattern` is offered. */
  readonly minimumConfidenceToExploit: number;
  /** Maximum absolute change to any single pillar's allocation share in one plan. Prevents whiplash from thin evidence. */
  readonly maximumAllocationShiftPerPlan: number;
  /** No pillar may fall below this share — preserves exploration capacity and avoids starving a pillar on thin data. */
  readonly minimumPillarAllocation: number;
  /** Evidence count below which allocation shifts are damped rather than applied in full. */
  readonly thinEvidenceSampleThreshold: number;
  /** How many times a pattern may fail for this profile before it is actively deprioritized. */
  readonly failureMemoryThreshold: number;
  /** Recommendations older than this are `expired`. */
  readonly recommendationTtlDays: number;
  /** Identifies the ruleset that produced a plan, so old plans stay interpretable. */
  readonly policyVersion: string;
}

/**
 * Conservative operational defaults. As with `SciencePolicy`: starting
 * points chosen for safety, not laws of nature. Every field is overrideable.
 */
export const DEFAULT_STRATEGY_POLICY: StrategyPolicy = {
  explorationRatio: { conservative: 0.2, balanced: 0.35, discovery: 0.6 },
  minimumConfidenceToExploit: 0.7,
  maximumAllocationShiftPerPlan: 0.1,
  minimumPillarAllocation: 0.05,
  thinEvidenceSampleThreshold: 5,
  failureMemoryThreshold: 2,
  recommendationTtlDays: 30,
  policyVersion: 'adaptive-v1',
};

/** Where a constraint came from, so a blocked recommendation can explain itself. */
export type StrategyConstraintSource =
  | 'brand_rule'
  | 'posting_capacity'
  | 'topic_avoidance'
  | 'active_experiment'
  | 'platform_capability'
  | 'offer_availability'
  | 'audience_restriction'
  | 'compliance';

/**
 * A boundary the engine must respect. Constraints are derived
 * deterministically from the profile and its active experiments — they are
 * not guesses, and a recommendation that would violate one is either
 * reshaped or not made.
 */
export interface StrategyConstraint {
  readonly id: string;
  readonly profileId: string;
  readonly source: StrategyConstraintSource;
  readonly description: string;
  /**
   * Content-DNA variables that must NOT be varied right now — the mechanism
   * that protects an in-flight controlled experiment from having its
   * controlled variables changed underneath it.
   */
  readonly lockedVariables?: readonly string[];
  /** Topics/phrases the profile has ruled out. */
  readonly forbiddenTopics?: readonly string[];
  /** Ceiling on recommended posts per day, from the profile's stated capacity. */
  readonly maxPostsPerDay?: number;
  readonly maxPostsPerWeek?: number;
  readonly sourceExperimentId?: string;
}

/**
 * How much resolving one uncertainty is worth. An operational, explainable
 * score — deliberately not an information-theoretic quantity, and never
 * described as one.
 *
 * Two questions can both have weak evidence; the one whose answer would
 * actually change what this profile does is worth more.
 */
export interface InformationGainScore {
  readonly subjectType: 'hypothesis' | 'finding' | 'principle';
  readonly subjectId: string;
  /** 0..1 — how uncertain Kairos currently is. Peaks at maximum ambiguity. */
  readonly uncertainty: number;
  /** 0..1 — how much this profile's objective depends on the answer. */
  readonly objectiveRelevance: number;
  /** 0..1 — the product, the operational "worth resolving" score. */
  readonly score: number;
  readonly rationale: string;
}

/** A recommended share of output for one content pillar. */
export interface PillarAllocation {
  readonly pillarId: string;
  /** Recommended share of output, 0..1. */
  readonly share: number;
  /** The share this replaces, so the delta is always visible. */
  readonly previousShare: number;
  readonly reason: string;
}

/**
 * The recommended split of output between exploiting known-good approaches
 * and exploring uncertain ones. Derived from the profile's `experimentMode`
 * via `StrategyPolicy.explorationRatio`.
 */
export interface ExperimentAllocation {
  readonly experimentMode: ExperimentMode;
  readonly explorationShare: number;
  readonly exploitationShare: number;
  readonly reason: string;
}

/**
 * Something Kairos explicitly does not know for this profile. Surfacing
 * unknowns is a feature: a plan that lists what it cannot yet answer is
 * more honest — and more useful — than one that quietly fills the gaps.
 */
export interface StrategyUnknown {
  readonly topic: string;
  readonly reason: string;
  readonly suggestedAction: NextBestAction;
}

/**
 * The current strategy snapshot for one profile. A point-in-time
 * recommendation set, explicitly NOT permanent truth: superseded plans are
 * retained (see `supersedesPlanId`) so the reasoning behind an earlier
 * decision survives the decision changing.
 */
export interface AdaptiveStrategyPlan {
  readonly id: string;
  readonly profileId: string;
  readonly objective: GrowthObjective;
  readonly recommendations: readonly StrategyRecommendation[];
  readonly contentAllocation: readonly PillarAllocation[];
  readonly experimentAllocation: ExperimentAllocation;
  /** Findings/hypotheses the Science Engine flagged as needing a re-test. */
  readonly revalidationItems: readonly string[];
  readonly unknowns: readonly StrategyUnknown[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly constraints: readonly StrategyConstraint[];
  /** The plan this one replaces. The earlier plan is never deleted. */
  readonly supersedesPlanId?: string;
  readonly version: number;
  readonly createdAt: IsoDateTime;
  readonly policyVersion: string;
  readonly schemaVersion: number;
}
