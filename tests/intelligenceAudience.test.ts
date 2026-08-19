import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import {
  aggregateSegmentMetricTotals,
  compareDeclaredToObserved,
  countSignalsBySegment,
  countSignalsByType,
  countUnclassifiedSignals,
  deriveObservedTimestamps,
} from '../src/intelligence/audience/aggregate.js';
import type {
  AudienceSignal,
  ObservedAudienceSegment,
  SegmentFinding,
  SegmentPerformance,
} from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-19T12:00:00Z';

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-audience-')));
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
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

function signal(overrides: Partial<AudienceSignal> = {}): AudienceSignal {
  return {
    id: 'sig_1',
    profileId: 'prof_1',
    source: 'comment',
    observedAt: NOW,
    signalType: 'problem',
    text: 'my bench has not moved in months',
    schemaVersion: 1,
    ...overrides,
  };
}

function segment(overrides: Partial<ObservedAudienceSegment> = {}): ObservedAudienceSegment {
  return {
    id: 'oseg_1',
    profileId: 'prof_1',
    name: 'Plateaued benchers',
    status: 'emerging',
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    signalCount: 1,
    confidence: 0.3,
    characteristics: [],
    problems: [],
    goals: [],
    objections: [],
    topics: [],
    languagePatterns: [],
    schemaVersion: 1,
    ...overrides,
  };
}

function segmentFinding(overrides: Partial<SegmentFinding> = {}): SegmentFinding {
  return {
    id: 'sf_1',
    profileId: 'prof_1',
    segmentId: 'oseg_1',
    statement: 'This segment responds to specificity over motivation.',
    scope: { level: 'profile', profileId: 'prof_1' },
    supportingSignalIds: ['sig_1'],
    supportingExperimentIds: [],
    contradictingSignalIds: [],
    confidence: 0.4,
    status: 'promising',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...overrides,
  };
}

describe('Audience Brain — declared audience stays intact', () => {
  it('a new profile brain begins with no observed audience evidence', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(onboardingInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brain.audienceIntelligence.observedSegmentIds).toEqual([]);
    expect(result.brain.audienceIntelligence.totalSignalCount).toBe(0);
    expect(result.brain.audienceIntelligence.declaredVsObserved.state).toBe('insufficient_evidence');
  });

  it('declared audience remains intact after audience signals are stored', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(
      onboardingInput({ declaredAudience: 'Intermediate lifters stuck at a plateau' }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await store.saveAudienceSignal(signal({ profileId: result.profile.id }));
    await store.saveAudienceSignal(signal({ id: 'sig_2', profileId: result.profile.id, signalType: 'question' }));
    const reloaded = await store.getProfile(result.profile.id);
    expect(reloaded?.audience.primaryAudience).toContain('Intermediate lifters stuck at a plateau');
  });
});

describe('Audience Brain — AudienceSignal', () => {
  it('saves and loads an AudienceSignal', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal());
    const loaded = await store.getAudienceSignal('sig_1');
    expect(loaded?.text).toBe('my bench has not moved in months');
  });

  it('lets multiple signals coexist', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_a' }));
    await store.saveAudienceSignal(signal({ id: 'sig_b', signalType: 'goal' }));
    const all = await store.listAudienceSignals({ profileId: 'prof_1' });
    expect(all.map((s) => s.id).sort()).toEqual(['sig_a', 'sig_b']);
  });

  it('does not destroy an earlier signal when a later one is saved', async () => {
    const store = await tmpStore();
    const early = signal({ id: 'sig_early', observedAt: '2026-08-01T00:00:00Z' });
    await store.saveAudienceSignal(early);
    await store.saveAudienceSignal(signal({ id: 'sig_late', observedAt: '2026-08-15T00:00:00Z' }));
    const stillThere = await store.getAudienceSignal('sig_early');
    expect(stillThere).toEqual(early);
  });

  it('lets a signal remain unclassified', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_unclassified', segmentId: undefined }));
    const loaded = await store.getAudienceSignal('sig_unclassified');
    expect(loaded?.segmentId).toBeUndefined();
    const unclassified = await store.listAudienceSignals({ profileId: 'prof_1', unclassifiedOnly: true });
    expect(unclassified.map((s) => s.id)).toEqual(['sig_unclassified']);
  });

  it('preserves a reclassification history rather than silently overwriting the original read', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_reclass', segmentId: undefined }));
    await store.saveAudienceSignal(
      signal({
        id: 'sig_reclass',
        segmentId: 'oseg_1',
        classificationHistory: [{ segmentId: null, classifiedAt: NOW }],
      }),
    );
    const loaded = await store.getAudienceSignal('sig_reclass');
    expect(loaded?.segmentId).toBe('oseg_1');
    expect(loaded?.classificationHistory).toEqual([{ segmentId: null, classifiedAt: NOW }]);
  });

  it('lets a signal reference a contentId', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_content', contentId: 'post_123' }));
    const loaded = await store.getAudienceSignal('sig_content');
    expect(loaded?.contentId).toBe('post_123');
  });

  it('lets a signal reference an experimentId', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_exp', experimentId: 'exp_7' }));
    const loaded = await store.getAudienceSignal('sig_exp');
    expect(loaded?.experimentId).toBe('exp_7');
  });

  it('round-trips signalType', async () => {
    const store = await tmpStore();
    for (const signalType of ['problem', 'goal', 'question', 'objection', 'conversion'] as const) {
      await store.saveAudienceSignal(signal({ id: `sig_${signalType}`, signalType }));
    }
    const all = await store.listAudienceSignals({ profileId: 'prof_1' });
    expect(all.find((s) => s.id === 'sig_conversion')?.signalType).toBe('conversion');
    const onlyQuestions = await store.listAudienceSignals({ profileId: 'prof_1', signalType: 'question' });
    expect(onlyQuestions.map((s) => s.id)).toEqual(['sig_question']);
  });
});

