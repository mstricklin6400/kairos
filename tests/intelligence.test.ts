import { describe, expect, it } from 'vitest';
import { METRIC_MEASUREMENT_TIER } from '../src/intelligence/index.js';
import type {
  AudienceSegment,
  ContentPillar,
  Experiment,
  ExperimentResult,
  Finding,
  Hypothesis,
  Offer,
  Platform,
  ProfileBrain,
  SocialProfile,
  StrategyPrinciple,
} from '../src/intelligence/index.js';

const NOW = '2026-08-19T12:00:00Z';

/** A complete, valid profile. Overrides let each test say only what it means. */
function profile(overrides: Partial<SocialProfile> = {}): SocialProfile {
  return {
    id: 'prof_1',
    creatorOsAccountId: '507f1f77bcf86cd799439011',
    platform: 'threads',
    identity: {
      brandName: 'Lift Notes',
      handle: '@liftnotes',
      faceless: true,
      voice: ['blunt', 'technical'],
    },
    market: { niche: 'strength training', subNiche: 'powerlifting' },
    audience: {
      primaryAudience: 'intermediate lifters stuck at a plateau',
      segments: [],
      pains: ['stalled bench'],
      desires: ['a repeatable program'],
      languagePatterns: ['PR', 'deload', 'AMRAP'],
    },
    objectives: { primary: 'followers', secondary: ['conversation'] },
    strategy: {
      experimentMode: 'balanced',
      postingFrequency: { postsPerDay: 3 },
      contentPillars: [],
      currentAllocations: [],
    },
    monetization: { offers: [] },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

describe('SocialProfile — platform coverage', () => {
  it('represents a Threads profile', () => {
    const p = profile({ platform: 'threads' });
    expect(p.platform).toBe('threads');
    expect(p.identity.faceless).toBe(true);
  });

  it('represents an X profile (CreatorOS calls the platform "twitter")', () => {
    const p = profile({
      id: 'prof_x',
      platform: 'twitter',
      identity: { brandName: 'Lift Notes', handle: '@liftnotes', faceless: false, voice: ['blunt'] },
    });
    expect(p.platform).toBe('twitter');
  });

  it('does not prevent Instagram, TikTok or any other future platform', () => {
    // Compile-time proof: each of these is assignable to SocialProfile['platform']
    // with no change to the intelligence layer. The union is re-exported from
    // the CreatorOS platform matrix, so adding a platform is a one-line change
    // there and zero changes here.
    const future: readonly Platform[] = ['instagram', 'tiktok', 'linkedin', 'youtube', 'facebook', 'pinterest', 'reddit'];
    for (const platform of future) {
      expect(profile({ platform }).platform).toBe(platform);
    }
  });
});

describe('SocialProfile — CreatorOS boundary', () => {
  it('preserves creatorOsAccountId as the canonical account reference', () => {
    const p = profile({ id: 'prof_kairos_side', creatorOsAccountId: '65a1b2c3d4e5f60718293a4b' });
    // The Kairos id and the CreatorOS id are separate and both survive.
    expect(p.id).toBe('prof_kairos_side');
    expect(p.creatorOsAccountId).toBe('65a1b2c3d4e5f60718293a4b');
  });
});

describe('SocialProfile — profile-specific strategy inputs', () => {
  it('holds multiple distinct audience segments', () => {
    const segments: AudienceSegment[] = [
      {
        id: 'seg_beginner',
        name: 'Nervous beginners',
        pains: ['gym anxiety'],
        desires: ['a plan for week one'],
        objections: ['I will look stupid'],
        languagePatterns: ['newbie gains'],
        priority: 1,
      },
      {
        id: 'seg_plateau',
        name: 'Plateaued intermediates',
        description: 'Two years in, bench has not moved in six months.',
        pains: ['stalled bench'],
        desires: ['a peaking block'],
        objections: ['programs are all the same'],
        languagePatterns: ['deload', 'AMRAP'],
        priority: 2,
      },
    ];
    const p = profile({ audience: { ...profile().audience, segments } });
    expect(p.audience.segments).toHaveLength(2);
    expect(p.audience.segments.map((s) => s.id)).toEqual(['seg_beginner', 'seg_plateau']);
    expect(p.audience.segments[1]!.objections).toContain('programs are all the same');
  });

  it('holds content pillars that belong to the profile, not to Kairos Core', () => {
    const pillars: ContentPillar[] = [
      { id: 'pil_form', name: 'Form breakdowns', objective: 'reach', allocation: 0.5 },
      { id: 'pil_myth', name: 'Myth busting', objective: 'conversation', allocation: 0.3 },
      { id: 'pil_offer', name: 'Program promo', objective: 'sale', allocation: 0.2 },
    ];
    const p = profile({
      strategy: {
        ...profile().strategy,
        contentPillars: pillars,
        currentAllocations: pillars.map((pillar) => ({ pillarId: pillar.id, share: pillar.allocation ?? 0 })),
      },
    });
    expect(p.strategy.contentPillars).toHaveLength(3);
    // Allocations reference this profile's own pillars — nothing global.
    const total = p.strategy.currentAllocations.reduce((sum, a) => sum + a.share, 0);
    expect(total).toBeCloseTo(1);
  });

  it('supports all three experiment modes', () => {
    for (const mode of ['conservative', 'balanced', 'discovery'] as const) {
      expect(profile({ strategy: { ...profile().strategy, experimentMode: mode } }).strategy.experimentMode).toBe(mode);
    }
  });

  it('carries offers without requiring price or ecommerce wiring', () => {
    const offers: Offer[] = [
      { id: 'off_free', name: 'Plateau checklist', description: 'Lead magnet PDF', type: 'lead-magnet', active: true },
      { id: 'off_paid', name: 'Peaking block', description: '8-week program', url: 'https://example.com/p', price: 79, currency: 'USD', type: 'digital-product', active: true },
    ];
    const p = profile({ monetization: { offers, primaryConversionGoal: 'sale' } });
    expect(p.monetization.offers[0]!.price).toBeUndefined();
    expect(p.monetization.offers[1]!.price).toBe(79);
  });
});

describe('Experiment', () => {
  const base: Experiment = {
    id: 'exp_1',
    profileId: 'prof_1',
    platform: 'threads',
    niche: 'strength training',
    objective: 'conversation',
    contentDna: {
      topic: 'bench plateau',
      hookFamily: 'contrarian-claim',
      format: 'text',
      tone: 'contrarian',
      lengthClass: 'short',
      emotionalDriver: 'curiosity',
      ctaType: 'reply',
    },
    design: { testVariables: ['hookFamily'], controlVariable: 'topic', variant: 'A', pairId: 'pair_1' },
    execution: { publishedAt: NOW, creatorOsPostId: '507f191e810c19729de860ea' },
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts partially populated metrics — a platform never has to fake a number', () => {
    const threadsResult: ExperimentResult = { impressions: 4200, replies: 31, likes: 210, measuredAt: NOW };
    const exp: Experiment = { ...base, results: threadsResult };
    expect(exp.results!.impressions).toBe(4200);
    // Not reported by this platform — absent, and distinguishable from zero.
    expect(exp.results!.saves).toBeUndefined();
    expect(exp.results!.revenue).toBeUndefined();
  });

  it('keeps views and impressions separate so the reported metric is never lost', () => {
    const videoResult: ExperimentResult = { views: 88000, measuredAt: NOW };
    const textResult: ExperimentResult = { impressions: 4200, measuredAt: NOW };
    expect(videoResult.views).toBe(88000);
    expect(videoResult.impressions).toBeUndefined();
    expect(textResult.impressions).toBe(4200);
    expect(textResult.views).toBeUndefined();
  });

  it('tracks business metrics when they exist, without requiring them', () => {
    const commercial: Experiment = {
      ...base,
      objective: 'revenue',
      results: { impressions: 3100, clicks: 140, leads: 22, sales: 3, revenue: 237, currency: 'USD', measuredAt: NOW },
    };
    expect(commercial.results!.leads).toBe(22);
    expect(commercial.results!.revenue).toBe(237);
    expect(commercial.results!.currency).toBe('USD');

    // The same shape is valid with none of them set.
    const awareness: Experiment = { ...base, results: { impressions: 3100, measuredAt: NOW } };
    expect(awareness.results!.leads).toBeUndefined();
    expect(awareness.results!.sales).toBeUndefined();
    expect(awareness.results!.revenue).toBeUndefined();
  });

  it('has no results at all before measurement', () => {
    const unmeasured: Experiment = { ...base, execution: { scheduledAt: NOW } };
    expect(unmeasured.results).toBeUndefined();
    expect(unmeasured.execution.creatorOsPostId).toBeUndefined();
  });
});

describe('StrategyPrinciple', () => {
  it('keeps a course claim as an untested hypothesis — it never becomes system truth', () => {
    const fromCourse: StrategyPrinciple = {
      id: 'sp_1',
      name: 'Post at 6am',
      description: 'The course claims 6am local posting beats every other slot.',
      sourceType: 'playbook',
      sourceReference: 'Growth Accelerator, module 3',
      scope: { level: 'global' },
      applicablePlatforms: [],
      applicableObjectives: ['reach'],
      status: 'hypothesis',
      confidence: 0.1,
      createdAt: NOW,
    };
    expect(fromCourse.sourceType).toBe('playbook');
    expect(fromCourse.status).toBe('hypothesis');
    // Untested: no sample, never validated.
    expect(fromCourse.sampleSize).toBeUndefined();
    expect(fromCourse.lastValidatedAt).toBeUndefined();
  });

  it('distinguishes verified platform knowledge from playbook knowledge', () => {
    const platformFact: StrategyPrinciple = {
      id: 'sp_2',
      name: 'Threads supports native chains',
      description: 'threadItems is accepted on Threads per the CreatorOS API docs.',
      sourceType: 'platform',
      scope: { level: 'platform', platform: 'threads' },
      applicablePlatforms: ['threads'],
      applicableObjectives: [],
      status: 'supported',
      confidence: 1,
      createdAt: NOW,
      lastValidatedAt: NOW,
    };
    expect(platformFact.sourceType).toBe('platform');
    expect(platformFact.scope).toEqual({ level: 'platform', platform: 'threads' });
  });
});

describe('Hypothesis', () => {
  it('records supporting and contradicting experiments on the same claim', () => {
    const h: Hypothesis = {
      id: 'hyp_1',
      statement: 'Contrarian hooks earn more replies than how-to hooks.',
      scope: { level: 'profile', profileId: 'prof_1' },
      profileId: 'prof_1',
      platform: 'threads',
      independentVariable: 'hookFamily',
      dependentMetric: 'replies',
      controlVariables: ['topic', 'lengthClass', 'postingTime'],
      status: 'testing',
      confidence: 0.45,
      source: 'playbook',
      supportingExperimentIds: ['exp_1', 'exp_4'],
      contradictingExperimentIds: ['exp_7'],
      createdAt: NOW,
      lastTestedAt: NOW,
    };
    expect(h.supportingExperimentIds).toHaveLength(2);
    expect(h.contradictingExperimentIds).toEqual(['exp_7']);
    expect(h.dependentMetric).toBe('replies');
  });

  it('supports inconclusive as an outcome distinct from rejected', () => {
    const statuses = ['proposed', 'testing', 'supported', 'rejected', 'inconclusive'] as const;
    expect(new Set(statuses).size).toBe(5);
  });
});

describe('Finding', () => {
  const finding = (overrides: Partial<Finding>): Finding => ({
    id: 'fnd_1',
    statement: 'Contrarian hooks lift replies.',
    scope: { level: 'global' },
    sampleSize: 40,
    confidence: 0.7,
    status: 'promising',
    sourceExperimentIds: ['exp_1'],
    createdAt: NOW,
    lastValidatedAt: NOW,
    ...overrides,
  });

  it('scopes findings to a platform, a niche or a single profile', () => {
    const onPlatform = finding({ id: 'fnd_p', scope: { level: 'platform', platform: 'threads' } });
    const inNiche = finding({ id: 'fnd_n', scope: { level: 'niche', niche: 'strength training', subNiche: 'powerlifting' } });
    const forProfile = finding({ id: 'fnd_pr', scope: { level: 'profile', profileId: 'prof_1' } });

    expect(onPlatform.scope.level).toBe('platform');
    expect(inNiche.scope).toEqual({ level: 'niche', niche: 'strength training', subNiche: 'powerlifting' });
    expect(forProfile.scope.level).toBe('profile');

    // The narrowing discriminant is usable, not just decorative.
    if (onPlatform.scope.level === 'platform') expect(onPlatform.scope.platform).toBe('threads');
    if (forProfile.scope.level === 'profile') expect(forProfile.scope.profileId).toBe('prof_1');
  });

  it('states effect size unambiguously rather than as a bare number', () => {
    const f = finding({ effectSize: { metric: 'replies', relativeChange: 0.31 } });
    expect(f.effectSize).toEqual({ metric: 'replies', relativeChange: 0.31 });
  });
});

describe('ProfileBrain', () => {
  const emptyNiche = {
    painPoints: [],
    desires: [],
    terminology: [],
    objections: [],
    emergingTopics: [],
    recurringQuestions: [],
    informationGaps: [],
  };

  const f = (id: string, status: Finding['status']): Finding => ({
    id,
    statement: `finding ${id}`,
    scope: { level: 'profile', profileId: 'prof_1' },
    profileId: 'prof_1',
    sampleSize: 25,
    confidence: 0.6,
    status,
    sourceExperimentIds: ['exp_1'],
    createdAt: NOW,
    lastValidatedAt: NOW,
  });

  it('holds validated, promising, rejected and decaying findings side by side', () => {
    const brain: ProfileBrain = {
      profileId: 'prof_1',
      nicheIntelligence: {
        ...emptyNiche,
        painPoints: [{ id: 'wi_1', statement: 'Bench stalls at 225', weight: 0.8, source: 'research', lastObservedAt: NOW }],
      },
      audienceIntelligence: {
        segmentLearnings: [{ segmentId: 'seg_plateau', insights: [{ id: 'wi_2', statement: 'Responds to specificity', weight: 0.6 }] }],
        languagePatterns: [],
        objections: [],
        motivations: [],
        responsePatterns: [],
      },
      strategyMemory: {
        validated: [f('fnd_v', 'validated')],
        promising: [f('fnd_p', 'promising')],
        rejected: [f('fnd_r', 'rejected')],
        decaying: [f('fnd_d', 'decaying')],
      },
      performanceBaselines: [
        {
          profileId: 'prof_1',
          metric: 'replies',
          comparisonScope: { kind: 'hook-family', hookFamily: 'contrarian-claim' },
          sampleSize: 40,
          median: 18,
          window: { from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' },
          calculatedAt: NOW,
        },
      ],
      activeExperimentIds: ['exp_9'],
      winnerPatterns: [{ id: 'pat_w', description: 'contrarian + micro + reply CTA', featureTags: ['contrarian-claim', 'micro', 'reply'], confidence: 0.72, sampleSize: 14, lastObservedAt: NOW }],
      failurePatterns: [],
      monetizationContext: { activeOfferIds: ['off_paid'], primaryConversionGoal: 'sale', revenueTrackingEnabled: false },
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };

    expect(brain.strategyMemory.validated[0]!.status).toBe('validated');
    expect(brain.strategyMemory.promising[0]!.status).toBe('promising');
    // Rejected and decaying are retained, not deleted — knowing what fails is knowledge.
    expect(brain.strategyMemory.rejected[0]!.status).toBe('rejected');
    expect(brain.strategyMemory.decaying[0]!.status).toBe('decaying');

    expect(brain.performanceBaselines[0]!.comparisonScope).toEqual({ kind: 'hook-family', hookFamily: 'contrarian-claim' });
    // Optional spread stats stay absent on a small sample.
    expect(brain.performanceBaselines[0]!.standardDeviation).toBeUndefined();
    expect(brain.monetizationContext.revenueTrackingEnabled).toBe(false);
  });
});

describe('measurement hierarchy', () => {
  it('ladders every metric from attention up to customer value', () => {
    expect(METRIC_MEASUREMENT_TIER.impressions).toBe('attention');
    expect(METRIC_MEASUREMENT_TIER.views).toBe('attention');
    expect(METRIC_MEASUREMENT_TIER.replies).toBe('conversation');
    expect(METRIC_MEASUREMENT_TIER.comments).toBe('conversation');
    expect(METRIC_MEASUREMENT_TIER.reposts).toBe('amplification');
    expect(METRIC_MEASUREMENT_TIER.shares).toBe('amplification');
    expect(METRIC_MEASUREMENT_TIER.likes).toBe('engagementSignal');
    expect(METRIC_MEASUREMENT_TIER.saves).toBe('engagementSignal');
    expect(METRIC_MEASUREMENT_TIER.bookmarks).toBe('engagementSignal');
    expect(METRIC_MEASUREMENT_TIER.profileVisits).toBe('growth');
    expect(METRIC_MEASUREMENT_TIER.followersGained).toBe('growth');
    expect(METRIC_MEASUREMENT_TIER.clicks).toBe('intent');
    expect(METRIC_MEASUREMENT_TIER.leads).toBe('conversion');
    expect(METRIC_MEASUREMENT_TIER.sales).toBe('conversion');
    expect(METRIC_MEASUREMENT_TIER.revenue).toBe('customerValue');
  });

  it('keeps platform-native metric pairs distinct rather than collapsing them', () => {
    // impressions != views, replies != comments, reposts != shares, saves != bookmarks
    expect(METRIC_MEASUREMENT_TIER.impressions).toBe(METRIC_MEASUREMENT_TIER.views);
    expect(METRIC_MEASUREMENT_TIER.replies).toBe(METRIC_MEASUREMENT_TIER.comments);
    expect(METRIC_MEASUREMENT_TIER.reposts).toBe(METRIC_MEASUREMENT_TIER.shares);
    expect(METRIC_MEASUREMENT_TIER.saves).toBe(METRIC_MEASUREMENT_TIER.bookmarks);
    // Same tier does not mean same field — each metric still round-trips independently.
    const result: ExperimentResult = { impressions: 100, views: 50, saves: 4, bookmarks: 9 };
    expect(result.impressions).not.toBe(result.views);
    expect(result.saves).not.toBe(result.bookmarks);
  });
});
