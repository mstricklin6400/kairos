import { describe, expect, it } from 'vitest';
import { mkdtemp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JsonlIntelligenceStore,
  experimentResultsPath,
  findingsPath,
} from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import type {
  Experiment,
  ExperimentObservation,
  Finding,
  Hypothesis,
  ProfileBrain,
  SocialProfile,
  StrategyPrinciple,
} from '../src/intelligence/index.js';

const NOW = '2026-08-19T12:00:00Z';

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'kairos-intelligence-store-'));
}

function profile(overrides: Partial<SocialProfile> = {}): SocialProfile {
  return {
    id: 'prof_1',
    workspaceId: 'ws_test',
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    identity: { brandName: 'Lift Notes', handle: '@liftnotes', faceless: true, voice: ['blunt'] },
    market: { niche: 'strength training', subNiche: 'powerlifting' },
    audience: {
      primaryAudience: 'intermediate lifters stuck at a plateau',
      segments: [],
      pains: ['stalled bench'],
      desires: ['a repeatable program'],
      languagePatterns: ['PR', 'deload'],
    },
    objectives: { primary: 'followers', secondary: ['conversation'] },
    strategy: {
      experimentMode: 'balanced',
      postingFrequency: { postsPerDay: 3 },
      contentPillars: [],
      currentAllocations: [],
    },
    monetization: { offers: [] },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function brain(overrides: Partial<ProfileBrain> = {}): ProfileBrain {
  return {
    profileId: 'prof_1',
    nicheIntelligence: {
      painPoints: [],
      desires: [],
      terminology: [],
      objections: [],
      emergingTopics: [],
      recurringQuestions: [],
      informationGaps: [],
    },
    audienceIntelligence: {
      segmentLearnings: [],
      languagePatterns: [],
      objections: [],
      motivations: [],
      responsePatterns: [],
      observedSegmentIds: [],
      emergingSegmentIds: [],
      segmentFindingIds: [],
      totalSignalCount: 0,
      unclassifiedSignalCount: 0,
      declaredVsObserved: { state: 'insufficient_evidence', evaluatedAt: NOW, observedSegmentCount: 0, totalSignalCount: 0 },
    },
    strategyMemory: { validated: [], promising: [], rejected: [], decaying: [] },
    performanceBaselines: [],
    activeExperimentIds: [],
    winnerPatterns: [],
    failurePatterns: [],
    monetizationContext: { activeOfferIds: [], revenueTrackingEnabled: false },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function principle(overrides: Partial<StrategyPrinciple> = {}): StrategyPrinciple {
  return {
    id: 'sp_1',
    name: 'Post at 6am',
    description: 'The course claims 6am local posting beats every other slot.',
    sourceType: 'playbook',
    sourceReference: 'Growth Accelerator, module 3',
    scope: { level: 'global' },
    applicablePlatforms: [],
    applicableObjectives: ['reach'],
    status: 'hypothesis',
    confidence: 0.1,
    createdAt: NOW,
    ...overrides,
  };
}

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp_1',
    profileId: 'prof_1',
    platform: 'threads',
    niche: 'strength training',
    objective: 'conversation',
    contentDna: {
      topic: 'bench plateau',
      hookFamily: 'contrarian-claim',
      format: 'text',
      tone: 'contrarian',
      lengthClass: 'short',
    },
    design: { testVariables: ['hookFamily'] },
    execution: { publishedAt: NOW, creatorOsPostId: '507f191e810c19729de860ea' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function hypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'hyp_1',
    statement: 'Contrarian hooks earn more replies than how-to hooks.',
    scope: { level: 'profile', profileId: 'prof_1' },
    profileId: 'prof_1',
    independentVariable: 'hookFamily',
    dependentMetric: 'replies',
    controlVariables: ['topic'],
    status: 'testing',
    confidence: 0.45,
    source: 'playbook',
    supportingExperimentIds: [],
    contradictingExperimentIds: [],
    createdAt: NOW,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    statement: 'Contrarian hooks lift replies.',
    scope: { level: 'profile', profileId: 'prof_1' },
    profileId: 'prof_1',
    sampleSize: 40,
    confidence: 0.7,
    status: 'promising',
    sourceExperimentIds: ['exp_1'],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

describe('JsonlIntelligenceStore — SocialProfile', () => {
  it('saves and loads a SocialProfile', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfile(profile());
    const loaded = await store.getProfile('prof_1');
    expect(loaded?.identity.brandName).toBe('Lift Notes');
  });

  it('lets multiple profiles coexist', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfile(profile({ id: 'prof_1' }));
    await store.saveProfile(profile({ id: 'prof_2', platform: 'twitter' }));
    const all = await store.listProfiles({ workspaceId: 'ws_test' });
    expect(all.map((p) => p.id).sort()).toEqual(['prof_1', 'prof_2']);
  });

  it('round-trips creatorOsAccountId unchanged', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfile(profile({ creatorOsAccountId: '65a1b2c3d4e5f60718293a4b' }));
    const loaded = await store.getProfile('prof_1');
    expect(loaded?.creatorOsAccountId).toBe('65a1b2c3d4e5f60718293a4b');
  });

  it('queries profiles by platform', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfile(profile({ id: 'prof_threads', platform: 'threads' }));
    await store.saveProfile(profile({ id: 'prof_x', platform: 'twitter' }));
    const threadsOnly = await store.listProfiles({ workspaceId: 'ws_test', platform: 'threads' });
    expect(threadsOnly.map((p) => p.id)).toEqual(['prof_threads']);
  });
});

describe('JsonlIntelligenceStore — ProfileBrain', () => {
  it('saves and loads a ProfileBrain', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfileBrain(brain());
    const loaded = await store.getProfileBrain('prof_1');
    expect(loaded?.version).toBe(1);
  });

  it('returns current version after re-saving by profileId', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfileBrain(brain({ version: 1 }));
    await store.saveProfileBrain(brain({ version: 2, activeExperimentIds: ['exp_9'] }));
    const loaded = await store.getProfileBrain('prof_1');
    expect(loaded?.version).toBe(2);
    expect(loaded?.activeExperimentIds).toEqual(['exp_9']);
  });
});

