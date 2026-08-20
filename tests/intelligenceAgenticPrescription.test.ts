import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { AgenticPrescriptionEngine } from '../src/intelligence/agentic/engine.js';
import {
  autonomyRank,
  canHandOffToCreatorOs,
  classifyActionRisk,
  derivePersonalizationMaturity,
  deriveEvidenceState,
  deriveMissionConstraints,
  isActionPermitted,
  requiresApproval,
  riskRank,
  violatesActiveExperiment,
} from '../src/intelligence/agentic/policy.js';
import { EMPTY_EVIDENCE_REFS, defaultPermissionPolicy } from '../src/intelligence/agentic/types.js';
import type { IntelligenceStore } from '../src/intelligence/storage/store.js';
import type {
  ActorRef,
  AgentPermissionPolicy,
  AttributionEvent,
  Finding,
  Hypothesis,
  ObservedAudienceSegment,
  TransferAssessment,
} from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-20T12:00:00Z';
const fixedNow = () => NOW;

const HUMAN: ActorRef = { kind: 'human', id: 'owner_1' };

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-agentic-')));
}

function engineWith(store: IntelligenceStore): AgenticPrescriptionEngine {
  return new AgenticPrescriptionEngine(store, { now: fixedNow });
}

function onboardingInput(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
  return {
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    brandName: 'Ledger Lines',
    niche: 'bookkeeping',
    declaredAudience: 'Solo operators who dread reconciliation',
    primaryObjective: 'lead',
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

let findingCounter = 0;
function finding(profileId: string, overrides: Partial<Finding> = {}): Finding {
  findingCounter += 1;
  return {
    id: `fnd_${findingCounter}`,
    statement: 'Contrarian hooks lift replies.',
    scope: { level: 'profile', profileId },
    profileId,
    platform: 'threads',
    sampleSize: 24,
    confidence: 0.85,
    status: 'validated',
    objective: 'lead',
    hookFamily: 'contrarian-claim',
    contentFormat: 'text',
    sourceExperimentIds: [`exp_${findingCounter}`],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

let transferCounter = 0;
function transfer(targetProfileId: string, overrides: Partial<TransferAssessment> = {}): TransferAssessment {
  transferCounter += 1;
  return {
    id: `tr_${transferCounter}`,
    candidateId: `cand_${transferCounter}`,
    findingId: `fnd_source_${transferCounter}`,
    targetProfileId,
    sourceClass: 'matched_peer',
    relevance: 'moderately_relevant',
    similarity: {
      dimensions: [],
      overallSimilarity: 0.7,
      dimensionCoverage: 0.6,
      matchedDimensions: [],
      mismatchedDimensions: [],
      unknownDimensions: [],
      limitations: [],
    },
    assessmentConfidence: 0.55,
    whyItMightApply: ['Same niche.'],
    whyItMightNotApply: ['Different account stage.'],
    negativeTransferRisks: [],
    unknowns: [],
    evidenceAgeDays: 10,
    recommendation: {
      action: 'seed_hypothesis',
      reason: 'Worth testing on this profile.',
      proposedHypothesisStatement: 'Numbered lists lift saves here too.',
      priority: 0.6,
    },
    limitations: [],
    policyVersion: 'test',
    createdAt: NOW,
    schemaVersion: 1,
    ...overrides,
  };
}

let hypothesisCounter = 0;
function hypothesis(profileId: string, overrides: Partial<Hypothesis> = {}): Hypothesis {
  hypothesisCounter += 1;
  return {
    id: `hyp_${hypothesisCounter}`,
    statement: 'Question hooks raise reply rate.',
    scope: { level: 'profile', profileId },
    profileId,
    objective: 'lead',
    independentVariable: 'hookFamily',
    dependentMetric: 'replies',
    controlVariables: ['topic'],
    status: 'testing',
    confidence: 0.3,
    source: 'experiment',
    supportingExperimentIds: [`exp_h_${hypothesisCounter}`],
    contradictingExperimentIds: [],
    createdAt: NOW,
    ...overrides,
  };
}

let attributionCounter = 0;
function attribution(profileId: string, overrides: Partial<AttributionEvent> = {}): AttributionEvent {
  attributionCounter += 1;
  return {
    id: `att_${attributionCounter}`,
    profileId,
    eventType: 'lead',
    occurredAt: NOW,
    attributionMethod: 'utm',
    source: 'manual',
    evidenceSource: 'first_party',
    schemaVersion: 1,
    ...overrides,
  };
}

function segment(profileId: string, overrides: Partial<ObservedAudienceSegment> = {}): ObservedAudienceSegment {
  return {
    id: 'seg_1',
    profileId,
    label: 'Solo bookkeepers',
    descriptors: ['solo-operators'],
    signalCount: 12,
    status: 'emerging',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ObservedAudienceSegment;
}

/** An agent plus an active mission, the normal starting point. */
async function seedAgent(store: JsonlIntelligenceStore, profileId: string) {
  const engine = engineWith(store);
  const agent = await engine.createAgent({ profileIds: [profileId], workspaceId: 'ws_1' });
  const mission = await engine.createMission({
    agentId: agent.id,
    workspaceId: 'ws_1',
    statement: 'Generate 10 qualified leads a month from Threads.',
    primaryObjective: 'lead',
    platformScope: ['threads'],
  });
  return { engine, agent, mission };
}

/** Overwrites the stored policy so a test can exercise a different posture. */
async function setPolicy(
  store: JsonlIntelligenceStore,
  agentId: string,
  overrides: Partial<AgentPermissionPolicy>,
): Promise<AgentPermissionPolicy> {
  const policy = { ...defaultPermissionPolicy(agentId, NOW), ...overrides } as AgentPermissionPolicy;
  await store.saveAgentPermissionPolicy(policy);
  return policy;
}

/* ======================================================================
 * AGENT AND WORKSPACE
 * =================================================================== */

describe('Agentic — agent and workspace identity', () => {
  it('creates an agent bound to a workspace and profiles', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = engineWith(store);
    const agent = await engine.createAgent({ profileIds: [profile.id], workspaceId: 'ws_1' });

    expect(agent.workspaceId).toBe('ws_1');
    expect(agent.profileIds).toEqual([profile.id]);
  });

  it('starts an agent at copilot, never autonomous_lab', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const agent = await engineWith(store).createAgent({ profileIds: [profile.id] });

    expect(agent.autonomyLevel).toBe('copilot');
    expect(agent.autonomyLevel).not.toBe('autonomous_lab');
  });

  it('starts an agent in onboarding status with no mission', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const agent = await engineWith(store).createAgent({ profileIds: [profile.id] });

    expect(agent.status).toBe('onboarding');
    expect(agent.missionId).toBeUndefined();
  });

  it('gives a new agent a default permission policy that forbids publishing', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = engineWith(store);
    const agent = await engine.createAgent({ profileIds: [profile.id] });
    const policy = await engine.getPermissionPolicy(agent.id);

    expect(policy.publishingAllowed).toBe(false);
    expect(policy.schedulingAllowed).toBe(false);
    expect(policy.spendActionsAllowed).toBe(false);
    expect(policy.offerChangesAllowed).toBe(false);
  });

  it('keeps the state of two agents fully separate', async () => {
    const store = await tmpStore();
    const a = await seedProfile(store);
    const b = await seedProfile(store, { creatorOsAccountId: '507f1f77bcf86cd799439012', brandName: 'Other Co' });
    const engine = engineWith(store);
    const agentA = await engine.createAgent({ profileIds: [a.id], workspaceId: 'ws_a' });
    const agentB = await engine.createAgent({ profileIds: [b.id], workspaceId: 'ws_b' });

    await engine.createMission({ agentId: agentA.id, statement: 'A goal', primaryObjective: 'lead' });

    const reloadedB = await store.getAgent(agentB.id);
    expect(reloadedB?.missionId).toBeUndefined();
    expect(agentA.id).not.toBe(agentB.id);
  });

  it('lists agents scoped to a workspace', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = engineWith(store);
    await engine.createAgent({ profileIds: [profile.id], workspaceId: 'ws_a' });
    await engine.createAgent({ profileIds: [profile.id], workspaceId: 'ws_b' });

    expect(await store.listAgents({ workspaceId: 'ws_a' })).toHaveLength(1);
  });

  it('persists agent state across store instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-agentic-persist-'));
    const first = new JsonlIntelligenceStore(root);
    const profile = await seedProfile(first);
    const agent = await engineWith(first).createAgent({ profileIds: [profile.id] });

    const second = new JsonlIntelligenceStore(root);
    expect((await second.getAgent(agent.id))?.id).toBe(agent.id);
  });
});

