/**
 * The Social Genome Engine.
 *
 * Builds, evaluates, queries and explains cross-profile conditional
 * knowledge. It does NOT generate content, schedule posts, create
 * prescriptions, execute CreatorOS actions, or decide whether knowledge
 * applies to a particular profile — that last one is the Transfer Engine's
 * job (Milestone 10) and is deliberately not duplicated here.
 *
 * Deterministic throughout: no LLM, no embeddings, no vector search, no
 * semantic matching. Two records only merge into one pattern when their
 * normalized context signatures are identical.
 *
 * Depends only on the `IntelligenceStore` port.
 */
import { randomUUID } from 'node:crypto';
import type { GrowthObjective, IsoDateTime } from '../common/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import {
  assessGenomeFreshness,
  computeOperationalConfidence,
  deriveCaveats,
  deriveGenomeLimitations,
  determineStatus,
  provenanceTypes,
  summarizeEvidence,
} from './aggregate.js';
import {
  contextCovers,
  contextSignature,
  mergeContexts,
  normalizeContext,
  unknownDimensions,
  type GenomeContext,
} from './context.js';
import {
  DEFAULT_GENOME_POLICY,
  type GenomeEvidenceReference,
  type GenomePattern,
  type GenomePatternExplanation,
  type GenomePatternStatus,
  type GenomePolicy,
  type GenomeQuery,
  type GenomeQueryMatch,
  type GenomeQueryResult,
  type PublicGenomePattern,
} from './types.js';

export interface GenomeEngineOptions {
  readonly policy?: Partial<GenomePolicy>;
  readonly now?: () => IsoDateTime;
}

/**
 * Strips a pattern to its public face.
 *
 * The privacy seam. `PublicGenomePattern` is a separate type rather than a
 * filtered view, so a future field carrying customer data cannot leak by
 * omission — it would have to be added here explicitly. Evidence arrays,
 * record ids, profile ids and experiment ids never cross this boundary.
 */