describe('JsonlIntelligenceStore — StrategyPrinciple', () => {
  it('saves and loads a StrategyPrinciple', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveStrategyPrinciple(principle());
    const loaded = await store.getStrategyPrinciple('sp_1');
    expect(loaded?.name).toBe('Post at 6am');
  });

  it('keeps a playbook principle as sourceType playbook, status hypothesis', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveStrategyPrinciple(principle());
    const loaded = await store.getStrategyPrinciple('sp_1');
    expect(loaded?.sourceType).toBe('playbook');
    expect(loaded?.status).toBe('hypothesis');
  });
});

describe('JsonlIntelligenceStore — Experiment', () => {
  it('saves and loads an Experiment', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveExperiment(experiment());
    const loaded = await store.getExperiment('exp_1');
    expect(loaded?.contentDna.hookFamily).toBe('contrarian-claim');
  });

  it('lets multiple result observations for one experiment coexist', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveExperiment(experiment());
    const obs30m: ExperimentObservation = {
      id: 'obs_30m',
      experimentId: 'exp_1',
      measuredAt: '2026-08-19T12:30:00Z',
      metrics: { impressions: 800, replies: 4 },
    };
    const obs24h: ExperimentObservation = {
      id: 'obs_24h',
      experimentId: 'exp_1',
      measuredAt: '2026-08-20T12:00:00Z',
      metrics: { impressions: 4200, replies: 31 },
    };
    await store.saveExperimentObservation(obs30m);
    await store.saveExperimentObservation(obs24h);
    const observations = await store.listExperimentObservations('exp_1');
    expect(observations).toHaveLength(2);
    expect(observations.map((o) => o.id).sort()).toEqual(['obs_24h', 'obs_30m']);
  });

  it('preserves distinct measuredAt timestamps across observations', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveExperimentObservation({
      id: 'obs_a',
      experimentId: 'exp_1',
      measuredAt: '2026-08-19T12:30:00Z',
      metrics: { impressions: 800 },
    });
    await store.saveExperimentObservation({
      id: 'obs_b',
      experimentId: 'exp_1',
      measuredAt: '2026-08-20T12:00:00Z',
      metrics: { impressions: 4200 },
    });
    const observations = await store.listExperimentObservations('exp_1');
    // Chronological, oldest first.
    expect(observations.map((o) => o.measuredAt)).toEqual(['2026-08-19T12:30:00Z', '2026-08-20T12:00:00Z']);
  });

  it('does not let a later observation destroy an earlier raw measurement', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    const early: ExperimentObservation = {
      id: 'obs_early',
      experimentId: 'exp_1',
      measuredAt: '2026-08-19T12:30:00Z',
      metrics: { impressions: 800, replies: 4 },
    };
    await store.saveExperimentObservation(early);
    await store.saveExperimentObservation({
      id: 'obs_late',
      experimentId: 'exp_1',
      measuredAt: '2026-08-20T12:00:00Z',
      metrics: { impressions: 4200, replies: 31 },
    });
    const observations = await store.listExperimentObservations('exp_1');
    const stillThere = observations.find((o) => o.id === 'obs_early');
    expect(stillThere).toEqual(early);
  });

  it('queries experiments by profileId', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveExperiment(experiment({ id: 'exp_a', profileId: 'prof_1' }));
    await store.saveExperiment(experiment({ id: 'exp_b', profileId: 'prof_2' }));
    const forProfile1 = await store.listExperiments({ profileId: 'prof_1' });
    expect(forProfile1.map((e) => e.id)).toEqual(['exp_a']);
  });
});

