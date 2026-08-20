/**
 * Deterministic Genome aggregation.
 *
 * Every formula here is an OPERATIONAL HEURISTIC, not a scientific law, and
 * every threshold is configurable via `GenomePolicy`. Nothing in this file
 * produces a probability, and nothing calls an LLM, embedding or similarity
 * model.
 *
 * THE REPLICATION RULE
 * ------------------------------------------------------------------------
 * Two things are counted separately and neither substitutes for the other:
 *
 *   - **Independent evidence** — deduplicated by lineage, so a measurement,
 *     its experiment, a finding built from it and a transfer derived from
 *     that finding are ONE piece of evidence, not four.
 *   - **Distinct profiles and experiments** — because 100 observations from
 *     one profile is a fundamentally weaker claim than 100 observations
 *     spread across 20 independent profiles, and one large experiment must
 *     not masquerade as many replications.
 *
 * Promotion past `emerging` is gated on the second, not the first.
 */
import { daysBetween } from '../science/statistics.js';
import type { AnalysisLimitation } from '../science/types.js';
import { countIndependentEvidence } from './lineage.js';
import type {
  GenomeEvidenceReference,
  GenomeEvidenceSummary,
  GenomeEvidenceType,
  GenomeFreshness,
  GenomePatternStatus,
  GenomePolicy,
} from './types.js';

/** Adapts a `GenomeEvidenceReference` to the minimal shape `lineage.ts` counts over. */
function asLineageItem(reference: GenomeEvidenceReference) {
  return { recordId: reference.recordId, lineageRoots: reference.lineageRoots };
}

/** Distinct profiles contributing evidence. Undeclared profiles are not counted. */
export function countDistinctProfiles(evidence: readonly GenomeEvidenceReference[]): number {
  return new Set(evidence.map((e) => e.profileId).filter((id): id is string => id !== undefined)).size;
}

/** Distinct experiments contributing evidence. */
export function countDistinctExperiments(evidence: readonly GenomeEvidenceReference[]): number {
  return new Set(evidence.map((e) => e.experimentId).filter((id): id is string => id !== undefined)).size;
}

/**
 * Builds the counted evidence picture.
 *
 * Supporting and contradicting counts are over INDEPENDENT evidence
 * (lineage-deduplicated); profile and experiment counts are over the full
 * set, since a profile appearing across several derived records is still
 * one profile.
 */
export function summarizeEvidence(
  supporting: readonly GenomeEvidenceReference[],
  contradicting: readonly GenomeEvidenceReference[],
): GenomeEvidenceSummary {
  const supportingCount = countIndependentEvidence(supporting.map(asLineageItem));
  const contradictingCount = countIndependentEvidence(contradicting.map(asLineageItem));
  const total = supportingCount + contradictingCount;
  const all = [...supporting, ...contradicting];

  return {
    supportingCount,
    contradictingCount,
    distinctProfileCount: countDistinctProfiles(all),
    distinctExperimentCount: countDistinctExperiments(all),
    // Share pointing the dominant direction. 0 when there is no evidence.
    directionalConsistency: total === 0 ? 0 : Math.max(supportingCount, contradictingCount) / total,
    contradictionRatio: total === 0 ? 0 : contradictingCount / total,
    evidenceTypes: [...new Set(all.map((e) => e.evidenceType))],
  };
}

/**
 * Freshness from the most recent observation.
 *
 * Mirrors the Science Engine's `current` / `due_for_revalidation` /
 * `decaying` vocabulary rather than inventing a competing decay model.
 */
export function assessGenomeFreshness(
  lastObservedAt: string | undefined,
  now: string,
  policy: GenomePolicy,
): GenomeFreshness {
  if (!lastObservedAt) return 'decaying';
  const age = daysBetween(lastObservedAt, now);
  if (age >= policy.decayAfterDays) return 'decaying';
  if (age >= policy.revalidationAfterDays) return 'due_for_revalidation';
  return 'current';
}

