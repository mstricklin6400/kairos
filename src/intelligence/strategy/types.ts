/**
 * Strategy knowledge and the Profile Brain — what Kairos believes, and what it
 * has learned about one specific connected account.
 *
 * The rule this file exists to enforce: a claim from a course enters as
 * `sourceType: 'playbook'`, `status: 'hypothesis'`, and cannot become system
 * truth without evidence.
 */
import type {
  Confidence,
  GrowthObjective,
  IsoDateTime,
  KnowledgeScope,
  KnowledgeSourceType,
  Platform,
  WeightedInsight,
} from '../common/types.js';
import type { Pattern, ProfileMonetizationContext } from '../profiles/types.js';
import type { PerformanceBaseline } from '../performance/types.js';
import type { Finding } from '../science/types.js';
import type { DeclaredAudienceComparison } from '../audience/types.js';

/** Where a strategy principle came from. Shares the knowledge-source vocabulary. */
export type StrategySourceType = KnowledgeSourceType;

/**
 * Deliberately NOT the same enum as `HypothesisStatus`. A principle's lifecycle
 * ends in decay, not in "inconclusive" — a principle either still earns its
 * place, has been disproven, or is going stale.
 */
export type StrategyPrincipleStatus = 'hypothesis' | 'supported' | 'rejected' | 'decaying';

/**
 * A durable "how to operate" claim — the thing a course sells, a platform
 * documents, or an experiment proves.
 *
 * Imported course material MUST be representable as
 * `{ sourceType: 'playbook', status: 'hypothesis' }` and must not
 * auto-promote to truth.
 */
export interface StrategyPrinciple {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sourceType: StrategySourceType;
  /** URL, course name, doc section, experiment id — whatever identifies the origin. */
  readonly sourceReference?: string;
  readonly scope: KnowledgeScope;
  /** Empty means platform-agnostic, not "no platforms". */
  readonly applicablePlatforms: readonly Platform[];
  /** Empty means objective-agnostic. */
  readonly applicableObjectives: readonly GrowthObjective[];
  readonly status: StrategyPrincipleStatus;
  readonly confidence: Confidence;
  /** Absent for untested claims — a playbook statement has no sample. */
  readonly sampleSize?: number;
  readonly createdAt: IsoDateTime;
  readonly lastValidatedAt?: IsoDateTime;
}

/**
 * What Kairos knows about the niche this profile operates in. Every bucket is
 * `WeightedInsight[]` rather than `string[]` so each item carries its own
 * confidence, source and recency.
 *
 * Milestone 1 defines the shape; the research process that fills it is not
 * implemented.
 */
export interface NicheIntelligence {
  readonly painPoints: readonly WeightedInsight[];
  readonly desires: readonly WeightedInsight[];
  /** Vocabulary and jargon insiders actually use. */
  readonly terminology: readonly WeightedInsight[];
  readonly objections: readonly WeightedInsight[];
  /** Topics gaining attention right now. */
  readonly emergingTopics: readonly WeightedInsight[];
  /** Questions the niche keeps asking. */
  readonly recurringQuestions: readonly WeightedInsight[];
  /** Questions the niche keeps asking that nobody answers well — the openings. */
  readonly informationGaps: readonly WeightedInsight[];
}

/** What Kairos has learned about one audience segment specifically. */
export interface SegmentLearning {
  readonly segmentId: string;
  readonly insights: readonly WeightedInsight[];
}

/**
 * What Kairos has learned about this profile's audience — soft insight
 * buckets (Milestone 1) plus, from Milestone 4, materialized references into
 * the observed-audience stores (`../audience/`). Deliberately references and
 * counts, not embedded copies: `ObservedAudienceSegment`, `AudienceSignal`
 * and `SegmentFinding` records are the source of truth and live in
 * `IntelligenceStore`; this is a fast-read summary for strategy code, kept
 * current by whatever process last called `saveProfileBrain` — see the
 * source-of-truth rules in `../storage/store.ts`.
 *
 * Never holds declared-audience data. `SocialProfile.audience` is the only
 * source of truth for what the profile owner declared; nothing here is
 * permitted to duplicate or overwrite it — see the declared-vs-observed
 * note in `../audience/types.ts`.
 */
export interface AudienceIntelligence {
  readonly segmentLearnings: readonly SegmentLearning[];
  readonly languagePatterns: readonly WeightedInsight[];
  readonly objections: readonly WeightedInsight[];
  readonly motivations: readonly WeightedInsight[];
  /** How this audience tends to react — what earns replies, what gets scrolled. */
  readonly responsePatterns: readonly WeightedInsight[];
  /** `ObservedAudienceSegment.id`s currently on record for this profile, any status. */
  readonly observedSegmentIds: readonly string[];
  /** The subset of `observedSegmentIds` whose `status` is `'emerging'`. */
  readonly emergingSegmentIds: readonly string[];
  /** `SegmentFinding.id`s currently on record for this profile. */
  readonly segmentFindingIds: readonly string[];
  /** Total `AudienceSignal`s recorded for this profile, across all segments and unclassified. */
  readonly totalSignalCount: number;
  /** Signals with no `segmentId` — evidence Kairos has not forced into an existing segment. */
  readonly unclassifiedSignalCount: number;
  readonly declaredVsObserved: DeclaredAudienceComparison;
  readonly lastUpdatedAt?: IsoDateTime;
}

/**
 * Findings bucketed by standing.
 *
 * `rejected` and `decaying` are retained, never deleted: knowing what does not
 * work is knowledge, and re-testing a decayed finding is cheaper than
 * rediscovering it.
 */
export interface StrategyMemory {
  readonly validated: readonly Finding[];
  readonly promising: readonly Finding[];
  readonly rejected: readonly Finding[];
  readonly decaying: readonly Finding[];
}

/**
 * Everything Kairos has learned about ONE connected social profile — the
 * durable memory that makes the next decision better than the last.
 *
 * Not a prompt and not a cache: the profile's accumulated scientific record.
 */
export interface ProfileBrain {
  readonly profileId: string;
  readonly nicheIntelligence: NicheIntelligence;
  readonly audienceIntelligence: AudienceIntelligence;
  readonly strategyMemory: StrategyMemory;
  readonly performanceBaselines: readonly PerformanceBaseline[];
  /** Experiments currently in flight for this profile. */
  readonly activeExperimentIds: readonly string[];
  readonly winnerPatterns: readonly Pattern[];
  readonly failurePatterns: readonly Pattern[];
  readonly monetizationContext: ProfileMonetizationContext;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Bumped when the brain's shape changes, so stored records can migrate. */
  readonly version: number;
}