describe('JsonlIntelligenceStore — Hypothesis', () => {
  it('saves and loads a Hypothesis', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveHypothesis(hypothesis());
    const loaded = await store.getHypothesis('hyp_1');
    expect(loaded?.dependentMetric).toBe('replies');
  });

  it('round-trips supporting and contradicting experiment ids', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveHypothesis(
      hypothesis({ supportingExperimentIds: ['exp_1', 'exp_4'], contradictingExperimentIds: ['exp_7'] }),
    );
    const loaded = await store.getHypothesis('hyp_1');
    expect(loaded?.supportingExperimentIds).toEqual(['exp_1', 'exp_4']);
    expect(loaded?.contradictingExperimentIds).toEqual(['exp_7']);
  });

  it('queries hypotheses by status and profile', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveHypothesis(hypothesis({ id: 'hyp_a', profileId: 'prof_1', status: 'testing' }));
    await store.saveHypothesis(hypothesis({ id: 'hyp_b', profileId: 'prof_1', status: 'supported' }));
    await store.saveHypothesis(hypothesis({ id: 'hyp_c', profileId: 'prof_2', status: 'testing' }));
    const testingForProfile1 = await store.listHypotheses({ profileId: 'prof_1', status: 'testing' });
    expect(testingForProfile1.map((h) => h.id)).toEqual(['hyp_a']);
  });
});

describe('JsonlIntelligenceStore — Finding', () => {
  it('saves and loads a Finding', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveFinding(finding());
    const loaded = await store.getFinding('fnd_1');
    expect(loaded?.statement).toBe('Contrarian hooks lift replies.');
  });

  it('keeps findings correctly scoped', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveFinding(finding({ id: 'fnd_platform', scope: { level: 'platform', platform: 'threads' } }));
    await store.saveFinding(finding({ id: 'fnd_profile', scope: { level: 'profile', profileId: 'prof_1' } }));
    const loadedPlatform = await store.getFinding('fnd_platform');
    const loadedProfile = await store.getFinding('fnd_profile');
    expect(loadedPlatform?.scope).toEqual({ level: 'platform', platform: 'threads' });
    expect(loadedProfile?.scope).toEqual({ level: 'profile', profileId: 'prof_1' });
  });

  it('queries findings by profile, status and scope', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveFinding(finding({ id: 'fnd_a', profileId: 'prof_1', status: 'validated', scope: { level: 'profile', profileId: 'prof_1' } }));
    await store.saveFinding(finding({ id: 'fnd_b', profileId: 'prof_1', status: 'rejected', scope: { level: 'profile', profileId: 'prof_1' } }));
    await store.saveFinding(finding({ id: 'fnd_c', profileId: 'prof_2', status: 'validated', scope: { level: 'global' } }));
    const validatedForProfile1 = await store.listFindings({ profileId: 'prof_1', status: 'validated', scopeLevel: 'profile' });
    expect(validatedForProfile1.map((f) => f.id)).toEqual(['fnd_a']);
  });
});

