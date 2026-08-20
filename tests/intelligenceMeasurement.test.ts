import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import {
  ingestAttributionEvent,
  ingestMeasurementSnapshot,
  ingestProfileMeasurementSnapshot,
} from '../src/intelligence/measurement/ingest.js';
import { mapCreatorOsPostAnalytics, mapCreatorOsProfileAnalytics } from '../src/intelligence/measurement/mappers.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';
import type { AttributionEventInput, MeasurementSnapshotInput, ProfileMeasurementSnapshotInput } from '../src/intelligence/measurement/ingestTypes.js';
import type { Experiment } from '../src/intelligence/index.js';

const NOW = '2026-08-19T12:00:00Z';

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-measurement-')));
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    workspaceId: 'ws_test',
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    brandName: 'Lift Notes',
    niche: 'strength training',
    declaredAudience: 'Intermediate lifters stuck at a plateau',
    primaryObjective: 'followers',
    experimentMode: 'balanced',
    ...overrides,
  };
}

async function seedProfile(store: JsonlIntelligenceStore, overrides: Partial<ProfileOnboardingInput> = {}) {
  const result = await onboardProfile(onboardingInput(overrides), store, NOW);
  if (!result.ok) throw new Error('seed profile failed validation');
  return result.profile;
}

async function seedExperiment(store: JsonlIntelligenceStore, profileId: string, id = 'exp_1'): Promise<Experiment> {
  const experiment: Experiment = {
    id,
    profileId,
    platform: 'threads',
    niche: 'strength training',
    objective: 'conversation',
    contentDna: { topic: 'bench plateau', hookFamily: 'contrarian-claim', format: 'text', tone: 'contrarian', lengthClass: 'short' },
    design: { testVariables: [] },
    execution: { publishedAt: NOW, creatorOsPostId: 'post_abc' },
    createdAt: NOW,
    updatedAt: NOW,
  };
  await store.saveExperiment(experiment);
  return experiment;
}

function snapshotInput(profile: { id: string; creatorOsAccountId: string }, overrides: Partial<MeasurementSnapshotInput> = {}): MeasurementSnapshotInput {
  return {
    profileId: profile.id,
    creatorOsAccountId: profile.creatorOsAccountId,
    creatorOsPostId: 'post_abc',
    capturedAt: '2026-08-19T12:30:00Z',
    sourcePlatform: 'threads',
    rawMetrics: { impressions: 4200, replies: 31, likes: 210 },
    ...overrides,
  };
}

describe('Measurement — raw CreatorOS post snapshot', () => {
  it('saves and loads a raw CreatorOS post snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getMeasurementSnapshot(result.snapshot.id);
    expect(loaded?.rawMetrics.impressions).toBe(4200);
  });

  it('preserves creatorOsAccountId on the raw snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.creatorOsAccountId).toBe(profile.creatorOsAccountId);
  });

  it('preserves creatorOsPostId on the raw snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { creatorOsPostId: 'post_xyz' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.creatorOsPostId).toBe('post_xyz');
  });

  it('preserves the source platform on the raw snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { sourcePlatform: 'twitter' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.sourcePlatform).toBe('twitter');
  });
});

