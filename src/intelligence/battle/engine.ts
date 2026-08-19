/**
 * The Battle Engine — Milestone 9. Orchestrates controlled experimental
 * competitions for Social Money Lab.
 *
 * It ORCHESTRATES. It does not evaluate. Statistical conclusions come from
 * the Science Engine; next-action recommendations come from Adaptive
 * Strategy; measurements come from Measurement Ingestion. This module adds
 * competition structure, scoring, standings, predictions and provenance —
 * and nothing else.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * ------------------------------------------------------------------------
 * A leaderboard position is not a scientific finding. `evaluateCategory`
 * records the competition verdict and the Science Engine's verdict as two
 * separate fields on `BattleOutcome`, and flags when they disagree. Winning
 * never emits a `Finding`; only the Science Engine does that, on its own
 * evidence thresholds.
 *
 * LAB MODE VS GROWTH MODE
 * ------------------------------------------------------------------------
 * In `lab` mode a registered protocol's controlled and treatment variables
 * are locked, and any Adaptive Strategy recommendation that would disturb
 * them is rejected — even a good one. Evidence quality outranks immediate
 * optimization. In `growth` mode Adaptive Strategy operates under ordinary
 * profile constraints.
 *
 * Nothing here publishes, schedules, generates content, or calls an LLM.
 */
import { randomUUID } from 'node:crypto';
import type { GrowthObjective, IsoDateTime, Platform } from '../common/types.js';
import type { PerformanceMetric } from '../performance/types.js';
import type { AnalysisLimitation } from '../science/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import type { StrategyRecommendation } from '../adaptive/types.js';
import { ScienceEngine } from '../science/engine.js';
import {
  categoryForMetric,
  decideCategoryVerdict,
  predictionAccuracy,
  scoreCompetitors,
  type CompetitorCategoryTotals,
} from './scoring.js';
import type {
  BattleCategoryResult,
  BattleCompetitor,
  BattleDivision,
  BattleEvidenceReference,
  BattleExperimentRegistration,
  BattleMatchup,
  BattleMilestoneAchievement,
  BattleMilestoneDefinition,
  BattleOperatingMode,
  BattleOutcome,
  BattlePrediction,
  BattleProtocol,
  BattleRound,
  BattleScoringModel,
  BattleSeason,
  BattleStanding,
  ScoringCategory,
} from './types.js';

export interface BattleEngineOptions {
  /** Injected for deterministic tests; defaults to the system clock. */
  readonly now?: () => IsoDateTime;
  readonly scienceEngine?: ScienceEngine;
  /** Minimum normalized-score margin below which a lead is `inconclusive` rather than a win. */
  readonly minimumWinMargin?: number;
}

/** Why a recommendation was refused, so a rejection is never opaque. */
export interface ConstraintDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly violatedVariables: readonly string[];
  readonly operatingMode: BattleOperatingMode;
}

export class BattleEngine {
  private readonly now: () => IsoDateTime;
  private readonly science: ScienceEngine;
  private readonly minimumWinMargin: number;

  constructor(
    private readonly store: IntelligenceStore,
    options: BattleEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.science = options.scienceEngine ?? new ScienceEngine(store, { now: this.now });
    this.minimumWinMargin = options.minimumWinMargin ?? 0.05;
  }

  // ---- Configuration ----------------------------------------------------

  /** Registers a protocol. Register BEFORE results are known — see `BattleProtocol`. */
  async registerProtocol(
    input: Omit<BattleProtocol, 'id' | 'createdAt' | 'registeredAt' | 'schemaVersion'> & {
      id?: string;
      registeredAt?: IsoDateTime;
    },
  ): Promise<BattleProtocol> {
    const now = this.now();
    const protocol: BattleProtocol = {
      ...input,
      id: input.id ?? `proto_${randomUUID()}`,
      registeredAt: input.registeredAt ?? now,
      createdAt: now,
      schemaVersion: 1,
    };
    await this.store.saveBattleProtocol(protocol);
    return protocol;
  }

