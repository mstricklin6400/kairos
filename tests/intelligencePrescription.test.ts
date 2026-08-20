import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { SocialPrescriptionEngine } from '../src/intelligence/prescription/engine.js';
import {
  classifyFinding,
  classifyTransfer,
  computeRecommendationPriority,
  describeEvidenceClass,
  diffIds,
  evidenceClassRank,
  isStale,
  metricDepth,
  objectiveDepth,
  servesObjective,
} from '../src/intelligence/prescription/compose.js';
import { DEFAULT_PRESCRIPTION_POLICY } from '../src/intelligence/prescription/types.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type { Finding, SegmentFinding, TransferAssessment } from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-19T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-rx-')));
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
    postsPerDay: 2,
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
    limitations: [],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

function transferAssessment(profileId: string, overrides: Partial<TransferAssessment> = {}): TransferAssessment {
  return {
    id: `xfer_${Math.random().toString(36).slice(2, 10)}`,
    candidateId: 'cand_1',
    findingId: 'fnd_peer',
    targetProfileId: profileId,
    sourceClass: 'matched_peer',
    relevance: 'strongly_relevant',
    similarity: {
      dimensions: [], overallSimilarity: 0.8, dimensionCoverage: 0.7,
      matchedDimensions: ['niche'], mismatchedDimensions: [], unknownDimensions: [], limitations: [],
    },
    assessmentConfidence: 0.7,
    whyItMightApply: ['niche matches'],
    whyItMightNotApply: [],
    negativeTransferRisks: [],
    unknowns: [],
    evidenceAgeDays: 10,
    recommendation: {
      action: 'run_experiment',
      reason: 'Comparable peer evidence; test here first.',
      proposedHypothesisStatement: 'For this profile: peer pattern X may lift replies.',
      priority: 0.75,
    },
    limitations: [],
    policyVersion: 'transfer-v1',
    createdAt: NOW,
    schemaVersion: 1,
    ...overrides,
  };
}

describe('Prescription — objective depth and evidence classification', () => {
  it('maps objectives to funnel depth', () => {
    expect(objectiveDepth('reach')).toBeLessThan(objectiveDepth('revenue'));
    expect(objectiveDepth('conversation')).toBeLessThan(objectiveDepth('sale'));
  });

  it('maps metrics to funnel depth', () => {
    expect(metricDepth('impressions')).toBeLessThan(metricDepth('revenue'));
    expect(metricDepth('replies')).toBeLessThan(metricDepth('sales'));
  });

  it('treats reply evidence as serving a conversation objective', () => {
    expect(servesObjective('replies', 'conversation')).toBe(true);
  });

  it('treats reply evidence as NOT serving a revenue objective', () => {
    expect(servesObjective('replies', 'revenue')).toBe(false);
  });

  it('treats revenue evidence as serving a conversation objective too', () => {
    // Deeper evidence still speaks to a shallower objective.
    expect(servesObjective('revenue', 'conversation')).toBe(true);
  });

  it('classifies a validated high-confidence finding as validated on profile', () => {
    expect(classifyFinding(finding('p', { status: 'validated', confidence: 0.9 }), DEFAULT_PRESCRIPTION_POLICY))
      .toBe('validated_on_profile');
  });

  it('classifies a low-confidence validated finding as only promising', () => {
    expect(classifyFinding(finding('p', { status: 'validated', confidence: 0.4 }), DEFAULT_PRESCRIPTION_POLICY))
      .toBe('promising_on_profile');
  });

  it('classifies a promising finding as promising', () => {
    expect(classifyFinding(finding('p', { status: 'promising', confidence: 0.9 }), DEFAULT_PRESCRIPTION_POLICY))
      .toBe('promising_on_profile');
  });

  it('classifies a rejected finding as unknown for positive guidance', () => {
    expect(classifyFinding(finding('p', { status: 'rejected' }), DEFAULT_PRESCRIPTION_POLICY)).toBe('unknown');
  });

  it('never classifies transferred evidence as first-party validated', () => {
    for (const relevance of ['directly_applicable', 'strongly_relevant', 'moderately_relevant'] as const) {
      const cls = classifyTransfer(transferAssessment('p', { relevance }));
      expect(cls).toBe('comparable_profiles');
      expect(cls).not.toBe('validated_on_profile');
    }
  });

  it('degrades weak transfers to research-informed', () => {
    expect(classifyTransfer(transferAssessment('p', { relevance: 'hypothesis_only' }))).toBe('research_informed');
  });

  it('keeps evidence classes distinct rather than collapsing them into one score', () => {
    const classes = ['validated_on_profile', 'promising_on_profile', 'comparable_profiles', 'research_informed', 'experimental', 'unknown'] as const;
    const ranks = classes.map(evidenceClassRank);
    expect(new Set(ranks).size).toBe(classes.length);
    const labels = classes.map(describeEvidenceClass);
    expect(new Set(labels).size).toBe(classes.length);
  });

  it('labels evidence classes conservatively, without certainty language', () => {
    for (const cls of ['comparable_profiles', 'research_informed', 'experimental', 'unknown'] as const) {
      expect(describeEvidenceClass(cls)).not.toMatch(/proven|guaranteed|always/i);
    }
  });
});

