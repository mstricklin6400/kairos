/**
 * The Kairos intelligence storage port.
 *
 * Same discipline as the existing storage port at `src/storage/store.ts`:
 * callers depend on this interface, never on the JSONL adapter directly, so
 * a durable adapter (Postgres, later) can replace
 * `JsonlIntelligenceStore` without touching a single caller.
 *
 * RAW EVIDENCE VS. LEARNED INTERPRETATION
 * ------------------------------------------------------------------------
 * `ExperimentObservation` records are raw evidence: append-only, keyed by
 * their own `id`, never overwritten by a later measurement. An experiment
 * measured at 30 minutes, 2 hours, 24 hours and 72 hours produces four
 * observations that all remain readable through `listExperimentObservations`
 * — a later interpretation must never destroy an earlier measurement.
 *
 * Everything else here is learned/materialized knowledge and is upserted by
 * id (or profile id, for `ProfileBrain`): `SocialProfile`, `ProfileBrain`,
 * `StrategyPrinciple`, `Experiment` (the record of what was designed and
 * executed, plus its own latest-known result snapshot), `Hypothesis`,
 * `Finding`, `PerformanceBaseline`. These are allowed to evolve; the raw
 * observations behind them are not.
 *
 * SOURCE-OF-TRUTH RULE — ProfileBrain vs. the Findings store
 * ------------------------------------------------------------------------
 * `ProfileBrain.strategyMemory` (Milestone 1 shape, `strategy/types.ts`)
 * embeds full `Finding[]` buckets. The Findings store below
 * (`saveFinding`/`getFinding`/`listFindings`) is the canonical source of
 * truth for a `Finding`'s current status, confidence and evidence — the
 * embedded copies inside a saved `ProfileBrain` are a point-in-time
 * materialized snapshot from whenever that brain was last saved, not a live
 * view. Reconciling the two is a Science Engine concern for a later
 * milestone, not a storage concern: this store persists and returns exactly
 * what it is given for both, and never mutates one because the other
 * changed.
 *
 * SOURCE-OF-TRUTH RULES — the Audience Brain (Milestone 4)
 * ------------------------------------------------------------------------
 * - `SocialProfile.audience` is the owner-declared audience hypothesis —
 *   set at onboarding, never written by anything in this section.
 * - The `AudienceSignal` store is raw observed behavioral evidence:
 *   append-only by `id`, exactly like `ExperimentObservation`. A signal's
 *   `segmentId` may be updated later (a reclassification), but its
 *   `classificationHistory` preserves the prior read — a later
 *   classification never erases an earlier one.
 * - The `ObservedAudienceSegment` store is the current segment model
 *   derived from that evidence — upsert by id, allowed to evolve as more
 *   signals arrive.
 * - The `SegmentFinding` store is learned, audience-scoped conclusions —
 *   upsert by id, evidence-linked via `supportingSignalIds` /
 *   `contradictingSignalIds` / `supportingExperimentIds`. Never
 *   automatically equivalent to a globally validated `Finding`.
 * - `SegmentPerformance` snapshots are append-only by `id`, same discipline
 *   as `ExperimentObservation` — a recalculation never destroys an earlier
 *   read of a segment's numbers.
 * - `ProfileBrain.audienceIntelligence` is a materialized summary
 *   (segment/finding id references and counts) for fast strategy reads —
 *   never the source of truth for any of the above, and never allowed to
 *   duplicate or overwrite `SocialProfile.audience`.
 *
 * SOURCE-OF-TRUTH RULES — Strategy & Research Intelligence (Milestone 5)
 * ------------------------------------------------------------------------
 * - The `ResearchSource` store is source metadata — upsert by id. Never
 *   deleted when outdated; mark `deprecatedAt` / `supersededBySourceId`
 *   instead, so strategy-decay history stays readable.
 * - The `StrategyClaim` store is the captured assertion — upsert by id, but
 *   never rewritten as a *side effect* of a `StrategyPrinciple` changing.
 *   `StrategyPrinciple.supportingClaimIds`/`contradictingClaimIds`
 *   (`strategy/types.ts`) reference claims by id; they never embed them, and
 *   a principle's evolution never touches the underlying claim record. Two
 *   independent sources making the same assertion are two claim records,
 *   never merged.
 * - Outside knowledge (any `StrategyClaim`) never becomes a `Finding`
 *   automatically — nothing in this store writes to the Findings store.
 *
 * SOURCE-OF-TRUTH RULES — Adaptive Strategy (Milestone 8)
 * ------------------------------------------------------------------------
 * - `StrategyRecommendation` and `AdaptiveStrategyPlan` are auditable
 *   proposals, upserted by id. A recommendation is always created
 *   `proposed`; only an explicit status change (a human, or a future
 *   approval surface) advances it, and nothing here executes anything.
 * - Plans are versioned rather than overwritten: a new plan carries
 *   `supersedesPlanId` pointing at the previous one, which is retained, so
 *   the reasoning behind a superseded decision survives the decision
 *   changing.
 * - Adaptive Strategy READS Science Engine output and never recomputes it.
 *   Baselines, confidence, finding status and decay assessment have exactly
 *   one owner, and it is not this layer.
 *
 * SOURCE-OF-TRUTH RULES — the Science Engine (Milestone 7)
 * ------------------------------------------------------------------------
 * - `HypothesisEvidence` is append-preserving audit evidence: one
 *   traceable record per piece of support or contradiction, keyed by its
 *   own `id`. Contradictory evidence (`supports: false`) is stored
 *   permanently and is NEVER deleted when a hypothesis's confidence later
 *   rises — confidence must be able to fall.
 * - `ComparisonResult` is deliberately NOT persisted: it is a derived
 *   calculation, recomputable at any time from the observations and
 *   baseline it came from. Only the comparison ids referenced by a stored
 *   `HypothesisEvidence` record matter for audit, and those travel on the
 *   evidence record itself.
 * - The engine never mutates a `PostMeasurement`, `ExperimentObservation`,
 *   `StrategyClaim` or `AttributionEvent` while analyzing it. Analysis
 *   reads; it does not rewrite its own inputs.
 *
 * SOURCE-OF-TRUTH RULES — Measurement Ingestion & Attribution (Milestone 6)
 * ------------------------------------------------------------------------
 * - `CreatorOsMeasurementSnapshot` is raw evidence: keyed by its own `id`
 *   (deterministically derived from `(creatorOsPostId, capturedAt)` when
 *   both are known, so repeated ingestion of the same pull is idempotent —
 *   see `measurement/ingest.ts`), never overwritten by a later pull. Exactly
 *   what CreatorOS returned, preserved as-is.
 * - `PostMeasurement` / `ProfileMeasurementSnapshot` are the normalized
 *   readings mapped out of that evidence — same append-preserving
 *   discipline, `sourceSnapshotId` traces back to the raw snapshot.
 *   Normalizing never rewrites or discards the raw snapshot it came from.
 * - `AttributionEvent` is a separate, first-party evidence source — never
 *   derived from CreatorOS platform analytics. A platform analytics
 *   response is never treated as proof of revenue; only an actual
 *   `AttributionEvent` is.
 * - None of the above ever triggers a `Finding`, a baseline calculation, or
 *   a strategy change — that is Science Engine work for a later milestone.
 *
 * No layer in this list silently overwrites another.
 */
