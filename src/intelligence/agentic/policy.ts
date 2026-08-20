/**
 * Autonomy, risk and approval policy. Pure, deterministic, no I/O, no AI.
 *
 * THE BOUNDING RULE (§42)
 * ------------------------------------------------------------------------
 * Agent autonomy is always bounded by policy. The agent may never spend
 * money, change offers or pricing, alter its own mission, raise its own
 * autonomy level, bypass CreatorOS, or touch a controlled experiment's
 * variables. Those are not discouraged — they are structurally unreachable
 * through this module.
 */
import type {
  ActionConstraint,
  ActionRiskClass,
  AgentActionType,
  AgentPermissionPolicy,
  AutonomyLevel,
  EvidenceOrigin,
  EvidenceState,
} from './types.js';

/** Autonomy ordered by latitude, for threshold comparisons. */
const AUTONOMY_ORDER: readonly AutonomyLevel[] = ['advisor', 'copilot', 'operator', 'autonomous_lab'];

/** Risk ordered by severity. */
const RISK_ORDER: readonly ActionRiskClass[] = ['low', 'medium', 'high', 'restricted'];

export function autonomyRank(level: AutonomyLevel): number {
  return AUTONOMY_ORDER.indexOf(level);
}

export function riskRank(risk: ActionRiskClass): number {
  return RISK_ORDER.indexOf(risk);
}

/**
 * The inherent risk of an action type.
 *
 * `restricted` actions touch money, offers or unsupported operations and can
 * never execute automatically at any autonomy level.
 */
export function classifyActionRisk(actionType: AgentActionType): ActionRiskClass {
  switch (actionType) {
    // Preparation and analysis — nothing leaves the building.
    case 'generate_content':
    case 'collect_more_evidence':
    case 'wait_for_evidence':
    case 'request_human_input':
      return 'low';

    // Reversible operational moves.
    case 'approve_content':
    case 'continue_experiment':
    case 'revalidate_finding':
    case 'test_hook':
    case 'test_cta':
    case 'test_format':
    case 'target_segment':
      return 'medium';

    // Material strategy changes.
    case 'run_experiment':
    case 'adjust_content_mix':
    case 'adjust_platform_allocation':
    case 'pause_strategy':
    case 'stop_strategy':
      return 'high';

    // Touches the offer — the customer's commercial decision, never the agent's.
    case 'test_offer':
      return 'restricted';

    case 'other':
    default:
      // Unknown intent is treated as the most dangerous thing it could be.
      return 'restricted';
  }
}

/** Whether the permission policy allows this action type at all. */
export function isActionPermitted(
  actionType: AgentActionType,
  policy: AgentPermissionPolicy,
): { permitted: boolean; reason: string } {
  switch (actionType) {
    case 'generate_content':
      return policy.contentGenerationAllowed
        ? { permitted: true, reason: 'Content generation is permitted.' }
        : { permitted: false, reason: 'Content generation is not permitted for this workspace.' };
    case 'approve_content':
      return policy.schedulingAllowed || policy.publishingAllowed
        ? { permitted: true, reason: 'Scheduling or publishing is permitted.' }
        : { permitted: false, reason: 'Neither scheduling nor publishing is permitted for this workspace.' };
    case 'run_experiment':
      return policy.experimentCreationAllowed
        ? { permitted: true, reason: 'Experiment creation is permitted.' }
        : { permitted: false, reason: 'Experiment creation is not permitted for this workspace.' };
    case 'continue_experiment':
      return policy.experimentExecutionAllowed || policy.experimentCreationAllowed
        ? { permitted: true, reason: 'Experiment operation is permitted.' }
        : { permitted: false, reason: 'Experiment execution is not permitted for this workspace.' };
    case 'adjust_content_mix':
      return policy.strategyAllocationChangesAllowed
        ? { permitted: true, reason: 'Strategy allocation changes are permitted.' }
        : { permitted: false, reason: 'Strategy allocation changes require human action.' };
    case 'adjust_platform_allocation':
      return policy.platformAllocationChangesAllowed
        ? { permitted: true, reason: 'Platform allocation changes are permitted.' }
        : { permitted: false, reason: 'Platform allocation changes require human action.' };
    case 'test_offer':
      // Structurally false — the type forbids enabling it.
      return { permitted: false, reason: 'Offer changes are never permitted to the agent.' };
    default:
      return { permitted: true, reason: 'Analysis-only action.' };
  }
}

