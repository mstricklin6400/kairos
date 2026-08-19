/**
 * Deterministic validation and normalization for profile onboarding.
 * Pure functions only — no I/O, no AI, no strategy generation. See the
 * module doc in `types.ts` for what onboarding is and is not responsible for.
 */
import { normalizePlatform, platformLabel } from '../../client/platformMatrix.js';
import type { GrowthObjective } from '../common/types.js';
import type { ExperimentMode } from '../profiles/types.js';
import type { ProfileOnboardingInput, ValidationError, ValidationResult } from './types.js';

// Kept in sync by hand with the corresponding domain unions — these are pure
// type-level unions with no runtime representation to import.
const GROWTH_OBJECTIVES: readonly GrowthObjective[] = [
  'reach',
  'conversation',
  'amplification',
  'followers',
  'traffic',
  'lead',
  'sale',
  'revenue',
  'retention',
];

const EXPERIMENT_MODES: readonly ExperimentMode[] = ['conservative', 'balanced', 'discovery'];

const MAX_POSTS_PER_DAY = 50;
const MAX_POSTS_PER_WEEK = 200;

/**
 * A platform is "known" iff the shared CreatorOS platform matrix has a
 * distinct display label for it — every entry in that matrix's label table
 * differs from its own key, so an unrecognized string falls back to being
 * returned unchanged by `platformLabel`. Reuses the existing matrix rather
 * than duplicating its platform list. Exported so other intelligence-layer
 * validators (e.g. `../research/validate.ts`) can reuse the same check.
 */
export function isKnownPlatform(raw: string): boolean {
  const normalized = normalizePlatform(raw);
  return platformLabel(normalized) !== normalized;
}

/** `new URL()` after trying the same bare-domain-gets-https fix the existing brand-pack onboarding uses, so a plain `example.com` isn't rejected as malformed. */
export function normalizeUrl(raw: string): { ok: true; url: string } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return { ok: true, url: new URL(candidate).toString() };
  } catch {
    return { ok: false };
  }
}

export function validateOnboardingInput(input: ProfileOnboardingInput): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (field: string, message: string): void => {
    errors.push({ field, message });
  };

  if (!input.creatorOsAccountId?.trim()) {
    fail('creatorOsAccountId', 'A CreatorOS account id is required — Kairos never creates a competing account identity.');
  }

  if (!input.platform || !isKnownPlatform(input.platform)) {
    fail('platform', `"${String(input.platform)}" is not a platform CreatorOS can execute against.`);
  }

  if (!input.brandName?.trim()) {
    fail('brandName', 'A brand name is required.');
  }

  if (!input.niche?.trim()) {
    fail('niche', 'A primary niche is required.');
  }

  if (!input.declaredAudience?.trim()) {
    fail('declaredAudience', 'A description of who you believe your audience is required.');
  }

  if (!input.primaryObjective) {
    fail('primaryObjective', 'A primary objective is required.');
  } else if (!GROWTH_OBJECTIVES.includes(input.primaryObjective)) {
    fail('primaryObjective', `"${input.primaryObjective}" is not a recognized objective.`);
  }

  for (const [index, objective] of (input.secondaryObjectives ?? []).entries()) {
    if (!GROWTH_OBJECTIVES.includes(objective)) {
      fail(`secondaryObjectives[${index}]`, `"${objective}" is not a recognized objective.`);
    }
  }

  if (input.primaryConversionGoal && !GROWTH_OBJECTIVES.includes(input.primaryConversionGoal)) {
    fail('primaryConversionGoal', `"${input.primaryConversionGoal}" is not a recognized objective.`);
  }

  if (input.postsPerDay !== undefined) {
    if (!Number.isFinite(input.postsPerDay) || input.postsPerDay <= 0 || input.postsPerDay > MAX_POSTS_PER_DAY) {
      fail('postsPerDay', `Posting capacity must be a positive number, realistically up to ${MAX_POSTS_PER_DAY}/day.`);
    }
  }

  if (input.postsPerWeek !== undefined) {
    if (!Number.isFinite(input.postsPerWeek) || input.postsPerWeek <= 0 || input.postsPerWeek > MAX_POSTS_PER_WEEK) {
      fail('postsPerWeek', `Posting capacity must be a positive number, realistically up to ${MAX_POSTS_PER_WEEK}/week.`);
    }
  }

  if (!input.experimentMode) {
    fail('experimentMode', 'An experiment mode is required.');
  } else if (!EXPERIMENT_MODES.includes(input.experimentMode)) {
    fail('experimentMode', `"${input.experimentMode}" is not a recognized experiment mode — use one of ${EXPERIMENT_MODES.join(', ')}.`);
  }

  for (const [index, offer] of (input.offers ?? []).entries()) {
    if (!offer.name?.trim()) {
      fail(`offers[${index}].name`, 'An offer needs a name.');
    }
    if (!offer.description?.trim()) {
      fail(`offers[${index}].description`, 'An offer needs a description.');
    }
    if (offer.price !== undefined && offer.price < 0) {
      fail(`offers[${index}].price`, 'Offer price cannot be negative.');
    }
    if (offer.url !== undefined && offer.url.trim() && !normalizeUrl(offer.url).ok) {
      fail(`offers[${index}].url`, `"${offer.url}" is not a usable URL.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