/* ======================================================================
 * MISSION
 * =================================================================== */

describe('Agentic — mission', () => {
  it('stores a business objective, not a vanity metric', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { mission } = await seedAgent(store, profile.id);

    expect(mission.primaryObjective).toBe('lead');
    expect(mission.statement).toContain('leads');
  });

  it('activates the agent when a mission is created', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { agent } = await seedAgent(store, profile.id);

    expect((await store.getAgent(agent.id))?.status).toBe('active');
  });

  it('defaults an empty platform scope to "all platforms in scope"', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const mission = await engineWith(store).createMission({
      agentId: 'agent_x', statement: 'Grow', primaryObjective: 'lead',
    });
    expect(mission.platformScope).toEqual([]);
    expect(profile.platform).toBeDefined();
  });

  it('supersedes rather than overwrites a mission on update', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, mission } = await seedAgent(store, profile.id);

    const updated = await engine.updateMission(mission.id, { statement: 'Generate 25 leads a month.' }, HUMAN);

    expect(updated?.id).not.toBe(mission.id);
    expect(updated?.supersedesMissionId).toBe(mission.id);
    expect((await store.getAgentMission(mission.id))?.status).toBe('superseded');
  });

  it('retains the original mission text after an update', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, mission } = await seedAgent(store, profile.id);
    await engine.updateMission(mission.id, { statement: 'Something else.' }, HUMAN);

    const original = await store.getAgentMission(mission.id);
    expect(original?.statement).toContain('10 qualified leads');
  });

  it('increments the mission version on update', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, mission } = await seedAgent(store, profile.id);
    const updated = await engine.updateMission(mission.id, { statement: 'New.' }, HUMAN);

    expect(updated?.version).toBe(mission.version + 1);
  });

  it('points the agent at the new mission version', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent, mission } = await seedAgent(store, profile.id);
    const updated = await engine.updateMission(mission.id, { statement: 'New.' }, HUMAN);

    expect((await store.getAgent(agent.id))?.missionId).toBe(updated?.id);
  });

  it('logs a mission change to the change log', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent, mission } = await seedAgent(store, profile.id);
    await engine.updateMission(mission.id, { statement: 'New.' }, HUMAN);

    const log = await engine.getChangeLog(agent.id);
    expect(log.some((r) => r.changeType === 'mission_changed')).toBe(true);
  });

  it('carries brand constraints onto the mission', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = engineWith(store);
    const agent = await engine.createAgent({ profileIds: [profile.id] });
    const mission = await engine.createMission({
      agentId: agent.id,
      statement: 'Grow leads',
      primaryObjective: 'lead',
      brandConstraints: { topicsToAvoid: ['politics'], toneRules: ['no hype'], complianceRules: [] },
    });

    expect(mission.brandConstraints.topicsToAvoid).toContain('politics');
  });

  it('returns null when updating a mission that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).updateMission('nope', { statement: 'x' }, HUMAN)).toBeNull();
  });
});

/* ======================================================================
 * EVIDENCE STATES — know / suspect / test / unknown / stopped
 * =================================================================== */

describe('Agentic — evidence states', () => {
  it('reports unknown for a profile with no evidence at all', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.unknown).toBe(1);
    expect(summary.know).toBe(0);
  });

  it('promotes a validated high-confidence first-party finding to know', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.know).toBe(1);
  });

  it('keeps a promising first-party finding at suspect', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'promising', confidence: 0.4 }));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.suspect).toBe(1);
    expect(summary.know).toBe(0);
  });

  it('never lets transferred evidence reach know, however confident', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(transfer(profile.id, { assessmentConfidence: 0.99 }));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.know).toBe(0);
    expect(summary.suspect).toBe(1);
  });

  it('marks a contraindicated transfer as stopped', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(transfer(profile.id, { relevance: 'contraindicated' }));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.stopped).toBe(1);
  });

  it('excludes irrelevant transfers from the evidence picture entirely', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(transfer(profile.id, { relevance: 'irrelevant' }));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.entries.filter((e) => e.origin === 'transfer_assessment')).toHaveLength(0);
  });

  it('marks a rejected finding as stopped, not deleted', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { status: 'rejected' }));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.stopped).toBe(1);
    expect(summary.entries[0]?.findingIds).toHaveLength(1);
  });

  it('marks an open hypothesis as test', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveHypothesis(hypothesis(profile.id));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.test).toBe(1);
  });

  it('carries a finding\'s limitations into its evidence entry', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { limitations: ['small_sample'] }));
    const summary = await engineWith(store).getEvidenceStateSummary(profile.id);

    expect(summary.entries[0]?.limitations).toContain('small_sample');
  });

  it('reserves know for first-party evidence in deriveEvidenceState', () => {
    const first = deriveEvidenceState({ origin: 'first_party_finding', isValidated: true, confidence: 0.9 });
    const genome = deriveEvidenceState({ origin: 'genome_pattern', isValidated: true, confidence: 0.99 });

    expect(first.state).toBe('know');
    expect(genome.state).toBe('suspect');
  });

  it('holds first-party evidence below know when confidence is short of the bar', () => {
    expect(deriveEvidenceState({ origin: 'first_party_finding', isValidated: true, confidence: 0.5 }).state)
      .toBe('suspect');
  });

  it('prefers stopped over every other state', () => {
    expect(deriveEvidenceState({
      origin: 'first_party_finding', isValidated: true, confidence: 0.99, isStopped: true,
    }).state).toBe('stopped');
  });

  it('returns unknown when the origin is none', () => {
    expect(deriveEvidenceState({ origin: 'none', isValidated: false }).state).toBe('unknown');
  });

  it('explains research-origin evidence as untested here', () => {
    const result = deriveEvidenceState({ origin: 'research_claim', isValidated: false, confidence: 0.8 });
    expect(result.rationale).toContain('not yet tested on this profile');
  });
});

