import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { validateOnboardingInput } from '../src/intelligence/onboarding/validate.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';
import type { Finding, Hypothesis, Experiment } from '../src/intelligence/index.js';

const NOW = '2026-08-19T12:00:00Z';

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-onboarding-')));
}

function baseInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    workspaceId: 'ws_test',
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    brandName: 'Lift Notes',
    handle: '@liftnotes',
    faceless: true,
    niche: 'strength training',
    subNiche: 'powerlifting',
    positioning: 'The no-fluff plateau-breaker for intermediate lifters.',
    voice: ['blunt', 'technical'],
    styleConstraints: ['no emoji', 'never say "game-changer"'],
    declaredAudience: 'Intermediate lifters stuck at a plateau',
    audienceSegments: [
      { name: 'Plateaued intermediates', pains: ['stalled bench'], desires: ['a peaking block'], objections: [], languagePatterns: ['deload'] },
    ],
    audiencePains: ['stalled bench'],
    audienceDesires: ['a repeatable program'],
    audienceLanguagePatterns: ['PR', 'deload', 'AMRAP'],
    primaryObjective: 'followers',
    secondaryObjectives: ['conversation'],
    offers: [
      { name: 'Peaking Block', description: '8-week program', price: 79, currency: 'USD', type: 'digital-product', url: 'example.com/peaking' },
    ],
    primaryConversionGoal: 'sale',
    postsPerDay: 2,
    experimentMode: 'balanced',
    ...overrides,
  };
}

describe('onboardProfile — creates a valid SocialProfile', () => {
  it('creates a SocialProfile from valid onboarding input', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    const loaded = await store.getProfile(result.profile.id);
    expect(loaded?.identity.brandName).toBe('Lift Notes');
  });

  it('round-trips creatorOsAccountId unchanged', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ creatorOsAccountId: '65a1b2c3d4e5f60718293a4b' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.creatorOsAccountId).toBe('65a1b2c3d4e5f60718293a4b');
  });

  it('keeps the platform a CreatorOS-compatible value', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ platform: 'twitter' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.platform).toBe('twitter');
  });

  it('persists the niche', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ niche: 'personal finance', subNiche: 'FIRE' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.market.niche).toBe('personal finance');
    expect(result.profile.market.subNiche).toBe('FIRE');
  });

  it('persists the declared audience', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ declaredAudience: 'Nervous beginners in the gym' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.audience.primaryAudience).toContain('Nervous beginners in the gym');
    expect(result.profile.audience.pains).toContain('stalled bench');
  });

  it('does not mark the declared audience as scientifically validated', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The brain's learned/observed audience intelligence starts empty —
    // nothing from onboarding is treated as validated evidence.
    expect(result.brain.audienceIntelligence.segmentLearnings).toEqual([]);
    expect(result.brain.strategyMemory.validated).toEqual([]);
  });

  it('persists the primary objective', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ primaryObjective: 'sale' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.objectives.primary).toBe('sale');
  });

  it('persists secondary objectives', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ secondaryObjectives: ['reach', 'traffic'] }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.objectives.secondary).toEqual(['reach', 'traffic']);
  });

  it('persists voice configuration', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ voice: ['blunt', 'technical', 'warm'] }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.identity.voice).toEqual(['blunt', 'technical', 'warm']);
    expect(result.profile.identity.positioning).toContain('plateau-breaker');
  });

  it('persists an offer', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.monetization.offers).toHaveLength(1);
    expect(result.profile.monetization.offers[0]!.name).toBe('Peaking Block');
    expect(result.profile.monetization.offers[0]!.url).toBe('https://example.com/peaking');
  });

  it('lets a profile exist without any offer — growth-only is valid', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ offers: undefined }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.monetization.offers).toEqual([]);
  });

  it('persists posting capacity', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ postsPerDay: 3, postsPerWeek: undefined, postingNotes: 'weekdays only' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.strategy.postingFrequency.postsPerDay).toBe(3);
    expect(result.profile.strategy.postingFrequency.notes).toBe('weekdays only');
  });

  it('persists experiment mode', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput({ experimentMode: 'discovery' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.strategy.experimentMode).toBe('discovery');
  });
});