import type { GrowthObjective, IsoDateTime, KnowledgeScopeLevel, Platform } from '../common/types.js';
import type {
  BaselineComparisonScope,
  PerformanceBaseline,
  PerformanceMetric,
} from '../performance/types.js';
import type { SocialProfile } from '../profiles/types.js';
import type {
  Experiment,
  ExperimentObservation,
  Finding,
  FindingStatus,
  Hypothesis,
  HypothesisStatus,
} from '../science/types.js';
import type {
  ProfileBrain,
  StrategyPrinciple,
  StrategyPrincipleStatus,
  StrategySourceType,
} from '../strategy/types.js';
import type {
  AudienceSignal,
  AudienceSignalType,
  ObservedAudienceSegment,
  SegmentFinding,
  SegmentFindingStatus,
  SegmentPerformance,
  SegmentStatus,
} from '../audience/types.js';
import type {
  ClaimStatus,
  ClaimType,
  ResearchSource,
  ResearchSourceType,
  StrategyClaim,
} from '../research/types.js';
import type {
  AttributionEvent,
  AttributionEventType,
  CreatorOsMeasurementSnapshot,
  PostMeasurement,
  ProfileMeasurementSnapshot,
} from '../measurement/types.js';
import type { HypothesisEvidence } from '../science/analysisTypes.js';
import type {
  AdaptiveStrategyPlan,
  NextBestAction,
  RecommendationStatus,
  RecommendationType,
  StrategyRecommendation,
} from '../adaptive/types.js';

