/**
 * Deterministic helpers over strategy claims and research sources —
 * Milestone 5, Step 23. Pure grouping/counting/filtering only. No AI, no
 * embeddings, no semantic deduplication or matching: two sources making the
 * "same" claim in different words remain two independent pieces of
 * provenance, never silently merged.
 */
import type { IsoDateTime, KnowledgeSourceType, Platform } from '../common/types.js';
import type {
  ClaimType,
  ResearchSource,
  StrategyClaim,
} from './types.js';
import type { StrategyPrinciple } from '../strategy/types.js';

/**
 * Maps the granular `ResearchSourceType` onto the four-value authority tier
 * `KnowledgeSourceType` (`common/types.ts`) a `StrategyPrinciple` actually
 * carries. Deterministic and total — every `ResearchSourceType` has exactly
 * one tier. `kairos_experiment` is the only tier that reaches `'experiment'`;
 * everything else starts no higher than `'playbook'`, `'platform'` or
 * `'research'` — never automatically promoted.
 */
export function deriveKnowledgeSourceType(sourceType: ResearchSource['sourceType']): KnowledgeSourceType {
  switch (sourceType) {
    case 'platform_documentation':
      return 'platform';
    case 'research_report':
    case 'observational_dataset':
      return 'research';
    case 'kairos_experiment':
      return 'experiment';
    case 'creator':
    case 'marketer':
    case 'agency':
    case 'course':
    case 'book':
    case 'video':
    case 'community':
    case 'creatoros_skill':
    case 'internal_note':
    case 'other':
      return 'playbook';
    default: {
      const exhaustive: never = sourceType;
      throw new Error(`unhandled research source type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The honest default causal status for a freshly captured claim. Never
 * `'causal_supported'` here — a source using causal language does not, on
 * its own, earn that status. Only `experimental_claim` starts above
 * `'unproven'`, and even then only at `'experimental_support'`, not
 * `'causal_supported'` — a caller may still explicitly assert
 * `'causal_supported'` at ingestion, but this function will never produce
 * it, so nothing gets there by accident.
 */
export function deriveDefaultCausalStatus(claimType: ClaimType): 'unproven' | 'correlational' | 'experimental_support' | 'not_applicable' {
  switch (claimType) {
    case 'observed_association':
      return 'correlational';
    case 'experimental_claim':
      return 'experimental_support';
    case 'opinion':
    case 'heuristic':
      return 'not_applicable';
    case 'playbook_claim':
    case 'platform_claim':
    case 'research_claim':
      return 'unproven';
    default: {
      const exhaustive: never = claimType;
      throw new Error(`unhandled claim type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Groups claims by `claimType`. */
export function groupClaimsByClaimType(claims: readonly StrategyClaim[]): Record<string, StrategyClaim[]> {
  const groups: Record<string, StrategyClaim[]> = {};
  for (const claim of claims) {
    (groups[claim.claimType] ??= []).push(claim);
  }
  return groups;
}

/**
 * Groups claims by platform. A claim naming multiple platforms appears in
 * each of their buckets; a claim naming none goes to `'unscoped'` — never
 * fabricated into a specific platform.
 */
export function groupClaimsByPlatform(claims: readonly StrategyClaim[]): Record<string, StrategyClaim[]> {
  const groups: Record<string, StrategyClaim[]> = {};
  for (const claim of claims) {
    const platforms: readonly (Platform | 'unscoped')[] = claim.platforms?.length ? claim.platforms : ['unscoped'];
    for (const platform of platforms) {
      (groups[platform] ??= []).push(claim);
    }
  }
  return groups;
}

/**
 * Groups claims by their caller-supplied `topicKey` — plain string
 * equality, no semantic matching. This is how conflicting advice ("post
 * once daily" vs. "post 10 times daily") is clustered before any
 * `StrategyPrinciple` formally exists to group it; claims with no
 * `topicKey` land under `'unassigned'`.
 */
export function groupClaimsByTopicKey(claims: readonly StrategyClaim[]): Record<string, StrategyClaim[]> {
  const groups: Record<string, StrategyClaim[]> = {};
  for (const claim of claims) {
    const key = claim.topicKey ?? 'unassigned';
    (groups[key] ??= []).push(claim);
  }
  return groups;
}

/** How many claims support vs. contradict one principle, by id — a plain count, no weighting. */
export function countSupportingVsContradictingClaims(principle: StrategyPrinciple): { supporting: number; contradicting: number } {
  return {
    supporting: principle.supportingClaimIds?.length ?? 0,
    contradicting: principle.contradictingClaimIds?.length ?? 0,
  };
}

/**
 * Claims not yet referenced by any principle's supporting/contradicting
 * lists, and not already marked `mapped_to_hypothesis` — candidates for a
 * human or future process to map onto a `StrategyPrinciple`.
 */
export function identifyUnmappedCandidateClaims(
  claims: readonly StrategyClaim[],
  principles: readonly StrategyPrinciple[],
): StrategyClaim[] {
  const mappedIds = new Set<string>();
  for (const principle of principles) {
    for (const id of principle.supportingClaimIds ?? []) mappedIds.add(id);
    for (const id of principle.contradictingClaimIds ?? []) mappedIds.add(id);
  }
  return claims.filter((c) => c.status !== 'mapped_to_hypothesis' && !mappedIds.has(c.id));
}

/**
 * Sources not reviewed (or, absent any review, not published) within
 * `maxAgeMs` of `now` — and not already `deprecatedAt`. `now` is an
 * explicit parameter rather than read from the clock, so this stays a pure,
 * testable function.
 */
export function identifyStaleSources(
  sources: readonly ResearchSource[],
  now: IsoDateTime,
  maxAgeMs: number,
): ResearchSource[] {
  const nowMs = Date.parse(now);
  return sources.filter((source) => {
    if (source.deprecatedAt) return false;
    const referenceDate = source.lastReviewedAt ?? source.publishedAt;
    if (!referenceDate) return false;
    const referenceMs = Date.parse(referenceDate);
    if (Number.isNaN(referenceMs)) return false;
    return nowMs - referenceMs > maxAgeMs;
  });
}

/** Deduplicates by `id`, keeping the last occurrence — the same exact-id-upsert semantics storage uses. */
export function dedupeById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}
