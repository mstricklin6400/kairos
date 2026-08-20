import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { SocialGenomeEngine } from '../src/intelligence/genome/engine.js';
import {
  assessConsistency,
  assessFreshness,
  collectLineageRoots,
  computeGenomeConfidence,
  countIndependentEvidence,
  deduplicateByLineage,
  deriveEvidenceLimitations,
  sharesLineage,
} from '../src/intelligence/genome/lineage.js';
import { DEFAULT_GENOME_POLICY } from '../src/intelligence/genome/types.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type {
  Finding,
  GenomeContext,
  GenomeEvidence,
  GenomeOutcome,
  SegmentFinding,
  TransferAssessment,
} from '../src/intelligence/index.js';

const NOW = '2026-08-19T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-genome-')));
}

function engineWith(store: JsonlIntelligenceStore, policy = {}): SocialGenomeEngine {
  return new SocialGenomeEngine(store, { now: fixedNow, policy });
}

function evidence(overrides: Partial<GenomeEvidence> = {}): GenomeEvidence {
  return {
    id: `gev_${Math.random().toString(36).slice(2, 10)}`,
    sourceClass: 'first_party',
    recordType: 'finding',
    recordId: `fnd_${Math.random().toString(36).slice(2, 8)}`,
    lineageRoots: ['exp_1'],
    supports: true,
    confidence: 0.8,
    sampleSize: 30,
    observedAt: NOW,
    lastValidatedAt: NOW,
    limitations: [],
    ...overrides,
  };
}

function context(overrides: Partial<GenomeContext> = {}): GenomeContext {
  return {
    platform: 'threads',
    niche: 'personal finance',
    objective: 'conversation',
    hookFamily: 'question-led',
    accountStage: 'early',
    ...overrides,
  };
}

const outcome: GenomeOutcome = { metric: 'replies', direction: 'increase', relativeChange: 0.4 };

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    statement: 'Question-led hooks were associated with higher reply rate.',
    scope: { level: 'profile', profileId: 'prof_1' },
    profileId: 'prof_1',
    platform: 'threads',
    niche: 'personal finance',
    objective: 'conversation',
    sampleSize: 30,
    confidence: 0.8,
    status: 'validated',
    sourceExperimentIds: ['exp_1'],
    limitations: [],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

// ============================================================================
// NO DOUBLE COUNTING — the critical safeguard, tested heavily.
// ============================================================================

