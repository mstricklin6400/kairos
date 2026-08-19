/**
 * Public surface of the Kairos intelligence layer: domain types, plus one
 * lookup table mapping metrics to their measurement tier. No agents, no LLM
 * calls, no execution — CreatorOS remains solely responsible for publishing,
 * scheduling, authentication and platform API operations.
 *
 * Persistence for these types lives separately at `./storage/store.js`
 * (the intelligence storage port) and `./storage/jsonlIntelligenceStore.js`
 * (its JSONL adapter) — deliberately not re-exported here, so this file
 * stays the domain-model surface and storage stays an explicit import.
 *
 * Import order below follows the dependency order of the modules
 * (common -> profiles -> performance -> science -> audience -> strategy,
 * since `strategy/types.ts`'s `AudienceIntelligence` references
 * `audience/types.ts`'s `DeclaredAudienceComparison`); there are no cycles.
 */

export type {
  AccountStage,
  Confidence,
  ContentFormat,
  ContentTone,
  ControversyLevel,
  CtaType,
  EmotionalDriver,
  GrowthObjective,
  HookFamily,
  IsoDateTime,
  KnowledgeScope,
  KnowledgeScopeLevel,
  KnowledgeSourceType,
  LengthClass,
  Platform,
  WeightedInsight,
} from './common/types.js';

export type {
  AudienceSegment,
  ContentAllocation,
  ContentPillar,
  ExperimentMode,
  Offer,
  OfferType,
  Pattern,
  PostingFrequency,
  ProfileAudience,
  ProfileIdentity,
  ProfileMarket,
  ProfileMonetization,
  ProfileMonetizationContext,
  ProfileObjectives,
  ProfileStrategy,
  SocialProfile,
} from './profiles/types.js';

export type {
  BaselineComparisonScope,
  BaselineWindow,
  MeasurementTier,
  PerformanceBaseline,
  PerformanceMetric,
} from './performance/types.js';

export { METRIC_MEASUREMENT_TIER } from './performance/types.js';

export type {
  ContentDna,
  EffectSize,
  Experiment,
  ExperimentDesign,
  ExperimentExecution,
  ExperimentObservation,
  ExperimentResult,
  Finding,
  FindingStatus,
  Hypothesis,
  HypothesisStatus,
} from './science/types.js';

export type {
  AudienceComparisonState,
  AudienceSignal,
  AudienceSignalSource,
  AudienceSignalType,
  DeclaredAudienceComparison,
  ObservedAudienceSegment,
  SegmentFinding,
  SegmentFindingStatus,
  SegmentMetricTotal,
  SegmentPerformance,
  SegmentStatus,
  SignalClassificationRecord,
} from './audience/types.js';

export type {
  AudienceIntelligence,
  NicheIntelligence,
  ProfileBrain,
  SegmentLearning,
  StrategyMemory,
  StrategyPrinciple,
  StrategyPrincipleStatus,
  StrategySourceType,
} from './strategy/types.js';
