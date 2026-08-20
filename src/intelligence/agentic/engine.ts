/**
 * The Agentic Social Prescription engine.
 *
 * Orchestrates the persistent per-customer agent through:
 *
 *   OBSERVE -> DIAGNOSE -> HYPOTHESIZE -> DECIDE -> PROPOSE ->
 *   APPROVE/EXECUTE -> MEASURE -> LEARN -> ADAPT
 *
 * It ORCHESTRATES. It does not re-derive evidence: Science evaluates,
 * Adaptive Strategy recommends, Transfer judges applicability, the Genome
 * supplies candidate knowledge, Measurement stores observations, and
 * CreatorOS executes. This layer holds mission, state, queue, approvals and
 * the living prescription.
 *
 * The core cycle is deterministic — no LLM anywhere in it.
 *
 * Depends only on the `IntelligenceStore` port.
 */
import { randomUUID } from 'node:crypto';
import type { GrowthObjective, IsoDateTime, Platform } from '../common/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import { AdaptiveStrategyEngine } from '../adaptive/engine.js';
import { ScienceEngine } from '../science/engine.js';
import {
  canHandOffToCreatorOs,
  classifyActionRisk,
  deriveMissionConstraints,
  derivePersonalizationMaturity,
  deriveEvidenceState,
  isActionPermitted,
  requiresApproval,
  violatesActiveExperiment,
} from './policy.js';
import {
  EMPTY_EVIDENCE_REFS,
  defaultPermissionPolicy,
  type ActionConstraint,
  type ActorRef,
  type AgentAction,
  type AgentActionExplanation,
  type AgentActionType,
  type AgentChangeRecord,
  type AgentChangeType,
  type AgentDecisionCycleResult,
  type AgentDiagnostic,
  type AgentEvidenceRefs,
  type AgentMission,
  type AgentPermissionPolicy,
  type AgentState,
  type AutonomyLevel,
  type BusinessOutcomeState,
  type ContentBrief,
  type CreatorOsExecutionHandoff,
  type DecisionLoadSummary,
  type EvidenceStateEntry,
  type EvidenceStateSummary,
  type LivingSocialPrescription,
  type PlatformAllocation,
  type PrescriptionExport,
  type PrescriptionRefreshAssessment,
  type PrescriptionRefreshTrigger,
  type SocialIntelligenceAgent,
  type TodaysPlan,
} from './types.js';

export interface AgenticEngineOptions {
  readonly now?: () => IsoDateTime;
  readonly scienceEngine?: ScienceEngine;
  readonly adaptiveEngine?: AdaptiveStrategyEngine;
}

/** Peer evidence is always described, never identified. */
const PEER_EVIDENCE_NOTE =
  'Where comparable-profile evidence contributed, it is summarized in aggregate. No other business is identified.';

export class AgenticPrescriptionEngine {
  private readonly now: () => IsoDateTime;
  private readonly science: ScienceEngine;
  private readonly adaptive: AdaptiveStrategyEngine;

  constructor(
    private readonly store: IntelligenceStore,
    options: AgenticEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.science = options.scienceEngine ?? new ScienceEngine(store, { now: this.now });
    this.adaptive =
      options.adaptiveEngine ?? new AdaptiveStrategyEngine(store, { now: this.now, scienceEngine: this.science });
  }

  /* ---- Agent and mission ------------------------------------------- */

  /** Creates an agent. Defaults to `copilot` — never `autonomous_lab`. */
  async createAgent(input: {
    readonly id?: string;
    readonly workspaceId?: string;
    readonly profileIds: readonly string[];
    readonly autonomyLevel?: AutonomyLevel;
  }): Promise<SocialIntelligenceAgent> {
    const now = this.now();
    const agent: SocialIntelligenceAgent = {
      id: input.id ?? `agent_${randomUUID()}`,
      workspaceId: input.workspaceId,
      profileIds: input.profileIds,
      status: 'onboarding',
      autonomyLevel: input.autonomyLevel ?? 'copilot',
      activeExperimentIds: [],
      pendingActionIds: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
      schemaVersion: 1,
    };
    await this.store.saveAgent(agent);
    await this.store.saveAgentPermissionPolicy(defaultPermissionPolicy(agent.id, now, input.workspaceId));
    return agent;
  }

  /**
   * Changes autonomy. Requires a HUMAN actor — the agent cannot raise its
   * own latitude, which is the §42 guarantee made concrete.
   */
  async setAutonomyLevel(input: {
    readonly agentId: string;
    readonly level: AutonomyLevel;
    readonly actor: ActorRef;
    readonly reason: string;
  }): Promise<{ ok: true; agent: SocialIntelligenceAgent } | { ok: false; error: string }> {
    if (input.actor.kind !== 'human') {
      return { ok: false, error: 'Only a human actor may change an agent\'s autonomy level.' };
    }
    const agent = await this.store.getAgent(input.agentId);
    if (!agent) return { ok: false, error: `No agent "${input.agentId}".` };

    const now = this.now();
    const updated: SocialIntelligenceAgent = {
      ...agent, autonomyLevel: input.level, updatedAt: now, version: agent.version + 1,
    };
    await this.store.saveAgent(updated);

    const policy = await this.getPermissionPolicy(agent.id);
    await this.store.saveAgentPermissionPolicy({ ...policy, autonomyLevel: input.level, updatedAt: now });
    await this.recordChange({
      agentId: agent.id, workspaceId: agent.workspaceId, changeType: 'autonomy_changed',
      summary: `Autonomy changed from ${agent.autonomyLevel} to ${input.level}.`,
      before: agent.autonomyLevel, after: input.level, reason: input.reason, actor: input.actor,
    });
    return { ok: true, agent: updated };
  }

