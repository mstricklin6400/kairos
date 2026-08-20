/**
 * The Social Genome Engine — Milestone 12.
 *
 * Builds and queries the conditional evidence map. Supplies structured
 * intelligence to consumers (notably Social Prescription); it does not
 * create prescriptions, and it reuses Intelligence Transfer rather than
 * inventing a second similarity engine.
 *
 * Depends only on the `IntelligenceStore` port. No LLM, no publishing.
 */
import { randomUUID } from 'node:crypto';
import type { IsoDateTime } from '../common/types.js';
import type { AnalysisLimitation, Finding } from '../science/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import type { SegmentFinding } from '../audience/types.js';
import type { TransferAssessment } from '../transfer/types.js';
import {
  assessFreshness,
  computeGenomeConfidence,
  countIndependentEvidence,
  deduplicateByLineage,
  deriveEvidenceLimitations,
} from './lineage.js';
import {
  DEFAULT_GENOME_POLICY,
  type ContextMatchQuality,
  type GenomeContext,
  type GenomeEdge,
  type GenomeEvidence,
  type GenomeMatch,
  type GenomeNode,
  type GenomeOutcome,
  type GenomePattern,
  type GenomePolicy,
  type GenomeQuery,
  type GenomeQueryResult,
  type GenomeScopeLevel,
  type GenomeSnapshot,
  type SocialGenome,
} from './types.js';

export interface GenomeEngineOptions {
  readonly policy?: Partial<GenomePolicy>;
  readonly now?: () => IsoDateTime;
}

/** Scope ordering, narrowest → broadest. Promotion only ever moves rightward, and only explicitly. */
const SCOPE_ORDER: readonly GenomeScopeLevel[] = [
  'profile',
  'segment',
  'cohort',
  'niche',
  'platform_niche',
  'platform',
  'cross_niche',
];

export class SocialGenomeEngine {
  private readonly policy: GenomePolicy;
  private readonly now: () => IsoDateTime;

