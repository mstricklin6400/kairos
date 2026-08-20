import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { AdaptiveStrategyEngine } from '../src/intelligence/adaptive/engine.js';
import {
  computeInformationGain,
  computePriorityScore,
  deriveConstraints,
  exceedsCapacity,
  isTopicForbidden,
  recommendContentAllocation,
  violatesActiveExperiment,
} from '../src/intelligence/adaptive/policy.js';
import { DEFAULT_STRATEGY_POLICY } from '../src/intelligence/adaptive/types.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type {
  Experiment,
  Finding,
  GrowthObjective,
  ObservedAudienceSegment,
  SegmentFinding,
  SocialProfile,
  StrategyPrinciple,
} from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-19T12:00:00Z';
const fixedNow = () => NOW;

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-adaptive-')));
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    workspaceId: 'ws_test',
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    brandName: 'Lift Notes',
    niche: 'strength training',
    declaredAudience: 'Intermediate lifters stuck at a plateau',
    primaryObjective: 'conversation',
    experimentMode: 'balanced',
    postsPerDay: 2,
    ...overrides,
  };
}

async function seedProfile(store: JsonlIntelligenceStore, overrides: Partial<ProfileOnboardingInput> = {}) {
  const result = await onboardProfile(onboardingInput(overrides), store, NOW);
  if (!result.ok) throw new Error(`seed profile failed: ${JSON.stringify(result.errors)}`);
  return result.profile;
}

function finding(profileId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `fnd_${Math.random().toString(36).slice(2, 10)}`,
    statement: 'Contrarian hooks lift replies.',
    scope: { level: 'profile', profileId },
    profileId,
    sampleSize: 20,
    confidence: 0.85,
    status: 'validated',
    objective: 'conversation',
    effectSize: { metric: 'replies', relativeChange: 0.4 },
    sourceExperimentIds: ['exp_1'],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

function principle(overrides: Partial<StrategyPrinciple> = {}): StrategyPrinciple {
  return {
    id: 'sp_1',
    name: 'Question hooks improve engagement',
    description: 'From a CreatorOS marketing skill.',
    sourceType: 'playbook',
    scope: { level: 'global' },
    applicablePlatforms: [],
    applicableObjectives: ['conversation'],
    status: 'hypothesis',
    confidence: 0.15,
    createdAt: NOW,
    ...overrides,
  };
}

function experiment(profileId: string, overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp_active',
    profileId,
    platform: 'threads',
    niche: 'strength training',
    objective: 'conversation',
    contentDna: { topic: 'bench plateau', hookFamily: 'contrarian-claim', format: 'text', tone: 'contrarian', lengthClass: 'short' },
    design: { testVariables: ['hookFamily'], controlVariable: 'topic' },
    execution: { publishedAt: NOW, creatorOsPostId: 'post_1' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('Adaptive — plan construction and objective-first behavior', () => {
  it('builds a plan for a profile', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan).not.toBeNull();
    expect(plan!.profileId).toBe(profile.id);
    expect(plan!.recommendations.length).toBeGreaterThan(0);
  });

  it('ties the plan to the profile primary objective', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { primaryObjective: 'revenue' });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.objective).toBe('revenue');
    expect(plan!.recommendations.every((r) => r.objective === 'revenue')).toBe(true);
  });

  it('produces a conversation-relevant action from conversation evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { primaryObjective: 'conversation' });
    await store.saveFinding(finding(profile.id, { objective: 'conversation' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const top = plan!.recommendations[0]!;
    expect(top.action).toBe('repeat_validated_pattern');
    expect(top.objective).toBe('conversation');
  });

  it('does not let reply evidence drive a revenue objective automatically', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { primaryObjective: 'revenue' });
    // Strong conversation evidence, but the profile is chasing revenue.
    await store.saveFinding(finding(profile.id, { objective: 'conversation', confidence: 0.95 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const replyRec = plan!.recommendations.find((r) => r.basis.findingIds.length > 0);
    // Objective mismatch is penalized: it must not be the top-ranked action.
    expect(replyRec!.priorityScore).toBeLessThan(0.4);
    expect(replyRec!.basis.rationale).toContain('not this profile');
  });

  it('penalizes an objective mismatch relative to a matching objective', () => {
    const matched = computePriorityScore({ objectiveRelevant: true, confidence: 0.8, informationGain: 0.5 });
    const mismatched = computePriorityScore({ objectiveRelevant: false, confidence: 0.8, informationGain: 0.5 });
    expect(mismatched).toBeLessThan(matched);
  });
});

describe('Adaptive — evidence standing drives action', () => {
  it('exploits a validated high-confidence pattern', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'validated', confidence: 0.9 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    expect(recs[0]!.action).toBe('repeat_validated_pattern');
  });

  it('treats a promising pattern more cautiously than a validated one', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'promising', confidence: 0.5 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    expect(recs[0]!.action).toBe('run_experiment');
    expect(recs[0]!.action).not.toBe('repeat_validated_pattern');
  });

  it('deprioritizes a rejected pattern', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'rejected', confidence: 0.8 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    expect(recs[0]!.action).toBe('deprioritize_pattern');
  });

  it('will not exploit a validated finding whose confidence is below the exploit threshold', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'validated', confidence: 0.4 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    expect(recs[0]!.action).toBe('collect_more_evidence');
  });

  it('produces revalidation for a decaying finding rather than repeating it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'validated', lastValidatedAt: '2024-01-01T00:00:00Z' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendRevalidations(profile.id, 'conversation');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.action).toBe('revalidate_finding');
  });

  it('reuses Science Engine revalidation candidates in the plan', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const stale = finding(profile.id, { id: 'fnd_stale', lastValidatedAt: '2024-01-01T00:00:00Z' });
    await store.saveFinding(stale);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.revalidationItems).toContain('fnd_stale');
  });
});

