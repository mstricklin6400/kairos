/**
 * Measurement: what Kairos counts, how those counts ladder up in meaning, and
 * what "normal" looks like for a given profile.
 *
 * Milestone 1 defines the shapes. No baseline calculation is implemented.
 */
import type {
  ContentFormat,
  GrowthObjective,
  HookFamily,
  IsoDateTime,
} from '../common/types.js';

/**
 * Every metric Kairos can record. Kept as one flat union so a baseline, an
 * effect size and a hypothesis's dependent metric all speak the same language.
 *
 * `impressions` and `views` are separate on purpose: platforms mean different
 * things by them, and collapsing the two would destroy the record of which one
 * was actually returned.
 */
export type PerformanceMetric =
  | 'impressions'
  | 'views'
  | 'likes'
  | 'replies'
  | 'comments'
  | 'reposts'
  | 'shares'
  | 'saves'
  | 'bookmarks'
  | 'profileVisits'
  | 'clicks'
  | 'followersGained'
  | 'leads'
  | 'sales'
  | 'revenue';

/**
 * The measurement hierarchy, ascending from cheap-and-noisy to
 * expensive-and-meaningful. A finding supported only at `attention` is weaker
 * than one supported at `conversion`, whatever the statistics say.
 */
export type MeasurementTier =
  | 'attention'
  | 'conversation'
  | 'amplification'
  | 'growth'
  | 'intent'
  | 'conversion'
  | 'customerValue';

/** Which tier each metric belongs to. */
export const METRIC_MEASUREMENT_TIER: Readonly<Record<PerformanceMetric, MeasurementTier>> = {
  impressions: 'attention',
  views: 'attention',
  replies: 'conversation',
  comments: 'conversation',
  likes: 'amplification',
  reposts: 'amplification',
  shares: 'amplification',
  followersGained: 'growth',
  profileVisits: 'intent',
  saves: 'intent',
  bookmarks: 'intent',
  clicks: 'conversion',
  leads: 'conversion',
  sales: 'customerValue',
  revenue: 'customerValue',
};

/**
 * What a baseline is measured *within*. Comparing a short-video post against a
 * profile-wide average is how false winners are manufactured; comparing it
 * against other short-video posts is how real ones are found.
 */
export type BaselineComparisonScope =
  | { readonly kind: 'all-recent-posts' }
  | { readonly kind: 'hook-family'; readonly hookFamily: HookFamily }
  | { readonly kind: 'content-format'; readonly format: ContentFormat }
  | { readonly kind: 'objective'; readonly objective: GrowthObjective }
  | { readonly kind: 'audience-segment'; readonly audienceSegmentId: string };

/** The time span a baseline was computed over. */
export interface BaselineWindow {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
}

/**
 * What "normal" looks like for one profile, one metric, one comparison scope.
 *
 * `median` is required and `mean`/`standardDeviation` are not: a small sample
 * supports a median long before it supports a meaningful spread. `sampleSize`
 * and `window` are mandatory so any consumer can judge whether this baseline
 * deserves to be trusted at all.
 */
export interface PerformanceBaseline {
  readonly profileId: string;
  readonly metric: PerformanceMetric;
  readonly comparisonScope: BaselineComparisonScope;
  readonly sampleSize: number;
  readonly median: number;
  readonly mean?: number;
  readonly standardDeviation?: number;
  readonly window: BaselineWindow;
  readonly calculatedAt: IsoDateTime;
}