  constructor(
    private readonly store: IntelligenceStore,
    options: GenomeEngineOptions = {},
  ) {
    this.policy = { ...DEFAULT_GENOME_POLICY, ...options.policy };
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getPolicy(): GenomePolicy {
    return this.policy;
  }

  // ---- Evidence construction -------------------------------------------

  /**
   * Wraps a `Finding` as genome evidence. Its lineage roots are the
   * experiments that produced it — so anything else derived from those same
   * experiments will collapse onto it rather than counting again.
   */
  evidenceFromFinding(finding: Finding): GenomeEvidence {
    return {
      id: `gev_${randomUUID()}`,
      sourceClass: 'first_party',
      recordType: 'finding',
      recordId: finding.id,
      lineageRoots: finding.sourceExperimentIds.length > 0 ? finding.sourceExperimentIds : [`finding:${finding.id}`],
      supports: finding.status === 'validated' || finding.status === 'promising',
      confidence: finding.confidence,
      sampleSize: finding.sampleSize,
      observedAt: finding.observationWindow?.to ?? finding.createdAt,
      lastValidatedAt: finding.lastValidatedAt,
      limitations: finding.limitations ?? [],
    };
  }

  /** Wraps a `SegmentFinding`, rooted in its supporting experiments. */
  evidenceFromSegmentFinding(segmentFinding: SegmentFinding): GenomeEvidence {
    return {
      id: `gev_${randomUUID()}`,
      sourceClass: 'first_party',
      recordType: 'segment_finding',
      recordId: segmentFinding.id,
      lineageRoots:
        segmentFinding.supportingExperimentIds.length > 0
          ? segmentFinding.supportingExperimentIds
          : [`segment_finding:${segmentFinding.id}`],
      supports: segmentFinding.status === 'supported',
      confidence: segmentFinding.confidence,
      observedAt: segmentFinding.createdAt,
      lastValidatedAt: segmentFinding.lastValidatedAt ?? segmentFinding.updatedAt,
      limitations: [],
    };
  }

  /**
   * Wraps a `TransferAssessment`.
   *
   * Critically, its lineage root is the ORIGINATING finding's experiments —
   * not the assessment id — so a transfer built from a finding already in
   * the Genome adds no new independent evidence. `sourceFindingExperimentIds`
   * lets the caller supply that lineage; without it the finding id itself is
   * the root, which still collapses with the finding's own evidence record.
   */
  evidenceFromTransfer(
    assessment: TransferAssessment,
    sourceFindingExperimentIds: readonly string[] = [],
  ): GenomeEvidence {
    return {
      id: `gev_${randomUUID()}`,
      sourceClass: assessment.sourceClass,
      recordType: 'transfer_assessment',
      recordId: assessment.id,
      lineageRoots:
        sourceFindingExperimentIds.length > 0 ? sourceFindingExperimentIds : [`finding:${assessment.findingId}`],
      supports: assessment.relevance !== 'contraindicated' && assessment.relevance !== 'irrelevant',
      confidence: assessment.assessmentConfidence,
      observedAt: assessment.createdAt,
      lastValidatedAt: assessment.createdAt,
      limitations: assessment.limitations,
      battleProvenance: assessment.battleProvenance,
    };
  }

  // ---- Pattern construction --------------------------------------------

  /**
   * Creates or updates a pattern.
   *
   * Confidence and consistency are computed over lineage-deduplicated
   * evidence, and the pattern is always created at the narrowest scope the
   * caller specifies — defaulting to `profile`. Widening requires
   * `promotePattern`.
   */
  async upsertPattern(input: {
    readonly id?: string;
    readonly statement: string;
    readonly context: GenomeContext;
    readonly outcome: GenomeOutcome;
    readonly scopeLevel?: GenomeScopeLevel;
    readonly profileId?: string;
    readonly supporting: readonly GenomeEvidence[];
    readonly contradicting?: readonly GenomeEvidence[];
    readonly platformEra?: string;
  }): Promise<GenomePattern> {
    const now = this.now();
    const contradicting = input.contradicting ?? [];

    // Deduplicate before anything is counted.
    const supporting = deduplicateByLineage(input.supporting);
    const contra = deduplicateByLineage(contradicting);

    for (const evidence of [...supporting, ...contra]) {
      await this.store.saveGenomeEvidence(evidence);
    }

    const allEvidence = [...supporting, ...contra];
    const timestamps = allEvidence
      .map((e) => e.observedAt)
      .filter((t): t is string => t !== undefined)
      .sort();
    const validations = allEvidence
      .map((e) => e.lastValidatedAt)
      .filter((t): t is string => t !== undefined)
      .sort();
    const lastValidatedAt = validations[validations.length - 1];

    const existing = input.id ? await this.store.getGenomePattern(input.id) : null;

    const pattern: GenomePattern = {
      id: existing?.id ?? input.id ?? `gpat_${randomUUID()}`,
      statement: input.statement,
      context: input.context,
      outcome: input.outcome,
      // Narrowest by default. Never inferred from how good the evidence looks.
      scopeLevel: input.scopeLevel ?? existing?.scopeLevel ?? 'profile',
      profileId: input.profileId ?? existing?.profileId,
      supportingEvidenceIds: supporting.map((e) => e.id),
      contradictingEvidenceIds: contra.map((e) => e.id),
      confidence: computeGenomeConfidence({
        supporting,
        contradicting: contra,
        lastValidatedAt,
        now,
        policy: this.policy,
      }),
      firstObservedAt: existing?.firstObservedAt ?? timestamps[0] ?? now,
      lastObservedAt: timestamps[timestamps.length - 1] ?? now,
      lastValidatedAt,
      platformEra: input.platformEra ?? existing?.platformEra,
      limitations: deriveEvidenceLimitations(allEvidence, this.policy),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      schemaVersion: 1,
    };

    await this.store.saveGenomePattern(pattern);
    return pattern;
  }

  /**
   * Widens a pattern's scope — explicitly, and only when the evidence
   * justifies it.
   *
   * Refuses when independent evidence is below policy, when moving to niche
   * scope or wider without enough distinct profiles, or when the evidence is
   * not consistent. **Nothing is ever promoted automatically**: a pattern
   * with beautiful profile-level evidence stays profile-scoped until someone
   * asks for the promotion and the evidence clears the bar.
   */
  async promotePattern(input: {
    readonly patternId: string;
    readonly targetScope: GenomeScopeLevel;
    /** Distinct profiles the evidence spans — the caller must establish this. */
    readonly distinctProfileCount: number;
  }): Promise<{ ok: true; pattern: GenomePattern } | { ok: false; reason: string }> {
    const pattern = await this.store.getGenomePattern(input.patternId);
    if (!pattern) return { ok: false, reason: `No pattern found with id "${input.patternId}".` };

    if (SCOPE_ORDER.indexOf(input.targetScope) <= SCOPE_ORDER.indexOf(pattern.scopeLevel)) {
      return { ok: false, reason: 'Target scope is not broader than the current scope.' };
    }

    if (pattern.confidence.independentEvidenceCount < this.policy.minimumIndependentEvidenceForPromotion) {
      return {
        ok: false,
        reason: `Promotion needs at least ${this.policy.minimumIndependentEvidenceForPromotion} independent pieces of evidence; this pattern has ${pattern.confidence.independentEvidenceCount}.`,
      };
    }

    if (pattern.confidence.consistency !== 'consistent') {
      return {
        ok: false,
        reason: `Evidence is ${pattern.confidence.consistency}; only consistent evidence may be generalized.`,
      };
    }

    const needsMultiProfile: readonly GenomeScopeLevel[] = ['niche', 'platform_niche', 'platform', 'cross_niche'];
    if (needsMultiProfile.includes(input.targetScope) && input.distinctProfileCount < this.policy.minimumProfilesForNicheScope) {
      return {
        ok: false,
        reason: `Scope "${input.targetScope}" needs evidence from at least ${this.policy.minimumProfilesForNicheScope} distinct profiles; only ${input.distinctProfileCount} supplied.`,
      };
    }

    const promoted: GenomePattern = { ...pattern, scopeLevel: input.targetScope, updatedAt: this.now() };
    await this.store.saveGenomePattern(promoted);
    return { ok: true, pattern: promoted };
  }

  // ---- Graph ------------------------------------------------------------

  /** Materializes the context dimensions of a pattern as graph nodes and edges. */
  async buildGraphForPattern(pattern: GenomePattern): Promise<{ nodes: GenomeNode[]; edges: GenomeEdge[] }> {
    const nodes: GenomeNode[] = [];
    const push = (kind: GenomeNode['kind'], value?: string): GenomeNode | undefined => {
      if (!value) return undefined;
      const node: GenomeNode = { id: `gnode_${kind}:${value}`, kind, value };
      nodes.push(node);
      return node;
    };

    push('platform', pattern.context.platform);
    push('niche', pattern.context.niche);
    push('audience_segment', pattern.context.audienceSegmentId);
    push('objective', pattern.context.objective);
    push('account_stage', pattern.context.accountStage);
    push('hook_family', pattern.context.hookFamily);
    push('content_format', pattern.context.contentFormat);
    push('cta', pattern.context.ctaType);
    push('topic', pattern.context.topic);
    const outcomeNode = push('outcome', `${pattern.outcome.metric}:${pattern.outcome.direction}`);

    const edges: GenomeEdge[] = [];
    if (outcomeNode) {
      for (const node of nodes) {
        if (node.id === outcomeNode.id) continue;
        edges.push({
          id: `gedge_${randomUUID()}`,
          fromNodeId: node.id,
          toNodeId: outcomeNode.id,
          relation: pattern.contradictingEvidenceIds.length > 0 ? 'contradicted_by' : 'associated_with',
          patternId: pattern.id,
          evidenceIds: [...pattern.supportingEvidenceIds, ...pattern.contradictingEvidenceIds],
        });
      }
    }

    for (const node of nodes) await this.store.saveGenomeNode(node);
    for (const edge of edges) await this.store.saveGenomeEdge(edge);
    return { nodes, edges };
  }

  // ---- Query ------------------------------------------------------------

  /** How closely a pattern's context matches the query's specified dimensions. */
  private matchContext(
    pattern: GenomePattern,
    query: GenomeQuery,
  ): { quality: ContextMatchQuality; matched: string[]; unspecified: string[] } {
    const checks: Array<[string, unknown, unknown]> = [
      ['platform', query.platform, pattern.context.platform],
      ['niche', query.niche, pattern.context.niche],
      ['subNiche', query.subNiche, pattern.context.subNiche],
      ['audienceSegmentId', query.audienceSegmentId, pattern.context.audienceSegmentId],
      ['objective', query.objective, pattern.context.objective],
      ['accountStage', query.accountStage, pattern.context.accountStage],
      ['hookFamily', query.hookFamily, pattern.context.hookFamily],
      ['contentFormat', query.contentFormat, pattern.context.contentFormat],
    ];

    const matched: string[] = [];
    const unspecified: string[] = [];
    let mismatched = 0;
    let asked = 0;

    for (const [name, wanted, actual] of checks) {
      if (wanted === undefined) continue;
      asked += 1;
      if (actual === undefined) {
        // The pattern doesn't record this dimension — unknown, not a match.
        unspecified.push(name);
      } else if (actual === wanted) {
        matched.push(name);
      } else {
        mismatched += 1;
      }
    }

    if (asked === 0) return { quality: 'broader', matched, unspecified };
    if (mismatched > 0) return { quality: 'partial', matched, unspecified };
    if (unspecified.length > 0 && matched.length === 0) return { quality: 'unknown', matched, unspecified };
    if (unspecified.length > 0) return { quality: 'broader', matched, unspecified };
    return { quality: 'exact', matched, unspecified };
  }

  /**
   * Queries the Genome.
   *
   * Returns matching patterns with their context-match quality, the evidence
   * behind them, what contradicts them, freshness, and limitations — plus an
   * honest `insufficientEvidence` flag when nothing addresses the question.
   */
  async query(query: GenomeQuery): Promise<GenomeQueryResult> {
    const now = this.now();
    const all = await this.store.listGenomePatterns({});
    const matches: GenomeMatch[] = [];

    for (const pattern of all) {
      if (query.scopeLevel && pattern.scopeLevel !== query.scopeLevel) continue;
      if (query.profileId && pattern.profileId !== query.profileId) continue;
      if (query.metric && pattern.outcome.metric !== query.metric) continue;
      if (query.consistentOnly && pattern.confidence.consistency !== 'consistent') continue;

      const { quality, matched, unspecified } = this.matchContext(pattern, query);
      // A pattern whose relevant dimensions actively conflict is not an answer.
      if (quality === 'partial' && matched.length === 0) continue;

      const supportingEvidence = await this.loadEvidence(pattern.supportingEvidenceIds);
      const contradictingEvidence = await this.loadEvidence(pattern.contradictingEvidenceIds);

      matches.push({
        pattern,
        contextMatch: quality,
        matchedDimensions: matched,
        unspecifiedDimensions: unspecified,
        supportingEvidence,
        contradictingEvidence,
        limitations: pattern.limitations,
        freshness: assessFreshness(pattern.lastValidatedAt, now, this.policy),
        // Evidence from a different profile/context needs a transfer
        // assessment before it is applied — the Genome does not re-implement
        // that judgment, it flags the need for it.
        requiresTransferAssessment:
          pattern.scopeLevel === 'profile' && query.profileId !== undefined && pattern.profileId !== query.profileId,
      });
    }

    matches.sort((a, b) => {
      const rank: Record<ContextMatchQuality, number> = { exact: 4, broader: 3, partial: 2, unknown: 1 };
      if (rank[a.contextMatch] !== rank[b.contextMatch]) return rank[b.contextMatch] - rank[a.contextMatch];
      return b.pattern.confidence.score - a.pattern.confidence.score;
    });

    const limited = matches.slice(0, query.limit ?? 50);
    const insufficientEvidence = limited.length === 0;
    const mixed = limited.filter((m) => m.pattern.confidence.consistency === 'mixed');

    return {
      query,
      matches: limited,
      insufficientEvidence,
      summary: insufficientEvidence
        ? 'No evidence in the Genome addresses this question.'
        : mixed.length > 0
          ? `${limited.length} pattern(s) found. Evidence is mixed on ${mixed.length} of them — see contradicting evidence.`
          : `${limited.length} pattern(s) found under the stated conditions.`,
      limitations: insufficientEvidence ? ['small_sample'] : [...new Set(limited.flatMap((m) => m.limitations))],
      evaluatedAt: now,
    };
  }

  private async loadEvidence(ids: readonly string[]): Promise<GenomeEvidence[]> {
    const loaded: GenomeEvidence[] = [];
    for (const id of ids) {
      const evidence = await this.store.getGenomeEvidence(id);
      if (evidence) loaded.push(evidence);
    }
    return loaded;
  }

  /** Patterns whose evidence disagrees — "where is evidence contradictory?" */
  async findContradictions(): Promise<GenomePattern[]> {
    const all = await this.store.listGenomePatterns({});
    return all.filter((p) => p.confidence.consistency === 'mixed' || p.confidence.consistency === 'contradicted');
  }

  /** Patterns whose evidence has gone stale and should be re-tested. */
  async findStalePatterns(): Promise<GenomePattern[]> {
    const now = this.now();
    const all = await this.store.listGenomePatterns({});
    return all.filter((p) => assessFreshness(p.lastValidatedAt, now, this.policy) === 'stale');
  }

  // ---- Snapshots and versioning ----------------------------------------

  /**
   * Captures what the intelligence base believes right now.
   *
   * Answers "what did Kairos believe as of version X" — snapshots are never
   * rewritten, so a historical answer stays historical.
   */
  async takeSnapshot(note?: string): Promise<GenomeSnapshot> {
    const patterns = await this.store.listGenomePatterns({});
    const previous = await this.store.listGenomeSnapshots();
    const version = previous.reduce((max, s) => Math.max(max, s.version), 0) + 1;

    const patternConfidence: Record<string, number> = {};
    for (const pattern of patterns) patternConfidence[pattern.id] = pattern.confidence.score;

    const snapshot: GenomeSnapshot = {
      id: `gsnap_${randomUUID()}`,
      version,
      takenAt: this.now(),
      patternIds: patterns.map((p) => p.id),
      patternConfidence,
      patternCount: patterns.length,
      note,
      policyVersion: this.policy.policyVersion,
      schemaVersion: 1,
    };
    await this.store.saveGenomeSnapshot(snapshot);
    return snapshot;
  }

  /** Summary of the Genome as it currently stands. */
  async describe(): Promise<SocialGenome> {
    const patterns = await this.store.listGenomePatterns({});
    const nodes = await this.store.listGenomeNodes();
    const edges = await this.store.listGenomeEdges();
    const snapshots = await this.store.listGenomeSnapshots();
    return {
      version: snapshots.reduce((max, s) => Math.max(max, s.version), 0),
      patternCount: patterns.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      lastUpdatedAt: patterns.reduce<string>((latest, p) => (p.updatedAt > latest ? p.updatedAt : latest), ''),
      policyVersion: this.policy.policyVersion,
    };
  }

  /**
   * Total independent evidence behind a pattern — the double-counting-safe
   * answer to "how much do we actually have?"
   */
  async countPatternEvidence(patternId: string): Promise<number> {
    const pattern = await this.store.getGenomePattern(patternId);
    if (!pattern) return 0;
    const evidence = await this.loadEvidence([
      ...pattern.supportingEvidenceIds,
      ...pattern.contradictingEvidenceIds,
    ]);
    return countIndependentEvidence(evidence);
  }

  /** Limitations across a set of patterns, for a consumer assembling a view. */
  summarizeLimitations(patterns: readonly GenomePattern[]): AnalysisLimitation[] {
    return [...new Set(patterns.flatMap((p) => p.limitations))];
  }
}