describe('Genome — no double counting', () => {
  it('counts one experiment as one piece of evidence however many records derive from it', () => {
    const chain = [
      evidence({ recordType: 'measurement', recordId: 'pm_1', lineageRoots: ['exp_1'], sourceClass: 'first_party' }),
      evidence({ recordType: 'experiment', recordId: 'exp_1', lineageRoots: ['exp_1'] }),
      evidence({ recordType: 'finding', recordId: 'fnd_1', lineageRoots: ['exp_1'] }),
      evidence({ recordType: 'transfer_assessment', recordId: 'xfer_1', lineageRoots: ['exp_1'], sourceClass: 'matched_peer' }),
    ];
    // Four records, one experiment.
    expect(chain).toHaveLength(4);
    expect(countIndependentEvidence(chain)).toBe(1);
  });

  it('counts genuinely distinct experiments separately', () => {
    const distinct = [
      evidence({ lineageRoots: ['exp_1'] }),
      evidence({ lineageRoots: ['exp_2'] }),
      evidence({ lineageRoots: ['exp_3'] }),
    ];
    expect(countIndependentEvidence(distinct)).toBe(3);
  });

  it('unions overlapping multi-root evidence correctly', () => {
    const overlapping = [
      evidence({ lineageRoots: ['exp_1', 'exp_2'] }),
      evidence({ lineageRoots: ['exp_2', 'exp_3'] }),
    ];
    // exp_1, exp_2, exp_3 = three experiments across two records.
    expect(countIndependentEvidence(overlapping)).toBe(3);
  });

  it('falls back to the record id when no lineage is declared, counting it exactly once', () => {
    const unlinked = [
      evidence({ recordId: 'orphan_1', lineageRoots: [] }),
      evidence({ recordId: 'orphan_1', lineageRoots: [] }),
      evidence({ recordId: 'orphan_2', lineageRoots: [] }),
    ];
    expect(countIndependentEvidence(unlinked)).toBe(2);
  });

  it('returns zero for an empty evidence set', () => {
    expect(countIndependentEvidence([])).toBe(0);
  });

  it('collects the union of lineage roots', () => {
    const roots = collectLineageRoots([
      evidence({ lineageRoots: ['exp_1', 'exp_2'] }),
      evidence({ lineageRoots: ['exp_2'] }),
    ]);
    expect([...roots].sort()).toEqual(['exp_1', 'exp_2']);
  });

  it('detects shared lineage between two records', () => {
    const a = evidence({ lineageRoots: ['exp_1'] });
    const b = evidence({ lineageRoots: ['exp_1', 'exp_9'] });
    const c = evidence({ lineageRoots: ['exp_5'] });
    expect(sharesLineage(a, b)).toBe(true);
    expect(sharesLineage(a, c)).toBe(false);
  });

  it('deduplicates a derivation chain down to one representative', () => {
    const chain = [
      evidence({ recordType: 'transfer_assessment', recordId: 'xfer_1', lineageRoots: ['exp_1'], sourceClass: 'research' }),
      evidence({ recordType: 'finding', recordId: 'fnd_1', lineageRoots: ['exp_1'], sourceClass: 'first_party' }),
    ];
    const deduped = deduplicateByLineage(chain);
    expect(deduped).toHaveLength(1);
    // The most direct record survives.
    expect(deduped[0]!.recordType).toBe('finding');
    expect(deduped[0]!.sourceClass).toBe('first_party');
  });

  it('collapses transitive lineage chains into one group', () => {
    // A shares exp_1 with B; B shares exp_2 with C. All one group.
    const chain = [
      evidence({ recordId: 'a', lineageRoots: ['exp_1'] }),
      evidence({ recordId: 'b', lineageRoots: ['exp_1', 'exp_2'] }),
      evidence({ recordId: 'c', lineageRoots: ['exp_2'] }),
    ];
    expect(deduplicateByLineage(chain)).toHaveLength(1);
  });

  it('keeps disjoint evidence separate when deduplicating', () => {
    const disjoint = [
      evidence({ recordId: 'a', lineageRoots: ['exp_1'] }),
      evidence({ recordId: 'b', lineageRoots: ['exp_2'] }),
    ];
    expect(deduplicateByLineage(disjoint)).toHaveLength(2);
  });

  it('does not let an echoed experiment inflate a pattern confidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);

    const single = await engine.upsertPattern({
      statement: 'Under these conditions, question-led hooks were associated with higher replies.',
      context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['exp_1'] })],
    });
    const echoed = await engine.upsertPattern({
      statement: 'Same claim, echoed through four layers.',
      context: context(), outcome,
      supporting: [
        evidence({ recordType: 'measurement', recordId: 'pm', lineageRoots: ['exp_1'] }),
        evidence({ recordType: 'experiment', recordId: 'ex', lineageRoots: ['exp_1'] }),
        evidence({ recordType: 'finding', recordId: 'fd', lineageRoots: ['exp_1'] }),
        evidence({ recordType: 'transfer_assessment', recordId: 'tx', lineageRoots: ['exp_1'], sourceClass: 'matched_peer' }),
      ],
    });
    expect(echoed.confidence.independentEvidenceCount).toBe(single.confidence.independentEvidenceCount);
    expect(echoed.confidence.score).toBe(single.confidence.score);
  });

  it('reports independent evidence count on a stored pattern', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_2'] })],
    });
    expect(await engine.countPatternEvidence(pattern.id)).toBe(2);
  });

  it('roots transfer evidence in the originating experiments, not the assessment', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const assessment = {
      id: 'xfer_1', candidateId: 'c', findingId: 'fnd_1', targetProfileId: 'prof_2',
      sourceClass: 'matched_peer' as const, relevance: 'strongly_relevant' as const,
      similarity: { dimensions: [], overallSimilarity: 0.8, dimensionCoverage: 0.8, matchedDimensions: [], mismatchedDimensions: [], unknownDimensions: [], limitations: [] },
      assessmentConfidence: 0.7, whyItMightApply: [], whyItMightNotApply: [],
      negativeTransferRisks: [], unknowns: [], evidenceAgeDays: 5,
      recommendation: { action: 'run_experiment' as const, reason: 'r', priority: 0.7 },
      limitations: [], policyVersion: 'transfer-v1', createdAt: NOW, schemaVersion: 1,
    } satisfies TransferAssessment;

    const findingEvidence = engine.evidenceFromFinding(finding({ sourceExperimentIds: ['exp_1'] }));
    const transferEvidence = engine.evidenceFromTransfer(assessment, ['exp_1']);
    expect(transferEvidence.lineageRoots).toEqual(['exp_1']);
    expect(countIndependentEvidence([findingEvidence, transferEvidence])).toBe(1);
  });
});

