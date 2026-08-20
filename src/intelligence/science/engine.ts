/**
 * The Science Engine — Milestone 7. Turns stored evidence into defensible,
 * scoped, revisable conclusions, deterministically.
 *
 * Depends only on the `IntelligenceStore` PORT, never on the JSONL adapter,
 * so a Postgres adapter later changes nothing here.
 *
 * NO P-HACKING: an experiment registers an objective up front, and
 * `assessExperimentOutcome` decides its verdict solely on the metrics that
 * objective maps to. If an experiment testing clicks sees replies explode
 * while clicks stay flat, the verdict is that the click hypothesis is NOT
 * supported. The reply movement is reported under
 * `exploratoryComparisons` — visible, useful for generating future
 * hypotheses, and structurally incapable of overturning the registered
 * result.
 *
 * MISSING IS NOT ZERO: when the dependent metric was never reported, the
 * verdict is `insufficient_evidence`, never `failure`.
 *
 * Nothing here calls an LLM, generates content, mutates a profile's
 * strategy, or touches CreatorOS.
 */
import { randomUUID } from 'node:crypto';
import type { GrowthObjective, IsoDateTime } from '../common/types.js';
import type {
  BaselineComparisonScope,
  PerformanceBaseline,
  PerformanceMetric,
} from '../performance/types.js';
import type { Finding, Hypothesis } from './types.js';
import type { IntelligenceStore } from '../storage/store.js';
import {
  DEFAULT_OBJECTIVE_METRICS,
  DEFAULT_SCIENCE_POLICY,
  type AnalysisLimitation,
  type AnalyticalObservation,
  type ComparisonDirection,
  type ComparisonResult,
  type FindingEmissionContext,
  type FindingFreshness,
  type HypothesisEvaluation,
  type HypothesisEvidence,
  type ObjectiveMetricPolicy,
  type OutcomeAssessment,
  type OutcomeVerdict,
  type PairedComparison,
  type RevalidationCandidate,
  type SciencePolicy,
  type ScienceReport,
} from './analysisTypes.js';
import {
  buildEffectSize,
  clampConfidence,
  computeOperationalConfidence,
  daysBetween,
  mean,
  median,
  relativeChange,
  standardDeviation,
} from './statistics.js';
import { fromAttributionEvent, fromPostMeasurement } from './readModel.js';

export interface ScienceEngineOptions {
  readonly policy?: Partial<SciencePolicy>;
  readonly objectiveMetrics?: Partial<ObjectiveMetricPolicy>;
  /** Injected for deterministic tests; defaults to the system clock. */
  readonly now?: () => IsoDateTime;
}

/** Which metrics answer this objective's question. Inspectable and overrideable — never buried in if/else. */
export function resolveObjectiveMetrics(
  objective: GrowthObjective,
  overrides?: Partial<ObjectiveMetricPolicy>,
): readonly PerformanceMetric[] {
  return overrides?.[objective] ?? DEFAULT_OBJECTIVE_METRICS[objective];
}

export class ScienceEngine {
  private readonly policy: SciencePolicy;
  private readonly objectiveMetrics: Partial<ObjectiveMetricPolicy>;
  private readonly now: () => IsoDateTime;

