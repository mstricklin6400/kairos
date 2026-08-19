/**
 * Pure scoring helpers for the Battle Engine. Deterministic, no I/O, no AI.
 *
 * There is deliberately NO universal definition of "winner". A scoring
 * model is configuration: a conversation battle weights replies, a revenue
 * battle weights conversion and customer value, and both are legitimate.
 * What the engine guarantees is that the methodology is explicit,
 * inspectable, and cannot be quietly dominated by vanity metrics.
 */
import type { PerformanceMetric } from '../performance/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type {
  BattleScoringCategory,
  BattleScoringModel,
  BattleVerdict,
  ScoringCategory,
} from './types.js';

/**
 * Categories that measure attention/engagement rather than business
 * outcome. These are the vanity surface — real, worth measuring, and
 * dangerous only when allowed to decide a revenue question.
 */
export const VANITY_CATEGORIES: readonly ScoringCategory[] = [
  'attention',
  'engagementSignal',
  'amplification',
];

/** Categories that represent an actual business outcome. */
export const BUSINESS_CATEGORIES: readonly ScoringCategory[] = ['intent', 'conversion', 'customerValue'];

/**
 * Min-max normalization to 0..1 across the compared set.
 *
 * A set with no spread normalizes to 0.5 for every member, not 1.0: when
 * every competitor scored the same, nobody won, and handing them all a
 * perfect score would manufacture a distinction that the data does not
 * contain.
 */
