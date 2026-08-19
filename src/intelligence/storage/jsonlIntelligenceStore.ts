/**
 * JSONL adapter for the intelligence storage port. Same discipline as
 * `src/storage/jsonlStore.ts`: append-only files, corrupt lines are skipped
 * on read, a missing file reads as empty, and mutable knowledge is
 * "latest line wins per key" while raw evidence is never collapsed —
 * see the header comment in `store.ts` for the raw-evidence-vs-learned-
 * interpretation rule this file implements.
 *
 * Files live under `<workspaceRoot>/kairos/intelligence/*.jsonl`, alongside
 * the existing `kairos/` data directory described in `src/paths.ts`.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PerformanceMetric } from '../performance/types.js';
import type { BaselineComparisonScope, PerformanceBaseline } from '../performance/types.js';
import type { SocialProfile } from '../profiles/types.js';
import type { Experiment, ExperimentObservation, Finding, Hypothesis } from '../science/types.js';
import type { ProfileBrain, StrategyPrinciple } from '../strategy/types.js';
import type {
  AudienceSignal,
  ObservedAudienceSegment,
  SegmentFinding,
  SegmentPerformance,
} from '../audience/types.js';
import type { ResearchSource, StrategyClaim } from '../research/types.js';
import type {
  AttributionEvent,
  CreatorOsMeasurementSnapshot,
  PostMeasurement,
  ProfileMeasurementSnapshot,
} from '../measurement/types.js';
import type { HypothesisEvidence } from '../science/analysisTypes.js';
import type { AdaptiveStrategyPlan, StrategyRecommendation } from '../adaptive/types.js';
import type {
  BattleCategoryResult,
  BattleCompetitor,
  BattleDivision,
  BattleExperimentRegistration,
  BattleMatchup,
  BattleMilestoneAchievement,
  BattleMilestoneDefinition,
  BattleOutcome,
  BattlePrediction,
  BattleProtocol,
  BattleRound,
  BattleScoringModel,
  BattleSeason,
} from '../battle/types.js';
import type {
  AdaptiveStrategyPlanQuery,
  AttributionEventQuery,
  BattlePredictionQuery,
  BattleSeasonQuery,
  BattleSeasonScopedQuery,
  HypothesisEvidenceQuery,
  StrategyRecommendationQuery,
  AudienceSignalQuery,
  BaselineQuery,
  ExperimentQuery,
  FindingQuery,
  HypothesisQuery,
  IntelligenceStore,
  MeasurementSnapshotQuery,
  ObservedSegmentQuery,
  PostMeasurementQuery,
  ProfileMeasurementQuery,
  ProfileQuery,
  ResearchSourceQuery,
  SegmentFindingQuery,
  StrategyClaimQuery,
  StrategyPrincipleQuery,
} from './store.js';

function intelligenceDir(workspaceRoot: string): string {
  return join(workspaceRoot, 'kairos', 'intelligence');
}

export function profilesPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'profiles.jsonl');
}

export function profileBrainsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'profile-brains.jsonl');
}

export function strategyPrinciplesPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'strategy-principles.jsonl');
}

export function experimentsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'experiments.jsonl');
}

export function experimentResultsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'experiment-results.jsonl');
}

export function hypothesesPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'hypotheses.jsonl');
}

export function findingsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'findings.jsonl');
}

export function baselinesPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'baselines.jsonl');
}

export function audienceSignalsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'audience-signals.jsonl');
}

export function observedSegmentsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'observed-segments.jsonl');
}

export function segmentFindingsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'segment-findings.jsonl');
}

export function segmentPerformancePath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'segment-performance.jsonl');
}

export function researchSourcesPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'research-sources.jsonl');
}

export function strategyClaimsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'strategy-claims.jsonl');
}

export function measurementSnapshotsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'measurement-snapshots.jsonl');
}

export function postMeasurementsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'post-measurements.jsonl');
}

export function profileMeasurementSnapshotsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'profile-measurement-snapshots.jsonl');
}

export function attributionEventsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'attribution-events.jsonl');
}

export function hypothesisEvidencePath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'hypothesis-evidence.jsonl');
}

export function strategyRecommendationsPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'strategy-recommendations.jsonl');
}

export function adaptiveStrategyPlansPath(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'adaptive-strategy-plans.jsonl');
}

/** All Battle Engine records live under `kairos/intelligence/battle/`. */
function battleDir(workspaceRoot: string): string {
  return join(intelligenceDir(workspaceRoot), 'battle');
}

