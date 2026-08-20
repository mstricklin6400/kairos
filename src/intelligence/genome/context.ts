/**
 * Genome context and its deterministic signature.
 *
 * A `GenomeContext` records the CONDITIONS under which evidence was
 * observed. It is the reason the Genome can never say "hook X works" — a
 * pattern is only ever a claim about a context, and the context travels
 * with it everywhere.
 *
 * THE SIGNATURE CONTRACT
 * ------------------------------------------------------------------------
 * Two contexts describing the same conditions must produce the same
 * signature regardless of array ordering, duplicates or casing. Two
 * contexts describing DIFFERENT conditions must never collide.
 *
 * Normalization is deliberately shallow: trim, lowercase, dedupe, sort,
 * drop empties. It does NOT attempt to decide that "bookkeeping" and
 * "accounting" mean the same thing — that would be semantic matching, which
 * §11 forbids and which is exactly how false generalization happens.
 * **Prefer under-generalization over false generalization.**
 *
 * Pure functions only. No I/O, no AI, no embeddings.
 */
import type { GrowthObjective, Platform } from '../common/types.js';
import type { ContentFormat, HookFamily } from '../common/types.js';

/**
 * Known conditions for a pattern. Every dimension is optional and an
 * ABSENT dimension means unknown — never "all values". A pattern observed
 * on Twitter with no niche recorded is a claim about Twitter, not a claim
 * about every niche on Twitter.
 *
 * Arrays rather than scalars because a pattern can legitimately replicate
 * across several platforms or objectives, and collapsing that to one value
 * would lose the fact that it replicated.
 */
export interface GenomeContext {
  readonly platforms?: readonly Platform[];
  readonly niches?: readonly string[];
  readonly subNiches?: readonly string[];
  /** Aggregate, behavioral audience descriptors. Never individual dossiers, never sensitive traits. */
  readonly audienceDescriptors?: readonly string[];
  readonly objectives?: readonly GrowthObjective[];
  readonly contentFormats?: readonly ContentFormat[];
  readonly contentPillars?: readonly string[];
  readonly hookFamilies?: readonly HookFamily[];
  readonly ctaTypes?: readonly string[];
  /** Offer category, e.g. `lead-magnet`, `high-ticket-service`. */
  readonly offerTypes?: readonly string[];
  /** Where in the funnel the evidence sits, e.g. `awareness`, `consideration`, `conversion`. */
  readonly funnelStages?: readonly string[];
  /** Named experimental treatment, when the evidence came from a controlled test. */
  readonly experimentTreatments?: readonly string[];
}

/** The dimensions of a context, in stable signature order. */
export const CONTEXT_DIMENSIONS = [
  'platforms',
  'niches',
  'subNiches',
  'audienceDescriptors',
  'objectives',
  'contentFormats',
  'contentPillars',
  'hookFamilies',
  'ctaTypes',
  'offerTypes',
  'funnelStages',
  'experimentTreatments',
] as const;

export type ContextDimension = (typeof CONTEXT_DIMENSIONS)[number];

/**
 * Normalizes one dimension's values: trim, drop empties, lowercase, dedupe,
 * sort. Returns `undefined` for an absent or entirely-empty dimension so
 * "unknown" stays distinguishable from "empty list".
 */
export function normalizeDimension(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const cleaned = [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))].sort();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Normalizes a whole context. Dimensions that normalize to nothing are
 * omitted entirely rather than kept as empty arrays — absent means unknown.
 */
export function normalizeContext(context: GenomeContext): GenomeContext {
  const normalized: Record<string, readonly string[]> = {};
  for (const dimension of CONTEXT_DIMENSIONS) {
    const values = normalizeDimension(context[dimension] as readonly string[] | undefined);
    if (values) normalized[dimension] = values;
  }
  return normalized as GenomeContext;
}

