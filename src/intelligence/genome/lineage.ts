/**
 * Lineage-aware evidence handling — the piece of the Genome that stops the
 * same fact being counted several times.
 *
 * THE PROBLEM
 * ------------------------------------------------------------------------
 * One experiment produces a `PostMeasurement`. The Science Engine turns that
 * into an `ExperimentObservation` and then a `Finding`. Intelligence
 * Transfer builds a `TransferAssessment` from that `Finding`. A Social
 * Prescription cites the assessment.
 *
 * That is FIVE records and ONE piece of evidence. A Genome that counted
 * records would report five-fold support for a claim resting on a single
 * experiment — which is how a system talks itself into false confidence.
 *
 * THE RULE
 * ------------------------------------------------------------------------
 * Every `GenomeEvidence` declares `lineageRoots`: the primitive evidence ids
 * it ultimately derives from. Independent-evidence counts are computed over
 * the **union of those roots**, never over record count. Two records sharing
 * a root are one piece of evidence; two records with disjoint roots are two.
 *
 * Pure functions only — no I/O, no AI.
 */
import { daysBetween } from '../science/statistics.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { EvidenceSourceClass } from '../transfer/types.js';
import type {
  GenomeConfidence,
  GenomeConsistency,
  GenomeEvidence,
  GenomeFreshness,
  GenomePolicy,
} from './types.js';

/**
 * The number of INDEPENDENT pieces of evidence in a set — the size of the
 * union of all lineage roots.
 *
 * Evidence with no declared roots falls back to its own record id, so an
 * unlinked record still counts once rather than vanishing.
 */
export function countIndependentEvidence(evidence: readonly GenomeEvidence[]): number {
  return collectLineageRoots(evidence).size;
}

/** The union of every lineage root in a set. */
export function collectLineageRoots(evidence: readonly GenomeEvidence[]): Set<string> {
  const roots = new Set<string>();
  for (const item of evidence) {
    if (item.lineageRoots.length === 0) {
      // No declared lineage — treat the record itself as its own root so it
      // is counted exactly once and never silently dropped.
      roots.add(`record:${item.recordId}`);
      continue;
    }
    for (const root of item.lineageRoots) roots.add(root);
  }
  return roots;
}

/** Whether two evidence items rest on any shared primitive evidence. */
export function sharesLineage(a: GenomeEvidence, b: GenomeEvidence): boolean {
  const aRoots = a.lineageRoots.length > 0 ? a.lineageRoots : [`record:${a.recordId}`];
  const bRoots = new Set(b.lineageRoots.length > 0 ? b.lineageRoots : [`record:${b.recordId}`]);
  return aRoots.some((root) => bRoots.has(root));
}

/** Source classes ordered by how directly they evidence a claim. */
const SOURCE_CLASS_PRIORITY: Readonly<Record<EvidenceSourceClass, number>> = {
  first_party: 6,
  matched_peer: 5,
  niche: 4,
  platform: 3,
  cross_niche: 2,
  research: 1,
};

/**
 * Collapses evidence that shares lineage down to one representative per
 * lineage group, keeping the most direct record.
 *
 * Given a first-party `Finding` and a `TransferAssessment` derived from it,
 * the finding survives: it is the more direct record, and keeping both would
 * double-count the same experiment.
 */
export function deduplicateByLineage(evidence: readonly GenomeEvidence[]): GenomeEvidence[] {
  // Union-find over shared lineage roots, so chains (A shares with B, B
  // shares with C) collapse into a single group even when A and C don't
  // directly overlap.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const item of evidence) {
    const roots = item.lineageRoots.length > 0 ? item.lineageRoots : [`record:${item.recordId}`];
    for (const root of roots) if (!parent.has(root)) parent.set(root, root);
    for (let i = 1; i < roots.length; i += 1) union(roots[0]!, roots[i]!);
  }

  const bestByGroup = new Map<string, GenomeEvidence>();
  for (const item of evidence) {
    const roots = item.lineageRoots.length > 0 ? item.lineageRoots : [`record:${item.recordId}`];
    const group = find(roots[0]!);
    const incumbent = bestByGroup.get(group);
    if (
      !incumbent ||
      SOURCE_CLASS_PRIORITY[item.sourceClass] > SOURCE_CLASS_PRIORITY[incumbent.sourceClass]
    ) {
      bestByGroup.set(group, item);
    }
  }
  return [...bestByGroup.values()];
}

