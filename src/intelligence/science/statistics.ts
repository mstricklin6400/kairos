/**
 * Pure statistical helpers for the Science Engine. Deterministic, no I/O,
 * no AI. Deliberately simple: median-first because social results are
 * heavy-tailed and one viral post must not redefine "normal."
 */
import type { EffectSize } from './types.js';
import type { PerformanceMetric } from '../performance/types.js';

/**
 * The median — the Science Engine's primary measure of central tendency.
 * A single 100x outlier moves the median barely at all while dragging the
 * mean far from anything typical, which is exactly why baselines are built
 * on this and not on the average.
 */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Sample standard deviation (n−1). Undefined below two values: a single
 * observation has no spread, and reporting `0` would falsely imply
 * certainty.
 */
export function standardDeviation(values: readonly number[]): number | undefined {
  if (values.length < 2) return undefined;
  const avg = mean(values)!;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Relative change from `baseline` to `observed`. Returns `undefined` rather
 * than `Infinity`/`NaN` when the baseline is zero — a percentage change
 * from nothing is genuinely undefined, and emitting a non-finite number
 * would poison every downstream threshold comparison.
 */
export function relativeChange(observed: number, baseline: number): number | undefined {
  if (baseline === 0 || !Number.isFinite(baseline) || !Number.isFinite(observed)) return undefined;
  return (observed - baseline) / baseline;
}

/** Builds an `EffectSize`, omitting `relativeChange` when it is undefined rather than emitting a non-finite value. */
export function buildEffectSize(metric: PerformanceMetric, observed: number, baseline: number): EffectSize {
  const relative = relativeChange(observed, baseline);
  return {
    metric,
    absoluteChange: observed - baseline,
    ...(relative !== undefined ? { relativeChange: relative } : {}),
  };
}

/** Clamps to the 0..1 range the `Confidence` type expects. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * An OPERATIONAL confidence score, 0..1 — deliberately not a statistical
 * probability, and documented as such everywhere it surfaces. Kairos does
 * not implement Bayesian inference, so it does not claim to.
 *
 * The rules, all deterministic and inspectable:
 *  - Evidence volume: more total evidence raises the ceiling, with
 *    diminishing returns (saturating around 10 pieces).
 *  - Consistency: the share of evidence pointing the same way. Evidence
 *    split 6/5 is near-worthless however plentiful; 11/0 is strong.
 *  - Effect magnitude: a large average effect earns a modest bonus.
 *
 * Confidence must be able to FALL. Adding contradictory evidence lowers
 * consistency, which lowers the score — a hypothesis that accumulates
 * counter-evidence does not keep its old confidence just because it once
 * had it.
 */
export function computeOperationalConfidence(input: {
  readonly supportingCount: number;
  readonly contradictingCount: number;
  readonly averageAbsoluteRelativeEffect?: number;
}): number {
  const total = input.supportingCount + input.contradictingCount;
  if (total === 0) return 0;

  // Saturating volume term: 1 piece → 0.09, 5 → 0.33, 10 → 0.5, 30 → 0.75.
  const volume = total / (total + 10);

  // Consistency: 1.0 when unanimous, 0.5 when evenly split.
  const consistency = Math.max(input.supportingCount, input.contradictingCount) / total;
  // Rescale 0.5..1 onto 0..1 so an even split contributes nothing.
  const directionalAgreement = (consistency - 0.5) * 2;

  const effect = input.averageAbsoluteRelativeEffect ?? 0;
  const effectBonus = Math.min(0.15, effect * 0.3);

  return clampConfidence(volume * 0.55 + directionalAgreement * 0.45 + effectBonus);
}

/** Whole days between two ISO timestamps. Negative when `later` precedes `earlier`. */
export function daysBetween(earlier: string, later: string): number {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}
