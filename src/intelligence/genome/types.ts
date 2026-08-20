/**
 * Social Genome Foundation — Milestone 12.
 *
 * A structured, evidence-backed map of relationships among:
 *
 *   PROFILE × PLATFORM × NICHE × AUDIENCE × OBJECTIVE × OFFER ×
 *   ACCOUNT STAGE × CONTENT × HOOK × FORMAT × CTA × CADENCE ×
 *   EXPERIMENTAL CONDITIONS × OUTCOME
 *
 * It answers: *what tends to work, for whom, where, under what conditions,
 * for which objective, and with what evidence?*
 *
 * THE SAFEGUARD THIS MODULE IS BUILT AROUND
 * ------------------------------------------------------------------------
 * **The Genome is not a universal "best strategy" table.** Conditionality is
 * preserved everywhere:
 *
 *   BAD:  "Question hooks work."
 *   GOOD: "Question-led hooks are associated with higher reply rates under
 *          these observed conditions, with these limitations."
 *
 * Every `GenomePattern` is inseparable from its `GenomeContext`. There is no
 * way to express a context-free claim in this model.
 *
 * NO DOUBLE COUNTING
 * ------------------------------------------------------------------------
 * The same underlying evidence surfaces through several derived layers — a
 * raw measurement, an experiment observation, a finding built from it, and
 * a transfer assessment built from that finding are FOUR records but ONE
 * piece of evidence. Every `GenomeEvidence` therefore declares its
 * `lineageRoots`, and independent-evidence counts are computed over the
 * union of those roots rather than over record count. See `lineage.ts`.
 *
 * PRIVACY
 * ------------------------------------------------------------------------
 * The Genome is not a people database. It holds aggregate, marketing-relevant
 * behavioral relationships. No type here carries a sensitive personal
 * characteristic, and there is no per-individual record of any kind.
 */
import type {
  AccountStage,
  Confidence,
  ContentFormat,
  GrowthObjective,
  HookFamily,
  IsoDateTime,
  Platform,
} from '../common/types.js';
import type { PerformanceMetric } from '../performance/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { EvidenceSourceClass } from '../transfer/types.js';
import type { BattleEvidenceReference } from '../battle/types.js';

/**
 * The conditions a pattern was observed under. Every field is optional and
 * **missing data stays missing** — an absent dimension is unknown, never a
 * wildcard and never a default. A context with only `platform` set is a
 * claim about that platform and nothing else.
 */
export interface GenomeContext {
  readonly platform?: Platform;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly audienceSegmentId?: string;
  readonly objective?: GrowthObjective;
  readonly offerType?: string;
  readonly businessModel?: string;
  readonly accountStage?: AccountStage;
  readonly contentPillarId?: string;
  readonly topic?: string;
  readonly contentFormat?: ContentFormat;
  readonly hookFamily?: HookFamily;
  readonly ctaType?: string;
  readonly cadence?: string;
  readonly experimentTreatment?: string;
}

/** What kind of thing a node represents in the evidence graph. */
export type GenomeNodeKind =
  | 'platform'
  | 'niche'
  | 'audience_segment'
  | 'objective'
  | 'offer_type'
  | 'account_stage'
  | 'content_pillar'
  | 'topic'
  | 'content_format'
  | 'hook_family'
  | 'cta'
  | 'cadence'
  | 'treatment'
  | 'metric'
  | 'outcome';

/** One dimension value in the graph. */
export interface GenomeNode {
  readonly id: string;
  readonly kind: GenomeNodeKind;
  readonly value: string;
  readonly label?: string;
}

/** How strongly and in which direction an outcome moved. */
export type GenomeOutcomeDirection = 'increase' | 'decrease' | 'no_change' | 'mixed';

/** The measured result a pattern is about. */
export interface GenomeOutcome {
  readonly metric: PerformanceMetric;
  readonly direction: GenomeOutcomeDirection;
  /** Relative change where computable. Absent rather than zero when undefined. */
  readonly relativeChange?: number;
}

