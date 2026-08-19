/**
 * Deterministic validation for Milestone 6 ingestion. Unlike the pure
 * validators in `../onboarding/validate.ts` and `../research/validate.ts`,
 * these are async: profile existence, `creatorOsAccountId` consistency and
 * experiment/profile consistency (Step 22) require checking the store, not
 * just the shape of the input. Still no AI, no network calls beyond the
 * store itself.
 */
import { isKnownPlatform } from '../onboarding/validate.js';
import type { IntelligenceStore } from '../storage/store.js';
import type { AttributionEventInput, MeasurementSnapshotInput, ProfileMeasurementSnapshotInput, ValidationError, ValidationResult } from './ingestTypes.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

async function validateProfileConsistency(
  errors: ValidationError[],
  store: IntelligenceStore,
  profileId: string,
  creatorOsAccountId: string,
): Promise<void> {
  if (!profileId?.trim()) {
    errors.push({ field: 'profileId', message: 'A profileId is required.' });
    return;
  }
  const profile = await store.getProfile(profileId);
  if (!profile) {
    errors.push({ field: 'profileId', message: `No SocialProfile found with id "${profileId}".` });
    return;
  }
  if (creatorOsAccountId && profile.creatorOsAccountId !== creatorOsAccountId) {
    errors.push({
      field: 'creatorOsAccountId',
      message: `"${creatorOsAccountId}" does not match profile "${profileId}"'s creatorOsAccountId ("${profile.creatorOsAccountId}").`,
    });
  }
}

async function validateExperimentConsistency(
  errors: ValidationError[],
  store: IntelligenceStore,
  experimentId: string | undefined,
  profileId: string,
): Promise<void> {
  if (!experimentId) return;
  const experiment = await store.getExperiment(experimentId);
  if (!experiment) {
    errors.push({ field: 'experimentId', message: `No Experiment found with id "${experimentId}".` });
    return;
  }
  if (experiment.profileId !== profileId) {
    errors.push({
      field: 'experimentId',
      message: `Experiment "${experimentId}" belongs to profile "${experiment.profileId}", not "${profileId}".`,
    });
  }
}

export async function validateMeasurementSnapshotInput(
  input: MeasurementSnapshotInput,
  store: IntelligenceStore,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  await validateProfileConsistency(errors, store, input.profileId, input.creatorOsAccountId);
  await validateExperimentConsistency(errors, store, input.experimentId, input.profileId);

  if (!input.creatorOsAccountId?.trim()) {
    errors.push({ field: 'creatorOsAccountId', message: 'A creatorOsAccountId is required.' });
  }
  if (!input.sourcePlatform || !isKnownPlatform(input.sourcePlatform)) {
    errors.push({ field: 'sourcePlatform', message: `"${String(input.sourcePlatform)}" is not a platform CreatorOS can execute against.` });
  }
  if (!input.capturedAt || !isValidIsoDate(input.capturedAt)) {
    errors.push({ field: 'capturedAt', message: `"${input.capturedAt}" is not a valid date.` });
  }
  if (!input.rawMetrics || typeof input.rawMetrics !== 'object') {
    errors.push({ field: 'rawMetrics', message: 'rawMetrics must be an object (may be empty).' });
  } else {
    for (const [key, value] of Object.entries(input.rawMetrics)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
        errors.push({ field: `rawMetrics.${key}`, message: `"${key}" must be a non-negative number.` });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function validateProfileMeasurementSnapshotInput(
  input: ProfileMeasurementSnapshotInput,
  store: IntelligenceStore,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  await validateProfileConsistency(errors, store, input.profileId, input.creatorOsAccountId);

  if (!input.creatorOsAccountId?.trim()) {
    errors.push({ field: 'creatorOsAccountId', message: 'A creatorOsAccountId is required.' });
  }
  if (!input.sourcePlatform || !isKnownPlatform(input.sourcePlatform)) {
    errors.push({ field: 'sourcePlatform', message: `"${String(input.sourcePlatform)}" is not a platform CreatorOS can execute against.` });
  }
  if (!input.capturedAt || !isValidIsoDate(input.capturedAt)) {
    errors.push({ field: 'capturedAt', message: `"${input.capturedAt}" is not a valid date.` });
  }

  return { valid: errors.length === 0, errors };
}

export async function validateAttributionEventInput(
  input: AttributionEventInput,
  store: IntelligenceStore,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  await validateProfileConsistency(errors, store, input.profileId, '');
  await validateExperimentConsistency(errors, store, input.experimentId, input.profileId);

  if (!input.eventType) {
    errors.push({ field: 'eventType', message: 'An eventType is required.' });
  }
  if (!input.source?.trim()) {
    errors.push({ field: 'source', message: 'A source (reporting system) is required.' });
  }
  if (!input.occurredAt || !isValidIsoDate(input.occurredAt)) {
    errors.push({ field: 'occurredAt', message: `"${input.occurredAt}" is not a valid date.` });
  }
  if (input.value !== undefined && (!Number.isFinite(input.value) || input.value < 0)) {
    errors.push({ field: 'value', message: 'value must be a non-negative number.' });
  }
  if (input.currency !== undefined && !CURRENCY_PATTERN.test(input.currency)) {
    errors.push({ field: 'currency', message: `"${input.currency}" is not a valid ISO 4217 currency code.` });
  }
  // Attribution value semantics: a currency with no amount, or an amount with
  // no currency, is an internally inconsistent event — reject rather than guess.
  if (input.currency !== undefined && input.value === undefined) {
    errors.push({ field: 'value', message: 'currency was given but value was not — an amount is required alongside a currency.' });
  }
  if (input.value !== undefined && input.currency === undefined) {
    errors.push({ field: 'currency', message: 'value was given but currency was not.' });
  }

  return { valid: errors.length === 0, errors };
}