export function battlePath(workspaceRoot: string, name: string): string {
  return join(battleDir(workspaceRoot), `${name}.jsonl`);
}

async function appendLine(path: string, entry: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * Parse a JSONL file into latest-line-wins-per-key records, insertion order
 * kept. Used both for id-keyed knowledge (upsert semantics) and for
 * observation-keyed raw evidence, where every observation's key is unique by
 * construction, so "latest wins per key" never collapses distinct
 * observations into one another.
 */
async function readLatestByKey<T>(path: string, keyOf: (item: T) => string | undefined): Promise<T[]> {
  if (!existsSync(path)) return [];
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const byKey = new Map<string, T>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as T;
      const key = keyOf(parsed);
      if (key) {
        byKey.delete(key); // re-insert so later writes also sort later
        byKey.set(key, parsed);
      }
    } catch {
      // corrupt line — skip, never fail the read
    }
  }
  return [...byKey.values()];
}

function scopeKey(scope: BaselineComparisonScope): string {
  switch (scope.kind) {
    case 'all-recent-posts':
      return 'all-recent-posts';
    case 'hook-family':
      return `hook-family:${scope.hookFamily}`;
    case 'content-format':
      return `content-format:${scope.format}`;
    case 'objective':
      return `objective:${scope.objective}`;
    case 'audience-segment':
      return `audience-segment:${scope.audienceSegmentId}`;
    default: {
      const exhaustive: never = scope;
      throw new Error(`unhandled baseline comparison scope: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The stable identity of a baseline: no calculated value is part of its key. */
function baselineKey(profileId: string, metric: PerformanceMetric, scope: BaselineComparisonScope): string {
  return `${profileId}::${metric}::${scopeKey(scope)}`;
}

export class JsonlIntelligenceStore implements IntelligenceStore {
  constructor(private readonly workspaceRoot: string) {}

  async saveProfile(profile: SocialProfile): Promise<void> {
    await appendLine(profilesPath(this.workspaceRoot), profile);
  }

  async getProfile(id: string): Promise<SocialProfile | null> {
    const all = await readLatestByKey<SocialProfile>(profilesPath(this.workspaceRoot), (p) => p.id);
    return all.find((p) => p.id === id) ?? null;
  }

  async listProfiles(query: ProfileQuery = {}): Promise<SocialProfile[]> {
    let profiles = await readLatestByKey<SocialProfile>(profilesPath(this.workspaceRoot), (p) => p.id);
    if (query.platform) profiles = profiles.filter((p) => p.platform === query.platform);
    if (query.niche) profiles = profiles.filter((p) => p.market.niche === query.niche);
    profiles.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return profiles.slice(0, query.limit ?? 100);
  }

  async saveProfileBrain(brain: ProfileBrain): Promise<void> {
    await appendLine(profileBrainsPath(this.workspaceRoot), brain);
  }

  async getProfileBrain(profileId: string): Promise<ProfileBrain | null> {
    const all = await readLatestByKey<ProfileBrain>(profileBrainsPath(this.workspaceRoot), (b) => b.profileId);
    return all.find((b) => b.profileId === profileId) ?? null;
  }

  async saveStrategyPrinciple(principle: StrategyPrinciple): Promise<void> {
    await appendLine(strategyPrinciplesPath(this.workspaceRoot), principle);
  }

  async getStrategyPrinciple(id: string): Promise<StrategyPrinciple | null> {
    const all = await readLatestByKey<StrategyPrinciple>(strategyPrinciplesPath(this.workspaceRoot), (p) => p.id);
    return all.find((p) => p.id === id) ?? null;
  }

  async listStrategyPrinciples(query: StrategyPrincipleQuery = {}): Promise<StrategyPrinciple[]> {
    let principles = await readLatestByKey<StrategyPrinciple>(strategyPrinciplesPath(this.workspaceRoot), (p) => p.id);
    if (query.status) principles = principles.filter((p) => p.status === query.status);
    if (query.sourceType) principles = principles.filter((p) => p.sourceType === query.sourceType);
    if (query.scopeLevel) principles = principles.filter((p) => p.scope.level === query.scopeLevel);
    principles.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return principles.slice(0, query.limit ?? 100);
  }

  async saveExperiment(experiment: Experiment): Promise<void> {
    await appendLine(experimentsPath(this.workspaceRoot), experiment);
  }

  async getExperiment(id: string): Promise<Experiment | null> {
    const all = await readLatestByKey<Experiment>(experimentsPath(this.workspaceRoot), (e) => e.id);
    return all.find((e) => e.id === id) ?? null;
  }

  async listExperiments(query: ExperimentQuery = {}): Promise<Experiment[]> {
    let experiments = await readLatestByKey<Experiment>(experimentsPath(this.workspaceRoot), (e) => e.id);
    if (query.profileId) experiments = experiments.filter((e) => e.profileId === query.profileId);
    if (query.objective) experiments = experiments.filter((e) => e.objective === query.objective);
    if (query.platform) experiments = experiments.filter((e) => e.platform === query.platform);
    experiments.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return experiments.slice(0, query.limit ?? 100);
  }

  async saveExperimentObservation(observation: ExperimentObservation): Promise<void> {
    await appendLine(experimentResultsPath(this.workspaceRoot), observation);
  }

  async listExperimentObservations(experimentId: string): Promise<ExperimentObservation[]> {
    const all = await readLatestByKey<ExperimentObservation>(
      experimentResultsPath(this.workspaceRoot),
      (o) => o.id,
    );
    return all
      .filter((o) => o.experimentId === experimentId)
      .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  }

  async saveHypothesis(hypothesis: Hypothesis): Promise<void> {
    await appendLine(hypothesesPath(this.workspaceRoot), hypothesis);
  }

  async getHypothesis(id: string): Promise<Hypothesis | null> {
    const all = await readLatestByKey<Hypothesis>(hypothesesPath(this.workspaceRoot), (h) => h.id);
    return all.find((h) => h.id === id) ?? null;
  }

  async listHypotheses(query: HypothesisQuery = {}): Promise<Hypothesis[]> {
    let hypotheses = await readLatestByKey<Hypothesis>(hypothesesPath(this.workspaceRoot), (h) => h.id);
    if (query.profileId) hypotheses = hypotheses.filter((h) => h.profileId === query.profileId);
    if (query.status) hypotheses = hypotheses.filter((h) => h.status === query.status);
    hypotheses.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return hypotheses.slice(0, query.limit ?? 100);
  }

  async saveFinding(finding: Finding): Promise<void> {
    await appendLine(findingsPath(this.workspaceRoot), finding);
  }

  async getFinding(id: string): Promise<Finding | null> {
    const all = await readLatestByKey<Finding>(findingsPath(this.workspaceRoot), (f) => f.id);
    return all.find((f) => f.id === id) ?? null;
  }

  async listFindings(query: FindingQuery = {}): Promise<Finding[]> {
    let findings = await readLatestByKey<Finding>(findingsPath(this.workspaceRoot), (f) => f.id);
    if (query.profileId) findings = findings.filter((f) => f.profileId === query.profileId);
    if (query.status) findings = findings.filter((f) => f.status === query.status);
    if (query.scopeLevel) findings = findings.filter((f) => f.scope.level === query.scopeLevel);
    findings.sort((a, b) => (a.lastValidatedAt < b.lastValidatedAt ? 1 : -1));
    return findings.slice(0, query.limit ?? 100);
  }

  async saveBaseline(baseline: PerformanceBaseline): Promise<void> {
    await appendLine(baselinesPath(this.workspaceRoot), baseline);
  }

  async getBaseline(
    profileId: string,
    metric: PerformanceMetric,
    comparisonScope: BaselineComparisonScope,
  ): Promise<PerformanceBaseline | null> {
    const key = baselineKey(profileId, metric, comparisonScope);
    const all = await readLatestByKey<PerformanceBaseline>(baselinesPath(this.workspaceRoot), (b) =>
      baselineKey(b.profileId, b.metric, b.comparisonScope),
    );
    return all.find((b) => baselineKey(b.profileId, b.metric, b.comparisonScope) === key) ?? null;
  }

  async listBaselines(query: BaselineQuery): Promise<PerformanceBaseline[]> {
    let baselines = await readLatestByKey<PerformanceBaseline>(baselinesPath(this.workspaceRoot), (b) =>
      baselineKey(b.profileId, b.metric, b.comparisonScope),
    );
    baselines = baselines.filter((b) => b.profileId === query.profileId);
    if (query.metric) baselines = baselines.filter((b) => b.metric === query.metric);
    baselines.sort((a, b) => (a.calculatedAt < b.calculatedAt ? 1 : -1));
    return baselines.slice(0, query.limit ?? 100);
  }

  async saveAudienceSignal(signal: AudienceSignal): Promise<void> {
    await appendLine(audienceSignalsPath(this.workspaceRoot), signal);
  }

  async getAudienceSignal(id: string): Promise<AudienceSignal | null> {
    const all = await readLatestByKey<AudienceSignal>(audienceSignalsPath(this.workspaceRoot), (s) => s.id);
    return all.find((s) => s.id === id) ?? null;
  }

  async listAudienceSignals(query: AudienceSignalQuery): Promise<AudienceSignal[]> {
    let signals = await readLatestByKey<AudienceSignal>(audienceSignalsPath(this.workspaceRoot), (s) => s.id);
    signals = signals.filter((s) => s.profileId === query.profileId);
    if (query.segmentId) {
      signals = signals.filter((s) => s.segmentId === query.segmentId);
    } else if (query.unclassifiedOnly) {
      signals = signals.filter((s) => s.segmentId === undefined);
    }
    if (query.signalType) signals = signals.filter((s) => s.signalType === query.signalType);
    if (query.from) signals = signals.filter((s) => s.observedAt >= query.from!);
    if (query.to) signals = signals.filter((s) => s.observedAt <= query.to!);
    signals.sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1));
    return signals.slice(0, query.limit ?? 500);
  }

  async saveObservedSegment(segment: ObservedAudienceSegment): Promise<void> {
    await appendLine(observedSegmentsPath(this.workspaceRoot), segment);
  }

  async getObservedSegment(id: string): Promise<ObservedAudienceSegment | null> {
    const all = await readLatestByKey<ObservedAudienceSegment>(observedSegmentsPath(this.workspaceRoot), (s) => s.id);
    return all.find((s) => s.id === id) ?? null;
  }

  async listObservedSegments(query: ObservedSegmentQuery): Promise<ObservedAudienceSegment[]> {
    let segments = await readLatestByKey<ObservedAudienceSegment>(observedSegmentsPath(this.workspaceRoot), (s) => s.id);
    segments = segments.filter((s) => s.profileId === query.profileId);
    if (query.status) segments = segments.filter((s) => s.status === query.status);
    segments.sort((a, b) => (a.lastObservedAt < b.lastObservedAt ? 1 : -1));
    return segments.slice(0, query.limit ?? 100);
  }

  async saveSegmentFinding(finding: SegmentFinding): Promise<void> {
    await appendLine(segmentFindingsPath(this.workspaceRoot), finding);
  }

  async getSegmentFinding(id: string): Promise<SegmentFinding | null> {
    const all = await readLatestByKey<SegmentFinding>(segmentFindingsPath(this.workspaceRoot), (f) => f.id);
    return all.find((f) => f.id === id) ?? null;
  }

  async listSegmentFindings(query: SegmentFindingQuery): Promise<SegmentFinding[]> {
    let findings = await readLatestByKey<SegmentFinding>(segmentFindingsPath(this.workspaceRoot), (f) => f.id);
    findings = findings.filter((f) => f.profileId === query.profileId);
    if (query.segmentId) findings = findings.filter((f) => f.segmentId === query.segmentId);
    if (query.status) findings = findings.filter((f) => f.status === query.status);
    findings.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return findings.slice(0, query.limit ?? 100);
  }

  async saveSegmentPerformance(performance: SegmentPerformance): Promise<void> {
    await appendLine(segmentPerformancePath(this.workspaceRoot), performance);
  }

  async listSegmentPerformance(profileId: string, segmentId: string): Promise<SegmentPerformance[]> {
    const all = await readLatestByKey<SegmentPerformance>(segmentPerformancePath(this.workspaceRoot), (p) => p.id);
    return all
      .filter((p) => p.profileId === profileId && p.segmentId === segmentId)
      .sort((a, b) => (a.calculatedAt < b.calculatedAt ? -1 : 1));
  }

  async saveResearchSource(source: ResearchSource): Promise<void> {
    await appendLine(researchSourcesPath(this.workspaceRoot), source);
  }

  async getResearchSource(id: string): Promise<ResearchSource | null> {
    const all = await readLatestByKey<ResearchSource>(researchSourcesPath(this.workspaceRoot), (s) => s.id);
    return all.find((s) => s.id === id) ?? null;
  }

  async listResearchSources(query: ResearchSourceQuery = {}): Promise<ResearchSource[]> {
    let sources = await readLatestByKey<ResearchSource>(researchSourcesPath(this.workspaceRoot), (s) => s.id);
    if (query.sourceType) sources = sources.filter((s) => s.sourceType === query.sourceType);
    if (query.platform) sources = sources.filter((s) => s.platformsDiscussed?.includes(query.platform!));
    sources.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return sources.slice(0, query.limit ?? 100);
  }

  async saveStrategyClaim(claim: StrategyClaim): Promise<void> {
    await appendLine(strategyClaimsPath(this.workspaceRoot), claim);
  }

  async getStrategyClaim(id: string): Promise<StrategyClaim | null> {
    const all = await readLatestByKey<StrategyClaim>(strategyClaimsPath(this.workspaceRoot), (c) => c.id);
    return all.find((c) => c.id === id) ?? null;
  }

  async listStrategyClaims(query: StrategyClaimQuery = {}): Promise<StrategyClaim[]> {
    let claims = await readLatestByKey<StrategyClaim>(strategyClaimsPath(this.workspaceRoot), (c) => c.id);
    if (query.sourceId) claims = claims.filter((c) => c.sourceId === query.sourceId);
    if (query.claimType) claims = claims.filter((c) => c.claimType === query.claimType);
    if (query.status) claims = claims.filter((c) => c.status === query.status);
    if (query.platform) {
      const platform = query.platform;
      claims = claims.filter(
        (c) => c.platforms?.includes(platform) || (c.scope.level === 'platform' && c.scope.platform === platform),
      );
    }
    if (query.objective) claims = claims.filter((c) => c.objectives?.includes(query.objective!));
    claims.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return claims.slice(0, query.limit ?? 100);
  }

  async saveMeasurementSnapshot(snapshot: CreatorOsMeasurementSnapshot): Promise<void> {
    await appendLine(measurementSnapshotsPath(this.workspaceRoot), snapshot);
  }

  async getMeasurementSnapshot(id: string): Promise<CreatorOsMeasurementSnapshot | null> {
    const all = await readLatestByKey<CreatorOsMeasurementSnapshot>(measurementSnapshotsPath(this.workspaceRoot), (s) => s.id);
    return all.find((s) => s.id === id) ?? null;
  }

  async listMeasurementSnapshots(query: MeasurementSnapshotQuery): Promise<CreatorOsMeasurementSnapshot[]> {
    let snapshots = await readLatestByKey<CreatorOsMeasurementSnapshot>(measurementSnapshotsPath(this.workspaceRoot), (s) => s.id);
    snapshots = snapshots.filter((s) => s.profileId === query.profileId);
    if (query.creatorOsPostId) snapshots = snapshots.filter((s) => s.creatorOsPostId === query.creatorOsPostId);
    if (query.experimentId) snapshots = snapshots.filter((s) => s.experimentId === query.experimentId);
    if (query.from) snapshots = snapshots.filter((s) => s.capturedAt >= query.from!);
    if (query.to) snapshots = snapshots.filter((s) => s.capturedAt <= query.to!);
    snapshots.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
    return snapshots.slice(0, query.limit ?? 500);
  }

  async savePostMeasurement(measurement: PostMeasurement): Promise<void> {
    await appendLine(postMeasurementsPath(this.workspaceRoot), measurement);
  }

  async getPostMeasurement(id: string): Promise<PostMeasurement | null> {
    const all = await readLatestByKey<PostMeasurement>(postMeasurementsPath(this.workspaceRoot), (m) => m.id);
    return all.find((m) => m.id === id) ?? null;
  }

  async listPostMeasurements(query: PostMeasurementQuery): Promise<PostMeasurement[]> {
    let measurements = await readLatestByKey<PostMeasurement>(postMeasurementsPath(this.workspaceRoot), (m) => m.id);
    measurements = measurements.filter((m) => m.profileId === query.profileId);
    if (query.experimentId) measurements = measurements.filter((m) => m.experimentId === query.experimentId);
    if (query.creatorOsPostId) measurements = measurements.filter((m) => m.creatorOsPostId === query.creatorOsPostId);
    if (query.from) measurements = measurements.filter((m) => m.measuredAt >= query.from!);
    if (query.to) measurements = measurements.filter((m) => m.measuredAt <= query.to!);
    measurements.sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
    return measurements.slice(0, query.limit ?? 500);
  }

  async saveProfileMeasurementSnapshot(snapshot: ProfileMeasurementSnapshot): Promise<void> {
    await appendLine(profileMeasurementSnapshotsPath(this.workspaceRoot), snapshot);
  }

  async listProfileMeasurementSnapshots(query: ProfileMeasurementQuery): Promise<ProfileMeasurementSnapshot[]> {
    let snapshots = await readLatestByKey<ProfileMeasurementSnapshot>(
      profileMeasurementSnapshotsPath(this.workspaceRoot),
      (s) => s.id,
    );
    snapshots = snapshots.filter((s) => s.profileId === query.profileId);
    if (query.from) snapshots = snapshots.filter((s) => s.capturedAt >= query.from!);
    if (query.to) snapshots = snapshots.filter((s) => s.capturedAt <= query.to!);
    snapshots.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
    return snapshots.slice(0, query.limit ?? 500);
  }

  async saveAttributionEvent(event: AttributionEvent): Promise<void> {
    await appendLine(attributionEventsPath(this.workspaceRoot), event);
  }

  async getAttributionEvent(id: string): Promise<AttributionEvent | null> {
    const all = await readLatestByKey<AttributionEvent>(attributionEventsPath(this.workspaceRoot), (e) => e.id);
    return all.find((e) => e.id === id) ?? null;
  }

  async listAttributionEvents(query: AttributionEventQuery): Promise<AttributionEvent[]> {
    let events = await readLatestByKey<AttributionEvent>(attributionEventsPath(this.workspaceRoot), (e) => e.id);
    events = events.filter((e) => e.profileId === query.profileId);
    if (query.experimentId) events = events.filter((e) => e.experimentId === query.experimentId);
    if (query.creatorOsPostId) events = events.filter((e) => e.creatorOsPostId === query.creatorOsPostId);
    if (query.offerId) events = events.filter((e) => e.offerId === query.offerId);
    if (query.eventType) events = events.filter((e) => e.eventType === query.eventType);
    if (query.from) events = events.filter((e) => e.occurredAt >= query.from!);
    if (query.to) events = events.filter((e) => e.occurredAt <= query.to!);
    events.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
    return events.slice(0, query.limit ?? 500);
  }

  async saveHypothesisEvidence(evidence: HypothesisEvidence): Promise<void> {
    await appendLine(hypothesisEvidencePath(this.workspaceRoot), evidence);
  }

  async listHypothesisEvidence(query: HypothesisEvidenceQuery = {}): Promise<HypothesisEvidence[]> {
    let evidence = await readLatestByKey<HypothesisEvidence>(hypothesisEvidencePath(this.workspaceRoot), (e) => e.id);
    if (query.hypothesisId) evidence = evidence.filter((e) => e.hypothesisId === query.hypothesisId);
    if (query.profileId) evidence = evidence.filter((e) => e.profileId === query.profileId);
    if (query.experimentId) evidence = evidence.filter((e) => e.experimentId === query.experimentId);
    if (query.supports !== undefined) evidence = evidence.filter((e) => e.supports === query.supports);
    evidence.sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
    return evidence.slice(0, query.limit ?? 500);
  }

  async saveStrategyRecommendation(recommendation: StrategyRecommendation): Promise<void> {
    await appendLine(strategyRecommendationsPath(this.workspaceRoot), recommendation);
  }

  async getStrategyRecommendation(id: string): Promise<StrategyRecommendation | null> {
    const all = await readLatestByKey<StrategyRecommendation>(strategyRecommendationsPath(this.workspaceRoot), (r) => r.id);
    return all.find((r) => r.id === id) ?? null;
  }

  async listStrategyRecommendations(query: StrategyRecommendationQuery): Promise<StrategyRecommendation[]> {
    let recommendations = await readLatestByKey<StrategyRecommendation>(
      strategyRecommendationsPath(this.workspaceRoot),
      (r) => r.id,
    );
    recommendations = recommendations.filter((r) => r.profileId === query.profileId);
    if (query.status) recommendations = recommendations.filter((r) => r.status === query.status);
    if (query.recommendationType) recommendations = recommendations.filter((r) => r.recommendationType === query.recommendationType);
    if (query.action) recommendations = recommendations.filter((r) => r.action === query.action);
    recommendations.sort((a, b) =>
      b.priorityScore !== a.priorityScore ? b.priorityScore - a.priorityScore : a.id.localeCompare(b.id),
    );
    return recommendations.slice(0, query.limit ?? 200);
  }

  async saveAdaptiveStrategyPlan(plan: AdaptiveStrategyPlan): Promise<void> {
    await appendLine(adaptiveStrategyPlansPath(this.workspaceRoot), plan);
  }

  async getAdaptiveStrategyPlan(id: string): Promise<AdaptiveStrategyPlan | null> {
    const all = await readLatestByKey<AdaptiveStrategyPlan>(adaptiveStrategyPlansPath(this.workspaceRoot), (p) => p.id);
    return all.find((p) => p.id === id) ?? null;
  }

  async listAdaptiveStrategyPlans(query: AdaptiveStrategyPlanQuery): Promise<AdaptiveStrategyPlan[]> {
    let plans = await readLatestByKey<AdaptiveStrategyPlan>(adaptiveStrategyPlansPath(this.workspaceRoot), (p) => p.id);
    plans = plans.filter((p) => p.profileId === query.profileId);
    // Newest version first; every earlier version is retained.
    plans.sort((a, b) => b.version - a.version);
    return plans.slice(0, query.limit ?? 100);
  }

  // ---- Battle Engine ----------------------------------------------------

  /** Shared read for the season-scoped battle collections. */
  private async battleRecords<T extends { id: string }>(name: string): Promise<T[]> {
    return readLatestByKey<T>(battlePath(this.workspaceRoot, name), (r) => r.id);
  }

  async saveBattleSeason(season: BattleSeason): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'seasons'), season);
  }

  async getBattleSeason(id: string): Promise<BattleSeason | null> {
    return (await this.battleRecords<BattleSeason>('seasons')).find((s) => s.id === id) ?? null;
  }

  async listBattleSeasons(query: BattleSeasonQuery = {}): Promise<BattleSeason[]> {
    let seasons = await this.battleRecords<BattleSeason>('seasons');
    if (query.status) seasons = seasons.filter((s) => s.status === query.status);
    if (query.niche) seasons = seasons.filter((s) => s.niche === query.niche);
    if (query.isPublic !== undefined) seasons = seasons.filter((s) => s.isPublic === query.isPublic);
    seasons.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return seasons.slice(0, query.limit ?? 100);
  }

  async saveBattleProtocol(protocol: BattleProtocol): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'protocols'), protocol);
  }

  async getBattleProtocol(id: string): Promise<BattleProtocol | null> {
    return (await this.battleRecords<BattleProtocol>('protocols')).find((p) => p.id === id) ?? null;
  }

  async listBattleProtocols(): Promise<BattleProtocol[]> {
    return this.battleRecords<BattleProtocol>('protocols');
  }

  async saveBattleCompetitor(competitor: BattleCompetitor): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'competitors'), competitor);
  }

  async getBattleCompetitor(id: string): Promise<BattleCompetitor | null> {
    return (await this.battleRecords<BattleCompetitor>('competitors')).find((c) => c.id === id) ?? null;
  }

  async listBattleCompetitors(query: BattleSeasonScopedQuery): Promise<BattleCompetitor[]> {
    const all = await this.battleRecords<BattleCompetitor>('competitors');
    return all.filter((c) => c.seasonId === query.seasonId).slice(0, query.limit ?? 200);
  }

  async saveBattleDivision(division: BattleDivision): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'divisions'), division);
  }

  async getBattleDivision(id: string): Promise<BattleDivision | null> {
    return (await this.battleRecords<BattleDivision>('divisions')).find((d) => d.id === id) ?? null;
  }

  async listBattleDivisions(query: BattleSeasonScopedQuery): Promise<BattleDivision[]> {
    const all = await this.battleRecords<BattleDivision>('divisions');
    return all.filter((d) => d.seasonId === query.seasonId).slice(0, query.limit ?? 200);
  }

  async saveBattleMatchup(matchup: BattleMatchup): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'matchups'), matchup);
  }

  async getBattleMatchup(id: string): Promise<BattleMatchup | null> {
    return (await this.battleRecords<BattleMatchup>('matchups')).find((m) => m.id === id) ?? null;
  }

  async listBattleMatchups(query: BattleSeasonScopedQuery): Promise<BattleMatchup[]> {
    const all = await this.battleRecords<BattleMatchup>('matchups');
    return all.filter((m) => m.seasonId === query.seasonId).slice(0, query.limit ?? 500);
  }

  async saveBattleRound(round: BattleRound): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'rounds'), round);
  }

  async listBattleRounds(query: BattleSeasonScopedQuery): Promise<BattleRound[]> {
    const all = await this.battleRecords<BattleRound>('rounds');
    return all
      .filter((r) => r.seasonId === query.seasonId)
      .sort((a, b) => a.number - b.number)
      .slice(0, query.limit ?? 200);
  }

  async saveBattleScoringModel(model: BattleScoringModel): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'scoring-models'), model);
  }

  async getBattleScoringModel(id: string): Promise<BattleScoringModel | null> {
    return (await this.battleRecords<BattleScoringModel>('scoring-models')).find((m) => m.id === id) ?? null;
  }

  async saveBattleExperimentRegistration(registration: BattleExperimentRegistration): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'experiment-registrations'), registration);
  }

  async getBattleExperimentRegistration(id: string): Promise<BattleExperimentRegistration | null> {
    return (await this.battleRecords<BattleExperimentRegistration>('experiment-registrations')).find((r) => r.id === id) ?? null;
  }

  async listBattleExperimentRegistrations(query: BattleSeasonScopedQuery): Promise<BattleExperimentRegistration[]> {
    const all = await this.battleRecords<BattleExperimentRegistration>('experiment-registrations');
    return all.filter((r) => r.seasonId === query.seasonId).slice(0, query.limit ?? 500);
  }

  async saveBattlePrediction(prediction: BattlePrediction): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'predictions'), prediction);
  }

  async getBattlePrediction(id: string): Promise<BattlePrediction | null> {
    return (await this.battleRecords<BattlePrediction>('predictions')).find((p) => p.id === id) ?? null;
  }

  async listBattlePredictions(query: BattlePredictionQuery): Promise<BattlePrediction[]> {
    let all = await this.battleRecords<BattlePrediction>('predictions');
    all = all.filter((p) => p.seasonId === query.seasonId);
    if (query.result) all = all.filter((p) => p.result === query.result);
    all.sort((a, b) => (a.predictedAt < b.predictedAt ? -1 : 1));
    return all.slice(0, query.limit ?? 500);
  }

  async saveBattleMilestoneDefinition(definition: BattleMilestoneDefinition): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'milestone-definitions'), definition);
  }

  async listBattleMilestoneDefinitions(query: BattleSeasonScopedQuery): Promise<BattleMilestoneDefinition[]> {
    const all = await this.battleRecords<BattleMilestoneDefinition>('milestone-definitions');
    return all.filter((d) => d.seasonId === query.seasonId).slice(0, query.limit ?? 200);
  }

  async saveBattleMilestoneAchievement(achievement: BattleMilestoneAchievement): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'milestone-achievements'), achievement);
  }

  async listBattleMilestoneAchievements(query: BattleSeasonScopedQuery): Promise<BattleMilestoneAchievement[]> {
    const all = await this.battleRecords<BattleMilestoneAchievement>('milestone-achievements');
    return all
      .filter((a) => a.seasonId === query.seasonId)
      .sort((a, b) => (a.achievedAt < b.achievedAt ? -1 : 1))
      .slice(0, query.limit ?? 500);
  }

  async saveBattleCategoryResult(result: BattleCategoryResult): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'category-results'), result);
  }

  async listBattleCategoryResults(query: BattleSeasonScopedQuery): Promise<BattleCategoryResult[]> {
    const all = await this.battleRecords<BattleCategoryResult>('category-results');
    return all.filter((r) => r.seasonId === query.seasonId).slice(0, query.limit ?? 500);
  }

  async saveBattleOutcome(outcome: BattleOutcome): Promise<void> {
    await appendLine(battlePath(this.workspaceRoot, 'outcomes'), outcome);
  }

  async getBattleOutcome(id: string): Promise<BattleOutcome | null> {
    return (await this.battleRecords<BattleOutcome>('outcomes')).find((o) => o.id === id) ?? null;
  }

  async listBattleOutcomes(query: BattleSeasonScopedQuery): Promise<BattleOutcome[]> {
    const all = await this.battleRecords<BattleOutcome>('outcomes');
    return all.filter((o) => o.seasonId === query.seasonId).slice(0, query.limit ?? 500);
  }
}