/**
 * A directed relationship between two nodes, carrying the evidence that
 * justifies it. Edges make the graph traversable; patterns make it
 * interpretable.
 */
export interface GenomeEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relation: 'observed_with' | 'associated_with' | 'contradicted_by';
  readonly patternId: string;
  readonly evidenceIds: readonly string[];
}

/**
 * One piece of evidence behind a pattern, with the lineage needed to avoid
 * double counting.
 *
 * `lineageRoots` names the PRIMITIVE evidence this record ultimately derives
 * from — normally experiment ids, or measurement ids where no experiment
 * exists. A finding built from `exp_1`, and a transfer assessment built from
 * that finding, both carry `lineageRoots: ['exp_1']`, so together they count
 * as one piece of evidence, not two.
 */
export interface GenomeEvidence {
  readonly id: string;
  readonly sourceClass: EvidenceSourceClass;
  readonly recordType: 'finding' | 'segment_finding' | 'experiment' | 'measurement' | 'transfer_assessment' | 'research_claim';
  readonly recordId: string;
  /** The primitive evidence ids this derives from. The basis of all deduplication. */
  readonly lineageRoots: readonly string[];
  readonly supports: boolean;
  readonly confidence?: Confidence;
  readonly sampleSize?: number;
  readonly observedAt?: IsoDateTime;
  readonly lastValidatedAt?: IsoDateTime;
  readonly limitations: readonly AnalysisLimitation[];
  /** Retained in full when the evidence came from a battle. */
  readonly battleProvenance?: BattleEvidenceReference;
}

/**
 * The scope a pattern is currently claimed at. Evidence is **never
 * automatically promoted** up this ladder — widening a claim requires
 * explicit justification against `GenomePolicy`, via
 * `SocialGenomeEngine.promotePattern`.
 */
export type GenomeScopeLevel =
  | 'profile'
  | 'segment'
  | 'cohort'
  | 'niche'
  | 'platform_niche'
  | 'platform'
  | 'cross_niche';

/** Whether the evidence for a pattern agrees with itself. */
export type GenomeConsistency = 'consistent' | 'mixed' | 'contradicted' | 'insufficient';

/** How fresh a pattern's evidence is. */
export type GenomeFreshness = 'current' | 'aging' | 'stale';

/**
 * Operational confidence in a pattern. Deliberately decomposed rather than a
 * single opaque number, and explicitly not a statistical probability.
 */
export interface GenomeConfidence {
  readonly score: Confidence;
  /** Distinct lineage roots behind the pattern — NOT the record count. */
  readonly independentEvidenceCount: number;
  readonly supportingCount: number;
  readonly contradictingCount: number;
  readonly consistency: GenomeConsistency;
  readonly freshness: GenomeFreshness;
  readonly rationale: string;
}

/**
 * A conditional relationship: this outcome, under these conditions, with
 * this evidence.
 *
 * The pattern statement and its `context` are inseparable — reading the
 * statement without the context is reading it wrong, and there is no field
 * in which a context-free version of the claim can be stored.
 */