/**
 * Whether an action needs a human before it can execute.
 *
 * Requires approval when ANY of:
 *   - autonomy is `advisor` (the agent only ever advises),
 *   - the action's risk meets or exceeds the policy threshold,
 *   - the risk is `restricted` (always, at every autonomy level),
 *   - autonomy is `copilot` and the action does anything beyond preparation.
 *
 * `autonomous_lab` still cannot self-approve a `restricted` action.
 */
export function requiresApproval(input: {
  readonly actionType: AgentActionType;
  readonly riskClass: ActionRiskClass;
  readonly policy: AgentPermissionPolicy;
}): { required: boolean; reason: string } {
  const { actionType, riskClass, policy } = input;

  if (riskClass === 'restricted') {
    return { required: true, reason: 'Restricted actions always require human approval and can never auto-execute.' };
  }

  if (policy.autonomyLevel === 'advisor') {
    return { required: true, reason: 'Advisor mode: the agent recommends; a human performs execution.' };
  }

  if (riskRank(riskClass) >= riskRank(policy.approvalRequiredAtOrAbove)) {
    return {
      required: true,
      reason: `Risk class "${riskClass}" is at or above the workspace approval threshold "${policy.approvalRequiredAtOrAbove}".`,
    };
  }

  const preparationOnly: readonly AgentActionType[] = [
    'generate_content', 'collect_more_evidence', 'wait_for_evidence', 'request_human_input',
  ];
  if (policy.autonomyLevel === 'copilot' && !preparationOnly.includes(actionType)) {
    return { required: true, reason: 'Copilot mode: the agent prepares; a human approves execution.' };
  }

  return { required: false, reason: `Permitted without approval at autonomy level "${policy.autonomyLevel}".` };
}

/**
 * Whether an approved action may produce a CreatorOS handoff.
 *
 * A handoff needs BOTH an approved action AND a permission that covers it.
 * Approval alone is not enough: a workspace with publishing disabled cannot
 * dispatch, however enthusiastically a human clicked approve.
 */
export function canHandOffToCreatorOs(input: {
  readonly actionStatus: string;
  readonly actionType: AgentActionType;
  readonly riskClass: ActionRiskClass;
  readonly policy: AgentPermissionPolicy;
}): { allowed: boolean; reason: string } {
  if (input.actionStatus !== 'approved' && input.actionStatus !== 'queued') {
    return { allowed: false, reason: `Action is "${input.actionStatus}"; only an approved action may be handed off.` };
  }
  if (input.riskClass === 'restricted') {
    return { allowed: false, reason: 'Restricted actions are never handed off for execution.' };
  }
  if (!policyCoversExecution(input.actionType, input.policy)) {
    return { allowed: false, reason: 'Workspace permissions do not cover executing this action type.' };
  }
  return { allowed: true, reason: 'Approved and permitted.' };
}

function policyCoversExecution(actionType: AgentActionType, policy: AgentPermissionPolicy): boolean {
  if (actionType === 'approve_content') return policy.schedulingAllowed || policy.publishingAllowed;
  if (actionType === 'generate_content') return policy.contentGenerationAllowed;
  if (actionType === 'run_experiment' || actionType === 'continue_experiment') {
    return policy.experimentExecutionAllowed;
  }
  return false;
}

/**
 * Whether a proposed action would disturb a running controlled experiment.
 *
 * Reuses the locked-variable concept from Adaptive Strategy and the Battle
 * Engine rather than re-deriving it: the caller supplies the locked set, and
 * this decides. While a controlled test runs, waiting can be the correct
 * action.
 */
export function violatesActiveExperiment(input: {
  readonly actionType: AgentActionType;
  readonly touchedVariables: readonly string[];
  readonly lockedVariables: readonly string[];
}): { violates: boolean; reason: string; violated: readonly string[] } {
  const locked = new Set(input.lockedVariables);
  const violated = input.touchedVariables.filter((v) => locked.has(v));
  if (violated.length > 0) {
    return {
      violates: true,
      reason: `A controlled experiment is running; ${violated.join(', ')} ${violated.length === 1 ? 'is' : 'are'} locked for its duration.`,
      violated,
    };
  }
  // Changing the content mix or platform split mid-experiment perturbs it
  // even when no named variable collides.
  const perturbing: readonly AgentActionType[] = ['adjust_content_mix', 'adjust_platform_allocation'];
  if (input.lockedVariables.length > 0 && perturbing.includes(input.actionType)) {
    return {
      violates: true,
      reason: `"${input.actionType}" would perturb a running controlled experiment.`,
      violated: [],
    };
  }
  return { violates: false, reason: 'No conflict with a running experiment.', violated: [] };
}