describe('Prescription — priority respects the business objective', () => {
  it('deprioritizes evidence that does not reach the objective depth', () => {
    const serving = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.9, servesObjective: true,
      isStale: false, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    const notServing = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.9, servesObjective: false,
      isStale: false, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    expect(notServing).toBeLessThan(serving);
  });

  it('can disable objective-depth enforcement by policy', () => {
    const enforced = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.9, servesObjective: false,
      isStale: false, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    const relaxed = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.9, servesObjective: false,
      isStale: false, policy: { ...DEFAULT_PRESCRIPTION_POLICY, enforceObjectiveDepth: false },
    });
    expect(relaxed).toBeGreaterThan(enforced);
  });

  it('penalizes an approach that repeatedly failed to advance the objective', () => {
    const clean = computeRecommendationPriority({
      evidenceClass: 'promising_on_profile', confidence: 0.6, servesObjective: true,
      isStale: false, repeatedObjectiveFailures: 0, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    const repeatedlyFailed = computeRecommendationPriority({
      evidenceClass: 'promising_on_profile', confidence: 0.6, servesObjective: true,
      isStale: false, repeatedObjectiveFailures: 2, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    expect(repeatedlyFailed).toBeLessThan(clean);
  });

  it('penalizes stale evidence', () => {
    const fresh = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.8, servesObjective: true,
      isStale: false, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    const stale = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.8, servesObjective: true,
      isStale: true, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    expect(stale).toBeLessThan(fresh);
  });

  it('ranks first-party evidence above transferred evidence, all else equal', () => {
    const firstParty = computeRecommendationPriority({
      evidenceClass: 'validated_on_profile', confidence: 0.7, servesObjective: true,
      isStale: false, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    const transferred = computeRecommendationPriority({
      evidenceClass: 'comparable_profiles', confidence: 0.7, servesObjective: true,
      isStale: false, policy: DEFAULT_PRESCRIPTION_POLICY,
    });
    expect(firstParty).toBeGreaterThan(transferred);
  });

  it('detects stale evidence against the policy window', () => {
    expect(isStale('2026-08-01T00:00:00Z', NOW, DEFAULT_PRESCRIPTION_POLICY)).toBe(false);
    expect(isStale('2025-01-01T00:00:00Z', NOW, DEFAULT_PRESCRIPTION_POLICY)).toBe(true);
    expect(isStale(undefined, NOW, DEFAULT_PRESCRIPTION_POLICY)).toBe(false);
  });
});

describe('Prescription — cold start and empty profiles', () => {
  it('builds a prescription for a profile with no evidence at all', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx).not.toBeNull();
    expect(rx!.profileId).toBe(profile.id);
  });

  it('states plainly that nothing is known yet, rather than inventing strategy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.unknowns.some((u) => u.topic.includes('What works'))).toBe(true);
    expect(rx!.unknowns.every((u) => u.howToResolve.length > 0)).toBe(true);
  });

  it('produces no validated-on-profile claims without first-party evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const all = rx!.sections.flatMap((s) => s.recommendations);
    expect(all.some((r) => r.evidence.evidenceClass === 'validated_on_profile' && r.section === 'what')).toBe(false);
  });

  it('marks limitations on a thin prescription', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.limitations).toContain('small_sample');
    expect(rx!.limitations).toContain('unknown_attribution');
  });
});