export interface GenomePattern {
  readonly id: string;
  /** Conservative and conditional. Never "X works". */
  readonly statement: string;
  readonly context: GenomeContext;
  readonly outcome: GenomeOutcome;
  readonly scopeLevel: GenomeScopeLevel;
  /** The profile this was observed on, when scope is profile-level. */
  readonly profileId?: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly confidence: GenomeConfidence;
  readonly firstObservedAt: IsoDateTime;
  readonly lastObservedAt: IsoDateTime;
  readonly lastValidatedAt?: IsoDateTime;
  /** Free-text marker for the platform era the evidence belongs to, e.g. an algorithm change. */
  readonly platformEra?: string;
  readonly limitations: readonly AnalysisLimitation[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/** A query against the Genome. Every filter is optional; omitted means unconstrained. */
export interface GenomeQuery {
  readonly platform?: Platform;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly audienceSegmentId?: string;
  readonly objective?: GrowthObjective;
  readonly accountStage?: AccountStage;
  readonly hookFamily?: HookFamily;
  readonly contentFormat?: ContentFormat;
  readonly metric?: PerformanceMetric;
  readonly scopeLevel?: GenomeScopeLevel;
  readonly profileId?: string;
  /** Only return patterns whose evidence agrees. */
  readonly consistentOnly?: boolean;
  readonly limit?: number;
}

/** How well a pattern's context matched the query. */
export type ContextMatchQuality = 'exact' | 'partial' | 'broader' | 'unknown';

/**
 * One query result. Carries not just the pattern but how well it matched,
 * which dimensions were unspecified, and what the evidence disagrees about.
 */
export interface GenomeMatch {
  readonly pattern: GenomePattern;
  readonly contextMatch: ContextMatchQuality;
  readonly matchedDimensions: readonly string[];
  readonly unspecifiedDimensions: readonly string[];
  readonly supportingEvidence: readonly GenomeEvidence[];
  readonly contradictingEvidence: readonly GenomeEvidence[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly freshness: GenomeFreshness;
  /** Set when the pattern comes from a different context and would need transfer assessment. */
  readonly requiresTransferAssessment: boolean;
}

/** The answer to a query, including the honest "we don't know" case. */
export interface GenomeQueryResult {
  readonly query: GenomeQuery;
  readonly matches: readonly GenomeMatch[];
  /** True when nothing in the Genome addresses the question. */
  readonly insufficientEvidence: boolean;
  readonly summary: string;
  readonly limitations: readonly AnalysisLimitation[];
  readonly evaluatedAt: IsoDateTime;
}

/**
 * A point-in-time capture of what the intelligence base believed.
 *
 * Answers "what did Kairos believe as of version X" — and the Genome never
 * silently rewrites history, so an old snapshot stays interpretable against
 * the policy version that produced it.
 */
export interface GenomeSnapshot {
  readonly id: string;
  readonly version: number;
  readonly takenAt: IsoDateTime;
  readonly patternIds: readonly string[];
  /** Pattern id → the confidence it held at snapshot time. */
  readonly patternConfidence: Readonly<Record<string, number>>;
  readonly patternCount: number;
  readonly note?: string;
  readonly policyVersion: string;
  readonly schemaVersion: number;
}

/** Configurable thresholds. Operational assumptions, not measured facts. */
export interface GenomePolicy {
  /** Distinct lineage roots required before a pattern may be promoted beyond profile scope. */
  readonly minimumIndependentEvidenceForPromotion: number;
  /** Distinct profiles required before a pattern may claim niche scope or wider. */
  readonly minimumProfilesForNicheScope: number;
  /** Share of supporting evidence at or above which a pattern reads `consistent`. */
  readonly consistencyThreshold: number;
  readonly agingDays: number;
  readonly staleDays: number;
  readonly policyVersion: string;
}

export const DEFAULT_GENOME_POLICY: GenomePolicy = {
  minimumIndependentEvidenceForPromotion: 3,
  minimumProfilesForNicheScope: 3,
  consistencyThreshold: 0.75,
  agingDays: 90,
  staleDays: 180,
  policyVersion: 'genome-v1',
};

/** The Genome as a whole — a versioned collection of patterns and their graph. */
export interface SocialGenome {
  readonly version: number;
  readonly patternCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly lastUpdatedAt: IsoDateTime;
  readonly policyVersion: string;
}

/** The version metadata carried on a genome build. */
export interface GenomeVersion {
  readonly version: number;
  readonly builtAt: IsoDateTime;
  readonly patternsAdded: readonly string[];
  readonly patternsUpdated: readonly string[];
  readonly policyVersion: string;
}
