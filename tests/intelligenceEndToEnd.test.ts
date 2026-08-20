/**
 * Cross-module integration tests for the Kairos intelligence layer.
 *
 * Every other intelligence suite tests one module in isolation. This one
 * chains modules together and asserts the seams hold: measurement flows into
 * Science, Science into Adaptive, Adaptive into the agent's action queue, the
 * queue into a CreatorOS handoff, and the result back into a new prescription
 * version.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT DO
 * ------------------------------------------------------------------------
 * It does not stub a chain into existence. Two links audited as absent are
 * asserted as absent rather than faked, so this file fails loudly if someone
 * later believes they are wired:
 *
 *   - The agentic layer never queries the Social Genome (audit finding H-2).
 *   - `workspaceId` does not reach any pre-Milestone-12 store (finding B-1).
 *
 * See `docs/ARCHITECTURE_AUDIT_AND_FREEZE.md`.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlIntelligenceStore } from '../src/intelligence/storage/jsonlIntelligenceStore.js';
import { onboardProfile } from '../src/intelligence/onboarding/onboardProfile.js';
import { ingestMeasurementSnapshot, ingestAttributionEvent } from '../src/intelligence/measurement/ingest.js';
import { ScienceEngine } from '../src/intelligence/science/engine.js';
import { AdaptiveStrategyEngine } from '../src/intelligence/adaptive/engine.js';
import { AgenticPrescriptionEngine } from '../src/intelligence/agentic/engine.js';
import { SocialGenomeEngine, toPublicPattern } from '../src/intelligence/genome/engine.js';
import { EMPTY_EVIDENCE_REFS } from '../src/intelligence/agentic/types.js';
import type { ActorRef, Finding, Hypothesis, TransferAssessment } from '../src/intelligence/index.js';
import type { ProfileOnboardingInput } from '../src/intelligence/onboarding/types.js';

const NOW = '2026-08-20T12:00:00Z';
const fixedNow = () => NOW;
const HUMAN: ActorRef = { kind: 'human', id: 'owner_1' };

async function tmpStore(): Promise<JsonlIntelligenceStore> {
  return new JsonlIntelligenceStore(await mkdtemp(join(tmpdir(), 'kairos-e2e-')));
}

/** The audit's running example: a bookkeeping business selling consultations. */
function bookkeeper(overrides: Partial<ProfileOnboardingInput> = {}): ProfileOnboardingInput {
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
  const result = await onboardProfile(bookkeeper(overrides), store, NOW);
  if (!result.ok) throw new Error(`onboarding failed: ${JSON.stringify(result.errors)}`);
  return result.profile;
}

/** A workspace with an agent and an active, business-objective-first mission. */
async function seedWorkspace(store: JsonlIntelligenceStore, workspaceId = 'ws_1', overrides = {}) {
  const profile = await seedProfile(store, overrides);
  const engine = new AgenticPrescriptionEngine(store, { now: fixedNow });
  const agent = await engine.createAgent({ profileIds: [profile.id], workspaceId });
  const mission = await engine.createMission({
    agentId: agent.id,
    workspaceId,
    statement: 'Generate qualified consultations from organic social media.',
    primaryObjective: 'lead',
    platformScope: ['threads'],
  });
  return { profile, engine, agent, mission };
}

let findingSeq = 0;
function validatedFinding(profileId: string, overrides: Partial<Finding> = {}): Finding {
  findingSeq += 1;
  return {
    id: `fnd_e2e_${findingSeq}`,
    statement: 'Reconciliation-pain hooks lift consultation requests.',
    scope: { level: 'profile', profileId },
    profileId,
    platform: 'threads',
    sampleSize: 30,
    confidence: 0.86,
    status: 'validated',
    objective: 'lead',
    hookFamily: 'contrarian-claim',
    contentFormat: 'text',
    sourceExperimentIds: [`exp_e2e_${findingSeq}`],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  };
}