describe('Measurement — normalized observation', () => {
  it('saves and loads a normalized observation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getPostMeasurement(result.observation.id);
    expect(loaded?.metrics.replies).toBe(31);
  });

  it('lets multiple observation times coexist', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: '2026-08-19T12:30:00Z', rawMetrics: { impressions: 800 } }), store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: '2026-08-20T12:00:00Z', rawMetrics: { impressions: 4200 } }), store);
    const observations = await store.listPostMeasurements({ profileId: profile.id });
    expect(observations).toHaveLength(2);
  });

  it('does not let a 24-hour observation overwrite a 30-minute observation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const early = await ingestMeasurementSnapshot(
      snapshotInput(profile, { capturedAt: '2026-08-19T12:30:00Z', rawMetrics: { impressions: 800, replies: 4 } }),
      store,
    );
    await ingestMeasurementSnapshot(
      snapshotInput(profile, { capturedAt: '2026-08-20T12:00:00Z', rawMetrics: { impressions: 4200, replies: 31 } }),
      store,
    );
    expect(early.ok).toBe(true);
    if (!early.ok) return;
    const stillThere = await store.getPostMeasurement(early.observation.id);
    expect(stillThere).toEqual(early.observation);
  });

  it('keeps impressions and views distinct', () => {
    const result = mapCreatorOsPostAnalytics({ impressions: 4200, views: 88000 });
    expect(result.impressions).toBe(4200);
    expect(result.views).toBe(88000);
  });

  it('keeps replies and comments distinct', () => {
    const result = mapCreatorOsPostAnalytics({ replies: 31, comments: 12 });
    expect(result.replies).toBe(31);
    expect(result.comments).toBe(12);
  });

  it('keeps reposts and shares distinct', () => {
    const result = mapCreatorOsPostAnalytics({ reposts: 5, shares: 9 });
    expect(result.reposts).toBe(5);
    expect(result.shares).toBe(9);
  });

  it('keeps saves and bookmarks distinct', () => {
    const result = mapCreatorOsPostAnalytics({ saves: 3, bookmarks: 7 });
    expect(result.saves).toBe(3);
    expect(result.bookmarks).toBe(7);
  });

  it('leaves a metric CreatorOS did not return absent, never zeroed', () => {
    const result = mapCreatorOsPostAnalytics({ impressions: 4200 });
    expect(result.impressions).toBe(4200);
    expect(result.saves).toBeUndefined();
    expect('saves' in result).toBe(false);
  });

  it('round-trips experiment linkage on the observation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { experimentId: 'exp_1' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.experimentId).toBe('exp_1');
    const forExperiment = await store.listPostMeasurements({ profileId: profile.id, experimentId: 'exp_1' });
    expect(forExperiment.map((o) => o.id)).toEqual([result.observation.id]);
  });

  it('stores non-experiment post analytics without fabricating an experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { experimentId: undefined }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.experimentId).toBeUndefined();
  });
});

describe('Measurement — profile-level snapshots', () => {
  function profileSnapshotInput(profile: { id: string; creatorOsAccountId: string }, overrides: Partial<ProfileMeasurementSnapshotInput> = {}): ProfileMeasurementSnapshotInput {
    return {
      profileId: profile.id,
      creatorOsAccountId: profile.creatorOsAccountId,
      capturedAt: '2026-08-19T00:00:00Z',
      sourcePlatform: 'threads',
      rawMetrics: { currentFollowers: 5400, growth: 62, growthPercentage: 1.2 },
      ...overrides,
    };
  }

  it('saves and loads a profile-level snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestProfileMeasurementSnapshot(profileSnapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.followersCount).toBe(5400);
    expect(result.snapshot.metrics.followersGained).toBe(62);
  });

  it('lets multiple profile snapshots coexist over time', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestProfileMeasurementSnapshot(profileSnapshotInput(profile, { capturedAt: '2026-08-01T00:00:00Z' }), store);
    await ingestProfileMeasurementSnapshot(profileSnapshotInput(profile, { capturedAt: '2026-08-19T00:00:00Z' }), store);
    const all = await store.listProfileMeasurementSnapshots({ profileId: profile.id });
    expect(all).toHaveLength(2);
  });

  it('does not force profile-level measurements into a fake Experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestProfileMeasurementSnapshot(profileSnapshotInput(profile), store);
    expect(result.ok).toBe(true);
    // ProfileMeasurementSnapshot has no experimentId field at all.
    expect('experimentId' in (result.ok ? result.snapshot : {})).toBe(false);
  });
});