describe('onboardProfile — validation', () => {
  it('fails validation when creatorOsAccountId is missing', () => {
    const result = validateOnboardingInput(baseInput({ creatorOsAccountId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'creatorOsAccountId')).toBe(true);
  });

  it('fails validation when niche is missing', () => {
    const result = validateOnboardingInput(baseInput({ niche: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'niche')).toBe(true);
  });

  it('fails validation when declared audience is missing', () => {
    const result = validateOnboardingInput(baseInput({ declaredAudience: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'declaredAudience')).toBe(true);
  });

  it('fails validation when the primary objective is missing', () => {
    const result = validateOnboardingInput(baseInput({ primaryObjective: undefined as never }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'primaryObjective')).toBe(true);
  });

  it('fails validation on unrealistic posting capacity', () => {
    const zero = validateOnboardingInput(baseInput({ postsPerDay: 0 }));
    const huge = validateOnboardingInput(baseInput({ postsPerDay: 500 }));
    expect(zero.valid).toBe(false);
    expect(huge.valid).toBe(false);
    expect(zero.errors.some((e) => e.field === 'postsPerDay')).toBe(true);
  });

  it('fails validation on a negative offer price', () => {
    const result = validateOnboardingInput(
      baseInput({ offers: [{ name: 'x', description: 'y', price: -5 }] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'offers[0].price')).toBe(true);
  });

  it('handles a malformed offer URL intentionally rather than silently passing it through', () => {
    const malformed = validateOnboardingInput(
      baseInput({ offers: [{ name: 'x', description: 'y', url: 'not a url at all !!' }] }),
    );
    expect(malformed.valid).toBe(false);
    expect(malformed.errors.some((e) => e.field === 'offers[0].url')).toBe(true);

    // A bare domain, on the other hand, is intentionally normalized rather than rejected.
    const bareDomain = validateOnboardingInput(
      baseInput({ offers: [{ name: 'x', description: 'y', url: 'example.com/thing' }] }),
    );
    expect(bareDomain.valid).toBe(true);
  });

  it('fails validation on an invalid experiment mode', () => {
    const result = validateOnboardingInput(baseInput({ experimentMode: 'aggressive' as never }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'experimentMode')).toBe(true);
  });

  it('rejects an unrecognized platform rather than silently accepting it', () => {
    const result = validateOnboardingInput(baseInput({ platform: 'myspace' as never }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'platform')).toBe(true);
  });
});

describe('onboardProfile — ProfileBrain initialization', () => {
  it('initializes a ProfileBrain on successful onboarding', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brain = await store.getProfileBrain(result.profile.id);
    expect(brain).not.toBeNull();
    expect(brain?.version).toBe(1);
  });

  it('creates a brain with no invented findings', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brain.strategyMemory.validated).toEqual([]);
    expect(result.brain.strategyMemory.promising).toEqual([]);
    expect(result.brain.strategyMemory.rejected).toEqual([]);
    expect(result.brain.strategyMemory.decaying).toEqual([]);
  });

  it('creates a brain with no fake experiments or baselines', async () => {
    const store = await tmpStore();
    const result = await onboardProfile(baseInput(), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brain.activeExperimentIds).toEqual([]);
    expect(result.brain.performanceBaselines).toEqual([]);
    expect(result.brain.winnerPatterns).toEqual([]);
    expect(result.brain.failurePatterns).toEqual([]);
  });
});

describe('onboardProfile — re-onboarding', () => {
  it('updates profile configuration on re-onboarding', async () => {
    const store = await tmpStore();
    const first = await onboardProfile(baseInput({ primaryObjective: 'followers' }), store, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await onboardProfile(
      baseInput({ profileId: first.profile.id, primaryObjective: 'sale', postsPerDay: 4 }),
      store,
      '2026-09-01T00:00:00Z',
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.profile.objectives.primary).toBe('sale');
    expect(second.profile.strategy.postingFrequency.postsPerDay).toBe(4);
    // createdAt preserved, version bumped, updatedAt moved.
    expect(second.profile.createdAt).toBe(first.profile.createdAt);
    expect(second.profile.version).toBe(first.profile.version + 1);
    expect(second.profile.updatedAt).not.toBe(first.profile.updatedAt);
  });

  it('does not destroy existing findings when re-onboarding', async () => {
    const store = await tmpStore();
    const first = await onboardProfile(baseInput(), store, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const finding: Finding = {
      id: 'fnd_1',
      statement: 'Contrarian hooks lift replies.',
      scope: { level: 'profile', profileId: first.profile.id },
      profileId: first.profile.id,
      sampleSize: 40,
      confidence: 0.7,
      status: 'validated',
      sourceExperimentIds: ['exp_1'],
      createdAt: NOW,
      lastValidatedAt: NOW,
    };
    await store.saveFinding(finding);

    await onboardProfile(baseInput({ profileId: first.profile.id, niche: 'a whole new niche' }), store, '2026-09-01T00:00:00Z');

    const stillThere = await store.getFinding('fnd_1');
    expect(stillThere).toEqual(finding);
  });

  it('does not destroy experiment history when re-onboarding', async () => {
    const store = await tmpStore();
    const first = await onboardProfile(baseInput(), store, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const experiment: Experiment = {
      id: 'exp_1',
      profileId: first.profile.id,
      platform: 'threads',
      niche: 'strength training',
      objective: 'conversation',
      contentDna: { topic: 'bench plateau', hookFamily: 'contrarian-claim', format: 'text', tone: 'contrarian', lengthClass: 'short' },
      design: { testVariables: [] },
      execution: { publishedAt: NOW },
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.saveExperiment(experiment);

    await onboardProfile(baseInput({ profileId: first.profile.id, declaredAudience: 'a whole new audience' }), store, '2026-09-01T00:00:00Z');

    const stillThere = await store.getExperiment('exp_1');
    expect(stillThere).toEqual(experiment);
    const forProfile = await store.listExperiments({ profileId: first.profile.id });
    expect(forProfile.map((e) => e.id)).toContain('exp_1');
  });

  it('preserves the existing ProfileBrain rather than overwriting it on re-onboarding', async () => {
    const store = await tmpStore();
    const first = await onboardProfile(baseInput(), store, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const hypothesis: Hypothesis = {
      id: 'hyp_1',
      statement: 'Contrarian hooks earn more replies.',
      scope: { level: 'profile', profileId: first.profile.id },
      profileId: first.profile.id,
      independentVariable: 'hookFamily',
      dependentMetric: 'replies',
      controlVariables: [],
      status: 'supported',
      confidence: 0.8,
      source: 'experiment',
      supportingExperimentIds: ['exp_1'],
      contradictingExperimentIds: [],
      createdAt: NOW,
    };
    await store.saveHypothesis(hypothesis);
    const brainWithLearning = {
      ...first.brain,
      version: 2,
      activeExperimentIds: ['exp_1'],
      updatedAt: '2026-08-20T00:00:00Z',
    };
    await store.saveProfileBrain(brainWithLearning);

    const second = await onboardProfile(baseInput({ profileId: first.profile.id, positioning: 'updated positioning' }), store, '2026-09-01T00:00:00Z');
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const brainAfter = await store.getProfileBrain(first.profile.id);
    expect(brainAfter?.version).toBe(2);
    expect(brainAfter?.activeExperimentIds).toEqual(['exp_1']);
    expect(second.brain.version).toBe(2);
  });
});

describe('onboardProfile — multiple independent profiles', () => {
  it('onboards multiple profiles independently', async () => {
    const store = await tmpStore();
    const a = await onboardProfile(baseInput({ creatorOsAccountId: 'acct_a', brandName: 'Brand A' }), store, NOW);
    const b = await onboardProfile(baseInput({ creatorOsAccountId: 'acct_b', brandName: 'Brand B' }), store, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.profile.id).not.toBe(b.profile.id);
    const all = await store.listProfiles({ workspaceId: 'ws_test' });
    expect(all.map((p) => p.id).sort()).toEqual([a.profile.id, b.profile.id].sort());
  });

  it('does not let two CreatorOS accounts share profile intelligence', async () => {
    const store = await tmpStore();
    const a = await onboardProfile(baseInput({ creatorOsAccountId: 'acct_a' }), store, NOW);
    const b = await onboardProfile(baseInput({ creatorOsAccountId: 'acct_b' }), store, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    await store.saveFinding({
      id: 'fnd_a_only',
      statement: 'Only true for A.',
      scope: { level: 'profile', profileId: a.profile.id },
      profileId: a.profile.id,
      sampleSize: 10,
      confidence: 0.5,
      status: 'promising',
      sourceExperimentIds: [],
      createdAt: NOW,
      lastValidatedAt: NOW,
    });

    const findingsForA = await store.listFindings({ profileId: a.profile.id });
    const findingsForB = await store.listFindings({ profileId: b.profile.id });
    expect(findingsForA.map((f) => f.id)).toEqual(['fnd_a_only']);
    expect(findingsForB).toEqual([]);
    expect(a.brain.profileId).not.toBe(b.brain.profileId);
  });

  it('remains accessible after the store is re-instantiated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-onboarding-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const result = await onboardProfile(baseInput(), first, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const second = new JsonlIntelligenceStore(root);
    const loaded = await second.getProfile(result.profile.id);
    expect(loaded?.identity.brandName).toBe('Lift Notes');
    const brain = await second.getProfileBrain(result.profile.id);
    expect(brain?.version).toBe(1);
  });
});