export interface ProfileQuery {
  readonly platform?: Platform;
  readonly niche?: string;
  readonly limit?: number;
}

export interface StrategyPrincipleQuery {
  readonly status?: StrategyPrincipleStatus;
  readonly sourceType?: StrategySourceType;
  readonly scopeLevel?: KnowledgeScopeLevel;
  readonly limit?: number;
}

export interface ExperimentQuery {
  readonly profileId?: string;
  readonly objective?: GrowthObjective;
  readonly platform?: Platform;
  readonly limit?: number;
}

export interface HypothesisQuery {
  readonly profileId?: string;
  readonly status?: HypothesisStatus;
  readonly limit?: number;
}

export interface FindingQuery {
  readonly profileId?: string;
  readonly status?: FindingStatus;
  readonly scopeLevel?: KnowledgeScopeLevel;
  readonly limit?: number;
}

export interface BaselineQuery {
  readonly profileId: string;
  readonly metric?: PerformanceMetric;
  readonly limit?: number;
}

export interface AudienceSignalQuery {
  readonly profileId: string;
  readonly segmentId?: string;
  /** Restrict to signals with no `segmentId` at all. Ignored if `segmentId` is also given. */
  readonly unclassifiedOnly?: boolean;
  readonly signalType?: AudienceSignalType;
  /** Inclusive `observedAt` range. */
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly limit?: number;
}

export interface ObservedSegmentQuery {
  readonly profileId: string;
  readonly status?: SegmentStatus;
  readonly limit?: number;
}

export interface SegmentFindingQuery {
  readonly profileId: string;
  readonly segmentId?: string;
  readonly status?: SegmentFindingStatus;
  readonly limit?: number;
}

export interface ResearchSourceQuery {
  readonly sourceType?: ResearchSourceType;
  /** Sources whose `platformsDiscussed` includes this platform. */
  readonly platform?: Platform;
  readonly limit?: number;
}

export interface StrategyClaimQuery {
  readonly sourceId?: string;
  readonly claimType?: ClaimType;
  readonly status?: ClaimStatus;
  /** Claims whose `platforms` includes this platform, or whose `scope` is this platform. */
  readonly platform?: Platform;
  readonly objective?: GrowthObjective;
  readonly limit?: number;
}

export interface MeasurementSnapshotQuery {
  readonly profileId: string;
  readonly creatorOsPostId?: string;
  readonly experimentId?: string;
  /** Inclusive `capturedAt` range. */
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly limit?: number;
}

export interface PostMeasurementQuery {
  readonly profileId: string;
  readonly experimentId?: string;
  readonly creatorOsPostId?: string;
  /** Inclusive `measuredAt` range. */
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly limit?: number;
}

export interface ProfileMeasurementQuery {
  readonly profileId: string;
  /** Inclusive `capturedAt` range. */
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly limit?: number;
}

export interface AttributionEventQuery {
  readonly profileId: string;
  readonly experimentId?: string;
  readonly creatorOsPostId?: string;
  readonly offerId?: string;
  readonly eventType?: AttributionEventType;
  /** Inclusive `occurredAt` range. */
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly limit?: number;
}

