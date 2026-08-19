/**
 * Turns validated onboarding input into a persisted `SocialProfile` (and,
 * the first time, a minimal `ProfileBrain`) through the Milestone 2
 * `IntelligenceStore` port — never by writing JSONL directly.
 *
 * RE-ONBOARDING SAFETY
 * ------------------------------------------------------------------------
 * Passing `profileId` re-onboards an existing profile: identity, niche,
 * audience, voice, objectives, offers and capacity are replaced with the
 * new answers, `version` increments and `updatedAt` moves — but `createdAt`
 * is preserved, and neither the profile's own experiment history nor its
 * `ProfileBrain` is touched here. `ProfileBrain` is created once, only if
 * one doesn't already exist; an existing brain (and everything findings,
 * hypotheses, experiments and baselines have accumulated for this profile
 * in the storage port) is never overwritten or deleted by re-onboarding.
 *
 * PROFILE BRAIN INITIALIZATION
 * ------------------------------------------------------------------------
 * The brain created here means exactly one thing: "we know what the owner
 * told us; we have not scientifically learned anything yet." No findings,
 * hypotheses, patterns or baselines are invented — every learned bucket
 * starts empty. The one thing it does carry over is `monetizationContext`,
 * because that is itself owner-declared configuration (which offers are
 * live, what the conversion goal is), not learned intelligence.
 */
import { randomUUID } from 'node:crypto';
import type { IsoDateTime } from '../common/types.js';
import type { IntelligenceStore } from '../storage/store.js';
import type { AudienceSegment, Offer, SocialProfile } from '../profiles/types.js';
import type { ProfileBrain } from '../strategy/types.js';
import { compareDeclaredToObserved } from '../audience/aggregate.js';
import { normalizeUrl, validateOnboardingInput } from './validate.js';
import type {
  OnboardingAudienceSegmentInput,
  OnboardingOfferInput,
  ProfileOnboardingInput,
  ValidationError,
} from './types.js';

export type OnboardProfileResult =
  | { readonly ok: true; readonly profile: SocialProfile; readonly brain: ProfileBrain; readonly created: boolean }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

function normalizeSegment(input: OnboardingAudienceSegmentInput): AudienceSegment {
  return { ...input, id: input.id ?? `seg_${randomUUID()}` };
}

function normalizeOffer(input: OnboardingOfferInput): Offer {
  const url = input.url?.trim() ? normalizeUrl(input.url) : undefined;
  return {
    ...input,
    id: input.id ?? `off_${randomUUID()}`,
    active: input.active ?? true,
    url: url && url.ok ? url.url : undefined,
  };
}

/** Folds the soft "sophistication" note into the one free-text audience description, since no dedicated field exists on the domain model yet. */
function composeDeclaredAudience(input: ProfileOnboardingInput): string {
  const base = input.declaredAudience.trim();
  const sophistication = input.audienceSophistication?.trim();
  return sophistication ? `${base} (experience level: ${sophistication})` : base;
}

function buildSocialProfile(input: ProfileOnboardingInput, existing: SocialProfile | null, now: IsoDateTime): SocialProfile {
  return {
    id: existing?.id ?? `prof_${randomUUID()}`,
    creatorOsAccountId: input.creatorOsAccountId,
    platform: input.platform,
    identity: {
      brandName: input.brandName,
      handle: input.handle,
      faceless: input.faceless ?? false,
      voice: input.voice ?? [],
      styleConstraints: input.styleConstraints,
      positioning: input.positioning,
    },
    market: {
      niche: input.niche,
      subNiche: input.subNiche,
      geographicFocus: input.geographicFocus,
    },
    audience: {
      primaryAudience: composeDeclaredAudience(input),
      segments: (input.audienceSegments ?? []).map(normalizeSegment),
      pains: input.audiencePains ?? [],
      desires: input.audienceDesires ?? [],
      languagePatterns: input.audienceLanguagePatterns ?? [],
    },
    objectives: {
      primary: input.primaryObjective,
      secondary: input.secondaryObjectives ?? [],
    },
    strategy: {
      experimentMode: input.experimentMode,
      postingFrequency: {
        postsPerDay: input.postsPerDay,
        postsPerWeek: input.postsPerWeek,
        notes: input.postingNotes,
      },
      // Not onboarding inputs — preserved across re-onboarding, empty on create.
      contentPillars: existing?.strategy.contentPillars ?? [],
      currentAllocations: existing?.strategy.currentAllocations ?? [],
    },
    monetization: {
      offers: (input.offers ?? []).map(normalizeOffer),
      primaryConversionGoal: input.primaryConversionGoal,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
  };
}

function initialProfileBrain(profile: SocialProfile, now: IsoDateTime): ProfileBrain {
  return {
    profileId: profile.id,
    nicheIntelligence: {
      painPoints: [],
      desires: [],
      terminology: [],
      objections: [],
      emergingTopics: [],
      recurringQuestions: [],
      informationGaps: [],
    },
    audienceIntelligence: {
      // Observed audience intelligence — empty by design. See the
      // declared-vs-observed note in `types.ts`; nothing declared at
      // onboarding is copied in here.
      segmentLearnings: [],
      languagePatterns: [],
      objections: [],
      motivations: [],
      responsePatterns: [],
      observedSegmentIds: [],
      emergingSegmentIds: [],
      segmentFindingIds: [],
      totalSignalCount: 0,
      unclassifiedSignalCount: 0,
      declaredVsObserved: compareDeclaredToObserved({ observedSegmentCount: 0, totalSignalCount: 0 }, now),
    },
    strategyMemory: { validated: [], promising: [], rejected: [], decaying: [] },
    performanceBaselines: [],
    activeExperimentIds: [],
    winnerPatterns: [],
    failurePatterns: [],
    monetizationContext: {
      activeOfferIds: profile.monetization.offers.filter((o) => o.active).map((o) => o.id),
      primaryConversionGoal: profile.monetization.primaryConversionGoal,
      revenueTrackingEnabled: false,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export async function onboardProfile(
  input: ProfileOnboardingInput,
  store: IntelligenceStore,
  now: IsoDateTime = new Date().toISOString(),
): Promise<OnboardProfileResult> {
  const validation = validateOnboardingInput(input);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  const existingProfile = input.profileId ? await store.getProfile(input.profileId) : null;
  const profile = buildSocialProfile(input, existingProfile, now);
  await store.saveProfile(profile);

  const existingBrain = await store.getProfileBrain(profile.id);
  const brain = existingBrain ?? initialProfileBrain(profile, now);
  if (!existingBrain) {
    await store.saveProfileBrain(brain);
  }

  return { ok: true, profile, brain, created: existingProfile === null };
}
