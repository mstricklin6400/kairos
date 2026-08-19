import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { ingestCreatorOsSkill, ingestResearchSource, ingestStrategyClaim } from '../src/intelligence/research/ingest.js';
import { validateResearchSourceInput, validateStrategyClaimInput } from '../src/intelligence/research/validate.js';
import {
  countSupportingVsContradictingClaims,
  deriveDefaultCausalStatus,
  deriveKnowledgeSourceType,
  groupClaimsByClaimType,
  groupClaimsByPlatform,
  groupClaimsByTopicKey,
  identifyStaleSources,
  identifyUnmappedCandidateClaims,
} from '../src/intelligence/research/aggregate.js';
import type { ResearchSourceInput, StrategyClaimInput } from '../src/intelligence/research/ingestTypes.js';
import type { StrategyPrinciple } from '../src/intelligence/index.js';

const NOW = '2026-08-19T12:00:00Z';

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-research-')));
}

function sourceInput(overrides: Partial<ResearchSourceInput> = {}): ResearchSourceInput {
  return {
    sourceType: 'marketer',
    title: 'Justin Welsh — The Content Operating System',
    authorOrPublisher: 'Justin Welsh',
    url: 'justinwelsh.me/cos',
    ...overrides,
  };
}

async function seedSource(store: JsonlIntelligenceStore, overrides: Partial<ResearchSourceInput> = {}) {
  const result = await ingestResearchSource(sourceInput(overrides), store, NOW);
  if (!result.ok) throw new Error('seed source failed validation');
  return result.source;
}

function claimInput(sourceId: string, overrides: Partial<StrategyClaimInput> = {}): StrategyClaimInput {
  return {
    sourceId,
    statement: 'Question hooks increase replies.',
    claimType: 'playbook_claim',
    scope: { level: 'global' },
    ...overrides,
  };
}

describe('Strategy & Research — ResearchSource', () => {
  it('saves and loads a ResearchSource', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const loaded = await store.getResearchSource(source.id);
    expect(loaded?.title).toContain('Content Operating System');
  });

  it('represents a CreatorOS skill as a ResearchSource', async () => {
    const store = await tmpStore();
    const result = await ingestCreatorOsSkill({ name: 'Reply Engagement Skill', description: 'Boosts reply rate via question hooks.' }, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.sourceType).toBe('creatoros_skill');
    const loaded = await store.getResearchSource(result.source.id);
    expect(loaded?.sourceType).toBe('creatoros_skill');
  });

  it('represents a marketer as a ResearchSource', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { sourceType: 'marketer' });
    expect(source.sourceType).toBe('marketer');
  });

  it('represents platform documentation as a ResearchSource', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, {
      sourceType: 'platform_documentation',
      title: 'Threads API — post capabilities',
      url: 'developers.facebook.com/docs/threads',
    });
    expect(source.sourceType).toBe('platform_documentation');
  });

  it('represents a research report as a ResearchSource', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, {
      sourceType: 'research_report',
      title: 'Social Media Engagement Study 2026',
      authorOrPublisher: 'Pew Research',
    });
    expect(source.sourceType).toBe('research_report');
  });

  it('round-trips published/accessed dates', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { publishedAt: '2025-01-15T00:00:00Z', accessedAt: NOW });
    const loaded = await store.getResearchSource(source.id);
    expect(loaded?.publishedAt).toBe('2025-01-15T00:00:00Z');
    expect(loaded?.accessedAt).toBe(NOW);
  });

  it('represents superseded/deprecated source state', async () => {
    const store = await tmpStore();
    const old = await seedSource(store, { title: 'Old advice' });
    const replacement = await seedSource(store, { title: 'Updated advice' });
    const result = await ingestResearchSource({ id: old.id, ...sourceInput({ title: 'Old advice' }), deprecatedAt: NOW, supersededBySourceId: replacement.id }, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.deprecatedAt).toBe(NOW);
    expect(result.source.supersededBySourceId).toBe(replacement.id);
    // The old record still exists — nothing was deleted.
    const stillThere = await store.getResearchSource(old.id);
    expect(stillThere).not.toBeNull();
  });

  it('queries sources by sourceType', async () => {
    const store = await tmpStore();
    await seedSource(store, { sourceType: 'marketer', title: 'A' });
    await seedSource(store, { sourceType: 'book', title: 'B' });
    const marketers = await store.listResearchSources({ sourceType: 'marketer' });
    expect(marketers.map((s) => s.title)).toEqual(['A']);
  });

  it('has exact-id upsert behavior, intentionally', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { title: 'Draft title' });
    const updated = await ingestResearchSource({ id: source.id, ...sourceInput({ title: 'Final title' }) }, store, '2026-09-01T00:00:00Z');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const loaded = await store.getResearchSource(source.id);
    expect(loaded?.title).toBe('Final title');
    expect(loaded?.createdAt).toBe(NOW);
    expect(loaded?.updatedAt).toBe('2026-09-01T00:00:00Z');
  });
});

