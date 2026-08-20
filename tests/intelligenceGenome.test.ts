import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { SocialGenomeEngine, toPublicPattern } from '../src/intelligence/genome/engine.js';
import {
  CONTEXT_DIMENSIONS,
  contextCovers,
  contextSignature,
  contextsMatch,
  knownDimensions,
  mergeContexts,
  normalizeContext,
  normalizeDimension,
  unknownDimensions,
} from '../src/intelligence/genome/context.js';
import {
  assessGenomeFreshness,
  computeOperationalConfidence,
  countDistinctExperiments,
  countDistinctProfiles,
  deriveCaveats,
  determineStatus,
  summarizeEvidence,
} from '../src/intelligence/genome/aggregate.js';
import { DEFAULT_GENOME_POLICY } from '../src/intelligence/genome/types.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type { GenomeContext, GenomeEvidenceReference } from '../src/intelligence/index.js';

const NOW = '2026-08-20T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-genome-')));
}

function engineWith(store: JsonlIntelligenceStore, policy = {}): SocialGenomeEngine {
  return new SocialGenomeEngine(store, { now: fixedNow, policy });
}

let evidenceCounter = 0;
function ev(overrides: Partial<GenomeEvidenceReference> = {}): GenomeEvidenceReference {
  evidenceCounter += 1;
  return {
    id: `gev_${evidenceCounter}`,
    evidenceType: 'finding',
    recordId: `fnd_${evidenceCounter}`,
    direction: 'supporting',
    profileId: `prof_${evidenceCounter}`,
    experimentId: `exp_${evidenceCounter}`,
    lineageRoots: [`exp_${evidenceCounter}`],
    recordedAt: NOW,
    observedAt: NOW,
    limitations: [],
    ...overrides,
  };
}

/** N pieces of supporting evidence, each from a distinct profile and experiment. */
function independentEvidence(n: number, overrides: Partial<GenomeEvidenceReference> = {}): GenomeEvidenceReference[] {
  return Array.from({ length: n }, (_, i) =>
    ev({ profileId: `prof_${i}`, experimentId: `exp_${i}`, lineageRoots: [`exp_${i}`], ...overrides }),
  );
}

const ctx = (overrides: Partial<GenomeContext> = {}): GenomeContext => ({
  platforms: ['twitter'],
  niches: ['bookkeeping'],
  objectives: ['lead'],
  hookFamilies: ['specific-problem'],
  ...overrides,
});

// ===========================================================================
// CONTEXT AND SIGNATURES (§7, §12)
// ===========================================================================

describe('Genome context — deterministic signatures', () => {
  it('1. produces the same signature for the same normalized context', () => {
    expect(contextSignature(ctx())).toBe(contextSignature(ctx()));
  });

  it('2. is unaffected by array ordering', () => {
    const a = contextSignature({ platforms: ['twitter', 'threads'] });
    const b = contextSignature({ platforms: ['threads', 'twitter'] });
    expect(a).toBe(b);
  });

  it('3. normalizes duplicates and casing', () => {
    const a = contextSignature({ niches: ['Bookkeeping', 'bookkeeping', ' BOOKKEEPING '] });
    const b = contextSignature({ niches: ['bookkeeping'] });
    expect(a).toBe(b);
  });

  it('4. keeps different platforms distinct', () => {
    expect(contextSignature({ platforms: ['twitter'] })).not.toBe(contextSignature({ platforms: ['threads'] }));
  });

  it('5. keeps different objectives distinct', () => {
    expect(contextSignature({ objectives: ['reach'] })).not.toBe(contextSignature({ objectives: ['revenue'] }));
  });

  it('6. keeps different niches distinct', () => {
    expect(contextSignature({ niches: ['bookkeeping'] })).not.toBe(contextSignature({ niches: ['fitness'] }));
  });

  it('7. leaves unknown dimensions unknown rather than inventing them', () => {
    const context = normalizeContext({ platforms: ['twitter'] });
    expect(context.niches).toBeUndefined();
    expect(unknownDimensions(context)).toContain('niches');
    expect(knownDimensions(context)).toEqual(['platforms']);
  });

  it('treats an empty dimension as absent, not as an empty claim', () => {
    expect(normalizeDimension([])).toBeUndefined();
    expect(normalizeDimension(['  ', ''])).toBeUndefined();
    expect(normalizeContext({ niches: [] }).niches).toBeUndefined();
  });

  it('gives a fully empty context the wildcard signature', () => {
    expect(contextSignature({})).toBe('*');
  });

  it('does not collapse a narrower context into a broader one', () => {
    const broad = contextSignature({ platforms: ['twitter'] });
    const narrow = contextSignature({ platforms: ['twitter'], niches: ['bookkeeping'] });
    expect(broad).not.toBe(narrow);
  });

  it('matches contexts describing the same conditions', () => {
    expect(contextsMatch({ platforms: ['twitter', 'threads'] }, { platforms: ['threads', 'twitter'] })).toBe(true);
    expect(contextsMatch({ platforms: ['twitter'] }, { platforms: ['threads'] })).toBe(false);
  });

  it('reports unspecified dimensions rather than treating them as matches', () => {
    const result = contextCovers({ platforms: ['twitter'] }, { platforms: ['twitter'], niches: ['bookkeeping'] });
    expect(result.matched).toContain('platforms');
    expect(result.unspecified).toContain('niches');
    expect(result.unmatched).toEqual([]);
  });

  it('flags an actively conflicting dimension as unmatched', () => {
    const result = contextCovers({ platforms: ['threads'] }, { platforms: ['twitter'] });
    expect(result.unmatched).toContain('platforms');
    expect(result.covers).toBe(false);
  });

  it('merges contexts as a per-dimension union', () => {
    const merged = mergeContexts({ platforms: ['twitter'] }, { platforms: ['threads'], niches: ['fitness'] });
    expect(merged.platforms).toEqual(['threads', 'twitter']);
    expect(merged.niches).toEqual(['fitness']);
  });

  it('covers every declared dimension in the signature', () => {
    expect(CONTEXT_DIMENSIONS.length).toBeGreaterThanOrEqual(12);
  });
});