describe('Prescription — first-party, transferred and research evidence', () => {
  it('surfaces a validated first-party finding in the WHAT section', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    expect(what.recommendations.length).toBeGreaterThan(0);
    expect(what.recommendations[0]!.evidence.evidenceClass).toBe('validated_on_profile');
  });

  it('cites the finding id behind every first-party recommendation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const f = finding(profile.id, { id: 'fnd_cited' });
    await store.saveFinding(f);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    expect(what.recommendations[0]!.evidence.findingIds).toContain('fnd_cited');
  });

  it('includes transferred evidence, clearly labelled as comparable-profiles', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(transferAssessment(profile.id));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    const transferred = what.recommendations.find((r) => r.evidence.transferAssessmentIds.length > 0);
    expect(transferred!.evidence.evidenceClass).toBe('comparable_profiles');
    expect(transferred!.rationale).toContain('comparable profiles');
  });

  it('ranks first-party evidence above transferred evidence in the same section', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { confidence: 0.85 }));
    await store.saveTransferAssessment(transferAssessment(profile.id, { assessmentConfidence: 0.85 }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    expect(what.recommendations[0]!.evidence.evidenceClass).toBe('validated_on_profile');
  });

  it('carries battle provenance through into the prescription evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(
      transferAssessment(profile.id, {
        battleProvenance: {
          seasonId: 'season_1', protocolVersion: '2.0.0', objective: 'conversation',
          experimentIds: ['exp_1'], sampleSize: 40,
          periodStart: '2026-07-01T00:00:00Z', periodEnd: '2026-08-01T00:00:00Z', limitations: [],
        },
      }),
    );
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    const transferred = what.recommendations.find((r) => r.evidence.transferAssessmentIds.length > 0)!;
    expect(transferred.evidence.battleSeasonId).toBe('season_1');
    expect(transferred.evidence.battleProtocolVersion).toBe('2.0.0');
  });

  it('handles conflicting evidence by keeping both, in different sections', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f_good', statement: 'A works.', status: 'validated' }));
    await store.saveFinding(finding(profile.id, { id: 'f_bad', statement: 'B fails.', status: 'rejected' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    const avoid = rx!.sections.find((s) => s.key === 'what_not_to_do')!;
    expect(what.recommendations.some((r) => r.statement === 'A works.')).toBe(true);
    expect(avoid.recommendations.some((r) => r.statement.includes('B fails.'))).toBe(true);
  });
});

describe('Prescription — what not to do', () => {
  it('lists rejected first-party approaches', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'rejected', statement: 'Long threads lift replies.' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const avoid = rx!.sections.find((s) => s.key === 'what_not_to_do')!;
    expect(avoid.recommendations[0]!.statement).toContain('Avoid');
  });

  it('lists contraindicated transferred strategies', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(
      transferAssessment(profile.id, {
        relevance: 'contraindicated',
        recommendation: { action: 'do_not_transfer', reason: 'Your own evidence contradicts it.', priority: 0 },
      }),
    );
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const avoid = rx!.sections.find((s) => s.key === 'what_not_to_do')!;
    expect(avoid.recommendations.some((r) => r.rationale.includes('contradicts'))).toBe(true);
  });

  it('surfaces declared topic constraints as topics to avoid', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { styleConstraints: ['no politics', 'no medical claims'] });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.content.topicsToAvoid).toContain('no politics');
  });
});

