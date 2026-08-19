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
 */
import type { GrowthObjective, KnowledgeScopeLevel, Platform } from '../common/types.js';
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
}
