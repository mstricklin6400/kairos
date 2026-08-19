/**
 * Measurement Ingestion & Attribution — Milestone 6. Converts CreatorOS
 * analytics and first-party business-outcome events into normalized Kairos
 * observations, and closes the loop:
 *
 *   Kairos → CreatorOS execution → social platform → CreatorOS analytics
 *   → Kairos observation storage
 *
 * CORE RULE: CreatorOS retrieves platform data. Kairos interprets and
 * stores it. Nothing here re-implements analytics retrieval — see
 * `src/client/client.ts`'s `getAnalytics`/`followerStats`/`bestTimeToPost`/
 * `dailyMetrics`/`postTimeline`, all already present and all Kairos ever
 * calls into for platform data.
 *
 * WHAT CREATOROS ACTUALLY RETURNS (inspected before writing this file)
 * ------------------------------------------------------------------------
 * Every CreatorOS analytics method in `src/client/client.ts` returns
 * `Promise<unknown>` — there is no committed response schema anywhere in
 * this repository for post analytics, follower stats, best-time-to-post or
 * daily metrics. The one place a shape is informally relied upon
 * (`src/onboarding/interview.ts`, reading `followerStats()`) casts to
 * `{ accounts?: Array<{ platform, username, currentFollowers, growth,
 * growthPercentage }> }` inline, not as a committed type. `CreatePostBody`
 * and `Post` (`src/client/types.ts`) both carry an index signature
 * (`[key: string]: unknown`), confirming CreatorOS payloads are
 * intentionally open-ended in this codebase. `rawMetrics` below is
 * therefore typed as an open record, not a fixed CreatorOS schema Kairos
 * cannot actually guarantee — inventing a rigid shape here would be lying
 * about what CreatorOS promises.
 *
 * RAW VS. NORMALIZED
 * ------------------------------------------------------------------------
 * `CreatorOsMeasurementSnapshot` preserves exactly what CreatorOS returned
 * for one analytics pull. `PostMeasurement` / `ProfileMeasurementSnapshot`
 * are the normalized readings mapped out of it (`mappers.ts`) into the
 * existing `PerformanceMetric`/`ExperimentResult` vocabulary — no second
 * metric system. Every normalized record keeps `sourceSnapshotId` pointing
 * back at the raw evidence it was derived from; normalizing never discards
 * or rewrites the raw snapshot.
 *
 * PLATFORM EVIDENCE VS. BUSINESS EVIDENCE
 * ------------------------------------------------------------------------
 * CreatorOS tells Kairos what happened on the platform. First-party systems
 * (checkout, CRM, billing) tell Kairos what happened in the business.
 * `AttributionEvent` is that second, separate evidence source —
 * `mapCreatorOsPostAnalytics` (`mappers.ts`) never populates `leads`,
 * `sales` or `revenue`; those fields only ever come from an actual
 * `AttributionEvent`. A platform analytics response is never treated as
 * proof of revenue.
 */
import type { IsoDateTime, Platform } from '../common/types.js';
import type { ExperimentResult } from '../science/types.js';

/** Where a piece of measurement/attribution evidence came from. */
export type EvidenceSource = 'creatoros_platform' | 'first_party' | 'manual' | 'other';

/**
 * Exactly what CreatorOS returned for one analytics pull, kept as-is.
 * `rawMetrics` is deliberately an open record rather than a fixed CreatorOS
 * schema — see the module doc's inspection note. Never contains secrets or
 * API tokens; only the analytics payload itself.
 */
export interface CreatorOsMeasurementSnapshot {
  readonly id: string;
  readonly profileId: string;
  readonly creatorOsAccountId: string;
  /** Absent for account/profile-wide pulls not tied to one post. */
  readonly creatorOsPostId?: string;
  /** Present only when this post is known to belong to a Kairos Experiment. Never fabricated. */
  readonly experimentId?: string;
  readonly capturedAt: IsoDateTime;
  readonly sourcePlatform: Platform;
  readonly rawMetrics: Readonly<Record<string, unknown>>;
  /** Almost always `'creatoros_platform'` — the field exists so a manually-entered raw pull can still be represented honestly. */
  readonly evidenceSource: EvidenceSource;
  readonly schemaVersion: number;
}