/* ======================================================================
 * ACTION RISK, PERMISSION AND APPROVAL
 * =================================================================== */

describe('Agentic — risk classification', () => {
  it('treats offer testing as restricted', () => {
    expect(classifyActionRisk('test_offer')).toBe('restricted');
  });

  it('treats an unrecognized action as restricted, not low', () => {
    expect(classifyActionRisk('other')).toBe('restricted');
  });

  it('treats content generation as low risk', () => {
    expect(classifyActionRisk('generate_content')).toBe('low');
  });

  it('treats stopping a strategy as high risk', () => {
    expect(classifyActionRisk('stop_strategy')).toBe('high');
  });

  it('orders autonomy from advisor to autonomous_lab', () => {
    expect(autonomyRank('advisor')).toBeLessThan(autonomyRank('copilot'));
    expect(autonomyRank('operator')).toBeLessThan(autonomyRank('autonomous_lab'));
  });

  it('orders risk from low to restricted', () => {
    expect(riskRank('low')).toBeLessThan(riskRank('high'));
    expect(riskRank('high')).toBeLessThan(riskRank('restricted'));
  });
});

describe('Agentic — permission and approval', () => {
  const policy = (overrides: Partial<AgentPermissionPolicy> = {}) =>
    ({ ...defaultPermissionPolicy('agent_1', NOW), ...overrides }) as AgentPermissionPolicy;

  it('never permits an offer change, whatever the policy says', () => {
    expect(isActionPermitted('test_offer', policy()).permitted).toBe(false);
  });

  it('blocks scheduling-dependent actions when neither scheduling nor publishing is allowed', () => {
    expect(isActionPermitted('approve_content', policy()).permitted).toBe(false);
  });

  it('permits scheduling-dependent actions once scheduling is enabled', () => {
    expect(isActionPermitted('approve_content', policy({ schedulingAllowed: true })).permitted).toBe(true);
  });

  it('requires approval for restricted actions even at autonomous_lab', () => {
    const result = requiresApproval({
      actionType: 'test_offer', riskClass: 'restricted', policy: policy({ autonomyLevel: 'autonomous_lab' }),
    });
    expect(result.required).toBe(true);
  });

  it('requires approval for everything in advisor mode', () => {
    const result = requiresApproval({
      actionType: 'generate_content', riskClass: 'low', policy: policy({ autonomyLevel: 'advisor' }),
    });
    expect(result.required).toBe(true);
  });

  it('lets copilot prepare content without approval', () => {
    const result = requiresApproval({
      actionType: 'generate_content', riskClass: 'low', policy: policy({ autonomyLevel: 'copilot' }),
    });
    expect(result.required).toBe(false);
  });

  it('requires approval when risk meets the workspace threshold', () => {
    const result = requiresApproval({
      actionType: 'target_segment',
      riskClass: 'medium',
      policy: policy({ autonomyLevel: 'operator', approvalRequiredAtOrAbove: 'medium' }),
    });
    expect(result.required).toBe(true);
  });

  it('lets operator act below the threshold without approval', () => {
    const result = requiresApproval({
      actionType: 'collect_more_evidence',
      riskClass: 'low',
      policy: policy({ autonomyLevel: 'operator', approvalRequiredAtOrAbove: 'high' }),
    });
    expect(result.required).toBe(false);
  });
});

/* ======================================================================
 * ACTION QUEUE
 * =================================================================== */

describe('Agentic — action queue', () => {
  it('proposes an action with an evidence-linked reason', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const f = finding(profile.id);
    await store.saveFinding(f);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'generate_content',
      reason: 'Repeat a validated hook.',
      evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: [f.id] },
    });

    expect(action.evidenceRefs.findingIds).toEqual([f.id]);
    expect(action.reason).toBeTruthy();
  });

  it('marks a restricted action as needing approval', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_offer', reason: 'Try a lower price.',
    });

    expect(action.riskClass).toBe('restricted');
    expect(action.requiresApproval).toBe(true);
  });

  it('defers rather than silently drops an impermissible action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_offer', reason: 'Try a lower price.',
    });

    expect(action.status).toBe('deferred');
    expect(action.constraints.some((c) => c.blocking)).toBe(true);
  });

  it('records why an action was blocked', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_offer', reason: 'x',
    });

    expect(action.constraints.find((c) => c.blocking)?.description).toContain('Offer changes');
  });

  it('blocks an action that touches a locked experiment variable', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_hook', reason: 'Try a new hook.',
      touchedVariables: ['hookFamily'], lockedVariables: ['hookFamily'],
    });

    expect(action.status).toBe('deferred');
    expect(action.constraints.some((c) => c.source === 'active_experiment')).toBe(true);
  });

  it('allows an action that touches no locked variable', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'generate_content', reason: 'Draft a post.',
      touchedVariables: ['topic'], lockedVariables: ['hookFamily'],
    });

    expect(action.status).not.toBe('deferred');
  });

  it('records an approval without erasing the original proposal', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const proposed = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test the hook.',
    });

    const approved = await engine.approveAction(proposed.id, HUMAN, 'Looks right.');

    expect(approved?.status).toBe('approved');
    expect(approved?.reason).toBe('Test the hook.');
    expect(approved?.humanDecisions).toHaveLength(1);
  });

  it('appends each successive human decision', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
    });

    await engine.deferAction(action.id, HUMAN, 'Not this week.');
    const final = await engine.approveAction(action.id, HUMAN, 'Go ahead.');

    expect(final?.humanDecisions).toHaveLength(2);
    expect(final?.humanDecisions[0]?.decision).toBe('deferred');
  });

  it('records a rejection with the human reason', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
    });

    const rejected = await engine.rejectAction(action.id, HUMAN, 'Off brand.');

    expect(rejected?.status).toBe('rejected');
    expect(rejected?.humanDecisions[0]?.reason).toBe('Off brand.');
  });

  it('returns a revision request to proposed rather than approving it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
    });

    const revised = await engine.requestRevision(action.id, HUMAN, 'Narrow the scope.');

    expect(revised?.status).toBe('proposed');
    expect(revised?.approvedAt).toBeUndefined();
  });

  it('logs every human decision as a human_override change record', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
    });
    await engine.rejectAction(action.id, HUMAN, 'No.');

    const log = await engine.getChangeLog(agent.id);
    expect(log.some((r) => r.changeType === 'human_override')).toBe(true);
  });

  it('expires a stale action instead of deleting it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
      expiresAt: '2026-08-19T00:00:00Z',
    });

    const expired = await engine.expireStaleActions(agent.id);

    expect(expired.map((a) => a.id)).toContain(action.id);
    expect((await store.getAgentAction(action.id))?.status).toBe('expired');
  });

  it('leaves an unexpired action alone', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
      expiresAt: '2026-12-31T00:00:00Z',
    });

    expect(await engine.expireStaleActions(agent.id)).toHaveLength(0);
  });

  it('returns null when deciding on an action that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).approveAction('nope', HUMAN)).toBeNull();
  });

  it('sorts the queue by priority, highest first', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.proposeAction({ agentId: agent.id, actionType: 'generate_content', reason: 'low', priority: 0.2 });
    await engine.proposeAction({ agentId: agent.id, actionType: 'generate_content', reason: 'high', priority: 0.9 });

    const queue = await store.listAgentActions({ agentId: agent.id });
    expect(queue[0]?.reason).toBe('high');
  });
});