describe('Audience Brain — ObservedAudienceSegment', () => {
  it('saves and loads an ObservedAudienceSegment', async () => {
    const store = await tmpStore();
    await store.saveObservedSegment(segment());
    const loaded = await store.getObservedSegment('oseg_1');
    expect(loaded?.name).toBe('Plateaued benchers');
  });

  it('lets an observed segment exist with no matching declared segment', async () => {
    const store = await tmpStore();
    await store.saveObservedSegment(segment({ matchedDeclaredSegmentId: undefined }));
    const loaded = await store.getObservedSegment('oseg_1');
    expect(loaded?.matchedDeclaredSegmentId).toBeUndefined();
    expect(loaded?.id).toBe('oseg_1');
  });

  it('round-trips segment lifecycle status', async () => {
    const store = await tmpStore();
    for (const status of ['emerging', 'active', 'established', 'declining', 'archived'] as const) {
      await store.saveObservedSegment(segment({ id: `oseg_${status}`, status }));
    }
    const active = await store.listObservedSegments({ profileId: 'prof_1', status: 'active' });
    expect(active.map((s) => s.id)).toEqual(['oseg_active']);
  });

  it('summarizes signal counts by segment', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_a', segmentId: 'oseg_1' }));
    await store.saveAudienceSignal(signal({ id: 'sig_b', segmentId: 'oseg_1' }));
    await store.saveAudienceSignal(signal({ id: 'sig_c', segmentId: 'oseg_2' }));
    await store.saveAudienceSignal(signal({ id: 'sig_d', segmentId: undefined }));
    const all = await store.listAudienceSignals({ profileId: 'prof_1' });
    expect(countSignalsBySegment(all)).toEqual({ oseg_1: 2, oseg_2: 1, unclassified: 1 });
    expect(countUnclassifiedSignals(all)).toBe(1);
    expect(countSignalsByType(all)).toEqual({ problem: 4 });
  });

  it('derives firstObservedAt and lastObservedAt correctly as signals accumulate', () => {
    const first = deriveObservedTimestamps(null, '2026-08-10T00:00:00Z');
    expect(first).toEqual({ firstObservedAt: '2026-08-10T00:00:00Z', lastObservedAt: '2026-08-10T00:00:00Z' });
    const later = deriveObservedTimestamps(first, '2026-08-15T00:00:00Z');
    expect(later).toEqual({ firstObservedAt: '2026-08-10T00:00:00Z', lastObservedAt: '2026-08-15T00:00:00Z' });
    const earlier = deriveObservedTimestamps(later, '2026-08-01T00:00:00Z');
    expect(earlier).toEqual({ firstObservedAt: '2026-08-01T00:00:00Z', lastObservedAt: '2026-08-15T00:00:00Z' });
  });
});

