/**
 * Explainable similarity for the Intelligence Transfer Engine. Pure,
 * deterministic, no AI, no embeddings.
 *
 * Every comparison is dimension-level and reasoned. There is no opaque
 * "similarity = 0.87": the score is always reconstructible from the
 * per-dimension breakdown that produced it, and always accompanied by how
 * much of the comparison was actually knowable.
 *
 * THE UNKNOWN RULE
 * ------------------------------------------------------------------------
 * A dimension Kairos cannot compare is `unknown`. It is excluded from the
 * similarity denominator — never scored as a match, never scored as a
 * mismatch — and instead reduces `dimensionCoverage`. Missing information
 * therefore lowers confidence in the assessment rather than quietly
 * inflating or deflating the similarity number.
 */
import { daysBetween } from '../science/statistics.js';
import type { AnalysisLimitation } from '../science/types.js';
import type {
  DimensionComparison,
  SimilarityProfile,
  TransferCandidate,
  TransferContext,
  TransferDimension,
  TransferDimensionKey,
  TransferPolicy,
} from './types.js';

/** How much each comparison outcome counts toward the numerator. */
const MATCH_STRENGTH: Readonly<Record<DimensionComparison, number>> = {
  match: 1,
  partial: 0.5,
  mismatch: 0,
  unknown: 0,
};

/** Case-insensitive, whitespace-tolerant string equality. No fuzzy matching, no embeddings. */
function sameText(a?: string, b?: string): boolean {
  if (a === undefined || b === undefined) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Compares two optional strings, returning `unknown` when either side is absent. */
function compareText(a: string | undefined, b: string | undefined): DimensionComparison {
  if (a === undefined || b === undefined) return 'unknown';
  return sameText(a, b) ? 'match' : 'mismatch';
}

/** Compares two optional sets, scoring partial overlap as `partial`. */
function compareSets(a: readonly string[] | undefined, b: readonly string[] | undefined): DimensionComparison {
  if (a === undefined || b === undefined || a.length === 0 || b.length === 0) return 'unknown';
  const lowerB = new Set(b.map((v) => v.trim().toLowerCase()));
  const overlap = a.filter((v) => lowerB.has(v.trim().toLowerCase())).length;
  if (overlap === 0) return 'mismatch';
  return overlap === Math.max(a.length, b.length) ? 'match' : 'partial';
}

/**
 * Compares two counts on an order-of-magnitude basis. Account size matters
 * as a scale band, not as an exact number: 5,000 vs 6,000 followers is the
 * same situation, 5,000 vs 500,000 is not.
 */
function compareMagnitude(a: number | undefined, b: number | undefined): DimensionComparison {
  if (a === undefined || b === undefined) return 'unknown';
  if (a === 0 && b === 0) return 'match';
  if (a === 0 || b === 0) return 'mismatch';
  const ratio = Math.max(a, b) / Math.min(a, b);
  if (ratio <= 2) return 'match';
  if (ratio <= 10) return 'partial';
  return 'mismatch';
}

/** The account-stage ladder, so adjacent stages score as partial rather than a flat mismatch. */
const STAGE_ORDER = ['cold-start', 'early', 'growing', 'established', 'mature'] as const;

function compareAccountStage(a: string | undefined, b: string | undefined): DimensionComparison {
  if (a === undefined || b === undefined) return 'unknown';
  if (a === b) return 'match';
  const ai = STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]);
  const bi = STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number]);
  if (ai === -1 || bi === -1) return 'unknown';
  return Math.abs(ai - bi) === 1 ? 'partial' : 'mismatch';
}

/** Freshness as a dimension: recent evidence matches, aging evidence partially, stale evidence not at all. */
function compareFreshness(ageDays: number, stalenessDays: number): DimensionComparison {
  if (ageDays <= stalenessDays / 2) return 'match';
  if (ageDays <= stalenessDays) return 'partial';
  return 'mismatch';
}

/**
 * Measurement quality, judged from what the evidence itself admits: sample
 * size and its own declared limitations. Evidence that carries caveats is
 * not disqualified — it is scored as the weaker evidence it is.
 */
function compareMeasurementQuality(candidate: TransferCandidate): DimensionComparison {
  const hasSeriousLimitation = candidate.limitations.some((l) =>
    ['small_sample', 'no_baseline', 'insufficient_controls', 'single_pair'].includes(l),
  );
  if (candidate.sampleSize >= 20 && !hasSeriousLimitation) return 'match';
  if (candidate.sampleSize >= 5 && !hasSeriousLimitation) return 'partial';
  return 'mismatch';
}

/**
 * Audience behavior compares OBSERVED evidence only. A declared audience
 * that happens to read similarly is not behavioral proof, so when the donor
 * evidence is not observation-backed this dimension is `unknown` rather
 * than a match — see `TransferCandidate.sourceObserved`.
 */
function compareAudienceBehavior(candidate: TransferCandidate, context: TransferContext): DimensionComparison {
  if (!candidate.sourceObserved || context.observedSegmentIds.length === 0) return 'unknown';
  return sameText(candidate.sourceAudienceDescription, context.declaredAudience) ? 'match' : 'partial';
}

const NOTES: Readonly<Record<DimensionComparison, string>> = {
  match: 'matches',
  partial: 'partially matches',
  mismatch: 'differs',
  unknown: 'could not be compared',
};

/**
 * Builds the full dimension-by-dimension comparison between a candidate and
 * a receiving profile.
 *
 * `now` is an explicit parameter rather than read from the clock, keeping
 * this a pure function.
 */