export interface HypothesisEvidenceQuery {
  readonly hypothesisId?: string;
  readonly profileId?: string;
  readonly experimentId?: string;
  /** Restrict to supporting (`true`) or contradicting (`false`) evidence. */
  readonly supports?: boolean;
  readonly limit?: number;
}

export interface StrategyRecommendationQuery {
  readonly profileId: string;
  readonly status?: RecommendationStatus;
  readonly recommendationType?: RecommendationType;
  readonly action?: NextBestAction;
  readonly limit?: number;
}

export interface AdaptiveStrategyPlanQuery {
  readonly profileId: string;
  readonly limit?: number;
}

export interface IntelligenceStore {
  /** Upsert by id. */
  saveProfile(profile: SocialProfile): Promise<void>;
  getProfile(id: string): Promise<SocialProfile | null>;
  listProfiles(query?: ProfileQuery): Promise<SocialProfile[]>;

  /** Upsert by profileId — one brain per profile. */
  saveProfileBrain(brain: ProfileBrain): Promise<void>;
  getProfileBrain(profileId: string): Promise<ProfileBrain | null>;

  /** Upsert by id. */
  saveStrategyPrinciple(principle: StrategyPrinciple): Promise<void>;
  getStrategyPrinciple(id: string): Promise<StrategyPrinciple | null>;
  listStrategyPrinciples(query?: StrategyPrincipleQuery): Promise<StrategyPrinciple[]>;

  /** Upsert by id. Carries the experiment's own latest-known result snapshot, if any. */
  saveExperiment(experiment: Experiment): Promise<void>;
  getExperiment(id: string): Promise<Experiment | null>;
  listExperiments(query?: ExperimentQuery): Promise<Experiment[]>;

  /** Append-only raw evidence — an experiment may have many observations, none of which are ever overwritten. */
  saveExperimentObservation(observation: ExperimentObservation): Promise<void>;
  /** Chronological (oldest first) — the full measurement history for one experiment. */
  listExperimentObservations(experimentId: string): Promise<ExperimentObservation[]>;

  /** Upsert by id. */
  saveHypothesis(hypothesis: Hypothesis): Promise<void>;
  getHypothesis(id: string): Promise<Hypothesis | null>;
  listHypotheses(query?: HypothesisQuery): Promise<Hypothesis[]>;

  /** Upsert by id. Canonical source of truth for a finding's current status — see module doc. */
  saveFinding(finding: Finding): Promise<void>;
  getFinding(id: string): Promise<Finding | null>;
  listFindings(query?: FindingQuery): Promise<Finding[]>;

  /**
   * Upsert by the stable (profileId, metric, comparisonScope) key —
   * `PerformanceBaseline` carries no `id` field of its own, so recalculating
   * a baseline for the same profile/metric/scope replaces the prior value by
   * design: a baseline is "what normal looks like right now", not evidence.
   */
  saveBaseline(baseline: PerformanceBaseline): Promise<void>;
  getBaseline(
    profileId: string,
    metric: PerformanceMetric,
    comparisonScope: BaselineComparisonScope,
  ): Promise<PerformanceBaseline | null>;
  listBaselines(query: BaselineQuery): Promise<PerformanceBaseline[]>;

  /** Raw evidence. Append-only by id; a later reclassification updates `segmentId` on the same id without losing `classificationHistory`. */
  saveAudienceSignal(signal: AudienceSignal): Promise<void>;
  getAudienceSignal(id: string): Promise<AudienceSignal | null>;
  listAudienceSignals(query: AudienceSignalQuery): Promise<AudienceSignal[]>;

  /** Upsert by id — the current segment model derived from evidence. */
  saveObservedSegment(segment: ObservedAudienceSegment): Promise<void>;
  getObservedSegment(id: string): Promise<ObservedAudienceSegment | null>;
  listObservedSegments(query: ObservedSegmentQuery): Promise<ObservedAudienceSegment[]>;

