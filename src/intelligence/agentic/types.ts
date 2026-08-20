/**
 * Agentic Social Prescription — the persistent, customer-specific strategy
 * and decision state that the future Social Money Lab application consumes.
 *
 * COMMERCIAL ARCHITECTURE
 * ------------------------------------------------------------------------
 *   SOCIAL MONEY LAB      customer-facing product (not built here)
 *          |
 *   CUSTOMER WORKSPACE    business + profiles + agent
 *          |
 *   AGENTIC PRESCRIPTION  mission, decisions, living strategy, approvals
 *          |
 *   INTELLIGENCE ENGINE   Science, Adaptive, Transfer, Genome, Audience
 *          |
 *   CREATOROS             execution infrastructure
 *          |
 *   SOCIAL PLATFORMS  ->  measurements return  ->  (loop)
 *
 * ONE MODEL, MANY STATES
 * ------------------------------------------------------------------------
 * A `SocialIntelligenceAgent` is NOT a separate AI model per customer. Every
 * customer shares the same architecture and receives separate persistent
 * STATE: mission, memory, evidence, profiles, prescriptions, actions,
 * permissions and history.
 *
 * WHAT THIS LAYER DOES NOT DO
 * ------------------------------------------------------------------------
 * It never publishes, schedules, authenticates, calls a platform API, or
 * executes anything. It prepares handoffs; CreatorOS executes. The core
 * decision cycle is fully deterministic and requires no LLM.
 */
import type {
  AccountStage,
  Confidence,
  GrowthObjective,
  IsoDateTime,
  Platform,
} from '../common/types.js';
import type { AnalysisLimitation } from '../science/types.js';

/* ========================================================================
 * WORKSPACE AND AGENT IDENTITY
 * ===================================================================== */

/**
 * The smallest clean tenant foundation. Deliberately minimal: no auth, no
 * billing, no RBAC — just enough that every agent, prescription and action
 * can be scoped to a future customer boundary, and that customer-facing
 * reads can be filtered by it.
 */
export interface CustomerWorkspaceRef {
  readonly id: string;
  readonly name?: string;
}

/**
 * How much the agent may do without a human.
 *
 * Ordered by increasing latitude. `autonomous_lab` is representable but is
 * NEVER the default and cannot be reached by the agent itself — see
 * `AgentPermissionPolicy` and §42.
 */
export type AutonomyLevel = 'advisor' | 'copilot' | 'operator' | 'autonomous_lab';

export type AgentStatus = 'active' | 'paused' | 'onboarding' | 'archived';

/**
 * The persistent per-customer agent. Holds references, not copies: the
 * prescription, experiments and actions live in their own stores.
 */
export interface SocialIntelligenceAgent {
  readonly id: string;
  readonly workspaceId?: string;
  readonly profileIds: readonly string[];
  readonly missionId?: string;
  readonly status: AgentStatus;
  readonly autonomyLevel: AutonomyLevel;
  readonly currentPrescriptionId?: string;
  readonly activeExperimentIds: readonly string[];
  readonly pendingActionIds: readonly string[];
  readonly lastDecisionAt?: IsoDateTime;
  readonly lastObservationAt?: IsoDateTime;
  readonly lastLearningAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly version: number;
  readonly schemaVersion: number;
}

/* ========================================================================
 * MISSION
 * ===================================================================== */

export type MissionStatus = 'draft' | 'active' | 'paused' | 'achieved' | 'superseded';

/** What the business is actually trying to buy with its social effort. */
export interface MissionTargetOutcome {
  readonly description: string;
  readonly value?: number;
  readonly unit?: string;
  /** e.g. `monthly`, `quarterly`. Free text — no scheduler depends on it. */
  readonly timeHorizon?: string;
}

/** Real-world limits the agent must plan within. */
export interface MissionResourceConstraints {
  readonly maxContentHoursPerWeek?: number;
  readonly maxPostsPerDay?: number;
  readonly maxPostsPerWeek?: number;
  readonly notes?: string;
}