// ===========================================================================
// LIFECYCLE AND REPLICATION (§8, §13, §14, §24)
// ===========================================================================

describe('Genome lifecycle — replication gates promotion', () => {
  it('8. starts emerging on thin evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: [ev()],
    });
    expect(pattern.status).toBe('emerging');
  });

  it('9. becomes promising once the profile threshold is met', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(2),
    });
    expect(pattern.status).toBe('promising');
  });

  it('10. becomes supported only under the stronger threshold', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    expect(pattern.status).toBe('supported');
    expect(pattern.statusRationale).toContain('WITHIN THIS CONTEXT');
  });

  it('11. does not let one profile with many observations count as many profiles', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    // Ten observations, all from one profile, across ten experiments.
    const evidence = Array.from({ length: 10 }, (_, i) =>
      ev({ profileId: 'prof_solo', experimentId: `exp_${i}`, lineageRoots: [`exp_${i}`] }),
    );
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: evidence,
    });
    expect(pattern.sourceProfileCount).toBe(1);
    expect(pattern.status).toBe('emerging');
    expect(pattern.statusRationale).toContain('Cross-profile replication');
  });

  it('12. counts distinct profiles correctly', () => {
    const evidence = [
      ev({ profileId: 'a' }), ev({ profileId: 'a' }), ev({ profileId: 'b' }), ev({ profileId: 'c' }),
    ];
    expect(countDistinctProfiles(evidence)).toBe(3);
  });

  it('13. does not let one experiment with many measurements count as many experiments', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    // Three profiles, but all measuring the SAME experiment.
    const evidence = ['a', 'b', 'c'].map((p) =>
      ev({ profileId: p, experimentId: 'exp_shared', lineageRoots: ['exp_shared'] }),
    );
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: evidence,
    });
    expect(pattern.sourceExperimentCount).toBe(1);
    // Profile bar met, experiment bar not — promising, not supported.
    expect(pattern.status).toBe('promising');
  });

  it('14. counts distinct experiments correctly', () => {
    const evidence = [ev({ experimentId: 'e1' }), ev({ experimentId: 'e1' }), ev({ experimentId: 'e2' })];
    expect(countDistinctExperiments(evidence)).toBe(2);
  });

  it('deduplicates lineage so derived records are not independent evidence', () => {
    // A finding and a transfer derived from the same experiment.
    const summary = summarizeEvidence(
      [
        ev({ evidenceType: 'finding', lineageRoots: ['exp_1'] }),
        ev({ evidenceType: 'transfer_assessment', lineageRoots: ['exp_1'] }),
      ],
      [],
    );
    expect(summary.supportingCount).toBe(1);
  });
});

// ===========================================================================
// CONTRADICTION AND NEGATIVE KNOWLEDGE (§10, §26)
// ===========================================================================

