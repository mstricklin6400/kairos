/**
 * Content DNA on `Finding` — the cross-cutting fix that unblocked four
 * downstream modules at once.
 *
 * Before this, `Finding` carried no hook family, content format or pillar,
 * so Transfer treated `contentFormat` as permanently unknown, Prescription
 * returned empty formats and keyed hooks off the finding statement, and
 * Adaptive's allocation logic was wired but inert. These tests pin the
 * behaviour each of those now has.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { AdaptiveStrategyEngine } from '../src/intelligence/adaptive/engine.js';
import { IntelligenceTransferEngine } from '../src/intelligence/transfer/engine.js';
import { SocialPrescriptionEngine } from '../src/intelligence/prescription/engine.js';
import { ScienceEngine } from '../src/intelligence/science/engine.js';
import type { Finding } from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-20T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-dna-')));
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
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

function finding(profileId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `fnd_${Math.random().toString(36).slice(2, 10)}`,
    statement: 'Question-led hooks were associated with higher reply rate.',
    scope: { level: 'profile', profileId },
    profileId,
    platform: 'threads',
    niche: 'personal finance',
    objective: 'conversation',
    sampleSize: 30,
    confidence: 0.85,
    status: 'validated',
    effectSize: { metric: 'replies', relativeChange: 0.4 },
    sourceExperimentIds: ['exp_1'],
    hookFamily: 'question-led',
    contentFormat: 'text',
    limitations: [],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

describe('Content DNA — the Finding model itself', () => {
  it('round-trips hook family, content format and pillar', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, {
      id: 'fnd_dna', hookFamily: 'contrarian-claim', contentFormat: 'thread', contentPillarId: 'pil_myths',
    }));
    const loaded = await store.getFinding('fnd_dna');
    expect(loaded!.hookFamily).toBe('contrarian-claim');
    expect(loaded!.contentFormat).toBe('thread');
    expect(loaded!.contentPillarId).toBe('pil_myths');
  });

  it('leaves content DNA absent when the finding is not about one', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, {
      id: 'fnd_general', hookFamily: undefined, contentFormat: undefined, contentPillarId: undefined,
    }));
    const loaded = await store.getFinding('fnd_general');
    expect(loaded!.hookFamily).toBeUndefined();
    expect(loaded!.contentFormat).toBeUndefined();
  });

  it('carries content DNA through emitFinding', async () => {
    const store = await tmpStore();
    const science = new ScienceEngine(store, { now: fixedNow });
    const emitted = await science.emitFinding({
      statement: 'Question hooks were associated with higher replies under the tested conditions.',
      evaluation: {
        hypothesisId: 'hyp_1', status: 'supported', supportingCount: 6, contradictingCount: 0,
        confidence: 0.8, limitations: [], evaluatedAt: NOW,
      },
      context: { profileId: 'prof_1', objective: 'conversation' },
      sourceExperimentIds: ['exp_1', 'exp_2'],
      hookFamily: 'question-led',
      contentFormat: 'text',
      contentPillarId: 'pil_education',
    });
    expect(emitted!.hookFamily).toBe('question-led');
    expect(emitted!.contentFormat).toBe('text');
    expect(emitted!.contentPillarId).toBe('pil_education');
  });
});

describe('Content DNA — unblocks Prescription hooks and formats', () => {
  it('keys hook prescriptions on the real hook family, not the statement', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { hookFamily: 'contrarian-claim' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.hooks[0]!.hookFamily).toBe('contrarian-claim');
    expect(rx!.hooks[0]!.rationale).toContain('contrarian-claim');
  });

  it('falls back to the statement when a finding names no hook family', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { hookFamily: undefined, statement: 'Shorter posts lift replies.' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    // Still surfaced — just not hook-scoped.
    expect(rx!.hooks[0]!.hookFamily).toBe('Shorter posts lift replies.');
  });

  it('recommends formats derived from the profile own evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f1', contentFormat: 'thread' }));
    await store.saveFinding(finding(profile.id, { id: 'f2', statement: 'Carousels lift saves.', contentFormat: 'carousel' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.content.recommendedFormats).toContain('thread');
    expect(rx!.content.recommendedFormats).toContain('carousel');
  });

  it('does not recommend a format only a rejected finding used', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f_bad', status: 'rejected', contentFormat: 'long-video' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.content.recommendedFormats).not.toContain('long-video');
  });

  it('recommends no formats when no evidence names one', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { contentFormat: undefined }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.content.recommendedFormats).toEqual([]);
  });

  it('deduplicates repeated formats', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f1', contentFormat: 'text' }));
    await store.saveFinding(finding(profile.id, { id: 'f2', statement: 'Another.', contentFormat: 'text' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.content.recommendedFormats).toEqual(['text']);
  });
});

describe('Content DNA — activates Adaptive content allocation', () => {
  async function profileWithPillars(store: JsonlIntelligenceStore) {
    return seedProfile(store).then(async (profile) => {
      // Give the profile four equally weighted pillars.
      const withPillars = {
        ...profile,
        strategy: {
          ...profile.strategy,
          currentAllocations: [
            { pillarId: 'pil_a', share: 0.25 },
            { pillarId: 'pil_b', share: 0.25 },
            { pillarId: 'pil_c', share: 0.25 },
            { pillarId: 'pil_d', share: 0.25 },
          ],
        },
      };
      await store.saveProfile(withPillars);
      return withPillars;
    });
  }

  it('shifts allocation toward a pillar with supporting evidence', async () => {
    const store = await tmpStore();
    const profile = await profileWithPillars(store);
    await store.saveFinding(finding(profile.id, { contentPillarId: 'pil_a', status: 'validated', sampleSize: 40 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const a = plan!.contentAllocation.find((p) => p.pillarId === 'pil_a')!;
    expect(a.share).toBeGreaterThan(a.previousShare);
  });

  it('shifts allocation away from a pillar with rejected evidence', async () => {
    const store = await tmpStore();
    const profile = await profileWithPillars(store);
    await store.saveFinding(finding(profile.id, { contentPillarId: 'pil_d', status: 'rejected', sampleSize: 40 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const d = plan!.contentAllocation.find((p) => p.pillarId === 'pil_d')!;
    expect(d.share).toBeLessThan(d.previousShare);
  });

  it('damps the shift when the sample is thin', async () => {
    const store = await tmpStore();
    const thin = await profileWithPillars(store);
    await store.saveFinding(finding(thin.id, { contentPillarId: 'pil_a', sampleSize: 1 }));
    const thinPlan = await new AdaptiveStrategyEngine(store, { now: fixedNow }).buildAdaptiveStrategyPlan(thin.id);

    const store2 = await tmpStore();
    const thick = await profileWithPillars(store2);
    await store2.saveFinding(finding(thick.id, { contentPillarId: 'pil_a', sampleSize: 50 }));
    const thickPlan = await new AdaptiveStrategyEngine(store2, { now: fixedNow }).buildAdaptiveStrategyPlan(thick.id);

    const thinA = thinPlan!.contentAllocation.find((p) => p.pillarId === 'pil_a')!;
    const thickA = thickPlan!.contentAllocation.find((p) => p.pillarId === 'pil_a')!;
    expect(thinA.share).toBeLessThan(thickA.share);
    expect(thinA.reason).toContain('thin');
  });

  it('leaves pillars with no evidence unchanged', async () => {
    const store = await tmpStore();
    const profile = await profileWithPillars(store);
    await store.saveFinding(finding(profile.id, { contentPillarId: 'pil_a', sampleSize: 40 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const b = plan!.contentAllocation.find((p) => p.pillarId === 'pil_b')!;
    expect(b.reason).toContain('No new evidence');
  });

  it('keeps allocations normalized after an evidence-driven shift', async () => {
    const store = await tmpStore();
    const profile = await profileWithPillars(store);
    await store.saveFinding(finding(profile.id, { id: 'f1', contentPillarId: 'pil_a', sampleSize: 40 }));
    await store.saveFinding(finding(profile.id, { id: 'f2', statement: 'x', contentPillarId: 'pil_d', status: 'rejected', sampleSize: 40 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const total = plan!.contentAllocation.reduce((sum, p) => sum + p.share, 0);
    expect(total).toBeCloseTo(1);
  });

  it('prefers the larger sample when a pillar has conflicting evidence', async () => {
    const store = await tmpStore();
    const profile = await profileWithPillars(store);
    await store.saveFinding(finding(profile.id, { id: 'f_small', contentPillarId: 'pil_a', status: 'rejected', sampleSize: 3 }));
    await store.saveFinding(finding(profile.id, { id: 'f_big', statement: 'x', contentPillarId: 'pil_a', status: 'validated', sampleSize: 80 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const a = plan!.contentAllocation.find((p) => p.pillarId === 'pil_a')!;
    // The 80-sample validated finding wins over the 3-sample rejection.
    expect(a.share).toBeGreaterThan(a.previousShare);
  });
});

describe('Content DNA — unblocks the Transfer contentFormat dimension', () => {
  it('compares content format instead of reporting it permanently unknown', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { contentFormat: 'text' }));
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const context = await engine.buildTransferContext(profile.id, { accountStage: 'early' });
    const candidate = engine.candidateFromFinding(
      finding('prof_donor', { contentFormat: 'text' }),
      { sourceClass: 'matched_peer' },
    );
    const assessment = await engine.assessTransfer(candidate, context!);
    const dimension = assessment.similarity.dimensions.find((d) => d.key === 'contentFormat')!;
    expect(dimension.comparison).not.toBe('unknown');
    expect(dimension.comparison).toBe('match');
  });

  it('detects a content-format mismatch between donor and receiver', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { contentFormat: 'text' }));
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const context = await engine.buildTransferContext(profile.id, { accountStage: 'early' });
    const candidate = engine.candidateFromFinding(
      finding('prof_donor', { contentFormat: 'long-video' }),
      { sourceClass: 'matched_peer' },
    );
    const assessment = await engine.assessTransfer(candidate, context!);
    expect(assessment.similarity.dimensions.find((d) => d.key === 'contentFormat')!.comparison).toBe('mismatch');
  });

  it('still reports unknown when neither side names a format', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const context = await engine.buildTransferContext(profile.id, { accountStage: 'early' });
    const candidate = engine.candidateFromFinding(
      finding('prof_donor', { contentFormat: undefined }),
      { sourceClass: 'matched_peer' },
    );
    const assessment = await engine.assessTransfer(candidate, context!);
    // Honest unknown, not a fabricated match.
    expect(assessment.similarity.dimensions.find((d) => d.key === 'contentFormat')!.comparison).toBe('unknown');
  });

  it('derives typical formats on the context from the profile own findings', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f1', contentFormat: 'thread' }));
    await store.saveFinding(finding(profile.id, { id: 'f2', statement: 'x', contentFormat: 'carousel' }));
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const context = await engine.buildTransferContext(profile.id);
    expect(context!.typicalContentFormats).toContain('thread');
    expect(context!.typicalContentFormats).toContain('carousel');
  });

  it('carries the donor hook family onto the candidate', async () => {
    const store = await tmpStore();
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const candidate = engine.candidateFromFinding(
      finding('prof_donor', { hookFamily: 'personal-failure' }),
      { sourceClass: 'matched_peer' },
    );
    expect(candidate.sourceHookFamily).toBe('personal-failure');
  });

  it('raises dimension coverage now that content format is comparable', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { contentFormat: 'text' }));
    const engine = new IntelligenceTransferEngine(store, { now: fixedNow });
    const context = await engine.buildTransferContext(profile.id, { accountStage: 'early' });

    const withFormat = await engine.assessTransfer(
      engine.candidateFromFinding(finding('prof_donor', { contentFormat: 'text' }), { sourceClass: 'matched_peer' }),
      context!,
    );
    const withoutFormat = await engine.assessTransfer(
      engine.candidateFromFinding(finding('prof_donor', { contentFormat: undefined }), { sourceClass: 'matched_peer' }),
      context!,
    );
    expect(withFormat.similarity.dimensionCoverage).toBeGreaterThan(withoutFormat.similarity.dimensionCoverage);
  });
});

describe('Content DNA — Genome patterns key on the real hook family', () => {
  /** Genome evidence derived from a finding, with lineage back to its experiments. */
  function genomeEvidence(source: Finding) {
    return {
      id: `gev_${source.id}`,
      evidenceType: 'finding' as const,
      recordId: source.id,
      direction: 'supporting' as const,
      profileId: source.profileId,
      experimentId: source.sourceExperimentIds[0],
      lineageRoots: source.sourceExperimentIds,
      recordedAt: NOW,
      observedAt: NOW,
      limitations: source.limitations ?? [],
    };
  }

  it('carries a real hook family and content format into genome context', async () => {
    const store = await tmpStore();
    const { SocialGenomeEngine } = await import('../src/intelligence/genome/engine.js');
    const engine = new SocialGenomeEngine(store, { now: fixedNow });
    const source = finding('prof_1', { hookFamily: 'question-led', contentFormat: 'text' });
    const pattern = await engine.upsertPattern({
      statement: 'Question-led hooks were associated with higher replies under these conditions.',
      context: {
        platforms: [source.platform!],
        niches: [source.niche!],
        objectives: [source.objective!],
        hookFamilies: [source.hookFamily!],
        contentFormats: [source.contentFormat!],
      },
      objective: source.objective,
      supportingEvidence: [genomeEvidence(source)],
    });
    expect(pattern.context.hookFamilies).toEqual(['question-led']);
    expect(pattern.context.contentFormats).toEqual(['text']);
  });

  it('makes hook family queryable in the genome', async () => {
    const store = await tmpStore();
    const { SocialGenomeEngine } = await import('../src/intelligence/genome/engine.js');
    const engine = new SocialGenomeEngine(store, { now: fixedNow });
    await engine.upsertPattern({
      statement: 'x',
      context: { platforms: ['threads'], hookFamilies: ['question-led'] },
      objective: 'conversation',
      supportingEvidence: [genomeEvidence(finding('prof_1', { hookFamily: 'question-led' }))],
    });
    const result = await engine.query({ hookFamily: 'question-led' });
    expect(result.insufficientEvidence).toBe(false);
    expect(result.matches[0]!.matchedDimensions).toContain('hookFamilies');
  });

  it('keys the pattern context signature on the hook family', async () => {
    const store = await tmpStore();
    const { SocialGenomeEngine } = await import('../src/intelligence/genome/engine.js');
    const { contextSignature } = await import('../src/intelligence/genome/context.js');
    const engine = new SocialGenomeEngine(store, { now: fixedNow });
    const pattern = await engine.upsertPattern({
      statement: 'x',
      context: { platforms: ['threads'], hookFamilies: ['question-led'] },
      objective: 'conversation',
      supportingEvidence: [genomeEvidence(finding('prof_1', { hookFamily: 'question-led' }))],
    });
    expect(pattern.contextSignature).toBe(
      contextSignature({ platforms: ['threads'], hookFamilies: ['question-led'] }),
    );
  });
});
