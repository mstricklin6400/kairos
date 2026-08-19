/**
 * Pure, deterministic helpers for the Adaptive Strategy Engine. No I/O, no
 * AI, no randomness — the same inputs and policy always produce the same
 * output, which is what makes a recommendation defensible after the fact.
 */
import type { GrowthObjective } from '../common/types.js';
import type { Experiment } from '../science/types.js';
import type { SocialProfile } from '../profiles/types.js';
import type { PerformanceMetric } from '../performance/types.js';
import { resolveObjectiveMetrics } from '../science/engine.js';
import type {
  InformationGainScore,
  PillarAllocation,
  StrategyConstraint,
  StrategyPolicy,
} from './types.js';

/**
 * Derives every constraint that applies to a profile right now, from the
 * profile itself and its in-flight experiments. Deterministic: constraints
 * are read off stored configuration, never guessed.
 *
 * The `active_experiment` constraint is the one that protects experimental
 * validity — while a controlled test is running, its `controlVariable` and
 * `testVariables` are locked, so the engine cannot recommend changing the
 * very things the experiment is measuring.
 */
export function deriveConstraints(
  profile: SocialProfile,
  activeExperiments: readonly Experiment[],
): StrategyConstraint[] {
  const constraints: StrategyConstraint[] = [];

  const capacity = profile.strategy.postingFrequency;
  if (capacity.postsPerDay !== undefined || capacity.postsPerWeek !== undefined) {
    constraints.push({
      id: `con_capacity_${profile.id}`,
      profileId: profile.id,
      source: 'posting_capacity',
      description: `This profile reports capacity for ${capacity.postsPerDay ?? '—'} posts/day, ${capacity.postsPerWeek ?? '—'} posts/week.`,
      maxPostsPerDay: capacity.postsPerDay,
      maxPostsPerWeek: capacity.postsPerWeek,
    });
  }

  const styleConstraints = profile.identity.styleConstraints ?? [];
  if (styleConstraints.length > 0) {
    constraints.push({
      id: `con_brand_${profile.id}`,
      profileId: profile.id,
      source: 'brand_rule',
      description: `Brand and content rules the profile declared at onboarding: ${styleConstraints.join('; ')}.`,
      forbiddenTopics: styleConstraints,
    });
  }

  for (const experiment of activeExperiments) {
    const locked = [
      ...(experiment.design.controlVariable ? [experiment.design.controlVariable] : []),
      ...experiment.design.testVariables,
    ];
    if (locked.length === 0) continue;
    constraints.push({
      id: `con_experiment_${experiment.id}`,
      profileId: profile.id,
      source: 'active_experiment',
      description: `Experiment ${experiment.id} is in flight; its controlled and tested variables must not be changed while it runs.`,
      lockedVariables: locked,
      sourceExperimentId: experiment.id,
    });
  }

  if (profile.monetization.offers.filter((o) => o.active).length === 0) {
    constraints.push({
      id: `con_offers_${profile.id}`,
      profileId: profile.id,
      source: 'offer_availability',
      description: 'This profile has no active offers, so offer and conversion tests cannot be run yet.',
    });
  }

  return constraints;
}

/** Every content-DNA variable currently locked by an in-flight experiment. */
export function lockedVariables(constraints: readonly StrategyConstraint[]): Set<string> {
  const locked = new Set<string>();
  for (const constraint of constraints) {
    for (const variable of constraint.lockedVariables ?? []) locked.add(variable);
  }
  return locked;
}

/** Whether a proposed action would disturb a variable an active experiment is holding still. */
export function violatesActiveExperiment(
  proposedVariables: readonly string[],
  constraints: readonly StrategyConstraint[],
): boolean {
  const locked = lockedVariables(constraints);
  return proposedVariables.some((v) => locked.has(v));
}

/** Whether a topic is ruled out by the profile's declared brand/compliance rules. */
export function isTopicForbidden(topic: string, constraints: readonly StrategyConstraint[]): boolean {
  const needle = topic.trim().toLowerCase();
  if (!needle) return false;
  return constraints.some((c) =>
    (c.forbiddenTopics ?? []).some((forbidden) => {
      const rule = forbidden.trim().toLowerCase();
      return rule.length > 0 && (rule.includes(needle) || needle.includes(rule));
    }),
  );
}

/** The tightest posting-capacity ceiling across all constraints, if any. */
export function postingCapacityCeiling(constraints: readonly StrategyConstraint[]): {
  maxPostsPerDay?: number;
  maxPostsPerWeek?: number;
} {
  const perDay = constraints.map((c) => c.maxPostsPerDay).filter((v): v is number => v !== undefined);
  const perWeek = constraints.map((c) => c.maxPostsPerWeek).filter((v): v is number => v !== undefined);
  return {
    ...(perDay.length > 0 ? { maxPostsPerDay: Math.min(...perDay) } : {}),
    ...(perWeek.length > 0 ? { maxPostsPerWeek: Math.min(...perWeek) } : {}),
  };
}

/**
 * Whether a proposed posting rate exceeds what the profile says it can
 * sustain. Exceeding capacity isn't forbidden outright — but it must be
 * surfaced as an experiment that requires a capacity change, never slipped
 * in as a routine recommendation.
 */