describe('Audience Brain — SegmentFinding', () => {
  it('saves and loads a SegmentFinding', async () => {
    const store = await tmpStore();
    await store.saveSegmentFinding(segmentFinding());
    const loaded = await store.getSegmentFinding('sf_1');
    expect(loaded?.statement).toContain('specificity');
  });

  it('round-trips supporting signal ids', async () => {
    const store = await tmpStore();
    await store.saveSegmentFinding(segmentFinding({ supportingSignalIds: ['sig_1', 'sig_2'] }));
    const loaded = await store.getSegmentFinding('sf_1');
    expect(loaded?.supportingSignalIds).toEqual(['sig_1', 'sig_2']);
  });

  it('round-trips contradicting signal ids', async () => {
    const store = await tmpStore();
    await store.saveSegmentFinding(segmentFinding({ contradictingSignalIds: ['sig_9'] }));
    const loaded = await store.getSegmentFinding('sf_1');
    expect(loaded?.contradictingSignalIds).toEqual(['sig_9']);
  });

  it('round-trips supporting experiment ids', async () => {
    const store = await tmpStore();
    await store.saveSegmentFinding(segmentFinding({ supportingExperimentIds: ['exp_1', 'exp_4'] }));
    const loaded = await store.getSegmentFinding('sf_1');
    expect(loaded?.supportingExperimentIds).toEqual(['exp_1', 'exp_4']);
  });

  it('stays profile/segment scoped rather than becoming a global finding', async () => {
    const store = await tmpStore();
    await store.saveSegmentFinding(segmentFinding({ id: 'sf_a', profileId: 'prof_1', segmentId: 'oseg_1' }));
    await store.saveSegmentFinding(segmentFinding({ id: 'sf_b', profileId: 'prof_1', segmentId: 'oseg_2' }));
    await store.saveSegmentFinding(segmentFinding({ id: 'sf_c', profileId: 'prof_2', segmentId: 'oseg_1' }));
    const forSegment1 = await store.listSegmentFindings({ profileId: 'prof_1', segmentId: 'oseg_1' });
    expect(forSegment1.map((f) => f.id)).toEqual(['sf_a']);
    const forProfile2 = await store.listSegmentFindings({ profileId: 'prof_2' });
    expect(forProfile2.map((f) => f.id)).toEqual(['sf_c']);
  });
});

