/**
 * Deterministic, manual ingestion for Milestone 5 — collect, validate,
 * normalize, persist through `IntelligenceStore`. No AI parsing, no web
 * fetcher, no PDF/transcript parser: a caller already has structured data
 * (a human, a script, or a later deterministic adapter) and hands it here.
 *
 * `ingestCreatorOsSkill` is a thin, explicit convenience over
 * `ingestResearchSource` for the `creatoros_skill` source type — it does not
 * read from or alter CreatorOS's own skill-delivery system in any way; the
 * caller supplies the skill's own metadata (name, description) as plain
 * strings, exactly like any other source.
 */
import { randomUUID } from 'node:crypto';
import type { IsoDateTime } from '../common/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import type { ResearchSource, StrategyClaim } from './types.js';
import { deriveDefaultCausalStatus } from './aggregate.js';
import { validateResearchSourceInput, validateStrategyClaimInput } from './validate.js';
import { normalizeUrl } from '../onboarding/validate.js';
import type { ResearchSourceInput, StrategyClaimInput, ValidationError } from './ingestTypes.js';

export type IngestResearchSourceResult =
  | { readonly ok: true; readonly source: ResearchSource }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

export type IngestStrategyClaimResult =
  | { readonly ok: true; readonly claim: StrategyClaim }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

function buildResearchSource(input: ResearchSourceInput, existing: ResearchSource | null, now: IsoDateTime): ResearchSource {
  const normalizedUrl = input.url?.trim() ? normalizeUrl(input.url) : undefined;
  return {
    id: existing?.id ?? input.id ?? `src_${randomUUID()}`,
    sourceType: input.sourceType,
    title: input.title.trim(),
    authorOrPublisher: input.authorOrPublisher?.trim(),
    url: normalizedUrl && normalizedUrl.ok ? normalizedUrl.url : undefined,
    publishedAt: input.publishedAt,
    accessedAt: input.accessedAt,
    description: input.description?.trim(),
    platformsDiscussed: input.platformsDiscussed,
    nichesDiscussed: input.nichesDiscussed,
    sourceVersion: input.sourceVersion,
    credibilityNotes: input.credibilityNotes,
    lastReviewedAt: input.lastReviewedAt,
    supersededBySourceId: input.supersededBySourceId,
    deprecatedAt: input.deprecatedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    schemaVersion: 1,
  };
}

/** Validates, normalizes and upserts a `ResearchSource`. `input.id` (or an existing source's id) makes this an update; otherwise a new source is created. */
export async function ingestResearchSource(
  input: ResearchSourceInput,
  store: IntelligenceStore,
  now: IsoDateTime = new Date().toISOString(),
): Promise<IngestResearchSourceResult> {
  const validation = validateResearchSourceInput(input);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const existing = input.id ? await store.getResearchSource(input.id) : null;
  const source = buildResearchSource(input, existing, now);
  await store.saveResearchSource(source);
  return { ok: true, source };
}

function buildStrategyClaim(input: StrategyClaimInput, existing: StrategyClaim | null, now: IsoDateTime): StrategyClaim {
  return {
    id: existing?.id ?? input.id ?? `clm_${randomUUID()}`,
    sourceId: input.sourceId,
    statement: input.statement.trim(),
    claimType: input.claimType,
    scope: input.scope,
    platforms: input.platforms,
    niches: input.niches,
    objectives: input.objectives,
    accountStages: input.accountStages,
    audienceContext: input.audienceContext,
    contentContext: input.contentContext,
    assertedEffect: input.assertedEffect,
    observedAssociation: input.observedAssociation,
    causalStatus: input.causalStatus ?? deriveDefaultCausalStatus(input.claimType),
    status: input.status ?? 'captured',
    confidenceInExtraction: input.confidenceInExtraction,
    excerpt: input.excerpt,
    locator: input.locator,
    topicKey: input.topicKey,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    schemaVersion: 1,
  };
}

/**
 * Validates, normalizes and upserts a `StrategyClaim`. Requires the claim's
 * `sourceId` to resolve to an existing `ResearchSource` — no orphan claims.
 * Never writes to the Findings store: outside knowledge does not become a
 * validated Kairos `Finding` here or anywhere else.
 */
export async function ingestStrategyClaim(
  input: StrategyClaimInput,
  store: IntelligenceStore,
  now: IsoDateTime = new Date().toISOString(),
): Promise<IngestStrategyClaimResult> {
  const validation = validateStrategyClaimInput(input);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const source = await store.getResearchSource(input.sourceId);
  if (!source) {
    return { ok: false, errors: [{ field: 'sourceId', message: `No ResearchSource found with id "${input.sourceId}" — claims cannot be orphaned.` }] };
  }

  const existing = input.id ? await store.getStrategyClaim(input.id) : null;
  const claim = buildStrategyClaim(input, existing, now);
  await store.saveStrategyClaim(claim);
  return { ok: true, claim };
}

/**
 * Convenience wrapper: represents one CreatorOS marketing skill as a
 * `ResearchSource` with `sourceType: 'creatoros_skill'`. Takes only plain
 * metadata strings — it never reads CreatorOS's skill files, installation
 * state, or delivery mechanism, and never modifies them. Kairos consumes
 * skills as a research input; it does not replace CreatorOS's own
 * skill-delivery system.
 */
export async function ingestCreatorOsSkill(
  skill: { readonly name: string; readonly description?: string; readonly skillVersion?: string },
  store: IntelligenceStore,
  now: IsoDateTime = new Date().toISOString(),
): Promise<IngestResearchSourceResult> {
  return ingestResearchSource(
    {
      sourceType: 'creatoros_skill',
      title: skill.name,
      description: skill.description,
      sourceVersion: skill.skillVersion,
    },
    store,
    now,
  );
}