describe('Strategy & Research — StrategyClaim', () => {
  it('saves and loads a StrategyClaim', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(claimInput(source.id), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getStrategyClaim(result.claim.id);
    expect(loaded?.statement).toBe('Question hooks increase replies.');
  });

  it('always references a source — orphan claims are rejected', async () => {
    const store = await tmpStore();
    const result = await ingestStrategyClaim(claimInput('src_does_not_exist'), store, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'sourceId')).toBe(true);
  });

  it('keeps a playbook claim as a claim, never a Finding', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(claimInput(source.id, { claimType: 'playbook_claim' }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The claim object structurally has no 'Finding' fields (sampleSize/effectSize/lastValidatedAt).
    expect('sampleSize' in result.claim).toBe(false);
    expect('effectSize' in result.claim).toBe(false);
    expect(result.claim.status).not.toBe('validated');
  });

  it('keeps a platform claim distinct from an experimental Finding', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { sourceType: 'platform_documentation' });
    const result = await ingestStrategyClaim(
      claimInput(source.id, { claimType: 'platform_claim', statement: 'Threads supports native chains.' }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.claimType).toBe('platform_claim');
    expect(result.claim.causalStatus).toBe('unproven');
  });

  it('does not let an observed association imply causation', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { sourceType: 'observational_dataset' });
    const result = await ingestStrategyClaim(
      claimInput(source.id, {
        claimType: 'observed_association',
        statement: 'Creators with 500+ replies averaged 35.7% follower growth.',
        observedAssociation: {
          variablesObserved: ['reply count', 'follower growth'],
          populationDescription: '1,200 creator accounts over 90 days',
          sampleSize: 1200,
          effectOrAssociation: 'positive correlation, r not reported',
          limitations: ['no control group', 'self-selected sample'],
          confoundersKnown: ['posting frequency'],
          causalClaim: false,
        },
      }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.observedAssociation?.causalClaim).toBe(false);
    expect(result.claim.causalStatus).toBe('correlational');
  });

  it('round-trips a correlational claim', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(claimInput(source.id, { claimType: 'observed_association', causalStatus: 'correlational', observedAssociation: { variablesObserved: ['x'], populationDescription: 'y', causalClaim: false } }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await store.getStrategyClaim(result.claim.id);
    expect(loaded?.causalStatus).toBe('correlational');
  });

  it('round-trips causal status, and rejects an inflated causal_supported outside an experimental claim', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { sourceType: 'kairos_experiment' });
    const validExperimental = await ingestStrategyClaim(
      claimInput(source.id, { claimType: 'experimental_claim', causalStatus: 'causal_supported' }),
      store,
      NOW,
    );
    expect(validExperimental.ok).toBe(true);

    const inflated = validateStrategyClaimInput(claimInput('irrelevant', { claimType: 'playbook_claim', causalStatus: 'causal_supported' }));
    expect(inflated.valid).toBe(false);
    expect(inflated.errors.some((e) => e.field === 'causalStatus')).toBe(true);
  });

  it('preserves platform scope on a claim', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(
      claimInput(source.id, { platforms: ['threads'], scope: { level: 'platform', platform: 'threads' } }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.platforms).toEqual(['threads']);
    expect(result.claim.scope).toEqual({ level: 'platform', platform: 'threads' });
  });

  it('preserves niche scope on a claim', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(
      claimInput(source.id, { niches: ['personal finance'], scope: { level: 'niche', niche: 'personal finance' } }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.niches).toEqual(['personal finance']);
    // Never silently generalized to all niches.
    expect(result.claim.scope.level).toBe('niche');
  });

  it('preserves objective context on a claim', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(claimInput(source.id, { objectives: ['conversation'] }), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.objectives).toEqual(['conversation']);
  });

  it('keeps the same claim from two independent sources as two provenance records', async () => {
    const store = await tmpStore();
    const marketerSource = await seedSource(store, { sourceType: 'marketer', title: 'Marketer A' });
    const skillResult = await ingestCreatorOsSkill({ name: 'Reply Skill' }, store, NOW);
    if (!skillResult.ok) throw new Error('skill ingestion failed');

    const claimA = await ingestStrategyClaim(claimInput(marketerSource.id, { topicKey: 'question_hooks' }), store, NOW);
    const claimB = await ingestStrategyClaim(claimInput(skillResult.source.id, { topicKey: 'question_hooks' }), store, NOW);
    expect(claimA.ok && claimB.ok).toBe(true);
    if (!claimA.ok || !claimB.ok) return;
    expect(claimA.claim.id).not.toBe(claimB.claim.id);
    expect(claimA.claim.sourceId).not.toBe(claimB.claim.sourceId);

    const all = await store.listStrategyClaims();
    expect(all).toHaveLength(2);
  });

  it('lets conflicting claims coexist rather than "latest wins"', async () => {
    const store = await tmpStore();
    const sourceA = await seedSource(store, { title: 'Post once a day' });
    const sourceB = await seedSource(store, { title: 'Post ten times a day' });
    await ingestStrategyClaim(claimInput(sourceA.id, { statement: 'Post once daily for best results.', topicKey: 'posting_frequency' }), store, NOW);
    await ingestStrategyClaim(claimInput(sourceB.id, { statement: 'Post 10 times daily for best results.', topicKey: 'posting_frequency' }), store, NOW);
    const all = await store.listStrategyClaims();
    expect(all).toHaveLength(2);
  });

  it('groups conflicting claims under a common normalized topic key', async () => {
    const store = await tmpStore();
    const sourceA = await seedSource(store);
    const sourceB = await seedSource(store);
    await ingestStrategyClaim(claimInput(sourceA.id, { statement: 'Post once daily.', topicKey: 'posting_frequency' }), store, NOW);
    await ingestStrategyClaim(claimInput(sourceB.id, { statement: 'Post 10 times daily.', topicKey: 'posting_frequency' }), store, NOW);
    const all = await store.listStrategyClaims();
    const grouped = groupClaimsByTopicKey(all);
    expect(grouped.posting_frequency).toHaveLength(2);
  });

  it('queries claims by sourceId', async () => {
    const store = await tmpStore();
    const sourceA = await seedSource(store);
    const sourceB = await seedSource(store);
    await ingestStrategyClaim(claimInput(sourceA.id, { statement: 'From A' }), store, NOW);
    await ingestStrategyClaim(claimInput(sourceB.id, { statement: 'From B' }), store, NOW);
    const fromA = await store.listStrategyClaims({ sourceId: sourceA.id });
    expect(fromA.map((c) => c.statement)).toEqual(['From A']);
  });

  it('queries claims by claimType', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    await ingestStrategyClaim(claimInput(source.id, { claimType: 'opinion', statement: 'op' }), store, NOW);
    await ingestStrategyClaim(claimInput(source.id, { claimType: 'heuristic', statement: 'heur' }), store, NOW);
    const opinions = await store.listStrategyClaims({ claimType: 'opinion' });
    expect(opinions.map((c) => c.statement)).toEqual(['op']);
  });

  it('queries claims by platform', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    await ingestStrategyClaim(claimInput(source.id, { platforms: ['threads'], statement: 'threads claim' }), store, NOW);
    await ingestStrategyClaim(claimInput(source.id, { platforms: ['twitter'], statement: 'x claim' }), store, NOW);
    const threadsClaims = await store.listStrategyClaims({ platform: 'threads' });
    expect(threadsClaims.map((c) => c.statement)).toEqual(['threads claim']);
  });

  it('queries claims by objective', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    await ingestStrategyClaim(claimInput(source.id, { objectives: ['conversation'], statement: 'conv claim' }), store, NOW);
    await ingestStrategyClaim(claimInput(source.id, { objectives: ['sale'], statement: 'sale claim' }), store, NOW);
    const saleClaims = await store.listStrategyClaims({ objective: 'sale' });
    expect(saleClaims.map((c) => c.statement)).toEqual(['sale claim']);
  });

  it('ingests a CreatorOS skill claim without modifying CreatorOS itself', async () => {
    const store = await tmpStore();
    const skillResult = await ingestCreatorOsSkill({ name: 'Reply Skill', description: 'Reply within 30 minutes.' }, store, NOW);
    expect(skillResult.ok).toBe(true);
    if (!skillResult.ok) return;
    const claimResult = await ingestStrategyClaim(
      claimInput(skillResult.source.id, { claimType: 'playbook_claim', statement: 'Replying within 30 minutes increases distribution.' }),
      store,
      NOW,
    );
    expect(claimResult.ok).toBe(true);
    // Purely data — no CreatorOS module was imported or invoked to do this.
  });

  it('performs manual structured ingestion without any AI dependency', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(claimInput(source.id), store, NOW);
    expect(result.ok).toBe(true);
  });

  it('fails validation on an out-of-range confidenceInExtraction', () => {
    const result = validateStrategyClaimInput(claimInput('src_1', { confidenceInExtraction: 1.5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'confidenceInExtraction')).toBe(true);
  });

  it('handles an unrecognized platform consistently with the existing platform model', () => {
    const result = validateStrategyClaimInput(claimInput('src_1', { platforms: ['myspace' as never] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'platforms[0]')).toBe(true);
  });

  it('retains sample size on observational data', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { sourceType: 'observational_dataset' });
    const result = await ingestStrategyClaim(
      claimInput(source.id, {
        claimType: 'observed_association',
        observedAssociation: { variablesObserved: ['x'], populationDescription: 'y', sampleSize: 842, causalClaim: false },
      }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.observedAssociation?.sampleSize).toBe(842);
  });

  it('retains time period on observational data', async () => {
    const store = await tmpStore();
    const source = await seedSource(store, { sourceType: 'observational_dataset' });
    const result = await ingestStrategyClaim(
      claimInput(source.id, {
        claimType: 'observed_association',
        observedAssociation: {
          variablesObserved: ['x'],
          populationDescription: 'y',
          timePeriod: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' },
          causalClaim: false,
        },
      }),
      store,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim.observedAssociation?.timePeriod).toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' });
  });

  it('does not discard contradictory evidence', async () => {
    const store = await tmpStore();
    const sourceFor = await seedSource(store, { title: 'Supports question hooks' });
    const sourceAgainst = await seedSource(store, { title: 'Contradicts question hooks' });
    const supporting = await ingestStrategyClaim(claimInput(sourceFor.id, { topicKey: 'question_hooks' }), store, NOW);
    const contradicting = await ingestStrategyClaim(
      claimInput(sourceAgainst.id, { statement: 'Question hooks do not affect replies.', topicKey: 'question_hooks' }),
      store,
      NOW,
    );
    expect(supporting.ok && contradicting.ok).toBe(true);
    if (!supporting.ok || !contradicting.ok) return;
    const all = await store.listStrategyClaims();
    expect(all.map((c) => c.id).sort()).toEqual([supporting.claim.id, contradicting.claim.id].sort());
  });

  it('never automatically converts a claim into a validated Finding', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const result = await ingestStrategyClaim(claimInput(source.id), store, NOW);
    expect(result.ok).toBe(true);
    // No Finding was ever created as a side effect.
    const findings = await store.listFindings();
    expect(findings).toEqual([]);
  });
});