export function normalizeValues(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

/** Sum of a model's category weights, for share calculations. */
export function totalWeight(model: BattleScoringModel): number {
  return model.categories.reduce((sum, c) => sum + c.weight, 0);
}

/** The share of total weight sitting in vanity categories. */
export function vanityShare(model: BattleScoringModel): number {
  const total = totalWeight(model);
  if (total === 0) return 0;
  const vanity = model.categories
    .filter((c) => VANITY_CATEGORIES.includes(c.category))
    .reduce((sum, c) => sum + c.weight, 0);
  return vanity / total;
}

/**
 * Enforces `vanityGuardMaxShare` by scaling vanity-category weights down
 * until their combined share fits the cap, then leaving business weights
 * untouched.
 *
 * This is what stops a revenue-objective battle being won on impressions.
 * It is applied at scoring time and surfaced as a limitation, never
 * silently — a model whose weights had to be corrected says so.
 */
export function applyVanityGuard(model: BattleScoringModel): {
  categories: readonly BattleScoringCategory[];
  adjusted: boolean;
} {
  const cap = model.vanityGuardMaxShare;
  if (cap === undefined) return { categories: model.categories, adjusted: false };

  const total = totalWeight(model);
  if (total === 0) return { categories: model.categories, adjusted: false };

  const vanityWeight = model.categories
    .filter((c) => VANITY_CATEGORIES.includes(c.category))
    .reduce((sum, c) => sum + c.weight, 0);
  const nonVanityWeight = total - vanityWeight;
  const currentShare = vanityWeight / total;
  if (currentShare <= cap || vanityWeight === 0) return { categories: model.categories, adjusted: false };

  // Solve for the vanity weight V' that satisfies V' / (V' + nonVanity) = cap.
  // With cap < 1 this is always finite; cap === 1 cannot be exceeded, so we
  // never reach this branch with a zero denominator.
  const targetVanityWeight = (cap * nonVanityWeight) / (1 - cap);
  const scale = targetVanityWeight / vanityWeight;

  return {
    categories: model.categories.map((c) =>
      VANITY_CATEGORIES.includes(c.category) ? { ...c, weight: c.weight * scale } : c,
    ),
    adjusted: true,
  };
}

/** One competitor's raw category totals, keyed by category. */
export type CompetitorCategoryTotals = Readonly<Record<string, number>>;

export interface ScoredCompetitor {
  readonly competitorId: string;
  readonly totalScore: number;
  readonly categoryScores: Readonly<Record<string, { raw: number; normalized: number; weighted: number }>>;
  readonly evidenceCount: number;
}

/**
 * Scores competitors against a model. Normalization happens per category
 * across the compared set, then weights are applied.
 *
 * A category for which NO competitor has evidence contributes nothing —
 * it is skipped rather than scored as zero, because missing data is not the
 * same fact as a measured zero.
 */
export function scoreCompetitors(input: {
  readonly model: BattleScoringModel;
  readonly competitors: readonly {
    readonly competitorId: string;
    readonly totals: CompetitorCategoryTotals;
    readonly evidenceCount: number;
  }[];
}): { scored: ScoredCompetitor[]; adjustedForVanity: boolean; limitations: AnalysisLimitation[] } {
  const { competitors } = input;
  const { categories, adjusted } = applyVanityGuard(input.model);
  const limitations: AnalysisLimitation[] = [...input.model.limitations];
  if (competitors.length === 0) return { scored: [], adjustedForVanity: adjusted, limitations };

  const perCategoryNormalized = new Map<ScoringCategory, number[]>();
  const scoredCategories: BattleScoringCategory[] = [];

  for (const category of categories) {
    const present = competitors.filter((c) => c.totals[category.category] !== undefined);
    // No competitor reported this category at all — skip, don't zero-fill.
    if (present.length === 0) continue;
    const values = competitors.map((c) => c.totals[category.category] ?? 0);
    perCategoryNormalized.set(category.category, normalizeValues(values));
    scoredCategories.push(category);
  }

  const scored = competitors.map((competitor, index) => {
    const categoryScores: Record<string, { raw: number; normalized: number; weighted: number }> = {};
    let totalScore = 0;
    for (const category of scoredCategories) {
      const raw = competitor.totals[category.category] ?? 0;
      const normalized = perCategoryNormalized.get(category.category)![index]!;
      const weighted = normalized * category.weight;
      categoryScores[category.category] = { raw, normalized, weighted };
      totalScore += weighted;
    }
    return {
      competitorId: competitor.competitorId,
      totalScore,
      categoryScores,
      evidenceCount: competitor.evidenceCount,
    };
  });

  if (competitors.some((c) => c.evidenceCount === 0)) limitations.push('small_sample');

  return { scored, adjustedForVanity: adjusted, limitations };
}

/**
 * Decides a category verdict from scored competitors.
 *
 * Returns `insufficient_evidence` when nobody has evidence, `tie` on an
 * exact draw, and `inconclusive` when the margin is inside `minimumMargin`
 * — a hair's-breadth lead is not a win, and saying so is more honest than
 * ranking on noise.
 */
export function decideCategoryVerdict(input: {
  readonly scored: readonly ScoredCompetitor[];
  readonly minimumMargin?: number;
}): { verdict: BattleVerdict; winnerCompetitorId?: string } {
  const { scored } = input;
  const minimumMargin = input.minimumMargin ?? 0.05;
  if (scored.length === 0) return { verdict: 'insufficient_evidence' };

  const withEvidence = scored.filter((s) => s.evidenceCount > 0);
  if (withEvidence.length === 0) return { verdict: 'insufficient_evidence' };

  const ranked = [...withEvidence].sort((a, b) =>
    b.totalScore !== a.totalScore ? b.totalScore - a.totalScore : a.competitorId.localeCompare(b.competitorId),
  );
  const leader = ranked[0]!;
  if (ranked.length === 1) return { verdict: 'winner', winnerCompetitorId: leader.competitorId };

  const runnerUp = ranked[1]!;
  if (leader.totalScore === runnerUp.totalScore) return { verdict: 'tie' };
  if (leader.totalScore - runnerUp.totalScore < minimumMargin) return { verdict: 'inconclusive' };
  return { verdict: 'winner', winnerCompetitorId: leader.competitorId };
}

/**
 * Efficiency ratios — value per 1,000 of a denominator metric.
 *
 * Returns `undefined` on a zero or missing denominator rather than
 * `Infinity`/`NaN`. Revenue is never inferred: if no revenue was
 * attributed, this returns nothing rather than implying zero earnings.
 */
export function perThousand(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined) return undefined;
  if (denominator === 0 || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return undefined;
  return (numerator / denominator) * 1000;
}

/** Simple rate (0..1) guarding against a zero denominator. */
export function rate(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined) return undefined;
  if (denominator === 0 || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return undefined;
  return numerator / denominator;
}

/** Share of resolved predictions that were correct. `undefined` when none have resolved. */
export function predictionAccuracy(
  results: readonly { readonly result: string }[],
): { accuracy?: number; resolved: number; correct: number } {
  const resolved = results.filter((r) => r.result === 'correct' || r.result === 'incorrect');
  const correct = resolved.filter((r) => r.result === 'correct').length;
  return {
    ...(resolved.length > 0 ? { accuracy: correct / resolved.length } : {}),
    resolved: resolved.length,
    correct,
  };
}

/** Which categories a metric can contribute to, mirroring the measurement hierarchy. */
export function categoryForMetric(metric: PerformanceMetric): ScoringCategory | undefined {
  const map: Partial<Record<PerformanceMetric, ScoringCategory>> = {
    impressions: 'attention',
    views: 'attention',
    replies: 'conversation',
    comments: 'conversation',
    reposts: 'amplification',
    shares: 'amplification',
    likes: 'engagementSignal',
    saves: 'engagementSignal',
    bookmarks: 'engagementSignal',
    profileVisits: 'growth',
    followersGained: 'growth',
    clicks: 'intent',
    leads: 'conversion',
    sales: 'conversion',
    revenue: 'customerValue',
  };
  return map[metric];
}