/**
 * Operational confidence, 0..1.
 *
 * **Not a probability.** A deliberately conservative weighted blend of five
 * documented terms, chosen so that cross-profile replication dominates:
 *
 *   - profile replication  0.30  saturating at `minimumProfilesForSupported`
 *   - experiment replication 0.20 saturating at `minimumExperimentsForSupported`
 *   - evidence volume      0.15  saturating, diminishing returns
 *   - directional consistency 0.25 rescaled so an even split contributes 0
 *   - recency              0.10  current / due / decaying
 *
 * Then multiplied by a contradiction damper, so heavily contested evidence
 * cannot score highly however plentiful it is.
 *
 * Deliberately NOT an average of source confidences: averaging lets many
 * weak, mutually-dependent records inflate a score, which is precisely the
 * failure this design exists to prevent.
 */
export function computeOperationalConfidence(input: {
  readonly summary: GenomeEvidenceSummary;
  readonly freshness: GenomeFreshness;
  readonly policy: GenomePolicy;
}): number {
  const { summary, freshness, policy } = input;
  const total = summary.supportingCount + summary.contradictingCount;
  if (total === 0) return 0;

  const profileTerm = Math.min(1, summary.distinctProfileCount / Math.max(1, policy.minimumProfilesForSupported));
  const experimentTerm = Math.min(1, summary.distinctExperimentCount / Math.max(1, policy.minimumExperimentsForSupported));
  const volumeTerm = total / (total + 5);
  // Rescale 0.5..1 onto 0..1 so evenly-split evidence contributes nothing.
  const consistencyTerm = Math.max(0, (summary.directionalConsistency - 0.5) * 2);
  const recencyTerm = freshness === 'current' ? 1 : freshness === 'due_for_revalidation' ? 0.6 : 0.3;

  const base =
    profileTerm * 0.3 + experimentTerm * 0.2 + volumeTerm * 0.15 + consistencyTerm * 0.25 + recencyTerm * 0.1;

  // Contradiction damper: at the contested ratio, confidence is halved.
  const damper = 1 - Math.min(1, summary.contradictionRatio / Math.max(0.01, policy.contestedContradictionRatio)) * 0.5;

  return Math.max(0, Math.min(1, base * damper));
}

/**
 * Assigns lifecycle status.
 *
 * Order matters and encodes the conservatism:
 *
 *   1. No evidence            → `emerging`
 *   2. Contradiction at or above the contested ratio → `contested`
 *      (checked BEFORE promotion, so contradicted evidence can never be
 *      called supported however much of it there is)
 *   3. Stale                  → `decaying`
 *   4. Clears profile + experiment + consistency bars → `supported`
 *   5. Clears the profile bar only → `promising`
 *   6. Otherwise              → `emerging`
 *
 * Promotion is **not monotonic**: this runs on every evaluation, so a
 * previously supported pattern that accumulates contradiction or goes stale
 * will be re-assigned downward.
 */
export function determineStatus(input: {
  readonly summary: GenomeEvidenceSummary;
  readonly freshness: GenomeFreshness;
  readonly policy: GenomePolicy;
  /** A deprecated pattern stays deprecated until explicitly revived. */
  readonly currentStatus?: GenomePatternStatus;
}): { status: GenomePatternStatus; rationale: string } {
  const { summary, freshness, policy } = input;
  const total = summary.supportingCount + summary.contradictingCount;

  if (input.currentStatus === 'deprecated') {
    return { status: 'deprecated', rationale: 'Pattern was explicitly deprecated; it is retained but not promoted.' };
  }

  if (total < policy.minimumEvidenceForEmerging || total === 0) {
    return { status: 'emerging', rationale: 'Not enough independent evidence to say anything yet.' };
  }

  if (summary.contradictionRatio >= policy.contestedContradictionRatio) {
    return {
      status: 'contested',
      rationale: `${summary.contradictingCount} of ${total} independent pieces of evidence contradict this pattern (ratio ${summary.contradictionRatio.toFixed(2)} at or above the contested threshold ${policy.contestedContradictionRatio}). Substantial disagreement exists.`,
    };
  }

  if (freshness === 'decaying') {
    return {
      status: 'decaying',
      rationale: `Most recent supporting observation is older than the ${policy.decayAfterDays}-day decay window. Evidence is retained but should be re-tested before reuse.`,
    };
  }

  const meetsProfiles = summary.distinctProfileCount >= policy.minimumProfilesForSupported;
  const meetsExperiments = summary.distinctExperimentCount >= policy.minimumExperimentsForSupported;
  const meetsConsistency = summary.directionalConsistency >= policy.minimumDirectionalConsistency;

  if (meetsProfiles && meetsExperiments && meetsConsistency) {
    return {
      status: 'supported',
      rationale: `Replicated across ${summary.distinctProfileCount} distinct profiles and ${summary.distinctExperimentCount} distinct experiments with ${(summary.directionalConsistency * 100).toFixed(0)}% directional consistency. Supported WITHIN THIS CONTEXT only.`,
    };
  }

  if (summary.distinctProfileCount >= policy.minimumProfilesForPromising && meetsConsistency) {
    return {
      status: 'promising',
      rationale: `Replicated across ${summary.distinctProfileCount} distinct profiles (needs ${policy.minimumProfilesForSupported} profiles and ${policy.minimumExperimentsForSupported} experiments for support).`,
    };
  }

  return {
    status: 'emerging',
    rationale:
      summary.distinctProfileCount <= 1
        ? `All evidence comes from ${summary.distinctProfileCount} profile. Cross-profile replication is required before promotion.`
        : `Evidence is present but has not cleared the promotion bar (${summary.distinctProfileCount} profiles, ${summary.distinctExperimentCount} experiments, ${(summary.directionalConsistency * 100).toFixed(0)}% consistency).`,
  };
}

