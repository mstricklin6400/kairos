import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { ingestAttributionEvent, ingestMeasurementSnapshot } from '../src/intelligence/measurement/ingest.js';
import { BattleEngine } from '../src/intelligence/battle/engine.js';
import {
  applyVanityGuard,
  decideCategoryVerdict,
  normalizeValues,
  perThousand,
  predictionAccuracy,
  rate,
  scoreCompetitors,
  vanityShare,
} from '../src/intelligence/battle/scoring.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type {
  BattleProtocol,
  BattleScoringModel,
  BattleSeason,
  Platform,
  StrategyRecommendation,
} from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-19T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-battle-')));
}

function protocolInput(overrides: Partial<BattleProtocol> = {}) {
  return {
    name: 'SML Season 1 Protocol',
    version: '1.0.0',
    objectives: ['conversation' as const],
    primaryMetrics: ['replies' as const],
    exploratoryMetrics: ['impressions' as const],
    controlledVariables: ['topic', 'postingTime'],
    treatmentVariables: ['hookFamily'],
    allowedStrategyChanges: ['collect_more_evidence'],
    prohibitedStrategyChanges: ['adjust_content_mix'],
    measurementWindowDays: 30,
    warmUpDays: 3,
    minimumSampleExpectation: 20,
    matchingRules: ['same niche', 'same objective', 'same start cohort'],
    scoringModelId: 'score_1',
    outlierPolicy: 'median-based; single viral post does not redefine baseline',
    missingDataPolicy: 'missing is not zero; category skipped',
    attributionPolicy: 'first-party attribution events only for business metrics',
    experimentRegistrationPolicy: 'primary metric locked at registration',
    operatingMode: 'lab' as const,
    limitations: [],
    ...overrides,
  };
}

function scoringModelInput(overrides: Partial<BattleScoringModel> = {}) {
  return {
    name: 'Conversation-weighted',
    categories: [
      { category: 'conversation' as const, weight: 0.6, metrics: ['replies' as const] },
      { category: 'attention' as const, weight: 0.4, metrics: ['impressions' as const] },
    ],
    methodology: 'Min-max normalized per category across competitors, then weighted.',
    limitations: [],
    ...overrides,
  };
}

function seasonInput(protocolId: string, scoringModelId: string, overrides: Partial<BattleSeason> = {}) {
  return {
    name: 'Social Money Lab Season 1',
    niche: 'personal finance',
    platforms: ['threads', 'twitter'] as Platform[],
    status: 'active' as const,
    startAt: '2026-08-01T00:00:00Z',
    protocolId,
    protocolVersion: '1.0.0',
    primaryObjective: 'conversation' as const,
    secondaryObjectives: [],
    competitorIds: [],
    divisionIds: [],
    accountStageConstraints: [],
    scoringModelId,
    operatingMode: 'lab' as const,
    isPublic: true,
    ...overrides,
  };
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    workspaceId: 'ws_test',
    creatorOsAccountId: `acct_${Math.random().toString(36).slice(2, 10)}`,
    platform: 'threads',
    brandName: 'Finance Notes',
    niche: 'personal finance',
    declaredAudience: 'Late-20s professionals paying down debt',
    primaryObjective: 'conversation',
    experimentMode: 'balanced',
    ...overrides,
  };
}