export function compareDimensions(
  candidate: TransferCandidate,
  context: TransferContext,
  policy: TransferPolicy,
  now: string,
): TransferDimension[] {
  const ageDays = daysBetween(candidate.lastValidatedAt, now);

  const raw: Array<{
    key: TransferDimensionKey;
    comparison: DimensionComparison;
    sourceValue?: string;
    targetValue?: string;
  }> = [
    {
      key: 'platform',
      comparison: compareText(candidate.sourcePlatform, context.platform),
      sourceValue: candidate.sourcePlatform,
      targetValue: context.platform,
    },
    {
      key: 'niche',
      comparison: compareText(candidate.sourceNiche, context.niche),
      sourceValue: candidate.sourceNiche,
      targetValue: context.niche,
    },
    {
      key: 'subNiche',
      comparison: compareText(candidate.sourceSubNiche, context.subNiche),
      sourceValue: candidate.sourceSubNiche,
      targetValue: context.subNiche,
    },
    {
      key: 'audience',
      comparison: compareText(candidate.sourceAudienceDescription, context.declaredAudience),
      sourceValue: candidate.sourceAudienceDescription,
      targetValue: context.declaredAudience,
    },
    { key: 'audienceBehavior', comparison: compareAudienceBehavior(candidate, context) },
    {
      key: 'businessModel',
      comparison: compareSets(candidate.sourceOfferTypes, context.offerTypes),
      sourceValue: candidate.sourceOfferTypes.join(', ') || undefined,
      targetValue: context.offerTypes.join(', ') || undefined,
    },
    {
      key: 'offerType',
      comparison: compareSets(candidate.sourceOfferTypes, context.offerTypes),
      sourceValue: candidate.sourceOfferTypes.join(', ') || undefined,
      targetValue: context.offerTypes.join(', ') || undefined,
    },
    {
      key: 'objective',
      comparison: compareText(candidate.sourceObjective, context.objective),
      sourceValue: candidate.sourceObjective,
      targetValue: context.objective,
    },
    {
      key: 'accountStage',
      comparison: compareAccountStage(candidate.sourceAccountStage, context.accountStage),
      sourceValue: candidate.sourceAccountStage,
      targetValue: context.accountStage,
    },
    {
      key: 'accountSize',
      comparison: compareMagnitude(candidate.sourceFollowerCount, context.followerCount),
      sourceValue: candidate.sourceFollowerCount?.toString(),
      targetValue: context.followerCount?.toString(),
    },
    // Content format and experimental conditions are not carried on a
    // Finding today, so they are honestly unknown rather than guessed.
    { key: 'contentFormat', comparison: 'unknown' },
    { key: 'experimentalConditions', comparison: candidate.battleProvenance ? 'match' : 'unknown' },
    { key: 'postingCapacity', comparison: compareMagnitude(undefined, context.postsPerDay) },
    {
      key: 'voicePositioning',
      comparison: compareText(candidate.sourcePositioning, context.positioning),
      sourceValue: candidate.sourcePositioning,
      targetValue: context.positioning,
    },
    {
      key: 'geography',
      comparison: compareSets(candidate.sourceGeographicFocus, context.geographicFocus),
      sourceValue: candidate.sourceGeographicFocus?.join(', '),
      targetValue: context.geographicFocus?.join(', '),
    },
    { key: 'measurementQuality', comparison: compareMeasurementQuality(candidate) },
    { key: 'evidenceFreshness', comparison: compareFreshness(ageDays, policy.stalenessDays) },
  ];

  return raw.map(({ key, comparison, sourceValue, targetValue }) => {
    const weight = policy.dimensionWeights[key];
    return {
      key,
      comparison,
      sourceValue,
      targetValue,
      weight,
      contribution: weight * MATCH_STRENGTH[comparison],
      note: `${key} ${NOTES[comparison]}${
        comparison !== 'unknown' && sourceValue && targetValue ? ` (${sourceValue} vs ${targetValue})` : ''
      }.`,
    };
  });
}

/**
 * Aggregates dimensions into a `SimilarityProfile`.
 *
 * The denominator is the weight of KNOWN dimensions only, so similarity
 * answers "of what we could compare, how much matched" — and
 * `dimensionCoverage` separately answers "how much could we compare at
 * all". Reporting one without the other is how a two-dimension match gets
 * mistaken for a comprehensive one.
 */
export function buildSimilarityProfile(dimensions: readonly TransferDimension[]): SimilarityProfile {
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const known = dimensions.filter((d) => d.comparison !== 'unknown');
  const knownWeight = known.reduce((sum, d) => sum + d.weight, 0);
  const contribution = known.reduce((sum, d) => sum + d.contribution, 0);

  const limitations: AnalysisLimitation[] = [];
  const dimensionCoverage = totalWeight === 0 ? 0 : knownWeight / totalWeight;
  if (dimensionCoverage < 0.5) limitations.push('unmatched_comparison');
  if (dimensions.some((d) => d.key === 'measurementQuality' && d.comparison === 'mismatch')) {
    limitations.push('small_sample');
  }

  return {
    dimensions,
    overallSimilarity: knownWeight === 0 ? 0 : contribution / knownWeight,
    dimensionCoverage,
    matchedDimensions: dimensions.filter((d) => d.comparison === 'match').map((d) => d.key),
    mismatchedDimensions: dimensions.filter((d) => d.comparison === 'mismatch').map((d) => d.key),
    unknownDimensions: dimensions.filter((d) => d.comparison === 'unknown').map((d) => d.key),
    limitations,
  };
}

/** Convenience: compare and aggregate in one call. */
export function computeSimilarity(
  candidate: TransferCandidate,
  context: TransferContext,
  policy: TransferPolicy,
  now: string,
): SimilarityProfile {
  return buildSimilarityProfile(compareDimensions(candidate, context, policy, now));
}