describe('Genome — evidence construction preserves source class and lineage', () => {
  it('builds evidence from a Finding rooted in its experiments', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const ev = engine.evidenceFromFinding(finding({ sourceExperimentIds: ['exp_a', 'exp_b'] }));
    expect(ev.sourceClass).toBe('first_party');
    expect(ev.lineageRoots).toEqual(['exp_a', 'exp_b']);
    expect(ev.supports).toBe(true);
  });

  it('marks a rejected finding as contradicting rather than supporting', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    expect(engine.evidenceFromFinding(finding({ status: 'rejected' })).supports).toBe(false);
  });

  it('carries a finding limitations onto its evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const ev = engine.evidenceFromFinding(finding({ limitations: ['small_sample', 'single_pair'] }));
    expect(ev.limitations).toContain('single_pair');
  });

  it('builds evidence from a SegmentFinding', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const sf: SegmentFinding = {
      id: 'sf_1', profileId: 'prof_1', segmentId: 'oseg_1', statement: 's',
      scope: { level: 'profile', profileId: 'prof_1' },
      supportingSignalIds: [], supportingExperimentIds: ['exp_7'], contradictingSignalIds: [],
      confidence: 0.7, status: 'supported', createdAt: NOW, updatedAt: NOW, schemaVersion: 1,
    };
    const ev = engine.evidenceFromSegmentFinding(sf);
    expect(ev.lineageRoots).toEqual(['exp_7']);
    expect(ev.recordType).toBe('segment_finding');
  });

  it('falls back to a synthetic root when a finding has no experiments', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const ev = engine.evidenceFromFinding(finding({ id: 'fnd_orphan', sourceExperimentIds: [] }));
    expect(ev.lineageRoots).toEqual(['finding:fnd_orphan']);
  });
});

describe('Genome — conditionality is inseparable from the claim', () => {
  it('stores a pattern with its full context', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'Question-led hooks were associated with higher reply rates under these conditions.',
      context: context(), outcome, supporting: [evidence()],
    });
    expect(pattern.context.platform).toBe('threads');
    expect(pattern.context.niche).toBe('personal finance');
    expect(pattern.context.objective).toBe('conversation');
    expect(pattern.context.accountStage).toBe('early');
  });

  it('keeps missing context dimensions missing rather than defaulting them', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: { platform: 'threads' }, outcome, supporting: [evidence()],
    });
    expect(pattern.context.niche).toBeUndefined();
    expect(pattern.context.accountStage).toBeUndefined();
    expect('niche' in pattern.context).toBe(false);
  });

  it('records the outcome metric and direction', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    expect(pattern.outcome.metric).toBe('replies');
    expect(pattern.outcome.direction).toBe('increase');
  });

  it('has no field in which a context-free claim could be stored', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    // context is required and always present on the pattern.
    expect(pattern.context).toBeDefined();
    expect(Object.keys(pattern.context).length).toBeGreaterThan(0);
  });
});

describe('Genome — the same strategy behaves differently by dimension', () => {
  async function twoPatterns(a: Partial<GenomeContext>, b: Partial<GenomeContext>, outcomeB: GenomeOutcome) {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pa = await engine.upsertPattern({
      statement: 'Question-led hooks, condition A.', context: context(a), outcome, supporting: [evidence({ lineageRoots: ['exp_a'] })],
    });
    const pb = await engine.upsertPattern({
      statement: 'Question-led hooks, condition B.', context: context(b), outcome: outcomeB, supporting: [evidence({ lineageRoots: ['exp_b'] })],
    });
    return { store, engine, pa, pb };
  }

  it('records different outcomes for the same strategy by objective', async () => {
    const { pa, pb } = await twoPatterns(
      { objective: 'conversation' }, { objective: 'revenue' },
      { metric: 'revenue', direction: 'no_change' },
    );
    expect(pa.outcome.direction).toBe('increase');
    expect(pb.outcome.direction).toBe('no_change');
    expect(pa.context.objective).not.toBe(pb.context.objective);
  });

  it('records different outcomes for the same strategy by platform', async () => {
    const { pa, pb } = await twoPatterns(
      { platform: 'threads' }, { platform: 'twitter' },
      { metric: 'replies', direction: 'decrease' },
    );
    expect(pa.context.platform).not.toBe(pb.context.platform);
    expect(pa.outcome.direction).not.toBe(pb.outcome.direction);
  });

  it('records different outcomes for the same strategy by audience segment', async () => {
    const { pa, pb } = await twoPatterns(
      { audienceSegmentId: 'oseg_a' }, { audienceSegmentId: 'oseg_b' },
      { metric: 'replies', direction: 'no_change' },
    );
    expect(pa.context.audienceSegmentId).not.toBe(pb.context.audienceSegmentId);
  });

  it('records different outcomes for the same strategy by account stage', async () => {
    const { pa, pb } = await twoPatterns(
      { accountStage: 'cold-start' }, { accountStage: 'mature' },
      { metric: 'replies', direction: 'decrease' },
    );
    expect(pa.context.accountStage).toBe('cold-start');
    expect(pb.context.accountStage).toBe('mature');
    expect(pa.outcome.direction).not.toBe(pb.outcome.direction);
  });
});