describe('Genome contradiction — negative knowledge is retained', () => {
  it('15. retains contradictory evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(3),
      contradictingEvidence: [ev({ direction: 'contradicting', profileId: 'p_x', experimentId: 'e_x', lineageRoots: ['e_x'] })],
    });
    expect(pattern.contradictingEvidence).toHaveLength(1);
    expect(pattern.evidenceSummary.contradictingCount).toBe(1);
  });

  it('16. becomes contested under high contradiction', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(3),
      contradictingEvidence: Array.from({ length: 3 }, (_, i) =>
        ev({ direction: 'contradicting', profileId: `pc_${i}`, experimentId: `ec_${i}`, lineageRoots: [`ec_${i}`] }),
      ),
    });
    expect(pattern.status).toBe('contested');
    expect(pattern.statusRationale).toContain('disagreement');
  });

  it('17. can recover from contested when evidence changes', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const contested = await engine.upsertPattern({
      id: 'gpat_recover', statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(3),
      contradictingEvidence: Array.from({ length: 3 }, (_, i) =>
        ev({ direction: 'contradicting', profileId: `pc_${i}`, experimentId: `ec_${i}`, lineageRoots: [`ec_${i}`] }),
      ),
    });
    expect(contested.status).toBe('contested');

    const recovered = await engine.upsertPattern({
      id: 'gpat_recover', statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(12),
      contradictingEvidence: Array.from({ length: 3 }, (_, i) =>
        ev({ direction: 'contradicting', profileId: `pc_${i}`, experimentId: `ec_${i}`, lineageRoots: [`ec_${i}`] }),
      ),
    });
    expect(recovered.status).toBe('supported');
  });

  it('34. can represent negative knowledge as a contradicted pattern', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'Aggressive DM outreach was associated with poor outcomes under these conditions.',
      context: ctx(), objective: 'lead',
      supportingEvidence: [],
      contradictingEvidence: independentEvidence(4, { direction: 'contradicting' }),
    });
    expect(pattern.evidenceSummary.contradictingCount).toBe(4);
    expect(pattern.status).toBe('contested');
  });

  it('35. can represent a negative-transfer limitation', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'Pattern transferred poorly from creator profiles to local service businesses.',
      context: ctx({ niches: ['local-services'] }), objective: 'lead',
      supportingEvidence: [],
      contradictingEvidence: independentEvidence(3, { direction: 'contradicting', evidenceType: 'transfer_assessment' }),
      caveats: ['Negative transfer observed: creator-profile evidence did not hold for local service businesses.'],
    });
    expect(pattern.caveats.some((c) => c.includes('Negative transfer'))).toBe(true);
    expect(pattern.evidenceSummary.evidenceTypes).toContain('transfer_assessment');
  });

  it('finds contested patterns for review', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'contested', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(2),
      contradictingEvidence: independentEvidence(2, { direction: 'contradicting' }),
    });
    expect(await engine.findContested()).toHaveLength(1);
  });
});

// ===========================================================================
// DECAY AND FRESHNESS (§20)
// ===========================================================================

describe('Genome decay — knowledge is not timeless', () => {
  it('18. a supported pattern can decay', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(4, { observedAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z' }),
    });
    expect(pattern.status).toBe('decaying');
    expect(pattern.freshness).toBe('decaying');
  });

  it('19. a decayed pattern is not deleted', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(4, { observedAt: '2024-01-01T00:00:00Z', recordedAt: '2024-01-01T00:00:00Z' }),
    });
    expect(await store.getGenomePattern(pattern.id)).not.toBeNull();
  });

  it('20. a deprecated pattern remains readable', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    const deprecated = await engine.deprecatePattern(pattern.id, 'superseded by a better-scoped pattern');
    expect(deprecated!.status).toBe('deprecated');
    const reloaded = await store.getGenomePattern(pattern.id);
    expect(reloaded!.status).toBe('deprecated');
    expect(reloaded!.statusRationale).toContain('superseded');
  });

  it('25. old evidence affects freshness', () => {
    expect(assessGenomeFreshness('2024-01-01T00:00:00Z', NOW, DEFAULT_GENOME_POLICY)).toBe('decaying');
  });

  it('26. recent evidence remains current', () => {
    expect(assessGenomeFreshness(NOW, NOW, DEFAULT_GENOME_POLICY)).toBe('current');
  });

  it('marks mid-age evidence due for revalidation', () => {
    expect(assessGenomeFreshness('2026-04-01T00:00:00Z', NOW, DEFAULT_GENOME_POLICY)).toBe('due_for_revalidation');
  });

  it('27. revalidation can be requested without deleting the pattern', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(3, { observedAt: '2026-04-01T00:00:00Z', recordedAt: '2026-04-01T00:00:00Z' }),
    });
    const stale = await engine.findStale();
    expect(stale).toHaveLength(1);
    expect(stale[0]!.freshness).toBe('due_for_revalidation');
  });

  it('a deprecated pattern stays deprecated on re-evaluation', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    await engine.deprecatePattern(pattern.id, 'retired');
    const reevaluated = await engine.evaluatePattern(pattern.id);
    expect(reevaluated!.status).toBe('deprecated');
  });
});

// ===========================================================================
// CONFIDENCE (§22)
// ===========================================================================

