import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { ingestAttributionEvent, ingestMeasurementSnapshot } from '../src/intelligence/measurement/ingest.js';
import { ingestResearchSource, ingestStrategyClaim } from '../src/intelligence/research/ingest.js';
import {
  ScienceEngine,
  assertNotCausalFromObservation,
  canSeedHypothesis,
  resolveObjectiveMetrics,
} from '../src/intelligence/science/engine.js';
import {
  buildEffectSize,
  computeOperationalConfidence,
  daysBetween,
  mean,
  median,
  relativeChange,
  standardDeviation,
} from '../src/intelligence/science/statistics.js';
import { fromExperimentObservation, fromPostMeasurement } from '../src/intelligence/science/readModel.js';
import { DEFAULT_SCIENCE_POLICY } from '../src/intelligence/science/analysisTypes.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type { Experiment, ExperimentObservation, Finding, GrowthObjective, Hypothesis } from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-19T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-science-')));
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    workspaceId: 'ws_test',
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    brandName: 'Lift Notes',
    niche: 'strength training',
    declaredAudience: 'Intermediate lifters stuck at a plateau',
    primaryObjective: 'conversation',
    experimentMode: 'balanced',
    ...overrides,
  };
}

async function seedProfile(store: JsonlIntelligenceStore, overrides: Partial<ProfileOnboardingInput> = {}) {
  const result = await onboardProfile(onboardingInput(overrides), store, NOW);
  if (!result.ok) throw new Error('seed profile failed');
  return result.profile;
}

async function seedExperiment(
  store: JsonlIntelligenceStore,
  profileId: string,
  id: string,
  objective: GrowthObjective = 'conversation',
  design: Partial<Experiment['design']> = {},
  topic = 'bench plateau',
): Promise<Experiment> {
  const experiment: Experiment = {
    id,
    profileId,
    platform: 'threads',
    niche: 'strength training',
    objective,
    contentDna: { topic, hookFamily: 'contrarian-claim', format: 'text', tone: 'contrarian', lengthClass: 'short' },
    design: { testVariables: [], ...design },
    execution: { publishedAt: NOW, creatorOsPostId: `post_${id}` },
    createdAt: NOW,
    updatedAt: NOW,
  };
  await store.saveExperiment(experiment);
  return experiment;
}

/** Seeds N baseline measurements so a baseline can actually be calculated. */
async function seedBaselineMeasurements(
  store: JsonlIntelligenceStore,
  profile: { id: string; creatorOsAccountId: string },
  metricValues: readonly number[],
  metricName = 'replies',
): Promise<void> {
  for (const [index, value] of metricValues.entries()) {
    await ingestMeasurementSnapshot(
      {
        profileId: profile.id,
        creatorOsAccountId: profile.creatorOsAccountId,
        // Namespaced by metric so seeding two different metric baselines in
        // one test doesn't collide on the deterministic snapshot id.
        creatorOsPostId: `baseline_${metricName}_post_${index}`,
        capturedAt: `2026-08-0${(index % 9) + 1}T0${index % 10}:00:00Z`,
        sourcePlatform: 'threads',
        rawMetrics: { [metricName]: value },
      },
      store,
    );
  }
}

function hypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'hyp_1',
    statement: 'Contrarian hooks earn more replies.',
    scope: { level: 'profile', profileId: 'prof_1' },
    profileId: 'prof_1',
    independentVariable: 'hookFamily',
    dependentMetric: 'replies',
    controlVariables: ['topic'],
    status: 'testing',
    confidence: 0.4,
    source: 'playbook',
    supportingExperimentIds: [],
    contradictingExperimentIds: [],
    createdAt: NOW,
    ...overrides,
  };
}

describe('Science — unified analytical read model', () => {
  it('consumes a PostMeasurement into per-metric analytical rows', () => {
    const rows = fromPostMeasurement({
      id: 'pm_1',
      profileId: 'prof_1',
      creatorOsAccountId: 'acct_1',
      creatorOsPostId: 'post_1',
      experimentId: 'exp_1',
      measuredAt: NOW,
      sourcePlatform: 'threads',
      metrics: { impressions: 4200, replies: 31 },
      evidenceSource: 'creatoros_platform',
      schemaVersion: 1,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.metric).sort()).toEqual(['impressions', 'replies']);
  });

  it('consumes an ExperimentObservation into per-metric analytical rows', () => {
    const observation: ExperimentObservation = {
      id: 'obs_1',
      experimentId: 'exp_1',
      measuredAt: NOW,
      metrics: { replies: 12, likes: 40 },
    };
    const rows = fromExperimentObservation(observation, 'prof_1');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.profileId === 'prof_1')).toBe(true);
  });

  it('keeps source lineage intact on every analytical row', () => {
    const rows = fromPostMeasurement({
      id: 'pm_lineage',
      profileId: 'prof_1',
      creatorOsAccountId: 'acct_1',
      measuredAt: NOW,
      sourcePlatform: 'threads',
      metrics: { replies: 5 },
      evidenceSource: 'creatoros_platform',
      schemaVersion: 1,
    });
    expect(rows[0]!.sourceRecordId).toBe('pm_lineage');
    expect(rows[0]!.sourceType).toBe('post_measurement');
  });

  it('leaves missing metrics missing — never zero-filled into a row', () => {
    const rows = fromPostMeasurement({
      id: 'pm_sparse',
      profileId: 'prof_1',
      creatorOsAccountId: 'acct_1',
      measuredAt: NOW,
      sourcePlatform: 'threads',
      metrics: { replies: 5 },
      evidenceSource: 'creatoros_platform',
      schemaVersion: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows.some((r) => r.metric === 'impressions')).toBe(false);
  });
});