/* ======================================================================
 * AUTONOMY BOUNDARIES (§42)
 * =================================================================== */

describe('Agentic — autonomy boundaries', () => {
  it('refuses to let the agent raise its own autonomy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const result = await engine.setAutonomyLevel({
      agentId: agent.id, level: 'autonomous_lab', actor: { kind: 'agent', id: agent.id }, reason: 'I am ready.',
    });

    expect(result.ok).toBe(false);
  });

  it('leaves the stored autonomy untouched after a refused self-promotion', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.setAutonomyLevel({
      agentId: agent.id, level: 'autonomous_lab', actor: { kind: 'agent', id: agent.id }, reason: 'x',
    });

    expect((await store.getAgent(agent.id))?.autonomyLevel).toBe('copilot');
  });

  it('lets a human change autonomy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const result = await engine.setAutonomyLevel({
      agentId: agent.id, level: 'operator', actor: HUMAN, reason: 'Trust established.',
    });

    expect(result.ok).toBe(true);
  });

  it('syncs the permission policy when a human changes autonomy', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.setAutonomyLevel({ agentId: agent.id, level: 'operator', actor: HUMAN, reason: 'ok' });

    expect((await engine.getPermissionPolicy(agent.id)).autonomyLevel).toBe('operator');
  });

  it('logs an autonomy change to the change log', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.setAutonomyLevel({ agentId: agent.id, level: 'operator', actor: HUMAN, reason: 'ok' });

    const log = await engine.getChangeLog(agent.id);
    expect(log.some((r) => r.changeType === 'autonomy_changed' && r.after === 'operator')).toBe(true);
  });

  it('types spend and offer permissions so they can never be enabled', () => {
    const policy = defaultPermissionPolicy('agent_1', NOW);
    expect(policy.spendActionsAllowed).toBe(false);
    expect(policy.offerChangesAllowed).toBe(false);
  });

  it('reports an error naming the actor requirement', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.setAutonomyLevel({
      agentId: agent.id, level: 'operator', actor: { kind: 'system' }, reason: 'x',
    });

    expect(result.ok === false && result.error).toContain('human');
  });
});

/* ======================================================================
 * CREATOROS HANDOFF
 * =================================================================== */

describe('Agentic — CreatorOS handoff', () => {
  async function approvedAction(store: JsonlIntelligenceStore, profileId: string) {
    const { engine, agent } = await seedAgent(store, profileId);
    await setPolicy(store, agent.id, { schedulingAllowed: true, experimentExecutionAllowed: true });
    const action = await engine.proposeAction({
      agentId: agent.id, profileId, actionType: 'approve_content', reason: 'Schedule the post.',
    });
    await engine.approveAction(action.id, HUMAN);
    return { engine, agent, action };
  }

  it('refuses to hand off an unapproved action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await setPolicy(store, agent.id, { schedulingAllowed: true });
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'approve_content', reason: 'Schedule.',
    });

    const result = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });

    expect(result.ok).toBe(false);
  });

  it('refuses to hand off when permissions do not cover the action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test.',
    });
    await engine.approveAction(action.id, HUMAN);

    const result = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'publish_post',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('permissions');
  });

  it('prepares a handoff for an approved, permitted action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, action } = await approvedAction(store, profile.id);

    const result = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });

    expect(result.ok).toBe(true);
  });

  it('moves the action to queued once handed off', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, action } = await approvedAction(store, profile.id);
    await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });

    expect((await store.getAgentAction(action.id))?.status).toBe('queued');
  });

  it('never publishes itself — the handoff only records intent', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, action } = await approvedAction(store, profile.id);
    const result = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });

    expect(result.ok && result.handoff.status).toBe('prepared');
    expect(result.ok && result.handoff.creatorOsPostId).toBeUndefined();
  });

  it('records a successful execution result and completes the action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, action } = await approvedAction(store, profile.id);
    const prepared = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });
    if (!prepared.ok) throw new Error('handoff failed');

    await engine.recordExecutionResult({
      handoffId: prepared.handoff.id, status: 'succeeded', creatorOsPostId: 'post_9',
      measurementRefs: ['meas_1'],
    });

    const updated = await store.getAgentAction(action.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.resultRefs).toEqual(['meas_1']);
  });

  it('records a failed execution without losing the action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, action } = await approvedAction(store, profile.id);
    const prepared = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });
    if (!prepared.ok) throw new Error('handoff failed');

    await engine.recordExecutionResult({ handoffId: prepared.handoff.id, status: 'failed' });

    const updated = await store.getAgentAction(action.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.failedAt).toBe(NOW);
  });

  it('links the handoff back to its originating action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, action } = await approvedAction(store, profile.id);
    const prepared = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });

    expect(prepared.ok && prepared.handoff.agentActionId).toBe(action.id);
  });

  it('never hands off a restricted action even once approved', () => {
    const result = canHandOffToCreatorOs({
      actionStatus: 'approved',
      actionType: 'test_offer',
      riskClass: 'restricted',
      policy: { ...defaultPermissionPolicy('a', NOW), schedulingAllowed: true } as AgentPermissionPolicy,
    });
    expect(result.allowed).toBe(false);
  });

  it('returns an error for a handoff on a missing action', async () => {
    const store = await tmpStore();
    const result = await engineWith(store).prepareCreatorOsHandoff({
      actionId: 'nope', profileId: 'p', creatorOsAccountId: 'a', platform: 'threads', executionType: 'schedule_post',
    });
    expect(result.ok).toBe(false);
  });

  it('returns null when recording a result for a missing handoff', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).recordExecutionResult({ handoffId: 'nope', status: 'succeeded' })).toBeNull();
  });
});