describe('Genome — contradictions are preserved, never averaged away', () => {
  it('reports mixed consistency when evidence genuinely splits', () => {
    const consistency = assessConsistency(
      [evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_2'] })],
      [evidence({ lineageRoots: ['exp_3'] }), evidence({ lineageRoots: ['exp_4'] })],
      DEFAULT_GENOME_POLICY,
    );
    expect(consistency).toBe('mixed');
  });

  it('reports consistent when evidence agrees', () => {
    expect(assessConsistency(
      [evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_2'] }), evidence({ lineageRoots: ['exp_3'] }), evidence({ lineageRoots: ['exp_4'] })],
      [],
      DEFAULT_GENOME_POLICY,
    )).toBe('consistent');
  });

  it('reports contradicted when the weight is against', () => {
    expect(assessConsistency(
      [],
      [evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_2'] })],
      DEFAULT_GENOME_POLICY,
    )).toBe('contradicted');
  });

  it('reports insufficient with no evidence at all', () => {
    expect(assessConsistency([], [], DEFAULT_GENOME_POLICY)).toBe('insufficient');
  });

  it('retains contradicting evidence on the pattern', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['exp_1'] })],
      contradicting: [evidence({ lineageRoots: ['exp_2'], supports: false })],
    });
    expect(pattern.contradictingEvidenceIds).toHaveLength(1);
    expect(pattern.confidence.contradictingCount).toBe(1);
  });

  it('surfaces contradictory patterns via findContradictions', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'mixed', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_2'] })],
      contradicting: [evidence({ lineageRoots: ['exp_3'] }), evidence({ lineageRoots: ['exp_4'] })],
    });
    await engine.upsertPattern({
      statement: 'clean', context: context({ hookFamily: 'other' }), outcome,
      supporting: [evidence({ lineageRoots: ['exp_5'] }), evidence({ lineageRoots: ['exp_6'] })],
    });
    const contradictory = await engine.findContradictions();
    expect(contradictory).toHaveLength(1);
    expect(contradictory[0]!.statement).toBe('mixed');
  });

  it('lowers confidence for mixed evidence rather than hiding the disagreement', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const clean = await engine.upsertPattern({
      statement: 'clean', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] }), evidence({ lineageRoots: ['e2'] }), evidence({ lineageRoots: ['e3'] }), evidence({ lineageRoots: ['e4'] })],
    });
    const mixed = await engine.upsertPattern({
      statement: 'mixed', context: context({ hookFamily: 'x' }), outcome,
      supporting: [evidence({ lineageRoots: ['e5'] }), evidence({ lineageRoots: ['e6'] })],
      contradicting: [evidence({ lineageRoots: ['e7'] }), evidence({ lineageRoots: ['e8'] })],
    });
    expect(mixed.confidence.score).toBeLessThan(clean.confidence.score);
    expect(mixed.confidence.consistency).toBe('mixed');
  });

  it('says evidence is mixed in the query summary', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'mixed', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] }), evidence({ lineageRoots: ['e2'] })],
      contradicting: [evidence({ lineageRoots: ['e3'] }), evidence({ lineageRoots: ['e4'] })],
    });
    const result = await engine.query({ platform: 'threads' });
    expect(result.summary).toContain('mixed');
  });
});