  async createSeason(
    input: Omit<BattleSeason, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleSeason> {
    const now = this.now();
    const season: BattleSeason = {
      ...input,
      id: input.id ?? `season_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    await this.store.saveBattleSeason(season);
    return season;
  }

  /**
   * Moves a season through its lifecycle. Cancelling or archiving changes
   * only the status — every competitor, result and measurement is retained,
   * so a historical season stays fully reproducible.
   */
  async setSeasonStatus(seasonId: string, status: BattleSeason['status']): Promise<BattleSeason | null> {
    const season = await this.store.getBattleSeason(seasonId);
    if (!season) return null;
    const updated: BattleSeason = { ...season, status, updatedAt: this.now() };
    await this.store.saveBattleSeason(updated);
    return updated;
  }

  async createCompetitor(
    input: Omit<BattleCompetitor, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleCompetitor> {
    const competitor: BattleCompetitor = {
      ...input,
      id: input.id ?? `comp_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleCompetitor(competitor);
    return competitor;
  }

  async createDivision(
    input: Omit<BattleDivision, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleDivision> {
    const division: BattleDivision = {
      ...input,
      id: input.id ?? `div_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleDivision(division);
    return division;
  }

  /**
   * Creates a matched comparison. `limitations` is required by the type —
   * profiles are never perfectly identical and the record must say so.
   */
  async createMatchup(
    input: Omit<BattleMatchup, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleMatchup> {
    const matchup: BattleMatchup = {
      ...input,
      id: input.id ?? `match_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleMatchup(matchup);
    return matchup;
  }

  async createRound(
    input: Omit<BattleRound, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleRound> {
    const round: BattleRound = {
      ...input,
      id: input.id ?? `round_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleRound(round);
    return round;
  }

  async createScoringModel(
    input: Omit<BattleScoringModel, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleScoringModel> {
    const model: BattleScoringModel = {
      ...input,
      id: input.id ?? `score_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleScoringModel(model);
    return model;
  }

  // ---- Experiment registration -----------------------------------------

  /**
   * Pre-registers an experiment, locking its primary metric.
   *
   * Re-registering the same id with a DIFFERENT `primaryMetric` is refused:
   * that is metric-switching after the fact, which is the specific abuse
   * pre-registration exists to prevent. Everything else may be amended.
   */
  async registerExperiment(
    input: Omit<BattleExperimentRegistration, 'id' | 'registeredAt' | 'schemaVersion'> & {
      id?: string;
      registeredAt?: IsoDateTime;
    },
  ): Promise<{ ok: true; registration: BattleExperimentRegistration } | { ok: false; error: string }> {
    const id = input.id ?? `reg_${randomUUID()}`;
    const existing = await this.store.getBattleExperimentRegistration(id);
    if (existing && existing.primaryMetric !== input.primaryMetric) {
      return {
        ok: false,
        error: `Primary metric was locked as "${existing.primaryMetric}" at registration and cannot be changed to "${input.primaryMetric}".`,
      };
    }
    const registration: BattleExperimentRegistration = {
      ...input,
      id,
      registeredAt: existing?.registeredAt ?? input.registeredAt ?? this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleExperimentRegistration(registration);
    return { ok: true, registration };
  }

  // ---- Adaptive Strategy integration -----------------------------------

  /**
   * Decides whether an Adaptive Strategy recommendation may proceed under a
   * protocol.
   *
   * In `lab` mode, a recommendation touching a controlled or treatment
   * variable is REJECTED even when it is a sound recommendation — an
   * in-flight controlled test outranks an optimization opportunity. In
   * `growth` mode the same recommendation is allowed.
   *
   * `deprioritize_pattern` and `adjust_content_mix` are treated as
   * content-mix changes and checked against the protocol's prohibited list.
   */
  evaluateRecommendationAgainstProtocol(
    recommendation: StrategyRecommendation,
    protocol: BattleProtocol,
    /** Variables the recommendation would change, if known to the caller. */
    proposedVariables: readonly string[] = [],
  ): ConstraintDecision {
    const mode = protocol.operatingMode;

    if (mode === 'growth') {
      return {
        allowed: true,
        reason: 'Season is in growth mode; Adaptive Strategy may optimize within ordinary profile constraints.',
        violatedVariables: [],
        operatingMode: mode,
      };
    }

    const locked = new Set<string>([...protocol.controlledVariables, ...protocol.treatmentVariables]);
    const violated = proposedVariables.filter((v) => locked.has(v));
    if (violated.length > 0) {
      return {
        allowed: false,
        reason: `Lab mode: ${violated.join(', ')} ${violated.length === 1 ? 'is' : 'are'} locked by protocol ${protocol.name} v${protocol.version} while the experiment runs.`,
        violatedVariables: violated,
        operatingMode: mode,
      };
    }

    const prohibited = protocol.prohibitedStrategyChanges;
    if (prohibited.includes(recommendation.action)) {
      return {
        allowed: false,
        reason: `Lab mode: action "${recommendation.action}" is prohibited by protocol ${protocol.name} v${protocol.version}.`,
        violatedVariables: [],
        operatingMode: mode,
      };
    }

    return {
      allowed: true,
      reason: `Lab mode: recommendation touches no controlled or treatment variable of protocol ${protocol.name} v${protocol.version}.`,
      violatedVariables: [],
      operatingMode: mode,
    };
  }

  /** Filters a recommendation set to those a protocol permits, with reasons for the rest. */
  filterRecommendations(
    recommendations: readonly StrategyRecommendation[],
    protocol: BattleProtocol,
    variablesFor: (r: StrategyRecommendation) => readonly string[] = () => [],
  ): { accepted: StrategyRecommendation[]; rejected: { recommendation: StrategyRecommendation; decision: ConstraintDecision }[] } {
    const accepted: StrategyRecommendation[] = [];
    const rejected: { recommendation: StrategyRecommendation; decision: ConstraintDecision }[] = [];
    for (const recommendation of recommendations) {
      const decision = this.evaluateRecommendationAgainstProtocol(recommendation, protocol, variablesFor(recommendation));
      if (decision.allowed) accepted.push(recommendation);
      else rejected.push({ recommendation, decision });
    }
    return { accepted, rejected };
  }

  // ---- Scoring and standings -------------------------------------------

  /**
   * Aggregates a competitor's measured totals per scoring category, from
   * measurements already stored by Measurement Ingestion. Nothing is
   * re-measured or duplicated here.
   *
   * A category with no evidence stays ABSENT from the totals rather than
   * being recorded as zero — `scoreCompetitors` then skips it, so a missing
   * metric never reads as a bad score.
   */
  async aggregateCompetitorTotals(competitor: BattleCompetitor): Promise<{
    totals: CompetitorCategoryTotals;
    evidenceCount: number;
  }> {
    const totals: Record<string, number> = {};
    let evidenceCount = 0;

    for (const profileId of competitor.profileIds) {
      const measurements = await this.store.listPostMeasurements({ profileId });
      const events = await this.store.listAttributionEvents({ profileId });

      for (const measurement of measurements) {
        evidenceCount += 1;
        for (const [metric, value] of Object.entries(measurement.metrics)) {
          if (typeof value !== 'number') continue;
          const category = categoryForMetric(metric as PerformanceMetric);
          if (!category) continue;
          totals[category] = (totals[category] ?? 0) + value;
        }
      }

      // Business outcomes come only from first-party attribution, never
      // inferred from platform analytics.
      for (const event of events) {
        evidenceCount += 1;
        if (event.eventType === 'lead') totals.conversion = (totals.conversion ?? 0) + 1;
        if (event.eventType === 'purchase' || event.eventType === 'repeat_purchase') {
          totals.conversion = (totals.conversion ?? 0) + 1;
          if (event.value !== undefined) totals.customerValue = (totals.customerValue ?? 0) + event.value;
        }
        if (event.eventType === 'revenue' && event.value !== undefined) {
          totals.customerValue = (totals.customerValue ?? 0) + event.value;
        }
        if (event.eventType === 'link_click') totals.intent = (totals.intent ?? 0) + 1;
      }
    }

    return { totals, evidenceCount };
  }

  /**
   * Calculates standings for a season, optionally scoped to a division,
   * platform or category. Standings are a DERIVED VIEW — the raw
   * measurements and Science Engine evidence underneath them are untouched.
   */
  async calculateStandings(input: {
    readonly seasonId: string;
    readonly divisionId?: string;
    readonly platform?: Platform;
    readonly category?: ScoringCategory;
    readonly objective?: GrowthObjective;
  }): Promise<BattleStanding[]> {
    const season = await this.store.getBattleSeason(input.seasonId);
    if (!season) return [];
    const model = await this.store.getBattleScoringModel(season.scoringModelId);
    if (!model) return [];

    let competitors = await this.store.listBattleCompetitors({ seasonId: input.seasonId });
    if (input.platform) competitors = competitors.filter((c) => c.platform === input.platform);
    if (input.divisionId) {
      const division = await this.store.getBattleDivision(input.divisionId);
      const allowed = new Set(Object.keys(division?.competitorProfileMap ?? {}));
      competitors = competitors.filter((c) => allowed.has(c.id));
    }
    if (competitors.length === 0) return [];

    const aggregated = await Promise.all(
      competitors.map(async (competitor) => ({
        competitorId: competitor.id,
        ...(await this.aggregateCompetitorTotals(competitor)),
      })),
    );

    const { scored, adjustedForVanity, limitations } = scoreCompetitors({ model, competitors: aggregated });
    const now = this.now();

    const withScores = scored.map((s) => ({
      competitorId: s.competitorId,
      score: input.category ? (s.categoryScores[input.category]?.weighted ?? 0) : s.totalScore,
      evidenceCount: s.evidenceCount,
    }));

    withScores.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.competitorId.localeCompare(b.competitorId),
    );

    const standingLimitations: AnalysisLimitation[] = [...limitations];
    if (adjustedForVanity) standingLimitations.push('unmatched_comparison');

    return withScores.map((s, index) => ({
      seasonId: input.seasonId,
      divisionId: input.divisionId,
      platform: input.platform,
      category: input.category,
      objective: input.objective,
      competitorId: s.competitorId,
      score: s.score,
      rank: index + 1,
      evidenceCount: s.evidenceCount,
      // Operational, evidence-volume-derived. Never a statistical probability.
      confidence: s.evidenceCount === 0 ? 0 : Math.min(1, s.evidenceCount / (s.evidenceCount + 10)),
      limitations: [...new Set(standingLimitations)],
      lastUpdatedAt: now,
    }));
  }

  /** A category result: who led on points. Explicitly not a scientific conclusion. */
  async evaluateCategory(input: {
    readonly seasonId: string;
    readonly divisionId?: string;
    readonly category: ScoringCategory;
  }): Promise<BattleCategoryResult | null> {
    const season = await this.store.getBattleSeason(input.seasonId);
    if (!season) return null;
    const model = await this.store.getBattleScoringModel(season.scoringModelId);
    if (!model) return null;

    const competitors = await this.store.listBattleCompetitors({ seasonId: input.seasonId });
    const aggregated = await Promise.all(
      competitors.map(async (competitor) => ({
        competitorId: competitor.id,
        ...(await this.aggregateCompetitorTotals(competitor)),
      })),
    );
    const { scored, limitations } = scoreCompetitors({ model, competitors: aggregated });
    const { verdict, winnerCompetitorId } = decideCategoryVerdict({
      scored,
      minimumMargin: this.minimumWinMargin,
    });

    const result: BattleCategoryResult = {
      id: `catres_${randomUUID()}`,
      seasonId: input.seasonId,
      divisionId: input.divisionId,
      category: input.category,
      competitorScores: scored.map((s) => ({
        competitorId: s.competitorId,
        score: s.categoryScores[input.category]?.weighted ?? 0,
      })),
      winnerCompetitorId,
      verdict,
      confidence: scored.length === 0 ? 0 : Math.min(1, scored[0]!.evidenceCount / (scored[0]!.evidenceCount + 10)),
      limitations: [...new Set(limitations)],
      calculatedAt: this.now(),
    };
    await this.store.saveBattleCategoryResult(result);
    return result;
  }

  /**
   * Records a battle outcome, holding the competition verdict and the
   * Science Engine's verdict as separate fields and flagging when they
   * disagree.
   *
   * This is the guardrail against "we won, therefore it's proven": a
   * competitor can lead the category while its evidence is scientifically
   * `insufficient_evidence`, and that divergence is recorded rather than
   * smoothed over. No `Finding` is created here under any circumstances.
   */
  async recordOutcome(input: {
    readonly seasonId: string;
    readonly divisionId?: string;
    readonly matchupId?: string;
    readonly category: ScoringCategory;
    readonly categoryResult: BattleCategoryResult;
    /** Experiment whose Science Engine assessment applies, if any. */
    readonly scienceExperimentId?: string;
    readonly evidence: BattleEvidenceReference;
  }): Promise<BattleOutcome> {
    let scienceVerdict: BattleOutcome['scienceVerdict'];
    if (input.scienceExperimentId) {
      const assessment = await this.science.assessExperimentOutcome(input.scienceExperimentId);
      scienceVerdict = assessment?.verdict;
    }

    const battleVerdict = input.categoryResult.verdict;
    const diverges =
      scienceVerdict !== undefined &&
      ((battleVerdict === 'winner' && scienceVerdict !== 'winner') ||
        (battleVerdict !== 'winner' && scienceVerdict === 'winner'));

    const conclusion =
      battleVerdict === 'winner'
        ? `Led the ${input.category} category for this division during the tested period.${
            diverges ? ' Scientific evidence for the underlying effect is not conclusive.' : ''
          }`
        : battleVerdict === 'tie'
          ? `Competitors tied on ${input.category} during the tested period.`
          : battleVerdict === 'inconclusive'
            ? `No competitor led ${input.category} by a margin large enough to call during the tested period.`
            : `Insufficient evidence to rank ${input.category} during the tested period.`;

    const outcome: BattleOutcome = {
      id: `outcome_${randomUUID()}`,
      seasonId: input.seasonId,
      divisionId: input.divisionId,
      matchupId: input.matchupId,
      category: input.category,
      battleVerdict,
      battleWinnerCompetitorId: input.categoryResult.winnerCompetitorId,
      scienceVerdict,
      // Battle outcomes never mint findings. Any finding here came from the
      // Science Engine on its own thresholds.
      scienceFindingIds: [],
      leaderboardDivergesFromScience: diverges,
      evidence: input.evidence,
      conclusion,
      limitations: [...new Set([...input.categoryResult.limitations, ...input.evidence.limitations])],
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleOutcome(outcome);
    return outcome;
  }

  // ---- Predictions ------------------------------------------------------

  /**
   * Registers a prediction before the outcome is known. Always starts
   * `pending`; the predicted fields are write-once.
   */
  async registerPrediction(
    input: Omit<BattlePrediction, 'id' | 'predictedAt' | 'result' | 'resolvedAt' | 'actualWinnerCompetitorId' | 'resolutionNotes' | 'schemaVersion'> & {
      id?: string;
      predictedAt?: IsoDateTime;
    },
  ): Promise<BattlePrediction> {
    const prediction: BattlePrediction = {
      ...input,
      id: input.id ?? `pred_${randomUUID()}`,
      predictedAt: input.predictedAt ?? this.now(),
      result: 'pending',
      schemaVersion: 1,
    };
    await this.store.saveBattlePrediction(prediction);
    return prediction;
  }

  /**
   * Resolves a prediction against the actual result.
   *
   * The original forecast is IMMUTABLE: this rewrites only `result`,
   * `resolvedAt`, `actualWinnerCompetitorId` and `resolutionNotes`, and
   * copies every predicted field forward unchanged. A prediction that can
   * be edited after the fact measures nothing. Re-resolving an
   * already-resolved prediction is refused.
   */
  async resolvePrediction(input: {
    readonly predictionId: string;
    readonly actualWinnerCompetitorId?: string;
    readonly result: 'correct' | 'incorrect' | 'inconclusive';
    readonly notes?: string;
  }): Promise<{ ok: true; prediction: BattlePrediction } | { ok: false; error: string }> {
    const existing = await this.store.getBattlePrediction(input.predictionId);
    if (!existing) return { ok: false, error: `No prediction found with id "${input.predictionId}".` };
    if (existing.result !== 'pending') {
      return {
        ok: false,
        error: `Prediction "${input.predictionId}" is already resolved as "${existing.result}" and cannot be re-resolved.`,
      };
    }

    const resolved: BattlePrediction = {
      // Every predicted field is copied forward untouched.
      ...existing,
      result: input.result,
      resolvedAt: this.now(),
      actualWinnerCompetitorId: input.actualWinnerCompetitorId,
      resolutionNotes: input.notes,
    };
    await this.store.saveBattlePrediction(resolved);
    return { ok: true, prediction: resolved };
  }

  /** Kairos's own forecasting accuracy for a season. `undefined` until predictions resolve. */
  async getPredictionAccuracy(seasonId: string): Promise<{ accuracy?: number; resolved: number; correct: number }> {
    const predictions = await this.store.listBattlePredictions({ seasonId });
    return predictionAccuracy(predictions);
  }

  // ---- Milestones -------------------------------------------------------

  async defineMilestone(
    input: Omit<BattleMilestoneDefinition, 'id' | 'createdAt' | 'schemaVersion'> & { id?: string },
  ): Promise<BattleMilestoneDefinition> {
    const definition: BattleMilestoneDefinition = {
      ...input,
      id: input.id ?? `ms_${randomUUID()}`,
      createdAt: this.now(),
      schemaVersion: 1,
    };
    await this.store.saveBattleMilestoneDefinition(definition);
    return definition;
  }

  /** Records a milestone achievement, computing time-to-milestone from the season start. */
  async recordMilestone(input: {
    readonly seasonId: string;
    readonly definitionId: string;
    readonly competitorId: string;
    readonly profileId: string;
    readonly achievedAt: IsoDateTime;
    readonly valueAtAchievement: number;
  }): Promise<BattleMilestoneAchievement> {
    const season = await this.store.getBattleSeason(input.seasonId);
    const start = season?.startAt;
    const hoursFromSeasonStart =
      start !== undefined
        ? Math.max(0, (Date.parse(input.achievedAt) - Date.parse(start)) / 3_600_000)
        : undefined;

    const achievement: BattleMilestoneAchievement = {
      id: `msa_${randomUUID()}`,
      seasonId: input.seasonId,
      definitionId: input.definitionId,
      competitorId: input.competitorId,
      profileId: input.profileId,
      achievedAt: input.achievedAt,
      hoursFromSeasonStart,
      valueAtAchievement: input.valueAtAchievement,
      schemaVersion: 1,
    };
    await this.store.saveBattleMilestoneAchievement(achievement);
    return achievement;
  }

  // ---- Provenance -------------------------------------------------------

  /**
   * Builds the provenance envelope that must accompany any evidence leaving
   * a battle. Without every one of these fields, a downstream consumer
   * cannot tell under what conditions the result held — which is how a
   * battle win turns into universal advice.
   */
  async buildEvidenceReference(input: {
    readonly seasonId: string;
    readonly divisionId?: string;
    readonly cohortId?: string;
    readonly objective: GrowthObjective;
    readonly experimentIds: readonly string[];
    readonly sampleSize: number;
    readonly periodStart: IsoDateTime;
    readonly periodEnd: IsoDateTime;
    readonly platform?: Platform;
    readonly audienceContext?: string;
    readonly accountStage?: BattleEvidenceReference['accountStage'];
    readonly extraLimitations?: readonly AnalysisLimitation[];
  }): Promise<BattleEvidenceReference | null> {
    const season = await this.store.getBattleSeason(input.seasonId);
    if (!season) return null;
    const division = input.divisionId ? await this.store.getBattleDivision(input.divisionId) : null;

    const limitations: AnalysisLimitation[] = [...(input.extraLimitations ?? [])];
    if (input.sampleSize < 5) limitations.push('small_sample');
    if (input.divisionId) {
      const matchups = await this.store.listBattleMatchups({ seasonId: input.seasonId });
      for (const matchup of matchups.filter((m) => m.divisionId === input.divisionId)) {
        limitations.push(...matchup.limitations);
      }
    }

    return {
      seasonId: season.id,
      protocolVersion: season.protocolVersion,
      divisionId: input.divisionId,
      cohortId: input.cohortId,
      niche: division?.niche ?? season.niche,
      subNiche: division?.subNiche ?? season.subNiche,
      audienceContext: input.audienceContext ?? division?.declaredAudience,
      accountStage: input.accountStage,
      platform: input.platform,
      objective: input.objective,
      experimentIds: input.experimentIds,
      sampleSize: input.sampleSize,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      limitations: [...new Set(limitations)],
    };
  }

  /** A machine-readable season summary for a future presentation layer. Builds no UI. */
  async getBattleSummary(seasonId: string): Promise<{
    season: BattleSeason;
    protocol: BattleProtocol | null;
    standings: BattleStanding[];
    predictionAccuracy: { accuracy?: number; resolved: number; correct: number };
    divisionCount: number;
    competitorCount: number;
  } | null> {
    const season = await this.store.getBattleSeason(seasonId);
    if (!season) return null;
    const [protocol, standings, accuracy, divisions, competitors] = await Promise.all([
      this.store.getBattleProtocol(season.protocolId),
      this.calculateStandings({ seasonId }),
      this.getPredictionAccuracy(seasonId),
      this.store.listBattleDivisions({ seasonId }),
      this.store.listBattleCompetitors({ seasonId }),
    ]);
    return {
      season,
      protocol,
      standings,
      predictionAccuracy: accuracy,
      divisionCount: divisions.length,
      competitorCount: competitors.length,
    };
  }
}