describe('Science — statistics', () => {
  it('calculates the median correctly', () => {
    expect(median([1, 3, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it('calculates the mean correctly', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBeUndefined();
  });

  it('calculates standard deviation where the sample allows, and not below two values', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(standardDeviation([5])).toBeUndefined();
  });

  it('does not let one viral outlier dominate the median baseline', () => {
    const typical = [10, 12, 11, 13, 12];
    const withViral = [...typical, 50000];
    // The mean is destroyed; the median barely moves.
    expect(mean(withViral)!).toBeGreaterThan(8000);
    expect(median(withViral)!).toBeLessThan(20);
  });

  it('handles a zero baseline safely rather than emitting Infinity or NaN', () => {
    expect(relativeChange(50, 0)).toBeUndefined();
    const effect = buildEffectSize('replies', 50, 0);
    expect(effect.absoluteChange).toBe(50);
    expect(effect.relativeChange).toBeUndefined();
    expect(Number.isFinite(effect.absoluteChange!)).toBe(true);
  });

  it('round-trips effect size with both absolute and relative change', () => {
    const effect = buildEffectSize('replies', 31, 20);
    expect(effect.metric).toBe('replies');
    expect(effect.absoluteChange).toBe(11);
    expect(effect.relativeChange).toBeCloseTo(0.55);
  });

  it('computes days between timestamps', () => {
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z')).toBe(30);
  });
});

describe('Science — operational confidence model', () => {
  it('increases with consistent supporting evidence', () => {
    const few = computeOperationalConfidence({ supportingCount: 2, contradictingCount: 0 });
    const many = computeOperationalConfidence({ supportingCount: 20, contradictingCount: 0 });
    expect(many).toBeGreaterThan(few);
  });

  it('decreases when contradictory evidence arrives', () => {
    const clean = computeOperationalConfidence({ supportingCount: 10, contradictingCount: 0 });
    const contested = computeOperationalConfidence({ supportingCount: 10, contradictingCount: 8 });
    expect(contested).toBeLessThan(clean);
  });

  it('always stays between 0 and 1', () => {
    const cases = [
      { supportingCount: 0, contradictingCount: 0 },
      { supportingCount: 1000, contradictingCount: 0, averageAbsoluteRelativeEffect: 99 },
      { supportingCount: 3, contradictingCount: 3 },
    ];
    for (const c of cases) {
      const value = computeOperationalConfidence(c);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('Science — baseline calculation', () => {
  it('calculates a baseline with median, mean and stddev', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 12, 11, 13, 12, 14]);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const baseline = await engine.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' });
    expect(baseline).not.toBeNull();
    expect(baseline!.median).toBe(12);
    expect(baseline!.mean).toBeCloseTo(12);
    expect(baseline!.standardDeviation).toBeGreaterThan(0);
    expect(baseline!.sampleSize).toBe(6);
  });

  it('returns null for an empty/insufficient baseline rather than a false number', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    expect(await engine.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' })).toBeNull();
  });

  it('honours a configurable minimum sample policy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 12, 11]);
    const strict = new ScienceEngine(store, { now: fixedNow, policy: { minimumBaselineSample: 10 } });
    const lenient = new ScienceEngine(store, { now: fixedNow, policy: { minimumBaselineSample: 3 } });
    expect(await strict.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' })).toBeNull();
    expect(await lenient.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' })).not.toBeNull();
  });
});

describe('Science — comparison', () => {
  async function setup() {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 10, 10, 10, 10, 10]);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const baseline = (await engine.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' }))!;
    return { store, profile, engine, baseline };
  }

  it('calculates a positive change above baseline', async () => {
    const { engine, baseline, profile } = await setup();
    const comparison = engine.compareObservationToBaseline(
      { id: 'o1', profileId: profile.id, metric: 'replies', value: 20, measuredAt: NOW, sourceType: 'post_measurement', sourceRecordId: 'pm_1' },
      baseline,
    );
    expect(comparison.absoluteDifference).toBe(10);
    expect(comparison.relativeDifference).toBeCloseTo(1);
    expect(comparison.direction).toBe('above');
  });

  it('calculates a negative change below baseline', async () => {
    const { engine, baseline, profile } = await setup();
    const comparison = engine.compareObservationToBaseline(
      { id: 'o2', profileId: profile.id, metric: 'replies', value: 2, measuredAt: NOW, sourceType: 'post_measurement', sourceRecordId: 'pm_2' },
      baseline,
    );
    expect(comparison.absoluteDifference).toBe(-8);
    expect(comparison.direction).toBe('below');
  });

  it('reports near_baseline when the change is inside the thresholds', async () => {
    const { engine, baseline, profile } = await setup();
    const comparison = engine.compareObservationToBaseline(
      { id: 'o3', profileId: profile.id, metric: 'replies', value: 11, measuredAt: NOW, sourceType: 'post_measurement', sourceRecordId: 'pm_3' },
      baseline,
    );
    expect(comparison.direction).toBe('near_baseline');
  });
});

describe('Science — objective-to-metric policy', () => {
  it('maps each objective to its own answering metrics', () => {
    expect(resolveObjectiveMetrics('reach')).toContain('impressions');
    expect(resolveObjectiveMetrics('conversation')).toContain('replies');
    expect(resolveObjectiveMetrics('amplification')).toContain('reposts');
    expect(resolveObjectiveMetrics('followers')).toContain('followersGained');
    expect(resolveObjectiveMetrics('traffic')).toContain('clicks');
    expect(resolveObjectiveMetrics('lead')).toEqual(['leads']);
    expect(resolveObjectiveMetrics('sale')).toEqual(['sales']);
    expect(resolveObjectiveMetrics('revenue')).toEqual(['revenue']);
  });

  it('is overrideable rather than hard-coded', () => {
    expect(resolveObjectiveMetrics('reach', { reach: ['views'] })).toEqual(['views']);
  });
});

describe('Science — winner / failure / neutral / insufficient evidence', () => {
  async function setupWithBaseline(objective: GrowthObjective, metricName: string, baselineValues: readonly number[]) {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, baselineValues, metricName);
    const experiment = await seedExperiment(store, profile.id, 'exp_target', objective);
    const engine = new ScienceEngine(store, { now: fixedNow });
    return { store, profile, experiment, engine };
  }

  async function addExperimentMeasurement(
    store: JsonlIntelligenceStore,
    profile: { id: string; creatorOsAccountId: string },
    experimentId: string,
    rawMetrics: Record<string, unknown>,
  ) {
    await ingestMeasurementSnapshot(
      {
        profileId: profile.id,
        creatorOsAccountId: profile.creatorOsAccountId,
        creatorOsPostId: `post_${experimentId}`,
        experimentId,
        capturedAt: '2026-08-19T00:00:00Z',
        sourcePlatform: 'threads',
        rawMetrics,
      },
      store,
    );
  }

  it('detects a winner on the objective metric', async () => {
    const { store, profile, engine } = await setupWithBaseline('conversation', 'replies', [10, 10, 10, 10, 10, 10]);
    await addExperimentMeasurement(store, profile, 'exp_target', { replies: 30 });
    const assessment = await engine.assessExperimentOutcome('exp_target');
    expect(assessment?.verdict).toBe('winner');
    expect(assessment?.decidedOnMetric).toBe('replies');
  });

  it('detects a failure on the objective metric', async () => {
    const { store, profile, engine } = await setupWithBaseline('conversation', 'replies', [10, 10, 10, 10, 10, 10]);
    await addExperimentMeasurement(store, profile, 'exp_target', { replies: 2 });
    const assessment = await engine.assessExperimentOutcome('exp_target');
    expect(assessment?.verdict).toBe('failure');
  });

  it('detects a neutral result', async () => {
    const { store, profile, engine } = await setupWithBaseline('conversation', 'replies', [10, 10, 10, 10, 10, 10]);
    await addExperimentMeasurement(store, profile, 'exp_target', { replies: 11 });
    const assessment = await engine.assessExperimentOutcome('exp_target');
    expect(assessment?.verdict).toBe('neutral');
  });

  it('reports insufficient evidence when there is no usable baseline', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id, 'exp_lonely', 'conversation');
    const engine = new ScienceEngine(store, { now: fixedNow });
    await ingestMeasurementSnapshot(
      {
        profileId: profile.id,
        creatorOsAccountId: profile.creatorOsAccountId,
        creatorOsPostId: 'post_exp_lonely',
        experimentId: 'exp_lonely',
        capturedAt: NOW,
        sourcePlatform: 'threads',
        rawMetrics: { replies: 100 },
      },
      store,
    );
    const assessment = await engine.assessExperimentOutcome('exp_lonely');
    expect(assessment?.verdict).toBe('insufficient_evidence');
    expect(assessment?.limitations).toContain('no_baseline');
  });

  it('treats a missing dependent metric as insufficient evidence, never failure', async () => {
    const { store, profile, engine } = await setupWithBaseline('conversation', 'replies', [10, 10, 10, 10, 10, 10]);
    // Reports impressions only — the dependent metric (replies) is absent.
    await addExperimentMeasurement(store, profile, 'exp_target', { impressions: 5000 });
    const assessment = await engine.assessExperimentOutcome('exp_target');
    expect(assessment?.verdict).toBe('insufficient_evidence');
    expect(assessment?.verdict).not.toBe('failure');
    expect(assessment?.limitations).toContain('missing_metric');
  });

  it('does not let a secondary metric replace the registered dependent metric (no p-hacking)', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    // Baselines for both clicks and replies.
    await seedBaselineMeasurements(store, profile, [10, 10, 10, 10, 10, 10], 'clicks');
    await seedBaselineMeasurements(store, profile, [5, 5, 5, 5, 5, 5], 'replies');
    // An experiment registered to test TRAFFIC (clicks).
    await seedExperiment(store, profile.id, 'exp_clicks', 'traffic');
    const engine = new ScienceEngine(store, { now: fixedNow });
    await ingestMeasurementSnapshot(
      {
        profileId: profile.id,
        creatorOsAccountId: profile.creatorOsAccountId,
        creatorOsPostId: 'post_exp_clicks',
        experimentId: 'exp_clicks',
        capturedAt: '2026-08-19T00:00:00Z',
        sourcePlatform: 'threads',
        // Clicks flat, replies explode.
        rawMetrics: { clicks: 10, replies: 500 },
      },
      store,
    );
    const assessment = await engine.assessExperimentOutcome('exp_clicks');
    // The verdict is decided on clicks, not the exploding replies.
    expect(assessment?.decidedOnMetric).toBe('clicks');
    expect(assessment?.verdict).toBe('neutral');
    // Replies are reported, but only as exploratory.
    expect(assessment?.exploratoryComparisons.some((c) => c.metric === 'replies')).toBe(true);
  });

  it('uses revenue metrics for a revenue objective, sourced from attribution not platform analytics', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow, policy: { minimumBaselineSample: 3 } });
    await seedExperiment(store, profile.id, 'exp_rev', 'revenue');
    // Baseline revenue evidence, all from first-party attribution events.
    for (const [i, value] of [50, 60, 55, 58].entries()) {
      await ingestAttributionEvent(
        { profileId: profile.id, eventType: 'revenue', occurredAt: `2026-08-0${i + 1}T00:00:00Z`, value, currency: 'USD', source: 'stripe' },
        store,
      );
    }
    await ingestAttributionEvent(
      { profileId: profile.id, experimentId: 'exp_rev', eventType: 'revenue', occurredAt: '2026-08-19T00:00:00Z', value: 500, currency: 'USD', source: 'stripe' },
      store,
    );
    const assessment = await engine.assessExperimentOutcome('exp_rev');
    expect(assessment?.decidedOnMetric).toBe('revenue');
    expect(assessment?.verdict).toBe('winner');
  });

  it('uses the lead metric for a lead objective', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow, policy: { minimumBaselineSample: 3 } });
    await seedExperiment(store, profile.id, 'exp_lead', 'lead');
    for (const i of [1, 2, 3, 4]) {
      await ingestAttributionEvent(
        { profileId: profile.id, eventType: 'lead', occurredAt: `2026-08-0${i}T00:00:00Z`, source: 'crm' },
        store,
      );
    }
    const assessment = await engine.assessExperimentOutcome('exp_lead');
    // No lead evidence tied to this experiment — insufficient, not failure.
    expect(assessment?.verdict).toBe('insufficient_evidence');
  });

  it('uses the sale metric for a sale objective', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow, policy: { minimumBaselineSample: 3 } });
    await seedExperiment(store, profile.id, 'exp_sale', 'sale');
    expect(engine.metricsForObjective('sale')).toEqual(['sales']);
    const assessment = await engine.assessExperimentOutcome('exp_sale');
    expect(assessment?.objective).toBe('sale');
  });

  it('uses reach metrics for a reach objective', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [1000, 1000, 1000, 1000, 1000, 1000], 'impressions');
    await seedExperiment(store, profile.id, 'exp_reach', 'reach');
    const engine = new ScienceEngine(store, { now: fixedNow });
    await ingestMeasurementSnapshot(
      {
        profileId: profile.id,
        creatorOsAccountId: profile.creatorOsAccountId,
        creatorOsPostId: 'post_exp_reach',
        experimentId: 'exp_reach',
        capturedAt: '2026-08-19T00:00:00Z',
        sourcePlatform: 'threads',
        rawMetrics: { impressions: 5000 },
      },
      store,
    );
    const assessment = await engine.assessExperimentOutcome('exp_reach');
    expect(assessment?.decidedOnMetric).toBe('impressions');
    expect(assessment?.verdict).toBe('winner');
  });
});