let transferSeq = 0;
function peerTransfer(targetProfileId: string, overrides: Partial<TransferAssessment> = {}): TransferAssessment {
  transferSeq += 1;
  return {
    id: `tr_e2e_${transferSeq}`,
    candidateId: `cand_${transferSeq}`,
    findingId: `fnd_peer_${transferSeq}`,
    targetProfileId,
    sourceClass: 'matched_peer',
    relevance: 'strongly_relevant',
    similarity: {
      dimensions: [], overallSimilarity: 0.82, dimensionCoverage: 0.7,
      matchedDimensions: [], mismatchedDimensions: [], unknownDimensions: [], limitations: [],
    },
    assessmentConfidence: 0.95,
    whyItMightApply: ['Same niche, same objective.'],
    whyItMightNotApply: ['Different account stage.'],
    negativeTransferRisks: [],
    unknowns: [],
    evidenceAgeDays: 12,
    recommendation: {
      action: 'seed_hypothesis',
      reason: 'Worth testing here before relying on it.',
      proposedHypothesisStatement: 'Numbered checklists lift saves for bookkeepers.',
      priority: 0.7,
    },
    limitations: [],
    policyVersion: 'e2e',
    createdAt: NOW,
    schemaVersion: 1,
    ...overrides,
  };
}

/* ======================================================================
 * 1-2. COLD START AND MISSION
 * =================================================================== */

describe('E2E — cold start', () => {
  it('onboards a profile, creates a mission, and produces a cautious prescription', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);

    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(rx?.personalizationMaturity).toBe('cold_start');
    expect(rx?.platformStrategy.every((p) => p.testRequired)).toBe(true);
    expect(rx?.unknowns.length).toBeGreaterThan(0);
  });

  it('claims no first-party validation at cold start', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);

    const summary = await engine.getEvidenceStateSummary(profile.id);
    expect(summary.know).toBe(0);
    expect(summary.unknown).toBeGreaterThan(0);
  });

  it('keeps the mission on a business objective, not a vanity metric', async () => {
    const store = await tmpStore();
    const { engine, agent, profile, mission } = await seedWorkspace(store);
    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(mission.primaryObjective).toBe('lead');
    // The prescription's platform strategy inherits the mission objective —
    // it does not substitute reach for the thing the customer asked for.
    expect(rx?.platformStrategy[0]?.objective).toBe('lead');
  });

  it('drives Adaptive Strategy metric selection from the objective, not from engagement', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    const science = new ScienceEngine(store, { now: fixedNow });

    const leadMetrics = science.metricsForObjective('lead');
    const reachMetrics = science.metricsForObjective('reach');

    expect(leadMetrics).not.toEqual(reachMetrics);
    expect(profile.objectives.primary).toBe('lead');
  });
});

/* ======================================================================
 * 3-4. EVIDENCE CLASS SURVIVES THE CHAIN
 * =================================================================== */

describe('E2E — evidence class is preserved across modules', () => {
  it('caps highly confident peer-transferred evidence at SUSPECT', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    // Assessment confidence 0.95 — well above the first-party `know` bar.
    await store.saveTransferAssessment(peerTransfer(profile.id));

    const summary = await engine.getEvidenceStateSummary(profile.id);
    expect(summary.suspect).toBe(1);
    expect(summary.know).toBe(0);
  });

  it('promotes the profile\'s own validated finding to KNOW', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    await store.saveFinding(validatedFinding(profile.id));

    const summary = await engine.getEvidenceStateSummary(profile.id);
    expect(summary.know).toBe(1);
  });

  it('lets first-party evidence outrank peer evidence in the same prescription', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    await store.saveTransferAssessment(peerTransfer(profile.id));
    await store.saveFinding(validatedFinding(profile.id));
    await store.saveFinding(validatedFinding(profile.id));

    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    // Two validated first-party findings move maturity past transferred-only.
    expect(rx?.personalizationMaturity).toBe('profile_informed');
    expect(rx?.platformStrategy[0]?.evidenceState).toBe('know');
  });
});

