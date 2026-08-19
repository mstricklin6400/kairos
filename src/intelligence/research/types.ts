/**
 * Strategy & Research Intelligence — Milestone 5. Domain model only:
 * provenance-aware ingestion of outside knowledge (marketers, agencies,
 * courses, books, videos, communities, research reports, observational
 * datasets, platform documentation, CreatorOS skills, internal notes, and
 * Kairos's own experiments) into claims Kairos can reason about — without
 * ever treating outside advice as established truth.
 *
 * THE CORE RULE
 * ------------------------------------------------------------------------
 * Outside knowledge may generate hypotheses. Outside knowledge does NOT
 * automatically become a validated Kairos `Finding`. Nothing in this file
 * writes to the `science/types.ts` `Finding` store, and nothing here can be
 * constructed in a way that claims Kairos has proven something it has not
 * tested.
 *
 * THE LADDER — do not collapse these levels
 * ------------------------------------------------------------------------
 *   SOMEONE SAYS IT              → StrategyClaim
 *   DATA SHOWS AN ASSOCIATION    → ObservedAssociation (a kind of claim)
 *   KAIROS DESIGNS A TEST        → Hypothesis            (science/types.ts)
 *   KAIROS RUNS CONTROLLED       → Experiment            (science/types.ts)
 *   EVIDENCE ACCUMULATES         → Finding               (science/types.ts)
 *
 * THE KNOWLEDGE PIPELINE
 * ------------------------------------------------------------------------
 *   ResearchSource → StrategyClaim → StrategyPrinciple (strategy/types.ts)
 *   → possible Hypothesis → future Experiment → Finding
 *
 * `ResearchSource` is where information came from. `StrategyClaim` is what
 * that source asserted — raw captured evidence, upserted by id but never
 * silently rewritten by a `StrategyPrinciple` change. `StrategyPrinciple` is
 * the normalized candidate concept Kairos can reason about, potentially
 * supported by many claims from independent sources. A `Hypothesis` is a
 * testable claim designed for experimentation; a `Finding` is an
 * evidence-backed conclusion from an actual Kairos experiment. See
 * `../storage/store.ts` for the source-of-truth rules this pipeline
 * depends on.
 */
import type {
  AccountStage,
  Confidence,
  GrowthObjective,
  IsoDateTime,
  KnowledgeScope,
  Platform,
} from '../common/types.js';
import type { PerformanceMetric } from '../performance/types.js';

/**
 * Where a claim originated. Deliberately more granular than
 * `KnowledgeSourceType` (`common/types.ts`) — that four-value union is the
 * *authority tier* a `StrategyPrinciple` inherits; this is the *specific
 * origin* of a source record. See `deriveKnowledgeSourceType` in
 * `aggregate.ts` for the deterministic mapping between the two — the two
 * vocabularies are related, never merged into one.
 */
export type ResearchSourceType =
  | 'creator'
  | 'marketer'
  | 'agency'
  | 'course'
  | 'book'
  | 'video'
  | 'community'
  | 'research_report'
  | 'observational_dataset'
  | 'platform_documentation'
  | 'creatoros_skill'
  | 'internal_note'
  | 'kairos_experiment'
  | 'other';

/**
 * Where a claim came from — source metadata only, never the assertion
 * itself (that is `StrategyClaim`). A CreatorOS marketing skill is
 * representable here as `sourceType: 'creatoros_skill'`: Kairos *consumes*
 * CreatorOS skills as a research input, and this type is how — it never
 * duplicates or alters CreatorOS's own skill-delivery system.
 *
 * Temporal fields let strategy decay be represented rather than hidden:
 * outdated research is never deleted, only marked `deprecatedAt` or pointed
 * at its replacement via `supersededBySourceId`, so Kairos retains the
 * historical record of what it used to believe and why.
 */