export function exceedsCapacity(postsPerDay: number, constraints: readonly StrategyConstraint[]): boolean {
  const ceiling = postingCapacityCeiling(constraints);
  return ceiling.maxPostsPerDay !== undefined && postsPerDay > ceiling.maxPostsPerDay;
}

/**
 * How much resolving one uncertainty is worth to THIS profile.
 *
 * `uncertainty` peaks at maximum ambiguity: confidence 0.5 scores 1.0,
 * while both 0.0 (confidently wrong) and 1.0 (confidently right) score 0 —
 * there is nothing left to learn at either extreme.
 *
 * `objectiveRelevance` is what separates "weak evidence that matters" from
 * "weak evidence that doesn't": a question about the profile's own
 * objective metric is worth resolving; the same uncertainty about an
 * unrelated metric is not.
 */
export function computeInformationGain(input: {
  readonly subjectType: InformationGainScore['subjectType'];
  readonly subjectId: string;
  readonly confidence: number;
  readonly dependentMetric?: PerformanceMetric;
  readonly objective: GrowthObjective;
  readonly objectiveMetricsOverride?: readonly PerformanceMetric[];
}): InformationGainScore {
  const uncertainty = 1 - Math.abs(input.confidence - 0.5) * 2;

  const objectiveMetrics = input.objectiveMetricsOverride ?? resolveObjectiveMetrics(input.objective);
  const objectiveRelevance =
    input.dependentMetric === undefined ? 0.5 : objectiveMetrics.includes(input.dependentMetric) ? 1 : 0.2;

  const score = uncertainty * objectiveRelevance;
  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    uncertainty,
    objectiveRelevance,
    score,
    rationale:
      objectiveRelevance === 1
        ? `Resolving this would directly inform the profile's ${input.objective} objective.`
        : objectiveRelevance === 0.5
          ? 'No dependent metric is recorded, so relevance to the objective is unclear.'
          : `This question does not bear directly on the profile's ${input.objective} objective.`,
  };
}

/**
 * Rebalances content-pillar allocations toward evidence, under strict
 * bounds. Three protections, all deliberate:
 *
 *  1. No pillar moves more than `maximumAllocationShiftPerPlan` in one plan
 *     — strategy should not whipsaw.
 *  2. Thin evidence (below `thinEvidenceSampleThreshold`) is damped to half
 *     effect — a single good post must not rewrite the content mix.
 *  3. No pillar falls below `minimumPillarAllocation` — a pillar starved to
 *     zero can never generate the evidence that would rehabilitate it,
 *     which would make the decision self-fulfilling.
 *
 * Shares are renormalized to sum to 1.
 */
export function recommendContentAllocation(input: {
  readonly currentAllocations: readonly { pillarId: string; share: number }[];
  readonly evidenceByPillar: Readonly<Record<string, { direction: 'up' | 'down'; sampleSize: number }>>;
  readonly policy: StrategyPolicy;
}): PillarAllocation[] {
  const { currentAllocations, evidenceByPillar, policy } = input;
  if (currentAllocations.length === 0) return [];

  const proposed = currentAllocations.map(({ pillarId, share }) => {
    const evidence = evidenceByPillar[pillarId];
    if (!evidence) {
      return { pillarId, previousShare: share, raw: share, reason: 'No new evidence for this pillar; share unchanged.' };
    }
    const damping = evidence.sampleSize < policy.thinEvidenceSampleThreshold ? 0.5 : 1;
    const magnitude = policy.maximumAllocationShiftPerPlan * damping;
    const delta = evidence.direction === 'up' ? magnitude : -magnitude;
    const raw = Math.max(policy.minimumPillarAllocation, share + delta);
    return {
      pillarId,
      previousShare: share,
      raw,
      reason:
        damping < 1
          ? `Evidence points ${evidence.direction}, but the sample (${evidence.sampleSize}) is thin, so the shift is damped.`
          : `Evidence points ${evidence.direction} on a sample of ${evidence.sampleSize}.`,
    };
  });

  const total = proposed.reduce((sum, p) => sum + p.raw, 0);
  return proposed.map((p) => ({
    pillarId: p.pillarId,
    share: total > 0 ? p.raw / total : p.previousShare,
    previousShare: p.previousShare,
    reason: p.reason,
  }));
}

/**
 * The operational priority score for one recommendation. Transparent and
 * additive so any ranking can be explained term by term. Explicitly NOT a
 * probability.
 */
export function computePriorityScore(input: {
  /** Does this act on a metric the profile's objective actually cares about? */
  readonly objectiveRelevant: boolean;
  readonly confidence: number;
  readonly informationGain: number;
  /** Freshness penalty for acting on stale evidence, 0..1. */
  readonly stalenessPenalty?: number;
  /** Penalty for a pattern that has repeatedly failed for this profile, 0..1. */
  readonly failurePenalty?: number;
}): number {
  const objectiveTerm = input.objectiveRelevant ? 0.4 : 0.05;
  const confidenceTerm = input.confidence * 0.3;
  const gainTerm = input.informationGain * 0.3;
  const penalty = (input.stalenessPenalty ?? 0) + (input.failurePenalty ?? 0);
  return Math.max(0, objectiveTerm + confidenceTerm + gainTerm - penalty);
}
