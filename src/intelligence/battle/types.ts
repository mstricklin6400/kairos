/**
 * Battle Engine domain types — Milestone 9. The controlled experimental
 * competition system behind Social Money Lab.
 *
 * A Battle is NOT a leaderboard. It is a structured evidence-generation
 * environment in which many profiles compete under registered experimental
 * protocols while Kairos measures growth, engagement, reach, traffic,
 * leads, revenue, experimental outcomes, prediction accuracy and efficiency.
 *
 * THE LOAD-BEARING SEPARATION
 * ------------------------------------------------------------------------
 *   BattleScore / BattleStanding  — competition position. NOT evidence.
 *   Finding (science/types.ts)    — scientific conclusion. NOT a ranking.
 *
 * A competitor can top the leaderboard while its evidence remains
 * scientifically inconclusive, and that combination must stay
 * representable. Winning a season never produces a `Finding`, and a
 * `BattleScore` is never treated as one. See `BattleOutcome`, which holds
 * both a competition verdict and a *separate* science verdict precisely so
 * the two can disagree.
 *
 * NOTHING HERE IS HARD-CODED TO A SEASON DESIGN. Twenty accounts across
 * Threads and X is one configuration of these types, not a shape baked into
 * them: competitors carry a `competitorType`, platforms come from the shared
 * `Platform` union, and division/cohort membership is data.
 */
import type {
  AccountStage,
  Confidence,
  GrowthObjective,
  IsoDateTime,
  Platform,
} from '../common/types.js';
import type { PerformanceMetric } from '../performance/types.js';
import type { AnalysisLimitation } from '../science/types.js';

/** Where a season is in its lifecycle. Cancelled and archived seasons retain all their evidence. */
export type BattleSeasonStatus =
  | 'draft'
  | 'registration'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'archived';

/**
 * How strictly experimental controls bind right now.
 *
 * These are NOT equivalent modes. In `lab`, registered experimental
 * controls dominate and evidence quality outranks immediate performance —
 * Adaptive Strategy may not touch a controlled variable even if doing so
 * would improve results. In `growth`, Adaptive Strategy optimizes normally
 * within ordinary profile constraints.
 */
export type BattleOperatingMode = 'lab' | 'growth';

/** What dimension a competitor represents. Platform is one option among many, never an assumption. */
export type BattleCompetitorType =
  | 'platform'
  | 'strategy'
  | 'format'
  | 'frequency'
  | 'creator_type'
  | 'content_type'
  | 'custom';

/**
 * A registered, versioned experimental protocol. Registered BEFORE results
 * are known, and never silently rewritten afterwards — retroactive scoring
 * changes are how a competition stops being evidence.
 */