describe('Genome — generalization requires explicit promotion', () => {
  async function strongPattern(store: JsonlIntelligenceStore, engine: SocialGenomeEngine) {
    return engine.upsertPattern({
      statement: 'x', context: context(), outcome, profileId: 'prof_1',
      supporting: [
        evidence({ lineageRoots: ['exp_1'] }),
        evidence({ lineageRoots: ['exp_2'] }),
        evidence({ lineageRoots: ['exp_3'] }),
        evidence({ lineageRoots: ['exp_4'] }),
      ],
    });
  }

  it('creates patterns at profile scope by default', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await strongPattern(store, engine);
    expect(pattern.scopeLevel).toBe('profile');
  });

  it('never promotes automatically, however strong the evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await strongPattern(store, engine);
    expect(pattern.confidence.consistency).toBe('consistent');
    expect(pattern.confidence.independentEvidenceCount).toBe(4);
    // Strong, consistent, plentiful — and still profile-scoped.
    expect(pattern.scopeLevel).toBe('profile');
  });

  it('promotes explicitly when the evidence clears the bar', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await strongPattern(store, engine);
    const promoted = await engine.promotePattern({ patternId: pattern.id, targetScope: 'niche', distinctProfileCount: 4 });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.pattern.scopeLevel).toBe('niche');
  });

  it('refuses promotion with too little independent evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const thin = await engine.upsertPattern({
      statement: 'x', context: context(), outcome, supporting: [evidence({ lineageRoots: ['exp_1'] })],
    });
    const result = await engine.promotePattern({ patternId: thin.id, targetScope: 'niche', distinctProfileCount: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('independent pieces of evidence');
  });

  it('refuses promotion from too few distinct profiles', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await strongPattern(store, engine);
    const result = await engine.promotePattern({ patternId: pattern.id, targetScope: 'niche', distinctProfileCount: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('distinct profiles');
  });

  it('refuses promotion when evidence is mixed', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const mixed = await engine.upsertPattern({
      statement: 'x', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] }), evidence({ lineageRoots: ['e2'] })],
      contradicting: [evidence({ lineageRoots: ['e3'] }), evidence({ lineageRoots: ['e4'] })],
    });
    const result = await engine.promotePattern({ patternId: mixed.id, targetScope: 'niche', distinctProfileCount: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('mixed');
  });

  it('refuses a sideways or narrowing promotion', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await strongPattern(store, engine);
    const result = await engine.promotePattern({ patternId: pattern.id, targetScope: 'profile', distinctProfileCount: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not broader');
  });

  it('refuses to promote an unknown pattern', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const result = await engine.promotePattern({ patternId: 'nope', targetScope: 'niche', distinctProfileCount: 5 });
    expect(result.ok).toBe(false);
  });

  it('allows segment scope without the multi-profile requirement', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await strongPattern(store, engine);
    const result = await engine.promotePattern({ patternId: pattern.id, targetScope: 'segment', distinctProfileCount: 1 });
    expect(result.ok).toBe(true);
  });
});