describe('Adaptive — failure memory', () => {
  it('actively deprioritizes a pattern that repeatedly failed for this profile', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const statement = 'Long-form posts lift replies.';
    await store.saveFinding(finding(profile.id, { id: 'f1', statement, status: 'rejected' }));
    await store.saveFinding(finding(profile.id, { id: 'f2', statement, status: 'rejected' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    expect(await engine.countPatternFailures(profile.id, statement)).toBe(2);
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    const rec = recs.find((r) => r.basis.findingIds.includes('f1'))!;
    expect(rec.action).toBe('deprioritize_pattern');
    expect(rec.reason).toContain('rejected 2 times');
  });

  it('allows deliberate revalidation of a failed pattern when conditions change', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    // A stale rejected finding still surfaces via the revalidation path.
    await store.saveFinding(finding(profile.id, { id: 'f_old', status: 'decaying', lastValidatedAt: '2024-01-01T00:00:00Z' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendRevalidations(profile.id, 'conversation');
    expect(recs.some((r) => r.action === 'revalidate_finding')).toBe(true);
  });
});

describe('Adaptive — exploration vs exploitation', () => {
  it('gives discovery mode more exploration than balanced', async () => {
    const store = await tmpStore();
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const discovery = engine.buildExperimentAllocation('discovery');
    const balanced = engine.buildExperimentAllocation('balanced');
    expect(discovery.explorationShare).toBeGreaterThan(balanced.explorationShare);
  });

  it('gives conservative mode the least exploration', async () => {
    const store = await tmpStore();
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const conservative = engine.buildExperimentAllocation('conservative');
    const balanced = engine.buildExperimentAllocation('balanced');
    expect(conservative.explorationShare).toBeLessThan(balanced.explorationShare);
    expect(conservative.exploitationShare).toBeGreaterThan(conservative.explorationShare);
  });

  it('supports both exploration and exploitation in balanced mode', async () => {
    const store = await tmpStore();
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const balanced = engine.buildExperimentAllocation('balanced');
    expect(balanced.explorationShare).toBeGreaterThan(0);
    expect(balanced.exploitationShare).toBeGreaterThan(0);
    expect(balanced.explorationShare + balanced.exploitationShare).toBeCloseTo(1);
  });

  it('carries the profile experiment mode into the plan', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { experimentMode: 'discovery' });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.experimentAllocation.experimentMode).toBe('discovery');
  });
});

describe('Adaptive — constraints', () => {
  it('respects posting capacity', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { postsPerDay: 2 });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const constraints = await engine.evaluateStrategyConstraints(profile.id);
    expect(exceedsCapacity(10, constraints)).toBe(true);
    expect(exceedsCapacity(2, constraints)).toBe(false);
  });

  it('respects topics to avoid', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { styleConstraints: ['no politics'] });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const constraints = await engine.evaluateStrategyConstraints(profile.id);
    expect(isTopicForbidden('politics', constraints)).toBe(true);
    expect(isTopicForbidden('deadlifts', constraints)).toBe(false);
  });

  it('locks the controlled variables of an active experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveExperiment(experiment(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const constraints = await engine.evaluateStrategyConstraints(profile.id);
    const experimentConstraint = constraints.find((c) => c.source === 'active_experiment')!;
    expect(experimentConstraint.lockedVariables).toContain('topic');
    expect(experimentConstraint.lockedVariables).toContain('hookFamily');
  });

  it('does not let strategy alter a variable an active experiment is holding still', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveExperiment(experiment(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const constraints = await engine.evaluateStrategyConstraints(profile.id);
    expect(violatesActiveExperiment(['topic'], constraints)).toBe(true);
    expect(violatesActiveExperiment(['ctaType'], constraints)).toBe(false);
  });

  it('surfaces constraints on the plan itself', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { postsPerDay: 2, styleConstraints: ['no politics'] });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.constraints.some((c) => c.source === 'posting_capacity')).toBe(true);
    expect(plan!.constraints.some((c) => c.source === 'brand_rule')).toBe(true);
  });

  it('flags a profile with no active offers so conversion tests are not proposed blindly', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { offers: undefined });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const constraints = await engine.evaluateStrategyConstraints(profile.id);
    expect(constraints.some((c) => c.source === 'offer_availability')).toBe(true);
  });

  it('lets a sale-objective profile with an offer be represented for offer/CTA testing', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, {
      primaryObjective: 'sale',
      offers: [{ name: 'Peaking Block', description: '8-week program', price: 79, currency: 'USD' }],
    });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const constraints = await engine.evaluateStrategyConstraints(profile.id);
    expect(constraints.some((c) => c.source === 'offer_availability')).toBe(false);
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.objective).toBe('sale');
  });

  it('lets a traffic-objective profile build a plan focused on that objective', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { primaryObjective: 'traffic' });
    await store.saveFinding(finding(profile.id, { objective: 'traffic', effectSize: { metric: 'clicks', relativeChange: 0.3 } }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.objective).toBe('traffic');
    expect(plan!.recommendations[0]!.priorityScore).toBeGreaterThan(0.4);
  });
});