export interface BattleProtocol {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly registeredAt: IsoDateTime;
  readonly objectives: readonly GrowthObjective[];
  /** Locked at registration. The verdict is decided on these and no others. */
  readonly primaryMetrics: readonly PerformanceMetric[];
  /** Reported for transparency; can never overturn a primary-metric result. */
  readonly exploratoryMetrics: readonly PerformanceMetric[];
  /** Content-DNA variables held constant across competitors. */
  readonly controlledVariables: readonly string[];
  /** The variables deliberately under test. */
  readonly treatmentVariables: readonly string[];
  /** Strategy changes a competitor may make mid-season without breaking the protocol. */
  readonly allowedStrategyChanges: readonly string[];
  /** Strategy changes that would invalidate the experiment. */
  readonly prohibitedStrategyChanges: readonly string[];
  readonly measurementWindowDays: number;
  /** Pre-measurement period during which results are not counted. */
  readonly warmUpDays?: number;
  readonly minimumSampleExpectation?: number;
  readonly matchingRules: readonly string[];
  readonly scoringModelId: string;
  readonly outlierPolicy: string;
  readonly missingDataPolicy: string;
  readonly attributionPolicy: string;
  readonly experimentRegistrationPolicy: string;
  /** Whether Adaptive Strategy may act at all, and how far. */
  readonly operatingMode: BattleOperatingMode;
  readonly limitations: readonly AnalysisLimitation[];
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/** One competition. Divisions, competitors and protocol are all references, never embedded copies. */
export interface BattleSeason {
  readonly id: string;
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly platforms: readonly Platform[];
  readonly status: BattleSeasonStatus;
  readonly startAt?: IsoDateTime;
  readonly endAt?: IsoDateTime;
  readonly durationDays?: number;
  readonly protocolId: string;
  /** Denormalized for provenance: which protocol VERSION governed this season. */
  readonly protocolVersion: string;
  readonly primaryObjective: GrowthObjective;
  readonly secondaryObjectives: readonly GrowthObjective[];
  readonly competitorIds: readonly string[];
  readonly divisionIds: readonly string[];
  /** Account stages this season admits, if constrained. Empty means unconstrained. */
  readonly accountStageConstraints: readonly AccountStage[];
  readonly scoringModelId: string;
  readonly operatingMode: BattleOperatingMode;
  /** Whether results are intended for public presentation. Never changes how evidence is scoped. */
  readonly isPublic: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * One side of a competition. `platform` is optional and only meaningful for
 * `competitorType: 'platform'` — an "AI vs Human" or "Short vs Long" season
 * uses the same type with no platform at all.
 */
export interface BattleCompetitor {
  readonly id: string;
  readonly seasonId: string;
  readonly name: string;
  readonly competitorType: BattleCompetitorType;
  readonly platform?: Platform;
  readonly description?: string;
  /** Profiles competing under this competitor's banner. */
  readonly profileIds: readonly string[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * A comparable grouping within a season — typically a niche cohort
 * ("Real Estate", "Personal Finance"). Nothing assumes a fixed number of
 * divisions.
 */
export interface BattleDivision {
  readonly id: string;
  readonly seasonId: string;
  readonly name: string;
  readonly description?: string;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly declaredAudience?: string;
  readonly profileIds: readonly string[];
  /** competitorId → the profile ids representing it in this division. */
  readonly competitorProfileMap: Readonly<Record<string, readonly string[]>>;
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * A matched comparison — e.g. a Threads profile against its X counterpart,
 * holding niche, audience hypothesis, objective and start cohort as close as
 * practical.
 *
 * `limitations` is REQUIRED, not optional: profiles are never perfectly
 * identical, and a matchup that claims otherwise is lying about its own
 * evidence quality.
 */
export interface BattleMatchup {
  readonly id: string;
  readonly seasonId: string;
  readonly divisionId: string;
  /** Two or more profiles being compared, one per competitor. */
  readonly competitorProfileIds: readonly string[];
  /** What was actually held comparable — niche, objective, start cohort, offer class. */
  readonly matchingCriteria: readonly string[];
  /** Where the match is imperfect. Never empty in practice. */
  readonly limitations: readonly AnalysisLimitation[];
  /** Free-text detail on residual mismatch, e.g. "X account started with 400 more followers". */
  readonly matchingNotes?: string;
  readonly status: 'proposed' | 'active' | 'completed' | 'void';
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/** A time block within a season. Rounds need not be daily, or uniform. */
export interface BattleRound {
  readonly id: string;
  readonly seasonId: string;
  readonly number: number;
  readonly name?: string;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly experimentRegistrationIds: readonly string[];
  readonly status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * The pre-registration of one test. **The primary metric is locked here,
 * before results exist.** This is the structural defence against declaring
 * a winner by searching metrics after the fact.
 */
export interface BattleExperimentRegistration {
  readonly id: string;
  readonly seasonId: string;
  readonly divisionId?: string;
  readonly matchupId?: string;
  readonly experimentId: string;
  readonly hypothesisId?: string;
  readonly registeredAt: IsoDateTime;
  /** Locked at registration. Immutable thereafter — see `BattleEngine.registerExperiment`. */
  readonly primaryMetric: PerformanceMetric;
  readonly secondaryMetrics: readonly PerformanceMetric[];
  readonly independentVariable: string;
  readonly controlVariables: readonly string[];
  readonly sampleTarget?: number;
  readonly plannedDurationDays?: number;
  readonly analysisPlan?: string;
  readonly status: 'registered' | 'running' | 'measured' | 'abandoned';
  readonly schemaVersion: number;
}

/** A weighted scoring category. Weights are configuration, never a universal definition of "winner". */
export interface BattleScoringCategory {
  readonly category: ScoringCategory;
  readonly weight: number;
  readonly metrics: readonly PerformanceMetric[];
}

/**
 * Scoring categories mirror the measurement hierarchy (§8) so a battle
 * cannot invent a parallel metric vocabulary.
 */
export type ScoringCategory =
  | 'attention'
  | 'conversation'
  | 'amplification'
  | 'engagementSignal'
  | 'growth'
  | 'intent'
  | 'conversion'
  | 'customerValue'
  | 'efficiency'
  | 'predictionAccuracy';

/**
 * A configurable scoring model. Different battles legitimately optimize for
 * different things, so there is no universal winner definition.
 *
 * `vanityGuard` is the protection against a revenue-objective battle being
 * won on impressions: when set, categories below the intent tier are capped
 * at a combined share of the total score.
 */
export interface BattleScoringModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly categories: readonly BattleScoringCategory[];
  /** Max combined weight share attention/engagement categories may contribute. Undefined = uncapped. */
  readonly vanityGuardMaxShare?: number;
  readonly methodology: string;
  readonly limitations: readonly AnalysisLimitation[];
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/** One competitor's score in one category. Derived, but persisted for trend history. */
export interface BattleScore {
  readonly id: string;
  readonly seasonId: string;
  readonly divisionId?: string;
  readonly competitorId: string;
  readonly category: ScoringCategory;
  readonly rawValue: number;
  /** 0..1 within the compared set. */
  readonly normalizedValue: number;
  readonly weightedValue: number;
  readonly metric?: PerformanceMetric;
  readonly evidenceCount: number;
  readonly limitations: readonly AnalysisLimitation[];
  readonly calculatedAt: IsoDateTime;
  readonly schemaVersion: number;
}

/** A ranked position. A derived view — never itself evidence of anything. */
export interface BattleStanding {
  readonly seasonId: string;
  readonly divisionId?: string;
  readonly platform?: Platform;
  readonly category?: ScoringCategory;
  readonly objective?: GrowthObjective;
  readonly competitorId: string;
  readonly score: number;
  readonly rank: number;
  readonly evidenceCount: number;
  readonly confidence: Confidence;
  readonly limitations: readonly AnalysisLimitation[];
  readonly lastUpdatedAt: IsoDateTime;
}

/** Verdict on a competition category. Distinct from any scientific verdict. */
export type BattleVerdict = 'winner' | 'tie' | 'insufficient_evidence' | 'inconclusive';

export interface BattleCategoryResult {
  readonly id: string;
  readonly seasonId: string;
  readonly divisionId?: string;
  readonly category: ScoringCategory;
  readonly competitorScores: readonly { readonly competitorId: string; readonly score: number }[];
  readonly winnerCompetitorId?: string;
  readonly verdict: BattleVerdict;
  readonly confidence: Confidence;
  readonly limitations: readonly AnalysisLimitation[];
  readonly calculatedAt: IsoDateTime;
}

/**
 * The full result of a battle question, holding the competition verdict and
 * the scientific verdict SEPARATELY so they are free to disagree.
 *
 * `scienceVerdict` and `scienceFindingIds` come from the Science Engine.
 * `battleVerdict` comes from scoring. A competitor may win the category on
 * points while the science remains `insufficient_evidence` — and that is a
 * legitimate, expected, publishable outcome.
 */
export interface BattleOutcome {
  readonly id: string;
  readonly seasonId: string;
  readonly divisionId?: string;
  readonly matchupId?: string;
  readonly category: ScoringCategory;
  readonly battleVerdict: BattleVerdict;
  readonly battleWinnerCompetitorId?: string;
  /** From the Science Engine. `undefined` when no scientific evaluation applies. */
  readonly scienceVerdict?: 'winner' | 'failure' | 'neutral' | 'insufficient_evidence';
  readonly scienceFindingIds: readonly string[];
  /** Explicitly recorded when the leaderboard and the evidence disagree. */
  readonly leaderboardDivergesFromScience: boolean;
  readonly evidence: BattleEvidenceReference;
  readonly conclusion: string;
  readonly limitations: readonly AnalysisLimitation[];
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/**
 * The provenance envelope every piece of battle evidence carries.
 *
 * This is the mechanism that stops a battle result becoming universal
 * advice: a finding that leaves a battle keeps the season, protocol version,
 * division, niche, audience context, account stage, platform, objective,
 * experiment ids, sample, period and limitations that produced it. Downstream
 * consumers (Intelligence Transfer, Social Prescriptions) can therefore
 * always ask "under what conditions was this true?" and get an answer.
 */
export interface BattleEvidenceReference {
  readonly seasonId: string;
  readonly protocolVersion: string;
  readonly divisionId?: string;
  readonly cohortId?: string;
  readonly niche?: string;
  readonly subNiche?: string;
  readonly audienceContext?: string;
  readonly accountStage?: AccountStage;
  readonly platform?: Platform;
  readonly objective: GrowthObjective;
  readonly experimentIds: readonly string[];
  readonly sampleSize: number;
  readonly periodStart: IsoDateTime;
  readonly periodEnd: IsoDateTime;
  readonly limitations: readonly AnalysisLimitation[];
}

/** A named achievement threshold. Generic — the thresholds are data, not code. */
export interface BattleMilestoneDefinition {
  readonly id: string;
  readonly seasonId: string;
  readonly name: string;
  readonly metric: PerformanceMetric;
  /** Cumulative value at which the milestone is reached. */
  readonly threshold: number;
  readonly description?: string;
  readonly createdAt: IsoDateTime;
  readonly schemaVersion: number;
}

/** A competitor reaching a milestone, with the time it took. */
export interface BattleMilestoneAchievement {
  readonly id: string;
  readonly seasonId: string;
  readonly definitionId: string;
  readonly competitorId: string;
  readonly profileId: string;
  readonly achievedAt: IsoDateTime;
  /** Hours from season start to achievement — the time-to-milestone measure. */
  readonly hoursFromSeasonStart?: number;
  readonly valueAtAchievement: number;
  readonly schemaVersion: number;
}

/** Whether a registered prediction turned out right. Set only after the result exists. */
export type PredictionResult = 'correct' | 'incorrect' | 'inconclusive' | 'pending';

/**
 * A prediction registered BEFORE the outcome is known — the mechanism by
 * which Social Money Lab can eventually measure Kairos's own forecasting
 * accuracy.
 *
 * The predicted fields are write-once. `BattleEngine.resolvePrediction`
 * refuses to alter `predictedMetric`, `predictedDirection`,
 * `predictedCompetitorId`, `confidence` or `predictedAt`; it only fills in
 * the result. A forecast that can be edited after the fact measures nothing.
 */
export interface BattlePrediction {
  readonly id: string;
  readonly seasonId: string;
  readonly divisionId?: string;
  readonly matchupId?: string;
  readonly experimentRegistrationId?: string;
  readonly predictedAt: IsoDateTime;
  /** The competitor/treatment predicted to come out ahead. */
  readonly predictedCompetitorId: string;
  readonly predictedMetric: PerformanceMetric;
  readonly predictedDirection: 'increase' | 'decrease' | 'no_change';
  readonly confidence: Confidence;
  /** Ids of the findings/experiments/transfers the forecast rested on. */
  readonly evidenceBasis: readonly string[];
  readonly rationale: string;
  // ---- Filled in only after the outcome is known ----
  readonly result: PredictionResult;
  readonly resolvedAt?: IsoDateTime;
  readonly actualWinnerCompetitorId?: string;
  readonly resolutionNotes?: string;
  readonly schemaVersion: number;
}