/* ======================================================================
 * 5-8. ADAPTIVE -> ACTION -> APPROVAL -> HANDOFF
 * =================================================================== */

describe('E2E — Adaptive Strategy through to CreatorOS handoff', () => {
  it('turns an Adaptive recommendation into a traceable agent action', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);

    const cycle = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });
    const action = await store.getAgentAction(cycle!.proposedActionIds[0]!);

    expect(action?.evidenceRefs.strategyRecommendationIds).toHaveLength(1);
    const plan = await new AdaptiveStrategyEngine(store, { now: fixedNow }).getLatestPlan(profile.id);
    expect(plan).not.toBeNull();
  });

  it('refuses to auto-execute a restricted action even at the highest autonomy', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    await engine.setAutonomyLevel({
      agentId: agent.id, level: 'autonomous_lab', actor: HUMAN, reason: 'Full trust.',
    });

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_offer', reason: 'Drop the price.',
    });

    expect(action.riskClass).toBe('restricted');
    expect(action.requiresApproval).toBe(true);
    expect(action.status).toBe('deferred');
  });

  it('still refuses the handoff after a human approves a restricted action', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_offer', reason: 'Drop the price.',
    });
    await engine.approveAction(action.id, HUMAN, 'I want this.');

    const result = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'publish_post',
    });

    expect(result.ok).toBe(false);
  });

  it('completes approval plus permission into a linked handoff', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    const policy = await engine.getPermissionPolicy(agent.id);
    await store.saveAgentPermissionPolicy({ ...policy, schedulingAllowed: true });

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'approve_content', reason: 'Schedule it.',
    });
    await engine.approveAction(action.id, HUMAN);
    const handoff = await engine.prepareCreatorOsHandoff({
      actionId: action.id, profileId: profile.id, creatorOsAccountId: 'acct_1',
      platform: 'threads', executionType: 'schedule_post',
    });

    expect(handoff.ok).toBe(true);
    expect(handoff.ok && handoff.handoff.agentActionId).toBe(action.id);
    expect((await store.getAgentAction(action.id))?.executionHandoffId).toBe(
      handoff.ok ? handoff.handoff.id : undefined,
    );
  });

  it('preserves the agent\'s original proposal after a human overrides it', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'run_experiment',
      reason: 'Test reconciliation-pain hooks.',
    });

    const rejected = await engine.rejectAction(action.id, HUMAN, 'Wrong week for it.');

    expect(rejected?.reason).toBe('Test reconciliation-pain hooks.');
    expect(rejected?.humanDecisions[0]?.reason).toBe('Wrong week for it.');
  });
});

/* ======================================================================
 * 9-12. MEASUREMENT -> SCIENCE -> FINDING -> REFRESH
 * =================================================================== */