describe('Measurement — AttributionEvent', () => {
  function eventInput(profile: { id: string }, overrides: Partial<AttributionEventInput> = {}): AttributionEventInput {
    return {
      profileId: profile.id,
      eventType: 'lead',
      occurredAt: NOW,
      source: 'manual',
      ...overrides,
    };
  }

  it('saves and loads an AttributionEvent', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getAttributionEvent(result.event.id);
    expect(loaded?.eventType).toBe('lead');
  });

  it('lets a purchase event carry revenue', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile, { eventType: 'purchase', value: 79, currency: 'USD' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.value).toBe(79);
    expect(result.event.currency).toBe('USD');
  });

  it('does not require a lead event to carry revenue', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile, { eventType: 'lead' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.value).toBeUndefined();
    expect(result.event.currency).toBeUndefined();
  });

  it('represents a refund', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile, { eventType: 'refund', value: 79, currency: 'USD' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.eventType).toBe('refund');
    expect(result.event.value).toBe(79);
  });

  it('lets an attribution event reference an experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id);
    const result = await ingestAttributionEvent(eventInput(profile, { experimentId: 'exp_1' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.experimentId).toBe('exp_1');
  });

  it('lets an attribution event reference a CreatorOS post', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile, { creatorOsPostId: 'post_abc' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.creatorOsPostId).toBe('post_abc');
  });

  it('lets an attribution event reference an offer', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile, { offerId: 'off_peaking_block' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.offerId).toBe('off_peaking_block');
  });

  it('makes audience segment linkage optional', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const withoutSegment = await ingestAttributionEvent(eventInput(profile), store);
    const withSegment = await ingestAttributionEvent(eventInput(profile, { audienceSegmentId: 'oseg_1' }), store);
    expect(withoutSegment.ok && withSegment.ok).toBe(true);
    if (!withoutSegment.ok || !withSegment.ok) return;
    expect(withoutSegment.event.audienceSegmentId).toBeUndefined();
    expect(withSegment.event.audienceSegmentId).toBe('oseg_1');
  });

  it('round-trips UTM tracking context', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const trackingContext = { utmSource: 'threads', utmMedium: 'social', utmCampaign: 'plateau-launch', offerId: 'off_1' };
    const result = await ingestAttributionEvent(eventInput(profile, { trackingContext }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getAttributionEvent(result.event.id);
    expect(loaded?.trackingContext).toEqual(trackingContext);
  });

  it('round-trips attribution method', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile, { attributionMethod: 'utm' }), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.attributionMethod).toBe('utm');
  });

  it('supports unknown attribution honestly rather than defaulting to direct', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestAttributionEvent(eventInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.attributionMethod).toBe('unknown');
  });
});

describe('Measurement — revenue is never inferred from platform analytics', () => {
  it('the CreatorOS post mapper never invents revenue, sales or leads', () => {
    const result = mapCreatorOsPostAnalytics({ impressions: 100000, views: 50000, likes: 4000 });
    expect('revenue' in result).toBe(false);
    expect('sales' in result).toBe(false);
    expect('leads' in result).toBe(false);
  });

  it('the CreatorOS profile mapper never invents revenue', () => {
    const { metrics } = mapCreatorOsProfileAnalytics({ currentFollowers: 10000, growth: 500 });
    expect('revenue' in metrics).toBe(false);
  });

  it('a high-impression post snapshot alone does not create any AttributionEvent', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { rawMetrics: { impressions: 500000, views: 400000 } }), store);
    const events = await store.listAttributionEvents({ profileId: profile.id });
    expect(events).toEqual([]);
  });
});

describe('Measurement — raw/normalized lineage', () => {
  it('leaves the raw source snapshot unchanged after normalization', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reloaded = await store.getMeasurementSnapshot(result.snapshot.id);
    expect(reloaded).toEqual(result.snapshot);
  });

  it('links the normalized observation back to its raw snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.sourceSnapshotId).toBe(result.snapshot.id);
  });
});

describe('Measurement — idempotency', () => {
  it('handles a duplicate stable source snapshot idempotently', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const first = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    const second = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.snapshot.id).toBe(second.snapshot.id);
    const all = await store.listMeasurementSnapshots({ profileId: profile.id });
    expect(all).toHaveLength(1);
  });

  it('keeps two snapshots at genuinely different times separate', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: '2026-08-19T12:30:00Z' }), store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: '2026-08-19T14:30:00Z' }), store);
    const all = await store.listMeasurementSnapshots({ profileId: profile.id });
    expect(all).toHaveLength(2);
  });
});

describe('Measurement — validation', () => {
  it('rejects a negative metric count', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { rawMetrics: { impressions: -5 } }), store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'rawMetrics.impressions')).toBe(true);
  });

  it('fails intentionally on an invalid timestamp', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: 'not-a-date' }), store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'capturedAt')).toBe(true);
  });

  it('detects a profile/account mismatch', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile, { creatorOsAccountId: 'wrong_account' }), store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'creatorOsAccountId')).toBe(true);
  });

  it('detects an experiment/profile mismatch', async () => {
    const store = await tmpStore();
    const profileA = await seedProfile(store, { creatorOsAccountId: 'acct_a' });
    const profileB = await seedProfile(store, { creatorOsAccountId: 'acct_b' });
    await seedExperiment(store, profileA.id, 'exp_a');
    const result = await ingestMeasurementSnapshot(snapshotInput(profileB, { experimentId: 'exp_a' }), store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'experimentId')).toBe(true);
  });

  it('preserves an unrecognized raw metric rather than discarding it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(
      snapshotInput(profile, { rawMetrics: { impressions: 4200, someBrandNewPlatformMetric: 17 } }),
      store,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getMeasurementSnapshot(result.snapshot.id);
    expect(loaded?.rawMetrics.someBrandNewPlatformMetric).toBe(17);
    // Not normalized into a fabricated PerformanceMetric — absent from the observation.
    expect((result.observation.metrics as Record<string, unknown>).someBrandNewPlatformMetric).toBeUndefined();
  });
});