export interface MissionBrandConstraints {
  readonly topicsToAvoid: readonly string[];
  readonly toneRules: readonly string[];
  readonly complianceRules: readonly string[];
}

export interface MissionRiskConstraints {
  readonly maxAutonomyLevel?: AutonomyLevel;
  readonly prohibitedActionTypes?: readonly string[];
  readonly notes?: string;
}

/**
 * A BUSINESS-OBJECTIVE-FIRST mission.
 *
 * `platformScope` is a list, and an empty list means "every supported
 * platform is in scope" rather than any particular default. **No platform
 * is privileged** — platform is a strategic variable the agent may test,
 * never an assumption baked into the model.
 */
export interface AgentMission {
  readonly id: string;
  readonly workspaceId?: string;
  readonly agentId: string;
  readonly statement: string;
  readonly primaryObjective: GrowthObjective;
  readonly secondaryObjectives: readonly GrowthObjective[];
  readonly targetOutcome?: MissionTargetOutcome;
  /** Empty means all supported platforms are in scope. Never defaults to one. */
  readonly platformScope: readonly Platform[];
  readonly offerIds: readonly string[];
  readonly audienceScope?: string;
  readonly resourceConstraints: MissionResourceConstraints;
  readonly brandConstraints: MissionBrandConstraints;
  readonly riskConstraints?: MissionRiskConstraints;
  readonly status: MissionStatus;
  readonly supersedesMissionId?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly version: number;
  readonly schemaVersion: number;
}

/* ========================================================================
 * EVIDENCE STATE — the vocabulary the customer eventually sees
 * ===================================================================== */

/**
 * What the agent's standing is on one subject.
 *
 * - `know`    — strong, appropriately validated FIRST-PARTY evidence for this profile.
 * - `suspect` — promising profile evidence, transferred, Genome or research-supported candidate.
 * - `test`    — important uncertainty with an active or recommended experiment.
 * - `unknown` — insufficient relevant evidence.
 * - `stopped` — deliberately deprioritized after repeated failure, objective
 *               mismatch, negative transfer or staleness.
 *
 * **`know` is reserved for first-party validation.** Transferred, Genome and
 * research evidence can reach `suspect` at most — enforced in `policy.ts`.
 */
export type EvidenceState = 'know' | 'suspect' | 'test' | 'unknown' | 'stopped';

/** Where a piece of the agent's belief came from. */
export type EvidenceOrigin =
  | 'first_party_finding'
  | 'segment_finding'
  | 'transfer_assessment'
  | 'genome_pattern'
  | 'research_claim'
  | 'experiment'
  | 'none';

/** One subject the agent has a position on, with why. */
export interface EvidenceStateEntry {
  readonly subject: string;
  readonly state: EvidenceState;
  readonly origin: EvidenceOrigin;
  readonly rationale: string;
  readonly findingIds: readonly string[];
  readonly segmentFindingIds: readonly string[];
  readonly genomePatternIds: readonly string[];
  readonly transferAssessmentIds: readonly string[];
  readonly experimentIds: readonly string[];
  readonly confidence?: Confidence;
  readonly limitations: readonly AnalysisLimitation[];
  readonly lastUpdatedAt: IsoDateTime;
}

/** Counts by state, for a simple customer-facing summary. */
export interface EvidenceStateSummary {
  readonly know: number;
  readonly suspect: number;
  readonly test: number;
  readonly unknown: number;
  readonly stopped: number;
  readonly entries: readonly EvidenceStateEntry[];
}

/* ========================================================================
 * ACTIONS AND THE QUEUE
 * ===================================================================== */

/** Not every action is a post. Several are deliberately about *not* acting. */
export type AgentActionType =
  | 'approve_content'
  | 'generate_content'
  | 'run_experiment'
  | 'continue_experiment'
  | 'collect_more_evidence'
  | 'revalidate_finding'
  | 'adjust_content_mix'
  | 'adjust_platform_allocation'
  | 'test_hook'
  | 'test_cta'
  | 'test_format'
  | 'test_offer'
  | 'target_segment'
  | 'pause_strategy'
  | 'stop_strategy'
  | 'wait_for_evidence'
  | 'request_human_input'
  | 'other';