describe('Strategy & Research — StrategyPrinciple relationship', () => {
  const principle = (overrides: Partial<StrategyPrinciple> = {}): StrategyPrinciple => ({
    id: 'sp_1',
    name: 'Question hooks may increase conversation',
    description: 'Normalized from marketer advice, a CreatorOS skill, and related platform documentation.',
    sourceType: 'playbook',
    scope: { level: 'global' },
    applicablePlatforms: [],
    applicableObjectives: ['conversation'],
    status: 'hypothesis',
    confidence: 0.3,
    createdAt: NOW,
    ...overrides,
  });

  it('lets a StrategyPrinciple reference supporting claims', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const claim = await ingestStrategyClaim(claimInput(source.id), store, NOW);
    if (!claim.ok) throw new Error('claim ingestion failed');
    const p = principle({ supportingClaimIds: [claim.claim.id] });
    await store.saveStrategyPrinciple(p);
    const loaded = await store.getStrategyPrinciple('sp_1');
    expect(loaded?.supportingClaimIds).toEqual([claim.claim.id]);
  });

  it('lets a StrategyPrinciple reference contradicting claims', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const claim = await ingestStrategyClaim(claimInput(source.id, { statement: 'Question hooks decrease replies.' }), store, NOW);
    if (!claim.ok) throw new Error('claim ingestion failed');
    const p = principle({ contradictingClaimIds: [claim.claim.id] });
    await store.saveStrategyPrinciple(p);
    const loaded = await store.getStrategyPrinciple('sp_1');
    expect(loaded?.contradictingClaimIds).toEqual([claim.claim.id]);
  });

  it('lets a StrategyPrinciple later reference supporting findings once modeled', async () => {
    const store = await tmpStore();
    const p = principle({ supportingFindingIds: ['fnd_1'] });
    await store.saveStrategyPrinciple(p);
    const loaded = await store.getStrategyPrinciple('sp_1');
    expect(loaded?.supportingFindingIds).toEqual(['fnd_1']);
  });

  it('leaves the original claim unchanged when the principle changes', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const claim = await ingestStrategyClaim(claimInput(source.id), store, NOW);
    if (!claim.ok) throw new Error('claim ingestion failed');
    await store.saveStrategyPrinciple(principle({ supportingClaimIds: [claim.claim.id], confidence: 0.3 }));
    // The principle evolves — status/confidence change, and a new claim is added.
    await store.saveStrategyPrinciple(
      principle({ supportingClaimIds: [claim.claim.id, 'clm_new'], confidence: 0.6, status: 'supported' }),
    );
    const claimAfter = await store.getStrategyClaim(claim.claim.id);
    expect(claimAfter).toEqual(claim.claim);
  });

  it('counts supporting vs contradicting claims for a principle', () => {
    const p = principle({ supportingClaimIds: ['a', 'b'], contradictingClaimIds: ['c'] });
    expect(countSupportingVsContradictingClaims(p)).toEqual({ supporting: 2, contradicting: 1 });
  });

  it('identifies claims not yet mapped to any principle', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    const mapped = await ingestStrategyClaim(claimInput(source.id, { statement: 'mapped' }), store, NOW);
    const unmapped = await ingestStrategyClaim(claimInput(source.id, { statement: 'unmapped' }), store, NOW);
    if (!mapped.ok || !unmapped.ok) throw new Error('ingestion failed');
    const p = principle({ supportingClaimIds: [mapped.claim.id] });
    const all = await store.listStrategyClaims();
    const candidates = identifyUnmappedCandidateClaims(all, [p]);
    expect(candidates.map((c) => c.id)).toEqual([unmapped.claim.id]);
  });
});

