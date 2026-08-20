/**
 * Pure composition helpers for the Social Prescription Engine.
 * Deterministic, no I/O, no AI.
 */
import { METRIC_MEASUREMENT_TIER, type MeasurementTier, type PerformanceMetric } from '../performance/types.js';
import { daysBetween } from '../science/statistics.js';
import type { GrowthObjective } from '../common/types.js';
import type { Finding } from '../science/types.js';
import type { TransferAssessment } from '../transfer/types.js';
import type { EvidenceClass, PrescriptionPolicy } from './types.js';

/**
 * The funnel, shallow → deep. Used to compare where a piece of evidence
 * sits against where the profile's objective needs it to sit.
 *
 * This is a DEPTH ordering for objective-matching only. It is emphatically
 * not a ranking of evidence quality — §8's rule stands: a deeper metric is
 * not better evidence, it is evidence about a different question.
 */
const TIER_DEPTH: Readonly<Record<MeasurementTier, number>> = {
  attention: 1,
  engagementSignal: 2,
  conversation: 2,
  amplification: 2,
  growth: 3,
  intent: 4,
  conversion: 5,
  customerValue: 6,
};

/** The funnel depth a given objective actually cares about. */
const OBJECTIVE_DEPTH: Readonly<Record<GrowthObjective, number>> = {
  reach: 1,
  amplification: 2,
  conversation: 2,
  followers: 3,
  traffic: 4,
  lead: 5,
  sale: 5,
  revenue: 6,
  retention: 6,
};

export function objectiveDepth(objective: GrowthObjective): number {
  return OBJECTIVE_DEPTH[objective];
}

export function metricDepth(metric: PerformanceMetric): number {
  return TIER_DEPTH[METRIC_MEASUREMENT_TIER[metric]];
}

/**
 * Whether a piece of evidence measured at `metric` actually speaks to
 * `objective`. Evidence at or below the objective's depth is on-topic;
 * evidence shallower than it answers a different question.
 *
 * A reply-rate win is real evidence — just not evidence that anyone bought
 * anything. For a revenue objective this returns `false`, and the caller
 * deprioritizes rather than discards.
 */
export function servesObjective(metric: PerformanceMetric, objective: GrowthObjective): boolean {
  return metricDepth(metric) >= objectiveDepth(objective);
}

/**
 * Classifies a first-party finding into an evidence class. Only a
 * `validated` finding at or above the policy threshold earns
 * `validated_on_profile`.
 */
export function classifyFinding(finding: Finding, policy: PrescriptionPolicy): EvidenceClass {
  if (finding.status === 'validated' && finding.confidence >= policy.validatedConfidenceThreshold) {
    return 'validated_on_profile';
  }
  if (finding.status === 'validated' || finding.status === 'promising') return 'promising_on_profile';
  // Rejected and decaying findings inform "what not to do", not "what works".
  return 'unknown';
}

/**
 * Classifies a transfer assessment. Transferred evidence can never be
 * presented as first-party validation — the strongest class it reaches is
 * `comparable_profiles`, and weak transfers degrade to `research_informed`.
 */
export function classifyTransfer(assessment: TransferAssessment): EvidenceClass {
  switch (assessment.relevance) {
    case 'directly_applicable':
    case 'strongly_relevant':
    case 'moderately_relevant':
      return 'comparable_profiles';
    case 'weakly_relevant':
    case 'hypothesis_only':
      return 'research_informed';
    default:
      return 'unknown';
  }
}

/**
 * Ordering of evidence classes for presentation — first-party evidence
 * leads, unknowns trail.
 *
 * Ordering for DISPLAY is not the same as collapsing classes into a score:
 * each recommendation still carries and shows its own class.
 */
const CLASS_RANK: Readonly<Record<EvidenceClass, number>> = {
  validated_on_profile: 6,
  promising_on_profile: 5,
  comparable_profiles: 4,
  experimental: 3,
  research_informed: 2,
  unknown: 1,
};

export function evidenceClassRank(evidenceClass: EvidenceClass): number {
  return CLASS_RANK[evidenceClass];
}

/**
 * Operational priority for one recommendation.
 *
 * Objective depth is the commercially important term: with
 * `enforceObjectiveDepth`, evidence that doesn't reach the objective's depth
 * is penalized so a high-engagement recommendation cannot lead a revenue
 * prescription. Repeated failure to advance the objective compounds it.
 */
export function computeRecommendationPriority(input: {
  readonly evidenceClass: EvidenceClass;
  readonly confidence?: number;
  readonly servesObjective: boolean;
  readonly isStale: boolean;
  readonly repeatedObjectiveFailures?: number;
  readonly policy: PrescriptionPolicy;
}): number {
  const classTerm = evidenceClassRank(input.evidenceClass) / 6;
  const confidenceTerm = (input.confidence ?? 0.3) * 0.3;

  let objectiveTerm = 0.4;
  if (input.policy.enforceObjectiveDepth && !input.servesObjective) {
    objectiveTerm = 0.05;
  }

  const stalenessPenalty = input.isStale ? 0.2 : 0;
  const failurePenalty = Math.min(0.4, (input.repeatedObjectiveFailures ?? 0) * 0.2);

  return Math.max(0, classTerm * 0.4 + confidenceTerm + objectiveTerm - stalenessPenalty - failurePenalty);
}

/** Whether evidence last validated at `lastValidatedAt` is stale as of `now`. */
export function isStale(lastValidatedAt: string | undefined, now: string, policy: PrescriptionPolicy): boolean {
  if (!lastValidatedAt) return false;
  return daysBetween(lastValidatedAt, now) > policy.stalenessDays;
}

/** Human-readable label for an evidence class. Kept conservative — no certainty language. */
export function describeEvidenceClass(evidenceClass: EvidenceClass): string {
  switch (evidenceClass) {
    case 'validated_on_profile':
      return 'Validated on your profile';
    case 'promising_on_profile':
      return 'Promising on your profile, not yet validated';
    case 'comparable_profiles':
      return 'Supported by comparable profiles, not yet tested here';
    case 'research_informed':
      return 'Research-informed — a hypothesis, not a result';
    case 'experimental':
      return 'Proposed as an experiment; no result yet';
    case 'unknown':
    default:
      return 'Unknown — no evidence either way';
  }
}

/** Set difference by id, for version diffing. */
export function diffIds(previous: readonly string[], current: readonly string[]): { added: string[]; removed: string[] } {
  const before = new Set(previous);
  const after = new Set(current);
  return {
    added: current.filter((id) => !before.has(id)),
    removed: previous.filter((id) => !after.has(id)),
  };
}