/**
 * A deterministic, order-independent signature for a context.
 *
 * Format: `dimension=value|value;dimension=value` over normalized
 * dimensions in fixed order. Absent dimensions are omitted, so
 * `platforms=twitter` and `platforms=twitter;niches=bookkeeping` are
 * distinct signatures — the second is a narrower claim, and the Genome
 * must not treat them as the same pattern.
 *
 * An entirely empty context yields `'*'`, meaning "no conditions recorded".
 * That is a legitimate but very weak claim, and callers should treat it as
 * such.
 */
export function contextSignature(context: GenomeContext): string {
  const normalized = normalizeContext(context);
  const parts: string[] = [];
  for (const dimension of CONTEXT_DIMENSIONS) {
    const values = normalized[dimension] as readonly string[] | undefined;
    if (values && values.length > 0) parts.push(`${dimension}=${values.join('|')}`);
  }
  return parts.length > 0 ? parts.join(';') : '*';
}

/** Whether two contexts describe identical conditions. */
export function contextsMatch(a: GenomeContext, b: GenomeContext): boolean {
  return contextSignature(a) === contextSignature(b);
}

/** The dimensions a context actually records — everything else is unknown. */
export function knownDimensions(context: GenomeContext): ContextDimension[] {
  const normalized = normalizeContext(context);
  return CONTEXT_DIMENSIONS.filter((d) => (normalized[d] as readonly string[] | undefined)?.length);
}

/** The dimensions a context leaves unrecorded. Reported honestly rather than filled in. */
export function unknownDimensions(context: GenomeContext): ContextDimension[] {
  const known = new Set(knownDimensions(context));
  return CONTEXT_DIMENSIONS.filter((d) => !known.has(d));
}

/**
 * Whether `candidate` is at least as specific as `required` on every
 * dimension `required` records — i.e. whether a pattern learned in
 * `candidate` conditions is a possible answer to a question about
 * `required` conditions.
 *
 * Deliberately conservative: a dimension the candidate does not record is
 * NOT treated as a match. A pattern with no niche recorded does not answer
 * a bookkeeping-specific question; it answers a broader, weaker one, and
 * the caller is told which dimensions went unmatched.
 */
export function contextCovers(
  candidate: GenomeContext,
  required: GenomeContext,
): { covers: boolean; matched: ContextDimension[]; unmatched: ContextDimension[]; unspecified: ContextDimension[] } {
  const c = normalizeContext(candidate);
  const r = normalizeContext(required);

  const matched: ContextDimension[] = [];
  const unmatched: ContextDimension[] = [];
  const unspecified: ContextDimension[] = [];

  for (const dimension of CONTEXT_DIMENSIONS) {
    const wanted = r[dimension] as readonly string[] | undefined;
    if (!wanted) continue;
    const have = c[dimension] as readonly string[] | undefined;
    if (!have) {
      // The pattern does not record this dimension. Unknown, not a match.
      unspecified.push(dimension);
      continue;
    }
    const haveSet = new Set(have);
    if (wanted.some((v) => haveSet.has(v))) matched.push(dimension);
    else unmatched.push(dimension);
  }

  return { covers: unmatched.length === 0 && matched.length > 0, matched, unmatched, unspecified };
}

/**
 * Merges two contexts for aggregation — the union per dimension.
 *
 * Only ever called when the caller has already established that both
 * contexts describe the same pattern; merging is how cross-platform or
 * cross-niche replication gets recorded on a single pattern. It never
 * decides on its own that two contexts belong together.
 */
export function mergeContexts(a: GenomeContext, b: GenomeContext): GenomeContext {
  const merged: Record<string, readonly string[]> = {};
  const na = normalizeContext(a);
  const nb = normalizeContext(b);
  for (const dimension of CONTEXT_DIMENSIONS) {
    const va = (na[dimension] as readonly string[] | undefined) ?? [];
    const vb = (nb[dimension] as readonly string[] | undefined) ?? [];
    const union = normalizeDimension([...va, ...vb]);
    if (union) merged[dimension] = union;
  }
  return merged as GenomeContext;
}
