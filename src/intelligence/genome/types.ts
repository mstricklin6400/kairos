/**
 * The Social Genome — Kairos's structured, evidence-backed, cross-profile
 * knowledge layer.
 *
 * It answers: *what has the system learned across profiles, experiments,
 * audiences, platforms, niches, offers, objectives and contexts — and under
 * what conditions does that knowledge appear to hold?*
 *
 * WHAT IT IS NOT
 * ------------------------------------------------------------------------
 * Not a viral-hook list, best-practice database, prompt library, template
 * collection, leaderboard, or universal strategy system. Not a way to copy
 * one customer's strategy into another. Not a claim that correlation is
 * causation.
 *
 * THE CONDITIONALITY RULE
 * ------------------------------------------------------------------------
 * The unit of Genome knowledge is never "Hook X works." It is:
 *
 *   "Hook family X has shown positive evidence for objective Y, on platform
 *    Z, among profiles with characteristics C, under conditions D, with
 *    evidence strength E, while contradictory evidence exists under
 *    conditions F."
 *
 * A `GenomePattern` cannot exist without its `GenomeContext`, and
 * `status: 'supported'` never means universal truth — only that the
 * evidence within that context has cleared a documented operational bar.
 *
 * BOUNDARIES
 * ------------------------------------------------------------------------
 *   GENOME    "What has been learned across contexts?"
 *   TRANSFER  "How applicable might this be here?"        (Milestone 10)
 *   SCIENCE   "How strong is the evidence?"               (Milestone 7)
 *   ADAPTIVE  "What should we do next?"                   (Milestone 8)
 *   PRESCRIPTION "What do we recommend for this business?" (Milestone 12)
 *
 * The Genome supplies CANDIDATE knowledge. It never outputs "Sarah should
 * post this today", and it never decides applicability to a target profile.
 */
import type { Confidence, GrowthObjective, IsoDateTime } from '../common/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { GenomeContext } from './context.js';

export type { GenomeContext } from './context.js';

/**
 * Where a piece of Genome evidence came from. Preserves source identity so
 * a research claim is never mistaken for cross-profile validation.
 */
export type GenomeEvidenceType =
  | 'finding'
  | 'segment_finding'
  | 'experiment'
  | 'hypothesis_evidence'
  | 'battle_result'
  | 'transfer_assessment'
  | 'strategy_claim'
  | 'measurement';

/** Which way a piece of evidence points relative to the pattern's claim. */
export type EvidenceDirection = 'supporting' | 'contradicting';

/**
 * A reference to evidence, carrying enough lineage to audit why a pattern
 * exists — WITHOUT embedding the private record itself.
 *
 * This is the privacy seam. `profileId` and `experimentId` are retained for
 * internal aggregation (distinct-source counting needs them) but are never
 * surfaced through the public query path — see `PublicGenomePattern`.
 * Copyrighted research excerpts and raw customer content are never copied
 * here; a short neutral `summary` and identifiers are the most that travels.
 */
export interface GenomeEvidenceReference {
  readonly id: string;
  readonly evidenceType: GenomeEvidenceType;
  /** Id of the underlying record in its own store. */
  readonly recordId: string;
  readonly direction: EvidenceDirection;
  /** Internal only — used for distinct-profile replication counting, never exposed publicly. */
  readonly profileId?: string;
  /** Internal only — used for distinct-experiment replication counting. */
  readonly experimentId?: string;
  /**
   * Primitive evidence ids this derives from, so a measurement, the
   * experiment it belongs to, the finding built from it and a transfer
   * derived from that finding count as ONE piece of evidence rather than
   * four. See `lineage.ts`.
   */
  readonly lineageRoots: readonly string[];
  /** A short, neutral description. Never raw private content or copyrighted text. */
  readonly summary?: string;
  readonly observedAt?: IsoDateTime;
  readonly recordedAt: IsoDateTime;
  readonly limitations: readonly AnalysisLimitation[];
  /** Battle provenance, when the evidence came from a competition. */
  readonly battleSeasonId?: string;
  readonly battleProtocolVersion?: string;
}

