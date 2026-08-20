/**
 * Milestone 3 — profile onboarding: turning a CreatorOS-connected account
 * into a properly configured Kairos research subject.
 *
 * `ProfileOnboardingInput` is deliberately NOT a `SocialProfile`. It is
 * unvalidated draft form state — partially filled, possibly wrong. Only
 * `validateOnboardingInput` + `onboardProfile` (in `onboardProfile.ts`) turn
 * it into a persisted, valid `SocialProfile`. Nothing here calls an LLM,
 * generates strategy, or interprets answers — onboarding collects,
 * validates, normalizes and persists, and stops there.
 *
 * DECLARED VS. OBSERVED AUDIENCE
 * ------------------------------------------------------------------------
 * Everything under `declaredAudience*` below is the profile owner's own
 * belief about their audience — an initial hypothesis, not measured fact.
 * It lands on `SocialProfile.audience`, which by construction is always
 * owner-declared: Milestone 1's design keeps *observed* audience
 * intelligence in a separate place (`ProfileBrain.audienceIntelligence`,
 * populated later by a Science/Audience Brain milestone from real
 * interactions). Onboarding never writes to `ProfileBrain.audienceIntelligence`
 * — see `onboardProfile.ts` — so the declared/observed distinction is a
 * structural property of where data lives, not a field you can lose track
 * of. Future signal sources (comments, replies, recurring questions,
 * engagement patterns, conversions) feed the observed side; this module
 * never touches it.
 */
import type { GrowthObjective, Platform } from '../common/types.js';
import type { AudienceSegment, ExperimentMode, Offer } from '../profiles/types.js';

/**
 * One offer, as collected at onboarding. Reuses `Offer` field-for-field via
 * `Omit` rather than redeclaring it, so the two shapes cannot drift; `id`
 * and `active` are the only fields onboarding doesn't require up front —
 * `onboardProfile` generates an id if none is given and defaults `active`
 * to `true`.
 */
export type OnboardingOfferInput = Omit<Offer, 'id' | 'active'> & {
  readonly id?: string;
  readonly active?: boolean;
};

/**
 * One audience segment, as collected at onboarding. Same `Omit` technique
 * as `OnboardingOfferInput` — `id` is optional and generated if absent.
 */
export type OnboardingAudienceSegmentInput = Omit<AudienceSegment, 'id'> & {
  readonly id?: string;
};

/**
 * Draft, unvalidated onboarding form state for one Kairos research subject.
 * Every optional field here is genuinely optional to the *user* — validation
 * enforces what the domain model actually requires (see `validate.ts`).
 */
export interface ProfileOnboardingInput {
  /** Set to re-onboard an existing profile (update); omit to create a new one. */
  readonly profileId?: string;

  /**
   * The tenant this profile belongs to. Required — see
   * `SocialProfile.workspaceId`. Supplied by the application from the
   * authenticated session, never by the person filling in the form.
   */
  readonly workspaceId: string;

  // ---- Account identity — CreatorOS remains the source of truth for the
  // account itself; this is only the reference plus display context. ----
  readonly creatorOsAccountId: string;
  readonly platform: Platform;
  readonly handle?: string;
  readonly brandName: string;
  readonly faceless?: boolean;

  // ---- Niche ----
  readonly niche: string;
  readonly subNiche?: string;
  readonly geographicFocus?: readonly string[];

  // ---- Positioning ----
  /** What the account is about, its unique angle, credibility context, differentiation — one free-text field, in the owner's words. */
  readonly positioning?: string;

  // ---- Voice ----
  /** Tone/style/personality adjectives and phrases to favor. */
  readonly voice?: readonly string[];
  /** Hard rules: words/phrases to avoid, topics to avoid, compliance/claims/brand restrictions, resource limitations. All folded into one list — see `ProfileIdentity.styleConstraints`. */
  readonly styleConstraints?: readonly string[];

  // ---- Declared audience — an initial hypothesis, not measured fact; see
  // the module doc for how this stays distinguishable from observed audience. ----
  readonly declaredAudience: string;
  /** Experience/sophistication level, where useful — folded into the persisted audience description; no dedicated field exists on the domain model yet. */
  readonly audienceSophistication?: string;
  readonly audienceSegments?: readonly OnboardingAudienceSegmentInput[];
  readonly audiencePains?: readonly string[];
  readonly audienceDesires?: readonly string[];
  /** Vocabulary/language notes — the words this audience actually uses. */
  readonly audienceLanguagePatterns?: readonly string[];

  // ---- Objectives ----
  readonly primaryObjective: GrowthObjective;
  readonly secondaryObjectives?: readonly GrowthObjective[];

  // ---- Offers — optional; a profile may be growth-only. ----
  readonly offers?: readonly OnboardingOfferInput[];
  /** Conversion goal examples (profile visit, follower, DM, click, lead, sale) map onto the nearest `GrowthObjective`. */
  readonly primaryConversionGoal?: GrowthObjective;

  // ---- Posting capacity ----
  readonly postsPerDay?: number;
  readonly postsPerWeek?: number;
  /** Reply/community capacity and any other capacity notes. */
  readonly postingNotes?: string;

  // ---- Experiment mode ----
  /**
   * How aggressively Kairos may experiment. Reuses the existing
   * `ExperimentMode` vocabulary (`conservative` | `balanced` | `discovery`)
   * rather than introducing a second one — `discovery` is this model's term
   * for maximum exploration.
   */
  readonly experimentMode: ExperimentMode;
}

/** One structured, field-attributed validation problem. */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