  /** Upsert by id. Never automatically equivalent to a globally validated Finding — see module doc. */
  saveSegmentFinding(finding: SegmentFinding): Promise<void>;
  getSegmentFinding(id: string): Promise<SegmentFinding | null>;
  listSegmentFindings(query: SegmentFindingQuery): Promise<SegmentFinding[]>;

  /** Append-only snapshots — a segment's performance over time, never overwritten. */
  saveSegmentPerformance(performance: SegmentPerformance): Promise<void>;
  /** Chronological (oldest first). */
  listSegmentPerformance(profileId: string, segmentId: string): Promise<SegmentPerformance[]>;

  /** Upsert by id — source metadata. Deprecate/supersede rather than delete. */
  saveResearchSource(source: ResearchSource): Promise<void>;
  getResearchSource(id: string): Promise<ResearchSource | null>;
  listResearchSources(query?: ResearchSourceQuery): Promise<ResearchSource[]>;

  /** Upsert by id — the captured assertion. Never rewritten as a side effect of a StrategyPrinciple change — see module doc. */
  saveStrategyClaim(claim: StrategyClaim): Promise<void>;
  getStrategyClaim(id: string): Promise<StrategyClaim | null>;
  listStrategyClaims(query?: StrategyClaimQuery): Promise<StrategyClaim[]>;

  /** Raw evidence. Keyed by a deterministic id when derivable, so repeated ingestion of the same pull is idempotent rather than duplicated. */
  saveMeasurementSnapshot(snapshot: CreatorOsMeasurementSnapshot): Promise<void>;
  getMeasurementSnapshot(id: string): Promise<CreatorOsMeasurementSnapshot | null>;
  listMeasurementSnapshots(query: MeasurementSnapshotQuery): Promise<CreatorOsMeasurementSnapshot[]>;

  /** Normalized readings. Append-preserving by id — a later measurement never overwrites an earlier one. */
  savePostMeasurement(measurement: PostMeasurement): Promise<void>;
  getPostMeasurement(id: string): Promise<PostMeasurement | null>;
  listPostMeasurements(query: PostMeasurementQuery): Promise<PostMeasurement[]>;

  /** Append-preserving by id — never forced into a fake post Experiment. */
  saveProfileMeasurementSnapshot(snapshot: ProfileMeasurementSnapshot): Promise<void>;
  listProfileMeasurementSnapshots(query: ProfileMeasurementQuery): Promise<ProfileMeasurementSnapshot[]>;

  /** First-party evidence, never derived from platform analytics. Upsert by id — a caller-supplied stable id (e.g. a payment-provider event id) makes re-ingestion idempotent. */
  saveAttributionEvent(event: AttributionEvent): Promise<void>;
  getAttributionEvent(id: string): Promise<AttributionEvent | null>;
  listAttributionEvents(query: AttributionEventQuery): Promise<AttributionEvent[]>;

  /** Append-preserving audit evidence. Contradicting records are never deleted — see module doc. */
  saveHypothesisEvidence(evidence: HypothesisEvidence): Promise<void>;
  listHypothesisEvidence(query: HypothesisEvidenceQuery): Promise<HypothesisEvidence[]>;

  /** Upsert by id — an auditable proposal. Created `proposed`; only an explicit status change advances it. */
  saveStrategyRecommendation(recommendation: StrategyRecommendation): Promise<void>;
  getStrategyRecommendation(id: string): Promise<StrategyRecommendation | null>;
  listStrategyRecommendations(query: StrategyRecommendationQuery): Promise<StrategyRecommendation[]>;

  /** Upsert by id — versioned, never overwritten. A superseded plan is retained; see module doc. */
  saveAdaptiveStrategyPlan(plan: AdaptiveStrategyPlan): Promise<void>;
  getAdaptiveStrategyPlan(id: string): Promise<AdaptiveStrategyPlan | null>;
  listAdaptiveStrategyPlans(query: AdaptiveStrategyPlanQuery): Promise<AdaptiveStrategyPlan[]>;
}