/**
 * How much the evidence agrees with itself, measured over INDEPENDENT
 * evidence so a single experiment echoed through four layers cannot
 * manufacture apparent consensus.
 */
export function assessConsistency(
  supporting: readonly GenomeEvidence[],
  contradicting: readonly GenomeEvidence[],
  policy: GenomePolicy,
): GenomeConsistency {
  const supportCount = countIndependentEvidence(supporting);
  const contradictCount = countIndependentEvidence(contradicting);
  const total = supportCount + contradictCount;
  if (total === 0) return 'insufficient';
  if (contradictCount === 0) return supportCount > 0 ? 'consistent' : 'insufficient';
  if (supportCount === 0) return 'contradicted';

  const share = supportCount / total;
  if (share >= policy.consistencyThreshold) return 'consistent';
  if (share <= 1 - policy.consistencyThreshold) return 'contradicted';
  // Genuinely split. Averaging this away would erase the disagreement.
  return 'mixed';
}

/** Freshness from the most recent validation across a pattern's evidence. */
export function assessFreshness(
  lastValidatedAt: string | undefined,
  now: string,
  policy: GenomePolicy,
): GenomeFreshness {
  if (!lastValidatedAt) return 'stale';
  const age = daysBetween(lastValidatedAt, now);
  if (age >= policy.staleDays) return 'stale';
  if (age >= policy.agingDays) return 'aging';
  return 'current';
}

/**
 * Operational confidence for a pattern, decomposed so it can be explained.
 *
 * Every volume term uses INDEPENDENT evidence counts. A pattern echoed
 * through five derived records but resting on one experiment scores as one
 * experiment's worth of confidence.
 */
export function computeGenomeConfidence(input: {
  readonly supporting: readonly GenomeEvidence[];
  readonly contradicting: readonly GenomeEvidence[];
  readonly lastValidatedAt?: string;
  readonly now: string;
  readonly policy: GenomePolicy;
}): GenomeConfidence {
  const supportingCount = countIndependentEvidence(input.supporting);
  const contradictingCount = countIndependentEvidence(input.contradicting);
  const independentEvidenceCount = countIndependentEvidence([...input.supporting, ...input.contradicting]);
  const consistency = assessConsistency(input.supporting, input.contradicting, input.policy);
  const freshness = assessFreshness(input.lastValidatedAt, input.now, input.policy);

  // Saturating volume term over independent evidence.
  const volume = independentEvidenceCount / (independentEvidenceCount + 5);
  const consistencyFactor =
    consistency === 'consistent' ? 1 : consistency === 'mixed' ? 0.4 : consistency === 'contradicted' ? 0.1 : 0;
  const freshnessFactor = freshness === 'current' ? 1 : freshness === 'aging' ? 0.7 : 0.4;

  const score = Math.max(0, Math.min(1, volume * consistencyFactor * freshnessFactor));

  return {
    score,
    independentEvidenceCount,
    supportingCount,
    contradictingCount,
    consistency,
    freshness,
    rationale: `${independentEvidenceCount} independent piece(s) of evidence (${supportingCount} supporting, ${contradictingCount} contradicting); evidence is ${consistency} and ${freshness}.`,
  };
}

/** Limitations implied by the shape of a pattern's evidence. */
export function deriveEvidenceLimitations(
  evidence: readonly GenomeEvidence[],
  policy: GenomePolicy,
): AnalysisLimitation[] {
  const limitations = new Set<AnalysisLimitation>();
  if (countIndependentEvidence(evidence) < policy.minimumIndependentEvidenceForPromotion) {
    limitations.add('small_sample');
  }
  for (const item of evidence) {
    for (const limitation of item.limitations) limitations.add(limitation);
  }
  return [...limitations];
}