describe('Genome — query engine', () => {
  async function seeded() {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'Threads finance question hooks lift replies.',
      context: context({ platform: 'threads', niche: 'personal finance', hookFamily: 'question-led' }),
      outcome, profileId: 'prof_1',
      supporting: [evidence({ lineageRoots: ['exp_1'] }), evidence({ lineageRoots: ['exp_2'] })],
    });
    await engine.upsertPattern({
      statement: 'X fitness contrarian hooks lift reposts.',
      context: context({ platform: 'twitter', niche: 'fitness', hookFamily: 'contrarian' }),
      outcome: { metric: 'reposts', direction: 'increase' }, profileId: 'prof_2',
      supporting: [evidence({ lineageRoots: ['exp_3'] })],
    });
    return { store, engine };
  }

  it('matches on an exact context', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ platform: 'threads', niche: 'personal finance', hookFamily: 'question-led' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.contextMatch).toBe('exact');
  });

  it('answers the composite question about hooks, niche, platform and objective', async () => {
    const { engine } = await seeded();
    const result = await engine.query({
      platform: 'threads', niche: 'personal finance', hookFamily: 'question-led',
      objective: 'conversation', accountStage: 'early',
    });
    expect(result.insufficientEvidence).toBe(false);
    expect(result.matches[0]!.pattern.statement).toContain('Threads finance');
  });

  it('reports insufficient evidence when nothing addresses the question', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ platform: 'linkedin', niche: 'law' });
    expect(result.insufficientEvidence).toBe(true);
    expect(result.summary).toContain('No evidence');
    expect(result.limitations).toContain('small_sample');
  });

  it('filters by metric', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ metric: 'reposts' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.pattern.outcome.metric).toBe('reposts');
  });

  it('filters by scope level', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ scopeLevel: 'profile' })).matches).toHaveLength(2);
    expect((await engine.query({ scopeLevel: 'platform' })).matches).toHaveLength(0);
  });

  it('filters by profile', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ profileId: 'prof_1' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.pattern.profileId).toBe('prof_1');
  });

  it('reports unspecified dimensions honestly', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'Platform-only claim.', context: { platform: 'threads' }, outcome, supporting: [evidence()],
    });
    const result = await engine.query({ platform: 'threads', niche: 'personal finance' });
    expect(result.matches[0]!.unspecifiedDimensions).toContain('niche');
    expect(result.matches[0]!.contextMatch).toBe('broader');
  });

  it('returns evidence alongside every match', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ platform: 'threads' });
    expect(result.matches[0]!.supportingEvidence.length).toBeGreaterThan(0);
  });

  it('flags when a match would require a transfer assessment', async () => {
    const { engine } = await seeded();
    const result = await engine.query({ profileId: 'prof_1', platform: 'threads' });
    expect(result.matches[0]!.requiresTransferAssessment).toBe(false);
    const other = await engine.query({ platform: 'twitter', profileId: 'prof_99' });
    // Pattern belongs to prof_2 but we asked as prof_99 — transfer needed.
    expect(other.matches.every((m) => m.requiresTransferAssessment)).toBe(true);
  });

  it('can restrict to consistent evidence only', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'mixed', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] }), evidence({ lineageRoots: ['e2'] })],
      contradicting: [evidence({ lineageRoots: ['e3'] }), evidence({ lineageRoots: ['e4'] })],
    });
    expect((await engine.query({ consistentOnly: true })).matches).toHaveLength(0);
    expect((await engine.query({})).matches).toHaveLength(1);
  });

  it('ranks exact matches above broader ones', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({ statement: 'broad', context: { platform: 'threads' }, outcome, supporting: [evidence({ lineageRoots: ['e1'] })] });
    await engine.upsertPattern({ statement: 'exact', context: { platform: 'threads', niche: 'personal finance' }, outcome, supporting: [evidence({ lineageRoots: ['e2'] })] });
    const result = await engine.query({ platform: 'threads', niche: 'personal finance' });
    expect(result.matches[0]!.pattern.statement).toBe('exact');
  });

  it('respects a query limit', async () => {
    const { engine } = await seeded();
    expect((await engine.query({ limit: 1 })).matches).toHaveLength(1);
  });
});

describe('Genome — temporal behavior', () => {
  it('tracks first and last observed timestamps', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome,
      supporting: [
        evidence({ lineageRoots: ['e1'], observedAt: '2026-01-01T00:00:00Z' }),
        evidence({ lineageRoots: ['e2'], observedAt: '2026-06-01T00:00:00Z' }),
      ],
    });
    expect(pattern.firstObservedAt).toBe('2026-01-01T00:00:00Z');
    expect(pattern.lastObservedAt).toBe('2026-06-01T00:00:00Z');
  });

  it('classifies freshness across the policy windows', () => {
    expect(assessFreshness(NOW, NOW, DEFAULT_GENOME_POLICY)).toBe('current');
    expect(assessFreshness('2026-04-01T00:00:00Z', NOW, DEFAULT_GENOME_POLICY)).toBe('aging');
    expect(assessFreshness('2025-01-01T00:00:00Z', NOW, DEFAULT_GENOME_POLICY)).toBe('stale');
    expect(assessFreshness(undefined, NOW, DEFAULT_GENOME_POLICY)).toBe('stale');
  });

  it('surfaces stale patterns for revalidation', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({
      statement: 'old', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'], lastValidatedAt: '2024-01-01T00:00:00Z' })],
    });
    await engine.upsertPattern({
      statement: 'fresh', context: context({ hookFamily: 'other' }), outcome,
      supporting: [evidence({ lineageRoots: ['e2'], lastValidatedAt: NOW })],
    });
    const stale = await engine.findStalePatterns();
    expect(stale).toHaveLength(1);
    expect(stale[0]!.statement).toBe('old');
  });

  it('records a platform era when supplied', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome, supporting: [evidence()],
      platformEra: 'pre-2026-ranking-change',
    });
    expect(pattern.platformEra).toBe('pre-2026-ranking-change');
  });

  it('reduces confidence for stale evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const fresh = await engine.upsertPattern({
      statement: 'fresh', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'], lastValidatedAt: NOW }), evidence({ lineageRoots: ['e2'], lastValidatedAt: NOW })],
    });
    const stale = await engine.upsertPattern({
      statement: 'stale', context: context({ hookFamily: 'x' }), outcome,
      supporting: [evidence({ lineageRoots: ['e3'], lastValidatedAt: '2024-01-01T00:00:00Z' }), evidence({ lineageRoots: ['e4'], lastValidatedAt: '2024-01-01T00:00:00Z' })],
    });
    expect(stale.confidence.score).toBeLessThan(fresh.confidence.score);
    expect(stale.confidence.freshness).toBe('stale');
  });

  it('keeps old evidence available rather than deleting it', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'old', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'], lastValidatedAt: '2024-01-01T00:00:00Z' })],
    });
    expect((await store.getGenomePattern(pattern.id))).not.toBeNull();
  });
});