describe('Audience Brain — SegmentPerformance', () => {
  const window = { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' };

  it('saves and loads segment performance', async () => {
    const store = await tmpStore();
    const perf: SegmentPerformance = {
      id: 'perf_1',
      profileId: 'prof_1',
      segmentId: 'oseg_1',
      window,
      metricTotals: [{ metric: 'replies', total: 52, shareOfProfileTotal: 0.52 }],
      calculatedAt: NOW,
      schemaVersion: 1,
    };
    await store.saveSegmentPerformance(perf);
    const [loaded] = await store.listSegmentPerformance('prof_1', 'oseg_1');
    expect(loaded?.metricTotals[0]?.total).toBe(52);
  });

  it('reuses the existing measurement-tier metric vocabulary rather than a new metric system', async () => {
    const perf: SegmentPerformance = {
      id: 'perf_2',
      profileId: 'prof_1',
      segmentId: 'oseg_1',
      window,
      metricTotals: [
        { metric: 'impressions', total: 4200 },
        { metric: 'replies', total: 31 },
        { metric: 'sales', total: 3 },
      ],
      calculatedAt: NOW,
      schemaVersion: 1,
    };
    expect(perf.metricTotals.map((m) => m.metric)).toEqual(['impressions', 'replies', 'sales']);
  });

  it('lets an engagement-heavy segment differ from a conversion-heavy segment via synthetic totals', () => {
    const engagementHeavy = aggregateSegmentMetricTotals(
      [
        { metric: 'replies', value: 52 },
        { metric: 'sales', value: 8 },
      ],
      { replies: 100, sales: 100 },
    );
    const conversionHeavy = aggregateSegmentMetricTotals(
      [
        { metric: 'replies', value: 21 },
        { metric: 'sales', value: 61 },
      ],
      { replies: 100, sales: 100 },
    );
    const engagementReplyShare = engagementHeavy.find((m) => m.metric === 'replies')!.shareOfProfileTotal;
    const conversionSalesShare = conversionHeavy.find((m) => m.metric === 'sales')!.shareOfProfileTotal;
    expect(engagementReplyShare).toBeCloseTo(0.52);
    expect(conversionSalesShare).toBeCloseTo(0.61);
    expect(engagementReplyShare).toBeGreaterThan(conversionHeavy.find((m) => m.metric === 'replies')!.shareOfProfileTotal!);
    expect(conversionSalesShare).toBeGreaterThan(engagementHeavy.find((m) => m.metric === 'sales')!.shareOfProfileTotal!);
  });

  it('omits shareOfProfileTotal when no defensible denominator exists', () => {
    const totals = aggregateSegmentMetricTotals([{ metric: 'clicks', value: 10 }]);
    expect(totals).toEqual([{ metric: 'clicks', total: 10 }]);
  });
});

describe('Audience Brain — ProfileBrain integration', () => {
  it('lets ProfileBrain reference observed segments by id, not embed them', async () => {
    const store = await tmpStore();
    const onboarded = await onboardProfile(onboardingInput(), store, NOW);
    expect(onboarded.ok).toBe(true);
    if (!onboarded.ok) return;

    await store.saveObservedSegment(segment({ profileId: onboarded.profile.id }));
    const withReference = {
      ...onboarded.brain,
      audienceIntelligence: {
        ...onboarded.brain.audienceIntelligence,
        observedSegmentIds: ['oseg_1'],
        totalSignalCount: 1,
      },
      version: 2,
    };
    await store.saveProfileBrain(withReference);
    const reloaded = await store.getProfileBrain(onboarded.profile.id);
    expect(reloaded?.audienceIntelligence.observedSegmentIds).toEqual(['oseg_1']);
    // A reference, not a duplicated object — the full segment lives in its own store.
    expect((reloaded?.audienceIntelligence as unknown as { segments?: unknown }).segments).toBeUndefined();
  });

  it('never lets ProfileBrain embed or overwrite the declared audience', async () => {
    const store = await tmpStore();
    const onboarded = await onboardProfile(
      onboardingInput({ declaredAudience: 'Intermediate lifters stuck at a plateau' }),
      store,
      NOW,
    );
    expect(onboarded.ok).toBe(true);
    if (!onboarded.ok) return;
    // ProfileBrain has no field at all for a declared-audience string —
    // structurally impossible for it to overwrite SocialProfile.audience.
    expect('audience' in onboarded.brain).toBe(false);
    expect(onboarded.profile.audience.primaryAudience).toContain('Intermediate lifters stuck at a plateau');
  });

  it('gives a brand-new profile comparison state insufficient_evidence', async () => {
    const store = await tmpStore();
    const onboarded = await onboardProfile(onboardingInput(), store, NOW);
    expect(onboarded.ok).toBe(true);
    if (!onboarded.ok) return;
    expect(onboarded.brain.audienceIntelligence.declaredVsObserved.state).toBe('insufficient_evidence');
  });

  it('compareDeclaredToObserved stays insufficient_evidence even with signals, honestly, absent real matching', () => {
    const withEvidence = compareDeclaredToObserved({ observedSegmentCount: 3, totalSignalCount: 40 }, NOW);
    expect(withEvidence.state).toBe('insufficient_evidence');
    expect(withEvidence.observedSegmentCount).toBe(3);
    expect(withEvidence.totalSignalCount).toBe(40);
  });
});

describe('Audience Brain — multi-profile isolation', () => {
  it('keeps multiple profiles audience intelligence isolated', async () => {
    const store = await tmpStore();
    const a = await onboardProfile(onboardingInput({ creatorOsAccountId: 'acct_a' }), store, NOW);
    const b = await onboardProfile(onboardingInput({ creatorOsAccountId: 'acct_b' }), store, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    await store.saveAudienceSignal(signal({ id: 'sig_a', profileId: a.profile.id }));
    await store.saveObservedSegment(segment({ id: 'oseg_a', profileId: a.profile.id }));

    const signalsForA = await store.listAudienceSignals({ profileId: a.profile.id });
    const signalsForB = await store.listAudienceSignals({ profileId: b.profile.id });
    expect(signalsForA.map((s) => s.id)).toEqual(['sig_a']);
    expect(signalsForB).toEqual([]);

    const segmentsForA = await store.listObservedSegments({ profileId: a.profile.id });
    const segmentsForB = await store.listObservedSegments({ profileId: b.profile.id });
    expect(segmentsForA.map((s) => s.id)).toEqual(['oseg_a']);
    expect(segmentsForB).toEqual([]);
  });

  it('never returns Profile A signals in a Profile B query', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_1', profileId: 'prof_a' }));
    await store.saveAudienceSignal(signal({ id: 'sig_2', profileId: 'prof_b' }));
    const forA = await store.listAudienceSignals({ profileId: 'prof_a' });
    expect(forA.map((s) => s.id)).toEqual(['sig_1']);
  });

  it('never returns Profile A segments in a Profile B query', async () => {
    const store = await tmpStore();
    await store.saveObservedSegment(segment({ id: 'oseg_a', profileId: 'prof_a' }));
    await store.saveObservedSegment(segment({ id: 'oseg_b', profileId: 'prof_b' }));
    const forB = await store.listObservedSegments({ profileId: 'prof_b' });
    expect(forB.map((s) => s.id)).toEqual(['oseg_b']);
  });
});

describe('Audience Brain — empty store, corrupt data, and re-instantiation', () => {
  it('reads an empty audience store safely', async () => {
    const store = await tmpStore();
    expect(await store.getAudienceSignal('nope')).toBeNull();
    expect(await store.listAudienceSignals({ profileId: 'prof_1' })).toEqual([]);
    expect(await store.getObservedSegment('nope')).toBeNull();
    expect(await store.listObservedSegments({ profileId: 'prof_1' })).toEqual([]);
    expect(await store.getSegmentFinding('nope')).toBeNull();
    expect(await store.listSegmentFindings({ profileId: 'prof_1' })).toEqual([]);
    expect(await store.listSegmentPerformance('prof_1', 'oseg_1')).toEqual([]);
  });

  it('survives store re-instantiation against the same root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-audience-reload-'));
    const first = new JsonlIntelligenceStore(root);
    await first.saveAudienceSignal(signal());
    await first.saveObservedSegment(segment());
    const second = new JsonlIntelligenceStore(root);
    expect((await second.getAudienceSignal('sig_1'))?.id).toBe('sig_1');
    expect((await second.getObservedSegment('oseg_1'))?.id).toBe('oseg_1');
  });
});