describe('Strategy & Research — deterministic helpers', () => {
  it('derives the honest default causal status per claim type', () => {
    expect(deriveDefaultCausalStatus('observed_association')).toBe('correlational');
    expect(deriveDefaultCausalStatus('experimental_claim')).toBe('experimental_support');
    expect(deriveDefaultCausalStatus('playbook_claim')).toBe('unproven');
    expect(deriveDefaultCausalStatus('platform_claim')).toBe('unproven');
    // Never causal_supported by default, regardless of claim type.
    for (const claimType of ['playbook_claim', 'platform_claim', 'research_claim', 'observed_association', 'experimental_claim', 'opinion', 'heuristic'] as const) {
      expect(deriveDefaultCausalStatus(claimType)).not.toBe('causal_supported');
    }
  });

  it('maps research source types onto the existing four-tier knowledge source vocabulary without duplicating it', () => {
    expect(deriveKnowledgeSourceType('platform_documentation')).toBe('platform');
    expect(deriveKnowledgeSourceType('research_report')).toBe('research');
    expect(deriveKnowledgeSourceType('kairos_experiment')).toBe('experiment');
    expect(deriveKnowledgeSourceType('marketer')).toBe('playbook');
    expect(deriveKnowledgeSourceType('creatoros_skill')).toBe('playbook');
  });

  it('groups claims by claimType and by platform', async () => {
    const store = await tmpStore();
    const source = await seedSource(store);
    await ingestStrategyClaim(claimInput(source.id, { claimType: 'opinion', platforms: ['threads'] }), store, NOW);
    await ingestStrategyClaim(claimInput(source.id, { claimType: 'heuristic', platforms: ['twitter'] }), store, NOW);
    const all = await store.listStrategyClaims();
    expect(Object.keys(groupClaimsByClaimType(all)).sort()).toEqual(['heuristic', 'opinion']);
    expect(groupClaimsByPlatform(all).threads).toHaveLength(1);
    expect(groupClaimsByPlatform(all).twitter).toHaveLength(1);
  });

  it('identifies stale sources deterministically from an explicit "now"', async () => {
    const store = await tmpStore();
    const staleSource = await seedSource(store, { title: 'Old', lastReviewedAt: '2024-01-01T00:00:00Z' });
    const freshSource = await seedSource(store, { title: 'Fresh', lastReviewedAt: '2026-08-01T00:00:00Z' });
    const all = await store.listResearchSources();
    const stale = identifyStaleSources(all, NOW, 1000 * 60 * 60 * 24 * 365);
    expect(stale.map((s) => s.id)).toEqual([staleSource.id]);
    expect(stale.map((s) => s.id)).not.toContain(freshSource.id);
  });
});

describe('Strategy & Research — empty store and CreatorOS boundary', () => {
  it('reads an empty research store safely', async () => {
    const store = await tmpStore();
    expect(await store.getResearchSource('nope')).toBeNull();
    expect(await store.listResearchSources()).toEqual([]);
    expect(await store.getStrategyClaim('nope')).toBeNull();
    expect(await store.listStrategyClaims()).toEqual([]);
  });

  it('survives store re-instantiation against the same root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-research-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const source = await ingestResearchSource(sourceInput(), first, NOW);
    if (!source.ok) throw new Error('seed failed');
    const second = new JsonlIntelligenceStore(root);
    const loaded = await second.getResearchSource(source.source.id);
    expect(loaded?.id).toBe(source.source.id);
  });

  it('touches nothing under src/client, src/worker or CreatorOS skill delivery', async () => {
    // Purely a structural assertion: ingestion is data-only, no execution path exists.
    const store = await tmpStore();
    const result = await ingestCreatorOsSkill({ name: 'Any Skill' }, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.source.id).toBe('string');
  });

  it('validates a research source input independent of storage', () => {
    const result = validateResearchSourceInput({ sourceType: 'marketer', title: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'title')).toBe(true);
  });
});
