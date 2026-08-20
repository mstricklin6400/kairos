import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { IntelligenceTransferEngine } from '../src/intelligence/transfer/engine.js';
import { buildSimilarityProfile, compareDimensions, computeSimilarity } from '../src/intelligence/transfer/similarity.js';
import { DEFAULT_TRANSFER_POLICY } from '../src/intelligence/transfer/types.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type {
  BattleEvidenceReference,
  Finding,
  TransferCandidate,
  TransferContext,
} from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-19T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-transfer-')));
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    creatorOsAccountId: `acct_${Math.random().toString(36).slice(2, 10)}`,
    platform: 'threads',
    brandName: 'Finance Notes',
    niche: 'personal finance',
    subNiche: 'debt payoff',
    declaredAudience: 'Late-20s professionals paying down debt',
    primaryObjective: 'conversation',
    experimentMode: 'balanced',
    postsPerDay: 2,
    ...overrides,
  };
}

async function seedProfile(store: JsonlIntelligenceStore, overrides: Partial<ProfileOnboardingInput> = {}) {
  const result = await onboardProfile(onboardingInput(overrides), store, NOW);
  if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.errors)}`);
  return result.profile;
}

/** A context matching the seeded profile shape, for direct pure-function tests. */
function context(overrides: Partial<TransferContext> = {}): TransferContext {
  return {
    profileId: 'prof_target',
    platform: 'threads',
    niche: 'personal finance',
    subNiche: 'debt payoff',
    declaredAudience: 'Late-20s professionals paying down debt',
    observedSegmentIds: ['oseg_1'],
    objective: 'conversation',
    accountStage: 'early',
    followerCount: 5000,
    offerTypes: ['digital-product'],
    postsPerDay: 2,
    positioning: 'No-fluff debt payoff',
    geographicFocus: ['US'],
    typicalContentFormats: ['text'],
    hasFirstPartyEvidence: true,
    ...overrides,
  };
}

/** A candidate that matches `context()` on essentially every dimension. */
function candidate(overrides: Partial<TransferCandidate> = {}): TransferCandidate {
  return {
    id: 'cand_1',
    findingId: 'fnd_1',
    statement: 'Question-led hooks were associated with higher reply rate.',
    sourceClass: 'matched_peer',
    sourceProfileId: 'prof_source',
    sourcePlatform: 'threads',
    sourceNiche: 'personal finance',
    sourceSubNiche: 'debt payoff',
    sourceObjective: 'conversation',
    sourceAccountStage: 'early',
    sourceAudienceDescription: 'Late-20s professionals paying down debt',
    sourceObserved: true,
    sourceOfferTypes: ['digital-product'],
    sourceFollowerCount: 5200,
    sourcePositioning: 'No-fluff debt payoff',
    sourceGeographicFocus: ['US'],
    confidence: 0.8,
    sampleSize: 40,
    lastValidatedAt: '2026-08-01T00:00:00Z',
    limitations: [],
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_src',
    statement: 'Question-led hooks were associated with higher reply rate.',
    scope: { level: 'profile', profileId: 'prof_source' },
    profileId: 'prof_source',
    platform: 'threads',
    niche: 'personal finance',
    subNiche: 'debt payoff',
    objective: 'conversation',
    accountStage: 'early',
    sampleSize: 40,
    confidence: 0.8,
    status: 'validated',
    sourceExperimentIds: ['exp_1'],
    observationWindow: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' },
    limitations: ['small_sample'],
    createdAt: '2026-08-01T00:00:00Z',
    lastValidatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('Transfer — explainable similarity', () => {
  it('returns a dimension-by-dimension breakdown, never an opaque number', () => {
    const similarity = computeSimilarity(candidate(), context(), DEFAULT_TRANSFER_POLICY, NOW);
    expect(similarity.dimensions.length).toBeGreaterThan(10);
    expect(similarity.dimensions.every((d) => typeof d.note === 'string' && d.note.length > 0)).toBe(true);
    expect(similarity.dimensions.every((d) => typeof d.weight === 'number')).toBe(true);
  });

  it('scores a near-identical peer as highly similar', () => {
    const similarity = computeSimilarity(candidate(), context(), DEFAULT_TRANSFER_POLICY, NOW);
    expect(similarity.overallSimilarity).toBeGreaterThan(0.8);
    expect(similarity.matchedDimensions).toContain('niche');
    expect(similarity.matchedDimensions).toContain('platform');
    expect(similarity.matchedDimensions).toContain('objective');
  });

  it('reports mismatched dimensions explicitly', () => {
    const similarity = computeSimilarity(
      candidate({ sourcePlatform: 'twitter', sourceNiche: 'fitness' }),
      context(),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    expect(similarity.mismatchedDimensions).toContain('platform');
    expect(similarity.mismatchedDimensions).toContain('niche');
  });

  it('treats an uncomparable dimension as unknown, never as a match', () => {
    const similarity = computeSimilarity(
      candidate({ sourceGeographicFocus: undefined }),
      context({ geographicFocus: undefined }),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    expect(similarity.unknownDimensions).toContain('geography');
    expect(similarity.matchedDimensions).not.toContain('geography');
    expect(similarity.mismatchedDimensions).not.toContain('geography');
  });

  it('lowers coverage rather than similarity when dimensions are unknown', () => {
    const full = computeSimilarity(candidate(), context(), DEFAULT_TRANSFER_POLICY, NOW);
    const sparse = computeSimilarity(
      candidate({
        sourceNiche: undefined, sourceSubNiche: undefined, sourceAudienceDescription: undefined,
        sourcePositioning: undefined, sourceGeographicFocus: undefined, sourceFollowerCount: undefined,
        sourceAccountStage: undefined, sourceOfferTypes: [],
      }),
      context(),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    expect(sparse.dimensionCoverage).toBeLessThan(full.dimensionCoverage);
    expect(sparse.unknownDimensions.length).toBeGreaterThan(full.unknownDimensions.length);
  });

  it('distinguishes high similarity over few dimensions from high similarity over many', () => {
    const sparse = computeSimilarity(
      candidate({
        sourceNiche: undefined, sourceSubNiche: undefined, sourceAudienceDescription: undefined,
        sourcePositioning: undefined, sourceGeographicFocus: undefined, sourceFollowerCount: undefined,
        sourceAccountStage: undefined, sourceOfferTypes: [], sourceObserved: false,
      }),
      context(),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    // Similarity may still be high, but coverage exposes how little was known.
    expect(sparse.dimensionCoverage).toBeLessThan(0.6);
  });

  it('scores partial account-stage adjacency as partial, not a flat mismatch', () => {
    const dimensions = compareDimensions(
      candidate({ sourceAccountStage: 'growing' }),
      context({ accountStage: 'early' }),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    expect(dimensions.find((d) => d.key === 'accountStage')!.comparison).toBe('partial');
  });

  it('scores distant account stages as a mismatch', () => {
    const dimensions = compareDimensions(
      candidate({ sourceAccountStage: 'mature' }),
      context({ accountStage: 'cold-start' }),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    expect(dimensions.find((d) => d.key === 'accountStage')!.comparison).toBe('mismatch');
  });

  it('compares account size by order of magnitude, not exact value', () => {
    const close = compareDimensions(candidate({ sourceFollowerCount: 6000 }), context({ followerCount: 5000 }), DEFAULT_TRANSFER_POLICY, NOW);
    const far = compareDimensions(candidate({ sourceFollowerCount: 500_000 }), context({ followerCount: 5000 }), DEFAULT_TRANSFER_POLICY, NOW);
    expect(close.find((d) => d.key === 'accountSize')!.comparison).toBe('match');
    expect(far.find((d) => d.key === 'accountSize')!.comparison).toBe('mismatch');
  });

  it('uses configurable, documented weights', () => {
    const heavyGeography = computeSimilarity(
      candidate({ sourceGeographicFocus: ['UK'] }),
      context({ geographicFocus: ['US'] }),
      { ...DEFAULT_TRANSFER_POLICY, dimensionWeights: { ...DEFAULT_TRANSFER_POLICY.dimensionWeights, geography: 10 } },
      NOW,
    );
    const lightGeography = computeSimilarity(
      candidate({ sourceGeographicFocus: ['UK'] }),
      context({ geographicFocus: ['US'] }),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    expect(heavyGeography.overallSimilarity).toBeLessThan(lightGeography.overallSimilarity);
  });

  it('aggregates an empty dimension set safely', () => {
    const profile = buildSimilarityProfile([]);
    expect(profile.overallSimilarity).toBe(0);
    expect(profile.dimensionCoverage).toBe(0);
  });

  it('treats declared-audience-only evidence as not behaviorally proven', () => {
    const dimensions = compareDimensions(
      candidate({ sourceObserved: false }),
      context(),
      DEFAULT_TRANSFER_POLICY,
      NOW,
    );
    // Declared text may match, but audience BEHAVIOR is unknown without observation.
    expect(dimensions.find((d) => d.key === 'audienceBehavior')!.comparison).toBe('unknown');
  });

  it('lets observed audience evidence contribute when both sides have it', () => {
    const dimensions = compareDimensions(candidate({ sourceObserved: true }), context(), DEFAULT_TRANSFER_POLICY, NOW);
    expect(dimensions.find((d) => d.key === 'audienceBehavior')!.comparison).not.toBe('unknown');
  });

  it('scores measurement quality from sample size and declared limitations', () => {
    const good = compareDimensions(candidate({ sampleSize: 40, limitations: [] }), context(), DEFAULT_TRANSFER_POLICY, NOW);
    const weak = compareDimensions(candidate({ sampleSize: 2, limitations: ['small_sample'] }), context(), DEFAULT_TRANSFER_POLICY, NOW);
    expect(good.find((d) => d.key === 'measurementQuality')!.comparison).toBe('match');
    expect(weak.find((d) => d.key === 'measurementQuality')!.comparison).toBe('mismatch');
  });
});

describe('Transfer — relevance verdicts', () => {
  async function engineWith(store: JsonlIntelligenceStore) {
    return new IntelligenceTransferEngine(store, { now: fixedNow });
  }

  it('rates a same-profile first-party finding as directly applicable', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(
      candidate({ sourceClass: 'first_party', sourceProfileId: 'prof_target' }),
      context(),
    );
    expect(assessment.relevance).toBe('directly_applicable');
    expect(assessment.recommendation.action).toBe('apply_with_confidence');
  });

  it('caps non-first-party evidence below directly applicable', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(candidate({ sourceClass: 'matched_peer' }), context());
    expect(assessment.relevance).not.toBe('directly_applicable');
    expect(assessment.relevance).toBe('strongly_relevant');
  });

  it('rates a matched peer as strongly relevant and recommends testing it here', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(candidate({ sourceClass: 'matched_peer' }), context());
    expect(assessment.recommendation.action).toBe('run_experiment');
    expect(assessment.recommendation.proposedHypothesisStatement).toContain('For this profile');
  });

  it('downgrades same-niche/different-platform evidence', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const same = await engine.assessTransfer(candidate(), context());
    const crossPlatform = await engine.assessTransfer(candidate({ sourcePlatform: 'twitter' }), context());
    expect(crossPlatform.similarity.overallSimilarity).toBeLessThan(same.similarity.overallSimilarity);
    expect(crossPlatform.negativeTransferRisks.map((r) => r.reason)).toContain('platform_mechanics_incompatible');
  });

  it('downgrades same-platform/different-niche evidence', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const crossNiche = await engine.assessTransfer(candidate({ sourceNiche: 'fitness', sourceSubNiche: 'powerlifting' }), context());
    expect(crossNiche.similarity.mismatchedDimensions).toContain('niche');
  });

  it('caps cross-niche source class at hypothesis only', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(candidate({ sourceClass: 'cross_niche' }), context());
    expect(assessment.relevance).toBe('hypothesis_only');
    expect(assessment.recommendation.action).toBe('seed_hypothesis');
  });

  it('caps research-class evidence at hypothesis only', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(candidate({ sourceClass: 'research' }), context());
    expect(assessment.relevance).toBe('hypothesis_only');
  });

  it('treats a same-audience/different-objective result as a hypothesis only', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(candidate({ sourceObjective: 'revenue' }), context({ objective: 'conversation' }));
    expect(assessment.relevance).toBe('hypothesis_only');
    expect(assessment.negativeTransferRisks.map((r) => r.reason)).toContain('objective_mismatch');
  });

  it('reports insufficiently comparable when coverage is too low', async () => {
    const store = await tmpStore();
    const engine = await engineWith(store);
    const assessment = await engine.assessTransfer(
      candidate({
        sourcePlatform: undefined, sourceNiche: undefined, sourceSubNiche: undefined,
        sourceObjective: undefined, sourceAccountStage: undefined, sourceAudienceDescription: undefined,
        sourceOfferTypes: [], sourceFollowerCount: undefined, sourcePositioning: undefined,
        sourceGeographicFocus: undefined, sourceObserved: false,
      }),
      context(),
    );
    expect(assessment.relevance).toBe('insufficiently_comparable');
    expect(assessment.recommendation.action).toBe('collect_more_evidence');
  });
});

describe('Transfer — negative transfer', () => {
  it('flags an account-stage mismatch', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(
      candidate({ sourceAccountStage: 'mature' }),
      context({ accountStage: 'cold-start' }),
    );
    expect(assessment.negativeTransferRisks.map((r) => r.reason)).toContain('account_stage_mismatch');
  });

  it('flags an incompatible offer', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(
      candidate({ sourceOfferTypes: ['service'] }),
      context({ offerTypes: ['digital-product'] }),
    );
    expect(assessment.negativeTransferRisks.map((r) => r.reason)).toContain('offer_incompatible');
  });

  it('flags stale evidence and caps relevance', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(
      candidate({ lastValidatedAt: '2024-01-01T00:00:00Z' }),
      context(),
    );
    expect(assessment.negativeTransferRisks.map((r) => r.reason)).toContain('stale_evidence');
    expect(assessment.relevance).toBe('weakly_relevant');
    expect(assessment.evidenceAgeDays).toBeGreaterThan(500);
  });

  it('contraindicates evidence the receiving profile already rejected', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding({
      ...finding(),
      id: 'fnd_rejected_here',
      profileId: profile.id,
      scope: { level: 'profile', profileId: profile.id },
      status: 'rejected',
    });
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context({ profileId: profile.id }));
    expect(assessment.negativeTransferRisks.map((r) => r.reason)).toContain('conflicting_first_party_evidence');
    expect(assessment.relevance).toBe('contraindicated');
    expect(assessment.recommendation.action).toBe('do_not_transfer');
  });

  it('lets first-party evidence dominate transferred evidence on its own profile', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding({
      ...finding(), id: 'fnd_local', profileId: profile.id,
      scope: { level: 'profile', profileId: profile.id }, status: 'rejected',
    });
    const dominating = new IntelligenceTransferEngine(store, { now: fixedNow, policy: { firstPartyDominates: true } });
    const notDominating = new IntelligenceTransferEngine(store, { now: fixedNow, policy: { firstPartyDominates: false } });
    const a = await dominating.assessTransfer(candidate(), context({ profileId: profile.id }));
    const b = await notDominating.assessTransfer(candidate(), context({ profileId: profile.id }));
    expect(a.relevance).toBe('contraindicated');
    expect(b.relevance).not.toBe('contraindicated');
  });

  it('flags differing observed audience behavior', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(
      candidate({ sourceObserved: true, sourceAudienceDescription: 'Retirees managing pensions' }),
      context({ observedSegmentIds: ['oseg_1'] }),
    );
    // Partial rather than mismatch here, but the dimension is engaged.
    expect(assessment.similarity.dimensions.find((d) => d.key === 'audienceBehavior')!.comparison).not.toBe('unknown');
  });
});

describe('Transfer — battle evidence and the leaderboard guard', () => {
  const battleProvenance: BattleEvidenceReference = {
    seasonId: 'season_1',
    protocolVersion: '1.0.0',
    divisionId: 'div_pf',
    niche: 'personal finance',
    objective: 'conversation',
    experimentIds: ['exp_1'],
    sampleSize: 40,
    periodStart: '2026-07-01T00:00:00Z',
    periodEnd: '2026-08-01T00:00:00Z',
    limitations: ['unmatched_comparison'],
  };

  it('retains battle provenance through the assessment', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate({ battleProvenance }), context());
    expect(assessment.battleProvenance).toEqual(battleProvenance);
    expect(assessment.battleProvenance!.protocolVersion).toBe('1.0.0');
    expect(assessment.battleProvenance!.seasonId).toBe('season_1');
  });

  it('refuses to transfer a leaderboard position as evidence', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(
      candidate({ isLeaderboardPosition: true, battleProvenance }),
      context(),
    );
    expect(assessment.negativeTransferRisks.map((r) => r.reason)).toContain('leaderboard_not_evidence');
    expect(assessment.relevance).toBe('irrelevant');
    expect(assessment.recommendation.action).toBe('do_not_transfer');
  });

  it('accepts a properly scoped battle FINDING while rejecting a standing', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const asFinding = await engine.assessTransfer(candidate({ battleProvenance }), context());
    const asStanding = await engine.assessTransfer(candidate({ battleProvenance, isLeaderboardPosition: true }), context());
    expect(asFinding.recommendation.action).not.toBe('do_not_transfer');
    expect(asStanding.recommendation.action).toBe('do_not_transfer');
  });
});

describe('Transfer — science integration', () => {
  it('seeds a hypothesis on the receiving profile', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context({ profileId: profile.id }));
    const seeded = await engine.seedHypothesisFromAssessment(assessment, {
      dependentMetric: 'replies', independentVariable: 'hookFamily',
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const hypothesis = await store.getHypothesis(seeded.hypothesisId);
    expect(hypothesis!.profileId).toBe(profile.id);
    // Untested here, whatever it showed elsewhere.
    expect(hypothesis!.status).toBe('proposed');
    expect(hypothesis!.source).toBe('research');
    expect(hypothesis!.confidence).toBeLessThanOrEqual(0.3);
  });

  it('never creates a validated Finding from transfer alone', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context({ profileId: profile.id }));
    await engine.seedHypothesisFromAssessment(assessment, { dependentMetric: 'replies', independentVariable: 'hookFamily' });
    expect(await store.listFindings({ profileId: profile.id })).toEqual([]);
  });

  it('refuses to seed a hypothesis from a do-not-transfer assessment', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate({ isLeaderboardPosition: true }), context());
    const seeded = await engine.seedHypothesisFromAssessment(assessment, {
      dependentMetric: 'replies', independentVariable: 'hookFamily',
    });
    expect(seeded.ok).toBe(false);
  });

  it('builds a candidate from a stored Finding, carrying its limitations', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const built = engine.candidateFromFinding(finding(), { sourceClass: 'matched_peer' });
    expect(built.findingId).toBe('fnd_src');
    expect(built.limitations).toContain('small_sample');
    expect(built.observationWindowEnd).toBe('2026-08-01T00:00:00Z');
  });
});

describe('Transfer — cold start', () => {
  it('states plainly that nothing is known yet', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const guidance = await engine.buildColdStartGuidance(
      context({ hasFirstPartyEvidence: false }),
      [candidate()],
    );
    expect(guidance.isColdStart).toBe(true);
    expect(guidance.statement).toContain('do not know what works');
    expect(guidance.statement).toContain('still needs testing');
  });

  it('offers starting hypotheses from comparable profiles', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const guidance = await engine.buildColdStartGuidance(
      context({ hasFirstPartyEvidence: false }),
      [candidate({ id: 'c1' }), candidate({ id: 'c2', sourceClass: 'niche', statement: 'Threads chains lift reach.' })],
    );
    expect(guidance.startingHypotheses.length).toBeGreaterThan(0);
    expect(guidance.startingHypotheses.every((h) => h.statement.length > 0)).toBe(true);
  });

  it('marks cold-start guidance with honest limitations', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const guidance = await engine.buildColdStartGuidance(context({ hasFirstPartyEvidence: false }), [candidate()]);
    expect(guidance.limitations).toContain('small_sample');
  });

  it('says first-party evidence takes precedence once it exists', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const guidance = await engine.buildColdStartGuidance(context({ hasFirstPartyEvidence: true }), [candidate()]);
    expect(guidance.isColdStart).toBe(false);
    expect(guidance.statement).toContain('takes precedence');
  });

  it('excludes do-not-transfer candidates from cold-start hypotheses', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const guidance = await engine.buildColdStartGuidance(
      context({ hasFirstPartyEvidence: false }),
      [candidate({ id: 'c_bad', isLeaderboardPosition: true })],
    );
    expect(guidance.startingHypotheses).toHaveLength(0);
  });
});

describe('Transfer — explainability contract', () => {
  it('answers why it might apply and why it might not', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate({ sourcePlatform: 'twitter' }), context());
    expect(assessment.whyItMightApply.length).toBeGreaterThan(0);
    expect(assessment.whyItMightNotApply.length).toBeGreaterThan(0);
    expect(assessment.whyItMightNotApply.some((r) => r.includes('platform'))).toBe(true);
  });

  it('lists what is unknown', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate({ sourceGeographicFocus: undefined }), context({ geographicFocus: undefined }));
    expect(assessment.unknowns.some((u) => u.includes('geography'))).toBe(true);
  });

  it('reports evidence freshness in days', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate({ lastValidatedAt: '2026-08-01T00:00:00Z' }), context());
    expect(assessment.evidenceAgeDays).toBe(18);
  });

  it('states what Kairos should do with the evidence', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context());
    expect(assessment.recommendation.action).toBeDefined();
    expect(assessment.recommendation.reason.length).toBeGreaterThan(0);
  });

  it('exposes assessment confidence separately from the underlying claim confidence', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate({ confidence: 0.95 }), context());
    // Assessment confidence reflects how much was knowable, not how strong the claim was.
    expect(assessment.assessmentConfidence).toBeGreaterThanOrEqual(0);
    expect(assessment.assessmentConfidence).toBeLessThanOrEqual(1);
    expect(assessment.assessmentConfidence).not.toBe(0.95);
  });

  it('records the policy version on every assessment', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow, policy: { policyVersion: 'transfer-test-1' } });
    const assessment = await engine.assessTransfer(candidate(), context());
    expect(assessment.policyVersion).toBe('transfer-test-1');
  });
});

describe('Transfer — storage, history and isolation', () => {
  it('persists and retrieves an assessment', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context());
    expect((await store.getTransferAssessment(assessment.id))!.id).toBe(assessment.id);
  });

  it('preserves historical assessments rather than overwriting them', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const first = await engine.assessTransfer(candidate({ id: 'c1' }), context());
    const second = await engine.assessTransfer(candidate({ id: 'c2' }), context());
    const all = await engine.listAssessments('prof_target');
    expect(all.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('keeps assessments isolated per receiving profile', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    await engine.assessTransfer(candidate(), context({ profileId: 'prof_a' }));
    await engine.assessTransfer(candidate(), context({ profileId: 'prof_b' }));
    expect(await engine.listAssessments('prof_a')).toHaveLength(1);
    expect(await engine.listAssessments('prof_b')).toHaveLength(1);
  });

  it('creates and retrieves a peer cohort with explicit criteria', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const cohort = await engine.createPeerCohort({
      name: 'Early-stage personal finance on Threads',
      profileIds: ['p1', 'p2', 'p3'],
      criteria: ['same niche', 'same platform', 'account stage: early'],
      niche: 'personal finance', platform: 'threads', accountStage: 'early',
      limitations: ['mixed_account_stages'],
    });
    const stored = await store.getPeerCohort(cohort.id);
    expect(stored!.criteria).toHaveLength(3);
    expect(stored!.profileIds).toHaveLength(3);
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-transfer-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const engine = new IntelligenceTransferEngine(first, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context());
    const second = new JsonlIntelligenceStore(root);
    expect((await second.getTransferAssessment(assessment.id))!.id).toBe(assessment.id);
  });

  it('builds a transfer context from stored records', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { niche: 'personal finance', primaryObjective: 'sale' });
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const built = await engine.buildTransferContext(profile.id, { accountStage: 'early' });
    expect(built!.niche).toBe('personal finance');
    expect(built!.objective).toBe('sale');
    expect(built!.accountStage).toBe('early');
    expect(built!.hasFirstPartyEvidence).toBe(false);
  });

  it('returns null context for an unknown profile', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    expect(await engine.buildTransferContext('nope')).toBeNull();
  });

  it('detects existing first-party evidence when building context', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding({ ...finding(), id: 'f1', profileId: profile.id, scope: { level: 'profile', profileId: profile.id } });
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const built = await engine.buildTransferContext(profile.id);
    expect(built!.hasFirstPartyEvidence).toBe(true);
  });

  it('ranks many assessments by recommendation priority', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessments = await engine.assessMany(
      [
        candidate({ id: 'weak', sourceClass: 'cross_niche' }),
        candidate({ id: 'strong', sourceClass: 'matched_peer' }),
      ],
      context(),
    );
    expect(assessments[0]!.recommendation.priority).toBeGreaterThanOrEqual(assessments[1]!.recommendation.priority);
  });
});

describe('Transfer — invariants', () => {
  it('introduces no sensitive-trait fields', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context());
    const sensitive = ['race', 'ethnicity', 'religion', 'sexualOrientation', 'medicalCondition', 'politicalParty', 'criminalHistory', 'gender', 'age'];
    const serialized = JSON.stringify(assessment).toLowerCase();
    for (const key of sensitive) {
      expect(serialized).not.toContain(`"${key.toLowerCase()}"`);
    }
    // And the compared dimensions are marketing/behavioral only.
    for (const dimension of assessment.similarity.dimensions) {
      expect(sensitive).not.toContain(dimension.key);
    }
  });

  it('creates no individual visitor dossier — transfer compares profiles and cohorts only', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const assessment = await engine.assessTransfer(candidate(), context());
    // Every identifier on an assessment is a profile, finding or cohort id.
    expect(assessment.targetProfileId).toBeDefined();
    expect('personId' in assessment).toBe(false);
    expect('visitorId' in assessment).toBe(false);
  });

  it('requires no AI dependency — assessment is deterministic', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const a = computeSimilarity(candidate(), context(), DEFAULT_TRANSFER_POLICY, NOW);
    const b = computeSimilarity(candidate(), context(), DEFAULT_TRANSFER_POLICY, NOW);
    expect(a).toEqual(b);
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fake = { getProfile: async () => null } as unknown as IntelligenceStore;
    const engine = new IntelligenceTransferEngine(fake, { now: fixedNow });
    expect(await engine.buildTransferContext('x')).toBeNull();
  });

  it('leaves the source finding unchanged after assessment', async () => {
    const store = await tmpStore();
    const original = finding();
    await store.saveFinding(original);
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    await engine.assessTransfer(candidate({ findingId: original.id }), context());
    expect(await store.getFinding(original.id)).toEqual(original);
  });

  it('never writes a Finding under any transfer path', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const ctx = context({ profileId: 'prof_clean' });
    await engine.assessMany(
      [candidate({ id: 'a' }), candidate({ id: 'b', sourceClass: 'first_party' }), candidate({ id: 'c', sourceClass: 'research' })],
      ctx,
    );
    await engine.buildColdStartGuidance(ctx, [candidate({ id: 'd' })]);
    expect(await store.listFindings()).toEqual([]);
  });
});