describe('Science — paired experiments', () => {
  it('compares paired arms on the chosen metric', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id, 'exp_a', 'conversation', { pairId: 'P-001', variant: 'A' });
    await seedExperiment(store, profile.id, 'exp_b', 'conversation', { pairId: 'P-001', variant: 'B' });
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const [id, replies] of [['exp_a', 40], ['exp_b', 10]] as const) {
      await ingestMeasurementSnapshot(
        {
          profileId: profile.id,
          creatorOsAccountId: profile.creatorOsAccountId,
          creatorOsPostId: `post_${id}`,
          experimentId: id,
          capturedAt: '2026-08-19T00:00:00Z',
          sourcePlatform: 'threads',
          rawMetrics: { replies },
        },
        store,
      );
    }
    const pair = await engine.analyzePairedExperiments({ profileId: profile.id, pairId: 'P-001', metric: 'replies' });
    expect(pair?.winnerExperimentId).toBe('exp_a');
    expect(pair?.absoluteDifference).toBe(30);
  });

  it('marks a single pair as a limitation — one pair is never proof', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id, 'exp_a', 'conversation', { pairId: 'P-002', variant: 'A' });
    await seedExperiment(store, profile.id, 'exp_b', 'conversation', { pairId: 'P-002', variant: 'B' });
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const [id, replies] of [['exp_a', 40], ['exp_b', 10]] as const) {
      await ingestMeasurementSnapshot(
        {
          profileId: profile.id,
          creatorOsAccountId: profile.creatorOsAccountId,
          creatorOsPostId: `post_${id}`,
          experimentId: id,
          capturedAt: '2026-08-19T00:00:00Z',
          sourcePlatform: 'threads',
          rawMetrics: { replies },
        },
        store,
      );
    }
    const pair = await engine.analyzePairedExperiments({ profileId: profile.id, pairId: 'P-002', metric: 'replies' });
    expect(pair?.limitations).toContain('single_pair');
    expect(DEFAULT_SCIENCE_POLICY.minimumPairedSample).toBeGreaterThan(1);
  });

  it('surfaces a control mismatch as a limitation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id, 'exp_a', 'conversation', { pairId: 'P-003', variant: 'A' }, 'bench plateau');
    await seedExperiment(store, profile.id, 'exp_b', 'conversation', { pairId: 'P-003', variant: 'B' }, 'a totally different topic');
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const [id, replies] of [['exp_a', 40], ['exp_b', 10]] as const) {
      await ingestMeasurementSnapshot(
        {
          profileId: profile.id,
          creatorOsAccountId: profile.creatorOsAccountId,
          creatorOsPostId: `post_${id}`,
          experimentId: id,
          capturedAt: '2026-08-19T00:00:00Z',
          sourcePlatform: 'threads',
          rawMetrics: { replies },
        },
        store,
      );
    }
    const pair = await engine.analyzePairedExperiments({ profileId: profile.id, pairId: 'P-003', metric: 'replies' });
    expect(pair?.limitations).toContain('insufficient_controls');
  });
});

