/**
 * The unified analytical read model. Milestone 6 deliberately left
 * `PostMeasurement` and `ExperimentObservation` as parallel stored types;
 * the Science Engine needs to consume both without rewriting either.
 *
 * These are pure projection functions: they build `AnalyticalObservation`
 * rows on demand and never mutate, re-save, or reconcile the source
 * records. Every row carries `sourceType` + `sourceRecordId`, so any
 * downstream conclusion can be traced back to the exact stored evidence it
 * came from.
 *
 * MISSING IS NOT ZERO: a metric absent from an `ExperimentResult` produces
 * NO row. It never becomes a `0` that a baseline would then average in as
 * though the platform had reported a genuine zero.
 */
import type { PerformanceMetric } from '../performance/types.js';
import type { ExperimentObservation, ExperimentResult } from './types.js';
import type { AttributionEvent, PostMeasurement } from '../measurement/types.js';
import type { AnalyticalObservation } from './analysisTypes.js';

/** Every `PerformanceMetric` that `ExperimentResult` can carry, in a stable order. */
const RESULT_METRICS: readonly PerformanceMetric[] = [
  'impressions',
  'views',
  'likes',
  'replies',
  'comments',
  'reposts',
  'shares',
  'saves',
  'bookmarks',
  'profileVisits',
  'clicks',
  'followersGained',
  'leads',
  'sales',
  'revenue',
];

function flattenMetrics(metrics: ExperimentResult): Array<{ metric: PerformanceMetric; value: number }> {
  const rows: Array<{ metric: PerformanceMetric; value: number }> = [];
  for (const metric of RESULT_METRICS) {
    const value = metrics[metric];
    // Absent stays absent — no zero-filling.
    if (typeof value === 'number' && Number.isFinite(value)) {
      rows.push({ metric, value });
    }
  }
  return rows;
}

/** Projects one `PostMeasurement` into one analytical row per reported metric. */
export function fromPostMeasurement(measurement: PostMeasurement): AnalyticalObservation[] {
  return flattenMetrics(measurement.metrics).map(({ metric, value }) => ({
    id: `${measurement.id}:${metric}`,
    profileId: measurement.profileId,
    experimentId: measurement.experimentId,
    creatorOsPostId: measurement.creatorOsPostId,
    metric,
    value,
    measuredAt: measurement.measuredAt,
    sourceType: 'post_measurement' as const,
    sourceRecordId: measurement.id,
  }));
}

/**
 * Projects one `ExperimentObservation` into analytical rows.
 * `ExperimentObservation` carries no `profileId` of its own (it is scoped
 * by its experiment), so the caller supplies the owning profile.
 */
export function fromExperimentObservation(
  observation: ExperimentObservation,
  profileId: string,
): AnalyticalObservation[] {
  return flattenMetrics(observation.metrics).map(({ metric, value }) => ({
    id: `${observation.id}:${metric}`,
    profileId,
    experimentId: observation.experimentId,
    metric,
    value,
    measuredAt: observation.measuredAt,
    sourceType: 'experiment_observation' as const,
    sourceRecordId: observation.id,
  }));
}

/**
 * Maps an `AttributionEvent.eventType` onto the `PerformanceMetric` it
 * legitimately evidences. Only business outcomes appear here — an
 * attribution event can never contribute an attention/engagement metric,
 * and platform analytics can never contribute a business one. Returns
 * `undefined` for event types (`link_click` aside) that don't correspond to
 * a countable metric.
 */
function attributionMetricFor(event: AttributionEvent): { metric: PerformanceMetric; value: number } | undefined {
  switch (event.eventType) {
    case 'link_click':
      return { metric: 'clicks', value: 1 };
    case 'lead':
      return { metric: 'leads', value: 1 };
    case 'purchase':
    case 'repeat_purchase':
      return { metric: 'sales', value: 1 };
    case 'revenue':
      return event.value !== undefined ? { metric: 'revenue', value: event.value } : undefined;
    // A checkout is not yet a sale; a refund is a reversal this milestone
    // does not net out. Both are stored evidence, neither is a countable
    // positive outcome here.
    case 'checkout':
    case 'refund':
    case 'other':
      return undefined;
    default: {
      const exhaustive: never = event.eventType;
      throw new Error(`unhandled attribution event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Projects one `AttributionEvent` into an analytical row, when and only
 * when it legitimately evidences a business metric. A purchase carrying a
 * monetary `value` additionally yields a `revenue` row — the money is real
 * evidence, not an inference from platform analytics.
 */
export function fromAttributionEvent(event: AttributionEvent): AnalyticalObservation[] {
  const rows: AnalyticalObservation[] = [];
  const base = {
    profileId: event.profileId,
    experimentId: event.experimentId,
    creatorOsPostId: event.creatorOsPostId,
    audienceSegmentId: event.audienceSegmentId,
    measuredAt: event.occurredAt,
    sourceType: 'attribution_event' as const,
    sourceRecordId: event.id,
  };

  const primary = attributionMetricFor(event);
  if (primary) {
    rows.push({ id: `${event.id}:${primary.metric}`, ...base, metric: primary.metric, value: primary.value });
  }

  const isPurchase = event.eventType === 'purchase' || event.eventType === 'repeat_purchase';
  if (isPurchase && event.value !== undefined) {
    rows.push({ id: `${event.id}:revenue`, ...base, metric: 'revenue', value: event.value });
  }

  return rows;
}