export type AgentActionStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'approved'
  | 'queued'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'deferred'
  | 'expired'
  | 'failed'
  | 'cancelled';

/** How much damage a mistake would do. Drives approval, with autonomy level. */
export type ActionRiskClass = 'low' | 'medium' | 'high' | 'restricted';

/** Who or what made a decision. Generic — no authentication here. */
export interface ActorRef {
  readonly kind: 'agent' | 'human' | 'system';
  readonly id?: string;
  readonly label?: string;
}

/** A human's response to a proposal. The proposal itself is never erased. */
export interface HumanDecision {
  readonly decision: 'approved' | 'rejected' | 'deferred' | 'cancelled' | 'revision_requested';
  readonly actor: ActorRef;
  readonly reason?: string;
  readonly decidedAt: IsoDateTime;
}

/** Constraints that shaped or blocked an action. */
export interface ActionConstraint {
  readonly source: 'mission' | 'permission_policy' | 'active_experiment' | 'capacity' | 'brand' | 'autonomy';
  readonly description: string;
  readonly blocking: boolean;
}

/**
 * One item in the agent's persistent queue.
 *
 * Queue logic never touches CreatorOS. An approved, executable action
 * produces a `CreatorOsExecutionHandoff`; CreatorOS does the rest.
 */
export interface AgentAction {
  readonly id: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly profileId?: string;
  readonly missionId?: string;
  readonly actionType: AgentActionType;
  readonly riskClass: ActionRiskClass;
  /** Operational ordering. Not a probability. */
  readonly priority: number;
  readonly status: AgentActionStatus;
  readonly reason: string;
  readonly evidenceRefs: AgentEvidenceRefs;
  readonly constraints: readonly ActionConstraint[];
  readonly requiresApproval: boolean;
  readonly proposedBy: ActorRef;
  readonly requestedAt: IsoDateTime;
  /** Every human response, in order. A rejection never deletes the proposal. */
  readonly humanDecisions: readonly HumanDecision[];
  readonly approvedAt?: IsoDateTime;
  readonly executedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly failedAt?: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
  readonly executionHandoffId?: string;
  readonly resultRefs?: readonly string[];
  readonly schemaVersion: number;
}

/** Evidence lineage carried on actions, explanations and prescription items. */
export interface AgentEvidenceRefs {
  readonly findingIds: readonly string[];
  readonly segmentFindingIds: readonly string[];
  readonly genomePatternIds: readonly string[];
  readonly transferAssessmentIds: readonly string[];
  readonly strategyRecommendationIds: readonly string[];
  readonly experimentIds: readonly string[];
  readonly hypothesisIds: readonly string[];
}

