/**
 * Deterministic ingestion for Milestone 6 — validate, normalize, persist
 * through `IntelligenceStore`. Never calls CreatorOS's analytics endpoints
 * itself (that stays entirely the caller's job, via `src/client/client.ts`)
 * and never invents a metric, an experiment link, or a revenue figure that
 * wasn't actually given.
 *
 * IDEMPOTENCY (Step 17)
 * ------------------------------------------------------------------------
 * `CreatorOsMeasurementSnapshot`/`ProfileMeasurementSnapshot` ids are
 * deterministically derived from their natural key
 * (`creatorOsPostId`/`profileId` + `capturedAt`) when the caller doesn't
 * supply one. Re-ingesting the exact same pull collapses onto the same id
 * (no duplicate); a genuinely later measurement has a different
 * `capturedAt` and therefore a different id, so it coexists rather than
 * overwriting. `PostMeasurement` ids mirror their source snapshot's id
 * 1:1, giving the same idempotency and an implicit lineage link.
 */
import { randomUUID } from 'node:crypto';
import type { IntelligenceStore } from '../storage/store.js';
import type { AttributionEvent, CreatorOsMeasurementSnapshot, PostMeasurement, ProfileMeasurementSnapshot } from './types.js';
import { mapCreatorOsPostAnalytics, mapCreatorOsProfileAnalytics } from './mappers.js';
import { validateAttributionEventInput, validateMeasurementSnapshotInput, validateProfileMeasurementSnapshotInput } from './validate.js';
import type { AttributionEventInput, MeasurementSnapshotInput, ProfileMeasurementSnapshotInput, ValidationError } from './ingestTypes.js';

export type IngestMeasurementSnapshotResult =
  | { readonly ok: true; readonly snapshot: CreatorOsMeasurementSnapshot; readonly observation: PostMeasurement }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

export type IngestProfileMeasurementResult =
  | { readonly ok: true; readonly snapshot: ProfileMeasurementSnapshot }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

export type IngestAttributionEventResult =
  | { readonly ok: true; readonly event: AttributionEvent }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

/**
 * Validates and persists one raw CreatorOS post-analytics pull, then
 * normalizes it into a `PostMeasurement` via `mapCreatorOsPostAnalytics`.
 * Both are saved through the store; the raw snapshot is never mutated by
 * normalization. Supplying `experimentId` links the measurement to a
 * Kairos `Experiment`; omitting it is equally valid — ordinary,
 * non-experimental content is never forced into a fabricated experiment.
 */
export async function ingestMeasurementSnapshot(
  input: MeasurementSnapshotInput,
  store: IntelligenceStore,
): Promise<IngestMeasurementSnapshotResult> {
  const validation = await validateMeasurementSnapshotInput(input, store);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const snapshotId = input.id ?? (input.creatorOsPostId ? `snap_${input.creatorOsPostId}_${input.capturedAt}` : `snap_${randomUUID()}`);
  const snapshot: CreatorOsMeasurementSnapshot = {
    id: snapshotId,
    profileId: input.profileId,
    creatorOsAccountId: input.creatorOsAccountId,
    creatorOsPostId: input.creatorOsPostId,
    experimentId: input.experimentId,
    capturedAt: input.capturedAt,
    sourcePlatform: input.sourcePlatform,
    rawMetrics: input.rawMetrics,
    evidenceSource: input.evidenceSource ?? 'creatoros_platform',
    schemaVersion: 1,
  };
  await store.saveMeasurementSnapshot(snapshot);

  const observation: PostMeasurement = {
    id: `obs_${snapshotId}`,
    profileId: snapshot.profileId,
    creatorOsAccountId: snapshot.creatorOsAccountId,
    creatorOsPostId: snapshot.creatorOsPostId,
    experimentId: snapshot.experimentId,
    sourceSnapshotId: snapshot.id,
    measuredAt: snapshot.capturedAt,
    sourcePlatform: snapshot.sourcePlatform,
    metrics: mapCreatorOsPostAnalytics(snapshot.rawMetrics),
    evidenceSource: snapshot.evidenceSource,
    schemaVersion: 1,
  };
  await store.savePostMeasurement(observation);

  return { ok: true, snapshot, observation };
}

/**
 * Validates and persists one raw CreatorOS profile/account-analytics pull,
 * normalized into a `ProfileMeasurementSnapshot` via
 * `mapCreatorOsProfileAnalytics`. The raw pull itself is not separately
 * stored as a `CreatorOsMeasurementSnapshot` when it has no single post to
 * key off of — `sourceRawMetrics` is folded directly into the profile
 * snapshot instead, since a profile pull has nothing else to be "about."
 */
export async function ingestProfileMeasurementSnapshot(
  input: ProfileMeasurementSnapshotInput,
  store: IntelligenceStore,
): Promise<IngestProfileMeasurementResult> {
  const validation = await validateProfileMeasurementSnapshotInput(input, store);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const { followersCount, metrics } = mapCreatorOsProfileAnalytics(input.rawMetrics);
  const snapshot: ProfileMeasurementSnapshot = {
    id: input.id ?? `psnap_${input.profileId}_${input.capturedAt}`,
    profileId: input.profileId,
    creatorOsAccountId: input.creatorOsAccountId,
    capturedAt: input.capturedAt,
    sourcePlatform: input.sourcePlatform,
    followersCount,
    metrics,
    evidenceSource: input.evidenceSource ?? 'creatoros_platform',
    schemaVersion: 1,
  };
  await store.saveProfileMeasurementSnapshot(snapshot);
  return { ok: true, snapshot };
}

/**
 * Validates and persists one first-party business event. Never derives a
 * value from CreatorOS platform analytics — `value`/`currency` come only
 * from what the caller supplies about the actual business outcome.
 */
export async function ingestAttributionEvent(
  input: AttributionEventInput,
  store: IntelligenceStore,
): Promise<IngestAttributionEventResult> {
  const validation = await validateAttributionEventInput(input, store);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const event: AttributionEvent = {
    id: input.id ?? `evt_${randomUUID()}`,
    profileId: input.profileId,
    experimentId: input.experimentId,
    creatorOsPostId: input.creatorOsPostId,
    offerId: input.offerId,
    audienceSegmentId: input.audienceSegmentId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    value: input.value,
    currency: input.currency,
    attributionMethod: input.attributionMethod ?? 'unknown',
    source: input.source.trim(),
    campaign: input.campaign,
    contentRef: input.contentRef,
    trackingContext: input.trackingContext,
    metadata: input.metadata,
    evidenceSource: 'first_party',
    schemaVersion: 1,
  };
  await store.saveAttributionEvent(event);
  return { ok: true, event };
}