/** Limitations implied by the shape of the evidence, merged with those the evidence declares. */
export function deriveGenomeLimitations(
  supporting: readonly GenomeEvidenceReference[],
  contradicting: readonly GenomeEvidenceReference[],
  summary: GenomeEvidenceSummary,
  policy: GenomePolicy,
): AnalysisLimitation[] {
  const limitations = new Set<AnalysisLimitation>();
  if (summary.supportingCount + summary.contradictingCount < policy.minimumProfilesForSupported) {
    limitations.add('small_sample');
  }
  if (summary.distinctProfileCount <= 1) limitations.add('unmatched_comparison');
  if (summary.contradictionRatio > 0) limitations.add('large_variance');
  for (const reference of [...supporting, ...contradicting]) {
    for (const limitation of reference.limitations) limitations.add(limitation);
  }
  return [...limitations];
}

/**
 * Free-text caveats naming what must NOT be generalized from this pattern.
 * Generated deterministically from the context's own narrowness — the more
 * specific the evidence, the more explicit the warning against widening it.
 */
export function deriveCaveats(input: {
  readonly summary: GenomeEvidenceSummary;
  readonly platforms?: readonly string[];
  readonly niches?: readonly string[];
  readonly objectives?: readonly string[];
  readonly audienceDescriptors?: readonly string[];
  readonly offerTypes?: readonly string[];
}): string[] {
  const caveats: string[] = [];

  if (input.objectives?.length) {
    caveats.push(
      `Evidence concerns the ${input.objectives.join(', ')} objective only. It says nothing about other objectives — engagement evidence is not commercial evidence.`,
    );
  }
  if (input.platforms?.length === 1) {
    caveats.push(`Observed on ${input.platforms[0]} only. Cross-platform transfer is not established.`);
  }
  if (input.niches?.length === 1) {
    caveats.push(`Observed in the ${input.niches[0]} niche only. Do not widen to adjacent niches without evidence.`);
  }
  if (input.audienceDescriptors?.length) {
    caveats.push(`Scoped to the observed audience context (${input.audienceDescriptors.join(', ')}).`);
  }
  if (input.offerTypes?.length) {
    caveats.push(`Scoped to ${input.offerTypes.join(', ')} offers; other offer types may behave differently.`);
  }
  if (input.summary.distinctProfileCount <= 1) {
    caveats.push('All evidence originates from a single profile. This is not cross-profile knowledge.');
  }
  if (input.summary.distinctExperimentCount <= 1 && input.summary.supportingCount > 1) {
    caveats.push('Repeated observations come from a single experiment and are not independent replications.');
  }
  return caveats;
}

/** Evidence types present, for provenance without exposing records. */
export function provenanceTypes(
  supporting: readonly GenomeEvidenceReference[],
  contradicting: readonly GenomeEvidenceReference[],
): GenomeEvidenceType[] {
  return [...new Set([...supporting, ...contradicting].map((e) => e.evidenceType))];
}