describe('Prescription — pattern vs. example execution', () => {
  it('attaches examples to a hook pattern without giving them evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const statement = 'Question-led problem hooks perform well.';
    await store.saveFinding(finding(profile.id, { statement }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id, {
      examples: { byHookFamily: { [statement]: ['Are you making this credit mistake?'] } },
    });
    const hook = rx!.hooks.find((h) => h.hookFamily === statement)!;
    expect(hook.evidenceClass).toBe('validated_on_profile');
    expect(hook.examples[0]!.text).toBe('Are you making this credit mistake?');
  });

  it('makes it structurally impossible for an example to carry evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const statement = 'Question-led problem hooks perform well.';
    await store.saveFinding(finding(profile.id, { statement }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id, {
      examples: { byHookFamily: { [statement]: ['Are you making this credit mistake?'] } },
    });
    const example = rx!.hooks[0]!.examples[0]!;
    expect('evidenceClass' in example).toBe(false);
    expect('confidence' in example).toBe(false);
    expect('sampleSize' in example).toBe(false);
    expect(example.note).toContain('not itself evidence');
  });

  it('links each example back to the pattern it illustrates', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const statement = 'Question-led problem hooks perform well.';
    await store.saveFinding(finding(profile.id, { statement }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id, {
      examples: { byHookFamily: { [statement]: ['Example copy.'] } },
    });
    expect(rx!.hooks[0]!.examples[0]!.illustratesPattern).toBe(statement);
  });

  it('produces hook patterns with no examples when none are supplied', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.hooks[0]!.examples).toEqual([]);
  });

  it('never derives a hook pattern from a rejected finding', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'rejected', statement: 'Bad pattern.' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.hooks.some((h) => h.hookFamily === 'Bad pattern.')).toBe(false);
  });
});

describe('Prescription — audience: declared vs observed', () => {
  it('keeps the declared audience labelled as declared', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { declaredAudience: 'Late-20s professionals paying down debt' });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.audience.declaredAudience).toContain('Late-20s professionals');
    expect(rx!.audience.declaredVsObservedNote).toContain('unconfirmed');
  });

  it('reports observed segments separately from the declared audience', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveObservedSegment({
      id: 'oseg_1', profileId: profile.id, name: 'Debt payoff', status: 'active',
      firstObservedAt: NOW, lastObservedAt: NOW, signalCount: 20, confidence: 0.6,
      characteristics: [], problems: [], goals: [], objections: [], topics: [], languagePatterns: [], schemaVersion: 1,
    });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.audience.observedSegmentIds).toEqual(['oseg_1']);
    expect(rx!.audience.declaredVsObservedNote).toContain('Observed behavior');
  });

  it('prioritizes a segment that has supported findings', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const segmentFinding: SegmentFinding = {
      id: 'sf_1', profileId: profile.id, segmentId: 'oseg_priority',
      statement: 'This segment responds to specificity.',
      scope: { level: 'profile', profileId: profile.id },
      supportingSignalIds: [], supportingExperimentIds: [], contradictingSignalIds: [],
      confidence: 0.8, status: 'supported', createdAt: NOW, updatedAt: NOW, schemaVersion: 1,
    };
    await store.saveSegmentFinding(segmentFinding);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.audience.prioritySegmentId).toBe('oseg_priority');
  });

  it('states audience uncertainty when nothing has been observed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.audience.uncertainties.some((u) => u.includes('No observed audience segments'))).toBe(true);
  });
});