describe('Science — hypothesis evaluation', () => {
  async function setupHypothesis(store: JsonlIntelligenceStore, profileId: string) {
    const h = hypothesis({ profileId, scope: { level: 'profile', profileId } });
    await store.saveHypothesis(h);
    return h;
  }

  function comparison(id: string, relative: number) {
    return {
      id,
      profileId: 'prof_1',
      observationId: `obs_${id}`,
      metric: 'replies' as const,
      observedValue: 30,
      baselineMedian: 20,
      baselineSampleSize: 10,
      comparisonScope: { kind: 'all-recent-posts' as const },
      absoluteDifference: 10,
      relativeDifference: relative,
      effectSize: { metric: 'replies' as const, relativeChange: relative },
      direction: 'above' as const,
      limitations: [],
      measuredAt: NOW,
      createdAt: NOW,
    };
  }

  it('accumulates supporting evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const h = await setupHypothesis(store, profile.id);
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const i of [1, 2, 3, 4]) {
      await engine.recordHypothesisEvidence({
        hypothesisId: h.id,
        experimentId: `exp_${i}`,
        profileId: profile.id,
        comparison: comparison(`cmp_${i}`, 0.5),
        supports: true,
      });
    }
    const evaluation = await engine.evaluateHypothesis(h.id);
    expect(evaluation?.supportingCount).toBe(4);
    expect(evaluation?.status).toBe('supported');
  });

  it('accumulates contradicting evidence and never discards it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const h = await setupHypothesis(store, profile.id);
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      await engine.recordHypothesisEvidence({
        hypothesisId: h.id, experimentId: `exp_s${i}`, profileId: profile.id, comparison: comparison(`cs_${i}`, 0.5), supports: true,
      });
    }
    for (const i of [1, 2, 3, 4, 5]) {
      await engine.recordHypothesisEvidence({
        hypothesisId: h.id, experimentId: `exp_c${i}`, profileId: profile.id, comparison: comparison(`cc_${i}`, -0.4), supports: false,
      });
    }
    const evaluation = await engine.evaluateHypothesis(h.id);
    // Kairos must know both — 12 support, 5 contradict.
    expect(evaluation?.supportingCount).toBe(12);
    expect(evaluation?.contradictingCount).toBe(5);
    const contradicting = await store.listHypothesisEvidence({ hypothesisId: h.id, supports: false });
    expect(contradicting).toHaveLength(5);
  });

  it('reports inconclusive when evidence is plentiful but conflicting', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const h = await setupHypothesis(store, profile.id);
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const i of [1, 2, 3]) {
      await engine.recordHypothesisEvidence({ hypothesisId: h.id, experimentId: `exp_s${i}`, profileId: profile.id, comparison: comparison(`s${i}`, 0.3), supports: true });
      await engine.recordHypothesisEvidence({ hypothesisId: h.id, experimentId: `exp_c${i}`, profileId: profile.id, comparison: comparison(`c${i}`, -0.3), supports: false });
    }
    const evaluation = await engine.evaluateHypothesis(h.id);
    expect(evaluation?.status).toBe('inconclusive');
    // Deliberately distinct from "rejected".
    expect(evaluation?.status).not.toBe('rejected');
  });

  it('reports rejected when evidence consistently contradicts', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const h = await setupHypothesis(store, profile.id);
    const engine = new ScienceEngine(store, { now: fixedNow });
    for (const i of [1, 2, 3, 4, 5, 6]) {
      await engine.recordHypothesisEvidence({ hypothesisId: h.id, experimentId: `exp_${i}`, profileId: profile.id, comparison: comparison(`c${i}`, -0.6), supports: false });
    }
    const evaluation = await engine.evaluateHypothesis(h.id);
    expect(evaluation?.status).toBe('rejected');
  });

  it('stays in testing below the minimum hypothesis sample', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const h = await setupHypothesis(store, profile.id);
    const engine = new ScienceEngine(store, { now: fixedNow });
    await engine.recordHypothesisEvidence({ hypothesisId: h.id, experimentId: 'exp_1', profileId: profile.id, comparison: comparison('c1', 0.9), supports: true });
    const evaluation = await engine.evaluateHypothesis(h.id);
    expect(evaluation?.status).toBe('testing');
    expect(evaluation?.limitations).toContain('small_sample');
  });
});

