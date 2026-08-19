/**
 * Draft, unvalidated ingestion input for Milestone 6 — mirrors the
 * collect/validate/normalize/persist discipline in
 * `../onboarding/validate.ts` and `../research/ingest.ts`. Reuses
 * `ValidationError`/`ValidationResult` rather than redefining the shape.
 */
import type { Platform } from '../common/types.js';
import type { AttributionEventType, AttributionMethod, EvidenceSource, TrackingContext } from './types.js';

export type { ValidationError, ValidationResult } from '../onboarding/types.js';

export interface MeasurementSnapshotInput {
  /** Stable id for idempotent re-ingestion; auto-derived from (creatorOsPostId, capturedAt) when omitted — see `ingest.ts`. */
  readonly id?: string;
  readonly profileId: string;
  readonly creatorOsAccountId: string;
  readonly creatorOsPostId?: string;
  readonly experimentId?: string;
  readonly capturedAt: string;
  readonly sourcePlatform: Platform;
  readonly rawMetrics: Record<string, unknown>;
  /** Defaults to `'creatoros_platform'`. */
  readonly evidenceSource?: EvidenceSource;
}

export interface ProfileMeasurementSnapshotInput {
  readonly id?: string;
  readonly profileId: string;
  readonly creatorOsAccountId: string;
  readonly capturedAt: string;
  readonly sourcePlatform: Platform;
  readonly rawMetrics: Record<string, unknown>;
  readonly evidenceSource?: EvidenceSource;
}

export interface AttributionEventInput {
  /** A stable id from the reporting system (e.g. a Stripe charge id) makes re-ingestion idempotent; auto-generated when omitted. */
  readonly id?: string;
  readonly profileId: string;
  readonly experimentId?: string;
  readonly creatorOsPostId?: string;
  readonly offerId?: string;
  readonly audienceSegmentId?: string;
  readonly eventType: AttributionEventType;
  readonly occurredAt: string;
  readonly value?: number;
  readonly currency?: string;
  /** Defaults to `'unknown'` — never assume `'direct'`. */
  readonly attributionMethod?: AttributionMethod;
  readonly source: string;
  readonly campaign?: string;
  readonly contentRef?: string;
  readonly trackingContext?: TrackingContext;
  readonly metadata?: Record<string, string | number | boolean>;
}