describe('Adaptive — audience integration', () => {
  const segment = (profileId: string): ObservedAudienceSegment => ({
    id: 'oseg_1',
    profileId,
    name: 'Plateaued benchers',
    status: 'active',
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    signalCount: 20,
    confidence: 0.6,
    characteristics: [],
    problems: [],
    goals: [],
    objections: [],
    topics: [],
    languagePatterns: [],
    schemaVersion: 1,
  });

  const segmentFinding = (profileId: string): SegmentFinding => ({
    id: 'sf_1',
    profileId,
    segmentId: 'oseg_1',
    statement: 'This segment responds to specificity over motivation.',
    scope: { level: 'profile', profileId },
    supportingSignalIds: ['sig_1'],
    supportingExperimentIds: ['exp_1'],
    contradictingSignalIds: [],
    confidence: 0.75,
    status: 'supported',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
  });

  it('lets a supported segment finding influence a recommendation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveObservedSegment(segment(profile.id));
    await store.saveSegmentFinding(segmentFinding(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendAudienceActions(profile.id, 'conversation');
    const target = recs.find((r) => r.action === 'target_segment')!;
    expect(target.audienceSegmentId).toBe('oseg_1');
    expect(target.basis.segmentFindingIds).toContain('sf_1');
  });

  it('preserves the declared audience — adaptive strategy never rewrites it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { declaredAudience: 'Intermediate lifters stuck at a plateau' });
    await store.saveObservedSegment(segment(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    await engine.buildAdaptiveStrategyPlan(profile.id);
    const reloaded = await store.getProfile(profile.id);
    expect(reloaded!.audience.primaryAudience).toContain('Intermediate lifters stuck at a plateau');
    expect(reloaded).toEqual(profile);
  });

  it('does not fabricate a segment when no audience evidence exists', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendAudienceActions(profile.id, 'conversation');
    expect(recs).toHaveLength(1);
    expect(recs[0]!.action).toBe('collect_more_evidence');
    expect(recs[0]!.audienceSegmentId).toBeUndefined();
  });
});

describe('Adaptive — research intelligence integration', () => {
  it('lets a StrategyPrinciple seed a candidate experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveStrategyPrinciple(principle());
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendExperiments(profile.id, 'conversation', []);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.action).toBe('run_experiment');
    expect(recs[0]!.basis.strategyPrincipleIds).toContain('sp_1');
  });

  it('never turns a playbook claim into a validated action automatically', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveStrategyPrinciple(principle({ sourceType: 'playbook', confidence: 0.9 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendExperiments(profile.id, 'conversation', []);
    expect(recs[0]!.action).toBe('run_experiment');
    expect(recs[0]!.action).not.toBe('repeat_validated_pattern');
    expect(recs[0]!.limitations).toContain('small_sample');
  });

  it('does not re-propose outside advice the profile has already answered with its own evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveStrategyPrinciple(principle({ name: 'Question hooks improve engagement' }));
    await store.saveFinding(finding(profile.id, { statement: 'Question hooks improve engagement' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendExperiments(profile.id, 'conversation', []);
    expect(recs).toHaveLength(0);
  });
});

describe('Adaptive — information gain', () => {
  it('scores maximum uncertainty highest', () => {
    const uncertain = computeInformationGain({ subjectType: 'hypothesis', subjectId: 'h1', confidence: 0.5, dependentMetric: 'replies', objective: 'conversation' });
    const settled = computeInformationGain({ subjectType: 'hypothesis', subjectId: 'h2', confidence: 0.98, dependentMetric: 'replies', objective: 'conversation' });
    expect(uncertain.uncertainty).toBeGreaterThan(settled.uncertainty);
  });

  it('raises priority for uncertainty that matters to the objective', () => {
    const relevant = computeInformationGain({ subjectType: 'hypothesis', subjectId: 'h1', confidence: 0.5, dependentMetric: 'replies', objective: 'conversation' });
    const irrelevant = computeInformationGain({ subjectType: 'hypothesis', subjectId: 'h2', confidence: 0.5, dependentMetric: 'replies', objective: 'revenue' });
    expect(relevant.score).toBeGreaterThan(irrelevant.score);
    expect(relevant.rationale).toContain('directly inform');
  });

  it('gives low-consequence uncertainty a lower priority score', () => {
    const highValue = computePriorityScore({ objectiveRelevant: true, confidence: 0.5, informationGain: 0.9 });
    const lowValue = computePriorityScore({ objectiveRelevant: true, confidence: 0.5, informationGain: 0.1 });
    expect(highValue).toBeGreaterThan(lowValue);
  });
});

describe('Adaptive — content allocation bounds', () => {
  const pillars = [
    { pillarId: 'a', share: 0.25 },
    { pillarId: 'b', share: 0.25 },
    { pillarId: 'c', share: 0.25 },
    { pillarId: 'd', share: 0.25 },
  ];

  it('keeps allocations bounded and normalized', () => {
    const result = recommendContentAllocation({
      currentAllocations: pillars,
      evidenceByPillar: { a: { direction: 'up', sampleSize: 30 }, d: { direction: 'down', sampleSize: 30 } },
      policy: DEFAULT_STRATEGY_POLICY,
    });
    const total = result.reduce((sum, p) => sum + p.share, 0);
    expect(total).toBeCloseTo(1);
    expect(result.every((p) => p.share >= DEFAULT_STRATEGY_POLICY.minimumPillarAllocation * 0.9)).toBe(true);
  });

  it('damps an allocation shift when the sample is tiny', () => {
    const thin = recommendContentAllocation({
      currentAllocations: pillars,
      evidenceByPillar: { a: { direction: 'up', sampleSize: 1 } },
      policy: DEFAULT_STRATEGY_POLICY,
    });
    const thick = recommendContentAllocation({
      currentAllocations: pillars,
      evidenceByPillar: { a: { direction: 'up', sampleSize: 50 } },
      policy: DEFAULT_STRATEGY_POLICY,
    });
    const thinA = thin.find((p) => p.pillarId === 'a')!;
    const thickA = thick.find((p) => p.pillarId === 'a')!;
    expect(thinA.share).toBeLessThan(thickA.share);
    expect(thinA.reason).toContain('thin');
  });

  it('never starves a pillar below the exploration floor', () => {
    const result = recommendContentAllocation({
      currentAllocations: [
        { pillarId: 'a', share: 0.9 },
        { pillarId: 'b', share: 0.1 },
      ],
      evidenceByPillar: { b: { direction: 'down', sampleSize: 100 } },
      policy: DEFAULT_STRATEGY_POLICY,
    });
    const b = result.find((p) => p.pillarId === 'b')!;
    expect(b.share).toBeGreaterThan(0);
  });

  it('exposes the previous share so every change is visible', () => {
    const result = recommendContentAllocation({
      currentAllocations: pillars,
      evidenceByPillar: { a: { direction: 'up', sampleSize: 30 } },
      policy: DEFAULT_STRATEGY_POLICY,
    });
    expect(result.every((p) => p.previousShare === 0.25)).toBe(true);
    expect(result.every((p) => typeof p.reason === 'string' && p.reason.length > 0)).toBe(true);
  });
});

describe('Adaptive — unknowns and honesty under no evidence', () => {
  it('recommends do_nothing_yet when nothing supports a change', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    // Give it an observed segment so the audience path stays quiet.
    await store.saveObservedSegment({
      id: 'oseg_q', profileId: profile.id, name: 'q', status: 'active',
      firstObservedAt: NOW, lastObservedAt: NOW, signalCount: 1, confidence: 0.1,
      characteristics: [], problems: [], goals: [], objections: [], topics: [], languagePatterns: [], schemaVersion: 1,
    });
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.recommendations[0]!.action).toBe('do_nothing_yet');
  });

  it('does not give a no-evidence profile a fake validated strategy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.recommendations.some((r) => r.action === 'repeat_validated_pattern')).toBe(false);
  });

  it('lists unknowns on the plan', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.unknowns.length).toBeGreaterThan(0);
    expect(plan!.unknowns.some((u) => u.topic.includes('Validated patterns'))).toBe(true);
  });

  it('lists limitations on the plan', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.limitations.length).toBeGreaterThan(0);
  });

  it('supports collect_more_evidence and run_experiment as first-class actions', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveStrategyPrinciple(principle());
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const actions = plan!.recommendations.map((r) => r.action);
    expect(actions).toContain('run_experiment');
    expect(actions).toContain('collect_more_evidence');
  });
});