/* ======================================================================
 * LIVING PRESCRIPTION
 * =================================================================== */

describe('Agentic — living prescription', () => {
  it('builds a first prescription at version 1', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.version).toBe(1);
    expect(rx?.status).toBe('active');
  });

  it('reports cold_start maturity with no evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.personalizationMaturity).toBe('cold_start');
  });

  it('reports transferred_intelligence when only peer evidence exists', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveTransferAssessment(transfer(profile.id));
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.personalizationMaturity).toBe('transferred_intelligence');
  });

  it('reports profile_informed once several first-party findings validate', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    await store.saveFinding(finding(profile.id));
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.personalizationMaturity).toBe('profile_informed');
  });

  it('supersedes the prior version rather than overwriting it', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const first = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    const second = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(second?.version).toBe(2);
    expect(second?.supersedesPrescriptionId).toBe(first?.id);
    expect((await store.getLivingPrescription(first!.id))?.status).toBe('superseded');
  });

  it('keeps every version readable in history', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const history = await engine.getPrescriptionHistory(agent.id);
    expect(history.map((p) => p.version)).toEqual([1, 2]);
  });

  it('records which evidence was added between versions', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const f = finding(profile.id);
    await store.saveFinding(f);
    const second = await engine.buildLivingPrescription({
      agentId: agent.id, profileId: profile.id, reason: 'New finding.',
    });

    expect(second!.changeSummary!.evidenceAdded).toContain(f.id);
  });

  it('records the reason for a rebuild', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({
      agentId: agent.id, profileId: profile.id, reason: 'Mission changed.', triggers: ['mission_change'],
    });

    expect(rx!.changeSummary!.reason).toBe('Mission changed.');
    expect(rx!.changeSummary!.triggers).toContain('mission_change');
  });

  it('flags an evidence-free platform as an experiment, not a recommendation', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const threads = rx?.platformStrategy.find((p) => p.platform === 'threads');
    expect(threads?.testRequired).toBe(true);
    expect(threads?.role).toBe('experimental');
    expect(threads?.evidenceState).toBe('unknown');
  });

  it('promotes a platform to primary once it carries validated evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id, { platform: 'threads' }));
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.platformStrategy.find((p) => p.platform === 'threads')?.role).toBe('primary');
  });

  it('says cadence comes from stated capacity, not evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.cadenceStrategy.fromStatedCapacityOnly).toBe(true);
    expect(rx?.cadenceStrategy.evidenceState).toBe('unknown');
  });

  it('treats the declared audience as unconfirmed until segments are observed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.audienceStrategy.evidenceState).toBe('unknown');
    expect(rx?.audienceStrategy.unknownSegmentNote).toContain('unconfirmed');
  });

  it('keeps the declared audience separate from observed segments', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveObservedSegment(segment(profile.id));
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.audienceStrategy.declaredAudience).toContain('Solo operators');
    expect(rx?.audienceStrategy.observedSegmentIds).toEqual(['seg_1']);
  });

  it('carries a rejected finding into avoidance guidance', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const f = finding(profile.id, { status: 'rejected' });
    await store.saveFinding(f);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.avoidanceGuidance.some((a) => a.evidenceRefs.findingIds.includes(f.id))).toBe(true);
  });

  it('carries a contraindicated transfer into avoidance guidance', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const t = transfer(profile.id, { relevance: 'contraindicated' });
    await store.saveTransferAssessment(t);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.avoidanceGuidance.some((a) => a.evidenceRefs.transferAssessmentIds.includes(t.id))).toBe(true);
  });

  it('states its unknowns explicitly rather than filling gaps with confident advice', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.unknowns.length).toBeGreaterThan(0);
    expect(rx?.unknowns[0]?.howToResolve).toBeTruthy();
  });

  it('carries open hypotheses into the experiment plan', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const h = hypothesis(profile.id);
    await store.saveHypothesis(h);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.experimentPlan.map((e) => e.hypothesisId)).toContain(h.id);
  });

  it('points the agent at its newest prescription', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect((await store.getAgent(agent.id))?.currentPrescriptionId).toBe(rx?.id);
  });

  it('returns null when building for an agent that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).buildLivingPrescription({ agentId: 'nope', profileId: 'p' })).toBeNull();
  });

  it('logs a prescription rebuild to the change log', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const log = await engine.getChangeLog(agent.id);
    expect(log.some((r) => r.changeType === 'prescription_changed')).toBe(true);
  });
});

/* ======================================================================
 * PRESCRIPTION REFRESH
 * =================================================================== */

describe('Agentic — prescription refresh', () => {
  it('requires a refresh when no prescription exists', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);

    const assessment = await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id });
    expect(assessment.verdict).toBe('refresh_required');
  });

  it('reports current when nothing has changed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const assessment = await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id });
    expect(assessment.verdict).toBe('current');
  });

  it('requires a refresh after a significant new finding', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    await store.saveFinding(finding(profile.id));

    const assessment = await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id });
    expect(assessment.verdict).toBe('refresh_required');
    expect(assessment.triggers).toContain('significant_new_finding');
  });

  it('requires a refresh when the mission changed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const assessment = await engine.assessPrescriptionRefresh({
      agentId: agent.id, profileId: profile.id, missionChanged: true,
    });
    expect(assessment.verdict).toBe('refresh_required');
  });

  it('requires a refresh when the offer changed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const assessment = await engine.assessPrescriptionRefresh({
      agentId: agent.id, profileId: profile.id, offerChanged: true,
    });
    expect(assessment.triggers).toContain('offer_change');
  });

  it('only recommends a refresh for a completed experiment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const assessment = await engine.assessPrescriptionRefresh({
      agentId: agent.id, profileId: profile.id, experimentCompleted: true,
    });
    expect(assessment.verdict).toBe('refresh_recommended');
  });

  it('detects an audience shift', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    await store.saveObservedSegment(segment(profile.id));

    const assessment = await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id });
    expect(assessment.triggers).toContain('audience_shift');
  });

  it('gives a human-readable reason for every trigger', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const assessment = await engine.assessPrescriptionRefresh({
      agentId: agent.id, profileId: profile.id, missionChanged: true, offerChanged: true,
    });
    expect(assessment.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates repeated triggers', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    await store.saveFinding(finding(profile.id));
    await store.saveFinding(finding(profile.id));

    const assessment = await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id });
    expect(assessment.triggers.filter((t) => t === 'significant_new_finding')).toHaveLength(1);
  });
});