export function toPublicPattern(pattern: GenomePattern): PublicGenomePattern {
  return {
    id: pattern.id,
    statement: pattern.statement,
    status: pattern.status,
    context: pattern.context,
    contextSignature: pattern.contextSignature,
    objective: pattern.objective,
    confidence: pattern.confidence,
    evidenceSummary: pattern.evidenceSummary,
    sourceProfileCount: pattern.sourceProfileCount,
    sourceExperimentCount: pattern.sourceExperimentCount,
    firstObservedAt: pattern.firstObservedAt,
    lastObservedAt: pattern.lastObservedAt,
    lastEvaluatedAt: pattern.lastEvaluatedAt,
    freshness: pattern.freshness,
    limitations: pattern.limitations,
    caveats: pattern.caveats,
    statusRationale: pattern.statusRationale,
    version: pattern.version,
  };
}

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

  /**
   * Creates or updates a pattern from evidence.
   *
   * Two records are only ever combined into one pattern when their
   * normalized context signatures match exactly and the objective agrees.
   * There is no fuzzy merging — §11's rule is that under-generalization
   * beats false generalization.
   *
   * The version increments and `supersedesPatternId` chains to the prior
   * record whenever the status or confidence materially changes, so the
   * reasoning behind an earlier belief survives it being replaced.
   */
  async upsertPattern(input: {
    readonly id?: string;
    readonly statement: string;
    readonly context: GenomeContext;
    readonly objective?: GrowthObjective;
    readonly supportingEvidence: readonly GenomeEvidenceReference[];
    readonly contradictingEvidence?: readonly GenomeEvidenceReference[];
    readonly caveats?: readonly string[];
  }): Promise<GenomePattern> {
    const now = this.now();
    const context = normalizeContext(input.context);
    const signature = contextSignature(context);
    const supporting = input.supportingEvidence;
    const contradicting = input.contradictingEvidence ?? [];

    const existing = input.id ? await this.store.getGenomePattern(input.id) : null;

    const summary = summarizeEvidence(supporting, contradicting);
    const observedTimes = [...supporting, ...contradicting]
      .map((e) => e.observedAt ?? e.recordedAt)
      .filter((t): t is string => t !== undefined)
      .sort();
    const firstObservedAt = existing?.firstObservedAt ?? observedTimes[0] ?? now;
    const lastObservedAt = observedTimes[observedTimes.length - 1] ?? now;

    const freshness = assessGenomeFreshness(lastObservedAt, now, this.policy);
    const confidence = computeOperationalConfidence({ summary, freshness, policy: this.policy });
    const { status, rationale } = determineStatus({
      summary,
      freshness,
      policy: this.policy,
      currentStatus: existing?.status,
    });

    // A material change is a status change or a confidence move of 0.05+.
    const materiallyChanged =
      existing !== null && (existing.status !== status || Math.abs(existing.confidence - confidence) >= 0.05);

    const derivedCaveats = deriveCaveats({
      summary,
      platforms: context.platforms as readonly string[] | undefined,
      niches: context.niches as readonly string[] | undefined,
      objectives: input.objective ? [input.objective] : (context.objectives as readonly string[] | undefined),
      audienceDescriptors: context.audienceDescriptors,
      offerTypes: context.offerTypes,
    });

    const pattern: GenomePattern = {
      id: existing?.id ?? input.id ?? `gpat_${randomUUID()}`,
      statement: input.statement,
      status,
      context,
      contextSignature: signature,
      objective: input.objective ?? existing?.objective,
      confidence,
      evidenceSummary: summary,
      supportingEvidence: supporting,
      contradictingEvidence: contradicting,
      sourceProfileCount: summary.distinctProfileCount,
      sourceExperimentCount: summary.distinctExperimentCount,
      firstObservedAt,
      lastObservedAt,
      lastEvaluatedAt: now,
      freshness,
      limitations: deriveGenomeLimitations(supporting, contradicting, summary, this.policy),
      caveats: [...new Set([...(input.caveats ?? []), ...derivedCaveats])],
      statusRationale: rationale,
      version: existing ? existing.version + (materiallyChanged ? 1 : 0) : 1,
      supersedesPatternId: materiallyChanged ? existing?.id : existing?.supersedesPatternId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      schemaVersion: 2,
    };

    // Snapshot the prior version before overwriting, so history stays
    // inspectable without full event sourcing.
    if (existing && materiallyChanged) {
      await this.store.saveGenomePatternHistory({
        ...existing,
        id: `${existing.id}@v${existing.version}`,
      });
    }

    await this.store.saveGenomePattern(pattern);
    return pattern;
  }

  /** Re-evaluates a pattern against current policy and freshness, without new evidence. */
  async evaluatePattern(patternId: string): Promise<GenomePattern | null> {
    const pattern = await this.store.getGenomePattern(patternId);
    if (!pattern) return null;
    return this.upsertPattern({
      id: pattern.id,
      statement: pattern.statement,
      context: pattern.context,
      objective: pattern.objective,
      supportingEvidence: pattern.supportingEvidence,
      contradictingEvidence: pattern.contradictingEvidence,
      caveats: pattern.caveats,
    });
  }

  /**
   * Explicitly retires a pattern. The record is retained and remains
   * readable — deprecation is a judgment, not a deletion.
   */
  async deprecatePattern(patternId: string, reason: string): Promise<GenomePattern | null> {
    const pattern = await this.store.getGenomePattern(patternId);
    if (!pattern) return null;
    const deprecated: GenomePattern = {
      ...pattern,
      status: 'deprecated',
      statusRationale: `Explicitly deprecated: ${reason}`,
      version: pattern.version + 1,
      supersedesPatternId: pattern.id,
      lastEvaluatedAt: this.now(),
      updatedAt: this.now(),
    };
    await this.store.saveGenomePatternHistory({ ...pattern, id: `${pattern.id}@v${pattern.version}` });
    await this.store.saveGenomePattern(deprecated);
    return deprecated;
  }

  /** Every retained prior version of a pattern, oldest first. */
  async getPatternHistory(patternId: string): Promise<GenomePattern[]> {
    const history = await this.store.listGenomePatternHistory(patternId);
    return [...history].sort((a, b) => a.version - b.version);
  }

  /**
   * Queries for CANDIDATE knowledge.
   *
   * Results are public-safe and every match carries
   * `requiresTransferAssessment: true` — the Genome answers "what has been
   * learned", never "what applies here".
   */
  async query(query: GenomeQuery): Promise<GenomeQueryResult> {
    const now = this.now();
    const all = await this.store.listGenomePatterns({});

    const required: GenomeContext = {
      ...(query.platform ? { platforms: [query.platform as never] } : {}),
      ...(query.niche ? { niches: [query.niche] } : {}),
      ...(query.objective ? { objectives: [query.objective] } : {}),
      ...(query.hookFamily ? { hookFamilies: [query.hookFamily] } : {}),
      ...(query.contentFormat ? { contentFormats: [query.contentFormat as never] } : {}),
      ...(query.audienceDescriptor ? { audienceDescriptors: [query.audienceDescriptor] } : {}),
      ...(query.offerType ? { offerTypes: [query.offerType] } : {}),
      ...(query.funnelStage ? { funnelStages: [query.funnelStage] } : {}),
    };

    const matches: GenomeQueryMatch[] = [];
    for (const pattern of all) {
      if (query.status && pattern.status !== query.status) continue;
      if (query.freshness && pattern.freshness !== query.freshness) continue;
      if (query.minimumConfidence !== undefined && pattern.confidence < query.minimumConfidence) continue;
      if (query.observedSince && pattern.lastObservedAt < query.observedSince) continue;
      // Objective is checked explicitly as well as via context: a reach
      // pattern must never answer a revenue question.
      if (query.objective && pattern.objective && pattern.objective !== query.objective) continue;

      const { matched, unmatched, unspecified } = contextCovers(pattern.context, required);
      // A pattern that actively conflicts on a queried dimension is not an answer.
      if (unmatched.length > 0) continue;
      // With filters supplied, require at least one positive dimension match.
      const askedForContext = Object.keys(required).length > 0;
      if (askedForContext && matched.length === 0) continue;

      matches.push({
        pattern: toPublicPattern(pattern),
        matchedDimensions: matched,
        unmatchedDimensions: unmatched,
        unspecifiedDimensions: unspecified,
        requiresTransferAssessment: true,
      });
    }

    matches.sort((a, b) =>
      b.matchedDimensions.length !== a.matchedDimensions.length
        ? b.matchedDimensions.length - a.matchedDimensions.length
        : b.pattern.confidence - a.pattern.confidence,
    );

    const limited = matches.slice(0, query.limit ?? 50);
    return {
      query,
      matches: limited,
      insufficientEvidence: limited.length === 0,
      summary:
        limited.length === 0
          ? 'No Genome knowledge addresses these conditions. This is an open question, not a negative result.'
          : `${limited.length} candidate pattern(s) learned under related conditions. Applicability to any specific profile requires a transfer assessment.`,
      evaluatedAt: now,
    };
  }

  /**
   * The full "why does the system believe this?" answer.
   *
   * Evidence appears as counts, types and summaries — never as raw records,
   * so an explanation is safe to surface without exposing another
   * customer's data.
   */
  async explainGenomePattern(patternId: string): Promise<GenomePatternExplanation | null> {
    const pattern = await this.store.getGenomePattern(patternId);
    if (!pattern) return null;

    return {
      patternId: pattern.id,
      statement: pattern.statement,
      status: pattern.status,
      statusRationale: pattern.statusRationale,
      operationalConfidence: pattern.confidence,
      confidenceCaveat:
        'Operational confidence is a documented weighted heuristic over replication, consistency, volume and recency. It is NOT a statistical probability.',
      knownContext: pattern.context,
      unknownContextDimensions: unknownDimensions(pattern.context),
      supportingEvidenceSummary: `${pattern.evidenceSummary.supportingCount} independent supporting piece(s) across ${pattern.sourceProfileCount} profile(s) and ${pattern.sourceExperimentCount} experiment(s).`,
      contradictingEvidenceSummary:
        pattern.evidenceSummary.contradictingCount === 0
          ? 'No contradicting evidence recorded.'
          : `${pattern.evidenceSummary.contradictingCount} independent contradicting piece(s) (${(pattern.evidenceSummary.contradictionRatio * 100).toFixed(0)}% of all evidence).`,
      distinctProfileCount: pattern.sourceProfileCount,
      distinctExperimentCount: pattern.sourceExperimentCount,
      freshness: pattern.freshness,
      firstObservedAt: pattern.firstObservedAt,
      lastObservedAt: pattern.lastObservedAt,
      limitations: pattern.limitations,
      caveats: pattern.caveats,
      provenance: provenanceTypes(pattern.supportingEvidence, pattern.contradictingEvidence),
      whatShouldNotBeGeneralized: pattern.caveats,
    };
  }

  /** Patterns whose evidence disagrees with itself. Negative knowledge is knowledge. */
  async findContested(): Promise<PublicGenomePattern[]> {
    const all = await this.store.listGenomePatterns({});
    return all.filter((p) => p.status === 'contested').map(toPublicPattern);
  }

  /** Patterns due for revalidation or already decaying. Nothing is deleted. */
  async findStale(): Promise<PublicGenomePattern[]> {
    const all = await this.store.listGenomePatterns({});
    return all
      .filter((p) => p.freshness === 'decaying' || p.freshness === 'due_for_revalidation')
      .map(toPublicPattern);
  }

  /**
   * Merges the contexts of two patterns the caller has established describe
   * the same knowledge — the mechanism by which cross-platform or
   * cross-niche replication gets recorded. Never decides on its own that
   * two patterns belong together.
   */
  mergePatternContexts(a: GenomePattern, b: GenomePattern): GenomeContext {
    return mergeContexts(a.context, b.context);
  }

  /** Status counts across the Genome, for a future internal dashboard. */
  async summarize(): Promise<Record<GenomePatternStatus, number>> {
    const all = await this.store.listGenomePatterns({});
    const counts: Record<GenomePatternStatus, number> = {
      emerging: 0, promising: 0, supported: 0, contested: 0, decaying: 0, deprecated: 0,
    };
    for (const pattern of all) counts[pattern.status] += 1;
    return counts;
  }
}