/**
 * The normalized reading for one post, at one point in time, mapped out of
 * a `CreatorOsMeasurementSnapshot` (or supplied directly for non-CreatorOS
 * evidence). Reuses `ExperimentResult` for its metrics — no second metric
 * system, no duplicated content DNA: a post that belongs to an experiment
 * is linked by `experimentId` so the experiment's own content DNA is read
 * from `Experiment`, never copied here.
 *
 * `experimentId` is intentionally optional: Kairos supports ordinary,
 * non-experimental content without fabricating an experiment for it. When
 * present, this is the same "one deliberate measurement of one post at one
 * time" concept `ExperimentObservation` (`science/types.ts`) models for an
 * experiment's own tightly-scoped history — `PostMeasurement` is the
 * general-purpose, profile-queryable counterpart Milestone 6 needs (query
 * by profile and date range, not only by a single experiment id). The two
 * are not merged: `ExperimentObservation` stays exactly as Milestone 2 left
 * it.
 *
 * Same append-preserving discipline as `ExperimentObservation`: keyed by
 * its own `id`, a later measurement never overwrites an earlier one.
 */
export interface PostMeasurement {
  readonly id: string;
  readonly profileId: string;
  readonly creatorOsAccountId: string;
  readonly creatorOsPostId?: string;
  readonly experimentId?: string;
  /** The raw evidence this reading was normalized from, if any. */
  readonly sourceSnapshotId?: string;
  readonly measuredAt: IsoDateTime;
  readonly sourcePlatform: Platform;
  readonly metrics: ExperimentResult;
  readonly evidenceSource: EvidenceSource;
  readonly schemaVersion: number;
}

/**
 * A profile/account-level analytics reading — followers, growth, daily
 * aggregate metrics — never forced into a fake post `Experiment`.
 * `followersCount` is a point-in-time absolute count (CreatorOS's
 * `followerStats()` returns `currentFollowers`; see the module doc), kept
 * separate from `metrics` because it is a snapshot fact, not a
 * window/event metric like the rest of `PerformanceMetric`.
 */
export interface ProfileMeasurementSnapshot {
  readonly id: string;
  readonly profileId: string;
  readonly creatorOsAccountId: string;
  readonly capturedAt: IsoDateTime;
  readonly sourcePlatform: Platform;
  readonly followersCount?: number;
  readonly metrics: ExperimentResult;
  readonly sourceSnapshotId?: string;
  readonly evidenceSource: EvidenceSource;
  readonly schemaVersion: number;
}

/**
 * A first-party business outcome — a click, a lead, a purchase, a refund —
 * never derived from CreatorOS platform analytics. See the module doc:
 * revenue proof requires an actual `AttributionEvent`, never a platform
 * analytics response.
 */
export type AttributionEventType =
  | 'link_click'
  | 'lead'
  | 'checkout'
  | 'purchase'
  | 'refund'
  | 'repeat_purchase'
  | 'revenue'
  | 'other';

/**
 * How confidently this event ties back to a specific profile/experiment/
 * post/offer. Not every conversion can be perfectly attributed to one
 * post — this represents that uncertainty honestly rather than pretending
 * every event is `direct`. No multi-touch modelling; `modelled` exists as a
 * vocabulary slot for a future milestone that adds one.
 */
export type AttributionMethod = 'direct' | 'utm' | 'last_touch' | 'first_touch' | 'manual' | 'modelled' | 'unknown';

/**
 * Platform → Profile → Experiment/Post → Offer → Conversion tracking
 * context. Deliberately just data: no URL shortener, no checkout logic.
 */
export interface TrackingContext {
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly profileId?: string;
  readonly experimentId?: string;
  readonly offerId?: string;
}

/**
 * One first-party business event, optionally tied to a profile, experiment,
 * post, offer or audience segment — every linkage is optional, never
 * inferred without evidence. `audienceSegmentId` lets Kairos eventually
 * compare segments by business outcome, not just engagement (e.g. "Segment
 * A: high replies, low purchases" vs. "Segment B: lower replies, high
 * purchases") — but nothing here computes that comparison.
 */
export interface AttributionEvent {
  readonly id: string;
  readonly profileId: string;
  readonly experimentId?: string;
  readonly creatorOsPostId?: string;
  readonly offerId?: string;
  readonly audienceSegmentId?: string;
  readonly eventType: AttributionEventType;
  readonly occurredAt: IsoDateTime;
  /** Present when the event carries a monetary amount — absent for e.g. a lead with no known value yet. */
  readonly value?: number;
  /** ISO 4217, required whenever `value` is set. */
  readonly currency?: string;
  readonly attributionMethod: AttributionMethod;
  /** Free text identifying the reporting system — e.g. `'stripe'`, `'woocommerce'`, `'manual'`. Not a fixed integration list; none is integrated yet. */
  readonly source: string;
  readonly campaign?: string;
  /** A free-form pointer to the specific content/offer referenced, when `creatorOsPostId`/`offerId` alone aren't enough context. */
  readonly contentRef?: string;
  readonly trackingContext?: TrackingContext;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Almost always `'first_party'`. */
  readonly evidenceSource: EvidenceSource;
  readonly schemaVersion: number;
}