describe('E2E — the learning loop', () => {
  /** Ingests N real CreatorOS-shaped snapshots through the measurement module. */
  async function ingestPosts(
    store: JsonlIntelligenceStore,
    profileId: string,
    values: number[],
    prefix = 'post',
  ) {
    for (const [index, replies] of values.entries()) {
      const result = await ingestMeasurementSnapshot({
        profileId,
        creatorOsAccountId: '507f1f77bcf86cd799439011',
        creatorOsPostId: `${prefix}_${index}`,
        capturedAt: `2026-08-0${(index % 9) + 1}T10:00:00Z`,
        sourcePlatform: 'threads',
        rawMetrics: { replies, likes: replies * 3, views: replies * 40 },
      }, store);
      if (!result.ok) throw new Error(`ingest failed: ${JSON.stringify(result.errors)}`);
    }
  }

  it('carries a raw CreatorOS snapshot into a normalized observation with lineage intact', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestPosts(store, profile.id, [4]);

    const snapshots = await store.listMeasurementSnapshots({ profileId: profile.id });
    const observations = await store.listPostMeasurements({ profileId: profile.id });

    expect(snapshots).toHaveLength(1);
    expect(observations[0]?.sourceSnapshotId).toBe(snapshots[0]?.id);
  });

  it('builds a baseline from ingested measurements', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);
    await ingestPosts(store, profile.id, [2, 3, 4, 3, 2, 4]);
    const science = new ScienceEngine(store, { now: fixedNow });

    const baseline = await science.calculateProfileBaseline({ profileId: profile.id, metric: 'replies' });

    expect(baseline?.sampleSize).toBe(6);
    expect(baseline?.median).toBeGreaterThan(0);
  });

  /**
   * Drives the real chain: ingest → baseline → comparison → hypothesis
   * evidence → evaluation → finding. `treatmentReplies` controls the size of
   * the effect the treatment posts show over the baseline.
   */
  async function runScienceChain(store: JsonlIntelligenceStore, profileId: string, treatmentReplies: number) {
    await ingestPosts(store, profileId, [2, 3, 4, 3, 2, 4]);
    const science = new ScienceEngine(store, { now: fixedNow });
    const baseline = await science.calculateProfileBaseline({ profileId, metric: 'replies' });

    const hypothesis: Hypothesis = {
      id: 'hyp_e2e', statement: 'Reconciliation-pain hooks lift replies.',
      scope: { level: 'profile', profileId }, profileId,
      objective: 'lead', independentVariable: 'hookFamily', dependentMetric: 'replies',
      controlVariables: ['topic'], status: 'testing', confidence: 0.3, source: 'experiment',
      supportingExperimentIds: [], contradictingExperimentIds: [], createdAt: NOW,
    };
    await store.saveHypothesis(hypothesis);

    // Three treatment posts under their own ids, so they add to the series
    // rather than overwriting the baseline posts.
    await ingestPosts(store, profileId, [treatmentReplies, treatmentReplies, treatmentReplies], 'treatment');
    const treatment = (await science.loadObservations(profileId))
      .filter((o) => o.metric === 'replies' && o.creatorOsPostId?.startsWith('treatment_'));

    for (const observation of treatment) {
      const comparison = science.compareObservationToBaseline(observation, baseline!);
      await science.recordHypothesisEvidence({
        hypothesisId: hypothesis.id, experimentId: 'exp_e2e', profileId, comparison, supports: true,
      });
    }

    const evaluation = await science.evaluateHypothesis(hypothesis.id);
    const finding = await science.emitFinding({
      statement: hypothesis.statement,
      evaluation: evaluation!,
      context: { profileId, platform: 'threads', objective: 'lead' },
      sourceExperimentIds: ['exp_e2e'],
    });
    return { science, baseline, evaluation, finding };
  }

  it('runs measurement → comparison → hypothesis evidence → finding on a real effect', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);

    // Baseline median is 3; the treatment posts land at 12.
    const { evaluation, finding } = await runScienceChain(store, profile.id, 12);

    expect(evaluation?.supportingCount).toBe(3);
    expect(evaluation?.status).toBe('supported');
    expect(finding).not.toBeNull();
    expect(finding!.sourceExperimentIds).toContain('exp_e2e');
    expect(finding!.profileId).toBe(profile.id);
    // The emitted finding is stored, so downstream layers can read it.
    expect(await store.listFindings({ profileId: profile.id })).toHaveLength(1);
  });

  it('refuses to emit a finding when the effect is indistinguishable from baseline', async () => {
    const store = await tmpStore();
    const profile = await seedProfile(store);

    // Treatment lands at 3 — exactly the baseline median.
    const { evaluation, finding } = await runScienceChain(store, profile.id, 3);

    expect(evaluation?.supportingCount).toBe(3);
    expect(evaluation?.status).toBe('inconclusive');
    expect(finding).toBeNull();
    expect(await store.listFindings({ profileId: profile.id })).toHaveLength(0);
  });

  it('lets a real emitted finding reach the agent as KNOW', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    const { finding } = await runScienceChain(store, profile.id, 12);
    expect(finding).not.toBeNull();

    const summary = await engine.getEvidenceStateSummary(profile.id);
    const entry = summary.entries.find((e) => e.findingIds.includes(finding!.id));

    // Full chain: CreatorOS snapshot → observation → comparison → evidence →
    // evaluation → finding → the agent's evidence picture.
    expect(entry?.state).toBe('know');
    expect(entry?.origin).toBe('first_party_finding');
  });

  it('makes a new significant finding trigger a prescription refresh', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect((await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id })).verdict)
      .toBe('current');

    await store.saveFinding(validatedFinding(profile.id));

    const after = await engine.assessPrescriptionRefresh({ agentId: agent.id, profileId: profile.id });
    expect(after.verdict).toBe('refresh_required');
    expect(after.triggers).toContain('significant_new_finding');
  });

  it('retains the previous prescription version and explains the change', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    const v1 = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    const f = validatedFinding(profile.id);
    await store.saveFinding(f);
    const v2 = await engine.buildLivingPrescription({
      agentId: agent.id, profileId: profile.id,
      reason: 'A new validated finding arrived.', triggers: ['significant_new_finding'],
    });

    expect(v2!.version).toBe(2);
    expect((await store.getLivingPrescription(v1!.id))?.status).toBe('superseded');
    expect(v2!.changeSummary!.evidenceAdded).toContain(f.id);

    const log = await engine.getChangeLog(agent.id);
    const entry = log.find((r) => r.changeType === 'prescription_changed' && r.after === 'v2');
    expect(entry?.reason).toBe('A new validated finding arrived.');
  });
});