describe('Genome confidence — operational, never a probability', () => {
  it('21. is clamped to 0..1', () => {
    const huge = summarizeEvidence(independentEvidence(500), []);
    const score = computeOperationalConfidence({ summary: huge, freshness: 'current', policy: DEFAULT_GENOME_POLICY });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('22. rises with independent replication', () => {
    const few = computeOperationalConfidence({
      summary: summarizeEvidence(independentEvidence(1), []), freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    const many = computeOperationalConfidence({
      summary: summarizeEvidence(independentEvidence(8), []), freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    expect(many).toBeGreaterThan(few);
  });

  it('22b. rises more from cross-profile than same-profile replication', () => {
    const sameProfile = Array.from({ length: 6 }, (_, i) =>
      ev({ profileId: 'solo', experimentId: `e${i}`, lineageRoots: [`e${i}`] }),
    );
    const crossProfile = independentEvidence(6);
    const a = computeOperationalConfidence({
      summary: summarizeEvidence(sameProfile, []), freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    const b = computeOperationalConfidence({
      summary: summarizeEvidence(crossProfile, []), freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    expect(b).toBeGreaterThan(a);
  });

  it('23. falls with contradiction', () => {
    const clean = computeOperationalConfidence({
      summary: summarizeEvidence(independentEvidence(4), []), freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    const contested = computeOperationalConfidence({
      summary: summarizeEvidence(independentEvidence(4), independentEvidence(3, { direction: 'contradicting' })),
      freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    expect(contested).toBeLessThan(clean);
  });

  it('24. is not represented as a probability', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    const explanation = await engine.explainGenomePattern(pattern.id);
    expect(explanation!.confidenceCaveat).toContain('NOT a statistical probability');
  });

  it('falls with staleness', () => {
    const summary = summarizeEvidence(independentEvidence(4), []);
    const current = computeOperationalConfidence({ summary, freshness: 'current', policy: DEFAULT_GENOME_POLICY });
    const decaying = computeOperationalConfidence({ summary, freshness: 'decaying', policy: DEFAULT_GENOME_POLICY });
    expect(decaying).toBeLessThan(current);
  });

  it('is zero with no evidence', () => {
    const summary = summarizeEvidence([], []);
    expect(computeOperationalConfidence({ summary, freshness: 'current', policy: DEFAULT_GENOME_POLICY })).toBe(0);
  });

  it('is not a plain average of source confidences', () => {
    // Ten mutually-dependent records sharing one lineage root must not
    // score like ten independent ones.
    const dependent = Array.from({ length: 10 }, () => ev({ profileId: 'solo', experimentId: 'e1', lineageRoots: ['e1'] }));
    const score = computeOperationalConfidence({
      summary: summarizeEvidence(dependent, []), freshness: 'current', policy: DEFAULT_GENOME_POLICY,
    });
    expect(score).toBeLessThan(0.6);
  });
});

// ===========================================================================
// SPECIFICITY SAFEGUARDS (§15–§19)
// ===========================================================================

describe('Genome specificity — objective, platform, niche, audience, offer', () => {
  it('28. reach evidence does not become revenue evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'Hook family X is supported for reach.',
      context: ctx({ objectives: ['reach'] }), objective: 'reach',
      supportingEvidence: independentEvidence(4),
    });
    const revenueQuery = await engine.query({ objective: 'revenue' });
    expect(revenueQuery.insufficientEvidence).toBe(true);
  });

  it('29. engagement does not become lead-generation evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx({ objectives: ['conversation'] }), objective: 'conversation',
      supportingEvidence: independentEvidence(4),
    });
    expect((await engine.query({ objective: 'lead' })).insufficientEvidence).toBe(true);
  });

  it('caveats state the objective boundary explicitly', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx({ objectives: ['reach'] }), objective: 'reach',
      supportingEvidence: independentEvidence(3),
    });
    expect(pattern.caveats.some((c) => c.includes('engagement evidence is not commercial evidence'))).toBe(true);
  });

  it('30. platform-specific evidence stays platform-specific', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx({ platforms: ['twitter'] }), objective: 'lead',
      supportingEvidence: independentEvidence(4),
    });
    expect((await engine.query({ platform: 'instagram' })).insufficientEvidence).toBe(true);
    expect((await engine.query({ platform: 'twitter' })).matches).toHaveLength(1);
  });

  it('records a single-platform caveat', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx({ platforms: ['twitter'] }), objective: 'lead',
      supportingEvidence: independentEvidence(3),
    });
    expect(pattern.caveats.some((c) => c.includes('Cross-platform transfer is not established'))).toBe(true);
  });

  it('can represent multi-platform replication', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx({ platforms: ['twitter', 'threads'] }), objective: 'lead',
      supportingEvidence: independentEvidence(4),
    });
    expect(pattern.context.platforms).toEqual(['threads', 'twitter']);
    expect(pattern.caveats.some((c) => c.includes('Cross-platform transfer is not established'))).toBe(false);
  });

  it('31. niche-specific evidence stays niche-specific', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx({ niches: ['bookkeeping'] }), objective: 'lead',
      supportingEvidence: independentEvidence(4),
    });
    expect((await engine.query({ niche: 'professional-services' })).insufficientEvidence).toBe(true);
    expect((await engine.query({ niche: 'bookkeeping' })).matches).toHaveLength(1);
  });

  it('32. audience-segment context stays scoped', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx({ audienceDescriptors: ['solo-operators'] }), objective: 'lead',
      supportingEvidence: independentEvidence(4),
    });
    expect((await engine.query({ audienceDescriptor: 'enterprise-buyers' })).insufficientEvidence).toBe(true);
  });

  it('33. offer and funnel context stays scoped', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x',
      context: ctx({ offerTypes: ['lead-magnet'], funnelStages: ['awareness'] }), objective: 'lead',
      supportingEvidence: independentEvidence(4),
    });
    expect((await engine.query({ offerType: 'high-ticket-consultation' })).insufficientEvidence).toBe(true);
    expect((await engine.query({ offerType: 'lead-magnet' })).matches).toHaveLength(1);
  });

  it('derives an offer-scope caveat', () => {
    const caveats = deriveCaveats({
      summary: summarizeEvidence(independentEvidence(3), []),
      offerTypes: ['lead-magnet'],
    });
    expect(caveats.some((c) => c.includes('lead-magnet'))).toBe(true);
  });
});