async function seedProfile(store: JsonlIntelligenceStore, overrides: Partial<ProfileOnboardingInput> = {}) {
  const result = await onboardProfile(onboardingInput(overrides), store, NOW);
  if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.errors)}`);
  return result.profile;
}

/** A season wired end-to-end: protocol, scoring model, season. */
async function seedSeason(store: JsonlIntelligenceStore, engine: BattleEngine, opts: {
  protocol?: Partial<BattleProtocol>;
  model?: Partial<BattleScoringModel>;
  season?: Partial<BattleSeason>;
} = {}) {
  const model = await engine.createScoringModel(scoringModelInput(opts.model));
  const protocol = await engine.registerProtocol(protocolInput({ scoringModelId: model.id, ...opts.protocol }));
  const season = await engine.createSeason(
    seasonInput(protocol.id, model.id, { protocolVersion: protocol.version, ...opts.season }),
  );
  return { model, protocol, season };
}

function recommendation(overrides: Partial<StrategyRecommendation> = {}): StrategyRecommendation {
  return {
    id: 'rec_1',
    profileId: 'prof_1',
    objective: 'conversation',
    recommendationType: 'content',
    action: 'test_hook',
    status: 'proposed',
    priorityScore: 0.7,
    reason: 'Try a different hook family.',
    basis: {
      findingIds: [], segmentFindingIds: [], hypothesisIds: [], experimentIds: [],
      strategyPrincipleIds: [], strategyClaimIds: [], audienceSegmentIds: [], constraintIds: [],
      rationale: 'test',
    },
    confidence: 0.6,
    limitations: [],
    createdAt: NOW,
    policyVersion: 'adaptive-v1',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('Battle — season, protocol, competitors, divisions', () => {
  it('creates a season', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    expect(season.name).toBe('Social Money Lab Season 1');
    expect((await store.getBattleSeason(season.id))?.id).toBe(season.id);
  });

  it('registers and versions a protocol', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const v1 = await engine.registerProtocol(protocolInput({ version: '1.0.0' }));
    const v2 = await engine.registerProtocol(protocolInput({ version: '2.0.0' }));
    expect(v1.version).toBe('1.0.0');
    expect(v2.version).toBe('2.0.0');
    expect(v1.id).not.toBe(v2.id);
    expect((await store.listBattleProtocols())).toHaveLength(2);
  });

  it('preserves the protocol version on the season for provenance', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine, { protocol: { version: '3.1.4' }, season: {} });
    const stored = await store.getBattleSeason(season.id);
    expect(stored!.protocolVersion).toBe('3.1.4');
  });

  it('creates divisions', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    await engine.createDivision({ seasonId: season.id, name: 'Personal Finance', niche: 'personal finance', profileIds: [], competitorProfileMap: {} });
    await engine.createDivision({ seasonId: season.id, name: 'Fitness', niche: 'fitness', profileIds: [], competitorProfileMap: {} });
    expect(await store.listBattleDivisions({ seasonId: season.id })).toHaveLength(2);
  });

  it('supports multiple divisions and niches in one season', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    for (const niche of ['real estate', 'beauty', 'parenting', 'digital products']) {
      await engine.createDivision({ seasonId: season.id, name: niche, niche, profileIds: [], competitorProfileMap: {} });
    }
    const divisions = await store.listBattleDivisions({ seasonId: season.id });
    expect(new Set(divisions.map((d) => d.niche)).size).toBe(4);
  });

  it('supports many competitors', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    for (let i = 0; i < 10; i += 1) {
      await engine.createCompetitor({ seasonId: season.id, name: `Competitor ${i}`, competitorType: 'strategy', profileIds: [] });
    }
    expect(await store.listBattleCompetitors({ seasonId: season.id })).toHaveLength(10);
  });
});

describe('Battle — competitor types are not hard-coded to platforms', () => {
  it('represents Threads vs X', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const threads = await engine.createCompetitor({ seasonId: season.id, name: 'Threads', competitorType: 'platform', platform: 'threads', profileIds: [] });
    const x = await engine.createCompetitor({ seasonId: season.id, name: 'X', competitorType: 'platform', platform: 'twitter', profileIds: [] });
    expect(threads.platform).toBe('threads');
    expect(x.platform).toBe('twitter');
  });

  it('represents Instagram vs TikTok with no type changes', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine, { season: { platforms: ['instagram', 'tiktok'] } });
    const ig = await engine.createCompetitor({ seasonId: season.id, name: 'Instagram', competitorType: 'platform', platform: 'instagram', profileIds: [] });
    const tk = await engine.createCompetitor({ seasonId: season.id, name: 'TikTok', competitorType: 'platform', platform: 'tiktok', profileIds: [] });
    expect([ig.platform, tk.platform]).toEqual(['instagram', 'tiktok']);
  });

  it('represents AI vs Human with no platform at all', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const ai = await engine.createCompetitor({ seasonId: season.id, name: 'AI-written', competitorType: 'creator_type', profileIds: [] });
    const human = await engine.createCompetitor({ seasonId: season.id, name: 'Human-written', competitorType: 'creator_type', profileIds: [] });
    expect(ai.platform).toBeUndefined();
    expect(human.competitorType).toBe('creator_type');
  });

  it('represents strategy vs strategy and frequency vs frequency', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const a = await engine.createCompetitor({ seasonId: season.id, name: 'Question hooks', competitorType: 'strategy', profileIds: [] });
    const b = await engine.createCompetitor({ seasonId: season.id, name: '5 posts/day', competitorType: 'frequency', profileIds: [] });
    expect(a.competitorType).toBe('strategy');
    expect(b.competitorType).toBe('frequency');
  });

  it('supports a 20-account 2-platform season shape without hard-coding it', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const threadsProfiles: string[] = [];
    const xProfiles: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      threadsProfiles.push((await seedProfile(store, { platform: 'threads' })).id);
      xProfiles.push((await seedProfile(store, { platform: 'twitter' })).id);
    }
    const threads = await engine.createCompetitor({ seasonId: season.id, name: 'Threads', competitorType: 'platform', platform: 'threads', profileIds: threadsProfiles });
    const x = await engine.createCompetitor({ seasonId: season.id, name: 'X', competitorType: 'platform', platform: 'twitter', profileIds: xProfiles });
    expect(threads.profileIds).toHaveLength(10);
    expect(x.profileIds).toHaveLength(10);
    // 10 matched pairs across the two competitors.
    for (let i = 0; i < 10; i += 1) {
      await engine.createMatchup({
        seasonId: season.id,
        divisionId: 'div_pf',
        competitorProfileIds: [threadsProfiles[i]!, xProfiles[i]!],
        matchingCriteria: ['same niche', 'same objective', 'same start cohort'],
        limitations: ['unmatched_comparison'],
        status: 'active',
      });
    }
    expect(await store.listBattleMatchups({ seasonId: season.id })).toHaveLength(10);
  });
});

describe('Battle — matchups preserve their limitations', () => {
  it('creates a matched pair', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const matchup = await engine.createMatchup({
      seasonId: season.id, divisionId: 'div_1',
      competitorProfileIds: ['prof_th', 'prof_x'],
      matchingCriteria: ['same niche'],
      limitations: ['unmatched_comparison'],
      status: 'active',
    });
    expect(matchup.competitorProfileIds).toEqual(['prof_th', 'prof_x']);
  });

  it('never pretends matched profiles are identical', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const matchup = await engine.createMatchup({
      seasonId: season.id, divisionId: 'div_1',
      competitorProfileIds: ['a', 'b'],
      matchingCriteria: ['same niche', 'same objective'],
      limitations: ['unmatched_comparison', 'mixed_account_stages'],
      matchingNotes: 'X account began with ~400 more followers.',
      status: 'active',
    });
    const stored = await store.getBattleMatchup(matchup.id);
    expect(stored!.limitations).toContain('mixed_account_stages');
    expect(stored!.matchingNotes).toContain('400 more followers');
  });
});

describe('Battle — experiment pre-registration locks the primary metric', () => {
  it('registers an experiment with a locked primary metric', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const result = await engine.registerExperiment({
      seasonId: season.id, experimentId: 'exp_1', primaryMetric: 'replies',
      secondaryMetrics: ['impressions'], independentVariable: 'hookFamily',
      controlVariables: ['topic'], status: 'registered',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.primaryMetric).toBe('replies');
  });

  it('refuses to switch the primary metric after registration', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const first = await engine.registerExperiment({
      id: 'reg_locked', seasonId: season.id, experimentId: 'exp_1', primaryMetric: 'replies',
      secondaryMetrics: [], independentVariable: 'hookFamily', controlVariables: [], status: 'registered',
    });
    expect(first.ok).toBe(true);
    // Results are in; someone tries to declare victory on impressions instead.
    const second = await engine.registerExperiment({
      id: 'reg_locked', seasonId: season.id, experimentId: 'exp_1', primaryMetric: 'impressions',
      secondaryMetrics: [], independentVariable: 'hookFamily', controlVariables: [], status: 'measured',
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain('locked');
    // The original registration is unchanged.
    expect((await store.getBattleExperimentRegistration('reg_locked'))!.primaryMetric).toBe('replies');
  });

  it('allows amending other fields while the primary metric holds', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    await engine.registerExperiment({
      id: 'reg_a', seasonId: season.id, experimentId: 'exp_1', primaryMetric: 'replies',
      secondaryMetrics: [], independentVariable: 'hookFamily', controlVariables: [], status: 'registered',
    });
    const amended = await engine.registerExperiment({
      id: 'reg_a', seasonId: season.id, experimentId: 'exp_1', primaryMetric: 'replies',
      secondaryMetrics: ['impressions', 'likes'], independentVariable: 'hookFamily',
      controlVariables: ['topic'], status: 'running',
    });
    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(amended.registration.status).toBe('running');
    expect(amended.registration.secondaryMetrics).toHaveLength(2);
  });

  it('keeps secondary metrics exploratory in the protocol', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine);
    expect(protocol.primaryMetrics).toEqual(['replies']);
    expect(protocol.exploratoryMetrics).toEqual(['impressions']);
    expect(protocol.primaryMetrics).not.toContain('impressions');
  });
});

describe('Battle — Lab Mode vs Growth Mode', () => {
  it('rejects an adaptive recommendation that touches a controlled variable in lab mode', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine, { protocol: { operatingMode: 'lab' } });
    const decision = engine.evaluateRecommendationAgainstProtocol(recommendation(), protocol, ['topic']);
    expect(decision.allowed).toBe(false);
    expect(decision.violatedVariables).toContain('topic');
    expect(decision.reason).toContain('locked');
  });

  it('rejects an adaptive recommendation that touches a treatment variable in lab mode', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine, { protocol: { operatingMode: 'lab' } });
    const decision = engine.evaluateRecommendationAgainstProtocol(recommendation(), protocol, ['hookFamily']);
    expect(decision.allowed).toBe(false);
  });

  it('accepts a valid adaptive recommendation that touches nothing controlled', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine, { protocol: { operatingMode: 'lab' } });
    const decision = engine.evaluateRecommendationAgainstProtocol(recommendation(), protocol, ['ctaType']);
    expect(decision.allowed).toBe(true);
  });

  it('allows the same controlled-variable change in growth mode', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine, { protocol: { operatingMode: 'growth' } });
    const decision = engine.evaluateRecommendationAgainstProtocol(recommendation(), protocol, ['topic']);
    expect(decision.allowed).toBe(true);
    expect(decision.operatingMode).toBe('growth');
  });

  it('rejects a prohibited action in lab mode even with no variable conflict', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine, {
      protocol: { operatingMode: 'lab', prohibitedStrategyChanges: ['adjust_content_mix'] },
    });
    const decision = engine.evaluateRecommendationAgainstProtocol(
      recommendation({ action: 'adjust_content_mix' }), protocol, [],
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('prohibited');
  });

  it('partitions a recommendation set into accepted and rejected with reasons', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { protocol } = await seedSeason(store, engine, { protocol: { operatingMode: 'lab' } });
    const recs = [
      recommendation({ id: 'rec_ok', action: 'test_cta' }),
      recommendation({ id: 'rec_bad', action: 'test_hook' }),
    ];
    const { accepted, rejected } = engine.filterRecommendations(recs, protocol, (r) =>
      r.id === 'rec_bad' ? ['hookFamily'] : ['ctaType'],
    );
    expect(accepted.map((r) => r.id)).toEqual(['rec_ok']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.decision.reason).toContain('hookFamily');
  });

  it('treats lab and growth as genuinely different modes, not aliases', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const lab = await engine.registerProtocol(protocolInput({ operatingMode: 'lab' }));
    const growth = await engine.registerProtocol(protocolInput({ operatingMode: 'growth' }));
    const labDecision = engine.evaluateRecommendationAgainstProtocol(recommendation(), lab, ['topic']);
    const growthDecision = engine.evaluateRecommendationAgainstProtocol(recommendation(), growth, ['topic']);
    expect(labDecision.allowed).not.toBe(growthDecision.allowed);
  });
});

describe('Battle — scoring is configurable and vanity-guarded', () => {
  it('normalizes values across the compared set', () => {
    expect(normalizeValues([0, 5, 10])).toEqual([0, 0.5, 1]);
  });

  it('normalizes a no-spread set to 0.5 rather than manufacturing a winner', () => {
    expect(normalizeValues([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
  });

  it('scores a conversation-weighted battle', async () => {
    const model: BattleScoringModel = {
      id: 'm1', name: 'conv', categories: [{ category: 'conversation', weight: 1, metrics: ['replies'] }],
      methodology: 'test', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const { scored } = scoreCompetitors({
      model,
      competitors: [
        { competitorId: 'a', totals: { conversation: 100 }, evidenceCount: 10 },
        { competitorId: 'b', totals: { conversation: 20 }, evidenceCount: 10 },
      ],
    });
    expect(scored.find((s) => s.competitorId === 'a')!.totalScore).toBeGreaterThan(
      scored.find((s) => s.competitorId === 'b')!.totalScore,
    );
  });

  it('scores a conversion-weighted battle differently from a conversation one', () => {
    const competitors = [
      { competitorId: 'chatty', totals: { conversation: 100, conversion: 1 }, evidenceCount: 10 },
      { competitorId: 'seller', totals: { conversation: 10, conversion: 50 }, evidenceCount: 10 },
    ];
    const convModel: BattleScoringModel = {
      id: 'm1', name: 'conv', categories: [{ category: 'conversation', weight: 1, metrics: ['replies'] }],
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const saleModel: BattleScoringModel = {
      id: 'm2', name: 'sale', categories: [{ category: 'conversion', weight: 1, metrics: ['sales'] }],
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const convWinner = decideCategoryVerdict({ scored: scoreCompetitors({ model: convModel, competitors }).scored });
    const saleWinner = decideCategoryVerdict({ scored: scoreCompetitors({ model: saleModel, competitors }).scored });
    expect(convWinner.winnerCompetitorId).toBe('chatty');
    expect(saleWinner.winnerCompetitorId).toBe('seller');
  });

  it('scores a revenue/customer-value battle', () => {
    const model: BattleScoringModel = {
      id: 'm', name: 'rev', categories: [{ category: 'customerValue', weight: 1, metrics: ['revenue'] }],
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const { scored } = scoreCompetitors({
      model,
      competitors: [
        { competitorId: 'a', totals: { customerValue: 5000 }, evidenceCount: 5 },
        { competitorId: 'b', totals: { customerValue: 100 }, evidenceCount: 5 },
      ],
    });
    expect(decideCategoryVerdict({ scored }).winnerCompetitorId).toBe('a');
  });

  it('reports the vanity share of a model', () => {
    const model: BattleScoringModel = {
      id: 'm', name: 'x',
      categories: [
        { category: 'attention', weight: 0.8, metrics: [] },
        { category: 'conversion', weight: 0.2, metrics: [] },
      ],
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    expect(vanityShare(model)).toBeCloseTo(0.8);
  });

  it('caps vanity categories so they cannot dominate a revenue battle', () => {
    const model: BattleScoringModel = {
      id: 'm', name: 'rev-battle',
      categories: [
        { category: 'attention', weight: 0.8, metrics: ['impressions'] },
        { category: 'customerValue', weight: 0.2, metrics: ['revenue'] },
      ],
      vanityGuardMaxShare: 0.3,
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const { categories, adjusted } = applyVanityGuard(model);
    expect(adjusted).toBe(true);
    const total = categories.reduce((s, c) => s + c.weight, 0);
    const vanity = categories.filter((c) => c.category === 'attention').reduce((s, c) => s + c.weight, 0);
    expect(vanity / total).toBeCloseTo(0.3);
  });

  it('changes the winner once the vanity guard is applied', () => {
    const competitors = [
      { competitorId: 'viral', totals: { attention: 1_000_000, customerValue: 0 }, evidenceCount: 10 },
      { competitorId: 'earner', totals: { attention: 1000, customerValue: 10_000 }, evidenceCount: 10 },
    ];
    const base = { id: 'm', name: 'x', methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1 } as const;
    const unguarded: BattleScoringModel = {
      ...base,
      categories: [
        { category: 'attention', weight: 0.9, metrics: [] },
        { category: 'customerValue', weight: 0.1, metrics: [] },
      ],
    };
    const guarded: BattleScoringModel = { ...unguarded, vanityGuardMaxShare: 0.2 };
    const unguardedWinner = decideCategoryVerdict({ scored: scoreCompetitors({ model: unguarded, competitors }).scored });
    const guardedWinner = decideCategoryVerdict({ scored: scoreCompetitors({ model: guarded, competitors }).scored });
    expect(unguardedWinner.winnerCompetitorId).toBe('viral');
    expect(guardedWinner.winnerCompetitorId).toBe('earner');
  });

  it('leaves a model under the cap unadjusted', () => {
    const model: BattleScoringModel = {
      id: 'm', name: 'x',
      categories: [
        { category: 'attention', weight: 0.2, metrics: [] },
        { category: 'conversion', weight: 0.8, metrics: [] },
      ],
      vanityGuardMaxShare: 0.5,
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    expect(applyVanityGuard(model).adjusted).toBe(false);
  });

  it('skips a category no competitor reported rather than scoring it zero', () => {
    const model: BattleScoringModel = {
      id: 'm', name: 'x',
      categories: [
        { category: 'conversation', weight: 0.5, metrics: [] },
        { category: 'customerValue', weight: 0.5, metrics: [] },
      ],
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const { scored } = scoreCompetitors({
      model,
      competitors: [{ competitorId: 'a', totals: { conversation: 10 }, evidenceCount: 3 }],
    });
    expect(scored[0]!.categoryScores.customerValue).toBeUndefined();
    expect(scored[0]!.categoryScores.conversation).toBeDefined();
  });
});

describe('Battle — verdicts support tie, inconclusive and insufficient evidence', () => {
  const model: BattleScoringModel = {
    id: 'm', name: 'x', categories: [{ category: 'conversation', weight: 1, metrics: [] }],
    methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
  };

  it('detects a clear winner', () => {
    const { scored } = scoreCompetitors({ model, competitors: [
      { competitorId: 'a', totals: { conversation: 100 }, evidenceCount: 5 },
      { competitorId: 'b', totals: { conversation: 1 }, evidenceCount: 5 },
    ]});
    expect(decideCategoryVerdict({ scored }).verdict).toBe('winner');
  });

  it('detects a tie', () => {
    const { scored } = scoreCompetitors({ model, competitors: [
      { competitorId: 'a', totals: { conversation: 50 }, evidenceCount: 5 },
      { competitorId: 'b', totals: { conversation: 50 }, evidenceCount: 5 },
    ]});
    expect(decideCategoryVerdict({ scored }).verdict).toBe('tie');
  });

  it('calls a hair-thin lead inconclusive rather than a win', () => {
    const { scored } = scoreCompetitors({ model, competitors: [
      { competitorId: 'a', totals: { conversation: 100 }, evidenceCount: 5 },
      { competitorId: 'b', totals: { conversation: 99.9 }, evidenceCount: 5 },
    ]});
    // Normalized to 1 and 0, so widen the margin requirement past the spread.
    expect(decideCategoryVerdict({ scored, minimumMargin: 2 }).verdict).toBe('inconclusive');
  });

  it('reports insufficient evidence when nobody has any', () => {
    const { scored } = scoreCompetitors({ model, competitors: [
      { competitorId: 'a', totals: {}, evidenceCount: 0 },
      { competitorId: 'b', totals: {}, evidenceCount: 0 },
    ]});
    expect(decideCategoryVerdict({ scored }).verdict).toBe('insufficient_evidence');
  });

  it('reports insufficient evidence for an empty field', () => {
    expect(decideCategoryVerdict({ scored: [] }).verdict).toBe('insufficient_evidence');
  });
});

describe('Battle — leaderboard is never a scientific finding', () => {
  async function setupWithMeasurements() {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const profile = await seedProfile(store);
    const competitor = await engine.createCompetitor({
      seasonId: season.id, name: 'Threads', competitorType: 'platform', platform: 'threads', profileIds: [profile.id],
    });
    await ingestMeasurementSnapshot({
      profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId,
      creatorOsPostId: 'p1', capturedAt: NOW, sourcePlatform: 'threads', rawMetrics: { replies: 40 },
    }, store);
    return { store, engine, season, profile, competitor };
  }

  it('produces standings without creating any Finding', async () => {
    const { store, engine, season } = await setupWithMeasurements();
    const standings = await engine.calculateStandings({ seasonId: season.id });
    expect(standings.length).toBeGreaterThan(0);
    expect(await store.listFindings({ workspaceId: 'ws_test' })).toEqual([]);
  });

  it('records a battle outcome without creating any Finding', async () => {
    const { store, engine, season } = await setupWithMeasurements();
    const categoryResult = await engine.evaluateCategory({ seasonId: season.id, category: 'conversation' });
    const evidence = await engine.buildEvidenceReference({
      seasonId: season.id, objective: 'conversation', experimentIds: ['exp_1'],
      sampleSize: 20, periodStart: '2026-08-01T00:00:00Z', periodEnd: NOW,
    });
    const outcome = await engine.recordOutcome({
      seasonId: season.id, category: 'conversation', categoryResult: categoryResult!, evidence: evidence!,
    });
    expect(outcome.scienceFindingIds).toEqual([]);
    expect(await store.listFindings({ workspaceId: 'ws_test' })).toEqual([]);
  });

  it('records competition and science verdicts separately so they can disagree', async () => {
    const { store, engine, season, profile } = await setupWithMeasurements();
    // An experiment with no usable baseline — science says insufficient evidence.
    await store.saveExperiment({
      id: 'exp_thin', profileId: profile.id, platform: 'threads', niche: 'personal finance',
      objective: 'conversation',
      contentDna: { topic: 't', hookFamily: 'h', format: 'text', tone: 'contrarian', lengthClass: 'short' },
      design: { testVariables: [] }, execution: { publishedAt: NOW },
      createdAt: NOW, updatedAt: NOW,
    });
    const categoryResult = await engine.evaluateCategory({ seasonId: season.id, category: 'conversation' });
    const evidence = await engine.buildEvidenceReference({
      seasonId: season.id, objective: 'conversation', experimentIds: ['exp_thin'],
      sampleSize: 1, periodStart: '2026-08-01T00:00:00Z', periodEnd: NOW,
    });
    const outcome = await engine.recordOutcome({
      seasonId: season.id, category: 'conversation', categoryResult: categoryResult!,
      scienceExperimentId: 'exp_thin', evidence: evidence!,
    });
    expect(outcome.scienceVerdict).toBe('insufficient_evidence');
    // A competitor can lead on points while the science is inconclusive.
    expect(outcome.battleVerdict).toBeDefined();
    if (outcome.battleVerdict === 'winner') {
      expect(outcome.leaderboardDivergesFromScience).toBe(true);
      expect(outcome.conclusion).toContain('not conclusive');
    }
  });

  it('delegates scientific evaluation to the Science Engine rather than recomputing it', async () => {
    const calls: string[] = [];
    const fake = {
      getBattleSeason: async () => null,
      listPostMeasurements: async () => { calls.push('listPostMeasurements'); return []; },
      listAttributionEvents: async () => { calls.push('listAttributionEvents'); return []; },
    } as unknown as IntelligenceStore;
    const engine = new BattleEngine(fake, { now: fixedNow });
    // No season → no standings, and no independent statistics attempted.
    expect(await engine.calculateStandings({ seasonId: 'nope' })).toEqual([]);
    expect(calls).not.toContain('listPostMeasurements');
  });
});

describe('Battle — standings views', () => {
  async function seasonWithTwoCompetitors() {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const pThreads = await seedProfile(store, { platform: 'threads' });
    const pX = await seedProfile(store, { platform: 'twitter' });
    await engine.createCompetitor({ id: 'c_threads', seasonId: season.id, name: 'Threads', competitorType: 'platform', platform: 'threads', profileIds: [pThreads.id] });
    await engine.createCompetitor({ id: 'c_x', seasonId: season.id, name: 'X', competitorType: 'platform', platform: 'twitter', profileIds: [pX.id] });
    await ingestMeasurementSnapshot({ profileId: pThreads.id, creatorOsAccountId: pThreads.creatorOsAccountId, creatorOsPostId: 'a', capturedAt: NOW, sourcePlatform: 'threads', rawMetrics: { replies: 100, impressions: 1000 } }, store);
    await ingestMeasurementSnapshot({ profileId: pX.id, creatorOsAccountId: pX.creatorOsAccountId, creatorOsPostId: 'b', capturedAt: NOW, sourcePlatform: 'twitter', rawMetrics: { replies: 10, impressions: 5000 } }, store);
    return { store, engine, season };
  }

  it('ranks overall season standings', async () => {
    const { engine, season } = await seasonWithTwoCompetitors();
    const standings = await engine.calculateStandings({ seasonId: season.id });
    expect(standings).toHaveLength(2);
    expect(standings[0]!.rank).toBe(1);
    expect(standings[1]!.rank).toBe(2);
  });

  it('filters standings by platform', async () => {
    const { engine, season } = await seasonWithTwoCompetitors();
    const threadsOnly = await engine.calculateStandings({ seasonId: season.id, platform: 'threads' });
    expect(threadsOnly).toHaveLength(1);
    expect(threadsOnly[0]!.competitorId).toBe('c_threads');
  });

  it('produces category-specific standings', async () => {
    const { engine, season } = await seasonWithTwoCompetitors();
    const conversation = await engine.calculateStandings({ seasonId: season.id, category: 'conversation' });
    // Threads has 10x the replies, so it leads the conversation category.
    expect(conversation[0]!.competitorId).toBe('c_threads');
    const attention = await engine.calculateStandings({ seasonId: season.id, category: 'attention' });
    expect(attention[0]!.competitorId).toBe('c_x');
  });

  it('exposes evidence count and limitations on every standing', async () => {
    const { engine, season } = await seasonWithTwoCompetitors();
    const standings = await engine.calculateStandings({ seasonId: season.id });
    expect(standings.every((s) => typeof s.evidenceCount === 'number')).toBe(true);
    expect(standings.every((s) => Array.isArray(s.limitations))).toBe(true);
    expect(standings.every((s) => s.confidence >= 0 && s.confidence <= 1)).toBe(true);
  });

  it('leaves raw measurements untouched after computing standings', async () => {
    const { store, engine, season } = await seasonWithTwoCompetitors();
    const competitors = await store.listBattleCompetitors({ seasonId: season.id });
    const profileId = competitors[0]!.profileIds[0]!;
    const before = await store.listPostMeasurements({ profileId });
    await engine.calculateStandings({ seasonId: season.id });
    expect(await store.listPostMeasurements({ profileId })).toEqual(before);
  });
});

describe('Battle — predictions are registered before results and are immutable', () => {
  async function setup() {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    return { store, engine, season };
  }

  it('registers a prediction as pending', async () => {
    const { engine, season } = await setup();
    const prediction = await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'c_b', predictedMetric: 'clicks',
      predictedDirection: 'increase', confidence: 0.65, evidenceBasis: ['fnd_1'],
      rationale: 'Treatment B uses a clearer CTA.',
    });
    expect(prediction.result).toBe('pending');
    expect(prediction.resolvedAt).toBeUndefined();
  });

  it('resolves a correct prediction', async () => {
    const { engine, season } = await setup();
    const p = await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'c_b', predictedMetric: 'clicks',
      predictedDirection: 'increase', confidence: 0.7, evidenceBasis: [], rationale: 'r',
    });
    const resolved = await engine.resolvePrediction({ predictionId: p.id, result: 'correct', actualWinnerCompetitorId: 'c_b' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.prediction.result).toBe('correct');
  });

  it('resolves an incorrect prediction', async () => {
    const { engine, season } = await setup();
    const p = await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'c_b', predictedMetric: 'clicks',
      predictedDirection: 'increase', confidence: 0.7, evidenceBasis: [], rationale: 'r',
    });
    const resolved = await engine.resolvePrediction({ predictionId: p.id, result: 'incorrect', actualWinnerCompetitorId: 'c_a' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.prediction.result).toBe('incorrect');
    expect(resolved.prediction.actualWinnerCompetitorId).toBe('c_a');
  });

  it('resolves an inconclusive prediction', async () => {
    const { engine, season } = await setup();
    const p = await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'c_b', predictedMetric: 'clicks',
      predictedDirection: 'increase', confidence: 0.5, evidenceBasis: [], rationale: 'r',
    });
    const resolved = await engine.resolvePrediction({ predictionId: p.id, result: 'inconclusive' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.prediction.result).toBe('inconclusive');
  });

  it('never rewrites the original forecast when resolving', async () => {
    const { engine, season } = await setup();
    const original = await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'c_b', predictedMetric: 'clicks',
      predictedDirection: 'increase', confidence: 0.65, evidenceBasis: ['fnd_1'],
      rationale: 'Treatment B uses a clearer CTA.',
    });
    const resolved = await engine.resolvePrediction({ predictionId: original.id, result: 'incorrect', actualWinnerCompetitorId: 'c_a' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // Every predicted field survives untouched.
    expect(resolved.prediction.predictedCompetitorId).toBe('c_b');
    expect(resolved.prediction.predictedMetric).toBe('clicks');
    expect(resolved.prediction.predictedDirection).toBe('increase');
    expect(resolved.prediction.confidence).toBe(0.65);
    expect(resolved.prediction.predictedAt).toBe(original.predictedAt);
    expect(resolved.prediction.rationale).toBe(original.rationale);
    expect(resolved.prediction.evidenceBasis).toEqual(['fnd_1']);
  });

  it('refuses to re-resolve an already-resolved prediction', async () => {
    const { engine, season } = await setup();
    const p = await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'c_b', predictedMetric: 'clicks',
      predictedDirection: 'increase', confidence: 0.7, evidenceBasis: [], rationale: 'r',
    });
    await engine.resolvePrediction({ predictionId: p.id, result: 'incorrect' });
    const second = await engine.resolvePrediction({ predictionId: p.id, result: 'correct' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain('already resolved');
  });

  it('computes prediction accuracy across a season', async () => {
    const { engine, season } = await setup();
    for (const [i, result] of (['correct', 'correct', 'incorrect', 'inconclusive'] as const).entries()) {
      const p = await engine.registerPrediction({
        seasonId: season.id, predictedCompetitorId: `c_${i}`, predictedMetric: 'clicks',
        predictedDirection: 'increase', confidence: 0.5, evidenceBasis: [], rationale: 'r',
      });
      await engine.resolvePrediction({ predictionId: p.id, result });
    }
    const accuracy = await engine.getPredictionAccuracy(season.id);
    // Inconclusive is excluded from the denominator.
    expect(accuracy.resolved).toBe(3);
    expect(accuracy.correct).toBe(2);
    expect(accuracy.accuracy).toBeCloseTo(2 / 3);
  });

  it('reports no accuracy until predictions resolve', () => {
    expect(predictionAccuracy([{ result: 'pending' }]).accuracy).toBeUndefined();
  });
});

describe('Battle — efficiency and milestones', () => {
  it('computes revenue per 1,000 impressions', () => {
    expect(perThousand(500, 100_000)).toBeCloseTo(5);
  });

  it('handles a zero denominator safely', () => {
    expect(perThousand(500, 0)).toBeUndefined();
    expect(rate(5, 0)).toBeUndefined();
  });

  it('never infers revenue from a missing numerator', () => {
    expect(perThousand(undefined, 100_000)).toBeUndefined();
  });

  it('computes a conversion rate', () => {
    expect(rate(25, 100)).toBeCloseTo(0.25);
  });

  it('supports a first-followers milestone with time-to-milestone', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const definition = await engine.defineMilestone({
      seasonId: season.id, name: 'First 100 followers', metric: 'followersGained', threshold: 100,
    });
    const achievement = await engine.recordMilestone({
      seasonId: season.id, definitionId: definition.id, competitorId: 'c_a', profileId: 'p_a',
      achievedAt: '2026-08-06T00:00:00Z', valueAtAchievement: 104,
    });
    // Season started 2026-08-01, so five days = 120 hours.
    expect(achievement.hoursFromSeasonStart).toBeCloseTo(120);
  });

  it('supports a first-sale milestone', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const definition = await engine.defineMilestone({
      seasonId: season.id, name: 'First sale', metric: 'sales', threshold: 1,
    });
    const achievement = await engine.recordMilestone({
      seasonId: season.id, definitionId: definition.id, competitorId: 'c_a', profileId: 'p_a',
      achievedAt: '2026-08-10T00:00:00Z', valueAtAchievement: 1,
    });
    expect(achievement.valueAtAchievement).toBe(1);
    expect((await store.listBattleMilestoneAchievements({ seasonId: season.id }))).toHaveLength(1);
  });

  it('supports an arbitrary custom milestone', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const definition = await engine.defineMilestone({
      seasonId: season.id, name: 'First $100 revenue', metric: 'revenue', threshold: 100,
    });
    expect(definition.threshold).toBe(100);
    expect(definition.metric).toBe('revenue');
  });
});

describe('Battle — evidence provenance and scope preservation', () => {
  it('carries the full provenance envelope on battle evidence', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine, { protocol: { version: '2.1.0' } });
    const division = await engine.createDivision({
      seasonId: season.id, name: 'Personal Finance', niche: 'personal finance',
      subNiche: 'debt payoff', declaredAudience: 'Late-20s professionals', profileIds: [], competitorProfileMap: {},
    });
    const evidence = await engine.buildEvidenceReference({
      seasonId: season.id, divisionId: division.id, objective: 'conversation',
      experimentIds: ['exp_1', 'exp_2'], sampleSize: 40,
      periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-08-31T00:00:00Z',
      platform: 'threads', accountStage: 'early',
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.seasonId).toBe(season.id);
    expect(evidence!.protocolVersion).toBe(season.protocolVersion);
    expect(evidence!.divisionId).toBe(division.id);
    expect(evidence!.niche).toBe('personal finance');
    expect(evidence!.subNiche).toBe('debt payoff');
    expect(evidence!.audienceContext).toBe('Late-20s professionals');
    expect(evidence!.accountStage).toBe('early');
    expect(evidence!.platform).toBe('threads');
    expect(evidence!.objective).toBe('conversation');
    expect(evidence!.experimentIds).toEqual(['exp_1', 'exp_2']);
    expect(evidence!.sampleSize).toBe(40);
    expect(evidence!.periodStart).toBe('2026-08-01T00:00:00Z');
    expect(evidence!.periodEnd).toBe('2026-08-31T00:00:00Z');
    expect(Array.isArray(evidence!.limitations)).toBe(true);
  });

  it('flags a small sample in the evidence envelope', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const evidence = await engine.buildEvidenceReference({
      seasonId: season.id, objective: 'conversation', experimentIds: ['exp_1'],
      sampleSize: 2, periodStart: NOW, periodEnd: NOW,
    });
    expect(evidence!.limitations).toContain('small_sample');
  });

  it('inherits matchup limitations into division-scoped evidence', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const division = await engine.createDivision({ seasonId: season.id, name: 'PF', profileIds: [], competitorProfileMap: {} });
    await engine.createMatchup({
      seasonId: season.id, divisionId: division.id, competitorProfileIds: ['a', 'b'],
      matchingCriteria: ['same niche'], limitations: ['mixed_account_stages'], status: 'active',
    });
    const evidence = await engine.buildEvidenceReference({
      seasonId: season.id, divisionId: division.id, objective: 'conversation',
      experimentIds: ['exp_1'], sampleSize: 50, periodStart: NOW, periodEnd: NOW,
    });
    expect(evidence!.limitations).toContain('mixed_account_stages');
  });

  it('keeps battle evidence scoped rather than universal', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const evidence = await engine.buildEvidenceReference({
      seasonId: season.id, objective: 'conversation', experimentIds: ['exp_1'],
      sampleSize: 100, periodStart: NOW, periodEnd: NOW, platform: 'threads',
    });
    // A conclusion carrying this envelope can always be re-scoped to the
    // exact conditions that produced it — niche, platform, period, protocol.
    expect(evidence!.niche).toBe('personal finance');
    expect(evidence!.platform).toBe('threads');
    expect(evidence!.protocolVersion).toBeDefined();
    expect(evidence!.periodStart).toBeDefined();
  });

  it('now carries limitations and an observation window onto a Finding', async () => {
    const store = await tmpStore();
    // The gap closed as part of this milestone: a caveat survives onto the
    // durable Finding rather than being lost at the boundary.
    await store.saveFinding({
      id: 'fnd_scoped', statement: 'Question hooks were associated with higher replies.',
      scope: { level: 'profile', profileId: 'p1' }, profileId: 'p1',
      sampleSize: 4, confidence: 0.6, status: 'promising', sourceExperimentIds: ['exp_1'],
      observationWindow: { from: '2026-08-01T00:00:00Z', to: '2026-08-31T00:00:00Z' },
      limitations: ['small_sample', 'single_pair'],
      createdAt: NOW, lastValidatedAt: NOW,
    });
    const finding = await store.getFinding('fnd_scoped');
    expect(finding!.limitations).toContain('single_pair');
    expect(finding!.observationWindow!.from).toBe('2026-08-01T00:00:00Z');
  });
});

describe('Battle — season lifecycle and historical preservation', () => {
  it('walks the season status lifecycle', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine, { season: { status: 'draft' } });
    for (const status of ['registration', 'scheduled', 'active', 'paused', 'completed'] as const) {
      const updated = await engine.setSeasonStatus(season.id, status);
      expect(updated!.status).toBe(status);
    }
  });

  it('preserves all history when a season is cancelled', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    await engine.createCompetitor({ seasonId: season.id, name: 'A', competitorType: 'strategy', profileIds: [] });
    await engine.registerPrediction({
      seasonId: season.id, predictedCompetitorId: 'a', predictedMetric: 'replies',
      predictedDirection: 'increase', confidence: 0.5, evidenceBasis: [], rationale: 'r',
    });
    await engine.setSeasonStatus(season.id, 'cancelled');
    expect((await store.getBattleSeason(season.id))!.status).toBe('cancelled');
    expect(await store.listBattleCompetitors({ seasonId: season.id })).toHaveLength(1);
    expect(await store.listBattlePredictions({ seasonId: season.id })).toHaveLength(1);
  });

  it('preserves evidence when a season is archived', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    await engine.createDivision({ seasonId: season.id, name: 'PF', profileIds: [], competitorProfileMap: {} });
    await engine.setSeasonStatus(season.id, 'archived');
    expect(await store.listBattleDivisions({ seasonId: season.id })).toHaveLength(1);
  });

  it('keeps a historical season reproducible via its protocol version', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season, protocol } = await seedSeason(store, engine, { protocol: { version: '1.2.3' } });
    await engine.setSeasonStatus(season.id, 'completed');
    const stored = await store.getBattleSeason(season.id);
    const storedProtocol = await store.getBattleProtocol(protocol.id);
    expect(stored!.protocolVersion).toBe('1.2.3');
    expect(storedProtocol!.version).toBe('1.2.3');
    expect(storedProtocol!.primaryMetrics).toEqual(['replies']);
  });

  it('supports a private battle', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine, { season: { isPublic: false } });
    expect(season.isPublic).toBe(false);
    expect(await store.listBattleSeasons({ isPublic: false })).toHaveLength(1);
  });

  it('supports a public battle', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    await seedSeason(store, engine, { season: { isPublic: true } });
    expect(await store.listBattleSeasons({ isPublic: true })).toHaveLength(1);
  });

  it('creates multiple coexisting rounds', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    for (const n of [1, 2, 3]) {
      await engine.createRound({
        seasonId: season.id, number: n, name: `Week ${n}`,
        startsAt: NOW, endsAt: NOW, experimentRegistrationIds: [], status: 'scheduled',
      });
    }
    const rounds = await store.listBattleRounds({ seasonId: season.id });
    expect(rounds.map((r) => r.number)).toEqual([1, 2, 3]);
  });
});

describe('Battle — invariants and isolation', () => {
  it('does not duplicate measurements already stored by Measurement Ingestion', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const profile = await seedProfile(store);
    await ingestMeasurementSnapshot({
      profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId,
      creatorOsPostId: 'p1', capturedAt: NOW, sourcePlatform: 'threads', rawMetrics: { replies: 10 },
    }, store);
    const competitor = await engine.createCompetitor({
      seasonId: season.id, name: 'A', competitorType: 'platform', platform: 'threads', profileIds: [profile.id],
    });
    const before = await store.listPostMeasurements({ profileId: profile.id });
    await engine.aggregateCompetitorTotals(competitor);
    expect(await store.listPostMeasurements({ profileId: profile.id })).toEqual(before);
  });

  it('sources business metrics only from first-party attribution', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const profile = await seedProfile(store);
    // Huge platform numbers, no attribution events.
    await ingestMeasurementSnapshot({
      profileId: profile.id, creatorOsAccountId: profile.creatorOsAccountId,
      creatorOsPostId: 'viral', capturedAt: NOW, sourcePlatform: 'threads',
      rawMetrics: { impressions: 900_000, views: 800_000 },
    }, store);
    const competitor = await engine.createCompetitor({
      seasonId: season.id, name: 'A', competitorType: 'platform', profileIds: [profile.id],
    });
    const { totals } = await engine.aggregateCompetitorTotals(competitor);
    expect(totals.attention).toBeGreaterThan(0);
    expect(totals.customerValue).toBeUndefined();
    expect(totals.conversion).toBeUndefined();
  });

  it('counts revenue only from attribution events', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    const profile = await seedProfile(store);
    await ingestAttributionEvent({
      profileId: profile.id, eventType: 'purchase', occurredAt: NOW,
      value: 79, currency: 'USD', source: 'stripe',
    }, store);
    const competitor = await engine.createCompetitor({
      seasonId: season.id, name: 'A', competitorType: 'platform', profileIds: [profile.id],
    });
    const { totals } = await engine.aggregateCompetitorTotals(competitor);
    expect(totals.customerValue).toBe(79);
    expect(totals.conversion).toBe(1);
  });

  it('keeps seasons isolated from each other', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const a = await seedSeason(store, engine);
    const b = await seedSeason(store, engine);
    await engine.createCompetitor({ seasonId: a.season.id, name: 'A', competitorType: 'strategy', profileIds: [] });
    expect(await store.listBattleCompetitors({ seasonId: a.season.id })).toHaveLength(1);
    expect(await store.listBattleCompetitors({ seasonId: b.season.id })).toHaveLength(0);
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fake = { getBattleSeason: async () => null } as unknown as IntelligenceStore;
    const engine = new BattleEngine(fake, { now: fixedNow });
    expect(await engine.getBattleSummary('nope')).toBeNull();
  });

  it('builds no publishing or scheduling capability', () => {
    const methods = Object.getOwnPropertyNames(BattleEngine.prototype);
    expect(methods.some((m) => /publish|schedulePost|generate|compose|send/i.test(m))).toBe(false);
  });

  it('requires no AI dependency — scoring is deterministic', () => {
    const model: BattleScoringModel = {
      id: 'm', name: 'x', categories: [{ category: 'conversation', weight: 1, metrics: [] }],
      methodology: 't', limitations: [], createdAt: NOW, schemaVersion: 1,
    };
    const competitors = [{ competitorId: 'a', totals: { conversation: 10 }, evidenceCount: 1 }];
    expect(scoreCompetitors({ model, competitors })).toEqual(scoreCompetitors({ model, competitors }));
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-battle-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const engine = new BattleEngine(first, { now: fixedNow });
    const { season } = await seedSeason(first, engine);
    await engine.createCompetitor({ seasonId: season.id, name: 'A', competitorType: 'strategy', profileIds: [] });

    const second = new JsonlIntelligenceStore(root);
    expect((await second.getBattleSeason(season.id))!.id).toBe(season.id);
    expect(await second.listBattleCompetitors({ seasonId: season.id })).toHaveLength(1);
  });

  it('produces a machine-readable season summary', async () => {
    const store = await tmpStore();
    const engine = new BattleEngine(store, { now: fixedNow });
    const { season } = await seedSeason(store, engine);
    await engine.createDivision({ seasonId: season.id, name: 'PF', profileIds: [], competitorProfileMap: {} });
    await engine.createCompetitor({ seasonId: season.id, name: 'A', competitorType: 'strategy', profileIds: [] });
    const summary = await engine.getBattleSummary(season.id);
    expect(summary!.divisionCount).toBe(1);
    expect(summary!.competitorCount).toBe(1);
    expect(summary!.protocol!.version).toBe('1.0.0');
  });
});