  /** Creates a mission. Business-objective-first; platform scope may be empty (all in scope). */
  async createMission(input: {
    readonly agentId: string;
    readonly workspaceId?: string;
    readonly statement: string;
    readonly primaryObjective: GrowthObjective;
    readonly secondaryObjectives?: readonly GrowthObjective[];
    readonly targetOutcome?: AgentMission['targetOutcome'];
    readonly platformScope?: readonly Platform[];
    readonly offerIds?: readonly string[];
    readonly audienceScope?: string;
    readonly resourceConstraints?: AgentMission['resourceConstraints'];
    readonly brandConstraints?: AgentMission['brandConstraints'];
    readonly riskConstraints?: AgentMission['riskConstraints'];
  }): Promise<AgentMission> {
    const now = this.now();
    const mission: AgentMission = {
      id: `mission_${randomUUID()}`,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      statement: input.statement,
      primaryObjective: input.primaryObjective,
      secondaryObjectives: input.secondaryObjectives ?? [],
      targetOutcome: input.targetOutcome,
      platformScope: input.platformScope ?? [],
      offerIds: input.offerIds ?? [],
      audienceScope: input.audienceScope,
      resourceConstraints: input.resourceConstraints ?? {},
      brandConstraints: input.brandConstraints ?? { topicsToAvoid: [], toneRules: [], complianceRules: [] },
      riskConstraints: input.riskConstraints,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
      schemaVersion: 1,
    };
    await this.store.saveAgentMission(mission);

    const agent = await this.store.getAgent(input.agentId);
    if (agent) {
      await this.store.saveAgent({ ...agent, missionId: mission.id, status: 'active', updatedAt: now, version: agent.version + 1 });
    }
    return mission;
  }

  /** Supersedes a mission with a new version. The prior mission is retained. */
  async updateMission(
    missionId: string,
    changes: Partial<Omit<AgentMission, 'id' | 'agentId' | 'createdAt' | 'version'>>,
    actor: ActorRef = { kind: 'human' },
  ): Promise<AgentMission | null> {
    const existing = await this.store.getAgentMission(missionId);
    if (!existing) return null;
    const now = this.now();

    await this.store.saveAgentMission({ ...existing, status: 'superseded', updatedAt: now });
    const updated: AgentMission = {
      ...existing, ...changes,
      id: `mission_${randomUUID()}`,
      supersedesMissionId: existing.id,
      status: 'active',
      createdAt: existing.createdAt,
      updatedAt: now,
      version: existing.version + 1,
    };
    await this.store.saveAgentMission(updated);

    const agent = await this.store.getAgent(existing.agentId);
    if (agent) await this.store.saveAgent({ ...agent, missionId: updated.id, updatedAt: now, version: agent.version + 1 });

    await this.recordChange({
      agentId: existing.agentId, workspaceId: existing.workspaceId, changeType: 'mission_changed',
      summary: 'Mission updated.', before: existing.statement, after: updated.statement,
      reason: 'Mission revised.', actor,
    });
    return updated;
  }

  async getPermissionPolicy(agentId: string): Promise<AgentPermissionPolicy> {
    const stored = await this.store.getAgentPermissionPolicy(agentId);
    return stored ?? defaultPermissionPolicy(agentId, this.now());
  }

  /* ---- Evidence state ----------------------------------------------- */

  /**
   * The agent's KNOW / SUSPECT / TEST / UNKNOWN / STOPPED picture for one
   * profile, assembled from evidence the layers beneath already produced.
   */
  async getEvidenceStateSummary(profileId: string): Promise<EvidenceStateSummary> {
    const now = this.now();
    const findings = await this.store.listFindings({ profileId });
    const transfers = await this.store.listTransferAssessments({ targetProfileId: profileId });
    const hypotheses = await this.store.listHypotheses({ profileId });
    const entries: EvidenceStateEntry[] = [];

    const openHypothesisSubjects = new Set(
      hypotheses.filter((h) => h.status === 'testing' || h.status === 'proposed').map((h) => h.statement),
    );

    for (const finding of findings) {
      const { state, rationale } = deriveEvidenceState({
        origin: 'first_party_finding',
        isValidated: finding.status === 'validated',
        confidence: finding.confidence,
        hasActiveExperiment: openHypothesisSubjects.has(finding.statement),
        isStopped: finding.status === 'rejected',
      });
      entries.push({
        subject: finding.statement,
        state,
        origin: 'first_party_finding',
        rationale,
        findingIds: [finding.id],
        segmentFindingIds: [],
        genomePatternIds: [],
        transferAssessmentIds: [],
        experimentIds: finding.sourceExperimentIds,
        confidence: finding.confidence,
        limitations: finding.limitations ?? [],
        lastUpdatedAt: finding.lastValidatedAt,
      });
    }

    for (const transfer of transfers) {
      if (transfer.relevance === 'irrelevant') continue;
      const stopped = transfer.relevance === 'contraindicated';
      const { state, rationale } = deriveEvidenceState({
        origin: 'transfer_assessment',
        isValidated: false,
        confidence: transfer.assessmentConfidence,
        isStopped: stopped,
      });
      entries.push({
        subject: transfer.recommendation.proposedHypothesisStatement ?? transfer.findingId,
        state,
        origin: 'transfer_assessment',
        rationale: stopped ? 'Contraindicated for this profile by its own evidence.' : rationale,
        findingIds: [],
        segmentFindingIds: [],
        genomePatternIds: [],
        transferAssessmentIds: [transfer.id],
        experimentIds: [],
        confidence: transfer.assessmentConfidence,
        limitations: transfer.limitations,
        lastUpdatedAt: transfer.createdAt,
      });
    }

    for (const hypothesis of hypotheses) {
      if (hypothesis.status !== 'inconclusive' && hypothesis.status !== 'testing') continue;
      entries.push({
        subject: hypothesis.statement,
        state: 'test',
        origin: 'experiment',
        rationale: 'An open question with an experiment resolving it.',
        findingIds: [], segmentFindingIds: [], genomePatternIds: [], transferAssessmentIds: [],
        experimentIds: hypothesis.supportingExperimentIds,
        confidence: hypothesis.confidence,
        limitations: [],
        lastUpdatedAt: hypothesis.lastTestedAt ?? hypothesis.createdAt,
      });
    }

    if (entries.length === 0) {
      entries.push({
        subject: 'What works for this profile',
        state: 'unknown',
        origin: 'none',
        rationale: 'No relevant evidence yet.',
        findingIds: [], segmentFindingIds: [], genomePatternIds: [], transferAssessmentIds: [], experimentIds: [],
        limitations: ['small_sample'],
        lastUpdatedAt: now,
      });
    }

    return {
      know: entries.filter((e) => e.state === 'know').length,
      suspect: entries.filter((e) => e.state === 'suspect').length,
      test: entries.filter((e) => e.state === 'test').length,
      unknown: entries.filter((e) => e.state === 'unknown').length,
      stopped: entries.filter((e) => e.state === 'stopped').length,
      entries,
    };
  }