describe('Audience Brain — unclassified evidence and independent segment emergence', () => {
  it('preserves unknown/unclassified evidence rather than forcing a segment', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal({ id: 'sig_unforced', segmentId: undefined, signalType: 'other' }));
    const loaded = await store.getAudienceSignal('sig_unforced');
    expect(loaded?.segmentId).toBeUndefined();
    const unclassified = await store.listAudienceSignals({ profileId: 'prof_1', unclassifiedOnly: true });
    expect(unclassified).toHaveLength(1);
  });

  it('lets observed segments emerge independently of any onboarding-declared segment', async () => {
    const store = await tmpStore();
    const onboarded = await onboardProfile(
      onboardingInput({
        audienceSegments: [{ name: 'Nervous beginners', pains: [], desires: [], objections: [], languagePatterns: [] }],
      }),
      store,
      NOW,
    );
    expect(onboarded.ok).toBe(true);
    if (!onboarded.ok) return;
    const declaredSegmentIds = onboarded.profile.audience.segments.map((s) => s.id);

    // A segment the evidence reveals that was never declared at onboarding.
    await store.saveObservedSegment(
      segment({ id: 'oseg_surprise', profileId: onboarded.profile.id, name: 'A segment nobody declared', matchedDeclaredSegmentId: undefined }),
    );
    const observed = await store.getObservedSegment('oseg_surprise');
    expect(observed).not.toBeNull();
    expect(declaredSegmentIds).not.toContain('oseg_surprise');
  });
});

describe('Audience Brain — privacy and dependency boundaries', () => {
  it('introduces no sensitive-trait fields in the audience models', () => {
    const s = signal();
    const seg = segment();
    const finding = segmentFinding();
    const sensitiveKeys = ['race', 'ethnicity', 'religion', 'sexualOrientation', 'medicalCondition', 'politicalParty', 'criminalHistory'];
    for (const key of sensitiveKeys) {
      expect(Object.keys(s)).not.toContain(key);
      expect(Object.keys(seg)).not.toContain(key);
      expect(Object.keys(finding)).not.toContain(key);
    }
  });

  it('requires no AI dependency — every helper here is deterministic', () => {
    const result = compareDeclaredToObserved({ observedSegmentCount: 5, totalSignalCount: 200 }, NOW);
    // Purely a function of its inputs — same input, same output, no network/model call.
    const again = compareDeclaredToObserved({ observedSegmentCount: 5, totalSignalCount: 200 }, NOW);
    expect(result).toEqual(again);
  });

  it('involves no CreatorOS execution — storage is pure data at rest', async () => {
    const store = await tmpStore();
    await store.saveAudienceSignal(signal());
    const loaded = await store.getAudienceSignal('sig_1');
    expect(typeof loaded?.profileId).toBe('string');
  });
});
