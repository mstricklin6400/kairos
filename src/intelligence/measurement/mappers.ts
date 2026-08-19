/**
 * Deterministic mappers from CreatorOS's untyped analytics payloads into
 * the existing `PerformanceMetric`/`ExperimentResult` vocabulary. No LLM, no
 * inference of unavailable metrics, no statistical analysis — a field is
 * either present under a recognized name or it stays absent.
 *
 * Because CreatorOS analytics responses are untyped in this codebase (see
 * `types.ts`'s inspection note), each metric is looked up under a small,
 * explicit list of candidate field-name aliases — camelCase and snake_case
 * both, mirroring the dual-naming convention CreatorOS itself already uses
 * for TikTok fields in `PlatformSpecificData` (`src/client/types.ts`). This
 * is the "mapping registry" Step 14 asks for: one small table, not a giant
 * switch statement, and not a parallel platform abstraction — the platform
 * identifiers themselves still come from `Platform` (`platformMatrix.ts`).
 *
 * `leads`, `sales` and `revenue` are deliberately never looked up here —
 * see the module doc in `types.ts`: those only ever come from a real
 * `AttributionEvent`, never a platform analytics response.
 */
import type { PerformanceMetric } from '../performance/types.js';
import type { ExperimentResult } from '../science/types.js';

type PostMetricKey = Exclude<PerformanceMetric, 'followersGained' | 'leads' | 'sales' | 'revenue'>;

/** Candidate raw field names for each post-level metric, in lookup order. */
const POST_METRIC_ALIASES: Record<PostMetricKey, readonly string[]> = {
  impressions: ['impressions', 'impression_count', 'impressionCount'],
  views: ['views', 'view_count', 'viewCount', 'videoViews', 'video_views'],
  likes: ['likes', 'like_count', 'likeCount'],
  replies: ['replies', 'reply_count', 'replyCount'],
  comments: ['comments', 'comment_count', 'commentCount'],
  reposts: ['reposts', 'repost_count', 'repostCount', 'retweets', 'retweet_count'],
  shares: ['shares', 'share_count', 'shareCount'],
  saves: ['saves', 'save_count', 'saveCount'],
  bookmarks: ['bookmarks', 'bookmark_count', 'bookmarkCount'],
  profileVisits: ['profileVisits', 'profile_visits', 'profileVisitCount', 'profile_visit_count'],
  clicks: ['clicks', 'click_count', 'clickCount', 'linkClicks', 'link_clicks'],
};

/** Candidate raw field names for profile-level follower count and growth. */
const PROFILE_FOLLOWERS_COUNT_ALIASES = ['currentFollowers', 'followersCount', 'followers', 'followerCount'];
const PROFILE_FOLLOWERS_GAINED_ALIASES = ['growth', 'followersGained', 'newFollowers', 'follower_growth'];

function firstNumericValue(raw: Readonly<Record<string, unknown>>, aliases: readonly string[]): number | undefined {
  for (const key of aliases) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Maps one post's raw CreatorOS analytics into `ExperimentResult`. Missing
 * fields stay `undefined`, never `0` — a metric CreatorOS didn't return is
 * not the same fact as a metric that returned zero. Never populates
 * `leads`, `sales`, `revenue`, `followersGained` or `currency` — those are
 * either attribution-only or profile-level, not post-level platform
 * analytics.
 */
export function mapCreatorOsPostAnalytics(rawMetrics: Readonly<Record<string, unknown>>): ExperimentResult {
  const result: { -readonly [K in PostMetricKey]?: number } = {};
  for (const [metric, aliases] of Object.entries(POST_METRIC_ALIASES) as Array<[PostMetricKey, readonly string[]]>) {
    const value = firstNumericValue(rawMetrics, aliases);
    if (value !== undefined) result[metric] = value;
  }
  return result;
}

/**
 * Maps one profile/account's raw CreatorOS analytics into a follower count
 * plus `ExperimentResult` window metrics (`followersGained`, and whatever
 * post-shaped fields — `impressions`, `views`, `profileVisits` — a daily
 * aggregate happens to also carry).
 */
export function mapCreatorOsProfileAnalytics(rawMetrics: Readonly<Record<string, unknown>>): {
  followersCount?: number;
  metrics: ExperimentResult;
} {
  const followersCount = firstNumericValue(rawMetrics, PROFILE_FOLLOWERS_COUNT_ALIASES);
  const followersGained = firstNumericValue(rawMetrics, PROFILE_FOLLOWERS_GAINED_ALIASES);
  const metrics: ExperimentResult = {
    ...mapCreatorOsPostAnalytics(rawMetrics),
    ...(followersGained !== undefined ? { followersGained } : {}),
  };
  return { ...(followersCount !== undefined ? { followersCount } : {}), metrics };
}
