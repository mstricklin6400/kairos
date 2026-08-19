/**
 * Deterministic validation and normalization for Milestone 5 ingestion.
 * Pure functions only — no I/O, no AI. Mirrors the discipline in
 * `../onboarding/validate.ts`: collect, validate, normalize; nothing here
 * interprets or scores a claim's truth.
 */
import { normalizeUrl, isKnownPlatform } from '../onboarding/validate.js';
import type { ClaimType, ResearchSourceType } from './types.js';
import type { ResearchSourceInput, StrategyClaimInput, ValidationError, ValidationResult } from './ingestTypes.js';

const RESEARCH_SOURCE_TYPES: readonly ResearchSourceType[] = [
  'creator',
  'marketer',
  'agency',
  'course',
  'book',
  'video',
  'community',
  'research_report',
  'observational_dataset',
  'platform_documentation',
  'creatoros_skill',
  'internal_note',
  'kairos_experiment',
  'other',
];

const CLAIM_TYPES: readonly ClaimType[] = [
  'playbook_claim',
  'platform_claim',
  'research_claim',
  'observed_association',
  'experimental_claim',
  'opinion',
  'heuristic',
];

/** A short attribution excerpt only — this is not where a book or course gets stored. */
const MAX_EXCERPT_LENGTH = 500;

function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function validateResearchSourceInput(input: ResearchSourceInput): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (field: string, message: string): void => {
    errors.push({ field, message });
  };

  if (!input.sourceType || !RESEARCH_SOURCE_TYPES.includes(input.sourceType)) {
    fail('sourceType', `"${String(input.sourceType)}" is not a recognized research source type.`);
  }

  if (!input.title?.trim()) {
    fail('title', 'A title is required.');
  }

  if (input.url !== undefined && input.url.trim() && !normalizeUrl(input.url).ok) {
    fail('url', `"${input.url}" is not a usable URL.`);
  }

  if (input.publishedAt !== undefined && !isValidIsoDate(input.publishedAt)) {
    fail('publishedAt', `"${input.publishedAt}" is not a valid date.`);
  }
  if (input.accessedAt !== undefined && !isValidIsoDate(input.accessedAt)) {
    fail('accessedAt', `"${input.accessedAt}" is not a valid date.`);
  }
  if (input.lastReviewedAt !== undefined && !isValidIsoDate(input.lastReviewedAt)) {
    fail('lastReviewedAt', `"${input.lastReviewedAt}" is not a valid date.`);
  }
  if (input.deprecatedAt !== undefined && !isValidIsoDate(input.deprecatedAt)) {
    fail('deprecatedAt', `"${input.deprecatedAt}" is not a valid date.`);
  }

  for (const [index, platform] of (input.platformsDiscussed ?? []).entries()) {
    if (!isKnownPlatform(platform)) {
      fail(`platformsDiscussed[${index}]`, `"${platform}" is not a platform CreatorOS can execute against.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateStrategyClaimInput(input: StrategyClaimInput): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (field: string, message: string): void => {
    errors.push({ field, message });
  };

  if (!input.sourceId?.trim()) {
    fail('sourceId', 'A claim must reference a sourceId — no orphan claims.');
  }

  if (!input.statement?.trim()) {
    fail('statement', 'A claim needs a statement.');
  }

  if (!input.claimType || !CLAIM_TYPES.includes(input.claimType)) {
    fail('claimType', `"${String(input.claimType)}" is not a recognized claim type.`);
  }

  if (!input.scope) {
    fail('scope', 'A claim needs an explicit scope — global scope must be stated, never assumed.');
  }

  for (const [index, platform] of (input.platforms ?? []).entries()) {
    if (!isKnownPlatform(platform)) {
      fail(`platforms[${index}]`, `"${platform}" is not a platform CreatorOS can execute against.`);
    }
  }

  if (input.confidenceInExtraction !== undefined) {
    if (
      !Number.isFinite(input.confidenceInExtraction) ||
      input.confidenceInExtraction < 0 ||
      input.confidenceInExtraction > 1
    ) {
      fail('confidenceInExtraction', 'confidenceInExtraction must be a number between 0 and 1.');
    }
  }

  if (input.claimType === 'observed_association' && !input.observedAssociation) {
    fail('observedAssociation', 'An observed_association claim needs its observedAssociation evidence.');
  }
  if (input.observedAssociation) {
    if (!input.observedAssociation.variablesObserved?.length) {
      fail('observedAssociation.variablesObserved', 'At least one observed variable is required.');
    }
    if (!input.observedAssociation.populationDescription?.trim()) {
      fail('observedAssociation.populationDescription', 'A population description is required.');
    }
    if (input.observedAssociation.sampleSize !== undefined && input.observedAssociation.sampleSize <= 0) {
      fail('observedAssociation.sampleSize', 'sampleSize must be positive.');
    }
  }

  // The guardrail against inflated causal status: claiming causal_supported
  // requires the claim to actually be built from experimental evidence.
  if (input.causalStatus === 'causal_supported' && input.claimType !== 'experimental_claim') {
    fail(
      'causalStatus',
      'causal_supported may only be asserted on an experimental_claim — outside advice cannot claim proven causation.',
    );
  }

  if (input.excerpt !== undefined && input.excerpt.length > MAX_EXCERPT_LENGTH) {
    fail('excerpt', `An excerpt must stay under ${MAX_EXCERPT_LENGTH} characters — attribution, not content storage.`);
  }

  return { valid: errors.length === 0, errors };
}