/* ======================================================================
 * 13. EXPERIMENT INTEGRITY
 * =================================================================== */

describe('E2E — active experiment integrity', () => {
  it('blocks a conflicting action while a controlled experiment holds a variable', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, actionType: 'test_hook',
      reason: 'Try a new hook family.',
      touchedVariables: ['hookFamily'], lockedVariables: ['hookFamily'],
    });

    expect(action.status).toBe('deferred');
    expect(action.constraints.some((c) => c.source === 'active_experiment' && c.blocking)).toBe(true);
  });

  it('surfaces the running experiment in the decision cycle rather than ignoring it', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);

    const cycle = await engine.runDecisionCycle({
      agentId: agent.id, profileId: profile.id, lockedVariables: ['hookFamily'],
    });

    expect(cycle?.diagnostics.map((d) => d.code)).toContain('experiment_incomplete');
  });

  /**
   * Regression test for audit fix F-1.
   *
   * The agent used to protect a running experiment only when the CALLER
   * passed `lockedVariables`. It now derives them from the experiments
   * actually in flight, so an ordinary `runDecisionCycle()` cannot
   * contaminate a controlled test.
   */
  it('derives experiment locks from stored experiments without being told', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);

    await store.saveExperiment({
      id: 'exp_inflight',
      profileId: profile.id,
      platform: 'threads',
      niche: 'bookkeeping',
      objective: 'lead',
      contentDna: {
        topic: 'reconciliation', hookFamily: 'contrarian-claim',
        format: 'text', tone: 'contrarian', lengthClass: 'short',
      },
      design: { testVariables: ['hookFamily'], controlVariable: 'topic' },
      // Published with no results yet — in flight.
      execution: { publishedAt: NOW, creatorOsPostId: 'post_live' },
      createdAt: NOW,
      updatedAt: NOW,
    });

    // No lockedVariables argument at all.
    const locks = await engine.lockedVariablesFor(profile.id);
    const cycle = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });

    expect(locks.sort()).toEqual(['hookFamily', 'topic']);
    expect(cycle?.diagnostics.map((d) => d.code)).toContain('experiment_incomplete');
  });

  it('releases the locks once the experiment carries results', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    const base = {
      id: 'exp_done', profileId: profile.id, platform: 'threads' as const, niche: 'bookkeeping',
      objective: 'lead' as const,
      contentDna: {
        topic: 'reconciliation', hookFamily: 'contrarian-claim',
        format: 'text' as const, tone: 'contrarian' as const, lengthClass: 'short' as const,
      },
      design: { testVariables: ['hookFamily'], controlVariable: 'topic' },
      execution: { publishedAt: NOW, creatorOsPostId: 'post_done' },
      createdAt: NOW, updatedAt: NOW,
    };
    await store.saveExperiment(base);
    expect(await engine.lockedVariablesFor(profile.id)).toHaveLength(2);

    await store.saveExperiment({
      ...base,
      results: { replies: 9 },
    });

    expect(await engine.lockedVariablesFor(profile.id)).toHaveLength(0);
  });
});