// ===========================================================================
// SOURCE BOUNDARIES (§28, §29, §30, §36, §37, §38)
// ===========================================================================

describe('Genome source boundaries', () => {
  it('36. a research claim alone cannot become supported Genome truth', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'A marketing article claims question hooks lift replies.',
      context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ evidenceType: 'strategy_claim', profileId: undefined, experimentId: undefined, lineageRoots: ['claim_1'] })],
    });
    // No profile or experiment replication behind it.
    expect(pattern.sourceProfileCount).toBe(0);
    expect(pattern.sourceExperimentCount).toBe(0);
    expect(pattern.status).toBe('emerging');
  });

  it('36b. many research claims still cannot reach supported', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const claims = Array.from({ length: 20 }, (_, i) =>
      ev({ evidenceType: 'strategy_claim', profileId: undefined, experimentId: undefined, lineageRoots: [`claim_${i}`] }),
    );
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: claims,
    });
    expect(pattern.status).not.toBe('supported');
  });

  it('37. a battle victory alone cannot become supported Genome truth', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'Competitor A led the conversation category in season 1.',
      context: ctx(), objective: 'lead',
      supportingEvidence: [ev({
        evidenceType: 'battle_result', profileId: undefined, experimentId: undefined,
        lineageRoots: ['season_1'], battleSeasonId: 'season_1', battleProtocolVersion: '1.0.0',
      })],
    });
    expect(pattern.status).toBe('emerging');
    expect(pattern.sourceProfileCount).toBe(0);
  });

  it('retains battle provenance on the evidence reference', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ evidenceType: 'battle_result', battleSeasonId: 'season_1', battleProtocolVersion: '2.0.0' })],
    });
    expect(pattern.supportingEvidence[0]!.battleSeasonId).toBe('season_1');
    expect(pattern.supportingEvidence[0]!.battleProtocolVersion).toBe('2.0.0');
  });

  it('38. a transfer candidate does not automatically become Genome truth', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ evidenceType: 'transfer_assessment', profileId: undefined, experimentId: undefined, lineageRoots: ['xfer_1'] })],
    });
    expect(pattern.status).toBe('emerging');
  });

  it('39. a profile-specific finding remains separate from a Genome pattern', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await store.saveFinding({
      id: 'fnd_local', statement: 'Local claim.', scope: { level: 'profile', profileId: 'prof_1' },
      profileId: 'prof_1', sampleSize: 20, confidence: 0.8, status: 'validated',
      sourceExperimentIds: ['exp_1'], createdAt: NOW, lastValidatedAt: NOW,
    });
    await engine.upsertPattern({
      statement: 'Genome claim.', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ recordId: 'fnd_local' })],
    });
    const finding = await store.getFinding('fnd_local');
    expect(finding!.statement).toBe('Local claim.');
    expect((await store.listGenomePatterns({}))[0]!.statement).toBe('Genome claim.');
  });

  it('60. does not embed the entire ProfileBrain', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    expect('profileBrain' in pattern).toBe(false);
    expect('nicheIntelligence' in pattern).toBe(false);
    expect('strategyMemory' in pattern).toBe(false);
  });
});