describe('Genome — graph, snapshots and versioning', () => {
  it('materializes context dimensions as nodes and edges', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    const { nodes, edges } = await engine.buildGraphForPattern(pattern);
    expect(nodes.some((n) => n.kind === 'platform' && n.value === 'threads')).toBe(true);
    expect(nodes.some((n) => n.kind === 'outcome')).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.patternId === pattern.id)).toBe(true);
  });

  it('marks edges as contradicted when contradicting evidence exists', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] })],
      contradicting: [evidence({ lineageRoots: ['e2'] })],
    });
    const { edges } = await engine.buildGraphForPattern(pattern);
    expect(edges.every((e) => e.relation === 'contradicted_by')).toBe(true);
  });

  it('every edge traces back to its evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    const { edges } = await engine.buildGraphForPattern(pattern);
    expect(edges[0]!.evidenceIds).toEqual(pattern.supportingEvidenceIds);
  });

  it('takes a snapshot of current belief', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    const snapshot = await engine.takeSnapshot('after first build');
    expect(snapshot.version).toBe(1);
    expect(snapshot.patternCount).toBe(1);
    expect(snapshot.note).toBe('after first build');
  });

  it('increments snapshot versions', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    await engine.takeSnapshot();
    const second = await engine.takeSnapshot();
    expect(second.version).toBe(2);
  });

  it('preserves what the intelligence base believed at an earlier version', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome, supporting: [evidence({ lineageRoots: ['e1'] })],
    });
    const v1 = await engine.takeSnapshot('v1');
    const v1Confidence = v1.patternConfidence[pattern.id]!;

    // Evidence accumulates; confidence changes.
    await engine.upsertPattern({
      id: pattern.id, statement: 'x', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] }), evidence({ lineageRoots: ['e2'] }), evidence({ lineageRoots: ['e3'] })],
    });
    const v2 = await engine.takeSnapshot('v2');

    // The historical answer is unchanged.
    const storedV1 = await store.getGenomeSnapshot(v1.id);
    expect(storedV1!.patternConfidence[pattern.id]).toBe(v1Confidence);
    expect(v2.patternConfidence[pattern.id]).not.toBe(v1Confidence);
  });

  it('records the policy version on a snapshot for reproducibility', async () => {
    const store = await tmpStore();
    const engine = engineWith(store, { policyVersion: 'genome-test-9' });
    const snapshot = await engine.takeSnapshot();
    expect(snapshot.policyVersion).toBe('genome-test-9');
  });

  it('describes the genome as a whole', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    await engine.buildGraphForPattern(pattern);
    await engine.takeSnapshot();
    const described = await engine.describe();
    expect(described.patternCount).toBe(1);
    expect(described.nodeCount).toBeGreaterThan(0);
    expect(described.edgeCount).toBeGreaterThan(0);
    expect(described.version).toBe(1);
  });
});

describe('Genome — integration and provenance', () => {
  it('retains battle provenance on evidence', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({
      statement: 'x', context: context(), outcome,
      supporting: [evidence({
        battleProvenance: {
          seasonId: 'season_1', protocolVersion: '1.0.0', divisionId: 'div_pf',
          niche: 'personal finance', objective: 'conversation', experimentIds: ['exp_1'],
          sampleSize: 40, periodStart: '2026-07-01T00:00:00Z', periodEnd: '2026-08-01T00:00:00Z',
          limitations: ['unmatched_comparison'],
        },
      })],
    });
    const stored = await store.getGenomeEvidence(pattern.supportingEvidenceIds[0]!);
    expect(stored!.battleProvenance!.seasonId).toBe('season_1');
    expect(stored!.battleProvenance!.protocolVersion).toBe('1.0.0');
    expect(stored!.battleProvenance!.limitations).toContain('unmatched_comparison');
  });

  it('supplies structured intelligence a prescription can consume, without creating one', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    const result = await engine.query({ platform: 'threads' });
    expect(result.matches[0]!.pattern).toBeDefined();
    // No prescription is produced here.
    expect(await store.listSocialPrescriptions({ profileId: 'prof_1' })).toEqual([]);
  });

  it('does not hold a second similarity engine — it flags the need for transfer instead', () => {
    const methods = Object.getOwnPropertyNames(SocialGenomeEngine.prototype);
    expect(methods.some((m) => /similarity|compare(Profiles|Dimensions)/i.test(m))).toBe(false);
  });

  it('summarizes limitations across patterns', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const a = await engine.upsertPattern({
      statement: 'a', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'], limitations: ['single_pair'] })],
    });
    expect(engine.summarizeLimitations([a])).toContain('single_pair');
  });

  it('derives a small-sample limitation from thin evidence', () => {
    const limitations = deriveEvidenceLimitations([evidence({ lineageRoots: ['e1'] })], DEFAULT_GENOME_POLICY);
    expect(limitations).toContain('small_sample');
  });
});