/* ======================================================================
 * 14. TENANT ISOLATION — what holds today, and what does not
 * =================================================================== */

describe('E2E — customer isolation', () => {
  it('keeps two customers\' agent state separate', async () => {
    const store = await tmpStore();
    const a = await seedWorkspace(store, 'ws_a');
    const b = await seedWorkspace(store, 'ws_b', { creatorOsAccountId: '507f1f77bcf86cd799439012' });

    await a.engine.buildLivingPrescription({ agentId: a.agent.id, profileId: a.profile.id });

    expect(await b.engine.getCurrentPrescription(b.agent.id)).toBeNull();
    expect(await b.engine.getChangeLog(b.agent.id)).toHaveLength(0);
  });

  it('scopes agent actions to their own agent', async () => {
    const store = await tmpStore();
    const a = await seedWorkspace(store, 'ws_a');
    const b = await seedWorkspace(store, 'ws_b', { creatorOsAccountId: '507f1f77bcf86cd799439012' });
    await a.engine.proposeAction({
      agentId: a.agent.id, profileId: a.profile.id, actionType: 'generate_content', reason: 'Draft.',
    });

    expect(await store.listAgentActions({ agentId: b.agent.id })).toHaveLength(0);
  });

  it('filters agents by workspace', async () => {
    const store = await tmpStore();
    await seedWorkspace(store, 'ws_a');
    await seedWorkspace(store, 'ws_b', { creatorOsAccountId: '507f1f77bcf86cd799439012' });

    expect(await store.listAgents({ workspaceId: 'ws_a' })).toHaveLength(1);
  });

  /**
   * AUDIT FINDING B-1, asserted rather than papered over.
   *
   * `workspaceId` exists only on Milestone 12 records. Every pre-M12 store is
   * scoped by `profileId` at best, and several list methods take no required
   * scope at all — `listFindings({})` returns every customer's findings.
   *
   * Nothing is exposed today because the intelligence layer has no HTTP
   * surface. This test exists so that stops being true loudly rather than
   * quietly: when tenant scoping is added, it should fail and be updated.
   */
  it('documents that findings are NOT workspace-scoped below Milestone 12', async () => {
    const store = await tmpStore();
    const a = await seedWorkspace(store, 'ws_a');
    const b = await seedWorkspace(store, 'ws_b', { creatorOsAccountId: '507f1f77bcf86cd799439012' });
    await store.saveFinding(validatedFinding(a.profile.id));
    await store.saveFinding(validatedFinding(b.profile.id));

    // An unscoped call returns BOTH customers' findings.
    expect(await store.listFindings({})).toHaveLength(2);
    // Isolation today comes from passing profileId, not from the store.
    expect(await store.listFindings({ profileId: a.profile.id })).toHaveLength(1);
  });
});

/* ======================================================================
 * 15. MONEY AND ATTRIBUTION
 * =================================================================== */