describe('Science — finding emission and scope discipline', () => {
  const evaluation = (overrides: Partial<Parameters<ScienceEngine['emitFinding']>[0]['evaluation']> = {}) => ({
    hypothesisId: 'hyp_1',
    status: 'supported' as const,
    supportingCount: 8,
    contradictingCount: 0,
    confidence: 0.8,
    limitations: [],
    evaluatedAt: NOW,
    ...overrides,
  });

  it('emits a profile-scoped finding by default — the narrowest justified scope', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const finding = await engine.emitFinding({
      statement: 'Question-hook experiments were associated with higher reply rate for this profile under the tested conditions.',
      evaluation: evaluation(),
      context: { profileId: profile.id, objective: 'conversation' },
      sourceExperimentIds: ['exp_1', 'exp_2'],
    });
    expect(finding?.scope).toEqual({ level: 'profile', profileId: profile.id });
    expect(finding?.status).toBe('validated');
  });

  it('does not let one profile result become a global finding by itself', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const finding = await engine.emitFinding({
      statement: 'Associated with higher replies under tested conditions.',
      evaluation: evaluation(),
      context: { profileId: profile.id },
      sourceExperimentIds: ['exp_1'],
    });
    expect(finding!.scope.level).toBe('profile');
    expect(finding!.scope.level).not.toBe('global');
  });

  it('emits a promising (not validated) finding below the confidence threshold', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const finding = await engine.emitFinding({
      statement: 'Associated with higher replies under tested conditions.',
      evaluation: evaluation({ confidence: 0.5 }),
      context: { profileId: profile.id },
      sourceExperimentIds: ['exp_1'],
    });
    expect(finding?.status).toBe('promising');
  });

  it('refuses to emit a finding below the minimum evidence threshold', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const finding = await engine.emitFinding({
      statement: 'One breakout post.',
      evaluation: evaluation({ supportingCount: 1, contradictingCount: 0 }),
      context: { profileId: profile.id },
      sourceExperimentIds: ['exp_1'],
    });
    expect(finding).toBeNull();
  });

  it('refuses to emit a finding from an inconclusive evaluation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const finding = await engine.emitFinding({
      statement: 'Unclear.',
      evaluation: evaluation({ status: 'inconclusive', supportingCount: 5, contradictingCount: 5, confidence: 0.3 }),
      context: { profileId: profile.id },
      sourceExperimentIds: ['exp_1'],
    });
    expect(finding).toBeNull();
  });

  it('keeps segment-specific evidence segment-scoped', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const finding = await engine.emitFinding({
      statement: 'Associated with higher replies for this segment under tested conditions.',
      evaluation: evaluation(),
      context: { profileId: profile.id, audienceSegmentId: 'oseg_1' },
      sourceExperimentIds: ['exp_1'],
    });
    expect(finding?.audienceSegmentId).toBe('oseg_1');
    expect(finding?.scope).toEqual({ level: 'profile', profileId: profile.id });
  });

  it('uses conservative wording, never grand causal prose', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 10, 10, 10, 10, 10]);
    await seedExperiment(store, profile.id, 'exp_word', 'conversation');
    const engine = new ScienceEngine(store, { now: fixedNow });
    await ingestMeasurementSnapshot(
      { profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId, creatorOsPostId: 'post_exp_word', experimentId: 'exp_word', capturedAt: '2026-08-19T00:00:00Z', sourcePlatform: 'threads', rawMetrics: { replies: 40 } },
      store,
    );
    const report = await engine.buildExperimentReport('exp_word');
    expect(report?.conclusion).toContain('under the tested conditions');
    expect(report?.conclusion).not.toMatch(/always|guaranteed|proves/i);
  });
});