describe('Prescription — cadence, platform and offers', () => {
  it('flags cadence that merely restates stated capacity', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { postsPerDay: 3 });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.cadence.postsPerDay).toBe(3);
    expect(rx!.cadence.fromStatedCapacityOnly).toBe(true);
    expect(rx!.cadence.evidenceClass).toBe('unknown');
  });

  it('does not claim timing evidence it does not have', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.cadence.rationale).toContain('No timing or cadence evidence');
    expect(rx!.unknowns.some((u) => u.topic.includes('cadence'))).toBe(true);
  });

  it('reports platform guidance as unknown without platform evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.platformGuidance.platform).toBe('threads');
    expect(rx!.platformGuidance.evidenceClass).toBe('unknown');
  });

  it('says plainly when there is no offer to build conversion strategy on', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { offers: undefined });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.offers[0]!.statement).toContain('No active offer');
    expect(rx!.offers[0]!.evidenceClass).toBe('unknown');
  });

  it('references an actual configured offer', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, {
      primaryObjective: 'sale',
      offers: [{ name: 'Debt Payoff Plan', description: '6-week plan', price: 49, currency: 'USD' }],
    });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.offers[0]!.statement).toContain('Debt Payoff Plan');
    expect(rx!.offers[0]!.offerId).toBeDefined();
  });
});

describe('Prescription — what to test', () => {
  it('surfaces unresolved hypotheses as experiments', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveHypothesis({
      id: 'hyp_open', statement: 'Contrarian hooks lift replies.',
      scope: { level: 'profile', profileId: profile.id }, profileId: profile.id,
      independentVariable: 'hookFamily', dependentMetric: 'replies', controlVariables: [],
      status: 'testing', confidence: 0.4, source: 'playbook',
      supportingExperimentIds: [], contradictingExperimentIds: [], createdAt: NOW,
    });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.experimentsToRun.some((e) => e.hypothesisId === 'hyp_open')).toBe(true);
  });

  it('excludes already-resolved hypotheses', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveHypothesis({
      id: 'hyp_done', statement: 'Settled.', scope: { level: 'profile', profileId: profile.id },
      profileId: profile.id, independentVariable: 'x', dependentMetric: 'replies', controlVariables: [],
      status: 'supported', confidence: 0.9, source: 'experiment',
      supportingExperimentIds: [], contradictingExperimentIds: [], createdAt: NOW,
    });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.experimentsToRun.some((e) => e.hypothesisId === 'hyp_done')).toBe(false);
  });

  it('gives higher information gain to a test that serves the objective', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { primaryObjective: 'revenue' });
    await store.saveHypothesis({
      id: 'hyp_rev', statement: 'Offer CTA lifts revenue.', scope: { level: 'profile', profileId: profile.id },
      profileId: profile.id, independentVariable: 'ctaType', dependentMetric: 'revenue', controlVariables: [],
      status: 'testing', confidence: 0.4, source: 'playbook',
      supportingExperimentIds: [], contradictingExperimentIds: [], createdAt: NOW,
    });
    await store.saveHypothesis({
      id: 'hyp_reply', statement: 'Hooks lift replies.', scope: { level: 'profile', profileId: profile.id },
      profileId: profile.id, independentVariable: 'hookFamily', dependentMetric: 'replies', controlVariables: [],
      status: 'testing', confidence: 0.4, source: 'playbook',
      supportingExperimentIds: [], contradictingExperimentIds: [], createdAt: NOW,
    });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const rev = rx!.experimentsToRun.find((e) => e.hypothesisId === 'hyp_rev')!;
    const reply = rx!.experimentsToRun.find((e) => e.hypothesisId === 'hyp_reply')!;
    expect(rev.informationGain).toBeGreaterThan(reply.informationGain);
  });

  it('includes transfer-seeded experiment candidates', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const assessment = transferAssessment(profile.id);
    await store.saveTransferAssessment(assessment);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.experimentsToRun.some((e) => e.transferAssessmentId === assessment.id)).toBe(true);
  });
});

describe('Prescription — staleness and revalidation', () => {
  it('flags a recommendation built on stale evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { lastValidatedAt: '2025-01-01T00:00:00Z' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    expect(what.recommendations[0]!.needsRevalidation).toBe(true);
  });

  it('lists stale recommendations under revalidationNeeded', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { lastValidatedAt: '2025-01-01T00:00:00Z' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.revalidationNeeded.length).toBeGreaterThan(0);
  });

  it('does not flag fresh evidence for revalidation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { lastValidatedAt: NOW }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.revalidationNeeded).toEqual([]);
  });
});