describe('E2E — revenue is never inferred', () => {
  it('reports zero revenue for a profile with strong engagement and no attribution', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    await ingestMeasurementSnapshot({
      profileId: profile.id, creatorOsAccountId: '507f1f77bcf86cd799439011',
      creatorOsPostId: 'viral_post', capturedAt: NOW, sourcePlatform: 'threads',
      rawMetrics: { views: 500000, likes: 40000, replies: 3000 },
    }, store);

    const outcomes = await engine.getBusinessOutcomeState(profile.id);

    expect(outcomes.revenue).toBe(0);
    expect(outcomes.sales).toBe(0);
    expect(outcomes.attributionQuality).toBe('none');
    expect(outcomes.unattributedNote).toContain('never inferred');
  });

  it('counts revenue only from first-party attribution events', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    const ingested = await ingestAttributionEvent({
      profileId: profile.id, eventType: 'purchase', occurredAt: NOW,
      value: 450, currency: 'USD', attributionMethod: 'utm', source: 'stripe',
    }, store);
    expect(ingested.ok).toBe(true);

    const outcomes = await engine.getBusinessOutcomeState(profile.id);
    expect(outcomes.revenue).toBe(450);
    expect(outcomes.evidenceState).toBe('know');
  });

  it('keeps unknown attribution unknown rather than rounding it up', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    await ingestAttributionEvent({
      profileId: profile.id, eventType: 'lead', occurredAt: NOW,
      attributionMethod: 'unknown', source: 'manual',
    }, store);

    const outcomes = await engine.getBusinessOutcomeState(profile.id);
    expect(outcomes.attributionQuality).toBe('unknown');
    expect(outcomes.evidenceState).toBe('suspect');
  });
});

/* ======================================================================
 * 16-17. "WHAT SHOULD I DO TODAY?" AND "WHY?"
 * =================================================================== */

describe('E2E — the two customer-facing questions', () => {
  it('answers "what should I do today?" honestly at cold start', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    const cycle = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });
    const plan = await engine.buildTodaysPlan({ agentId: agent.id, profileId: profile.id });

    expect(plan?.missionStatement).toContain('consultations');
    // The honest cold-start answer is to go and find out, not to advise.
    const proposed = await Promise.all(cycle!.proposedActionIds.map((id) => store.getAgentAction(id)));
    expect(proposed.map((a) => a?.actionType)).toEqual(['collect_more_evidence']);
    expect(plan?.evidenceStateSummary.know).toBe(0);
  });

  it('answers "why?" with a full evidence chain and no peer identity', async () => {
    const store = await tmpStore();
    const { engine, agent, profile, mission } = await seedWorkspace(store);
    const f = validatedFinding(profile.id);
    const t = peerTransfer(profile.id);
    await store.saveFinding(f);
    await store.saveTransferAssessment(t);

    const action = await engine.proposeAction({
      agentId: agent.id, profileId: profile.id, missionId: mission.id,
      actionType: 'generate_content', reason: 'Repeat the validated hook.',
      evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: [f.id], transferAssessmentIds: [t.id] },
    });

    const why = await engine.explainAgentAction(action.id);

    expect(why?.missionObjective).toBe('lead');
    expect(why?.evidenceState).toBe('know');
    expect(why?.evidenceRefs.findingIds).toContain(f.id);
    expect(why?.peerEvidenceNote).toContain('No other business is identified');
    // The explanation never carries a peer profile id.
    expect(JSON.stringify(why)).not.toContain('fnd_peer_');
  });

  it('keeps contradictory evidence visible instead of resolving it away', async () => {
    const store = await tmpStore();
    const { engine, profile } = await seedWorkspace(store);
    await store.saveFinding(validatedFinding(profile.id, { statement: 'Long posts convert.' }));
    await store.saveFinding(validatedFinding(profile.id, {
      statement: 'Long posts convert.', status: 'rejected',
    }));

    const summary = await engine.getEvidenceStateSummary(profile.id);

    // Both readings survive: one as KNOW, one as STOPPED. Neither is deleted.
    expect(summary.know).toBe(1);
    expect(summary.stopped).toBe(1);
  });
});

/* ======================================================================
 * 18-19. GENOME: PRIVACY HOLDS, WIRING DOES NOT
 * =================================================================== */