describe('Science — observed-association and research-lineage safeguards', () => {
  it('rejects a causal claim built directly from an observed association', () => {
    expect(() =>
      assertNotCausalFromObservation({ claimType: 'observed_association', causalStatus: 'causal_supported' }),
    ).toThrow(/controlled experimental evidence/);
  });

  it('allows an observed association to seed a hypothesis candidate', () => {
    expect(canSeedHypothesis({ claimType: 'observed_association' })).toBe(true);
  });

  it('leaves the original StrategyClaim unchanged after science processing', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const source = await ingestResearchSource({ sourceType: 'marketer', title: 'A marketer' }, store, NOW);
    if (!source.ok) throw new Error('source failed');
    const claim = await ingestStrategyClaim(
      { sourceId: source.source.id, statement: 'Question hooks increase replies.', claimType: 'playbook_claim', scope: { level: 'global' } },
      store,
      NOW,
    );
    if (!claim.ok) throw new Error('claim failed');

    // Run science processing that traces back to this claim's lineage.
    const h = hypothesis({ id: 'hyp_lineage', profileId: profile.id, scope: { level: 'profile', profileId: profile.id } });
    await store.saveHypothesis(h);
    const engine = new ScienceEngine(store, { now: fixedNow });
    await engine.evaluateHypothesis(h.id);

    const claimAfter = await store.getStrategyClaim(claim.claim.id);
    expect(claimAfter).toEqual(claim.claim);
  });

  it('preserves research lineage into a hypothesis via the claim id', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const source = await ingestResearchSource({ sourceType: 'creatoros_skill', title: 'Reply Skill' }, store, NOW);
    if (!source.ok) throw new Error('source failed');
    const claim = await ingestStrategyClaim(
      { sourceId: source.source.id, statement: 'Reply fast.', claimType: 'playbook_claim', scope: { level: 'global' } },
      store,
      NOW,
    );
    if (!claim.ok) throw new Error('claim failed');
    // The principle links the claim; the hypothesis is seeded from it.
    await store.saveStrategyPrinciple({
      id: 'sp_lineage',
      name: 'Fast replies may increase distribution',
      description: 'Normalized from a CreatorOS skill claim.',
      sourceType: 'playbook',
      scope: { level: 'profile', profileId: profile.id },
      applicablePlatforms: ['threads'],
      applicableObjectives: ['conversation'],
      status: 'hypothesis',
      confidence: 0.2,
      supportingClaimIds: [claim.claim.id],
      createdAt: NOW,
    });
    const principle = await store.getStrategyPrinciple('sp_lineage');
    expect(principle?.supportingClaimIds).toContain(claim.claim.id);
  });
});