describe('Prescription — versioning and history', () => {
  it('versions prescriptions and links to the one it supersedes', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const first = await engine.buildPrescription(profile.id);
    const second = await engine.buildPrescription(profile.id);
    expect(second!.versionInfo.version).toBe(first!.versionInfo.version + 1);
    expect(second!.versionInfo.supersedesPrescriptionId).toBe(first!.id);
  });

  it('never erases a historical prescription', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const first = await engine.buildPrescription(profile.id);
    await engine.buildPrescription(profile.id);
    expect((await store.getSocialPrescription(first!.id))!.versionInfo.version).toBe(1);
    expect(await engine.getPrescriptionHistory(profile.id)).toHaveLength(2);
  });

  it('records an evidence cutoff and generation time', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.versionInfo.generatedAt).toBe(NOW);
    expect(rx!.versionInfo.evidenceCutoff).toBe(NOW);
  });

  it('diffs evidence added between versions', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    await engine.buildPrescription(profile.id);
    await store.saveFinding(finding(profile.id, { id: 'fnd_new' }));
    const second = await engine.buildPrescription(profile.id);
    expect(second!.versionInfo.evidenceAdded).toContain('fnd_new');
  });

  it('diffs recommendations added between versions', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    await engine.buildPrescription(profile.id);
    await store.saveFinding(finding(profile.id, { statement: 'Brand new pattern.' }));
    const second = await engine.buildPrescription(profile.id);
    expect(second!.versionInfo.recommendationsAdded).toContain('Brand new pattern.');
  });

  it('records a change reason when supplied', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    await engine.buildPrescription(profile.id);
    const second = await engine.buildPrescription(profile.id, { changeReason: 'New quarter, refreshed evidence.' });
    expect(second!.versionInfo.changeReason).toBe('New quarter, refreshed evidence.');
  });

  it('returns the latest version from getLatestPrescription', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    await engine.buildPrescription(profile.id);
    await engine.buildPrescription(profile.id);
    const latest = await engine.getLatestPrescription(profile.id);
    expect(latest!.versionInfo.version).toBe(2);
  });

  it('diffs cleanly with a helper', () => {
    expect(diffIds(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
});

describe('Prescription — personalization', () => {
  it('gives two same-niche profiles different prescriptions when objectives differ', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store, { primaryObjective: 'conversation' });
    const b = await seedProfile(store, { primaryObjective: 'revenue' });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rxA = await engine.buildPrescription(a.id);
    const rxB = await engine.buildPrescription(b.id);
    expect(rxA!.objective).toBe('conversation');
    expect(rxB!.objective).toBe('revenue');
    expect(rxA!.objective).not.toBe(rxB!.objective);
  });

  it('gives two same-niche profiles different prescriptions when evidence differs', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store);
    const b = await seedProfile(store);
    await store.saveFinding(finding(a.id, { statement: 'A-specific pattern works.' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rxA = await engine.buildPrescription(a.id);
    const rxB = await engine.buildPrescription(b.id);
    const aStatements = rxA!.sections.flatMap((s) => s.recommendations.map((r) => r.statement));
    const bStatements = rxB!.sections.flatMap((s) => s.recommendations.map((r) => r.statement));
    expect(aStatements).toContain('A-specific pattern works.');
    expect(bStatements).not.toContain('A-specific pattern works.');
  });

  it('gives different prescriptions when constraints differ', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store, { styleConstraints: ['no politics'] });
    const b = await seedProfile(store, { styleConstraints: [] });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rxA = await engine.buildPrescription(a.id);
    const rxB = await engine.buildPrescription(b.id);
    expect(rxA!.content.topicsToAvoid).toContain('no politics');
    expect(rxB!.content.topicsToAvoid).toEqual([]);
  });

  it('gives different prescriptions when offers differ', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store, { offers: [{ name: 'Course', description: 'x' }] });
    const b = await seedProfile(store, { offers: undefined });
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rxA = await engine.buildPrescription(a.id);
    const rxB = await engine.buildPrescription(b.id);
    expect(rxA!.offers[0]!.statement).toContain('Course');
    expect(rxB!.offers[0]!.statement).toContain('No active offer');
  });

  it('keeps profiles isolated — one profile evidence never leaks into another', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store);
    const b = await seedProfile(store);
    await store.saveFinding(finding(a.id, { id: 'fnd_a_only' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rxB = await engine.buildPrescription(b.id);
    const bEvidence = rxB!.sections.flatMap((s) => s.recommendations.flatMap((r) => r.evidence.findingIds));
    expect(bEvidence).not.toContain('fnd_a_only');
  });
});

