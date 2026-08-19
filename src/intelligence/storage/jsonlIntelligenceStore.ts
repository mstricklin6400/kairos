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
  BaselineQuery,
  ExperimentQuery,
  FindingQuery,
  HypothesisQuery,
  IntelligenceStore,
  ProfileQuery,
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
}