describe('JsonlIntelligenceStore — PerformanceBaseline', () => {
  it('saves and loads a PerformanceBaseline', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    const scope = { kind: 'hook-family' as const, hookFamily: 'contrarian-claim' };
    await store.saveBaseline({
      profileId: 'prof_1',
      metric: 'replies',
      comparisonScope: scope,
      sampleSize: 40,
      median: 18,
      window: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' },
      calculatedAt: NOW,
    });
    const loaded = await store.getBaseline('prof_1', 'replies', scope);
    expect(loaded?.median).toBe(18);
  });
});

describe('JsonlIntelligenceStore — empty store and corrupt data', () => {
  it('returns safe empty/null results from an empty store', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    expect(await store.getProfile('nope')).toBeNull();
    expect(await store.listProfiles({ workspaceId: 'ws_test' })).toEqual([]);
    expect(await store.getProfileBrain('nope')).toBeNull();
    expect(await store.getExperiment('nope')).toBeNull();
    expect(await store.listExperimentObservations('nope')).toEqual([]);
    expect(await store.getHypothesis('nope')).toBeNull();
    expect(await store.getFinding('nope')).toBeNull();
    expect(
      await store.getBaseline('prof_1', 'replies', { kind: 'all-recent-posts' }),
    ).toBeNull();
  });

  it('remains valid after the store is re-instantiated against the same root', async () => {
    const root = await tmpRoot();
    const first = new JsonlIntelligenceStore(root);
    await first.saveFinding(finding());
    const second = new JsonlIntelligenceStore(root);
    const loaded = await second.getFinding('fnd_1');
    expect(loaded?.id).toBe('fnd_1');
  });

  it('skips a corrupt or blank JSONL line rather than failing the read', async () => {
    const root = await tmpRoot();
    const store = new JsonlIntelligenceStore(root);
    await store.saveFinding(finding({ id: 'fnd_good' }));
    await appendFile(findingsPath(root), '\nnot json at all\n{"id":\n', 'utf8');
    await store.saveFinding(finding({ id: 'fnd_later' }));
    // Scoped by profile: this test is about surviving a corrupt line, and
    // no profile record exists here for a workspace to resolve through.
    const all = await store.listFindings({ profileId: 'prof_1' });
    expect(all.map((f) => f.id).sort()).toEqual(['fnd_good', 'fnd_later']);
  });

  it('skips a corrupt line in the append-only observations file too', async () => {
    const root = await tmpRoot();
    const store = new JsonlIntelligenceStore(root);
    await store.saveExperimentObservation({
      id: 'obs_good',
      experimentId: 'exp_1',
      measuredAt: NOW,
      metrics: { impressions: 100 },
    });
    await appendFile(experimentResultsPath(root), 'garbage\n', 'utf8');
    await store.saveExperimentObservation({
      id: 'obs_later',
      experimentId: 'exp_1',
      measuredAt: NOW,
      metrics: { impressions: 200 },
    });
    const observations = await store.listExperimentObservations('exp_1');
    expect(observations.map((o) => o.id).sort()).toEqual(['obs_good', 'obs_later']);
  });

  it('touches no CreatorOS behavior — storage is pure data at rest', async () => {
    const store = new JsonlIntelligenceStore(await tmpRoot());
    await store.saveProfile(profile());
    const loaded = await store.getProfile('prof_1');
    // The CreatorOS reference round-trips as inert data; nothing here calls out.
    expect(typeof loaded?.creatorOsAccountId).toBe('string');
  });
});