describe('Prescription — sections and structure', () => {
  it('produces all nine output sections', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const keys = rx!.sections.map((s) => s.key);
    for (const key of ['who', 'what', 'how', 'where', 'when', 'what_not_to_do', 'what_to_test', 'what_we_dont_know'] as const) {
      expect(keys).toContain(key);
    }
  });

  it('gives every section a human title and summary', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.sections.every((s) => s.title.length > 0 && s.summary.length > 0)).toBe(true);
  });

  it('caps recommendations per section by policy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    for (let i = 0; i < 12; i += 1) {
      await store.saveFinding(finding(profile.id, { id: `f${i}`, statement: `Pattern ${i}` }));
    }
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow, policy: { maxRecommendationsPerSection: 3 } });
    const rx = await engine.buildPrescription(profile.id);
    const what = rx!.sections.find((s) => s.key === 'what')!;
    expect(what.recommendations).toHaveLength(3);
  });

  it('records the policy version', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow, policy: { policyVersion: 'rx-test-1' } });
    const rx = await engine.buildPrescription(profile.id);
    expect(rx!.policyVersion).toBe('rx-test-1');
  });
});

describe('Prescription — invariants', () => {
  it('makes no guaranteed or universal claims', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const rx = await engine.buildPrescription(profile.id);
    const text = JSON.stringify(rx);
    expect(text).not.toMatch(/guaranteed/i);
    expect(text).not.toMatch(/scientifically proven/i);
    expect(text).not.toMatch(/always works/i);
  });

  it('never writes a Finding', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    await engine.buildPrescription(profile.id);
    expect(await store.listFindings({ profileId: profile.id })).toEqual([]);
  });

  it('leaves source findings unchanged', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const original = finding(profile.id, { id: 'fnd_immutable' });
    await store.saveFinding(original);
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    await engine.buildPrescription(profile.id);
    expect(await store.getFinding('fnd_immutable')).toEqual(original);
  });

  it('builds no publishing or content-generation capability', () => {
    const methods = Object.getOwnPropertyNames(SocialPrescriptionEngine.prototype);
    expect(methods.some((m) => /publish|schedule|generateContent|compose|send/i.test(m))).toBe(false);
  });

  it('is deterministic for the same inputs', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f1', statement: 'Stable.' }));
    const engine = new SocialPrescriptionEngine(store, { now: fixedNow });
    const a = await engine.buildPrescription(profile.id);
    const b = await engine.buildPrescription(profile.id);
    const statements = (rx: typeof a) => rx!.sections.flatMap((s) => s.recommendations.map((r) => r.statement));
    expect(statements(a)).toEqual(statements(b));
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fake = { getProfile: async () => null } as unknown as IntelligenceStore;
    const engine = new SocialPrescriptionEngine(fake, { now: fixedNow });
    expect(await engine.buildPrescription('nope')).toBeNull();
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-rx-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const result = await onboardProfile(onboardingInput(), first, NOW);
    if (!result.ok) throw new Error('seed failed');
    const engine = new SocialPrescriptionEngine(first, { now: fixedNow });
    const rx = await engine.buildPrescription(result.profile.id);
    const second = new JsonlIntelligenceStore(root);
    expect((await second.getSocialPrescription(rx!.id))!.id).toBe(rx!.id);
  });
});