// ===========================================================================
// IMMUTABILITY OF SOURCES (§40–§44)
// ===========================================================================

describe('Genome never mutates its sources', () => {
  it('40. never mutates a source finding', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const original = {
      id: 'fnd_src', statement: 's', scope: { level: 'profile' as const, profileId: 'p' },
      profileId: 'p', sampleSize: 10, confidence: 0.7, status: 'validated' as const,
      sourceExperimentIds: ['exp_1'], createdAt: NOW, lastValidatedAt: NOW,
    };
    await store.saveFinding(original);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: [ev({ recordId: 'fnd_src' })],
    });
    expect(await store.getFinding('fnd_src')).toEqual(original);
  });

  it('41. never mutates a source experiment', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const experiment = {
      id: 'exp_src', profileId: 'p', platform: 'twitter' as const, niche: 'bookkeeping',
      objective: 'lead' as const,
      contentDna: { topic: 't', hookFamily: 'h', format: 'text' as const, tone: 'educational' as const, lengthClass: 'short' as const },
      design: { testVariables: [] }, execution: { publishedAt: NOW },
      createdAt: NOW, updatedAt: NOW,
    };
    await store.saveExperiment(experiment);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ evidenceType: 'experiment', recordId: 'exp_src' })],
    });
    expect(await store.getExperiment('exp_src')).toEqual(experiment);
  });

  it('42. never mutates a source research claim', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const claim = {
      id: 'clm_src', sourceId: 'src_1', statement: 'A claim.', claimType: 'playbook_claim' as const,
      scope: { level: 'global' as const }, causalStatus: 'unproven' as const, status: 'captured' as const,
      createdAt: NOW, updatedAt: NOW, schemaVersion: 1,
    };
    await store.saveStrategyClaim(claim);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ evidenceType: 'strategy_claim', recordId: 'clm_src' })],
    });
    expect(await store.getStrategyClaim('clm_src')).toEqual(claim);
  });

  it('43. evidence provenance survives a pattern update', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const evidence = independentEvidence(3);
    await engine.upsertPattern({
      id: 'gpat_prov', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: evidence,
    });
    const updated = await engine.upsertPattern({
      id: 'gpat_prov', statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [...evidence, ...independentEvidence(2, { profileId: 'new_p', experimentId: 'new_e' })],
    });
    expect(updated.supportingEvidence.some((e) => e.id === evidence[0]!.id)).toBe(true);
  });

  it('44. contradicting provenance survives a pattern update', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const contra = ev({ direction: 'contradicting', id: 'gev_contra' });
    await engine.upsertPattern({
      id: 'gpat_c', statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(3), contradictingEvidence: [contra],
    });
    const updated = await engine.upsertPattern({
      id: 'gpat_c', statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(5), contradictingEvidence: [contra],
    });
    expect(updated.contradictingEvidence.some((e) => e.id === 'gev_contra')).toBe(true);
  });
});

// ===========================================================================
// VERSIONING (§25)
// ===========================================================================

describe('Genome versioning', () => {
  it('45. increments version on a material update', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const v1 = await engine.upsertPattern({
      id: 'gpat_v', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: [ev()],
    });
    expect(v1.version).toBe(1);
    const v2 = await engine.upsertPattern({
      id: 'gpat_v', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    expect(v2.version).toBe(2);
    expect(v2.status).not.toBe(v1.status);
  });

  it('46. prior versions remain inspectable', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      id: 'gpat_h', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: [ev()],
    });
    await engine.upsertPattern({
      id: 'gpat_h', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    const history = await engine.getPatternHistory('gpat_h');
    expect(history).toHaveLength(1);
    expect(history[0]!.version).toBe(1);
    expect(history[0]!.status).toBe('emerging');
  });

  it('does not bump the version when nothing material changed', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const evidence = independentEvidence(3);
    const v1 = await engine.upsertPattern({
      id: 'gpat_same', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: evidence,
    });
    const v2 = await engine.upsertPattern({
      id: 'gpat_same', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: evidence,
    });
    expect(v2.version).toBe(v1.version);
  });

  it('chains supersedesPatternId on a material change', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      id: 'gpat_chain', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: [ev()],
    });
    const v2 = await engine.upsertPattern({
      id: 'gpat_chain', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    expect(v2.supersedesPatternId).toBe('gpat_chain');
  });

  it('preserves createdAt and firstObservedAt across updates', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const v1 = await engine.upsertPattern({
      id: 'gpat_t', statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ observedAt: '2026-01-01T00:00:00Z' })],
    });
    const v2 = await engine.upsertPattern({
      id: 'gpat_t', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    expect(v2.createdAt).toBe(v1.createdAt);
    expect(v2.firstObservedAt).toBe(v1.firstObservedAt);
  });
});

