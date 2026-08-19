/**
 * Shared domain primitives for the Kairos intelligence layer.
 *
 * Everything here is deliberately small, serializable and free of behaviour —
 * the intelligence layer is a record of what Kairos believes and why, and it
 * must survive a JSON round trip into whatever store backs it later.
 *
 * Platform note: the platform union is re-exported from the CreatorOS client
 * matrix rather than redefined. Kairos studies exactly the platforms CreatorOS
 * can execute against, and a second, drifting platform vocabulary would be the
 * "incompatible platform abstraction" this architecture exists to avoid.
 * Adding a platform stays a one-line change in `src/client/platformMatrix.ts`.
 */
import type { Platform } from '../../client/platformMatrix.js';

export type { Platform };

/** ISO 8601 timestamp, e.g. `2026-08-19T14:30:00Z`. */
export type IsoDateTime = string;

/**
 * Normalized confidence in the range 0..1. Never read alone — always alongside
 * sample size, scope, source and recency.
 */
export type Confidence = number;

/**
 * Where a piece of knowledge came from. This is the single most important
 * field in the intelligence layer: it decides how much authority a statement
 * is allowed to have.
 *
 * - `playbook`   — course/guru/agency/community claim. A hypothesis, never a fact.
 * - `platform`   — official capability, API behaviour, documented restriction.
 * - `research`   — deliberate desk research or analysis.
 * - `experiment` — evidence produced by an actual Kairos experiment.
 */
export type KnowledgeSourceType = 'playbook' | 'platform' | 'research' | 'experiment';

/** The four levels at which knowledge can be true. */
export type KnowledgeScopeLevel = 'global' | 'platform' | 'niche' | 'profile';

/**
 * The reach of a claim. Modelled as a discriminated union so a niche-scoped
 * finding cannot be written without its niche, and so nothing is silently
 * treated as universal.
 */
export type KnowledgeScope =
  | { readonly level: 'global' }
  | { readonly level: 'platform'; readonly platform: Platform }
  | { readonly level: 'niche'; readonly niche: string; readonly subNiche?: string }
  | { readonly level: 'profile'; readonly profileId: string };

/**
 * What a profile, experiment or finding is trying to move. Ordered roughly
 * from cheapest to most commercially meaningful; extend as new objectives
 * become real rather than overloading existing ones.
 */
export type GrowthObjective =
  | 'reach'
  | 'conversation'
  | 'amplification'
  | 'followers'
  | 'traffic'
  | 'lead'
  | 'sale'
  | 'revenue'
  | 'retention';

/**
 * How far along an account is. Advice that works at cold start routinely fails
 * for an established account, so findings may be stage-scoped.
 */
export type AccountStage = 'cold-start' | 'early' | 'growing' | 'established' | 'mature';

/**
 * A single remembered belief with a weight attached — the atom of soft
 * knowledge in a Profile Brain (pain points, desires, terminology, objections,
 * emerging topics, ...).
 *
 * Generic in its tag vocabulary so callers can narrow tags to a closed union
 * where one exists, without a separate interface per knowledge kind.
 */
export interface WeightedInsight<TTag extends string = string> {
  readonly id: string;
  /** The belief itself, in plain language. */
  readonly statement: string;
  /** 0..1. How strongly Kairos currently holds this. */
  readonly weight: Confidence;
  readonly source?: KnowledgeSourceType;
  /** Free-form pointer to the origin: a URL, a course name, an experiment id. */
  readonly sourceReference?: string;
  readonly tags?: readonly TTag[];
  /** Recency is half of trust — a belief nobody has seen in months is decaying. */
  readonly lastObservedAt?: IsoDateTime;
}

/* ------------------------------------------------------------------------ *
 * Content DNA vocabulary
 *
 * The structured description of what a post actually was. Without this, a post
 * is an undifferentiated event; with it, a post is a data point with features
 * that results can be grouped and compared by.
 * ------------------------------------------------------------------------ */

export type ContentFormat =
  | 'text'
  | 'thread'
  | 'image'
  | 'carousel'
  | 'short-video'
  | 'long-video'
  | 'link'
  | 'poll'
  | 'live'
  | 'story';

export type ContentTone =
  | 'authoritative'
  | 'conversational'
  | 'contrarian'
  | 'story'
  | 'educational'
  | 'humorous'
  | 'inspirational'
  | 'analytical'
  | 'vulnerable';

export type LengthClass = 'micro' | 'short' | 'medium' | 'long' | 'extended';

export type EmotionalDriver =
  | 'curiosity'
  | 'fear'
  | 'aspiration'
  | 'anger'
  | 'belonging'
  | 'relief'
  | 'surprise'
  | 'validation'
  | 'urgency';

export type ControversyLevel = 'none' | 'mild' | 'moderate' | 'high';

export type CtaType =
  | 'none'
  | 'reply'
  | 'follow'
  | 'share'
  | 'save'
  | 'link-click'
  | 'dm'
  | 'signup'
  | 'purchase';

/**
 * The family a hook belongs to, e.g. `contrarian-claim`, `personal-failure`,
 * `numbered-list`. Deliberately an open string: hook families are niche- and
 * profile-specific strategy inputs discovered by experimentation, not a global
 * constant Kairos Core is allowed to hard-code.
 */
export type HookFamily = string;
