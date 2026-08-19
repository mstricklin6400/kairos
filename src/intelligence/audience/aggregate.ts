/**
 * Deterministic audience aggregation helpers — Milestone 4, Step 12. Every
 * function here is pure arithmetic/grouping over data already given to it.
 * No LLM, no embeddings, no clustering, no automated psychological
 * inference: those are explicitly future-milestone work. What lives here is
 * only what can be computed honestly from counts and timestamps.
 */
import type { IsoDateTime } from '../common/types.js';
import type {
  AudienceSignal,
  AudienceSignalType,
  DeclaredAudienceComparison,
  SegmentMetricTotal,
} from './types.js';
import type { PerformanceMetric } from '../performance/types.js';

const UNCLASSIFIED_KEY = 'unclassified';

/** Groups signals by their current `segmentId`, using `'unclassified'` for signals with none. */
export function countSignalsBySegment(signals: readonly AudienceSignal[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const signal of signals) {
    const key = signal.segmentId ?? UNCLASSIFIED_KEY;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Groups signals by `signalType`. */
export function countSignalsByType(signals: readonly AudienceSignal[]): Partial<Record<AudienceSignalType, number>> {
  const counts: Partial<Record<AudienceSignalType, number>> = {};
  for (const signal of signals) {
    counts[signal.signalType] = (counts[signal.signalType] ?? 0) + 1;
  }
  return counts;
}

/** How many signals currently carry no `segmentId` at all. */
export function countUnclassifiedSignals(signals: readonly AudienceSignal[]): number {
  return signals.filter((s) => s.segmentId === undefined).length;
}

/**
 * Folds one new observation's timestamp into an existing (first, last) pair.
 * Pass `existing: null` for a segment's very first signal.
 */
export function deriveObservedTimestamps(
  existing: { readonly firstObservedAt: IsoDateTime; readonly lastObservedAt: IsoDateTime } | null,
  observedAt: IsoDateTime,
): { firstObservedAt: IsoDateTime; lastObservedAt: IsoDateTime } {
  if (!existing) return { firstObservedAt: observedAt, lastObservedAt: observedAt };
  return {
    firstObservedAt: observedAt < existing.firstObservedAt ? observedAt : existing.firstObservedAt,
    lastObservedAt: observedAt > existing.lastObservedAt ? observedAt : existing.lastObservedAt,
  };
}

/** One synthetic per-signal metric reading, for building `SegmentMetricTotal[]` deterministically from provided (not live) data. */
export interface SyntheticMetricObservation {
  readonly metric: PerformanceMetric;
  readonly value: number;
}

/**
 * Sums synthetic metric observations into `SegmentMetricTotal[]`, one entry
 * per distinct metric. `profileTotals`, when given, fills in
 * `shareOfProfileTotal` — omitted (never guessed) for a metric with no
 * profile-wide total or a zero denominator.
 */
export function aggregateSegmentMetricTotals(
  observations: readonly SyntheticMetricObservation[],
  profileTotals?: Partial<Record<PerformanceMetric, number>>,
): SegmentMetricTotal[] {
  const totals = new Map<PerformanceMetric, number>();
  for (const obs of observations) {
    totals.set(obs.metric, (totals.get(obs.metric) ?? 0) + obs.value);
  }
  return [...totals.entries()].map(([metric, total]) => {
    const profileTotal = profileTotals?.[metric];
    const shareOfProfileTotal = profileTotal && profileTotal > 0 ? total / profileTotal : undefined;
    return { metric, total, ...(shareOfProfileTotal !== undefined ? { shareOfProfileTotal } : {}) };
  });
}

/**
 * Declared-vs-observed comparison, computed honestly. As of Milestone 4,
 * Kairos has no semantic-matching capability between a declared audience
 * description and observed segment characteristics — see the module doc on
 * `AudienceComparisonState` — so this always evaluates to
 * `insufficient_evidence` today. The other three states exist in the type
 * for a future milestone that adds real declared-vs-observed matching; this
 * function must not guess at them in the meantime.
 */
export function compareDeclaredToObserved(
  input: { readonly observedSegmentCount: number; readonly totalSignalCount: number },
  now: IsoDateTime,
): DeclaredAudienceComparison {
  return {
    state: 'insufficient_evidence',
    evaluatedAt: now,
    observedSegmentCount: input.observedSegmentCount,
    totalSignalCount: input.totalSignalCount,
    notes:
      'No semantic declared-vs-observed matching exists yet — this state reflects evidence volume only, not alignment.',
  };
}
