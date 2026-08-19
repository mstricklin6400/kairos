/**
 * Public surface of the Kairos intelligence layer.
 *
 * Milestone 1 is domain model only: types, plus one lookup table mapping
 * metrics to their measurement tier. No agents, no LLM calls, no persistence,
 * no execution — CreatorOS remains solely responsible for publishing,
 * scheduling, authentication and platform API operations.
 *
 * Import order below follows the dependency order of the modules
 * (common -> profiles -> performance -> science -> strategy); there are no
 * cycles.
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
  ExperimentResult,
  Finding,
  FindingStatus,
  Hypothesis,
  HypothesisStatus,
} from './science/types.js';

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