/* ======================================================================
 * DECISION CYCLE
 * =================================================================== */

describe('Agentic — decision cycle', () => {
  it('runs a cycle and records when it ran', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.ranAt).toBe(NOW);
  });

  it('diagnoses insufficient evidence on a cold-start profile', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.diagnostics.map((d) => d.code)).toContain('insufficient_evidence');
  });

  it('diagnoses a missing observed audience', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.diagnostics.map((d) => d.code)).toContain('audience_divergence');
  });

  it('diagnoses missing attribution rather than inventing revenue', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.diagnostics.map((d) => d.code)).toContain('attribution_unavailable');
  });

  it('diagnoses a locked experiment when variables are held', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({
      agentId: agent.id, profileId: profile.id, lockedVariables: ['hookFamily'],
    });

    expect(result?.diagnostics.map((d) => d.code)).toContain('experiment_incomplete');
  });

  it('answers a cold start by gathering evidence, not by giving confident advice', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    const proposed = await Promise.all((result?.proposedActionIds ?? []).map((id) => store.getAgentAction(id)));
    expect(proposed.map((a) => a?.actionType)).toEqual(['collect_more_evidence']);
  });

  it('consumes Adaptive Strategy rather than deriving its own next actions', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });
    const action = await store.getAgentAction(result!.proposedActionIds[0]!);

    // Every proposed action traces back to a StrategyRecommendation id.
    expect(action?.evidenceRefs.strategyRecommendationIds).toHaveLength(1);
  });

  it('is willing to conclude that no action is needed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AgenticPrescriptionEngine(store, {
      now: fixedNow,
      // An Adaptive Strategy that recommends nothing — the agent must not
      // invent work to fill the silence.
      adaptiveEngine: {
        buildAdaptiveStrategyPlan: async () => null,
        evaluateStrategyConstraints: async () => [],
      } as never,
    });
    const agent = await engine.createAgent({ profileIds: [profile.id] });
    await engine.createMission({ agentId: agent.id, statement: 'Leads', primaryObjective: 'lead' });

    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.proposedActionIds).toHaveLength(0);
    expect(result?.diagnostics.map((d) => d.code)).toContain('no_action_needed');
    expect(result?.decisionSummary).toContain('Waiting for evidence is the correct move');
  });

  it('blocks a recommendation that collides with a locked experiment variable', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const engine = new AgenticPrescriptionEngine(store, {
      now: fixedNow,
      adaptiveEngine: {
        evaluateStrategyConstraints: async () => [],
        buildAdaptiveStrategyPlan: async () => ({
          recommendations: [{
            id: 'rec_1', action: 'adjust_content_mix', reason: 'Shift the mix.', priorityScore: 0.8,
            basis: { findingIds: [], segmentFindingIds: [], experimentIds: [], hypothesisIds: [] },
          }],
        }),
      } as never,
    });
    const agent = await engine.createAgent({ profileIds: [profile.id] });
    await engine.createMission({ agentId: agent.id, statement: 'Leads', primaryObjective: 'lead' });
    // Permit the change, so the running experiment is the only thing stopping it.
    await setPolicy(store, agent.id, { strategyAllocationChangesAllowed: true });

    const result = await engine.runDecisionCycle({
      agentId: agent.id, profileId: profile.id, lockedVariables: ['hookFamily'],
    });

    expect(result?.proposedActionIds).toHaveLength(0);
    expect(result?.blockedActions[0]?.reason).toContain('perturb');
  });

  it('includes the evidence state summary in the cycle result', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.evidenceStateSummary.know).toBe(1);
  });

  it('includes a prescription refresh assessment', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const result = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(result?.prescriptionRefresh.verdict).toBe('refresh_required');
  });

  it('stamps the agent with its last decision time', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect((await store.getAgent(agent.id))?.lastDecisionAt).toBe(NOW);
  });

  it('is deterministic — the same state produces the same diagnostics', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const a = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });
    const b = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(a?.diagnostics).toEqual(b?.diagnostics);
  });

  it('returns null for an agent that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).runDecisionCycle({ agentId: 'nope', profileId: 'p' })).toBeNull();
  });
});

/* ======================================================================
 * BUSINESS OUTCOMES
 * =================================================================== */

describe('Agentic — business outcomes', () => {
  it('reports no outcomes and refuses to infer revenue', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const state = await engineWith(store).getBusinessOutcomeState(profile.id);

    expect(state.revenue).toBe(0);
    expect(state.attributionQuality).toBe('none');
    expect(state.unattributedNote).toContain('never inferred');
  });

  it('counts first-party leads', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveAttributionEvent(attribution(profile.id));
    const state = await engineWith(store).getBusinessOutcomeState(profile.id);

    expect(state.leads).toBe(1);
  });

  it('counts purchases and their revenue', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveAttributionEvent(attribution(profile.id, {
      eventType: 'purchase', value: 250, currency: 'USD',
    }));
    const state = await engineWith(store).getBusinessOutcomeState(profile.id);

    expect(state.sales).toBe(1);
    expect(state.revenue).toBe(250);
    expect(state.currency).toBe('USD');
  });

  it('flags partial attribution rather than presenting it as clean', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveAttributionEvent(attribution(profile.id));
    await store.saveAttributionEvent(attribution(profile.id, { attributionMethod: 'unknown' }));
    const state = await engineWith(store).getBusinessOutcomeState(profile.id);

    expect(state.attributionQuality).toBe('partial');
    expect(state.unattributedNote).toContain('1 of 2');
  });

  it('reports unknown quality when nothing is attributable', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveAttributionEvent(attribution(profile.id, { attributionMethod: 'unknown' }));
    const state = await engineWith(store).getBusinessOutcomeState(profile.id);

    expect(state.attributionQuality).toBe('unknown');
    expect(state.evidenceState).toBe('suspect');
  });

  it('reaches know only with good attribution', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveAttributionEvent(attribution(profile.id));
    const state = await engineWith(store).getBusinessOutcomeState(profile.id);

    expect(state.evidenceState).toBe('know');
  });
});