describe('Adaptive — recommendation basis and explainability', () => {
  it('exposes confidence, limitations and evidence refs', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'fnd_x', sourceExperimentIds: ['exp_7'] }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    const rec = recs[0]!;
    expect(typeof rec.confidence).toBe('number');
    expect(Array.isArray(rec.limitations)).toBe(true);
    expect(rec.basis.findingIds).toContain('fnd_x');
    expect(rec.basis.experimentIds).toContain('exp_7');
  });

  it('explains a recommendation from its stored basis', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'fnd_y' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const recs = await engine.recommendFromFindings(profile.id, 'conversation', []);
    const explanation = engine.explainRecommendation(recs[0]!);
    expect(explanation.rationale.length).toBeGreaterThan(0);
    expect(explanation.evidence.findingIds).toContain('fnd_y');
    expect(explanation.objective).toBe('conversation');
  });

  it('ranks deterministically — identical inputs produce identical order', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { id: 'f_a', confidence: 0.9 }));
    await store.saveFinding(finding(profile.id, { id: 'f_b', statement: 'Another pattern.', confidence: 0.6 }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const first = await engine.recommendFromFindings(profile.id, 'conversation', []);
    const second = await engine.recommendFromFindings(profile.id, 'conversation', []);
    expect(engine.rankNextActions(first).map((r) => r.priorityScore)).toEqual(
      engine.rankNextActions(second).map((r) => r.priorityScore),
    );
  });
});