/** "Why is the agent proposing this?" — answerable without exposing peers. */
export interface AgentActionExplanation {
  readonly actionId: string;
  readonly actionType: AgentActionType;
  readonly reason: string;
  readonly missionObjective?: GrowthObjective;
  readonly evidenceState: EvidenceState;
  readonly evidenceRefs: AgentEvidenceRefs;
  readonly confidence?: Confidence;
  readonly constraints: readonly ActionConstraint[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly unknowns: readonly string[];
  /** Peer evidence is described, never identified. */
  readonly peerEvidenceNote?: string;
}

/* ========================================================================
 * PERMISSIONS AND RISK
 * ===================================================================== */

/**
 * What the agent is permitted to do in this workspace. Preparation only —
 * several flags describe CreatorOS write operations this layer does not
 * implement, and enabling one grants intent, not capability.
 */
export interface AgentPermissionPolicy {
  readonly id: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly autonomyLevel: AutonomyLevel;
  readonly contentGenerationAllowed: boolean;
  readonly schedulingAllowed: boolean;
  readonly publishingAllowed: boolean;
  readonly engagementExecutionAllowed: boolean;
  readonly experimentCreationAllowed: boolean;
  readonly experimentExecutionAllowed: boolean;
  readonly strategyAllocationChangesAllowed: boolean;
  readonly platformAllocationChangesAllowed: boolean;
  /** Always false in this milestone; the agent may never spend money. */
  readonly spendActionsAllowed: false;
  /** Always false; offers are the customer's decision. */
  readonly offerChangesAllowed: false;
  /** Risk classes at or above this always require a human, whatever the autonomy level. */
  readonly approvalRequiredAtOrAbove: ActionRiskClass;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/* ========================================================================
 * LIVING PRESCRIPTION
 * ===================================================================== */

/**
 * How much of the prescription rests on this profile's own evidence.
 *
 * Deliberately evidence-derived, never day-count-derived: a profile running
 * many experiments matures faster than one posting quietly for months.
 */
export type PersonalizationMaturity =
  | 'cold_start'
  | 'transferred_intelligence'
  | 'mixed_evidence'
  | 'profile_informed'
  | 'highly_profile_specific';

export type PrescriptionStatus = 'draft' | 'active' | 'superseded' | 'archived';

/** What a platform is for in this mission. No platform is privileged. */
export type PlatformRole = 'primary' | 'secondary' | 'experimental' | 'maintenance' | 'deprioritized';

export interface PlatformAllocation {
  readonly platform: Platform;
  /** Share of effort, 0..1. */
  readonly allocation: number;
  readonly role: PlatformRole;
  readonly objective?: GrowthObjective;
  readonly confidence?: Confidence;
  readonly evidenceState: EvidenceState;
  readonly evidenceRefs: AgentEvidenceRefs;
  readonly limitations: readonly AnalysisLimitation[];
  /** True when the allocation rests on too little evidence and should be tested. */
  readonly testRequired: boolean;
  readonly rationale: string;
}

export interface AudienceStrategy {
  readonly declaredAudience?: string;
  readonly observedSegmentIds: readonly string[];
  readonly prioritySegmentIds: readonly string[];
  readonly emergingSegmentIds: readonly string[];
  /** Segments with attributable business outcomes. */
  readonly buyerSegmentIds: readonly string[];
  /** Segments that engage without converting — real, but different. */
  readonly conversationSegmentIds: readonly string[];
  readonly unknownSegmentNote: string;
  readonly evidenceState: EvidenceState;
}

export interface ContentStrategyItem {
  readonly subject: string;
  readonly guidance: string;
  readonly evidenceState: EvidenceState;
  readonly evidenceRefs: AgentEvidenceRefs;
  readonly limitations: readonly AnalysisLimitation[];
}

export interface CadenceStrategy {
  readonly postsPerDay?: number;
  readonly postsPerWeek?: number;
  readonly evidenceState: EvidenceState;
  /** True when this merely restates stated capacity rather than resting on evidence. */
  readonly fromStatedCapacityOnly: boolean;
  readonly rationale: string;
}

export interface ExperimentPlanItem {
  readonly hypothesisId?: string;
  readonly transferAssessmentId?: string;
  readonly genomePatternId?: string;
  readonly question: string;
  readonly rationale: string;
  /** Operational value-of-information score. Not a probability. */
  readonly informationGain: number;
  readonly status: 'proposed' | 'active' | 'completed';
}

/** What NOT to do, and why. Negative knowledge is part of the product. */
export interface AvoidanceGuidanceItem {
  readonly subject: string;
  readonly reason: string;
  readonly evidenceState: EvidenceState;
  readonly evidenceRefs: AgentEvidenceRefs;
}

export interface PrescriptionUnknownItem {
  readonly topic: string;
  readonly reason: string;
  readonly howToResolve: string;
}

/** What changed between two prescription versions, and why. */
export interface PrescriptionDelta {
  readonly supersedesPrescriptionId?: string;
  readonly reason: string;
  readonly triggers: readonly PrescriptionRefreshTrigger[];
  readonly evidenceAdded: readonly string[];
  readonly evidenceRemoved: readonly string[];
  readonly recommendationsAdded: readonly string[];
  readonly recommendationsRemoved: readonly string[];
  readonly confidenceBefore?: Confidence;
  readonly confidenceAfter?: Confidence;
  readonly platformAllocationChanged: boolean;
}

/**
 * The Living Social Prescription — product STATE, not a report.
 *
 * Supersedes the earlier static prescription. Versioned and never
 * overwritten: `supersedesPrescriptionId` chains back and every prior
 * version is retained.
 */
export interface LivingSocialPrescription {
  readonly id: string;
  readonly workspaceId?: string;
  readonly agentId: string;
  readonly profileIds: readonly string[];
  readonly missionId?: string;
  readonly version: number;
  readonly status: PrescriptionStatus;
  readonly generatedAt: IsoDateTime;
  readonly effectiveFrom: IsoDateTime;
  readonly supersedesPrescriptionId?: string;
  readonly evidenceCutoffAt?: IsoDateTime;
  readonly personalizationMaturity: PersonalizationMaturity;
  readonly overallConfidence?: Confidence;
  readonly platformStrategy: readonly PlatformAllocation[];
  readonly audienceStrategy: AudienceStrategy;
  readonly contentStrategy: readonly ContentStrategyItem[];
  readonly hookStrategy: readonly ContentStrategyItem[];
  readonly ctaStrategy: readonly ContentStrategyItem[];
  readonly offerStrategy: readonly ContentStrategyItem[];
  readonly cadenceStrategy: CadenceStrategy;
  readonly experimentPlan: readonly ExperimentPlanItem[];
  readonly avoidanceGuidance: readonly AvoidanceGuidanceItem[];
  readonly unknowns: readonly PrescriptionUnknownItem[];
  readonly evidenceStates: readonly EvidenceStateEntry[];
  readonly actionIds: readonly string[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly changeSummary?: PrescriptionDelta;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/* ========================================================================
 * REFRESH
 * ===================================================================== */

export type PrescriptionRefreshTrigger =
  | 'significant_new_finding'
  | 'genome_evidence_newly_applicable'
  | 'failed_transfer'
  | 'audience_shift'
  | 'offer_change'
  | 'mission_change'
  | 'finding_decay'
  | 'experiment_completion'
  | 'objective_metric_deterioration'
  | 'platform_allocation_evidence';

export type RefreshVerdict = 'current' | 'refresh_recommended' | 'refresh_required';

export interface PrescriptionRefreshAssessment {
  readonly verdict: RefreshVerdict;
  readonly triggers: readonly PrescriptionRefreshTrigger[];
  readonly reasons: readonly string[];
  readonly assessedAt: IsoDateTime;
}

/* ========================================================================
 * DECISION CYCLE
 * ===================================================================== */

/** A deterministic read of the current situation. Business language, not medical. */
export type DiagnosticCode =
  | 'objective_metric_improving'
  | 'objective_metric_deteriorating'
  | 'experiment_incomplete'
  | 'evidence_contradictory'
  | 'audience_divergence'
  | 'capacity_exceeded'
  | 'offer_missing'
  | 'attribution_unavailable'
  | 'platform_under_tested'
  | 'finding_stale'
  | 'insufficient_evidence'
  | 'no_action_needed';

export interface AgentDiagnostic {
  readonly code: DiagnosticCode;
  readonly detail: string;
  readonly evidenceRefs?: AgentEvidenceRefs;
}

export interface AgentDecisionCycleResult {
  readonly id: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly ranAt: IsoDateTime;
  readonly diagnostics: readonly AgentDiagnostic[];
  readonly proposedActionIds: readonly string[];
  /** Actions the agent wanted but a constraint blocked, with the reason. */
  readonly blockedActions: readonly { readonly actionType: AgentActionType; readonly reason: string }[];
  readonly evidenceStateSummary: EvidenceStateSummary;
  readonly prescriptionRefresh: PrescriptionRefreshAssessment;
  readonly humanInputRequired: boolean;
  readonly decisionSummary: string;
  /** When the agent should next be run. Advisory — no scheduler here. */
  readonly nextReviewTrigger: string;
  readonly schemaVersion: number;
}

/* ========================================================================
 * EXECUTION HANDOFF
 * ===================================================================== */

export type ExecutionType = 'publish_post' | 'schedule_post' | 'reply_comment' | 'send_dm' | 'other';

export type HandoffStatus = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'cancelled';

/**
 * The boundary object. The intelligence layer PREPARES this; CreatorOS
 * executes it. Nothing here calls a platform API, mints a token or
 * schedules anything.
 */
export interface CreatorOsExecutionHandoff {
  readonly id: string;
  readonly agentActionId: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly profileId: string;
  /** The canonical CreatorOS account reference, carried through unchanged. */
  readonly creatorOsAccountId: string;
  readonly platform: Platform;
  readonly executionType: ExecutionType;
  /** Structured intent for CreatorOS. Never a platform API payload. */
  readonly payload: Readonly<Record<string, string | number | boolean>>;
  readonly scheduledAt?: IsoDateTime;
  readonly status: HandoffStatus;
  /** Ids returned by CreatorOS, linking forward to measurement. */
  readonly creatorOsPostId?: string;
  readonly measurementRefs?: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/* ========================================================================
 * CONTENT GENERATION BOUNDARY
 * ===================================================================== */

/**
 * A brief, not content. The agent describes what should be made and on what
 * evidence; an implementation behind an interface may later generate it.
 *
 * **Generated wording is execution material, never evidence** — a hook
 * pattern being supported does not make a specific sentence supported.
 */
export interface ContentBrief {
  readonly id: string;
  readonly agentId: string;
  readonly profileId: string;
  readonly platform: Platform;
  readonly objective: GrowthObjective;
  readonly hookFamily?: string;
  readonly contentFormat?: string;
  readonly ctaType?: string;
  readonly topic?: string;
  readonly audienceSegmentId?: string;
  readonly brandConstraints: readonly string[];
  readonly evidenceRefs: AgentEvidenceRefs;
  readonly evidenceState: EvidenceState;
  readonly notes: string;
  readonly createdAt: IsoDateTime;
}

/* ========================================================================
 * READ MODELS
 * ===================================================================== */

/** The machine-readable answer to "what should I post today?". */
export interface TodaysPlan {
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly profileId: string;
  readonly date: IsoDateTime;
  readonly missionStatement?: string;
  readonly prescriptionId?: string;
  readonly actions: readonly AgentAction[];
  readonly contentBriefs: readonly ContentBrief[];
  readonly experimentContext: readonly string[];
  readonly evidenceStateSummary: EvidenceStateSummary;
  readonly approvalsRequired: readonly string[];
  /** True when doing nothing today is the correct answer. */
  readonly noActionRecommended: boolean;
  readonly summary: string;
}

/** What the agent has taken off the customer's plate. No fabricated savings. */
export interface DecisionLoadSummary {
  readonly actionsPrepared: number;
  readonly actionsAwaitingApproval: number;
  readonly experimentsRunning: number;
  readonly decisionsDeferredForEvidence: number;
  readonly strategiesAvoided: number;
  readonly unknownsRequiringCustomerInput: number;
}

/** The current operating picture. References and summaries, never bulk copies. */
export interface AgentState {
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly status: AgentStatus;
  readonly autonomyLevel: AutonomyLevel;
  readonly mission?: AgentMission;
  readonly currentPrescriptionId?: string;
  readonly personalizationMaturity?: PersonalizationMaturity;
  readonly activeExperimentIds: readonly string[];
  readonly nextBestActionId?: string;
  readonly pendingApprovalActionIds: readonly string[];
  readonly evidenceStateSummary: EvidenceStateSummary;
  readonly blockers: readonly string[];
  readonly constraints: readonly ActionConstraint[];
  readonly businessOutcomeState: BusinessOutcomeState;
  readonly decisionLoad: DecisionLoadSummary;
  readonly lastUpdatedAt: IsoDateTime;
}

/**
 * Business outcomes, sourced ONLY from first-party attribution.
 * Never inferred from platform analytics — see §31 and Milestone 6.
 */
export interface BusinessOutcomeState {
  readonly leads: number;
  readonly sales: number;
  readonly revenue: number;
  readonly currency?: string;
  /** How much of the above can actually be attributed to social activity. */
  readonly attributionQuality: 'none' | 'partial' | 'good' | 'unknown';
  readonly unattributedNote: string;
  readonly evidenceState: EvidenceState;
}

/** A serializable snapshot for later PDF, email, portal or API delivery. No PDF here. */
export interface PrescriptionExport {
  readonly prescriptionId: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly generatedAt: IsoDateTime;
  readonly missionStatement?: string;
  readonly personalizationMaturity: PersonalizationMaturity;
  readonly platformStrategy: readonly PlatformAllocation[];
  readonly audienceStrategy: AudienceStrategy;
  readonly contentStrategy: readonly ContentStrategyItem[];
  readonly hookStrategy: readonly ContentStrategyItem[];
  readonly avoidanceGuidance: readonly AvoidanceGuidanceItem[];
  readonly experimentPlan: readonly ExperimentPlanItem[];
  readonly unknowns: readonly PrescriptionUnknownItem[];
  readonly evidenceStateSummary: EvidenceStateSummary;
  readonly limitations: readonly AnalysisLimitation[];
  readonly changeSummary?: PrescriptionDelta;
  /** Peer evidence is described in aggregate; no peer business is ever named. */
  readonly peerEvidenceNote: string;
}

/* ========================================================================
 * CHANGE LOG
 * ===================================================================== */

export type AgentChangeType =
  | 'prescription_changed'
  | 'platform_allocation_changed'
  | 'strategy_stopped'
  | 'audience_priority_changed'
  | 'mission_changed'
  | 'autonomy_changed'
  | 'permission_changed'
  | 'experiment_started'
  | 'experiment_completed'
  | 'human_override'
  | 'action_status_changed';

/** Structured memory of what changed and why — the basis of "what changed?" in the UI. */
export interface AgentChangeRecord {
  readonly id: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly changeType: AgentChangeType;
  readonly summary: string;
  readonly before?: string;
  readonly after?: string;
  readonly reason: string;
  readonly evidenceRefs?: AgentEvidenceRefs;
  readonly actor: ActorRef;
  readonly occurredAt: IsoDateTime;
  readonly schemaVersion: number;
}

/* ========================================================================
 * POLICY DEFAULTS
 * ===================================================================== */

/** Empty evidence refs, for the common case. */
export const EMPTY_EVIDENCE_REFS: AgentEvidenceRefs = {
  findingIds: [],
  segmentFindingIds: [],
  genomePatternIds: [],
  transferAssessmentIds: [],
  strategyRecommendationIds: [],
  experimentIds: [],
  hypothesisIds: [],
};

/**
 * Conservative defaults. **`copilot`, never `autonomous_lab`** — the agent
 * analyzes and prepares, a human approves execution. Spend and offer
 * changes are typed `false` and cannot be enabled.
 */
export function defaultPermissionPolicy(agentId: string, now: IsoDateTime, workspaceId?: string): AgentPermissionPolicy {
  return {
    id: `perm_${agentId}`,
    agentId,
    workspaceId,
    autonomyLevel: 'copilot',
    contentGenerationAllowed: true,
    schedulingAllowed: false,
    publishingAllowed: false,
    engagementExecutionAllowed: false,
    experimentCreationAllowed: true,
    experimentExecutionAllowed: false,
    strategyAllocationChangesAllowed: false,
    platformAllocationChangesAllowed: false,
    spendActionsAllowed: false,
    offerChangesAllowed: false,
    approvalRequiredAtOrAbove: 'medium',
    updatedAt: now,
    schemaVersion: 1,
  };
}