describe('Genome — privacy and invariants', () => {
  it('holds no sensitive-trait fields', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    const serialized = JSON.stringify(pattern).toLowerCase();
    for (const key of ['race', 'ethnicity', 'religion', 'sexualorientation', 'medicalcondition', 'politicalparty', 'criminalhistory']) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it('is not a people database — no per-individual record exists', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    expect('personId' in pattern).toBe(false);
    expect('visitorId' in pattern).toBe(false);
    expect('userId' in pattern).toBe(false);
    // Audience is referenced only as an aggregate segment id.
    expect(pattern.context.audienceSegmentId === undefined || typeof pattern.context.audienceSegmentId === 'string').toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const set = [evidence({ id: 'a', lineageRoots: ['e1'] }), evidence({ id: 'b', lineageRoots: ['e2'] })];
    const a = computeGenomeConfidence({ supporting: set, contradicting: [], now: NOW, lastValidatedAt: NOW, policy: DEFAULT_GENOME_POLICY });
    const b = computeGenomeConfidence({ supporting: set, contradicting: [], now: NOW, lastValidatedAt: NOW, policy: DEFAULT_GENOME_POLICY });
    expect(a).toEqual(b);
  });

  it('keeps confidence within 0..1', () => {
    const many = Array.from({ length: 100 }, (_, i) => evidence({ lineageRoots: [`e${i}`] }));
    const confidence = computeGenomeConfidence({ supporting: many, contradicting: [], now: NOW, lastValidatedAt: NOW, policy: DEFAULT_GENOME_POLICY });
    expect(confidence.score).toBeGreaterThanOrEqual(0);
    expect(confidence.score).toBeLessThanOrEqual(1);
  });

  it('explains its confidence rather than stating a bare number', () => {
    const confidence = computeGenomeConfidence({
      supporting: [evidence({ lineageRoots: ['e1'] })], contradicting: [], now: NOW, lastValidatedAt: NOW, policy: DEFAULT_GENOME_POLICY,
    });
    expect(confidence.rationale).toContain('independent');
    expect(confidence.independentEvidenceCount).toBe(1);
  });

  it('writes no Finding', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    expect(await store.listFindings()).toEqual([]);
  });

  it('builds no publishing capability', () => {
    const methods = Object.getOwnPropertyNames(SocialGenomeEngine.prototype);
    expect(methods.some((m) => /publish|schedule|generate(Content|Post)|send/i.test(m))).toBe(false);
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fake = { listGenomePatterns: async () => [] } as unknown as IntelligenceStore;
    const engine = new SocialGenomeEngine(fake, { now: fixedNow });
    const result = await engine.query({ platform: 'threads' });
    expect(result.insufficientEvidence).toBe(true);
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-genome-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const engine = new SocialGenomeEngine(first, { now: fixedNow });
    const pattern = await engine.upsertPattern({ statement: 'x', context: context(), outcome, supporting: [evidence()] });
    await engine.takeSnapshot();

    const second = new JsonlIntelligenceStore(root);
    expect((await second.getGenomePattern(pattern.id))!.id).toBe(pattern.id);
    expect(await second.listGenomeSnapshots()).toHaveLength(1);
  });

  it('preserves an earlier pattern version on upsert rather than losing history', async () => {
    const store = await tmpStore();
    const engine = engineWith(store);
    const first = await engine.upsertPattern({ statement: 'v1', context: context(), outcome, supporting: [evidence({ lineageRoots: ['e1'] })] });
    const updated = await engine.upsertPattern({
      id: first.id, statement: 'v2', context: context(), outcome,
      supporting: [evidence({ lineageRoots: ['e1'] }), evidence({ lineageRoots: ['e2'] })],
    });
    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.firstObservedAt).toBe(first.firstObservedAt);
  });
});