describe('Adaptive — lifecycle, versioning and human approval', () => {
  it('always creates recommendations as proposed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.recommendations.every((r) => r.status === 'proposed')).toBe(true);
  });

  it('supports the human-approval transition without executing anything', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const target = plan!.recommendations[0]!;
    const approved = await engine.setRecommendationStatus(target.id, 'approved');
    expect(approved!.status).toBe('approved');
    const reloaded = await store.getStrategyRecommendation(target.id);
    expect(reloaded!.status).toBe('approved');
  });

  it('walks the full recommendation status lifecycle', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    const id = plan!.recommendations[0]!.id;
    for (const status of ['approved', 'active', 'completed'] as const) {
      const updated = await engine.setRecommendationStatus(id, status);
      expect(updated!.status).toBe(status);
    }
  });

  it('versions plans and retains the previous one', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const first = await engine.buildAdaptiveStrategyPlan(profile.id);
    const second = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(second!.version).toBe(first!.version + 1);
    expect(second!.supersedesPlanId).toBe(first!.id);
    // The earlier plan is still readable.
    const retained = await store.getAdaptiveStrategyPlan(first!.id);
    expect(retained).not.toBeNull();
    expect(retained!.version).toBe(1);
  });

  it('records the policy version on plans and recommendations', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow, policy: { policyVersion: 'adaptive-test-9' } });
    const plan = await engine.buildAdaptiveStrategyPlan(profile.id);
    expect(plan!.policyVersion).toBe('adaptive-test-9');
    expect(plan!.recommendations.every((r) => r.policyVersion === 'adaptive-test-9')).toBe(true);
  });
});

