/**
 * The Audience Brain — Milestone 4. Domain model only: raw behavioral
 * evidence, the segment model derived from it, audience-scoped learned
 * conclusions, and segment-level performance. No AI classification, no
 * platform ingestion, no Science Engine — those are later milestones.
 *
 * DECLARED VS. OBSERVED — the principle this whole module exists to enforce
 * ------------------------------------------------------------------------
 * Milestone 3 established `SocialProfile.audience` as the DECLARED audience:
 * who the profile owner believes their audience is. Everything in this file
 * is OBSERVED audience intelligence: what permitted behavioral evidence
 * indicates. The two must never overwrite one another — see the
 * source-of-truth rules in `../storage/store.ts` and
 * `docs/KAIROS_INTELLIGENCE_ARCHITECTURE.md` §Audience Brain.
 *
 * PRIVACY / ETHICS BOUNDARY
 * ------------------------------------------------------------------------
 * Every type below is scoped to marketing-relevant expressed or behavioral
 * signals — a stated problem, a stated goal, a question, an objection, a
 * topic of interest, an experience level, an intent or conversion action, a
 * vocabulary pattern, an engagement action. None of these types have a field
 * for race/ethnicity, religion, sexual orientation, medical conditions,
 * political affiliation, criminal history, or any other sensitive personal
 * attribute, and none should ever be added to them without a separate,
 * explicit, lawfully-reviewed product decision. The model prefers "people
 * expressing problem X" (`AudienceSignal`, `ObservedAudienceSegment`) over
 * "person Y has trait Z" — there is no per-individual profile type here at
 * all, only aggregated, revisable segment models.
 *
 * Observed behavior does not automatically prove identity or motivation.
 * Every conclusion in this file is probabilistic (`confidence`) and
 * revisable (`status` lifecycles below) — never treated as settled fact.
 */
import type { Confidence, IsoDateTime, KnowledgeScope, WeightedInsight } from '../common/types.js';
import type { BaselineWindow, PerformanceMetric } from '../performance/types.js';

/**
 * Where a signal came from. Deliberately a flat, open-ended-in-spirit union
 * rather than a platform-specific vocabulary — Kairos studies the shape of
 * the interaction (a comment, a click, a purchase), not a competing platform
 * abstraction. Milestone 4 defines this vocabulary only; no adapter in this
 * milestone actually produces these from a live platform.
 */
export type AudienceSignalSource =
  | 'comment'
  | 'reply'
  | 'dm'
  | 'profile_context'
  | 'click'
  | 'lead'
  | 'purchase'
  | 'survey'
  | 'manual'
  | 'other';

/**
 * What kind of marketing-relevant signal this is. Kept short and
 * extensible-by-convention rather than exhaustively enumerated — new signal
 * types are a one-line addition here, not a schema migration.
 */
export type AudienceSignalType =
  | 'problem'
  | 'goal'
  | 'question'
  | 'objection'
  | 'topic_interest'
  | 'content_interest'
  | 'experience_level'
  | 'intent'
  | 'conversion'
  | 'language_pattern'
  | 'engagement'
  | 'other';

/**
 * One entry in a signal's classification lineage — appended, never rewritten,
 * so a later reclassification cannot erase an earlier read. `segmentId: null`
 * records "was explicitly unclassified at this point," distinct from a
 * classification record simply being absent (never classified at all).
 */
export interface SignalClassificationRecord {
  readonly segmentId: string | null;
  readonly classifiedAt: IsoDateTime;
  readonly reason?: string;
}

/**
 * One raw, timestamped piece of observed audience evidence — the atom of
 * the Audience Brain. Analogous to `ExperimentObservation`: append-only,
 * keyed by its own `id`, never destroyed by a later signal or a later
 * reclassification.
 *
 * `segmentId` absent means UNCLASSIFIED, a first-class, permanent state, not
 * a placeholder waiting to be filled — forcing every signal into an existing
 * segment would manufacture confirmation bias. See `classificationHistory`
 * for how a *later* classification is layered on without silently rewriting
 * this signal's original read.
 */
export interface AudienceSignal {
  readonly id: string;
  readonly profileId: string;
  readonly source: AudienceSignalSource;
  readonly observedAt: IsoDateTime;
  /** The post/content this signal is attached to, if any. */
  readonly contentId?: string;
  /** The experiment this signal resulted from, if any. */
  readonly experimentId?: string;
  /** The underlying CreatorOS interaction (comment id, DM id, ...), if any — a loose reference, not a foreign key CreatorOS enforces. */
  readonly interactionId?: string;
  readonly signalType: AudienceSignalType;
  /** The expressed text itself, where permitted and available. Marketing-relevant utterance only — never a dossier field. */
  readonly text?: string;
  /** A normalized scalar reading when the signal is inherently numeric (a click, a survey scale answer). */
  readonly normalizedValue?: number;
  /** Current classification. Absent = unclassified. */
  readonly segmentId?: string;
  readonly confidence?: Confidence;
  /** Classification lineage, oldest first. See the module doc's raw-evidence rule. */
  readonly classificationHistory?: readonly SignalClassificationRecord[];
  /** Small, flat, serializable context only — never a place to stash sensitive attributes. */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly schemaVersion: number;
}