export interface ResearchSource {
  readonly id: string;
  readonly sourceType: ResearchSourceType;
  readonly title: string;
  readonly authorOrPublisher?: string;
  readonly url?: string;
  readonly publishedAt?: IsoDateTime;
  readonly accessedAt?: IsoDateTime;
  readonly description?: string;
  readonly platformsDiscussed?: readonly Platform[];
  readonly nichesDiscussed?: readonly string[];
  /** Edition, version, or revision identifier — a course or doc can change under the same title. */
  readonly sourceVersion?: string;
  /** Free-text notes on how much this source should be trusted — human judgment, not a computed score. */
  readonly credibilityNotes?: string;
  readonly lastReviewedAt?: IsoDateTime;
  /** Points at the `ResearchSource.id` that replaced this one, if any. The old record is kept, not deleted. */
  readonly supersededBySourceId?: string;
  readonly deprecatedAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * What category of assertion a claim is. Category alone implies NOTHING
 * about causal status — see `CausalStatus` — only about what kind of
 * evidence (if any) backs the statement.
 *
 * - `playbook_claim`      — advice from a marketer/course/agency/CreatorOS skill.
 * - `platform_claim`      — an official platform statement about capability or behavior.
 * - `research_claim`      — a finding from a research report or study.
 * - `observed_association` — a correlation/relationship observed in a dataset, no causal proof. See `ObservedAssociation`.
 * - `experimental_claim`  — a claim explicitly produced from an experiment (Kairos's own, or a cited one).
 * - `opinion`              — interpretation or belief, not a factual assertion.
 * - `heuristic`            — a rule-of-thumb recommendation.
 */
export type ClaimType =
  | 'playbook_claim'
  | 'platform_claim'
  | 'research_claim'
  | 'observed_association'
  | 'experimental_claim'
  | 'opinion'
  | 'heuristic';

/**
 * A claim's lifecycle within Kairos's own review process — deliberately
 * NOT `FindingStatus` or `StrategyPrincipleStatus`. A claim being
 * `reviewed` means a human or process has looked at it, not that it has
 * been validated; nothing in this vocabulary contains a "validated" state.
 *
 * - `captured`            — recorded as-is from the source, nothing more.
 * - `reviewed`             — a human/process has looked at it.
 * - `candidate`            — considered promising enough to possibly feed a `StrategyPrinciple`.
 * - `mapped_to_hypothesis` — linked to at least one `StrategyPrinciple`/future `Hypothesis`.
 * - `deprecated`           — no longer considered useful, kept for history.
 * - `rejected_as_source`   — the claim or its source was judged unreliable.
 * - `superseded`           — replaced by a newer claim, kept for history.
 */
export type ClaimStatus =
  | 'captured'
  | 'reviewed'
  | 'candidate'
  | 'mapped_to_hypothesis'
  | 'deprecated'
  | 'rejected_as_source'
  | 'superseded';

/**
 * How strong the causal evidence behind a claim actually is — independent
 * of how confidently the source *states* it. A source using causal language
 * ("X causes Y") does not, by itself, justify `causal_supported`; outside
 * claims begin at `unproven` or `correlational` and only move further with
 * real experimental evidence. See `deriveDefaultCausalStatus` in
 * `aggregate.ts` for the deterministic (non-inflationary) default.
 */
export type CausalStatus = 'not_applicable' | 'unproven' | 'correlational' | 'experimental_support' | 'causal_supported';

/**
 * What a claim asserts will happen — the dependent variable and direction,
 * kept separate from whether it is TRUE. `metric` reuses `PerformanceMetric`
 * where the claim maps cleanly onto one; `description` always carries the
 * claim in the source's own terms, since not every claim maps cleanly onto
 * an existing metric.
 */
export interface AssertedEffect {
  readonly metric?: PerformanceMetric;
  readonly direction: 'increase' | 'decrease' | 'no_change' | 'unspecified';
  readonly description: string;
}

/**
 * A correlation or relationship observed in data — explicitly NOT a causal
 * claim. `causalClaim` is typed as the literal `false`, not `boolean`: it is
 * structurally impossible to construct an `ObservedAssociation` that asserts
 * causation. "Creators with 500+ replies averaged 35.7% follower growth" is
 * representable here; "getting 500 replies causes 35.7% follower growth" is
 * not — that would require actual experimental evidence (a `Finding`).
 */
export interface ObservedAssociation {
  readonly variablesObserved: readonly string[];
  readonly populationDescription: string;
  readonly sampleSize?: number;
  readonly timePeriod?: { readonly from?: IsoDateTime; readonly to?: IsoDateTime; readonly description?: string };
  /** The relationship itself, in the source's own terms — e.g. "positive correlation; no r reported". */
  readonly effectOrAssociation?: string;
  readonly limitations?: readonly string[];
  readonly confoundersKnown?: readonly string[];
  readonly causalClaim: false;
}

/** A pointer into a source too long to store in full — attribution and traceability, never a content copy. */
export interface SourceLocator {
  readonly page?: number;
  readonly timestamp?: string;
  readonly section?: string;
}

/**
 * "Someone/something asserts X" — the captured assertion itself, always
 * traceable to exactly one `sourceId`. No orphan claims: `sourceId` is
 * required and validated against the `ResearchSource` store at ingestion
 * (see `ingest.ts`).
 *
 * `confidenceInExtraction` means "how confident are we that we represented
 * the source correctly" — NOT "how likely is the claim to be true." The
 * second question is `causalStatus` (and, eventually, whatever a
 * `StrategyPrinciple` or `Finding` built from this claim concludes). Keeping
 * these separate is why the field is named the way it is.
 *
 * Platform, niche and objective scope are preserved exactly as observed —
 * a Threads claim never silently becomes an all-platforms claim, a personal
 * finance claim never silently becomes an all-niches claim, and unknown
 * scope stays unknown rather than being fabricated as broad.
 */
export interface StrategyClaim {
  readonly id: string;
  readonly sourceId: string;
  readonly statement: string;
  readonly claimType: ClaimType;
  readonly scope: KnowledgeScope;
  readonly platforms?: readonly Platform[];
  readonly niches?: readonly string[];
  readonly objectives?: readonly GrowthObjective[];
  readonly accountStages?: readonly AccountStage[];
  readonly audienceContext?: string;
  readonly contentContext?: string;
  readonly assertedEffect?: AssertedEffect;
  /** Present when `claimType === 'observed_association'`; validated at ingestion — see `ingest.ts`. */
  readonly observedAssociation?: ObservedAssociation;
  readonly causalStatus: CausalStatus;
  readonly status: ClaimStatus;
  readonly confidenceInExtraction?: Confidence;
  /** A short excerpt only — never a copy of an entire copyrighted work. Validated at ingestion. */
  readonly excerpt?: string;
  readonly locator?: SourceLocator;
  /**
   * An optional, caller-supplied, deterministic grouping key (e.g.
   * `"posting_frequency"`) — plain string equality, no semantic matching —
   * for clustering conflicting claims before any `StrategyPrinciple` exists
   * to formally group them. See `groupClaimsByTopicKey` in `aggregate.ts`.
   */
  readonly topicKey?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}