// ===========================================================================
// QUERY (§32)
// ===========================================================================

describe('Genome query', () => {
  async function seeded() {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'Twitter bookkeeping lead pattern.',
      context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    await engine.upsertPattern({
      statement: 'Threads fitness reach pattern.',
      context: { platforms: ['threads'], niches: ['fitness'], objectives: ['reach'], hookFamilies: ['contrarian'] },
      objective: 'reach', supportingEvidence: independentEvidence(2, { profileId: 'z', experimentId: 'z' }),
    });
    return { store, engine };
  }

  it('47. queries by platform', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ platform: 'twitter' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.pattern.statement).toContain('Twitter bookkeeping');
  });

  it('48. queries by niche', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ niche: 'fitness' })).matches).toHaveLength(1);
  });

  it('49. queries by objective', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ objective: 'lead' })).matches).toHaveLength(1);
  });

  it('50. queries by status', async () => {
    const { engine } = await seeded();
    const supported = await engine.query({ status: 'supported' });
    expect(supported.matches.every((m) => m.pattern.status === 'supported')).toBe(true);
  });

  it('51. queries by minimum confidence', async () => {
    const { engine } = await seeded();
    const all = await engine.query({});
    const high = await engine.query({ minimumConfidence: 0.99 });
    expect(high.matches.length).toBeLessThan(all.matches.length);
  });

  it('52. queries by recency', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ observedSince: '2027-01-01T00:00:00Z' })).matches).toHaveLength(0);
    expect((await engine.query({ observedSince: '2020-01-01T00:00:00Z' })).matches.length).toBeGreaterThan(0);
  });

  it('queries by hook family', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ hookFamily: 'specific-problem' })).matches).toHaveLength(1);
  });

  it('53. returns candidate knowledge, never a prescription', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ platform: 'twitter' });
    expect(result.matches[0]!.requiresTransferAssessment).toBe(true);
    expect(result.summary).toContain('transfer assessment');
    expect(JSON.stringify(result)).not.toMatch(/should post|recommend that|do this today/i);
  });

  it('reports insufficient evidence as an open question, not a negative result', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ platform: 'linkedin' });
    expect(result.insufficientEvidence).toBe(true);
    expect(result.summary).toContain('open question');
  });

  it('respects a query limit', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ limit: 1 })).matches).toHaveLength(1);
  });
});

// ===========================================================================
// EXPLAINABILITY (§33)
// ===========================================================================

describe('Genome explainability', () => {
  async function explained() {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: independentEvidence(4),
      contradictingEvidence: [ev({ direction: 'contradicting', profileId: 'pc', experimentId: 'ec', lineageRoots: ['ec'] })],
    });
    return { engine, explanation: (await engine.explainGenomePattern(pattern.id))! };
  }

  it('54. includes limitations', async () => {
    const { explanation } = await explained();
    expect(Array.isArray(explanation.limitations)).toBe(true);
    expect(explanation.limitations.length).toBeGreaterThan(0);
  });

  it('55. includes contradicting evidence', async () => {
    const { explanation } = await explained();
    expect(explanation.contradictingEvidenceSummary).toContain('1 independent contradicting');
  });

  it('56. includes distinct profile count', async () => {
    const { explanation } = await explained();
    expect(explanation.distinctProfileCount).toBe(5);
  });

  it('57. includes distinct experiment count', async () => {
    const { explanation } = await explained();
    expect(explanation.distinctExperimentCount).toBe(5);
  });

  it('58. includes freshness', async () => {
    const { explanation } = await explained();
    expect(explanation.freshness).toBe('current');
  });

  it('includes why the current status was assigned', async () => {
    const { explanation } = await explained();
    expect(explanation.statusRationale.length).toBeGreaterThan(0);
  });

  it('includes what should not be generalized', async () => {
    const { explanation } = await explained();
    expect(explanation.whatShouldNotBeGeneralized.length).toBeGreaterThan(0);
  });

  it('includes provenance types without exposing records', async () => {
    const { explanation } = await explained();
    expect(explanation.provenance).toContain('finding');
    expect(JSON.stringify(explanation)).not.toContain('fnd_');
  });

  it('names the unknown context dimensions', async () => {
    const { explanation } = await explained();
    expect(explanation.unknownContextDimensions).toContain('contentFormats');
  });

  it('returns null for an unknown pattern', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).explainGenomePattern('nope')).toBeNull();
  });
});

// ===========================================================================
// PRIVACY AND CUSTOMER ISOLATION (§5, §35, §41)
// ===========================================================================