/**
 * A segment's lifecycle standing. Deliberately its own vocabulary — not
 * `HypothesisStatus`, not `FindingStatus`, not `StrategyPrincipleStatus`:
 * this describes whether a segment is currently a meaningful, recognizable
 * cluster of evidence, not whether a claim about it has been proven.
 */
export type SegmentStatus = 'emerging' | 'active' | 'established' | 'declining' | 'archived';

/**
 * The current segment model derived from evidence — NOT the same thing as a
 * declared `AudienceSegment` (`profiles/types.ts`), which is the owner's own
 * belief captured at onboarding. An `ObservedAudienceSegment` can exist with
 * no declared counterpart at all: evidence is free to reveal a segment the
 * owner never named. `matchedDeclaredSegmentId` is an optional, explicit,
 * human/deterministic link — never inferred by semantic matching in this
 * milestone.
 *
 * Every soft-knowledge bucket below is `WeightedInsight[]`, the same
 * discipline `NicheIntelligence` uses, so each item carries its own
 * confidence, source and recency rather than being a bare string Kairos
 * would otherwise have to treat as settled fact.
 */
export interface ObservedAudienceSegment {
  readonly id: string;
  readonly profileId: string;
  readonly name: string;
  readonly description?: string;
  readonly status: SegmentStatus;
  /** Optional, explicit link to a declared segment — never inferred. */
  readonly matchedDeclaredSegmentId?: string;
  readonly firstObservedAt: IsoDateTime;
  readonly lastObservedAt: IsoDateTime;
  readonly signalCount: number;
  /** Only when there is a defensible basis for a size estimate — Kairos does not invent audience-size numbers. */
  readonly memberEstimate?: number;
  readonly confidence: Confidence;
  /** Marketing-relevant characteristics only — see the privacy boundary above. */
  readonly characteristics: readonly WeightedInsight[];
  readonly problems: readonly WeightedInsight[];
  readonly goals: readonly WeightedInsight[];
  readonly objections: readonly WeightedInsight[];
  readonly topics: readonly WeightedInsight[];
  readonly languagePatterns: readonly WeightedInsight[];
  /** References the latest `SegmentPerformance` snapshot id — never an embedded copy. See storage source-of-truth rules. */
  readonly latestPerformanceId?: string;
  readonly schemaVersion: number;
}

/**
 * A segment's lifecycle standing for a learned claim. Deliberately distinct
 * from `FindingStatus` — a `SegmentFinding` is never automatically promoted
 * to a globally validated Kairos `Finding`; that promotion, if it ever
 * happens, is a Science Engine decision for a later milestone, made
 * explicitly, not silently.
 */
export type SegmentFindingStatus = 'promising' | 'supported' | 'contradicted' | 'decaying';

/**
 * What survives testing for ONE observed segment: a statement plus the
 * evidence that earns it. Mirrors `Hypothesis`'s supporting/contradicting
 * discipline — both lists always present, so a finding that only tracks
 * agreement is a belief system, not science — but over signals and
 * experiments instead of experiments alone, and scoped to one profile and
 * one segment rather than claiming global truth.
 */
export interface SegmentFinding {
  readonly id: string;
  readonly profileId: string;
  readonly segmentId: string;
  readonly statement: string;
  readonly scope: KnowledgeScope;
  readonly supportingSignalIds: readonly string[];
  readonly supportingExperimentIds: readonly string[];
  readonly contradictingSignalIds: readonly string[];
  readonly confidence: Confidence;
  readonly status: SegmentFindingStatus;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly lastValidatedAt?: IsoDateTime;
  readonly schemaVersion: number;
}

/** One metric's aggregated total for a segment over a window. Reuses `PerformanceMetric` rather than a second metric system. */
export interface SegmentMetricTotal {
  readonly metric: PerformanceMetric;
  readonly total: number;
  /** This segment's share of the profile-wide total for the same metric/window, 0..1 — only when a defensible denominator exists. */
  readonly shareOfProfileTotal?: number;
}

/**
 * A snapshot of one segment's aggregated performance across the Milestone 1
 * measurement hierarchy (attention → conversation → amplification →
 * engagement signal → growth → intent → conversion → customer value) — the
 * representation that eventually lets Kairos tell an engagement-heavy
 * segment apart from a buyer segment. Snapshots are append-only by their own
 * `id`, same discipline as `ExperimentObservation`: a later recalculation
 * never erases an earlier read of "what this segment's numbers were then."
 */
export interface SegmentPerformance {
  readonly id: string;
  readonly profileId: string;
  readonly segmentId: string;
  readonly window: BaselineWindow;
  readonly metricTotals: readonly SegmentMetricTotal[];
  readonly calculatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * How the declared audience (`SocialProfile.audience`) currently compares to
 * observed segments. `insufficient_evidence` is the only state this
 * milestone's deterministic aggregation can honestly produce — see
 * `aggregate.ts`'s `compareDeclaredToObserved` for why `aligned` /
 * `partially_aligned` / `divergent` exist here only for a future milestone
 * that adds real declared-vs-observed matching.
 */
export type AudienceComparisonState = 'aligned' | 'partially_aligned' | 'divergent' | 'insufficient_evidence';

export interface DeclaredAudienceComparison {
  readonly state: AudienceComparisonState;
  readonly evaluatedAt: IsoDateTime;
  readonly observedSegmentCount: number;
  readonly totalSignalCount: number;
  readonly notes?: string;
}