describe('E2E — Social Genome', () => {
  it('hides private ids in the public read model', async () => {
    const store = await tmpStore();
    const genome = new SocialGenomeEngine(store, { now: fixedNow });
    const pattern = await genome.upsertPattern({
      statement: 'Checklist formats lift saves for bookkeepers.',
      context: { platforms: ['threads'], niches: ['bookkeeping'], objectives: ['lead'] },
      supportingEvidence: [{
        id: 'gev_1', evidenceType: 'finding', recordId: 'fnd_private_1', direction: 'supporting',
        profileId: 'prof_private_1', experimentId: 'exp_private_1', lineageRoots: ['exp_private_1'],
        recordedAt: NOW, observedAt: NOW, limitations: [],
      }],
    });

    const publicView = toPublicPattern(pattern);
    const serialized = JSON.stringify(publicView);

    expect(publicView.sourceProfileCount).toBe(1);
    expect(serialized).not.toContain('prof_private_1');
    expect(serialized).not.toContain('exp_private_1');
    expect(serialized).not.toContain('fnd_private_1');
  });

  /**
   * AUDIT FINDING H-2, asserted rather than faked.
   *
   * `SocialGenomeEngine` is never constructed outside its own tests. The
   * agentic layer threads `genomePatternIds` through every type and always
   * leaves it empty, and `derivePersonalizationMaturity` receives a hardcoded
   * `genomeCount: 0`. Cross-profile knowledge therefore cannot currently
   * reach a customer's prescription.
   *
   * This test pins the gap so it fails when the wiring lands.
   */
  it('documents that Genome knowledge does NOT yet reach the agent', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    const genome = new SocialGenomeEngine(store, { now: fixedNow });
    await genome.upsertPattern({
      statement: 'Checklist formats lift saves for bookkeepers.',
      context: { platforms: ['threads'], niches: ['bookkeeping'], objectives: ['lead'] },
      supportingEvidence: Array.from({ length: 6 }, (_, i) => ({
        id: `gev_${i}`, evidenceType: 'finding' as const, recordId: `fnd_${i}`,
        direction: 'supporting' as const, profileId: `prof_${i}`, experimentId: `exp_${i}`,
        lineageRoots: [`exp_${i}`], recordedAt: NOW, observedAt: NOW, limitations: [],
      })),
    });

    const rx = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    const summary = await engine.getEvidenceStateSummary(profile.id);

    // A well-replicated Genome pattern exists in the same store, and the
    // agent's prescription is unaffected by it.
    expect(await store.listGenomePatterns({})).toHaveLength(1);
    expect(rx?.personalizationMaturity).toBe('cold_start');
    expect(summary.entries.every((e) => e.genomePatternIds.length === 0)).toBe(true);
  });
});

/* ======================================================================
 * 20. DETERMINISM
 * =================================================================== */

describe('E2E — determinism', () => {
  it('produces an identical prescription shape from identical state', async () => {
    const store = await tmpStore();
    const { engine, agent, profile } = await seedWorkspace(store);
    await store.saveFinding(validatedFinding(profile.id));

    const first = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });
    const second = await engine.buildLivingPrescription({ agentId: agent.id, profileId: profile.id });

    expect(second?.platformStrategy).toEqual(first?.platformStrategy);
    expect(second?.contentStrategy).toEqual(first?.contentStrategy);
    expect(second?.unknowns).toEqual(first?.unknowns);
    expect(second?.audienceStrategy).toEqual(first?.audienceStrategy);
  });

  it('produces identical diagnostics from two separate stores with the same seed', async () => {
    const build = async () => {
      const store = await tmpStore();
      const { engine, agent, profile } = await seedWorkspace(store);
      await store.saveFinding(validatedFinding(profile.id, { id: 'fnd_fixed' }));
      const cycle = await engine.runDecisionCycle({ agentId: agent.id, profileId: profile.id });
      return cycle!.diagnostics.map((d) => d.code);
    };

    expect(await build()).toEqual(await build());
  });
});