  /* ---- Actions ------------------------------------------------------- */

  /**
   * Proposes an action. Risk, permission, approval and experiment
   * constraints are all applied here, so nothing reaches the queue without
   * having been checked.
   */
  async proposeAction(input: {
    readonly agentId: string;
    readonly workspaceId?: string;
    readonly profileId?: string;
    readonly missionId?: string;
    readonly actionType: AgentActionType;
    readonly reason: string;
    readonly priority?: number;
    readonly evidenceRefs?: AgentEvidenceRefs;
    readonly touchedVariables?: readonly string[];
    readonly lockedVariables?: readonly string[];
    readonly extraConstraints?: readonly ActionConstraint[];
    readonly expiresAt?: IsoDateTime;
  }): Promise<AgentAction> {
    const now = this.now();
    const policy = await this.getPermissionPolicy(input.agentId);
    const riskClass = classifyActionRisk(input.actionType);
    const constraints: ActionConstraint[] = [...(input.extraConstraints ?? [])];

    const permitted = isActionPermitted(input.actionType, policy);
    if (!permitted.permitted) {
      constraints.push({ source: 'permission_policy', description: permitted.reason, blocking: true });
    }

    const experimentCheck = violatesActiveExperiment({
      actionType: input.actionType,
      touchedVariables: input.touchedVariables ?? [],
      lockedVariables: input.lockedVariables ?? [],
    });
    if (experimentCheck.violates) {
      constraints.push({ source: 'active_experiment', description: experimentCheck.reason, blocking: true });
    }

    const approval = requiresApproval({ actionType: input.actionType, riskClass, policy });
    if (approval.required) {
      constraints.push({ source: 'autonomy', description: approval.reason, blocking: false });
    }

    const blocked = constraints.some((c) => c.blocking);

    const action: AgentAction = {
      id: `act_${randomUUID()}`,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      missionId: input.missionId,
      actionType: input.actionType,
      riskClass,
      priority: input.priority ?? 0.5,
      // A blocked action is deferred, not silently dropped — the reason is visible.
      status: blocked ? 'deferred' : approval.required ? 'awaiting_approval' : 'proposed',
      reason: input.reason,
      evidenceRefs: input.evidenceRefs ?? EMPTY_EVIDENCE_REFS,
      constraints,
      requiresApproval: approval.required,
      proposedBy: { kind: 'agent', id: input.agentId },
      requestedAt: now,
      humanDecisions: [],
      expiresAt: input.expiresAt,
      schemaVersion: 1,
    };
    await this.store.saveAgentAction(action);
    return action;
  }

  /** Records a human decision. The original proposal is never erased. */
  private async decide(
    actionId: string,
    decision: 'approved' | 'rejected' | 'deferred' | 'cancelled' | 'revision_requested',
    actor: ActorRef,
    reason?: string,
  ): Promise<AgentAction | null> {
    const action = await this.store.getAgentAction(actionId);
    if (!action) return null;
    const now = this.now();

    const statusByDecision: Record<typeof decision, AgentAction['status']> = {
      approved: 'approved',
      rejected: 'rejected',
      deferred: 'deferred',
      cancelled: 'cancelled',
      revision_requested: 'proposed',
    };

    const updated: AgentAction = {
      ...action,
      status: statusByDecision[decision],
      // Appended, never replaced — the full decision trail survives.
      humanDecisions: [...action.humanDecisions, { decision, actor, reason, decidedAt: now }],
      approvedAt: decision === 'approved' ? now : action.approvedAt,
    };
    await this.store.saveAgentAction(updated);
    await this.recordChange({
      agentId: action.agentId, workspaceId: action.workspaceId, changeType: 'human_override',
      summary: `Action ${action.actionType} ${decision}.`,
      before: action.status, after: updated.status,
      reason: reason ?? `Human ${decision}.`, actor,
    });
    return updated;
  }

  approveAction(actionId: string, actor: ActorRef, reason?: string) { return this.decide(actionId, 'approved', actor, reason); }
  rejectAction(actionId: string, actor: ActorRef, reason?: string) { return this.decide(actionId, 'rejected', actor, reason); }
  deferAction(actionId: string, actor: ActorRef, reason?: string) { return this.decide(actionId, 'deferred', actor, reason); }
  cancelAction(actionId: string, actor: ActorRef, reason?: string) { return this.decide(actionId, 'cancelled', actor, reason); }
  requestRevision(actionId: string, actor: ActorRef, reason?: string) { return this.decide(actionId, 'revision_requested', actor, reason); }

  /** Expires actions past their deadline. Nothing is deleted. */
  async expireStaleActions(agentId: string): Promise<AgentAction[]> {
    const now = this.now();
    const actions = await this.store.listAgentActions({ agentId });
    const expired: AgentAction[] = [];
    for (const action of actions) {
      const open = action.status === 'proposed' || action.status === 'awaiting_approval';
      if (open && action.expiresAt !== undefined && action.expiresAt <= now) {
        const updated: AgentAction = { ...action, status: 'expired' };
        await this.store.saveAgentAction(updated);
        expired.push(updated);
      }
    }
    return expired;
  }