/* ======================================================================
 * AGENT STATE AND TODAY'S PLAN
 * =================================================================== */

describe('Agentic — agent state', () => {
  it('summarizes the current operating picture', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const state = await engine.buildAgentState(agent.id, profile.id);

    expect(state?.autonomyLevel).toBe('copilot');
    expect(state?.mission?.primaryObjective).toBe('lead');
  });

  it('surfaces the highest-priority open action as next best', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.proposeAction({ agentId: agent.id, actionType: 'generate_content', reason: 'low', priority: 0.1 });
    const high = await engine.proposeAction({
      agentId: agent.id, actionType: 'generate_content', reason: 'high', priority: 0.95,
    });

    const state = await engine.buildAgentState(agent.id, profile.id);
    expect(state?.nextBestActionId).toBe(high.id);
  });

  it('lists actions waiting on the human', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, actionType: 'run_experiment', reason: 'Test.',
    });

    const state = await engine.buildAgentState(agent.id, profile.id);
    expect(state?.pendingApprovalActionIds).toContain(action.id);
  });

  it('quantifies the decision load the agent absorbed', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.proposeAction({ agentId: agent.id, actionType: 'wait_for_evidence', reason: 'Wait.' });

    const state = await engine.buildAgentState(agent.id, profile.id);
    expect(state?.decisionLoad.actionsPrepared).toBeGreaterThan(0);
    expect(state?.decisionLoad.decisionsDeferredForEvidence).toBe(1);
  });

  it('surfaces blockers with their reasons', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.proposeAction({ agentId: agent.id, actionType: 'test_offer', reason: 'Try it.' });

    const state = await engine.buildAgentState(agent.id, profile.id);
    expect(state?.blockers.some((b) => b.includes('Offer changes'))).toBe(true);
  });

  it('returns null for an agent that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).buildAgentState('nope', 'p')).toBeNull();
  });
});

describe('Agentic — today\'s plan', () => {
  it('says plainly when there is nothing to do', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });

    expect(plan?.noActionRecommended).toBe(true);
    expect(plan?.summary).toContain('Nothing to do');
  });

  it('lists the actions ready for today', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.proposeAction({ agentId: agent.id, actionType: 'generate_content', reason: 'Draft.' });

    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });
    expect(plan?.actions).toHaveLength(1);
    expect(plan?.noActionRecommended).toBe(false);
  });

  it('names which actions need approval', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, actionType: 'run_experiment', reason: 'Test.',
    });

    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });
    expect(plan?.approvalsRequired).toContain(action.id);
  });

  it('carries the mission statement so the plan is legible on its own', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });

    expect(plan?.missionStatement).toContain('10 qualified leads');
  });

  it('emits pattern-level briefs, never finished copy presented as evidence', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });
    expect(plan?.contentBriefs.length).toBeGreaterThan(0);
    expect(plan?.contentBriefs[0]?.notes).toContain('not evidence');
  });

  it('carries brand constraints onto each brief', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const engine = engineWith(store);
    const agent = await engine.createAgent({ profileIds: [profile.id] });
    await engine.createMission({
      agentId: agent.id, statement: 'Leads', primaryObjective: 'lead',
      brandConstraints: { topicsToAvoid: ['crypto'], toneRules: [], complianceRules: [] },
    });
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });
    expect(plan?.contentBriefs[0]?.brandConstraints).toContain('crypto');
  });

  it('returns null for an agent that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).buildTodaysPlan({ agentId: 'nope', profileId: 'p' })).toBeNull();
  });
});

/* ======================================================================
 * EXPLAINABILITY
 * =================================================================== */

describe('Agentic — explainability', () => {
  it('explains an action in terms of mission, evidence and constraints', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const f = finding(profile.id);
    await store.saveFinding(f);
    const { engine, agent, mission } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, missionId: mission.id,
      actionType: 'generate_content', reason: 'Repeat a validated hook.',
      evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: [f.id] },
    });

    const explanation = await engine.explainAgentAction(action.id);
    expect(explanation?.missionObjective).toBe('lead');
    expect(explanation?.evidenceState).toBe('know');
    expect(explanation?.reason).toBe('Repeat a validated hook.');
  });

  it('reports unknown evidence state when no evidence backs the action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'collect_more_evidence', reason: 'Find out.',
    });

    expect((await engine.explainAgentAction(action.id))?.evidenceState).toBe('unknown');
  });

  it('describes peer evidence in aggregate without naming another business', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const t = transfer(profile.id);
    await store.saveTransferAssessment(t);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment', reason: 'Test a peer pattern.',
      evidenceRefs: { ...EMPTY_EVIDENCE_REFS, transferAssessmentIds: [t.id] },
    });

    const explanation = await engine.explainAgentAction(action.id);
    expect(explanation?.peerEvidenceNote).toContain('No other business is identified');
  });

  it('omits the peer note when only first-party evidence is involved', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const f = finding(profile.id);
    await store.saveFinding(f);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'generate_content', reason: 'Repeat.',
      evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: [f.id] },
    });

    expect((await engine.explainAgentAction(action.id))?.peerEvidenceNote).toBeUndefined();
  });

  it('lists the constraints that applied to the action', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_offer', reason: 'Try it.',
    });

    expect((await engine.explainAgentAction(action.id))?.constraints.length).toBeGreaterThan(0);
  });

  it('returns null for an action that does not exist', async () => {
    const store = await tmpStore();
    expect(await engineWith(store).explainAgentAction('nope')).toBeNull();
  });
});

/* ======================================================================
 * EXPORT
 * =================================================================== */

describe('Agentic — prescription export', () => {
  it('exports the current prescription as a serializable snapshot', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const exported = await engine.getPrescriptionExport(agent.id);
    expect(exported?.missionStatement).toContain('10 qualified leads');
    expect(() => JSON.stringify(exported)).not.toThrow();
  });

  it('carries the peer-evidence note into every export', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect((await engine.getPrescriptionExport(agent.id))?.peerEvidenceNote).toContain('aggregate');
  });

  it('carries unknowns into the export rather than hiding them', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect((await engine.getPrescriptionExport(agent.id))?.unknowns.length).toBeGreaterThan(0);
  });

  it('recomputes the evidence tally from the prescription it exports', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await store.saveFinding(finding(profile.id));
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect((await engine.getPrescriptionExport(agent.id))?.evidenceStateSummary.know).toBe(1);
  });

  it('returns null when there is nothing to export', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { agent, engine } = await seedAgent(store, profile.id);
    expect(await engine.getPrescriptionExport(agent.id)).toBeNull();
  });
});