  constructor(
    private readonly store: IntelligenceStore,
    options: ScienceEngineOptions = {},
  ) {
    this.policy = { ...DEFAULT_SCIENCE_POLICY, ...options.policy };
    this.objectiveMetrics = options.objectiveMetrics ?? {};
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** The effective policy, so callers and tests can inspect exactly what thresholds applied. */
  getPolicy(): SciencePolicy {
    return this.policy;
  }

  metricsForObjective(objective: GrowthObjective): readonly PerformanceMetric[] {
    return resolveObjectiveMetrics(objective, this.objectiveMetrics);
  }

  /**
   * Every analytical row for a profile, projected from stored measurements
   * and (where they legitimately evidence a business metric) attribution
   * events. Source records are never mutated.
   */
  async loadObservations(
    profileId: string,
    range: { from?: IsoDateTime; to?: IsoDateTime } = {},
  ): Promise<AnalyticalObservation[]> {
    const measurements = await this.store.listPostMeasurements({ profileId, ...range });
    const events = await this.store.listAttributionEvents({ profileId, ...range });
    return [
      ...measurements.flatMap(fromPostMeasurement),
      ...events.flatMap(fromAttributionEvent),
    ];
  }

  /**
   * Calculates a `PerformanceBaseline` for one profile/metric/scope, using
   * the median as the primary central tendency so a single viral post
   * cannot redefine "normal". Returns `null` when the sample is below
   * `policy.minimumBaselineSample` — an unusable baseline is reported as
   * absent rather than as a falsely-precise number.
   *
   * Scope filtering beyond `all-recent-posts` requires experiment linkage,
   * which the caller supplies via `observations`; this method does not
   * silently guess which posts belong to a hook family or format.
   */
  async calculateProfileBaseline(input: {
    readonly profileId: string;
    readonly metric: PerformanceMetric;
    readonly comparisonScope?: BaselineComparisonScope;
    readonly from?: IsoDateTime;
    readonly to?: IsoDateTime;
    readonly observations?: readonly AnalyticalObservation[];
  }): Promise<PerformanceBaseline | null> {
    const scope: BaselineComparisonScope = input.comparisonScope ?? { kind: 'all-recent-posts' };
    const all =
      input.observations ??
      (await this.loadObservations(input.profileId, { from: input.from, to: input.to }));
    const relevant = all.filter((o) => o.metric === input.metric);
    if (relevant.length < this.policy.minimumBaselineSample) return null;

    const values = relevant.map((o) => o.value);
    const times = relevant.map((o) => o.measuredAt).sort();
    const medianValue = median(values)!;

    return {
      profileId: input.profileId,
      metric: input.metric,
      comparisonScope: scope,
      sampleSize: relevant.length,
      median: medianValue,
      mean: mean(values),
      standardDeviation: standardDeviation(values),
      window: { from: input.from ?? times[0]!, to: input.to ?? times[times.length - 1]! },
      calculatedAt: this.now(),
    };
  }

  /**
   * Compares one observation against a baseline. Direction alone is never a
   * verdict — `above` becomes `winner` only through `assessExperimentOutcome`,
   * which additionally requires the right metric for the objective and an
   * effect past `policy.breakoutThreshold`.
   */
  compareObservationToBaseline(
    observation: AnalyticalObservation,
    baseline: PerformanceBaseline,
  ): ComparisonResult {
    const relative = relativeChange(observation.value, baseline.median);
    const limitations: AnalysisLimitation[] = [];
    if (baseline.sampleSize < this.policy.minimumBaselineSample) limitations.push('small_sample');
    if (relative === undefined) limitations.push('unmatched_comparison');
    if (
      baseline.standardDeviation !== undefined &&
      baseline.median > 0 &&
      baseline.standardDeviation > baseline.median
    ) {
      limitations.push('large_variance');
    }

    let direction: ComparisonDirection = 'near_baseline';
    if (relative !== undefined) {
      if (relative >= this.policy.breakoutThreshold) direction = 'above';
      else if (relative <= this.policy.failureThreshold) direction = 'below';
    } else if (observation.value > baseline.median) {
      direction = 'above';
    } else if (observation.value < baseline.median) {
      direction = 'below';
    }

    return {
      id: `cmp_${randomUUID()}`,
      profileId: observation.profileId,
      experimentId: observation.experimentId,
      observationId: observation.id,
      metric: observation.metric,
      observedValue: observation.value,
      baselineMedian: baseline.median,
      baselineSampleSize: baseline.sampleSize,
      comparisonScope: baseline.comparisonScope,
      absoluteDifference: observation.value - baseline.median,
      ...(relative !== undefined ? { relativeDifference: relative } : {}),
      effectSize: buildEffectSize(observation.metric, observation.value, baseline.median),
      direction,
      limitations,
      measuredAt: observation.measuredAt,
      createdAt: this.now(),
    };
  }

  /**
   * The verdict on one experiment, decided ONLY on metrics its registered
   * objective maps to. Other metrics that moved are reported as exploratory
   * and cannot change the verdict — see the no-p-hacking note in the module
   * doc.
   */
  async assessExperimentOutcome(experimentId: string): Promise<OutcomeAssessment | null> {
    const experiment = await this.store.getExperiment(experimentId);
    if (!experiment) return null;

    const observations = await this.loadObservations(experiment.profileId);
    const forExperiment = observations.filter((o) => o.experimentId === experimentId);
    const objectiveMetrics = this.metricsForObjective(experiment.objective);
    const assessedAt = this.now();

    const decidingObservation = forExperiment.find((o) => objectiveMetrics.includes(o.metric));
    const limitations: AnalysisLimitation[] = [];

    if (!decidingObservation) {
      // The dependent metric was never reported. Missing is not zero, and
      // missing is never failure.
      limitations.push('missing_metric');
      return {
        experimentId,
        profileId: experiment.profileId,
        objective: experiment.objective,
        verdict: 'insufficient_evidence',
        exploratoryComparisons: [],
        limitations,
        assessedAt,
      };
    }

    // The baseline deliberately excludes this experiment's own observations:
    // a result must be compared against what normal looks like *without* it.
    const baselinePool = observations.filter((o) => o.experimentId !== experimentId);
    const baseline = await this.calculateProfileBaseline({
      profileId: experiment.profileId,
      metric: decidingObservation.metric,
      observations: baselinePool,
    });

    if (!baseline) {
      limitations.push('no_baseline', 'small_sample');
      return {
        experimentId,
        profileId: experiment.profileId,
        objective: experiment.objective,
        decidedOnMetric: decidingObservation.metric,
        verdict: 'insufficient_evidence',
        exploratoryComparisons: [],
        limitations,
        assessedAt,
      };
    }

    const comparison = this.compareObservationToBaseline(decidingObservation, baseline);
    let verdict: OutcomeVerdict = 'neutral';
    if (comparison.direction === 'above') verdict = 'winner';
    else if (comparison.direction === 'below') verdict = 'failure';

    // Exploratory only: every non-objective metric that also has a usable
    // baseline. Reported for transparency, never used to decide.
    const exploratoryComparisons: ComparisonResult[] = [];
    for (const observation of forExperiment) {
      if (objectiveMetrics.includes(observation.metric)) continue;
      const exploratoryBaseline = await this.calculateProfileBaseline({
        profileId: experiment.profileId,
        metric: observation.metric,
        observations: baselinePool,
      });
      if (exploratoryBaseline) {
        exploratoryComparisons.push(this.compareObservationToBaseline(observation, exploratoryBaseline));
      }
    }

    return {
      experimentId,
      profileId: experiment.profileId,
      objective: experiment.objective,
      decidedOnMetric: decidingObservation.metric,
      verdict,
      comparison,
      exploratoryComparisons,
      limitations: [...limitations, ...comparison.limitations],
      assessedAt,
    };
  }

  /**
   * Compares the arms of paired experiments sharing a `pairId`. One pair is
   * evidence, never proof — every single-pair result carries the
   * `single_pair` limitation, and `policy.minimumPairedSample` governs when
   * paired evidence may support a finding.
   */
  async analyzePairedExperiments(input: {
    readonly profileId: string;
    readonly pairId: string;
    readonly metric: PerformanceMetric;
  }): Promise<PairedComparison | null> {
    const experiments = await this.store.listExperiments({ profileId: input.profileId });
    // Sorted by variant label so arm A/B assignment is deterministic — the
    // store's own ordering is by `updatedAt`, which ties for arms created
    // together and would otherwise make the sign of `absoluteDifference`
    // depend on insertion order.
    const arms = experiments
      .filter((e) => e.design.pairId === input.pairId)
      .sort((a, b) => (a.design.variant ?? a.id).localeCompare(b.design.variant ?? b.id));
    if (arms.length < 2) return null;

    const observations = await this.loadObservations(input.profileId);
    const valueFor = (experimentId: string): number | undefined =>
      observations.find((o) => o.experimentId === experimentId && o.metric === input.metric)?.value;

    const [armA, armB] = arms;
    const valueA = valueFor(armA!.id);
    const valueB = valueFor(armB!.id);
    if (valueA === undefined || valueB === undefined) return null;

    const limitations: AnalysisLimitation[] = ['single_pair'];
    if (armA!.contentDna.topic !== armB!.contentDna.topic) limitations.push('insufficient_controls');

    const relative = relativeChange(valueA, valueB);
    return {
      pairId: input.pairId,
      profileId: input.profileId,
      metric: input.metric,
      variantA: { experimentId: armA!.id, variant: armA!.design.variant ?? 'A', value: valueA },
      variantB: { experimentId: armB!.id, variant: armB!.design.variant ?? 'B', value: valueB },
      absoluteDifference: valueA - valueB,
      ...(relative !== undefined ? { relativeDifference: relative } : {}),
      winnerExperimentId: valueA === valueB ? null : valueA > valueB ? armA!.id : armB!.id,
      limitations,
      createdAt: this.now(),
    };
  }

  /**
   * Records one traceable piece of evidence for or against a hypothesis.
   * Contradictory evidence (`supports: false`) is stored permanently and is
   * never removed when confidence later rises.
   */
  async recordHypothesisEvidence(input: {
    readonly hypothesisId: string;
    readonly experimentId: string;
    readonly profileId: string;
    readonly comparison: ComparisonResult;
    readonly supports: boolean;
    readonly notes?: string;
  }): Promise<HypothesisEvidence> {
    const evidence: HypothesisEvidence = {
      id: `hev_${randomUUID()}`,
      hypothesisId: input.hypothesisId,
      experimentId: input.experimentId,
      profileId: input.profileId,
      comparisonId: input.comparison.id,
      metric: input.comparison.metric,
      direction: input.comparison.direction,
      effectSize: input.comparison.effectSize,
      supports: input.supports,
      measuredAt: input.comparison.measuredAt,
      notes: input.notes,
      sourceIds: [input.comparison.observationId, input.comparison.id],
      createdAt: this.now(),
    };
    await this.store.saveHypothesisEvidence(evidence);
    return evidence;
  }

  /**
   * Evaluates a hypothesis against its accumulated evidence.
   *
   * `inconclusive` is a first-class outcome, not a failure to decide: it is
   * the honest answer when evidence is plentiful but contradictory, and it
   * is deliberately distinct from `rejected` ("we tested it and it's
   * false"). Below `policy.minimumHypothesisSample` the status stays
   * `testing` — not enough evidence to say anything yet.
   */
  async evaluateHypothesis(hypothesisId: string): Promise<HypothesisEvaluation | null> {
    const hypothesis = await this.store.getHypothesis(hypothesisId);
    if (!hypothesis) return null;

    const evidence = await this.store.listHypothesisEvidence({ hypothesisId });
    const supporting = evidence.filter((e) => e.supports);
    const contradicting = evidence.filter((e) => !e.supports);
    const total = evidence.length;
    const evaluatedAt = this.now();
    const limitations: AnalysisLimitation[] = [];

    const relativeEffects = evidence
      .map((e) => e.effectSize.relativeChange)
      .filter((r): r is number => r !== undefined)
      .map(Math.abs);
    const averageAbsoluteRelativeEffect = mean(relativeEffects);

    const confidence = computeOperationalConfidence({
      supportingCount: supporting.length,
      contradictingCount: contradicting.length,
      averageAbsoluteRelativeEffect,
    });

    let status: HypothesisEvaluation['status'];
    if (total === 0) {
      status = hypothesis.status === 'proposed' ? 'proposed' : 'testing';
      limitations.push('small_sample');
    } else if (total < this.policy.minimumHypothesisSample) {
      status = 'testing';
      limitations.push('small_sample');
    } else if (supporting.length > 0 && contradicting.length > 0 && confidence < this.policy.minimumConfidenceForFinding) {
      // Plentiful but conflicting — "we could not tell" is the honest answer,
      // and is NOT the same as "it is false".
      status = 'inconclusive';
    } else if (supporting.length > contradicting.length && confidence >= this.policy.minimumConfidenceForFinding) {
      status = 'supported';
    } else if (contradicting.length > supporting.length && confidence >= this.policy.minimumConfidenceForFinding) {
      status = 'rejected';
    } else {
      status = 'inconclusive';
    }

    return {
      hypothesisId,
      status,
      supportingCount: supporting.length,
      contradictingCount: contradicting.length,
      confidence,
      limitations,
      evaluatedAt,
    };
  }

  /**
   * Emits (or updates) a `Finding` — but only when policy thresholds are
   * met. Returns `null` when they are not, rather than emitting a weak
   * conclusion.
   *
   * SCOPE DISCIPLINE: defaults to the NARROWEST justified scope — profile
   * level. A broader scope must be passed explicitly by a caller that
   * actually has cross-profile evidence; a single profile's result can
   * never widen itself into a niche, platform or global claim.
   *
   * WORDING: the statement is composed deterministically and conservatively
   * — "was associated with … under the tested conditions", never "always
   * boosts". No LLM is involved.
   */
  async emitFinding(input: {
    readonly statement: string;
    readonly evaluation: HypothesisEvaluation;
    readonly context: FindingEmissionContext;
    readonly sourceExperimentIds: readonly string[];
    readonly effectSize?: Finding['effectSize'];
    /** Content DNA the finding is about, carried onto it for downstream consumers. */
    readonly hookFamily?: Finding['hookFamily'];
    readonly contentFormat?: Finding['contentFormat'];
    readonly contentPillarId?: Finding['contentPillarId'];
    /** The period the evidence covers, distinct from when this record was written. */
    readonly observationWindow?: Finding['observationWindow'];
    /** Extra caveats to carry onto the finding, merged with the evaluation's own. */
    readonly limitations?: readonly AnalysisLimitation[];
    readonly existingFindingId?: string;
  }): Promise<Finding | null> {
    const { evaluation, context } = input;
    const totalEvidence = evaluation.supportingCount + evaluation.contradictingCount;
    if (totalEvidence < this.policy.minimumHypothesisSample) return null;
    if (evaluation.status === 'inconclusive' || evaluation.status === 'testing' || evaluation.status === 'proposed') {
      return null;
    }

    const now = this.now();
    const status: Finding['status'] =
      evaluation.status === 'rejected'
        ? 'rejected'
        : evaluation.confidence >= this.policy.minimumConfidenceForFinding
          ? 'validated'
          : 'promising';

    const finding: Finding = {
      id: input.existingFindingId ?? `fnd_${randomUUID()}`,
      statement: input.statement,
      // Narrowest justified scope unless the caller supplies evidence for a broader one.
      scope: context.scope ?? { level: 'profile', profileId: context.profileId },
      platform: context.platform,
      niche: context.niche,
      subNiche: context.subNiche,
      profileId: context.profileId,
      audienceSegmentId: context.audienceSegmentId,
      accountStage: context.accountStage,
      objective: context.objective,
      sampleSize: totalEvidence,
      confidence: clampConfidence(evaluation.confidence),
      effectSize: input.effectSize,
      status,
      sourceExperimentIds: input.sourceExperimentIds,
      hookFamily: input.hookFamily,
      contentFormat: input.contentFormat,
      contentPillarId: input.contentPillarId,
      observationWindow: input.observationWindow,
      // Caveats travel with the conclusion. The evaluation's own limitations
      // are carried forward so a thin result cannot arrive downstream
      // looking unqualified.
      limitations: [...new Set([...evaluation.limitations, ...(input.limitations ?? [])])],
      createdAt: now,
      lastValidatedAt: now,
    };
    await this.store.saveFinding(finding);
    return finding;
  }

  /** Whether a finding still earns its place. Never deletes anything. */
  assessFindingFreshness(finding: Finding, asOf: IsoDateTime = this.now()): FindingFreshness {
    const age = daysBetween(finding.lastValidatedAt, asOf);
    if (age >= this.policy.decayWindowDays) return 'decaying';
    if (age >= this.policy.revalidationWindowDays) return 'due_for_revalidation';
    return 'current';
  }

  /**
   * Findings and hypotheses due for re-testing. Returns ids and reasons
   * only — no posts are scheduled and no strategy is changed. The Battle
   * Engine will consume this in a later milestone.
   */
  async identifyRevalidationCandidates(profileId: string, asOf: IsoDateTime = this.now()): Promise<RevalidationCandidate[]> {
    const candidates: RevalidationCandidate[] = [];

    for (const finding of await this.store.listFindings({ profileId })) {
      // Rejected findings are retained as knowledge but are not re-queued.
      if (finding.status === 'rejected') continue;
      const freshness = this.assessFindingFreshness(finding, asOf);
      if (freshness !== 'current') {
        candidates.push({
          subjectType: 'finding',
          subjectId: finding.id,
          profileId,
          freshness,
          reason: `Last validated ${daysBetween(finding.lastValidatedAt, asOf)} days ago.`,
          lastValidatedAt: finding.lastValidatedAt,
        });
      }
    }

    for (const hypothesis of await this.store.listHypotheses({ profileId })) {
      if (hypothesis.status !== 'inconclusive') continue;
      candidates.push({
        subjectType: 'hypothesis',
        subjectId: hypothesis.id,
        profileId,
        freshness: 'due_for_revalidation',
        reason: 'Hypothesis is inconclusive — more evidence is needed to decide it.',
        lastValidatedAt: hypothesis.lastTestedAt,
      });
    }

    return candidates;
  }

  /**
   * A machine-readable report on one experiment, carrying its own
   * limitations and lineage. Deliberately conservative wording — the
   * conclusion names an association under tested conditions, never a
   * universal causal law.
   */
  async buildExperimentReport(experimentId: string): Promise<ScienceReport | null> {
    const assessment = await this.assessExperimentOutcome(experimentId);
    if (!assessment) return null;

    const comparisons = assessment.comparison ? [assessment.comparison] : [];
    const lineage = [
      experimentId,
      ...comparisons.map((c) => c.id),
      ...comparisons.map((c) => c.observationId),
      ...assessment.exploratoryComparisons.map((c) => c.id),
    ];

    const metricName = assessment.decidedOnMetric ?? 'the dependent metric';
    const conclusion =
      assessment.verdict === 'insufficient_evidence'
        ? `Insufficient evidence to judge this experiment on ${metricName} under the tested conditions.`
        : assessment.verdict === 'winner'
          ? `This experiment was associated with higher ${metricName} than the profile baseline under the tested conditions.`
          : assessment.verdict === 'failure'
            ? `This experiment was associated with lower ${metricName} than the profile baseline under the tested conditions.`
            : `This experiment performed near the profile baseline for ${metricName} under the tested conditions.`;

    const confidence = assessment.comparison
      ? computeOperationalConfidence({
          supportingCount: 1,
          contradictingCount: 0,
          averageAbsoluteRelativeEffect: Math.abs(assessment.comparison.relativeDifference ?? 0),
        })
      : 0;

    return {
      id: `rpt_${randomUUID()}`,
      subjectType: 'experiment',
      subjectId: experimentId,
      profileId: assessment.profileId,
      objective: assessment.objective,
      metric: assessment.decidedOnMetric,
      comparisons,
      evidenceSummary: {
        observationCount: comparisons.length + assessment.exploratoryComparisons.length,
        supportingCount: assessment.verdict === 'winner' ? 1 : 0,
        contradictingCount: assessment.verdict === 'failure' ? 1 : 0,
      },
      conclusion,
      verdict: assessment.verdict,
      confidence,
      limitations: assessment.limitations,
      lineage,
      createdAt: this.now(),
    };
  }
}

/**
 * An `ObservedAssociation` (Milestone 5) may generate or support a
 * hypothesis CANDIDATE, but can never itself justify a causal `Finding` —
 * causal support requires controlled experimental evidence. This guard
 * makes that rule enforceable at the service layer rather than leaving it
 * to convention.
 */
export function assertNotCausalFromObservation(claim: { readonly claimType: string; readonly causalStatus: string }): void {
  if (claim.claimType === 'observed_association' && claim.causalStatus === 'causal_supported') {
    throw new Error(
      'An observed_association cannot carry causal_supported status — causal support requires controlled experimental evidence.',
    );
  }
}

/** Whether a strategy claim may seed a hypothesis. Observational and playbook claims may; none of them may skip straight to a Finding. */
export function canSeedHypothesis(claim: { readonly claimType: string }): boolean {
  return [
    'playbook_claim',
    'platform_claim',
    'research_claim',
    'observed_association',
    'experimental_claim',
    'heuristic',
  ].includes(claim.claimType);
}

export type { Hypothesis };