  /** "Why is the agent proposing this?" — without naming any peer business. */
  async explainAgentAction(actionId: string): Promise<AgentActionExplanation | null> {
    const action = await this.store.getAgentAction(actionId);
    if (!action) return null;
    const mission = action.missionId ? await this.store.getAgentMission(action.missionId) : null;
    const summary = action.profileId ? await this.getEvidenceStateSummary(action.profileId) : null;
    const entry = summary?.entries.find((e) => e.findingIds.some((id) => action.evidenceRefs.findingIds.includes(id)));

    return {
      actionId: action.id,
      actionType: action.actionType,
      reason: action.reason,
      missionObjective: mission?.primaryObjective,
      evidenceState: entry?.state ?? (action.evidenceRefs.findingIds.length > 0 ? 'suspect' : 'unknown'),
      evidenceRefs: action.evidenceRefs,
      confidence: entry?.confidence,
      constraints: action.constraints,
      limitations: entry?.limitations ?? [],
      unknowns: summary ? summary.entries.filter((e) => e.state === 'unknown').map((e) => e.subject) : [],
      peerEvidenceNote:
        action.evidenceRefs.transferAssessmentIds.length > 0 || action.evidenceRefs.genomePatternIds.length > 0
          ? PEER_EVIDENCE_NOTE
          : undefined,
    };
  }

  /* ---- CreatorOS handoff --------------------------------------------- */

  /**
   * Prepares an execution handoff. The intelligence layer stops here —
   * CreatorOS performs the act.
   *
   * Requires an approved action AND a permission that covers it: approval
   * alone is not enough.
   */
  async prepareCreatorOsHandoff(input: {
    readonly actionId: string;
    readonly profileId: string;
    readonly creatorOsAccountId: string;
    readonly platform: Platform;
    readonly executionType: CreatorOsExecutionHandoff['executionType'];
    readonly payload?: CreatorOsExecutionHandoff['payload'];
    readonly scheduledAt?: IsoDateTime;
  }): Promise<{ ok: true; handoff: CreatorOsExecutionHandoff } | { ok: false; error: string }> {
    const action = await this.store.getAgentAction(input.actionId);
    if (!action) return { ok: false, error: `No action "${input.actionId}".` };

    const policy = await this.getPermissionPolicy(action.agentId);
    const check = canHandOffToCreatorOs({
      actionStatus: action.status, actionType: action.actionType, riskClass: action.riskClass, policy,
    });
    if (!check.allowed) return { ok: false, error: check.reason };

    const now = this.now();
    const handoff: CreatorOsExecutionHandoff = {
      id: `handoff_${randomUUID()}`,
      agentActionId: action.id,
      agentId: action.agentId,
      workspaceId: action.workspaceId,
      profileId: input.profileId,
      creatorOsAccountId: input.creatorOsAccountId,
      platform: input.platform,
      executionType: input.executionType,
      payload: input.payload ?? {},
      scheduledAt: input.scheduledAt,
      status: 'prepared',
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    await this.store.saveExecutionHandoff(handoff);
    await this.store.saveAgentAction({ ...action, status: 'queued', executionHandoffId: handoff.id });
    return { ok: true, handoff };
  }

  /**
   * Records what CreatorOS reported back, linking action → execution →
   * measurement. Measurements themselves live in Milestone 6's stores; only
   * references are held here.
   */
  async recordExecutionResult(input: {
    readonly handoffId: string;
    readonly status: 'succeeded' | 'failed';
    readonly creatorOsPostId?: string;
    readonly measurementRefs?: readonly string[];
  }): Promise<CreatorOsExecutionHandoff | null> {
    const handoff = await this.store.getExecutionHandoff(input.handoffId);
    if (!handoff) return null;
    const now = this.now();
    const updated: CreatorOsExecutionHandoff = {
      ...handoff,
      status: input.status,
      creatorOsPostId: input.creatorOsPostId,
      measurementRefs: input.measurementRefs,
      updatedAt: now,
    };
    await this.store.saveExecutionHandoff(updated);

    const action = await this.store.getAgentAction(handoff.agentActionId);
    if (action) {
      await this.store.saveAgentAction({
        ...action,
        status: input.status === 'succeeded' ? 'completed' : 'failed',
        executedAt: now,
        completedAt: input.status === 'succeeded' ? now : undefined,
        failedAt: input.status === 'failed' ? now : undefined,
        resultRefs: input.measurementRefs,
      });
    }
    return updated;
  }

  /* ---- Business outcomes --------------------------------------------- */

  /** Business outcomes from first-party attribution ONLY. Never inferred from analytics. */
  async getBusinessOutcomeState(profileId: string): Promise<BusinessOutcomeState> {
    const events = await this.store.listAttributionEvents({ profileId });
    let leads = 0, sales = 0, revenue = 0;
    let currency: string | undefined;
    let unknownAttribution = 0;

    for (const event of events) {
      if (event.eventType === 'lead') leads += 1;
      if (event.eventType === 'purchase' || event.eventType === 'repeat_purchase') sales += 1;
      if (event.value !== undefined && (event.eventType === 'purchase' || event.eventType === 'repeat_purchase' || event.eventType === 'revenue')) {
        revenue += event.value;
        currency = event.currency ?? currency;
      }
      if (event.attributionMethod === 'unknown') unknownAttribution += 1;
    }

    const attributionQuality: BusinessOutcomeState['attributionQuality'] =
      events.length === 0 ? 'none'
        : unknownAttribution === events.length ? 'unknown'
          : unknownAttribution > 0 ? 'partial' : 'good';

    return {
      leads, sales, revenue, currency, attributionQuality,
      unattributedNote:
        events.length === 0
          ? 'No first-party business outcomes recorded. Revenue is never inferred from platform analytics.'
          : `${unknownAttribution} of ${events.length} event(s) have unknown attribution.`,
      evidenceState: events.length === 0 ? 'unknown' : attributionQuality === 'good' ? 'know' : 'suspect',
    };
  }

  /* ---- Living prescription ------------------------------------------- */

  /**
   * Builds a new version of the living prescription.
   *
   * Never overwrites: the prior version is marked `superseded` and retained,
   * and the new one carries a `changeSummary` explaining what moved and why.
   */
  async buildLivingPrescription(input: {
    readonly agentId: string;
    readonly profileId: string;
    readonly triggers?: readonly PrescriptionRefreshTrigger[];
    readonly reason?: string;
  }): Promise<LivingSocialPrescription | null> {
    const agent = await this.store.getAgent(input.agentId);
    if (!agent) return null;
    const now = this.now();
    const mission = agent.missionId ? await this.store.getAgentMission(agent.missionId) : null;
    const profile = await this.store.getProfile(input.profileId);

    const findings = await this.store.listFindings({ profileId: input.profileId });
    const transfers = await this.store.listTransferAssessments({ targetProfileId: input.profileId });
    const segments = await this.store.listObservedSegments({ profileId: input.profileId });
    const segmentFindings = await this.store.listSegmentFindings({ profileId: input.profileId });
    const hypotheses = await this.store.listHypotheses({ profileId: input.profileId });
    const evidenceStates = await this.getEvidenceStateSummary(input.profileId);

    const validated = findings.filter((f) => f.status === 'validated');
    const promising = findings.filter((f) => f.status === 'promising');
    const rejected = findings.filter((f) => f.status === 'rejected');

    const maturity = derivePersonalizationMaturity({
      validatedFirstPartyCount: validated.length,
      promisingFirstPartyCount: promising.length,
      experimentCount: new Set(findings.flatMap((f) => f.sourceExperimentIds)).size,
      transferredCount: transfers.length,
      genomeCount: 0,
    });

    // Platform strategy — one allocation per in-scope platform, evenly split
    // unless evidence says otherwise. Evidence-free allocations are flagged
    // `testRequired` rather than presented as a recommendation.
    const scope = mission?.platformScope.length ? mission.platformScope : profile ? [profile.platform] : [];
    const platformStrategy: PlatformAllocation[] = scope.map((platform) => {
      const platformFindings = validated.filter((f) => f.platform === platform);
      const hasEvidence = platformFindings.length > 0;
      return {
        platform,
        allocation: scope.length > 0 ? 1 / scope.length : 0,
        role: hasEvidence ? 'primary' : 'experimental',
        objective: mission?.primaryObjective,
        confidence: hasEvidence ? platformFindings[0]!.confidence : undefined,
        evidenceState: hasEvidence ? 'know' : 'unknown',
        evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: platformFindings.map((f) => f.id) },
        limitations: hasEvidence ? [] : (['small_sample'] as AnalysisLimitation[]),
        testRequired: !hasEvidence,
        rationale: hasEvidence
          ? `${platformFindings.length} validated finding(s) on this platform.`
          : 'No platform-specific evidence yet; treat as an experiment rather than a recommendation.',
      };
    });

    const toStrategyItems = (subjectPrefix: string, picker: (f: (typeof findings)[number]) => string | undefined) =>
      findings
        .filter((f) => f.status !== 'rejected' && picker(f) !== undefined)
        .map((f) => ({
          subject: `${subjectPrefix}: ${picker(f)}`,
          guidance: f.statement,
          evidenceState: (f.status === 'validated' ? 'know' : 'suspect') as EvidenceStateEntry['state'],
          evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: [f.id], experimentIds: f.sourceExperimentIds },
          limitations: f.limitations ?? [],
        }));