describe('Science — decay, revalidation, retention', () => {
  const finding = (overrides: Partial<Finding> = {}): Finding => ({
    id: 'fnd_1',
    statement: 'Associated with higher replies under tested conditions.',
    scope: { level: 'profile', profileId: 'prof_1' },
    profileId: 'prof_1',
    sampleSize: 10,
    confidence: 0.8,
    status: 'validated',
    sourceExperimentIds: ['exp_1'],
    createdAt: '2025-01-01T00:00:00Z',
    lastValidatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  });

  it('detects decay from lastValidatedAt', async () => {
    const store = await tmpStore();
    const engine = new ScienceEngine(store, { now: fixedNow });
    expect(engine.assessFindingFreshness(finding({ lastValidatedAt: '2026-08-15T00:00:00Z' }))).toBe('current');
    expect(engine.assessFindingFreshness(finding({ lastValidatedAt: '2026-04-01T00:00:00Z' }))).toBe('due_for_revalidation');
    expect(engine.assessFindingFreshness(finding({ lastValidatedAt: '2025-01-01T00:00:00Z' }))).toBe('decaying');
  });

  it('identifies revalidation candidates without scheduling anything', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding({ id: 'fnd_stale', profileId: profile.id, scope: { level: 'profile', profileId: profile.id } }));
    await store.saveHypothesis(hypothesis({ id: 'hyp_unclear', profileId: profile.id, status: 'inconclusive' }));
    const engine = new ScienceEngine(store, { now: fixedNow });
    const candidates = await engine.identifyRevalidationCandidates(profile.id);
    expect(candidates.map((c) => c.subjectId).sort()).toEqual(['fnd_stale', 'hyp_unclear']);
    expect(candidates.every((c) => typeof c.reason === 'string')).toBe(true);
  });

  it('retains rejected and decaying findings rather than deleting them', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding({ id: 'fnd_rejected', profileId: profile.id, status: 'rejected', scope: { level: 'profile', profileId: profile.id } }));
    await store.saveFinding(finding({ id: 'fnd_decaying', profileId: profile.id, status: 'decaying', scope: { level: 'profile', profileId: profile.id } }));
    const engine = new ScienceEngine(store, { now: fixedNow });
    await engine.identifyRevalidationCandidates(profile.id);
    const all = await store.listFindings({ profileId: profile.id });
    expect(all.map((f) => f.id).sort()).toEqual(['fnd_decaying', 'fnd_rejected']);
  });
});

describe('Science — reports, limitations, lineage', () => {
  async function reportSetup() {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 10, 10, 10, 10, 10]);
    await seedExperiment(store, profile.id, 'exp_report', 'conversation');
    const engine = new ScienceEngine(store, { now: fixedNow });
    await ingestMeasurementSnapshot(
      { profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId, creatorOsPostId: 'post_exp_report', experimentId: 'exp_report', capturedAt: '2026-08-19T00:00:00Z', sourcePlatform: 'threads', rawMetrics: { replies: 40 } },
      store,
    );
    return { store, profile, engine };
  }

  it('includes limitations in the report', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedExperiment(store, profile.id, 'exp_thin', 'conversation');
    const engine = new ScienceEngine(store, { now: fixedNow });
    await ingestMeasurementSnapshot(
      { profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId, creatorOsPostId: 'post_exp_thin', experimentId: 'exp_thin', capturedAt: NOW, sourcePlatform: 'threads', rawMetrics: { replies: 40 } },
      store,
    );
    const report = await engine.buildExperimentReport('exp_thin');
    expect(report!.limitations.length).toBeGreaterThan(0);
    expect(report!.limitations).toContain('small_sample');
  });

  it('includes lineage in the report', async () => {
    const { engine } = await reportSetup();
    const report = await engine.buildExperimentReport('exp_report');
    expect(report!.lineage).toContain('exp_report');
    expect(report!.lineage.length).toBeGreaterThan(1);
  });

  it('reports a confidence between 0 and 1', async () => {
    const { engine } = await reportSetup();
    const report = await engine.buildExperimentReport('exp_report');
    expect(report!.confidence).toBeGreaterThanOrEqual(0);
    expect(report!.confidence).toBeLessThanOrEqual(1);
  });
});