describe('Genome privacy and customer isolation', () => {
  it('59. a general query result never exposes raw private customer evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead',
      supportingEvidence: [ev({ profileId: 'customer-a-profile', experimentId: 'customer-a-exp', recordId: 'customer-a-finding' })],
    });
    const serialized = JSON.stringify(await engine.query({ platform: 'twitter' }));
    expect(serialized).not.toContain('customer-a-profile');
    expect(serialized).not.toContain('customer-a-exp');
    expect(serialized).not.toContain('customer-a-finding');
  });

  it('exposes counts without identities', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    const result = await engine.query({ platform: 'twitter' });
    expect(result.matches[0]!.pattern.sourceProfileCount).toBe(4);
    expect('supportingEvidence' in result.matches[0]!.pattern).toBe(false);
  });

  it('the public pattern type carries no evidence arrays at all', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    const publicPattern = toPublicPattern(pattern);
    expect('supportingEvidence' in publicPattern).toBe(false);
    expect('contradictingEvidence' in publicPattern).toBe(false);
  });

  it('61. has no sensitive audience fields', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    const serialized = JSON.stringify(pattern).toLowerCase();
    for (const key of ['race', 'ethnicity', 'religion', 'sexualorientation', 'medicalcondition', 'politicalaffiliation', 'criminalhistory']) {
      expect(serialized).not.toContain(`"${key}"`);
    }
    expect(CONTEXT_DIMENSIONS).not.toContain('demographics' as never);
  });

  it('creates no individual visitor dossier', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx({ audienceDescriptors: ['solo-operators'] }), objective: 'lead',
      supportingEvidence: independentEvidence(3),
    });
    expect('visitorId' in pattern).toBe(false);
    expect('personId' in pattern).toBe(false);
    // Audience appears only as an aggregate descriptor.
    expect(pattern.context.audienceDescriptors).toEqual(['solo-operators']);
  });
});

// ===========================================================================
// ARCHITECTURE INVARIANTS (§40, §44)
// ===========================================================================

describe('Genome architecture invariants', () => {
  it('62. introduces no second Platform vocabulary', async () => {
    // The context reuses the CreatorOS Platform union; a bogus value is a
    // compile error, which this file would not build with.
    const context: GenomeContext = { platforms: ['twitter', 'threads', 'instagram', 'tiktok', 'linkedin'] };
    expect(contextSignature(context)).toContain('platforms=');
  });

  it('63. introduces no LLM dependency', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const a = await engine.upsertPattern({
      id: 'gpat_det', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    const b = await engine.upsertPattern({
      id: 'gpat_det', statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    expect(a.confidence).toBe(b.confidence);
    expect(a.status).toBe(b.status);
  });

  it('generates no content and schedules nothing', () => {
    const methods = Object.getOwnPropertyNames(SocialGenomeEngine.prototype);
    expect(methods.some((m) => /publish|schedule|generate(Content|Post)|prescribe|send/i.test(m))).toBe(false);
  });

  it('does not create prescriptions', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    expect(await store.listSocialPrescriptions({ profileId: 'prof_0' })).toEqual([]);
  });

  it('writes no Finding', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    expect(await store.listFindings()).toEqual([]);
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fake = { listGenomePatterns: async () => [] } as unknown as IntelligenceStore;
    const engine = new SocialGenomeEngine(fake, { now: fixedNow });
    expect((await engine.query({ platform: 'twitter' })).insufficientEvidence).toBe(true);
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-genome-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const engine = new SocialGenomeEngine(first, { now: fixedNow });
    const pattern = await engine.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(3),
    });
    const second = new JsonlIntelligenceStore(root);
    expect((await second.getGenomePattern(pattern.id))!.id).toBe(pattern.id);
  });

  it('summarizes status counts across the genome', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({ statement: 'a', context: ctx(), objective: 'lead', supportingEvidence: [ev()] });
    await engine.upsertPattern({
      statement: 'b', context: ctx({ niches: ['fitness'] }), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    const counts = await engine.summarize();
    expect(counts.emerging).toBe(1);
    expect(counts.supported).toBe(1);
  });

  it('exposes the policy as configurable operational thresholds', async () => {
    const store = await tmpStore();
    const strict = engineWith(store, { minimumProfilesForSupported: 10 });
    const pattern = await strict.upsertPattern({
      statement: 'x', context: ctx(), objective: 'lead', supportingEvidence: independentEvidence(4),
    });
    // Same evidence that reached `supported` under defaults does not here.
    expect(pattern.status).not.toBe('supported');
    expect(strict.getPolicy().minimumProfilesForSupported).toBe(10);
  });

  it('determineStatus is a pure function of its inputs', () => {
    const summary = summarizeEvidence(independentEvidence(4), []);
    const a = determineStatus({ summary, freshness: 'current', policy: DEFAULT_GENOME_POLICY });
    const b = determineStatus({ summary, freshness: 'current', policy: DEFAULT_GENOME_POLICY });
    expect(a).toEqual(b);
  });
});
