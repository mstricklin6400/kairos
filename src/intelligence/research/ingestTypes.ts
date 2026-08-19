/**
 * Draft, unvalidated ingestion input for Milestone 5 — deliberately NOT
 * `ResearchSource`/`StrategyClaim`. Manual, structured ingestion only: no AI
 * extraction, no web fetcher, no PDF/transcript parser. A caller (human or a
 * later deterministic adapter) already has structured data; this module
 * validates, normalizes and persists it. Reuses `ValidationError`/
 * `ValidationResult` from the onboarding module rather than redefining the
 * same shape — the concept of a field-attributed validation problem isn't
 * specific to profile onboarding.
 */
import type { AccountStage, GrowthObjective, KnowledgeScope, Platform } from '../common/types.js';
import type { AssertedEffect, CausalStatus, ClaimStatus, ClaimType, ObservedAssociation, ResearchSourceType, SourceLocator } from './types.js';

export type { ValidationError, ValidationResult } from '../onboarding/types.js';

export interface ResearchSourceInput {
  /** Set to update an existing source; omit to create a new one. */
  readonly id?: string;
  readonly sourceType: ResearchSourceType;
  readonly title: string;
  readonly authorOrPublisher?: string;
  readonly url?: string;
  readonly publishedAt?: string;
  readonly accessedAt?: string;
  readonly description?: string;
  readonly platformsDiscussed?: readonly Platform[];
  readonly nichesDiscussed?: readonly string[];
  readonly sourceVersion?: string;
  readonly credibilityNotes?: string;
  readonly lastReviewedAt?: string;
  readonly supersededBySourceId?: string;
  readonly deprecatedAt?: string;
}

export interface StrategyClaimInput {
  /** Set to update an existing claim; omit to create a new one. */
  readonly id?: string;
  readonly sourceId: string;
  readonly statement: string;
  readonly claimType: ClaimType;
  readonly scope: KnowledgeScope;
  readonly platforms?: readonly Platform[];
  readonly niches?: readonly string[];
  readonly objectives?: readonly GrowthObjective[];
  readonly accountStages?: readonly AccountStage[];
  readonly audienceContext?: string;
  readonly contentContext?: string;
  readonly assertedEffect?: AssertedEffect;
  readonly observedAssociation?: ObservedAssociation;
  /** Omit to get the honest deterministic default for `claimType` — see `deriveDefaultCausalStatus`. */
  readonly causalStatus?: CausalStatus;
  /** Defaults to `'captured'`. */
  readonly status?: ClaimStatus;
  readonly confidenceInExtraction?: number;
  readonly excerpt?: string;
  readonly locator?: SourceLocator;
  readonly topicKey?: string;
}