describe('Science — invariants: no AI, no mutation, no CreatorOS, port-only', () => {
  it('leaves raw observations unchanged after analysis', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 10, 10, 10, 10, 10]);
    const before = await store.listPostMeasurements({ profileId: profile.id });
    const engine = new ScienceEngine(store, { now: fixedNow });
    await engine.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' });
    const after = await store.listPostMeasurements({ profileId: profile.id });
    expect(after).toEqual(before);
  });

  it('does not mutate profile strategy during analysis', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 10, 10, 10, 10, 10]);
    const engine = new ScienceEngine(store, { now: fixedNow });
    await engine.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' });
    const reloaded = await store.getProfile(profile.id);
    expect(reloaded).toEqual(profile);
  });

  it('generates no content — the engine exposes only analysis methods', () => {
    const methods = Object.getOwnPropertyNames(ScienceEngine.prototype);
    expect(methods.some((m) => /generate|write|post|publish|schedule/i.test(m))).toBe(false);
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    // A minimal hand-rolled store satisfying only what the engine uses proves
    // the dependency is structural, not on JsonlIntelligenceStore.
    const calls: string[] = [];
    const fakeStore = {
      listPostMeasurements: async () => { calls.push('listPostMeasurements'); return []; },
      listAttributionEvents: async () => { calls.push('listAttributionEvents'); return []; },
    } as unknown as IntelligenceStore;
    const engine = new ScienceEngine(fakeStore, { now: fixedNow });
    const baseline = await engine.calculateProfileBaseline({ profileId: 'prof_1', metric: 'replies' });
    expect(baseline).toBeNull();
    expect(calls).toEqual(['listPostMeasurements', 'listAttributionEvents']);
  });

  it('preserves science evidence across store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-science-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const profileResult = await onboardProfile(onboardingInput(), first, NOW);
    if (!profileResult.ok) throw new Error('seed failed');
    const h = hypothesis({ profileId: profileResult.profile.id });
    await first.saveHypothesis(h);
    const engine = new ScienceEngine(first, { now: fixedNow });
    await engine.recordHypothesisEvidence({
      hypothesisId: h.id,
      experimentId: 'exp_1',
      profileId: profileResult.profile.id,
      comparison: {
        id: 'cmp_persist', profileId: profileResult.profile.id, observationId: 'obs_1', metric: 'replies',
        observedValue: 30, baselineMedian: 20, baselineSampleSize: 10,
        comparisonScope: { kind: 'all-recent-posts' }, absoluteDifference: 10, relativeDifference: 0.5,
        effectSize: { metric: 'replies', relativeChange: 0.5 }, direction: 'above', limitations: [],
        measuredAt: NOW, createdAt: NOW,
      },
      supports: true,
    });

    const second = new JsonlIntelligenceStore(root);
    const evidence = await second.listHypothesisEvidence({ hypothesisId: h.id });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.supports).toBe(true);
  });

  it('analyzes multiple observations across time', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await seedBaselineMeasurements(store, profile, [10, 11, 12, 13, 14, 15]);
    const engine = new ScienceEngine(store, { now: fixedNow });
    const observations = await engine.loadObservations(profile.id);
    expect(observations.length).toBe(6);
    expect(new Set(observations.map((o) => o.measuredAt)).size).toBeGreaterThan(1);
  });

  it('never fabricates revenue from platform analytics', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot(
      { profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId, creatorOsPostId: 'post_viral', capturedAt: NOW, sourcePlatform: 'threads', rawMetrics: { impressions: 900000, views: 800000 } },
      store,
    );
    const engine = new ScienceEngine(store, { now: fixedNow });
    const observations = await engine.loadObservations(profile.id);
    expect(observations.some((o) => o.metric === 'revenue')).toBe(false);
  });

  it('uses attribution events only for their appropriate business metrics', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestAttributionEvent(
      { profileId: profile.id, eventType: 'purchase', occurredAt: NOW, value: 79, currency: 'USD', source: 'stripe' },
      store,
    );
    const engine = new ScienceEngine(store, { now: fixedNow });
    const observations = await engine.loadObservations(profile.id);
    const metrics = observations.map((o) => o.metric).sort();
    expect(metrics).toEqual(['revenue', 'sales']);
    // A purchase never contributes an attention/engagement metric.
    expect(metrics).not.toContain('impressions');
  });
});
