/**
 * The Social Profile — the unit of customization and learning.
 *
 * Niche, audience, voice, objectives and offers live HERE, as data supplied by
 * onboarding, never as constants inside Kairos Core. Adding a niche, a segment
 * or an offer is data entry, not a code change.
 *
 * `creatorOsAccountId` is the canonical reference to the connected CreatorOS
 * account and is never replaced or shadowed by a Kairos identifier.
 */
import type {
  Confidence,
  GrowthObjective,
  IsoDateTime,
  Platform,
} from '../common/types.js';

/**
 * How much of a profile's posting capacity is spent on exploration.
 *
 * - `conservative` — mostly validated approaches, limited experimentation.
 * - `balanced`     — a mix of exploitation and exploration.
 * - `discovery`    — aggressive experimentation for faster learning.
 *
 * Deliberately no percentages yet: the split is the Battle Engine's decision,
 * informed by the profile's baselines, not a constant baked into the model.
 */
export type ExperimentMode = 'conservative' | 'balanced' | 'discovery';

/** One distinct group inside a profile's audience. A profile may have many. */
export interface AudienceSegment {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** What hurts. */
  readonly pains: readonly string[];
  /** What they want instead. */
  readonly desires: readonly string[];
  /** Why they do not act. */
  readonly objections: readonly string[];
  /** Words this segment actually uses — the vocabulary content should mirror. */
  readonly languagePatterns: readonly string[];
  /** Lower is more important. Optional: not every profile ranks its segments. */
  readonly priority?: number;
}

/**
 * A recurring theme this profile posts about. Profile-specific strategy input,
 * never a global constant.
 */
export interface ContentPillar {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** What this pillar is meant to move. */
  readonly objective?: GrowthObjective;
  /** Intended share of output, 0..1. */
  readonly allocation?: number;
}

export type OfferType =
  | 'digital-product'
  | 'physical-product'
  | 'service'
  | 'subscription'
  | 'affiliate'
  | 'lead-magnet'
  | 'other';

/**
 * Something the profile sells or captures leads with. Descriptive only —
 * Milestone 1 builds no ecommerce or payment integration.
 */
export interface Offer {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly price?: number;
  /** ISO 4217, e.g. `USD`. */
  readonly currency?: string;
  readonly type?: OfferType;
  readonly active: boolean;
  /** References `AudienceSegment.id` — absent means the offer targets the whole profile audience. */
  readonly targetAudienceSegmentId?: string;
  /** What this offer is meant to convert toward, e.g. `sale`, `lead`. */
  readonly conversionObjective?: GrowthObjective;
}

/** What the profile sounds like and what it must never do. */
export interface ProfileIdentity {
  readonly brandName: string;
  readonly handle?: string;
  /** Faceless accounts constrain format choices (no talking-head video, etc.). */
  readonly faceless: boolean;
  /** Voice adjectives, e.g. `['blunt', 'technical', 'warm']`. */
  readonly voice: readonly string[];
  /** Hard rules: "no emoji", "never say 'game-changer'", "British spelling". Also where topic/compliance/claims restrictions and other onboarding-declared constraints live. */
  readonly styleConstraints?: readonly string[];
  /** What this account is about, its unique angle, credibility context and differentiation — in the owner's own words. */
  readonly positioning?: string;
}

export interface ProfileMarket {
  readonly niche: string;
  readonly subNiche?: string;
  /** e.g. `['US', 'UK']` or `['global']`. */
  readonly geographicFocus?: readonly string[];
}

export interface ProfileAudience {
  /** One-line description of who this is for. */
  readonly primaryAudience: string;
  readonly segments: readonly AudienceSegment[];
  /** Profile-wide pains, above and beyond any single segment's. */
  readonly pains: readonly string[];
  readonly desires: readonly string[];
  readonly languagePatterns: readonly string[];
}

export interface ProfileObjectives {
  readonly primary: GrowthObjective;
  readonly secondary: readonly GrowthObjective[];
}

/** How much this profile can realistically publish. */
export interface PostingFrequency {
  readonly postsPerDay?: number;
  readonly postsPerWeek?: number;
  /** e.g. "weekdays only", "no weekends", "batch on Sundays". */
  readonly notes?: string;
}

/**
 * Current intended split of output across pillars. An array rather than a
 * keyed record so a pillar id can never be silently missing under
 * `noUncheckedIndexedAccess`.
 */
export interface ContentAllocation {
  readonly pillarId: string;
  /** Share of output, 0..1. */
  readonly share: number;
}

export interface ProfileStrategy {
  readonly experimentMode: ExperimentMode;
  readonly postingFrequency: PostingFrequency;
  readonly contentPillars: readonly ContentPillar[];
  readonly currentAllocations: readonly ContentAllocation[];
}

export interface ProfileMonetization {
  readonly offers: readonly Offer[];
  readonly primaryConversionGoal?: GrowthObjective;
}

/**
 * Everything Kairos needs in order to know *whose* growth it is reasoning
 * about. Intelligence learned about this profile lives in `ProfileBrain`,
 * keyed by `SocialProfile.id`.
 */
export interface SocialProfile {
  readonly id: string;
  /** Canonical CreatorOS account reference. Never replaced by a Kairos id. */
  readonly creatorOsAccountId: string;
  readonly platform: Platform;
  readonly identity: ProfileIdentity;
  readonly market: ProfileMarket;
  readonly audience: ProfileAudience;
  readonly objectives: ProfileObjectives;
  readonly strategy: ProfileStrategy;
  readonly monetization: ProfileMonetization;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Bumped when the profile's shape changes, so stored records can migrate. */
  readonly version: number;
}

/**
 * The monetization slice a Profile Brain needs to reason about conversion.
 * References offers by id rather than embedding them — the profile owns the
 * offer definitions; the brain only needs to know which are live.
 */
export interface ProfileMonetizationContext {
  readonly activeOfferIds: readonly string[];
  readonly primaryConversionGoal?: GrowthObjective;
  readonly revenueTrackingEnabled: boolean;
  /** ISO 4217. */
  readonly currency?: string;
}

/**
 * A recurring feature combination associated with over- or under-performance,
 * e.g. "contrarian hook + short text + reply CTA".
 *
 * Milestone 1 defines the shape only — pattern detection is not implemented.
 */
export interface Pattern {
  readonly id: string;
  readonly description: string;
  /** The content-DNA features that co-occur, e.g. `['contrarian', 'micro']`. */
  readonly featureTags: readonly string[];
  readonly confidence: Confidence;
  readonly sampleSize: number;
  readonly lastObservedAt: IsoDateTime;
}