    const previous = await this.getCurrentPrescription(input.agentId);
    const previousEvidence = previous
      ? previous.evidenceStates.flatMap((e) => e.findingIds)
      : [];
    const currentEvidence = evidenceStates.entries.flatMap((e) => e.findingIds);

    const prescription: LivingSocialPrescription = {
      id: `rx_${randomUUID()}`,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      profileIds: [input.profileId],
      missionId: mission?.id,
      version: (previous?.version ?? 0) + 1,
      status: 'active',
      generatedAt: now,
      effectiveFrom: now,
      supersedesPrescriptionId: previous?.id,
      evidenceCutoffAt: now,
      personalizationMaturity: maturity,
      overallConfidence: validated.length > 0
        ? validated.reduce((sum, f) => sum + f.confidence, 0) / validated.length
        : undefined,
      platformStrategy,
      audienceStrategy: {
        declaredAudience: profile?.audience.primaryAudience,
        observedSegmentIds: segments.map((s) => s.id),
        prioritySegmentIds: segmentFindings.filter((f) => f.status === 'supported').map((f) => f.segmentId),
        emergingSegmentIds: segments.filter((s) => s.status === 'emerging').map((s) => s.id),
        buyerSegmentIds: [],
        conversationSegmentIds: [],
        unknownSegmentNote:
          segments.length === 0
            ? 'No observed segments yet; the declared audience remains an unconfirmed hypothesis.'
            : `${segments.length} observed segment(s) recorded.`,
        evidenceState: segments.length === 0 ? 'unknown' : 'suspect',
      },
      contentStrategy: toStrategyItems('Format', (f) => f.contentFormat),
      hookStrategy: toStrategyItems('Hook', (f) => f.hookFamily),
      ctaStrategy: [],
      offerStrategy: [],
      cadenceStrategy: {
        postsPerDay: mission?.resourceConstraints.maxPostsPerDay ?? profile?.strategy.postingFrequency.postsPerDay,
        postsPerWeek: mission?.resourceConstraints.maxPostsPerWeek ?? profile?.strategy.postingFrequency.postsPerWeek,
        evidenceState: 'unknown',
        fromStatedCapacityOnly: true,
        rationale: 'Based on stated capacity. No cadence or timing evidence exists for this profile yet.',
      },
      experimentPlan: hypotheses
        .filter((h) => h.status === 'testing' || h.status === 'proposed' || h.status === 'inconclusive')
        .map((h) => ({
          hypothesisId: h.id,
          question: h.statement,
          rationale: h.status === 'inconclusive' ? 'Evidence so far is conflicting.' : 'Registered but unresolved.',
          informationGain: 0.6,
          status: 'proposed' as const,
        })),
      avoidanceGuidance: [
        ...rejected.map((f) => ({
          subject: f.statement,
          reason: `Tested on this profile and rejected (sample ${f.sampleSize}).`,
          evidenceState: 'stopped' as const,
          evidenceRefs: { ...EMPTY_EVIDENCE_REFS, findingIds: [f.id] },
        })),
        ...transfers
          .filter((t) => t.relevance === 'contraindicated')
          .map((t) => ({
            subject: t.recommendation.proposedHypothesisStatement ?? t.findingId,
            reason: t.recommendation.reason,
            evidenceState: 'stopped' as const,
            evidenceRefs: { ...EMPTY_EVIDENCE_REFS, transferAssessmentIds: [t.id] },
          })),
      ],
      unknowns: [
        ...(validated.length === 0
          ? [{ topic: 'What works for this profile', reason: 'No validated first-party findings yet.', howToResolve: 'Run the experiments in the plan.' }]
          : []),
        ...(segments.length === 0
          ? [{ topic: 'Who actually responds', reason: 'No observed audience segments.', howToResolve: 'Collect audience signals.' }]
          : []),
      ],
      evidenceStates: evidenceStates.entries,
      actionIds: [],
      limitations: validated.length === 0 ? (['small_sample'] as AnalysisLimitation[]) : [],
      changeSummary: {
        supersedesPrescriptionId: previous?.id,
        reason: input.reason ?? 'Scheduled rebuild.',
        triggers: input.triggers ?? [],
        evidenceAdded: currentEvidence.filter((id) => !previousEvidence.includes(id)),
        evidenceRemoved: previousEvidence.filter((id) => !currentEvidence.includes(id)),
        recommendationsAdded: [],
        recommendationsRemoved: [],
        confidenceBefore: previous?.overallConfidence,
        confidenceAfter: validated.length > 0
          ? validated.reduce((sum, f) => sum + f.confidence, 0) / validated.length
          : undefined,
        platformAllocationChanged:
          previous !== null && JSON.stringify(previous.platformStrategy.map((p) => p.platform)) !== JSON.stringify(platformStrategy.map((p) => p.platform)),
      },
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };

    if (previous) {
      await this.store.saveLivingPrescription({ ...previous, status: 'superseded', updatedAt: now });
    }
    await this.store.saveLivingPrescription(prescription);
    await this.store.saveAgent({ ...agent, currentPrescriptionId: prescription.id, updatedAt: now, version: agent.version + 1 });
    await this.recordChange({
      agentId: agent.id, workspaceId: agent.workspaceId, changeType: 'prescription_changed',
      summary: `Prescription v${prescription.version} generated.`,
      before: previous ? `v${previous.version}` : undefined,
      after: `v${prescription.version}`,
      reason: input.reason ?? 'Rebuild.',
      actor: { kind: 'agent', id: agent.id },
    });
    return prescription;
  }

  /** The agent's active prescription. Earlier versions are retained. */
  async getCurrentPrescription(agentId: string): Promise<LivingSocialPrescription | null> {
    const all = await this.store.listLivingPrescriptions({ agentId });
    if (all.length === 0) return null;
    return all.reduce((latest, p) => (p.version > latest.version ? p : latest));
  }

  async getPrescriptionHistory(agentId: string): Promise<LivingSocialPrescription[]> {
    const all = await this.store.listLivingPrescriptions({ agentId });
    return [...all].sort((a, b) => a.version - b.version);
  }

  /** Deterministic refresh assessment. */
  async assessPrescriptionRefresh(input: {
    readonly agentId: string;
    readonly profileId: string;
    readonly missionChanged?: boolean;
    readonly offerChanged?: boolean;
    readonly experimentCompleted?: boolean;
  }): Promise<PrescriptionRefreshAssessment> {
    const now = this.now();
    const current = await this.getCurrentPrescription(input.agentId);
    const triggers: PrescriptionRefreshTrigger[] = [];
    const reasons: string[] = [];

    if (!current) {
      return {
        verdict: 'refresh_required',
        triggers: [],
        reasons: ['No prescription exists yet.'],
        assessedAt: now,
      };
    }

    const knownEvidence = new Set(current.evidenceStates.flatMap((e) => e.findingIds));
    const findings = await this.store.listFindings({ profileId: input.profileId });
    const newSignificant = findings.filter(
      (f) => !knownEvidence.has(f.id) && (f.status === 'validated' || f.status === 'rejected'),
    );
    if (newSignificant.length > 0) {
      triggers.push('significant_new_finding');
      reasons.push(`${newSignificant.length} significant finding(s) arrived since this prescription.`);
    }

    for (const finding of findings) {
      if (this.science.assessFindingFreshness(finding, now) === 'decaying') {
        triggers.push('finding_decay');
        reasons.push('At least one supporting finding has decayed.');
        break;
      }
    }

    const segments = await this.store.listObservedSegments({ profileId: input.profileId });
    if (segments.length !== current.audienceStrategy.observedSegmentIds.length) {
      triggers.push('audience_shift');
      reasons.push('The observed audience has changed since this prescription.');
    }

    if (input.missionChanged) { triggers.push('mission_change'); reasons.push('The mission changed.'); }
    if (input.offerChanged) { triggers.push('offer_change'); reasons.push('The offer changed.'); }
    if (input.experimentCompleted) { triggers.push('experiment_completion'); reasons.push('An experiment completed.'); }

    const required: readonly PrescriptionRefreshTrigger[] = ['mission_change', 'offer_change', 'significant_new_finding'];
    const verdict = triggers.length === 0
      ? 'current'
      : triggers.some((t) => required.includes(t))
        ? 'refresh_required'
        : 'refresh_recommended';

    return { verdict, triggers: [...new Set(triggers)], reasons, assessedAt: now };
  }

  /* ---- Decision cycle -------------------------------------------------- */

  /**
   * One pass of OBSERVE → DIAGNOSE → DECIDE → PROPOSE.
   *
   * Consumes Adaptive Strategy for next actions rather than deriving its
   * own, applies constraints, and is free to conclude that no action is
   * needed.
   */
  async runDecisionCycle(input: {
    readonly agentId: string;
    readonly profileId: string;
    readonly lockedVariables?: readonly string[];
  }): Promise<AgentDecisionCycleResult | null> {
    const agent = await this.store.getAgent(input.agentId);
    if (!agent) return null;
    const now = this.now();
    const mission = agent.missionId ? await this.store.getAgentMission(agent.missionId) : null;
    const evidenceStateSummary = await this.getEvidenceStateSummary(input.profileId);
    const diagnostics: AgentDiagnostic[] = [];

    // ---- DIAGNOSE ----
    if (evidenceStateSummary.know === 0 && evidenceStateSummary.suspect === 0) {
      diagnostics.push({ code: 'insufficient_evidence', detail: 'No validated or promising evidence for this profile.' });
    }
    const segments = await this.store.listObservedSegments({ profileId: input.profileId });
    if (segments.length === 0) {
      diagnostics.push({ code: 'audience_divergence', detail: 'No observed audience; the declared audience is unconfirmed.' });
    }
    const outcomes = await this.getBusinessOutcomeState(input.profileId);
    if (outcomes.attributionQuality === 'none') {
      diagnostics.push({ code: 'attribution_unavailable', detail: 'No first-party business outcomes recorded yet.' });
    }
    const profile = await this.store.getProfile(input.profileId);
    if (profile && profile.monetization.offers.filter((o) => o.active).length === 0) {
      diagnostics.push({ code: 'offer_missing', detail: 'No active offer configured.' });
    }
    if ((input.lockedVariables ?? []).length > 0) {
      diagnostics.push({ code: 'experiment_incomplete', detail: 'A controlled experiment is running; variables are locked.' });
    }

    // ---- DECIDE: reuse Adaptive Strategy, never re-derive it ----
    const plan = await this.adaptive.buildAdaptiveStrategyPlan(input.profileId);
    const proposedActionIds: string[] = [];
    const blockedActions: { actionType: AgentActionType; reason: string }[] = [];

    const missionConstraints = deriveMissionConstraints({
      maxPostsPerDay: mission?.resourceConstraints.maxPostsPerDay,
      topicsToAvoid: mission?.brandConstraints.topicsToAvoid ?? [],
      platformScope: (mission?.platformScope ?? []) as readonly string[],
      proposedPlatform: profile?.platform,
    });

    for (const recommendation of plan?.recommendations ?? []) {
      const actionType = mapRecommendationToActionType(recommendation.action);
      const action = await this.proposeAction({
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        profileId: input.profileId,
        missionId: mission?.id,
        actionType,
        reason: recommendation.reason,
        priority: recommendation.priorityScore,
        evidenceRefs: {
          ...EMPTY_EVIDENCE_REFS,
          findingIds: recommendation.basis.findingIds,
          segmentFindingIds: recommendation.basis.segmentFindingIds,
          transferAssessmentIds: [],
          strategyRecommendationIds: [recommendation.id],
          experimentIds: recommendation.basis.experimentIds,
          hypothesisIds: recommendation.basis.hypothesisIds,
        },
        touchedVariables: [],
        lockedVariables: input.lockedVariables,
        extraConstraints: missionConstraints,
      });
      if (action.status === 'deferred') {
        blockedActions.push({ actionType, reason: action.constraints.find((c) => c.blocking)?.description ?? 'Blocked.' });
      } else {
        proposedActionIds.push(action.id);
      }
    }

    if (proposedActionIds.length === 0 && blockedActions.length === 0) {
      diagnostics.push({ code: 'no_action_needed', detail: 'No action is justified by current evidence.' });
    }

    const prescriptionRefresh = await this.assessPrescriptionRefresh({
      agentId: agent.id, profileId: input.profileId,
    });

    const pendingApprovals = (await this.store.listAgentActions({ agentId: agent.id, status: 'awaiting_approval' })).length;

    const result: AgentDecisionCycleResult = {
      id: `cycle_${randomUUID()}`,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      ranAt: now,
      diagnostics,
      proposedActionIds,
      blockedActions,
      evidenceStateSummary,
      prescriptionRefresh,
      humanInputRequired: pendingApprovals > 0 || evidenceStateSummary.unknown > 0,
      decisionSummary:
        proposedActionIds.length === 0
          ? 'No action proposed. Waiting for evidence is the correct move.'
          : `${proposedActionIds.length} action(s) proposed, ${blockedActions.length} blocked by constraints.`,
      nextReviewTrigger:
        prescriptionRefresh.verdict === 'current'
          ? 'On the next significant finding or experiment completion.'
          : 'Prescription refresh is due.',
      schemaVersion: 1,
    };

    await this.store.saveAgent({ ...agent, lastDecisionAt: now, updatedAt: now, version: agent.version + 1 });
    return result;
  }

  /* ---- Read models ---------------------------------------------------- */

  /** The current operating picture. References and summaries, not bulk copies. */
  async buildAgentState(agentId: string, profileId: string): Promise<AgentState | null> {
    const agent = await this.store.getAgent(agentId);
    if (!agent) return null;
    const mission = agent.missionId ? await this.store.getAgentMission(agent.missionId) : null;
    const prescription = await this.getCurrentPrescription(agentId);
    const actions = await this.store.listAgentActions({ agentId });
    const evidenceStateSummary = await this.getEvidenceStateSummary(profileId);

    const pendingApproval = actions.filter((a) => a.status === 'awaiting_approval');
    const open = actions.filter((a) => a.status === 'proposed' || a.status === 'approved');
    const next = [...open].sort((a, b) => b.priority - a.priority)[0];

    const decisionLoad: DecisionLoadSummary = {
      actionsPrepared: actions.length,
      actionsAwaitingApproval: pendingApproval.length,
      experimentsRunning: agent.activeExperimentIds.length,
      decisionsDeferredForEvidence: actions.filter((a) => a.actionType === 'wait_for_evidence' || a.actionType === 'collect_more_evidence').length,
      strategiesAvoided: prescription?.avoidanceGuidance.length ?? 0,
      unknownsRequiringCustomerInput: evidenceStateSummary.unknown,
    };

    return {
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      status: agent.status,
      autonomyLevel: agent.autonomyLevel,
      mission: mission ?? undefined,
      currentPrescriptionId: prescription?.id,
      personalizationMaturity: prescription?.personalizationMaturity,
      activeExperimentIds: agent.activeExperimentIds,
      nextBestActionId: next?.id,
      pendingApprovalActionIds: pendingApproval.map((a) => a.id),
      evidenceStateSummary,
      blockers: actions.filter((a) => a.status === 'deferred').map((a) => a.constraints.find((c) => c.blocking)?.description ?? 'Blocked.'),
      constraints: actions.flatMap((a) => a.constraints),
      businessOutcomeState: await this.getBusinessOutcomeState(profileId),
      decisionLoad,
      lastUpdatedAt: agent.updatedAt,
    };
  }

  /** The machine-readable answer to "what should I post today?". */
  async buildTodaysPlan(input: { readonly agentId: string; readonly profileId: string }): Promise<TodaysPlan | null> {
    const agent = await this.store.getAgent(input.agentId);
    if (!agent) return null;
    const now = this.now();
    const mission = agent.missionId ? await this.store.getAgentMission(agent.missionId) : null;
    const prescription = await this.getCurrentPrescription(input.agentId);
    const actions = (await this.store.listAgentActions({ agentId: input.agentId })).filter(
      (a) => a.status === 'proposed' || a.status === 'awaiting_approval' || a.status === 'approved',
    );
    const evidenceStateSummary = await this.getEvidenceStateSummary(input.profileId);
    const profile = await this.store.getProfile(input.profileId);

    // Briefs describe what to make. They are not content, and carry no
    // claim that a specific wording is supported.
    const contentBriefs: ContentBrief[] = prescription && profile
      ? prescription.hookStrategy.slice(0, 3).map((hook) => ({
          id: `brief_${randomUUID()}`,
          agentId: agent.id,
          profileId: input.profileId,
          platform: profile.platform,
          objective: mission?.primaryObjective ?? profile.objectives.primary,
          hookFamily: hook.subject.replace(/^Hook: /, ''),
          brandConstraints: mission?.brandConstraints.topicsToAvoid ?? [],
          evidenceRefs: hook.evidenceRefs,
          evidenceState: hook.evidenceState,
          notes: 'Pattern-level brief. Generated wording is execution material, not evidence.',
          createdAt: now,
        }))
      : [];

    const experimentContext = (prescription?.experimentPlan ?? [])
      .filter((e) => e.status === 'active')
      .map((e) => e.question);

    return {
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      profileId: input.profileId,
      date: now,
      missionStatement: mission?.statement,
      prescriptionId: prescription?.id,
      actions,
      contentBriefs,
      experimentContext,
      evidenceStateSummary,
      approvalsRequired: actions.filter((a) => a.requiresApproval && a.status === 'awaiting_approval').map((a) => a.id),
      noActionRecommended: actions.length === 0,
      summary: actions.length === 0
        ? 'Nothing to do today. The agent has no action justified by current evidence.'
        : `${actions.length} action(s) ready, ${actions.filter((a) => a.status === 'awaiting_approval').length} awaiting your approval.`,
    };
  }

  /** A serializable snapshot for later PDF, email, portal or API delivery. */
  async getPrescriptionExport(agentId: string): Promise<PrescriptionExport | null> {
    const prescription = await this.getCurrentPrescription(agentId);
    if (!prescription) return null;
    const mission = prescription.missionId ? await this.store.getAgentMission(prescription.missionId) : null;

    return {
      prescriptionId: prescription.id,
      agentId: prescription.agentId,
      workspaceId: prescription.workspaceId,
      generatedAt: prescription.generatedAt,
      missionStatement: mission?.statement,
      personalizationMaturity: prescription.personalizationMaturity,
      platformStrategy: prescription.platformStrategy,
      audienceStrategy: prescription.audienceStrategy,
      contentStrategy: prescription.contentStrategy,
      hookStrategy: prescription.hookStrategy,
      avoidanceGuidance: prescription.avoidanceGuidance,
      experimentPlan: prescription.experimentPlan,
      unknowns: prescription.unknowns,
      evidenceStateSummary: {
        know: prescription.evidenceStates.filter((e) => e.state === 'know').length,
        suspect: prescription.evidenceStates.filter((e) => e.state === 'suspect').length,
        test: prescription.evidenceStates.filter((e) => e.state === 'test').length,
        unknown: prescription.evidenceStates.filter((e) => e.state === 'unknown').length,
        stopped: prescription.evidenceStates.filter((e) => e.state === 'stopped').length,
        entries: prescription.evidenceStates,
      },
      limitations: prescription.limitations,
      changeSummary: prescription.changeSummary,
      peerEvidenceNote: PEER_EVIDENCE_NOTE,
    };
  }

  /* ---- Change log ------------------------------------------------------ */

  async recordChange(input: {
    readonly agentId: string;
    readonly workspaceId?: string;
    readonly changeType: AgentChangeType;
    readonly summary: string;
    readonly before?: string;
    readonly after?: string;
    readonly reason: string;
    readonly evidenceRefs?: AgentEvidenceRefs;
    readonly actor: ActorRef;
  }): Promise<AgentChangeRecord> {
    const record: AgentChangeRecord = {
      id: `chg_${randomUUID()}`,
      ...input,
      occurredAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveAgentChangeRecord(record);
    return record;
  }

  /** Full change history, oldest first. Nothing is ever removed. */
  async getChangeLog(agentId: string): Promise<AgentChangeRecord[]> {
    const all = await this.store.listAgentChangeRecords({ agentId });
    return [...all].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  }
}

/** Maps an Adaptive Strategy action onto the agent's action vocabulary. */
function mapRecommendationToActionType(action: string): AgentActionType {
  const map: Record<string, AgentActionType> = {
    run_experiment: 'run_experiment',
    repeat_validated_pattern: 'generate_content',
    revalidate_finding: 'revalidate_finding',
    explore_new_pattern: 'run_experiment',
    collect_more_evidence: 'collect_more_evidence',
    target_segment: 'target_segment',
    deprioritize_pattern: 'stop_strategy',
    adjust_content_mix: 'adjust_content_mix',
    test_offer: 'test_offer',
    test_cta: 'test_cta',
    test_hook: 'test_hook',
    test_format: 'test_format',
    do_nothing_yet: 'wait_for_evidence',
  };
  return map[action] ?? 'other';
}