/**
 * A pattern's lifecycle standing.
 *
 * `supported` is the strongest state and still does NOT mean universal
 * truth — it means the evidence within this pattern's context cleared the
 * policy bar. `contested` is a first-class outcome, not a failure state:
 * substantial contradictory evidence is a real finding about the world.
 * Neither `decaying` nor `deprecated` deletes anything.
 */
export type GenomePatternStatus =
  | 'emerging'
  | 'promising'
  | 'supported'
  | 'contested'
  | 'decaying'
  | 'deprecated';

/** How fresh a pattern's evidence is. Reuses the Science Engine's vocabulary. */
export type GenomeFreshness = 'current' | 'due_for_revalidation' | 'decaying';

/**
 * The counted, decomposed evidence picture behind a pattern. Exposed rather
 * than folded into one number so any judgment can be re-derived.
 */
export interface GenomeEvidenceSummary {
  /** Independent supporting evidence, deduplicated by lineage. */
  readonly supportingCount: number;
  readonly contradictingCount: number;
  /** Distinct profiles contributing evidence. Cross-profile replication is the strongest signal here. */
  readonly distinctProfileCount: number;
  /** Distinct experiments contributing evidence — one big experiment is not many replications. */
  readonly distinctExperimentCount: number;
  /** Share of evidence pointing the same way, 0..1. */
  readonly directionalConsistency: number;
  /** Contradicting / total, 0..1. */
  readonly contradictionRatio: number;
  readonly evidenceTypes: readonly GenomeEvidenceType[];
}

/**
 * One conditional pattern.
 *
 * `objective` is a first-class field, not merely context: §15 makes
 * objective specificity mandatory. A pattern supported for `reach` is NOT
 * a pattern supported for `revenue`, and the model refuses to let those be
 * the same record.
 */