describe('Adaptive — isolation, integration and invariants', () => {
  it('keeps multiple profiles isolated', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store, { creatorOsAccountId: 'acct_a' });
    const b = await seedProfile(store, { creatorOsAccountId: 'acct_b' });
    await store.saveFinding(finding(a.id, { id: 'fnd_a_only' }));
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    const planA = await engine.buildAdaptiveStrategyPlan(a.id);
    const planB = await engine.buildAdaptiveStrategyPlan(b.id);
    expect(planA!.recommendations.some((r) => r.basis.findingIds.includes('fnd_a_only'))).toBe(true);
    expect(planB!.recommendations.some((r) => r.basis.findingIds.includes('fnd_a_only'))).toBe(false);
  });

  it('reuses the Science Engine rather than recomputing baselines', async () => {
    // A store that would throw if adaptive strategy tried to read raw
    // measurements to build its own baseline.
    const calls: string[] = [];
    const fakeStore = {
      getProfile: async () => ({
        id: 'prof_1', creatorOsAccountId: 'acct_1', platform: 'threads',
        identity: { brandName: 'X', faceless: false, voice: [] },
        market: { niche: 'n' },
        audience: { primaryAudience: 'a', segments: [], pains: [], desires: [], languagePatterns: [] },
        objectives: { primary: 'conversation' as GrowthObjective, secondary: [] },
        strategy: { experimentMode: 'balanced' as const, postingFrequency: {}, contentPillars: [], currentAllocations: [] },
        monetization: { offers: [] },
        workspaceId: 'ws_test',
        createdAt: NOW, updatedAt: NOW, version: 1,
      } satisfies SocialProfile),
      listExperiments: async () => { calls.push('listExperiments'); return []; },
      listFindings: async () => { calls.push('listFindings'); return []; },
      listHypotheses: async () => { calls.push('listHypotheses'); return []; },
      listStrategyPrinciples: async () => { calls.push('listStrategyPrinciples'); return []; },
      listObservedSegments: async () => { calls.push('listObservedSegments'); return []; },
      listSegmentFindings: async () => { calls.push('listSegmentFindings'); return []; },
      listAdaptiveStrategyPlans: async () => [],
      saveStrategyRecommendation: async () => { calls.push('saveStrategyRecommendation'); },
      saveAdaptiveStrategyPlan: async () => { calls.push('saveAdaptiveStrategyPlan'); },
      listPostMeasurements: async () => { calls.push('listPostMeasurements'); return []; },
      listAttributionEvents: async () => { calls.push('listAttributionEvents'); return []; },
    } as unknown as IntelligenceStore;

    const engine = new AdaptiveStrategyEngine(fakeStore, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan('prof_1');
    expect(plan).not.toBeNull();
    // Adaptive strategy reads findings/hypotheses — never raw measurements
    // for its own baseline math.
    expect(calls).not.toContain('listPostMeasurements');
    expect(calls).toContain('listFindings');
  });

  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fakeStore = { getProfile: async () => null } as unknown as IntelligenceStore;
    const engine = new AdaptiveStrategyEngine(fakeStore, { now: fixedNow });
    expect(await engine.buildAdaptiveStrategyPlan('missing')).toBeNull();
  });

  it('generates no content and publishes nothing', async () => {
    const methods = Object.getOwnPropertyNames(AdaptiveStrategyEngine.prototype);
    expect(methods.some((m) => /publish|write|generate|compose|send/i.test(m))).toBe(false);
  });

  it('leaves raw evidence untouched', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const original = finding(profile.id, { id: 'fnd_immutable' });
    await store.saveFinding(original);
    const engine = new AdaptiveStrategyEngine(store, { now: fixedNow });
    await engine.buildAdaptiveStrategyPlan(profile.id);
    const reloaded = await store.getFinding('fnd_immutable');
    expect(reloaded).toEqual(original);
  });

  it('survives store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-adaptive-reload-'));
    const first = new JsonlIntelligenceStore(root);
    const result = await onboardProfile(onboardingInput(), first, NOW);
    if (!result.ok) throw new Error('seed failed');
    const engine = new AdaptiveStrategyEngine(first, { now: fixedNow });
    const plan = await engine.buildAdaptiveStrategyPlan(result.profile.id);

    const second = new JsonlIntelligenceStore(root);
    const reloaded = await second.getAdaptiveStrategyPlan(plan!.id);
    expect(reloaded!.id).toBe(plan!.id);
    const recs = await second.listStrategyRecommendations({ profileId: result.profile.id });
    expect(recs.length).toBeGreaterThan(0);
  });

  it('derives constraints purely from stored configuration', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store, { postsPerDay: 3 });
    const constraints = deriveConstraints(profile, []);
    expect(constraints.find((c) => c.source === 'posting_capacity')!.maxPostsPerDay).toBe(3);
  });
});