/**
 * Derives the evidence state for a subject from where its evidence came from
 * and how strong it is.
 *
 * **`know` is reserved for first-party validation.** Transferred, Genome and
 * research evidence reach `suspect` at most, however confident they look —
 * this is the structural guarantee behind §7 and §117.
 */
export function deriveEvidenceState(input: {
  readonly origin: EvidenceOrigin;
  readonly isValidated: boolean;
  readonly confidence?: number;
  readonly hasActiveExperiment?: boolean;
  readonly isStopped?: boolean;
  readonly minimumConfidenceToKnow?: number;
}): { state: EvidenceState; rationale: string } {
  const threshold = input.minimumConfidenceToKnow ?? 0.7;

  if (input.isStopped) {
    return { state: 'stopped', rationale: 'Deliberately deprioritized after prior evidence.' };
  }

  if (input.origin === 'none') {
    return { state: 'unknown', rationale: 'No relevant evidence for this profile.' };
  }

  const isFirstParty = input.origin === 'first_party_finding' || input.origin === 'segment_finding';

  if (isFirstParty && input.isValidated && (input.confidence ?? 0) >= threshold) {
    return { state: 'know', rationale: 'Validated on this profile with sufficient confidence.' };
  }

  if (input.hasActiveExperiment) {
    return { state: 'test', rationale: 'An experiment is currently resolving this question.' };
  }

  if (isFirstParty) {
    return { state: 'suspect', rationale: 'Promising first-party evidence, not yet validated.' };
  }

  // Transferred, Genome and research evidence stop here by design.
  return {
    state: 'suspect',
    rationale:
      input.origin === 'transfer_assessment'
        ? 'Supported by comparable profiles; not yet tested on this profile.'
        : input.origin === 'genome_pattern'
          ? 'Supported by cross-profile Genome evidence; not yet tested on this profile.'
          : 'Research-informed candidate; not yet tested on this profile.',
  };
}

/** Constraints derived from mission and capacity, for attaching to an action. */
export function deriveMissionConstraints(input: {
  readonly maxPostsPerDay?: number;
  readonly topicsToAvoid: readonly string[];
  readonly platformScope: readonly string[];
  readonly proposedPlatform?: string;
}): ActionConstraint[] {
  const constraints: ActionConstraint[] = [];

  if (input.maxPostsPerDay !== undefined) {
    constraints.push({
      source: 'capacity',
      description: `Mission caps output at ${input.maxPostsPerDay} post(s) per day.`,
      blocking: false,
    });
  }
  if (input.topicsToAvoid.length > 0) {
    constraints.push({
      source: 'brand',
      description: `Brand rules exclude: ${input.topicsToAvoid.join('; ')}.`,
      blocking: false,
    });
  }
  if (
    input.proposedPlatform !== undefined &&
    input.platformScope.length > 0 &&
    !input.platformScope.includes(input.proposedPlatform)
  ) {
    constraints.push({
      source: 'mission',
      description: `${input.proposedPlatform} is outside this mission's platform scope.`,
      blocking: true,
    });
  }
  return constraints;
}

/**
 * Personalization maturity from the evidence mix.
 *
 * Deliberately evidence-derived, never day-count-derived: a profile running
 * many experiments matures faster than one posting quietly for months.
 */
export function derivePersonalizationMaturity(input: {
  readonly validatedFirstPartyCount: number;
  readonly promisingFirstPartyCount: number;
  readonly experimentCount: number;
  readonly transferredCount: number;
  readonly genomeCount: number;
}): 'cold_start' | 'transferred_intelligence' | 'mixed_evidence' | 'profile_informed' | 'highly_profile_specific' {
  const firstParty = input.validatedFirstPartyCount + input.promisingFirstPartyCount;
  const external = input.transferredCount + input.genomeCount;

  if (firstParty === 0 && external === 0) return 'cold_start';
  if (firstParty === 0) return 'transferred_intelligence';
  if (input.validatedFirstPartyCount >= 5 && input.experimentCount >= 5) return 'highly_profile_specific';
  if (input.validatedFirstPartyCount >= 2) return 'profile_informed';
  return 'mixed_evidence';
}