export interface GenomePattern {
  readonly id: string;
  /** Conservative and conditional. Never "X works". */
  readonly statement: string;
  readonly status: GenomePatternStatus;
  readonly context: GenomeContext;
  /** Deterministic, order-independent key for this pattern's conditions. */
  readonly contextSignature: string;
  /** The objective this pattern is about. Kept explicit — see §15. */
  readonly objective?: GrowthObjective;
  /** Operational confidence, 0..1. NOT a probability — see `aggregate.ts`. */
  readonly confidence: Confidence;
  readonly evidenceSummary: GenomeEvidenceSummary;
  readonly supportingEvidence: readonly GenomeEvidenceReference[];
  readonly contradictingEvidence: readonly GenomeEvidenceReference[];
  readonly sourceProfileCount: number;
  readonly sourceExperimentCount: number;
  readonly firstObservedAt: IsoDateTime;
  readonly lastObservedAt: IsoDateTime;
  readonly lastEvaluatedAt: IsoDateTime;
  readonly freshness: GenomeFreshness;
  readonly limitations: readonly AnalysisLimitation[];
  /** Free-text caveats beyond the structured limitation vocabulary. */
  readonly caveats: readonly string[];
  /** Why the current status was assigned, composed deterministically. */
  readonly statusRationale: string;
  readonly version: number;
  /** The pattern version this replaced. Earlier versions are retained. */
  readonly supersedesPatternId?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * The public face of a pattern — what a general query returns.
 *
 * Deliberately a DIFFERENT type from `GenomePattern`, not a filtered view of
 * it, so cross-customer leakage is a compile error rather than a review
 * oversight. Evidence appears only as counts and types; no `profileId`,
 * `experimentId`, `recordId` or evidence summary text crosses this boundary.
 *
 * A caller learns `sourceProfileCount: 17` and never which seventeen.
 */
export interface PublicGenomePattern {
  readonly id: string;
  readonly statement: string;
  readonly status: GenomePatternStatus;
  readonly context: GenomeContext;
  readonly contextSignature: string;
  readonly objective?: GrowthObjective;
  readonly confidence: Confidence;
  readonly evidenceSummary: GenomeEvidenceSummary;
  readonly sourceProfileCount: number;
  readonly sourceExperimentCount: number;
  readonly firstObservedAt: IsoDateTime;
  readonly lastObservedAt: IsoDateTime;
  readonly lastEvaluatedAt: IsoDateTime;
  readonly freshness: GenomeFreshness;
  readonly limitations: readonly AnalysisLimitation[];
  readonly caveats: readonly string[];
  readonly statusRationale: string;
  readonly version: number;
}

/** A query for candidate knowledge. Every filter optional. */
export interface GenomeQuery {
  readonly platform?: string;
  readonly niche?: string;
  readonly objective?: GrowthObjective;
  readonly hookFamily?: string;
  readonly contentFormat?: string;
  readonly audienceDescriptor?: string;
  readonly offerType?: string;
  readonly funnelStage?: string;
  readonly status?: GenomePatternStatus;
  readonly minimumConfidence?: number;
  /** Only patterns observed at or after this timestamp. */
  readonly observedSince?: IsoDateTime;
  readonly freshness?: GenomeFreshness;
  readonly limit?: number;
}

/**
 * One candidate result. **Candidate knowledge, not a prescription** — the
 * Transfer Engine decides applicability to any particular profile, and
 * `requiresTransferAssessment` says so on every result.
 */
export interface GenomeQueryMatch {
  readonly pattern: PublicGenomePattern;
  readonly matchedDimensions: readonly string[];
  readonly unmatchedDimensions: readonly string[];
  /** Dimensions the pattern does not record — unknown, never assumed to match. */
  readonly unspecifiedDimensions: readonly string[];
  /** Always true. The Genome never asserts applicability to a target profile. */
  readonly requiresTransferAssessment: true;
}

export interface GenomeQueryResult {
  readonly query: GenomeQuery;
  readonly matches: readonly GenomeQueryMatch[];
  readonly insufficientEvidence: boolean;
  readonly summary: string;
  readonly evaluatedAt: IsoDateTime;
}

/** The full "why does the system believe this?" answer. */
export interface GenomePatternExplanation {
  readonly patternId: string;
  readonly statement: string;
  readonly status: GenomePatternStatus;
  readonly statusRationale: string;
  readonly operationalConfidence: Confidence;
  /** Stated plainly so nobody reads the number as a probability. */
  readonly confidenceCaveat: string;
  readonly knownContext: GenomeContext;
  readonly unknownContextDimensions: readonly string[];
  readonly supportingEvidenceSummary: string;
  readonly contradictingEvidenceSummary: string;
  readonly distinctProfileCount: number;
  readonly distinctExperimentCount: number;
  readonly freshness: GenomeFreshness;
  readonly firstObservedAt: IsoDateTime;
  readonly lastObservedAt: IsoDateTime;
  readonly limitations: readonly AnalysisLimitation[];
  readonly caveats: readonly string[];
  /** Evidence types behind the pattern, without exposing which records. */
  readonly provenance: readonly GenomeEvidenceType[];
  readonly whatShouldNotBeGeneralized: readonly string[];
}

/**
 * Configurable thresholds.
 *
 * **These are operational starting points, not scientific laws.** They
 * encode a deliberately conservative stance: cross-profile replication is
 * what earns promotion, and a single prolific profile cannot promote a
 * pattern on its own.
 */
export interface GenomePolicy {
  /** Independent evidence needed before a pattern exists at all. */
  readonly minimumEvidenceForEmerging: number;
  readonly minimumProfilesForPromising: number;
  readonly minimumProfilesForSupported: number;
  readonly minimumExperimentsForSupported: number;
  /** Share of evidence that must point the same way for `supported`, 0..1. */
  readonly minimumDirectionalConsistency: number;
  /** Contradiction ratio at or above which a pattern is `contested`, 0..1. */
  readonly contestedContradictionRatio: number;
  readonly decayAfterDays: number;
  readonly revalidationAfterDays: number;
  readonly policyVersion: string;
}

/**
 * Conservative defaults.
 *
 * `minimumProfilesForSupported: 3` and `minimumExperimentsForSupported: 3`
 * together encode the core stance: three independent profiles and three
 * independent experiments before anything is called supported. One profile
 * with a hundred observations reaches `emerging` at best.
 */
export const DEFAULT_GENOME_POLICY: GenomePolicy = {
  minimumEvidenceForEmerging: 1,
  minimumProfilesForPromising: 2,
  minimumProfilesForSupported: 3,
  minimumExperimentsForSupported: 3,
  minimumDirectionalConsistency: 0.7,
  contestedContradictionRatio: 0.35,
  decayAfterDays: 180,
  revalidationAfterDays: 90,
  policyVersion: 'genome-v2',
};