/* ======================================================================
 * CHANGE LOG
 * =================================================================== */

describe('Agentic — change log', () => {
  it('records a change with its reason and actor', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.recordChange({
      agentId: agent.id, changeType: 'strategy_stopped', summary: 'Shifted the mix.',
      reason: 'New evidence.', actor: { kind: 'agent', id: agent.id },
    });

    const log = await engine.getChangeLog(agent.id);
    expect(log.some((r) => r.reason === 'New evidence.')).toBe(true);
  });

  it('returns the log oldest first', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent, mission } = await seedAgent(store, profile.id);
    await engine.updateMission(mission.id, { statement: 'New.' }, HUMAN);
    await engine.setAutonomyLevel({ agentId: agent.id, level: 'operator', actor: HUMAN, reason: 'ok' });

    const log = await engine.getChangeLog(agent.id);
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log[0]!.occurredAt <= log[log.length - 1]!.occurredAt).toBe(true);
  });

  it('never removes a change record', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    const before = (await engine.getChangeLog(agent.id)).length;
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect((await engine.getChangeLog(agent.id)).length).toBeGreaterThan(before);
  });

  it('scopes the log to one agent', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const a = await seedAgent(store, profile.id);
    const b = await seedAgent(store, profile.id);
    await a.engine.setAutonomyLevel({ agentId: a.agent.id, level: 'operator', actor: HUMAN, reason: 'ok' });

    expect(await b.engine.getChangeLog(b.agent.id)).toHaveLength(0);
  });
});

/* ======================================================================
 * CONSTRAINTS AND MATURITY HELPERS
 * =================================================================== */

describe('Agentic — mission constraints and maturity', () => {
  it('blocks a platform outside the mission scope', () => {
    const constraints = deriveMissionConstraints({
      topicsToAvoid: [], platformScope: ['threads'], proposedPlatform: 'twitter',
    });
    expect(constraints.some((c) => c.blocking && c.source === 'mission')).toBe(true);
  });

  it('does not block when the platform scope is empty', () => {
    const constraints = deriveMissionConstraints({
      topicsToAvoid: [], platformScope: [], proposedPlatform: 'twitter',
    });
    expect(constraints.some((c) => c.blocking)).toBe(false);
  });

  it('records capacity as advisory, not blocking', () => {
    const constraints = deriveMissionConstraints({ maxPostsPerDay: 2, topicsToAvoid: [], platformScope: [] });
    expect(constraints.find((c) => c.source === 'capacity')?.blocking).toBe(false);
  });

  it('records brand exclusions as a named constraint', () => {
    const constraints = deriveMissionConstraints({
      topicsToAvoid: ['politics'], platformScope: [],
    });
    expect(constraints.find((c) => c.source === 'brand')?.description).toContain('politics');
  });

  it('derives cold_start with no evidence of any kind', () => {
    expect(derivePersonalizationMaturity({
      validatedFirstPartyCount: 0, promisingFirstPartyCount: 0, experimentCount: 0,
      transferredCount: 0, genomeCount: 0,
    })).toBe('cold_start');
  });

  it('derives highly_profile_specific only with many validated findings and experiments', () => {
    expect(derivePersonalizationMaturity({
      validatedFirstPartyCount: 5, promisingFirstPartyCount: 0, experimentCount: 5,
      transferredCount: 0, genomeCount: 0,
    })).toBe('highly_profile_specific');
  });

  it('derives maturity from evidence, never from elapsed days', () => {
    const busy = derivePersonalizationMaturity({
      validatedFirstPartyCount: 5, promisingFirstPartyCount: 0, experimentCount: 5,
      transferredCount: 0, genomeCount: 0,
    });
    const quiet = derivePersonalizationMaturity({
      validatedFirstPartyCount: 0, promisingFirstPartyCount: 1, experimentCount: 0,
      transferredCount: 0, genomeCount: 0,
    });
    expect(busy).not.toBe(quiet);
  });

  it('treats a mid-experiment content-mix change as perturbing', () => {
    const result = violatesActiveExperiment({
      actionType: 'adjust_content_mix', touchedVariables: [], lockedVariables: ['hookFamily'],
    });
    expect(result.violates).toBe(true);
  });

  it('allows a content-mix change when nothing is locked', () => {
    const result = violatesActiveExperiment({
      actionType: 'adjust_content_mix', touchedVariables: [], lockedVariables: [],
    });
    expect(result.violates).toBe(false);
  });
});

/* ======================================================================
 * NO DUPLICATION, PORT DISCIPLINE, DETERMINISM
 * =================================================================== */

describe('Agentic — architecture discipline', () => {
  it('depends on the IntelligenceStore port, not the JSONL adapter', async () => {
    const fake = {
      getAgent: async () => null,
      getAgentAction: async () => null,
      getExecutionHandoff: async () => null,
      listLivingPrescriptions: async () => [],
    } as unknown as IntelligenceStore;

    const engine = new AgenticPrescriptionEngine(fake, { now: fixedNow });
    expect(await engine.buildAgentState('any', 'any')).toBeNull();
    expect(await engine.explainAgentAction('any')).toBeNull();
  });

  it('reuses the CreatorOS Platform vocabulary rather than inventing one', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.platformStrategy.map((p) => p.platform)).toEqual([profile.platform]);
  });

  it('holds only references to measurements, never copies of them', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    await setPolicy(store, agent.id, { schedulingAllowed: true });
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'approve_content', reason: 'Schedule.',
    });
    await engine.approveAction(action.id, HUMAN);
    const prepared = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'a',
      platform: 'threads', executionType: 'schedule_post',
    });
    if (!prepared.ok) throw new Error('handoff failed');
    await engine.recordExecutionResult({
      handoffId: prepared.handoff.id, status: 'succeeded', measurementRefs: ['meas_1'],
    });

    const stored = await store.getExecutionHandoff(prepared.handoff.id);
    expect(stored?.measurementRefs).toEqual(['meas_1']);
  });

  it('produces an identical prescription shape for identical state', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const { engine, agent } = await seedAgent(store, profile.id);
    const first = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    const second = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(second?.platformStrategy).toEqual(first?.platformStrategy);
    expect(second?.unknowns).toEqual(first?.unknowns);
  });

  it('persists agent actions across store instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-agentic-actions-'));
    const first = new JsonlIntelligenceStore(root);
    const profile = await seedProfile(first);
    const { engine, agent } = await seedAgent(first, profile.id);
    const action = await engine.proposeAction({
      agentId: agent.id, actionType: 'generate_content', reason: 'Draft.',
    });

    const second = new JsonlIntelligenceStore(root);
    expect((await second.getAgentAction(action.id))?.reason).toBe('Draft.');
  });
});