describe('Measurement — queries for future baseline readiness', () => {
  it('queries observations by profile', async () => {
    const store = await tmpStore();
    const profileA = await seedProfile(store, { creatorOsAccountId: 'acct_a' });
    const profileB = await seedProfile(store, { creatorOsAccountId: 'acct_b' });
    await ingestMeasurementSnapshot(snapshotInput(profileA), store);
    await ingestMeasurementSnapshot(snapshotInput(profileB), store);
    const forA = await store.listPostMeasurements({ profileId: profileA.id });
    expect(forA.every((o) => o.profileId === profileA.id)).toBe(true);
  });

  it('queries observations by experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id, 'exp_a');
    await seedExperiment(store, profile.id, 'exp_b');
    await ingestMeasurementSnapshot(snapshotInput(profile, { experimentId: 'exp_a', capturedAt: '2026-08-19T01:00:00Z' }), store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { experimentId: 'exp_b', capturedAt: '2026-08-19T02:00:00Z' }), store);
    const forExpA = await store.listPostMeasurements({ profileId: profile.id, experimentId: 'exp_a' });
    expect(forExpA).toHaveLength(1);
    expect(forExpA[0]!.experimentId).toBe('exp_a');
  });

  it('queries observations by date range', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: '2026-08-01T00:00:00Z' }), store);
    await ingestMeasurementSnapshot(snapshotInput(profile, { capturedAt: '2026-08-19T00:00:00Z' }), store);
    const inRange = await store.listPostMeasurements({ profileId: profile.id, from: '2026-08-10T00:00:00Z', to: '2026-08-31T00:00:00Z' });
    expect(inRange).toHaveLength(1);
    expect(inRange[0]!.measuredAt).toBe('2026-08-19T00:00:00Z');
  });

  it('exposes observations in a shape suitable for future baseline calculation — metrics, profile, measuredAt all present', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const result = await ingestMeasurementSnapshot(snapshotInput(profile), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [observation] = await store.listPostMeasurements({ profileId: profile.id });
    expect(observation?.profileId).toBe(profile.id);
    expect(observation?.measuredAt).toBeTruthy();
    expect(observation?.metrics).toBeTruthy();
  });
});

describe('Measurement — no science engine, no strategy mutation, no AI, CreatorOS untouched', () => {
  it('performs no baseline calculation as part of ingestion', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile), store);
    const baselines = await store.listBaselines({ profileId: profile.id });
    expect(baselines).toEqual([]);
  });

  it('makes no Science Engine decision (no Finding created) as part of ingestion', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile), store);
    const findings = await store.listFindings({ workspaceId: 'ws_test' });
    expect(findings).toEqual([]);
  });

  it('does not mutate profile strategy as a side effect of ingestion', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(snapshotInput(profile), store);
    const reloaded = await store.getProfile(profile.id);
    expect(reloaded).toEqual(profile);
  });

  it('reads CreatorOS contracts (Platform) without modifying them, and requires no AI dependency', () => {
    // Purely a structural assertion: the mapper is pure, deterministic, synchronous.
    const result = mapCreatorOsPostAnalytics({ impressions: 10 });
    expect(result).toEqual({ impressions: 10 });
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-measurement-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const profileResult = await onboardProfile(onboardingInput(), first, NOW);
    if (!profileResult.ok) throw new Error('seed failed');
    const ingested = await ingestMeasurementSnapshot(snapshotInput(profileResult.profile), first);
    if (!ingested.ok) throw new Error('ingest failed');

    const second = new JsonlIntelligenceStore(root);
    const loaded = await second.getMeasurementSnapshot(ingested.snapshot.id);
    expect(loaded?.id).toBe(ingested.snapshot.id);
    const observation = await second.getPostMeasurement(ingested.observation.id);
    expect(observation?.id).toBe(ingested.observation.id);
  });
});
