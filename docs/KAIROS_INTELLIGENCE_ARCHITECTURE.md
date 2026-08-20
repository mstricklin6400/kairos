# Kairos Intelligence Architecture

> **Kairos is not a machine that knows the answer.**
> **Kairos is a machine designed to discover increasingly reliable answers for a
> specific profile, objective, platform, niche and audience — and to remember
> what it learns.**

CreatorOS executes. Kairos thinks, experiments, measures and learns.
The individual social profile is where niche, audience, voice, objective and
account-specific intelligence live.

---

## 1. Purpose of Kairos Intelligence

Kairos began as an agent harness around CreatorOS: a way to drive posting,
automations, comment/DM replies and analytics from one place. That layer is
*execution glue* and it stays exactly as it is.

The intelligence layer answers a different question. Not *"how do I publish
this?"* but *"what should this specific account publish next, and how do we
know?"*

Kairos Intelligence exists to:

- Represent what a social profile actually is — its niche, audience, voice,
  objectives and offers — as **data**, not as hard-coded assumptions.
- Treat every growth claim (from a course, a guru, an agency, a community, a
  platform changelog) as a **hypothesis with a source**, never as truth.
- Run **experiments** through CreatorOS, measure the outcome, and convert
  outcomes into **findings** that carry scope, sample size and confidence.
- **Remember** per-profile: what worked, what failed, what is decaying, and
  what the current performance baselines are.
- Make the next action measurably better than the last one.

Milestone 1 establishes the **domain model and architecture only**. No agents,
no LLM calls, no research process, no baseline math, no pattern detection.

---

## 2. Separation of Responsibilities

| System | Role | Owns |
| --- | --- | --- |
| **CreatorOS** | Execution / hands | Social account connections & auth, scheduling, publishing, platform API operations, comments & replies, webhooks, analytics retrieval |
| **Kairos** | Intelligence / strategy / science | Domain model, hypotheses, experiment design, measurement interpretation, findings, per-profile memory |
| **Social Profile** | Unit of customization and learning | Niche, audience, voice, objectives, offers, capacity, experiment mode |
| **Social Genome** | Future commercial product | Dashboard/product surface built *on top of* Kairos intelligence |
| **Social Money Lab** | Public research property | Public experimental/media property that runs on Kairos and publishes what it learns |

### The hard boundary

Kairos **never** re-implements execution. It does not connect accounts, mint
tokens, call platform APIs directly, or own the publish path. When an
experiment needs to go live, Kairos produces the *intent*; CreatorOS performs
the *act* and returns the identifiers and metrics.

`SocialProfile.creatorOsAccountId` is the canonical, unbroken reference to the
connected CreatorOS account. Kairos intelligence hangs off that ID; it never
replaces it.

Where a Kairos domain type and a CreatorOS contract type describe overlapping
ideas, the resolution is an **adapter/mapper introduced later** — never a
modification of the CreatorOS contract.

---

## 3. Intelligence Hierarchy

```
Kairos Core Intelligence      What is true about social growth in general
        ↓
Platform Intelligence         What is true about Threads / X / Instagram / ...
        ↓
Niche Intelligence            What is true about this niche and sub-niche
        ↓
Profile Intelligence          What is true about THIS connected account
        ↓
Active Experiment             What we are currently testing
        ↓
CreatorOS Execution           Publishing, scheduling, engagement
        ↓
Results                       Metrics that actually came back
        ↓
Kairos Science Engine         Analysis, hypothesis updates, findings
        ↓
Updated Knowledge             Findings, patterns, baselines, decay
        ↓
Better Next Action
```

Each layer **narrows** the one above it. A profile-scoped finding overrides a
niche-scoped one; a niche-scoped finding overrides a platform-scoped one. A
principle proven on Threads is not automatically true on LinkedIn, and a
principle proven for a fitness account is not automatically true for a B2B SaaS
account.

This is why `KnowledgeScope` is a first-class type rather than a comment.

---

## 4. Knowledge Categories

Every piece of knowledge in Kairos carries a **source type**, and the source
type determines how much authority it gets.

### SOURCE PLAYBOOK KNOWLEDGE — `sourceType: 'playbook'`

Claims from courses, gurus, agencies, communities, threads, and "what everyone
knows." Useful as a *generator of ideas*. Worthless as a *statement of fact*
until tested.

**Rule:** a statement imported from a course enters the system as
`sourceType: 'playbook'`, `status: 'hypothesis'`. It never auto-promotes.

### VERIFIED PLATFORM KNOWLEDGE — `sourceType: 'platform'`

Official capabilities, documented API behavior, rate limits, format
restrictions, publicly stated ranking factors. This is closer to fact, but it
is *capability* knowledge, not *effectiveness* knowledge. "Threads supports
5-post chains" is verified. "5-post chains get more reach" is not.

### KAIROS EXPERIMENTAL KNOWLEDGE — `sourceType: 'experiment'`

Evidence produced by Kairos's own experiments on real accounts, carrying scope,
sample size, effect size and confidence. This is the only category that earns
`validated` status — and it can still decay.

(`sourceType: 'research'` covers deliberate desk research/analysis that is
neither a platform document nor a Kairos experiment.)

---

## 5. The Scientific Loop

```
Observe  →  Hypothesize  →  Design  →  Execute  →  Measure
   ↑                                                  ↓
Predict  ←  Learn  ←  Analyze  ←──────────────────────┘
   ↓
Execute (better)
```

- **Observe** — read current performance, baselines and audience signal.
- **Hypothesize** — state a testable claim: independent variable → dependent
  metric, with controls.
- **Design** — build an `Experiment` with explicit content DNA, a control
  variable and the variables actually under test (ideally paired via `pairId`).
- **Execute** — hand off to CreatorOS. Kairos records `creatorOsPostId`.
- **Measure** — pull results back. Metrics are optional by design: no platform
  exposes everything.
- **Analyze** — compare against the relevant `PerformanceBaseline`, not against
  a global average.
- **Learn** — update the `Hypothesis`, emit or update a `Finding`, adjust
  confidence, record winner/failure patterns.
- **Predict** — use accumulated findings to choose the next action.
- **Execute** — and the loop tightens.

Milestone 1 ships the **nouns** of this loop. The verbs come later.

---

## 6. Profile Brain

The `ProfileBrain` is everything Kairos has learned about **one** connected
social profile. It is the durable memory that makes the next decision better
than the last.

It holds:

- **`nicheIntelligence`** — pain points, desires, terminology, objections,
  emerging topics, recurring questions, information gaps. All modelled as
  `WeightedInsight[]` so each item carries confidence, source and recency
  rather than being a bare string.
- **`audienceIntelligence`** — per-segment learnings, language patterns,
  objections, motivations, response patterns.
- **`strategyMemory`** — findings bucketed as `validated`, `promising`,
  `rejected`, `decaying`. Rejected findings are *kept*, not deleted: knowing
  what does not work is knowledge.
- **`performanceBaselines`** — what "normal" looks like for this profile, per
  metric and per comparison scope.
- **`activeExperimentIds`** — what is currently in flight.
- **`winnerPatterns` / `failurePatterns`** — recurring feature combinations
  associated with over- and under-performance.
- **`monetizationContext`** — active offers, conversion goal, revenue tracking.
- **`version`** + timestamps — brains evolve; schema migration must be possible.

The Profile Brain is **not** a prompt and **not** a cache. It is the profile's
accumulated scientific record.

---

## 7. Experiment Model

An `Experiment` is one deliberate, described publish whose purpose is to
produce evidence.

It has four parts:

1. **Context** — `profileId`, `platform`, `niche`, `subNiche`,
   `audienceSegmentId`, `objective`.
2. **Content DNA** — the structured description of *what was made*: topic,
   subtopic, hook family, format, tone, length class, emotional driver,
   controversy level, CTA type. This is what makes results comparable across
   posts.
3. **Design** — `hypothesisId`, `variant`, `pairId`, `controlVariable`,
   `testVariables`. `pairId` links A/B counterparts so they can be compared
   directly instead of against a noisy average.
4. **Execution & Results** — `scheduledAt`, `publishedAt`, `creatorOsPostId`,
   and an optional `ExperimentResult`.

Content DNA is the reason Kairos can learn at all. Without it, a post is an
undifferentiated event; with it, a post is a data point with features.

---

## 8. Measurement Hierarchy

Metrics are grouped into tiers that classify *what kind of signal* they are,
from cheap-and-noisy to durable and commercial:

| Tier | Meaning | Example metrics |
| --- | --- | --- |
| **Attention** | Did anyone see it? | impressions, views |
| **Conversation** | Did anyone respond? | replies, comments |
| **Amplification** | Did anyone spread it? | reposts, shares |
| **Engagement Signal** | Did anyone show light interest? | likes, saves, bookmarks |
| **Growth** | Did the account grow? | profile visits, followers gained |
| **Intent** | Did anyone want more? | clicks, DMs/inquiries (where measurable), product-page visits (where measurable) |
| **Conversion** | Did anyone act? | leads, sales/purchases |
| **Customer Value** | Did it produce durable value? | revenue, repeat purchases, retention, lifetime value |

**Tier is not a ranking of evidentiary strength.** A metric is not "stronger
evidence" simply because it sits deeper in this table. Evidence quality
depends on whether the measured outcome matches:

- the hypothesis,
- the dependent variable,
- the profile's objective.

If the hypothesis is *"Question hooks increase replies,"* reply data is
directly relevant evidence. Sales data is not automatically stronger evidence
for that question — it answers a different one. If the hypothesis is
*"Question hooks increase purchases,"* replies alone are insufficient; that
claim needs purchase data. Business-depth metrics answer different questions
than attention-tier metrics; they are not automatically scientifically
superior to them.

Deeper-funnel metrics such as `lifetimeValue`, where they exist, are
attributed/modelled values, not something an ordinary CreatorOS post-analytics
pull can populate on its own — they require a later attribution model.

**Not every platform exposes every metric.** Every field on `ExperimentResult`
is therefore optional, and platform-native metrics that mean different things
are kept as *separate* fields — `impressions` vs. `views`, `replies` vs.
`comments`, `reposts` vs. `shares`, `saves` vs. `bookmarks` — collapsing any
of these pairs would destroy the record of what was actually returned.

---

## 9. Baselines

You cannot call a post a winner without knowing what normal is.

`PerformanceBaseline` captures, for one profile and one metric, the central
tendency and spread over a time window, **within a comparison scope**:

- all recent posts
- a specific hook family
- a specific content format
- a specific objective
- a specific audience segment

Median is required; mean and standard deviation are optional, because a small
sample can support a median long before it supports a meaningful standard
deviation. `sampleSize` and `window` are mandatory so that any consumer can
judge whether the baseline deserves trust.

Milestone 1 defines the model. **Baseline calculation is not implemented.**

---

## 10. Winner / Failure Detection

A winner is not "a post that did well." A winner is **a post that beat its own
profile's baseline, within its comparison scope, by an effect size large enough
to matter, on a metric that serves the profile's objective.**

Failure is defined symmetrically. Both feed `Pattern` records
(`winnerPatterns`, `failurePatterns`) that describe recurring feature
combinations — e.g. *"contrarian hook + short text + reply CTA"* — with
`featureTags`, `confidence`, `sampleSize` and `lastObservedAt`.

Milestone 1 defines `Pattern`. **Detection is not implemented.**

---

## 11. Hypotheses

A `Hypothesis` is a testable claim, not an opinion. It names:

- the **independent variable** being manipulated,
- the **dependent metric** expected to move,
- the **control variables** held steady,
- the **scope** it claims to apply to.

It accumulates `supportingExperimentIds` and `contradictingExperimentIds` — both
lists, always. A hypothesis that only tracks its supporters is a belief system,
not science.

Statuses: `proposed` → `testing` → `supported` | `rejected` | `inconclusive`.

`inconclusive` is a real, valuable outcome and is deliberately distinct from
`rejected`.

---

## 12. Findings

A `Finding` is what survives testing: a statement plus the evidence that earns
it. It carries `scope`, `sampleSize`, `confidence`, optional `effectSize`,
`status`, and the `sourceExperimentIds` it came from.

Statuses: `promising` → `validated`, or `rejected`, or `decaying`.

Findings are **scoped, not universal**. The same statement can be `validated`
at profile scope and `rejected` at platform scope, and both records are
correct.

Findings can also carry `accountStage` — advice that works for a cold-start
account frequently fails for an established one.

---

## 13. Confidence and Evidence

Confidence is a normalized `0..1` value used consistently across
`WeightedInsight`, `StrategyPrinciple`, `Hypothesis`, `Finding` and `Pattern`.

Confidence is meaningless alone. It is always read together with:

- **`sampleSize`** — how much evidence,
- **`scope`** — what the evidence covers,
- **`sourceType`** — where it came from,
- **`effectSize`** — how much it actually mattered,
- **`lastValidatedAt`** — how stale it is.

`EffectSize` is deliberately **not** a bare number. A bare `0.31` is ambiguous.
The model records the `metric`, and `absoluteChange` and/or `relativeChange`
with an optional `unit` — so `{ metric: 'replies', relativeChange: 0.31 }`
unambiguously means *"about +31% replies."*

---

## 14. Strategy Decay and Revalidation

Social platforms change. Algorithms change. Audiences tire of formats. A
finding that was true six months ago may be false today, and nothing in the
data will announce it.

Kairos therefore treats knowledge as **perishable**:

- `decaying` is a first-class status on both `Finding` and `StrategyPrinciple`.
- `lastValidatedAt` exists on both, so age is always computable.
- `WeightedInsight.lastObservedAt` does the same job for softer knowledge.
- Rejected and decaying items are **retained**, never deleted — re-testing a
  decayed finding is cheaper than rediscovering it from scratch.

Revalidation is a scheduled re-test, not a one-way ratchet. Milestone 1 makes
decay *representable*. The revalidation scheduler comes later.

---

## 15. Profile Onboarding Architecture

Every social profile will eventually go through onboarding. Onboarding supplies
the **inputs**; Kairos supplies the **intelligence about how to operate them**.

Onboarding-supplied inputs:

platform · CreatorOS account ID · niche · sub-niche · audience · audience
segments · brand identity · voice · objectives · offers · conversion goals ·
posting capacity · experiment mode

These map onto `SocialProfile` — `identity`, `market`, `audience`,
`objectives`, `strategy`, `monetization` — and nothing about them is
hard-coded in Kairos Core. Adding a new niche, a new audience segment, or a new
offer is **data entry**, not a code change.

**Milestone 1 does not modify onboarding.** The existing interview
(`src/onboarding/`) is untouched. Milestone 3 added the mapping adapter
(`src/intelligence/onboarding/`) from onboarding answers to `SocialProfile`,
without touching that interview.

---

## 16. Audience Brain

Milestone 4. Gives Kairos a formal model for learning who actually responds
to a profile and how different audience segments behave — domain types,
storage and deterministic aggregation only. No AI classification, no
platform ingestion, no Science Engine, no Adaptive Strategy: those remain
later milestones.

### Declared Audience vs. Observed Audience

Milestone 3 established the **declared audience**: `SocialProfile.audience`,
what the profile owner believes their audience is, captured at onboarding.

Milestone 4 introduces the **observed audience**: what permitted behavioral
evidence indicates. The two live in structurally separate places and **must
never overwrite one another** — `SocialProfile.audience` is written only by
onboarding; everything below is written only by audience-evidence code, and
`ProfileBrain.audienceIntelligence` never embeds or duplicates the declared
side. This lets Kairos eventually ask: are we attracting the people we
intended to attract? Which segments engage, click, convert, or generate
revenue? Which segments talk a lot but never buy? Are new segments emerging
that nobody declared?

The future flow this milestone lays the foundation for:

```
Content / Interaction
        ↓
Audience Signal
        ↓
Segment Classification
        ↓
Aggregated Segment
        ↓
Content Response
        ↓
Business Outcome
        ↓
Segment Finding
        ↓
Updated Audience Intelligence
```

Milestone 4 builds the representation and the deterministic aggregation this
flow needs. It does not build the classification step — that requires
judgment Kairos does not yet have a validated way to automate.

### Audience Signals

`AudienceSignal` (`src/intelligence/audience/types.ts`) is the atom of
observed evidence — one raw, timestamped, marketing-relevant read: a
`source` (comment, reply, DM, profile context, click, lead, purchase,
survey, manual, other), a `signalType` (problem, goal, question, objection,
topic/content interest, experience level, intent, conversion, language
pattern, engagement, other), optional links to the content, experiment or
CreatorOS interaction it came from, and an optional `segmentId`.

A signal with no `segmentId` is **unclassified**, a first-class, permanent
state — not a placeholder waiting to be filled. Forcing every signal into an
existing segment would manufacture confirmation bias, so Kairos does not do
it. `classificationHistory` preserves any prior classification a signal
carried, so a later reclassification never erases an earlier read: original
signal → previous classification → current classification stays traceable
without a full event-sourcing framework.

### Observed Segments

`ObservedAudienceSegment` is the current segment model derived from
evidence — a `SegmentStatus` lifecycle (`emerging` → `active` →
`established`, or `declining` → `archived`, deliberately its own vocabulary,
not `HypothesisStatus` or `FindingStatus`), `firstObservedAt`/
`lastObservedAt`, a `signalCount`, and soft-knowledge buckets
(`characteristics`, `problems`, `goals`, `objections`, `topics`,
`languagePatterns`) as `WeightedInsight[]`, the same discipline
`NicheIntelligence` uses.

An observed segment can exist with **no declared counterpart at all** —
`matchedDeclaredSegmentId` is an optional, explicit, human/deterministic
link, never inferred by semantic matching. This is the segment-discovery
safeguard: Kairos must be able to conclude "I thought there were three
audience segments, but the evidence suggests a fourth," and declared
onboarding segments are never the only allowed segment identities.

`memberEstimate` is optional and only ever set when there is a defensible
basis for it — Kairos does not invent audience-size numbers.

### Segment Findings

`SegmentFinding` is a learned, audience-scoped conclusion: a `statement`
plus the evidence that earns it (`supportingSignalIds`,
`supportingExperimentIds`, `contradictingSignalIds` — both supporting and
contradicting always tracked, the same discipline `Hypothesis` uses), scoped
to one `profileId` and one `segmentId`. Its `SegmentFindingStatus`
(`promising` / `supported` / `contradicted` / `decaying`) is deliberately
**not** `FindingStatus` — a `SegmentFinding` is never automatically
equivalent to a globally validated Kairos `Finding`; promoting an
audience-specific conclusion to global truth, if it ever happens, is an
explicit Science Engine decision for a later milestone.

### Segment Performance

`SegmentPerformance` is a snapshot of one segment's aggregated numbers
across the Milestone 1 measurement hierarchy — `SegmentMetricTotal[]` reuses
`PerformanceMetric` rather than a second metric system, with an optional
`shareOfProfileTotal` per metric. This is what eventually lets Kairos tell
an **engagement audience** apart from a **buyer audience**:

```
Segment A — 52% of replies, 18% of clicks, 8% of sales   (talks, doesn't buy)
Segment B — 21% of replies, 43% of clicks, 61% of sales  (buys, doesn't talk)
```

Snapshots are append-only by their own `id`, the same discipline as
`ExperimentObservation`: a recalculation never destroys an earlier read of
what a segment's numbers were at the time.

### Declared vs. Observed Comparison

`DeclaredAudienceComparison` names four states — `aligned`,
`partially_aligned`, `divergent`, `insufficient_evidence` — but Milestone 4
ships no semantic-matching capability between a declared audience
description and observed segment characteristics. Its deterministic helper
(`compareDeclaredToObserved`) therefore **always evaluates to
`insufficient_evidence` today**; the other three states exist in the type
only for a future milestone that adds real declared-vs-observed matching.
Every new profile starts, and stays, at `insufficient_evidence` until that
milestone exists. Kairos does not pretend to know alignment it cannot
currently compute.

### Audience Intelligence — the materialized summary

`ProfileBrain.audienceIntelligence` gained, in Milestone 4, references and
counts into the stores above — `observedSegmentIds`, `emergingSegmentIds`,
`segmentFindingIds`, `totalSignalCount`, `unclassifiedSignalCount`,
`declaredVsObserved` — not embedded copies. The full objects live in their
own stores; this is a fast-read summary for strategy code, kept current by
whatever process last saved the brain.

### Privacy / Ethics Boundary

Every audience-evidence type is scoped to **marketing-relevant expressed or
behavioral signals**: a stated problem, a stated goal, a question, an
objection, a topic of interest, an experience level, an intent or conversion
action, a vocabulary pattern, an engagement action. None of these types
carry a field for race/ethnicity, religion, sexual orientation, medical
conditions, political affiliation, criminal history, or any other sensitive
personal attribute, and none should ever gain one without a separate,
explicit, lawfully-reviewed product decision. There is no per-individual
profile type anywhere in this model — only aggregated, revisable segments.
Kairos models "people expressing problem X," never "person Y has trait Z."

**Observed behavior does not automatically prove identity or motivation.**
Audience segment conclusions remain probabilistic (`confidence`) and
revisable (the status lifecycles above) — never treated as settled fact.

### Source-of-Truth Rules

- **`SocialProfile.audience`** — the owner-declared audience hypothesis/configuration. Written only by onboarding.
- **`AudienceSignal` store** — raw observed behavioral evidence. Append-only by id; a reclassification updates `segmentId` on the same id without losing `classificationHistory`.
- **`ObservedAudienceSegment` store** — the current segment model derived from evidence. Upserted by id, allowed to evolve.
- **`SegmentFinding` store** — learned, audience-scoped conclusions. Upserted by id, evidence-linked, never auto-promoted to a global `Finding`.
- **`SegmentPerformance`** — append-only snapshots by id, never overwritten.
- **`ProfileBrain.audienceIntelligence`** — materialized summary/references for fast strategy reads. Never the source of truth for any of the above, and never permitted to duplicate or overwrite `SocialProfile.audience`.

No layer in this list silently overwrites another.

---

## 17. Strategy & Research Intelligence

Milestone 5. A formal, provenance-aware system for learning FROM outside
knowledge — marketers, agencies, courses, books, videos, communities,
research reports, observational datasets, platform documentation, CreatorOS
skills, internal strategy notes, and Kairos's own experiments — without ever
treating that knowledge as established truth.

### The core rule

**Outside knowledge may generate hypotheses. Outside knowledge does not
automatically become a validated Kairos `Finding`.** Social-media advice is
full of opinions presented as fact, survivor bias, correlations presented as
causation, platform-specific advice generalized universally, outdated
advice, niche-specific results treated as universal, and unreported
failures. Kairos's job is to keep these distinguishable, not to launder them
into certainty.

### The ladder — do not collapse these levels

```
SOMEONE SAYS IT
        ↓
CLAIM                          — StrategyClaim

DATA SHOWS AN ASSOCIATION
        ↓
OBSERVED ASSOCIATION           — ObservedAssociation (a kind of claim)

KAIROS DESIGNS A TEST
        ↓
HYPOTHESIS                     — Hypothesis (science/types.ts)

KAIROS RUNS CONTROLLED EVIDENCE
        ↓
EXPERIMENT                     — Experiment (science/types.ts)

EVIDENCE ACCUMULATES
        ↓
FINDING                        — Finding (science/types.ts)
```

Someone saying it is not data showing an association. Data showing an
association is not a designed test. A designed test is not yet evidence. A
single experiment is not yet an accumulated finding. Nothing in this
milestone skips a rung.

### The knowledge pipeline

```
ResearchSource → StrategyClaim → StrategyPrinciple → possible Hypothesis
→ future Experiment → Finding
```

- **`ResearchSource`** — where information came from: a `ResearchSourceType`
  (`creator`, `marketer`, `agency`, `course`, `book`, `video`, `community`,
  `research_report`, `observational_dataset`, `platform_documentation`,
  `creatoros_skill`, `internal_note`, `kairos_experiment`, `other`), title,
  author/publisher, URL, publish/access dates, and which platforms/niches it
  discusses. Never deleted when outdated — see Strategy Decay below.
- **`StrategyClaim`** — what that source asserted: "someone/something
  asserts X," always traceable to exactly one `sourceId` (no orphan claims).
  Carries a `ClaimType`, a `KnowledgeScope`, optional platform/niche/
  objective/account-stage context, an `AssertedEffect`, a `CausalStatus`, a
  `ClaimStatus` lifecycle, and — critically — `confidenceInExtraction`,
  which means *"how confident are we that we represented the source
  correctly,"* never *"how likely is the claim to be true."* Those two
  questions are kept structurally separate.
- **`StrategyPrinciple`** (`strategy/types.ts`) — the normalized candidate
  concept Kairos can reason about, potentially supported by many
  independent claims. Example: a marketer's advice, a CreatorOS skill, and
  related platform documentation about the same underlying idea normalize
  into one principle — *"relevant questions may increase conversation"* —
  which is not itself any of those three claims, and is not synonymous with
  any of them.
- **`Hypothesis`** / **`Finding`** (`science/types.ts`) — a testable claim
  designed for experimentation, and an evidence-backed conclusion from an
  actual Kairos experiment. Only these two carry Kairos's own scientific
  authority; nothing upstream of them does.

### Claim types

`playbook_claim` (advice from a marketer/course/agency/CreatorOS skill),
`platform_claim` (an official platform statement about capability or
behavior), `research_claim` (a finding from a report or study),
`observed_association` (a correlation in data, no causal proof — see
below), `experimental_claim` (produced from an experiment), `opinion`
(interpretation or belief), `heuristic` (a rule of thumb). **The category
alone implies nothing about causal status** — see Causal Status.

### Observed associations

"Creators with 500+ replies averaged 35.7% follower growth" is data. "Getting
500 replies causes 35.7% follower growth" is a different, much stronger
claim the first sentence does not support. `ObservedAssociation` keeps these
apart structurally: `variablesObserved`, `populationDescription`,
`sampleSize`, `timePeriod`, `effectOrAssociation`, `limitations`,
`confoundersKnown`, and `causalClaim` — typed as the literal `false`, not
`boolean`, so it is impossible to construct an `ObservedAssociation` that
asserts causation.

### Causal status

`not_applicable` · `unproven` · `correlational` · `experimental_support` ·
`causal_supported`. A source using causal language ("X causes Y") does not,
by itself, earn `causal_supported` — `deriveDefaultCausalStatus`
(`research/aggregate.ts`) never produces it, and ingestion validation
actively rejects a caller asserting `causal_supported` on anything but an
`experimental_claim`. Outside claims begin at `unproven` or `correlational`;
only Kairos's own experimental evidence can move a claim further.

### Claim status (not a scientific status)

`captured` → `reviewed` → `candidate` → `mapped_to_hypothesis`, or
`deprecated` / `rejected_as_source` / `superseded`. Deliberately not
`FindingStatus` or `StrategyPrincipleStatus` — nothing in this vocabulary
contains a "validated" state. A claim being `reviewed` means a human or
process looked at it, nothing more.

### Provenance and traceability

Every claim answers "where did this idea come from" by construction:
`sourceId` is required and validated against the `ResearchSource` store at
ingestion. `SourceLocator` (`page`/`timestamp`/`section`) and a short
`excerpt` (capped, attribution only) let a claim point precisely at where in
a source it came from — this milestone supports traceability, not storing
entire copyrighted books or courses as blobs.

### Conflicting advice

Two sources disagreeing — "post once daily" vs. "post 10 times daily" — are
both kept. Storage is never "latest claim wins": every claim is its own
record, upserted only by its own explicit id, so two independently sourced
claims are always two provenance records, even when their text looks
identical. `topicKey`, a caller-supplied, deterministically-matched string
(plain equality, no semantic matching), lets conflicting claims cluster
under a shared normalized topic before any `StrategyPrinciple` formally
exists to group them (`groupClaimsByTopicKey`, `research/aggregate.ts`).
Kairos does not decide which side is right here — that comes only through
experimentation.

### Scope — platform, niche, objective

A Threads claim never silently becomes an all-platforms claim; a personal
finance claim never silently becomes an all-niches claim; a claim with no
stated objective never silently becomes "works in general." `StrategyClaim`
preserves `platforms`, `niches` and `objectives` (`GrowthObjective`, reused
rather than a second vocabulary) exactly as observed, and unknown scope
stays unknown rather than being fabricated as broad or global. Global scope
is itself an explicit, deliberate `KnowledgeScope` value — never a default
assumed from absence.

### CreatorOS skills as an input

CreatorOS ships marketing skills. Kairos *consumes* them as a research
input — `sourceType: 'creatoros_skill'` — and never duplicates or alters
CreatorOS's own skill-delivery system. `ingestCreatorOsSkill`
(`research/ingest.ts`) takes only a skill's own metadata (name, description,
version) as plain strings; it does not read CreatorOS's skill files,
installation state, or update mechanism, and cannot write to them.

### Strategy decay

Advice decays the same way findings do (§14). `ResearchSource` carries
`publishedAt`, `accessedAt`, `lastReviewedAt`, `supersededBySourceId` and
`deprecatedAt` — outdated research is marked, never deleted, so Kairos
retains the historical record of what it used to rely on and why.
`identifyStaleSources` (`research/aggregate.ts`) is a pure function of an
explicit `now` and a max-age window — never the system clock read as a
side effect.

### Raw source vs. interpretation

Same lineage discipline as Milestone 2's raw-evidence rule: `ResearchSource`
is source metadata, `StrategyClaim` is the captured assertion,
`StrategyPrinciple` is the normalized interpretation. **Changing a
`StrategyPrinciple` must never rewrite the original `StrategyClaim`** — a
principle's `supportingClaimIds`/`contradictingClaimIds` reference claims by
id and are free to change as understanding evolves; the claim records
underneath stay exactly as captured.

### Deterministic ingestion, deterministic only

`ingestResearchSource`/`ingestStrategyClaim` (`research/ingest.ts`) are the
Milestone 5 entry points: validate, normalize (trim strings, normalize URLs,
validate dates/confidence, check platforms against the existing platform
matrix), persist through `IntelligenceStore`. No AI extraction, no web
crawler, no PDF or transcript parser — a caller already has structured data.
Those adapters are explicitly future-milestone work.

---

## 18. Measurement Ingestion & Attribution

Milestone 6. Closes the execution/measurement loop:

```
Kairos → CreatorOS execution → social platform → CreatorOS analytics
→ Kairos observation storage
```

**CreatorOS retrieves platform data. Kairos interprets and stores it.**
Kairos never re-implements platform analytics retrieval — it calls the
CreatorOS client's existing analytics methods and normalizes what comes
back.

### CreatorOS analytics, as they actually exist

Inspected before writing any code: `src/client/client.ts` exposes
`getAnalytics` (per-post, with per-platform breakdown, or a paginated
overview), `followerStats` (per-account growth over a date range),
`bestTimeToPost`, `dailyMetrics` (daily aggregate + per-platform
breakdown) and `postTimeline` — every one of them typed `Promise<unknown>`.
There is no committed CreatorOS analytics response schema anywhere in this
repository; `CreatePostBody` and `Post` (`src/client/types.ts`) both carry
an open index signature, and the one place a shape is informally relied on
(`src/onboarding/interview.ts` reading `followerStats()`) casts inline to
`{ accounts?: [{ platform, username, currentFollowers, growth,
growthPercentage }] }` rather than a committed type. Kairos's raw snapshot
below reflects that reality — an open record, not an invented schema.

### Raw snapshots

`CreatorOsMeasurementSnapshot` (`measurement/types.ts`) preserves exactly
what CreatorOS returned for one analytics pull — `rawMetrics` is an open
`Record<string, unknown>`, never forced into a fixed shape CreatorOS itself
doesn't guarantee. Never contains secrets or tokens. Keyed by a
deterministic id derived from `(creatorOsPostId, capturedAt)` when both are
known, so re-ingesting the same pull is idempotent rather than duplicated,
while a genuinely later measurement (a different `capturedAt`) always gets
its own id and coexists.

### Normalized observations

`PostMeasurement` maps a raw snapshot into the existing
`PerformanceMetric`/`ExperimentResult` vocabulary — no second metric
system. `mapCreatorOsPostAnalytics` (`measurement/mappers.ts`) looks each
metric up under a small table of candidate field-name aliases (camelCase
and snake_case both, mirroring the dual-naming convention CreatorOS itself
already uses for TikTok fields), and leaves a field absent — never
zeroed — when CreatorOS didn't return it. Platform-native pairs stay
distinct exactly as §8 requires: impressions ≠ views, replies ≠ comments,
reposts ≠ shares, saves ≠ bookmarks. `leads`, `sales`, `revenue` and
`followersGained` are never populated by this mapper — see Business
Outcomes below.

`experimentId` is optional: a post belonging to a Kairos `Experiment` is
linked by that id (never a fabricated one); ordinary, non-experimental
content is stored exactly the same way with it absent. Content DNA is
never duplicated onto a measurement — it stays on the `Experiment`, reached
through `experimentId`. Multiple measurement times for the same post (30
minutes, 2 hours, 24 hours, 72 hours, 7 days) all coexist: `PostMeasurement`
is append-preserving by its own id, exactly like `ExperimentObservation`
(Milestone 2) — deliberately not the same type, since `ExperimentObservation`
still requires an `experimentId` and stays exactly as Milestone 2 left it;
`PostMeasurement` is the general-purpose, profile-queryable counterpart this
milestone needs.

### Profile-level snapshots

`ProfileMeasurementSnapshot` holds account-level analytics — followers,
growth, daily aggregates — without forcing them into a fake post
`Experiment`. `followersCount` is a point-in-time absolute count (what
CreatorOS's `followerStats()` calls `currentFollowers`), kept separate from
`metrics` because it is a snapshot fact, not a window/event metric like the
rest of `PerformanceMetric`.

### Business outcomes vs. platform analytics

**CreatorOS tells Kairos what happened on the platform. First-party systems
tell Kairos what happened in the business. Kairos stores both, preserves
lineage, and analyzes them later.** `AttributionEvent` is that second,
separate evidence source: `link_click`, `lead`, `checkout`, `purchase`,
`refund`, `repeat_purchase`, `revenue`, `other`. Kairos never pretends a
platform analytics response proves revenue — `mapCreatorOsPostAnalytics`
structurally cannot produce `leads`/`sales`/`revenue`, and nothing in
ingestion creates an `AttributionEvent` from a `PostMeasurement`. A high
view count is attention evidence, not business evidence, until an actual
attribution event says otherwise.

### Tracking context and attribution uncertainty

`TrackingContext` (`utmSource`/`utmMedium`/`utmCampaign`/`utmContent` plus
`profileId`/`experimentId`/`offerId`) is plain data for the Platform →
Profile → Experiment/Post → Offer → Conversion chain — no URL shortener, no
checkout logic. Not every conversion can be perfectly tied to one post, so
`AttributionMethod` (`direct` / `utm` / `last_touch` / `first_touch` /
`manual` / `modelled` / `unknown`) represents that honestly instead of
assuming `direct` by default — ingestion defaults an unspecified method to
`unknown`, never `direct`. `modelled` exists as a vocabulary slot for a
future milestone; no multi-touch modelling exists yet.

### Audience-segment linkage

`AttributionEvent.audienceSegmentId` is optional and never inferred without
evidence — set only when a business event is actually known to belong to an
`ObservedAudienceSegment` (Milestone 4). This is what eventually lets Kairos
compare segments by business outcome as well as engagement: a segment with
high replies but low purchases is a different segment from one with fewer
replies but more purchases, and Kairos needs both signals to tell them
apart.

### Evidence source tagging

Every measurement/attribution record carries `evidenceSource`
(`creatoros_platform` / `first_party` / `manual` / `other`) — the field a
future Science Engine needs to distinguish platform engagement evidence
from business outcome evidence at a glance, without inspecting which store
a record came from.

### Raw-vs-normalized lineage

Same discipline as every prior milestone's raw-evidence rule:
`sourceSnapshotId` on `PostMeasurement`/`ProfileMeasurementSnapshot` points
back at the `CreatorOsMeasurementSnapshot` it was normalized from.
Normalizing never rewrites or discards the raw snapshot — no orphan
normalized analytics exist while raw evidence is available to trace them to.

### Baseline-input readiness (not baseline calculation)

`PostMeasurement`/`ProfileMeasurementSnapshot`/`AttributionEvent` are all
queryable by profile, by experiment (where linked) and by date range —
content-format and objective queries reach through the linked `Experiment`
rather than duplicating those fields onto every measurement. Nothing in
Milestone 6 calculates a `PerformanceBaseline` — that stays Milestone 7's
Science Engine work.

### Deterministic ingestion, deterministic only

`ingestMeasurementSnapshot` / `ingestProfileMeasurementSnapshot` /
`ingestAttributionEvent` (`measurement/ingest.ts`) validate (profile
existence, `creatorOsAccountId` consistency, experiment/profile
consistency, non-negative counts, valid currency/timestamps, attribution
value semantics, supported platforms — `measurement/validate.ts`),
normalize, and persist through `IntelligenceStore`. No LLM, no inferred
metrics, no statistical analysis, no automatic strategy change — this
milestone stops at "here is what was observed," never "here is what it
means."

---

## 19. Science Engine

Milestone 7. Turns stored evidence into defensible, scoped, revisable
conclusions — deterministically, with no LLM anywhere in the path.

Kairos must never reduce analysis to *"the post got a lot of views."* The
scientific question is: **compared with what relevant baseline or control
did this result differ, by how much, for which metric, under what scope,
with how much evidence, and what conclusion is justified?**

### The evidence ladder — never skip a rung

```
RAW OBSERVATION          — AnalyticalObservation (read model)
        ↓
COMPARISON               — ComparisonResult
        ↓
REPEATED EVIDENCE        — HypothesisEvidence, accumulated
        ↓
HYPOTHESIS EVALUATION    — HypothesisEvaluation
        ↓
SCOPED FINDING           — Finding
        ↓
REVALIDATION             — FindingFreshness / RevalidationCandidate
```

Nothing jumps from observation straight to finding. A single breakout post
is one comparison, not a validated finding.

### The unified analytical read model

Milestone 6 deliberately left `PostMeasurement` and `ExperimentObservation`
as parallel stored types. `science/readModel.ts` projects both — plus
`AttributionEvent`, where it legitimately evidences a business metric —
into `AnalyticalObservation` rows on demand. These are **pure projections**:
the source records are never mutated, re-saved or reconciled, and every row
carries `sourceType` + `sourceRecordId` so any conclusion traces back to
exact stored evidence. A metric absent from a stored result produces **no
row at all** — missing never becomes a zero that a baseline would average
in.

### Baselines and outlier robustness

`calculateProfileBaseline` computes `sampleSize`, `median`, `mean`,
`standardDeviation` and `window` for one profile/metric/scope. **Median is
the primary central tendency, deliberately.** Social results are
heavy-tailed: one viral post drags the mean far from anything typical while
barely moving the median. Standard deviation is `undefined` below two
values — reporting `0` would falsely imply certainty. Below
`policy.minimumBaselineSample` the baseline is returned as `null` rather
than as a falsely precise number.

### Science policy — thresholds are choices, not laws

`SciencePolicy` makes every threshold configurable:
`minimumBaselineSample`, `minimumHypothesisSample`, `minimumPairedSample`,
`breakoutThreshold`, `failureThreshold`, `minimumConfidenceForFinding`,
`revalidationWindowDays`, `decayWindowDays`. `DEFAULT_SCIENCE_POLICY`
supplies conservative starting values.

**These defaults are operational starting points, not scientific laws.**
"20 posts is enough" is not a fact about the universe; it is a policy choice
that should be revisited per profile, per platform, and as evidence
accumulates.

### Objective → metric mapping

`DEFAULT_OBJECTIVE_METRICS` is an explicit, inspectable, overrideable table
rather than buried if/else:

| Objective | Metrics |
| --- | --- |
| reach | impressions, views |
| conversation | replies, comments |
| amplification | reposts, shares |
| followers | followersGained |
| traffic | clicks, profileVisits |
| lead | leads |
| sale | sales |
| revenue | revenue |
| retention | revenue *(no retention metric exists in `PerformanceMetric` yet — the proxy is named explicitly rather than silently invented)* |

This is what stops "lots of views" counting as success for a revenue
objective. Per §8: deeper-funnel data is **not** universally stronger
evidence — the relevant metric is the one matching the hypothesis, the
dependent variable and the objective. Revenue evidence answers a revenue
question; reply evidence answers a conversation question.

### Comparison and winner/failure detection

`ComparisonResult` records observed value, baseline median, absolute and
relative difference, `EffectSize`, direction (`above` / `below` /
`near_baseline`) and its own limitations. **Direction is not a verdict** —
`above` baseline is not automatically a winner.

`assessExperimentOutcome` produces `winner` / `failure` / `neutral` /
`insufficient_evidence`, and requires the metric to be one the experiment's
registered objective maps to, an adequate baseline sample, and an effect
past `breakoutThreshold`/`failureThreshold`. The baseline deliberately
excludes the experiment's own observations — a result is compared against
what normal looks like *without* it.

### No p-hacking / no metric switching

An experiment registers its objective up front, and its verdict is decided
**solely** on the metrics that objective maps to. If an experiment testing
clicks sees replies explode while clicks stay flat, the conclusion is that
the click hypothesis is **not supported**. The reply movement appears under
`exploratoryComparisons` — visible, useful for generating future
hypotheses, and structurally incapable of overturning the registered
result. Kairos never retroactively declares "the post won because replies
increased."

### Missing is not zero

If the dependent metric was never reported, the verdict is
`insufficient_evidence` — never `failure`. An unavailable platform metric
is a gap in evidence, not evidence of poor performance.

### Paired experiments

`analyzePairedExperiments` compares arms sharing a `pairId`, with arms
sorted deterministically by variant label. Every single-pair result carries
the `single_pair` limitation, and a topic mismatch between arms surfaces as
`insufficient_controls`. `policy.minimumPairedSample` governs when paired
evidence may support a finding — one pair is evidence, never proof.

### Hypothesis evidence and evaluation

`HypothesisEvidence` records one traceable piece of support or
contradiction — direction, metric, effect size, `supports`, and the source
ids it came from — so a hypothesis is never a bare list of experiment ids
with no explanation of why each one counted.

`evaluateHypothesis` returns `proposed` / `testing` / `supported` /
`rejected` / `inconclusive`. **`inconclusive` is a first-class outcome**,
not a failure to decide: it is the honest answer when evidence is plentiful
but conflicting, and it is deliberately distinct from `rejected` ("we
tested it and it is false"). Binary supported/rejected decisions are never
forced.

### Contradictory evidence is permanent

If 12 experiments support a hypothesis and 5 contradict it, Kairos knows
both. Contradicting `HypothesisEvidence` records are **never deleted** when
confidence later rises, and confidence is explicitly able to fall.

### Operational confidence

`computeOperationalConfidence` returns a normalized 0..1 score from three
documented, deterministic terms: evidence volume (saturating), directional
consistency (evidence split 6/5 contributes nothing however plentiful), and
a small effect-magnitude bonus.

This is an **operational confidence score, not a statistical probability**.
Kairos does not implement Bayesian inference, so it does not claim to.

### Effect size

Reuses the existing `EffectSize`. Zero baselines are handled safely:
`relativeChange` returns `undefined` rather than `Infinity`/`NaN`, and the
field is omitted entirely rather than carrying a non-finite value that
would poison downstream threshold comparisons.

### Finding emission and scope discipline

`emitFinding` creates or updates a `Finding` **only** when policy
thresholds are met, returning `null` otherwise rather than emitting a weak
conclusion. Findings begin `promising` and reach `validated` only past
`minimumConfidenceForFinding` — one breakout post never validates anything.

**Scope defaults to the narrowest justified level: the profile.** A broader
scope must be passed explicitly by a caller that actually has cross-profile
evidence; a single profile's result can never widen itself into a niche,
platform or global claim. Segment-specific evidence stays profile+segment
scoped. Cross-profile synthesis is a later milestone the model is built to
accommodate, not something this engine performs.

Wording is composed deterministically and conservatively — *"Question-hook
experiments were associated with higher reply rate for this profile under
the tested conditions"*, never *"Questions always boost Threads reach."* No
LLM is involved in any statement.

### Observed-association safeguard

An `ObservedAssociation` (§17) may generate or support a hypothesis
**candidate**, but can never itself justify a causal `Finding` — causal
support requires controlled experimental evidence.
`assertNotCausalFromObservation` enforces this at the service layer rather
than leaving it to convention. Analysis never mutates the underlying
`StrategyClaim`.

### Decay and revalidation

`assessFindingFreshness` returns `current` / `due_for_revalidation` /
`decaying` from `lastValidatedAt` against the policy windows.
`identifyRevalidationCandidates` returns ids and reasons only — **no posts
are scheduled and no strategy is changed**; the Battle Engine consumes this
later. Nothing is ever deleted: rejected and decaying findings are retained
as knowledge.

### Limitations are never hidden

Every analysis can express `AnalysisLimitation`s: `small_sample`,
`missing_metric`, `no_baseline`, `unmatched_comparison`,
`mixed_account_stages`, `large_variance`, `unknown_attribution`,
`insufficient_controls`, `single_pair`, `platform_change`. An analysis that
cannot be trusted says so in its own output.

### Science report

`ScienceReport` is a machine-readable analysis result — subject, objective,
metric, baseline, comparisons, evidence summary, conservative conclusion,
verdict, confidence, limitations and full lineage — suitable for a future
dashboard. It is not UI, and this milestone builds none.

---

## 20. Adaptive Strategy Engine

Milestone 8. The layer that turns evidence into a decision.

```
SCIENCE ENGINE      "What did the evidence show?"
        ↓
ADAPTIVE STRATEGY   "What should this profile do next?"
        ↓
CREATOROS           "Execute the approved action."
```

The question it answers, for one profile at a time: *given this objective,
this platform, this niche, this audience, this account stage, this evidence
and these active experiments — what is the most justified next action?*

Everything it produces is a **proposal**. Recommendations are always created
`proposed`; nothing is auto-approved, nothing is published, no content is
written, and no LLM is involved.

### Objective-first optimization

A recommendation is scored against the profile's **primary objective**, not
against engagement in general. A pattern that produces huge replies is
valuable to a `conversation` profile and largely beside the point for a
`revenue` one — `computePriorityScore` drops the objective term from 0.4 to
0.05 on a mismatch, so mismatched evidence surfaces (with its reasoning) but
does not lead. Kairos does not optimize universally for engagement.

### Exploration vs. exploitation

`StrategyPolicy.explorationRatio` maps the profile's existing
`ExperimentMode` onto a split: `conservative` 0.2, `balanced` 0.35,
`discovery` 0.6. As with `SciencePolicy`, **these are configurable
operational choices, not scientific truths** — every field is overrideable.

### Strategy constraints

`deriveConstraints` reads binding limits off stored configuration —
never guesses:

- **posting_capacity** — the profile's own stated posts/day and posts/week.
- **brand_rule** — declared style constraints, topics to avoid, compliance rules.
- **active_experiment** — the protection that preserves experimental validity.
- **offer_availability** — no active offers means conversion tests cannot be proposed blindly.

**Active-experiment protection** is the important one: while a controlled
test is in flight, its `controlVariable` and `testVariables` are locked, so
Adaptive Strategy cannot recommend changing the very things the experiment
is measuring. Testing hook type must not come with a simultaneous
recommendation to change topic, CTA or format.

**Posting capacity** is respected rather than exceeded: a profile that says
2 posts/day is never handed a 10-posts/day recommendation as routine advice.
Exceeding capacity is only representable as an explicit experiment that
requires a capacity change.

### Content allocation

`recommendContentAllocation` rebalances content pillars under three
deliberate protections:

1. No pillar moves more than `maximumAllocationShiftPerPlan` in one plan —
   strategy should not whipsaw.
2. Evidence below `thinEvidenceSampleThreshold` is damped to half effect —
   a single good post must not rewrite the content mix.
3. No pillar falls below `minimumPillarAllocation` — a pillar starved to
   zero can never generate the evidence that would rehabilitate it, which
   would make the decision self-fulfilling.

Every allocation carries its `previousShare` and a reason, so a change is
never silent. **No content is generated** — the engine decides that a
quantified-outcome hook should be tested, never what the hook says.

### Winning pattern use

`repeat_validated_pattern` is offered only for a `validated` finding at or
above `minimumConfidenceToExploit`. A finding marked validated but carrying
low confidence yields `collect_more_evidence` instead. Nothing is repeated
forever: freshness, sample size, confidence and decay are all consulted, and
a stale finding routes to revalidation instead of reuse.

### Failure memory

Rejected findings are memory, not noise. `countPatternFailures` counts how
often a pattern has been rejected for this profile; past
`failureMemoryThreshold` the action becomes `deprioritize_pattern` with a
penalty applied to its priority score. A repeatedly-failed approach does not
keep resurfacing as a fresh idea — but it remains reachable through
deliberate revalidation when conditions change.

### Revalidation

Stale and decaying findings route through the Science Engine's own
`identifyRevalidationCandidates`; Adaptive Strategy converts them into
`revalidate_finding` recommendations rather than re-implementing decay
assessment.

### Information gain

Some uncertainty is worth resolving and some is not.
`computeInformationGain` multiplies two operational terms:

- **uncertainty** — peaks at maximum ambiguity (confidence 0.5 → 1.0; both
  0.0 and 1.0 → 0, because there is nothing left to learn at either extreme).
- **objectiveRelevance** — 1.0 when the dependent metric serves the
  profile's objective, 0.2 when it does not.

Two questions can both have weak evidence; the one whose answer would
actually change what this profile does ranks higher. This is an operational,
explainable score — deliberately not an information-theoretic quantity.

### Recommendation basis — "why does Kairos recommend this?"

Every recommendation carries a `RecommendationBasis`: finding ids, segment
finding ids, hypothesis ids, experiment ids, strategy principle ids, claim
ids, audience segment ids, the constraints that shaped it, and a
deterministically-composed rationale. Every id points at a real stored
record. This is what makes the recommendation auditable — and what a future
Social Genome surface reads instead of a generated explanation.

### Unknowns

**UNKNOWN remains a valid answer.** When evidence is insufficient the engine
recommends `run_experiment`, `collect_more_evidence` or `do_nothing_yet` —
it never fabricates "this is what works." A plan lists its `unknowns`
explicitly (what drives the objective, whether any validated pattern exists,
who actually responds), because a plan that states what it cannot answer is
more useful than one that quietly fills the gaps.

### Research intelligence integration

A `StrategyPrinciple` (§17) can seed a **candidate experiment** and nothing
more. A playbook claim can only ever produce `run_experiment`, never
`repeat_validated_pattern`, and only when the profile has no first-party
evidence of its own on the subject — **first-party evidence always outranks
imported advice**. Milestone 10's Intelligence Waterfall will generalize
this precedence.

### Human approval

The architecture keeps recommendation and execution separate:

```
recommend  →  human approves  →  CreatorOS executes later
```

Statuses run `proposed` → `approved` → `active` → `completed`, with
`rejected` / `expired` / `superseded` available. The engine only ever
creates `proposed`; `setRecommendationStatus` is the human seam.

### Strategy versioning

`AdaptiveStrategyPlan` is a point-in-time snapshot, explicitly not permanent
truth. A new plan carries `supersedesPlanId` and an incremented `version`;
the earlier plan is retained, so the reasoning behind a superseded decision
survives the decision changing. Plans also record `policyVersion`, so an old
plan stays interpretable after the ruleset moves on.

### What this layer never does

It does not recompute baselines, effect sizes, confidence, hypothesis
evaluation, finding emission or decay assessment. Those have exactly one
owner — the Science Engine — and Adaptive Strategy reads them.

---

## 21. Storage Architecture

Kairos already has a storage port at `src/storage/store.ts` with a JSONL
adapter (`src/storage/jsonlStore.ts`), designed so a Postgres adapter can
replace it without touching callers.

Intelligence storage follows the **same discipline**, built in Milestone 2
(`src/intelligence/storage/store.ts` + `jsonlIntelligenceStore.ts`) and
extended by Milestone 4 (audience stores), Milestone 5 (research stores),
Milestone 6 (measurement/attribution stores), Milestone 7 (hypothesis
evidence) and Milestone 8 (recommendations and strategy plans):

- an intelligence port defined as an interface (`IntelligenceStore`),
- JSONL-on-disk as the first adapter (append-only; mutable knowledge is
  latest-line-wins per `id`, raw evidence — `ExperimentObservation`,
  `AudienceSignal`, `SegmentPerformance`, `CreatorOsMeasurementSnapshot`,
  `PostMeasurement`, `ProfileMeasurementSnapshot`, `HypothesisEvidence` —
  is never collapsed),
- a durable adapter later, without changing callers.

`ComparisonResult` and `ScienceReport` are deliberately **not** persisted:
both are derived calculations, recomputable at any time from the
observations and baselines they came from. Only the comparison ids
referenced by a stored `HypothesisEvidence` record matter for audit, and
those travel on the evidence record itself.

`StrategyRecommendation` and `AdaptiveStrategyPlan` **are** persisted, because
they are decisions rather than calculations: a plan records what Kairos
recommended, on what evidence, under which policy version, at a point in
time. Plans are versioned rather than overwritten — `supersedesPlanId`
chains each plan to the one it replaced, and the earlier plan is retained.

All intelligence domain types therefore carry a stable `id` (or, for
`PerformanceBaseline`, a stable derived key) and are plain, serializable,
JSON-round-trippable data. No classes, no methods, no non-serializable
fields.

**Milestone 1 shipped types only. Milestone 2 added the store. Milestone 3
added the onboarding adapter. Milestone 4 added the audience stores.
Milestone 5 added the research stores. Milestone 6 added the
measurement/attribution stores. Milestone 7 added the hypothesis-evidence
store. Milestone 8 added the recommendation and strategy-plan stores.
Milestone 9 added the battle stores. Milestone 10 added the
transfer-assessment and peer-cohort stores. Milestone 11 added the
social-prescription store. Milestone 12 added the genome pattern,
evidence, node, edge and snapshot stores.**

---

## 22. Battle Engine

Milestone 9. A controlled experimental competition system — the machinery
behind Social Money Lab.

**A Battle is not a leaderboard.** It is a structured evidence-generation
environment in which many profiles compete under registered experimental
protocols while Kairos measures growth, engagement, reach, traffic, leads,
revenue, experimental outcomes, prediction accuracy and efficiency.

The Battle Engine **orchestrates**; it does not evaluate. Statistical
conclusions come from the Science Engine (§19), next actions from Adaptive
Strategy (§20), measurements from Measurement Ingestion (§18). This module
adds competition structure, scoring, standings, predictions and provenance —
and nothing else.

### Nothing is hard-coded to a season design

Twenty accounts across Threads and X is one *configuration* of these types,
not a shape baked into them. A `BattleCompetitor` carries a
`competitorType` (`platform`, `strategy`, `format`, `frequency`,
`creator_type`, `content_type`, `custom`), and `platform` is optional — so
"AI vs Human", "Short vs Long" and "1/day vs 5/day" use the same types with
no changes. Divisions, cohorts and matched pairs are all data.

### Registered protocols

`BattleProtocol` is explicit and versioned, and is **registered before
results are known**. It specifies controlled variables, treatment variables,
allowed and prohibited strategy changes, measurement window, warm-up period,
minimum sample expectation, objectives, primary metrics, exploratory
metrics, scoring policy, outlier/missing-data/attribution policies and the
operating mode.

Retroactive scoring changes are how a competition stops being evidence, so
the season stores `protocolVersion` alongside the protocol reference — a
historical season stays reproducible against the exact rules that governed
it.

### Pre-registration locks the primary metric

`BattleExperimentRegistration` locks `primaryMetric` at registration.
`registerExperiment` **refuses** a re-registration that changes it, while
allowing every other field to be amended. This is the structural defence
against declaring victory on whichever metric happened to move — the same
no-p-hacking rule §19 applies within a single experiment, enforced here
across a competition.

### Lab Mode vs Growth Mode

These are **not equivalent modes**:

- **Lab mode** — registered experimental controls dominate. A protocol's
  controlled and treatment variables are locked, and any Adaptive Strategy
  recommendation touching them is **rejected with a reason, even when it is
  a sound recommendation**. Evidence quality outranks immediate
  optimization.
- **Growth mode** — Adaptive Strategy optimizes normally within ordinary
  profile constraints.

`evaluateRecommendationAgainstProtocol` returns a `ConstraintDecision`
carrying the verdict, the violated variables and a human-readable reason, so
a refusal is never opaque. `filterRecommendations` partitions a whole
recommendation set into accepted and rejected-with-reasons.

### Scoring is configuration, not a universal definition of "winner"

`BattleScoringModel` weights categories drawn from the measurement hierarchy
(§8) so a battle cannot invent a parallel metric vocabulary. A conversation
battle weights replies; a revenue battle weights conversion and customer
value. Both are legitimate.

**The vanity guard** is the protection that matters commercially:
`vanityGuardMaxShare` caps the combined weight share of attention,
engagement-signal and amplification categories. Without it a
revenue-objective battle can be won on impressions. When the guard fires,
the adjustment is surfaced as a limitation — never applied silently.

Two further protections: a category **no competitor reported** is skipped
rather than scored zero (missing is not zero), and a no-spread set
normalizes to 0.5 rather than 1.0, because when everyone scored the same
nobody won.

### Multiple winners, and no forced overall winner

`BattleCategoryResult` supports `winner` / `tie` / `insufficient_evidence` /
`inconclusive`, per category. Threads may win conversation while X wins
qualified traffic; no overall winner is required, and one is derived only
where the registered scoring model defines it. A lead inside
`minimumWinMargin` is reported `inconclusive` rather than ranked on noise.

### The leaderboard is never a scientific finding

This is the load-bearing separation. `BattleOutcome` holds the competition
verdict (`battleVerdict`) and the Science Engine's verdict
(`scienceVerdict`) as **separate fields**, plus an explicit
`leaderboardDivergesFromScience` flag.

A competitor can top the category on points while its evidence remains
scientifically `insufficient_evidence` — and that combination is a
legitimate, expected, publishable outcome that the model records rather than
smooths over. **Nothing in the Battle Engine writes to the Findings store.**
Winning a season produces no `Finding`; only the Science Engine does, on its
own thresholds.

### Prediction tracking

`BattlePrediction` registers a forecast **before** the outcome is known:
predicted competitor, metric, direction, confidence, evidence basis and
rationale.

Every predicted field is **write-once**. `resolvePrediction` fills in only
`result` / `resolvedAt` / `actualWinnerCompetitorId` / `resolutionNotes`,
copies all predicted fields forward untouched, and refuses to re-resolve an
already-resolved prediction. A forecast that can be edited after the fact
measures nothing. `inconclusive` predictions are excluded from the accuracy
denominator.

This is what will eventually let Social Money Lab publish **Kairos's own
forecasting accuracy** — a far stronger claim than any single season result.

### Standings

Derived views, computed on demand by season, division, platform, category or
objective. Raw measurements and Science Engine evidence beneath them are
never mutated. Every standing carries `evidenceCount`, `limitations` and an
operational `confidence` derived from evidence volume — not a statistical
probability.

### Efficiency and milestones

`perThousand` and `rate` compute revenue-per-1k, leads-per-1k and conversion
rates, returning `undefined` on a zero or missing denominator rather than
`Infinity`/`NaN`. Revenue is never inferred from engagement — business
totals come only from first-party `AttributionEvent` records.

`BattleMilestoneDefinition` / `BattleMilestoneAchievement` are generic:
"first 100 followers", "first sale", "first $100 revenue" are data, and
time-to-milestone is computed from the season start.

### Social Money Lab as an evidence-generation system

The Battle Engine is not only entertainment. **Social Money Lab is an
intentional evidence-generation system for Kairos**: controlled, publicly
documented competitions that produce reusable, properly scoped evidence.

The long-term flywheel this serves:

```
SOCIAL MONEY LAB          runs controlled experiments
        ↓
KAIROS SCIENCE ENGINE     evaluates the evidence
        ↓
SCOPED FINDINGS           enter the intelligence base
        ↓
INTELLIGENCE TRANSFER     decides whether a finding is relevant elsewhere
        ↓
SOCIAL PRESCRIPTION       packages relevant intelligence for a business
        ↓
CUSTOMER RESULTS          return new first-party evidence to Kairos
```

This flywheel is a core design objective, not a downstream nice-to-have —
it is why the scoping discipline in §19 exists at all.

### Social Money Lab as an evidence-generation system

The Battle Engine is not only entertainment. **Social Money Lab is an
intentional evidence-generation system for Kairos**: controlled, publicly
documented competitions that produce reusable, properly scoped evidence.

The long-term flywheel this serves:

```
SOCIAL MONEY LAB          runs controlled experiments
        ↓
KAIROS SCIENCE ENGINE     evaluates the evidence
        ↓
SCOPED FINDINGS           enter the intelligence base
        ↓
INTELLIGENCE TRANSFER     decides whether a finding is relevant elsewhere
        ↓
SOCIAL PRESCRIPTION       packages relevant intelligence for a business
        ↓
CUSTOMER RESULTS          return new first-party evidence to Kairos
```

This flywheel is a core design objective, not a downstream nice-to-have —
it is why the scoping discipline in §19 exists at all.

### The evidence-retention contract

**A Battle result must never become universal advice merely because it was
publicly successful.** Public visibility is not evidence quality. A finding
that came out of a televised season carries exactly the same scope
constraints as one from a quiet profile-level test.

Any finding produced through a battle must therefore retain, and carry
forward into Intelligence Transfer:

| Field | Where it lives |
| --- | --- |
| niche · sub-niche | `Finding.niche` / `Finding.subNiche` · `BattleEvidenceReference.niche` |
| audience context | `Finding.audienceSegmentId` · `BattleEvidenceReference.audienceContext` |
| account stage | `Finding.accountStage` · `BattleEvidenceReference.accountStage` |
| platform | `Finding.platform` · `BattleEvidenceReference.platform` |
| objective | `Finding.objective` · `BattleEvidenceReference.objective` |
| experiment ids | `Finding.sourceExperimentIds` · `BattleEvidenceReference.experimentIds` |
| sample | `Finding.sampleSize` · `BattleEvidenceReference.sampleSize` |
| time period | `Finding.observationWindow` · `BattleEvidenceReference.periodStart`/`periodEnd` |
| content DNA | `Finding.hookFamily` · `Finding.contentFormat` · `Finding.contentPillarId` |
| limitations | `Finding.limitations` · `BattleEvidenceReference.limitations` |
| season · protocol version · division/cohort | `BattleEvidenceReference.seasonId` / `protocolVersion` / `divisionId` / `cohortId` |

Two of these were open gaps and were **closed as part of Milestone 9**,
before any battle evidence could enter the intelligence base:

- **Observation window.** `Finding.observationWindow` now states the period
  the evidence covers, distinctly from `createdAt`/`lastValidatedAt`, which
  are record timestamps.
- **Limitations.** `Finding.limitations` now travels with the conclusion,
  and `emitFinding` propagates the evaluation's own limitations onto it
  automatically. Previously a caveat carried on `ComparisonResult` /
  `OutcomeAssessment` / `ScienceReport` / `HypothesisEvaluation` was dropped
  at the `Finding` boundary — and because `Finding` is the durable object
  that survives into Intelligence Transfer, that was **precisely the
  "publicly successful → universal advice" leak**: a thin battle result
  would have reached a customer's Social Prescription looking unqualified.

`BattleEngine.buildEvidenceReference` assembles the full envelope, inheriting
matchup limitations for division-scoped evidence and flagging small samples
automatically.

A third gap was closed after Milestone 12: `Finding` now also carries
**content DNA** — `hookFamily`, `contentFormat` and `contentPillarId`.
Previously these lived only on the originating `Experiment`, so a finding
that travelled arrived without them. Reaching back through
`sourceExperimentIds` is lossy in practice (a finding spanning several
experiments has no single content DNA), which left four downstream modules
unable to answer "which hook?" or "which format?":

- **Transfer** treated `contentFormat` as permanently `unknown`, capping
  achievable dimension coverage.
- **Prescription** returned no recommended formats and keyed hook guidance
  off the finding's full statement.
- **Adaptive Strategy**'s content-allocation logic was wired but inert —
  no finding named a pillar, so `evidenceByPillar` was always empty.
- **Genome** patterns could not be keyed on a real hook family.

All four now work off the finding directly. All three fields stay optional:
a finding that genuinely is not about one hook family or one format leaves
them absent rather than guessing.

### What already protects this

The scope discipline in §19 is the existing defence and it holds here
unchanged: findings default to the **narrowest justified scope** (profile),
a broader scope must be passed explicitly by a caller that actually has
cross-profile evidence, and a single profile's result can never widen itself
into a niche, platform or global claim. A battle season is many profiles, so
cross-profile synthesis becomes *possible* — but it remains something a
caller must justify with evidence, never something a winning season confers
automatically.

Presentation is likewise firewalled from evidence: entertainment labels
("Biggest Upset", "Platform MVP") are derived views over results and are
never themselves findings.

> **The entertainment can be loud. The methodology must be conservative.**

---

## 23. Intelligence Transfer Engine

Milestone 10. Answers one question: *evidence exists that something worked
somewhere else — how relevant is it to THIS profile?*

### Transfer is not truth

**A finding from another account, battle, niche, audience or platform can
never become a validated first-party finding for the receiving profile.**

Transferred intelligence may influence prioritization, seed hypotheses,
suggest experiments, improve cold-start strategy and reduce wasted
exploration. It may not masquerade as first-party validation.

This is structural, not conventional: the transfer module never writes a
`Finding`. Its strongest output is a `Hypothesis` at `proposed` with
`source: 'research'` and confidence capped at 0.3 — which the Science Engine
must then validate on the receiving profile's own evidence.

### Relevance verdicts

`directly_applicable` · `strongly_relevant` · `moderately_relevant` ·
`weakly_relevant` · `hypothesis_only` · `irrelevant` · `contraindicated` ·
`insufficiently_comparable`

Three of these are distinct in an important way. `irrelevant` means the
evidence does not apply. `contraindicated` means it argues *against* acting
here — typically because the receiving profile's own evidence contradicts
it. `insufficiently_comparable` means Kairos cannot tell, which is neither.

### Explainable similarity — no opaque score

Seventeen dimensions are compared individually: platform, niche, sub-niche,
audience, audience behavior, business model, offer type, objective, account
stage, account size, content format, posting capacity, voice/positioning,
geography, experimental conditions, measurement quality and evidence
freshness.

Each yields a `TransferDimension` carrying the comparison outcome, both
values, its weight, its contribution and a plain-language note. There is
deliberately no bare "similarity = 0.87": the number is always
reconstructible from the breakdown that produced it.

Comparison is exact and deterministic — no embeddings, no fuzzy matching.
Account stage uses an ordered ladder so adjacent stages score `partial`
rather than a flat mismatch; account size compares by order of magnitude,
because 5,000 vs 6,000 followers is the same situation and 5,000 vs 500,000
is not.

### The unknown rule

A dimension Kairos cannot compare is `unknown`. It is excluded from the
similarity denominator — **never scored as a match, never as a mismatch** —
and instead reduces `dimensionCoverage`.

This keeps two very different claims from looking alike: similarity 0.9 over
two of seventeen dimensions is not similarity 0.9 over all seventeen. Below
`minimumDimensionCoverage`, no verdict stronger than
`insufficiently_comparable` is permitted.

### Evidence hierarchy

`first_party` · `matched_peer` · `niche` · `platform` · `cross_niche` ·
`research`

Deliberately **not** a simple numeric ranking — objective match, measurement
quality, recency and context still matter. What the class does guarantee:

- Only `first_party` evidence can ever be `directly_applicable`.
- `cross_niche` is capped at `hypothesis_only`.
- `research` is capped at `hypothesis_only`.
- Stale evidence is capped at `weakly_relevant`.
- With `firstPartyDominates` (the default), a receiving profile that has
  **rejected** the same claim downgrades the transfer to `contraindicated`.
  First-party evidence outranks transferred evidence on its own profile.

### Negative transfer

Risks are detected and reported explicitly rather than left as an absence of
similarity: `objective_mismatch`, `platform_mechanics_incompatible`,
`audience_behavior_differs`, `offer_incompatible`,
`account_stage_mismatch`, `stale_evidence`,
`conflicting_first_party_evidence`, `leaderboard_not_evidence`. Each carries
a severity and an explanation.

### Declared vs. observed audience

The `audienceBehavior` dimension engages **only** when the donor evidence is
observation-backed (`sourceObserved`) and the receiving profile has observed
segments. A declared audience that happens to read similarly is not
behavioral proof, so without observation the dimension is `unknown` rather
than a match — the same declared/observed discipline §16 establishes.

### Battle integration

Battle-sourced evidence keeps its `BattleEvidenceReference` — season,
protocol version, division, niche, audience context, account stage,
platform, objective, experiment ids, sample, period, limitations — attached
all the way through the assessment.

And the guard that matters: a candidate flagged `isLeaderboardPosition` is
rejected outright as `irrelevant` with reason `leaderboard_not_evidence`. **A
competition standing never transfers as scientific evidence**, however
comparable the profiles are.

### Cold start

One of the engine's primary commercial purposes. For a profile with no
history, `buildColdStartGuidance` returns the honest framing —

> "We do not know what works for this profile yet. Based on evidence from
> comparable profiles, these are the most promising starting hypotheses —
> each one still needs testing here."

— plus the ranked starting hypotheses, each labelled with its source class
and relevance. Nothing is presented as known.

### Explainability contract

Every `TransferAssessment` answers: what evidence, from where, why it might
apply, why it might not, which dimensions matched, which differed, how fresh
it is (`evidenceAgeDays`), what is unknown, and what Kairos should do about
it.

`assessmentConfidence` is confidence in the *assessment* — driven by how much
was knowable and how many risks were found — and is deliberately separate
from the underlying claim's own confidence.

### Privacy

Comparison operates on marketing-relevant, aggregate, behavioral dimensions
only. No type carries a sensitive personal characteristic, and there is no
per-individual record anywhere: transfer compares **profiles and cohorts,
never people**.

---

## 24. Social Prescription Engine

> **Status note.** This static, machine-readable prescription was built
> before the milestone plan was revised. Under the current plan it is not a
> numbered milestone in its own right: it becomes the foundation for
> **Milestone 12 — Agentic Social Prescription**, where the prescription
> becomes persistent, customer-specific agent state for Social Money Lab
> rather than a generated report. Everything below still holds; M12 extends
> it.


Milestone 11. Turns Kairos intelligence into a curated, evidence-backed
strategy package for ONE profile — where the commercial promise lands:

> "Don't give me generic social advice. Tell me what I should do, for my
> business, audience, niche, platform and objective — and tell me why."

A prescription **cites** evidence; it never becomes evidence. Nothing in the
module writes a `Finding`, and it invents no strategy of its own: every
section is assembled from Science, Adaptive Strategy, Transfer, Audience,
Research and Measurement output.

### The nine outputs

**WHO** priority audience and segments · **WHAT** pillars, topics, formats ·
**HOW** hook patterns and CTAs · **WHERE** platform guidance · **WHEN**
cadence · **WHY** evidence behind each recommendation · **WHAT NOT TO DO**
rejected and contraindicated approaches · **WHAT TO TEST** open hypotheses ·
**WHAT WE DON'T KNOW** explicit unknowns.

### Evidence classes never collapse

`validated_on_profile` · `promising_on_profile` · `comparable_profiles` ·
`research_informed` · `experimental` · `unknown`

"Validated on your profile" and "supported by comparable profiles" are
different claims and stay different. **There is no blended certainty score
anywhere in the model** — every recommendation displays the class that
earned it, and transferred evidence can never be presented as first-party
validation.

### Pattern vs. example execution

This distinction is enforced by the type system, not by convention.

- *"Question-led problem hooks perform well"* is a **pattern**. It carries an
  `EvidenceClass`, a sample and a confidence.
- *"Are you making this credit mistake?"* is an **example execution**.
  `PrescriptionExample` has **no** `evidenceClass`, **no** `confidence` and
  **no** sample — it is structurally incapable of carrying evidence, and
  every example states in its own `note` that the wording is not itself
  evidence.

Claiming a specific sentence is scientifically proven is the error this
separation exists to make impossible.

### Objective depth — money over vanity

Recommendations are ranked against the profile's actual objective using a
funnel-depth ladder (attention → engagement → intent → conversion →
customer value). With `enforceObjectiveDepth`, evidence that does not reach
the objective's depth is **deprioritized rather than led with**: a
reply-rate win is real evidence, but it does not answer a revenue question,
and a revenue prescription will not open with it.

Depth is used **only** for objective matching. §8's rule stands unchanged: a
deeper metric is not better evidence, it is evidence about a different
question.

An approach that repeatedly fails to advance the objective accumulates a
compounding penalty, drawn from the profile's own rejected findings.

### Honest gaps

Where evidence does not exist, the prescription says so rather than filling
the space. Cadence guidance that merely restates declared capacity is
flagged `fromStatedCapacityOnly: true` with `evidenceClass: 'unknown'`, and
raises a matching entry under "What we don't know". A profile with no
observed segments is told its declared audience remains unconfirmed.

### Versioning

`PrescriptionVersion` records version, `generatedAt`, `evidenceCutoff`,
`supersedesPrescriptionId`, an optional change reason, and diffs of evidence
and recommendations added/removed. **Historical prescriptions are never
erased** — the reasoning behind a superseded package survives it being
replaced.

Recommendations resting on stale evidence are flagged `needsRevalidation`
and listed under `revalidationNeeded`, so a decaying prescription is never
presented indefinitely as current truth.

### Delivery

Machine-readable domain output only. No customer dashboard, no publishing,
no content generation — CreatorOS remains the execution layer.

---

## 25. Social Genome

Kairos's structured, evidence-backed, **cross-profile** knowledge layer.
It answers: *what has the system learned across profiles, experiments,
audiences, platforms, niches, offers, objectives and contexts — and under
what conditions does that knowledge appear to hold?*

### What it is not

Not a viral-hook list, a best-practices database, a prompt library, a
content-template library, a leaderboard, a collection of famous marketers, a
universal strategy system, or an AI-generated advice repository. Not a
replacement for profile-specific learning, not a way to copy one customer's
strategy into another, and not a claim that correlation is causation.

### Conditional knowledge

The unit of Genome knowledge is never *"Hook X works."* It is:

> "Hook family X has shown positive evidence for objective Y, on platform Z,
> among profiles with characteristics C, under conditions D, with evidence
> strength E, while contradictory evidence exists under conditions F."

`status: 'supported'` never means universal truth — only that evidence
**within this pattern's context** cleared a documented operational bar. Every
pattern carries `caveats` naming what must not be generalized from it.

### GenomeContext and context signatures

`GenomeContext` records conditions across twelve dimensions: platforms,
niches, sub-niches, audience descriptors, objectives, content formats,
content pillars, hook families, CTA types, offer types, funnel stages and
experiment treatments. Every dimension is optional, and **absent means
unknown, never "all values"** — a pattern observed on Twitter with no niche
recorded is a claim about Twitter, not about every niche on Twitter.

`contextSignature` produces a deterministic key: normalized by trim,
lowercase, dedupe and sort, so `['twitter','threads']` and
`['threads','twitter']` collide by design while `platforms=twitter` and
`platforms=twitter;niches=bookkeeping` stay distinct.

Normalization is deliberately shallow. It does **not** decide that
"bookkeeping" and "accounting" mean the same thing — that is semantic
matching, which §40 forbids and which is exactly how false generalization
happens. **Prefer under-generalization over false generalization:** two
records merge only when their signatures are identical.

### Evidence and provenance

`GenomeEvidenceReference` identifies evidence without embedding it. Evidence
types span `finding`, `segment_finding`, `experiment`, `hypothesis_evidence`,
`battle_result`, `transfer_assessment`, `strategy_claim` and `measurement`,
and source identity is always preserved — a research claim is never mistaken
for cross-profile validation.

No raw private content and no copyrighted research excerpts are copied in. A
short neutral summary, identifiers and lineage are the most that travels.

### Supporting and contradicting evidence

Every pattern carries both. Evidence can strengthen a pattern, weaken it,
make it `contested`, or let it decay — and **contradictory evidence is never
deleted when the conclusion changes**. `findContested()` surfaces exactly
the patterns the system disagrees with itself about.

### Cross-profile and cross-experiment replication

The single most important counting rule:

**100 observations from 1 profile is not 100 observations across 20
profiles.** `sourceProfileCount` and `sourceExperimentCount` are tracked
separately, and promotion past `emerging` is gated on them — not on evidence
volume. A prolific single profile reaches `emerging` at best. Likewise one
large experiment cannot masquerade as many independent replications.

Alongside that, `lineage.ts` deduplicates by `lineageRoots`, so a
measurement, its experiment, a finding built from it and a transfer derived
from that finding count as **one** piece of evidence rather than four.

### Objective specificity

Mandatory. A pattern that increases `views` is not a pattern that increases
`leads`, `sales` or `revenue`; high engagement is not high commercial value.
`objective` is a first-class field, queries filter on it explicitly, and a
reach-scoped pattern simply does not answer a revenue query. Caveats state
the boundary in words: *"engagement evidence is not commercial evidence."*

This principle is central to Social Money Lab.

### Platform, niche, audience, offer and funnel specificity

Evidence from `twitter` stays on Twitter; evidence from `bookkeeping` never
silently becomes all professional services. Single-platform and
single-niche patterns automatically carry caveats saying cross-platform
transfer is not established and adjacent niches must not be assumed.

The Genome *can* represent multi-platform replication — a pattern whose
context lists several platforms has genuinely replicated across them — but
it never infers that one platform is universally superior. Platform is a
contextual variable, not a hierarchy.

Audience conditionality is aggregate and behavioral only: descriptors like
`solo-operators`, never individual dossiers and never sensitive traits.

### Temporal decay

`assessGenomeFreshness` reuses the Science Engine's `current` /
`due_for_revalidation` / `decaying` vocabulary rather than inventing a
competing model. Stale knowledge is **never deleted** — it is re-statused and
surfaced by `findStale()` for re-testing.

### Operational confidence

A documented weighted blend, clamped 0..1, **explicitly not a probability**:
profile replication 0.30, experiment replication 0.20, evidence volume 0.15
(saturating), directional consistency 0.25 (rescaled so an even split
contributes nothing), recency 0.10 — then multiplied by a contradiction
damper so heavily contested evidence cannot score highly however plentiful.

Deliberately **not** an average of source confidences: averaging lets many
weak, mutually-dependent records inflate a score, which is the exact failure
this design exists to prevent. Every explanation carries a
`confidenceCaveat` saying so in words.

### Lifecycle

`emerging` → `promising` → `supported`, with `contested`, `decaying` and
`deprecated` reachable at any point. Status is re-derived on every
evaluation and is **not monotonic** — a supported pattern that accumulates
contradiction or goes stale is re-assigned downward. Contradiction is
checked *before* promotion, so contradicted evidence can never be called
supported however much of it there is. `deprecated` patterns remain
readable.

### Versioning

A material change (status change, or confidence moving 0.05+) increments
`version`, sets `supersedesPatternId`, and snapshots the prior record to
history. `getPatternHistory()` returns every retained version, so a
superseded belief stays inspectable without full event sourcing.

### Privacy and customer isolation

This matters for the future multi-customer product.

`PublicGenomePattern` is a **separate type**, not a filtered view of
`GenomePattern`. General query results return the public type, which carries
counts (`sourceProfileCount: 17`) but never profile ids, experiment ids,
record ids or evidence arrays. Because it is a distinct type, a future field
carrying customer data cannot leak by omission — it would have to be added
to the public shape explicitly.

Profile and experiment ids are retained internally because distinct-source
counting requires them; they never cross the public boundary.

The repository has no formal tenant type yet, and this milestone does not
invent one. The seam is designed so tenant boundaries can be added cleanly
later.

### Boundaries

| Layer | Question |
| --- | --- |
| **Genome** | What has been learned across contexts? |
| **Transfer** (§23) | How applicable might this be here? |
| **Science** (§19) | How strong is the evidence? |
| **Adaptive Strategy** (§20) | What should we do next? |
| **Prescription** (§24) | What do we recommend for this business? |

- **vs. ProfileBrain** — ProfileBrain is "what have we learned about THIS
  profile?"; the Genome is cross-profile conditional knowledge. The Genome is
  not embedded into ProfileBrain.
- **vs. Research Intelligence** — research says what external sources
  *claimed*; the Genome holds what evidence *accumulated*. A marketing
  article, CreatorOS skill or named practitioner's strategy can seed a
  hypothesis and nothing more: with no profile or experiment behind it, a
  claim cannot leave `emerging`.
- **vs. Battle Engine** — the Genome consumes battle results with their
  season and protocol provenance, and distinguishes "won a battle" from
  "replicated as a generalizable strategy." A leaderboard victory is not
  Genome truth.
- **vs. Transfer** — the Genome supplies **candidate** knowledge. Every query
  match carries `requiresTransferAssessment: true`; applicability to a
  target profile is Transfer's judgment, not the Genome's.
- **vs. Prescription** — the Genome never outputs "Sarah should post this
  today." It outputs "Pattern X is supported under contexts resembling
  Sarah's," and the layers above decide what to do with that.

### Explainability

`explainGenomePattern` returns statement, status and *why that status was
assigned*, operational confidence with its caveat, known context, unknown
context dimensions, supporting and contradicting summaries, distinct profile
and experiment counts, freshness, limitations, caveats, provenance types,
and an explicit `whatShouldNotBeGeneralized` list — all without exposing a
single underlying record.

### Deterministic throughout

No LLM, no embeddings, no vector search, no semantic similarity, no web
search, no scraping. The architecture works before AI interpretation is
added on top.

---

## 26. Agentic Social Prescription

§24's `SocialPrescription` is a **document**: generated once, correct as of
its evidence cutoff, and inert thereafter. Milestone 12 turns it into a
**persistent operating agent** — the layer Social Money Lab sells.

### External architecture

```
SOCIAL MONEY LAB                       (customer-facing product)
        |
CUSTOMER WORKSPACE                     (one business, isolated state)
        |
AGENTIC SOCIAL PRESCRIPTION            (this milestone)
        |
CUSTOMIZED INTELLIGENCE ENGINE         (Milestones 1-11)
        |
CREATOROS                              (execution: publish, schedule, engage)
        |
SOCIAL PLATFORMS
        |
MEASUREMENTS RETURN  ---------------->  back up the stack
```

The agent decides. CreatorOS acts. The platforms respond. Measurements come
back, the evidence changes, and the agent decides differently next time.

### One architecture, many states

A `SocialIntelligenceAgent` is **not a separate AI model per customer**.
Every customer shares the same deterministic architecture; what differs is
the persistent **state** stored against their agent: mission, permissions,
evidence picture, action queue, prescription version history and change log.
Nothing is fine-tuned, nothing is trained, and no customer's data becomes
another customer's advice except through the Genome's aggregate,
privacy-preserving path (§25).

### Mission

`AgentMission` states a **business** objective — *"generate 10 qualified
leads a month"* — not a vanity target. It carries the objective, platform
scope, offers, audience scope, and three constraint families: resource
(capacity), brand (topics and tone to avoid) and risk. A revised mission is
a **new record** that supersedes the old one via `supersedesMissionId`; the
prior mission stays readable, because "why did the strategy change?" is
usually answered by "the mission did."

### Evidence states

The agent's whole picture of a profile reduces to five states:

| State | Meaning |
| --- | --- |
| `know` | Validated on THIS profile, at or above the confidence bar |
| `suspect` | Promising, transferred, Genome-supported or research-informed |
| `test` | An experiment is currently resolving it |
| `unknown` | No relevant evidence — stated, not papered over |
| `stopped` | Deliberately deprioritized after prior evidence |

**`know` is reserved for first-party validation.** Transferred, Genome and
research evidence cap at `suspect` however confident they look. This is
enforced structurally in `deriveEvidenceState`, not by convention: it is the
same guarantee as §25's *"a Battle result must never become universal advice
merely because it was publicly successful,"* applied one layer up.

### The action queue

`AgentAction` is a proposal, never an act. Each one carries its risk class,
its evidence references, the constraints that applied, whether a human is
required, and an append-only `humanDecisions` trail. Approving, rejecting,
deferring or requesting revision **adds** a decision; it never rewrites the
proposal. A blocked action becomes `deferred` with a stated blocking reason
rather than silently disappearing — an invisible refusal is
indistinguishable from a bug.

### Autonomy and the bounding rule

Four levels: `advisor` → `copilot` → `operator` → `autonomous_lab`. New
agents start at `copilot`, never higher.

Risk is classified per action type, and `test_offer` **and any unrecognized
action type** classify as `restricted` — unknown intent is treated as the
most dangerous thing it could be. Restricted actions require approval at
every autonomy level, including `autonomous_lab`, and are never handed off
for execution at all.

`AgentPermissionPolicy` types `spendActionsAllowed` and
`offerChangesAllowed` as the literal `false`, so the compiler refuses code
that would enable them. And `setAutonomyLevel` requires a **human** actor:
the agent cannot widen its own latitude. The prohibitions are not
discouragements; each is structurally unreachable.

### The CreatorOS boundary

`CreatorOsExecutionHandoff` is where the intelligence layer stops. Preparing
one requires **both** an approved action **and** a permission that covers it
— approval alone is not enough, because a workspace with publishing disabled
must not dispatch however enthusiastically a human clicked approve. Nothing
in this milestone calls a platform API, mints a token or schedules anything.
Results come back through `recordExecutionResult`, which stores measurement
*references* and leaves the measurements themselves in Milestone 6's stores.

### The living prescription

`LivingSocialPrescription` is versioned like the Genome: a rebuild marks the
prior version `superseded` and retains it, and the new one carries a
`changeSummary` naming what evidence arrived, what left, and why.

Three habits keep it honest:

- **A platform with no evidence is an experiment, not a recommendation** —
  `testRequired: true`, `role: 'experimental'`, `evidenceState: 'unknown'`.
- **Cadence comes from stated capacity, not evidence** —
  `fromStatedCapacityOnly: true`, and it says so in the rationale.
- **Unknowns are listed** with how to resolve them, rather than filled in
  with confident-sounding advice.

`PersonalizationMaturity` (`cold_start` → `transferred_intelligence` →
`mixed_evidence` → `profile_informed` → `highly_profile_specific`) is
derived from the evidence mix, **never from elapsed days**: a profile
running many experiments matures faster than one posting quietly for months.

### The decision cycle

`runDecisionCycle` runs OBSERVE → DIAGNOSE → DECIDE → PROPOSE. It consumes
Adaptive Strategy (§20) for next actions rather than deriving its own —
every proposed action traces back to a `StrategyRecommendation` id — then
applies mission, permission and experiment constraints on top.

It is free to conclude that nothing should be done. `no_action_needed` is a
first-class diagnostic, and the decision summary says so in words: *"Waiting
for evidence is the correct move."*

### Explainability and export

`explainAgentAction` answers "why is the agent proposing this?" with the
mission objective, evidence state, evidence references, constraints,
limitations and open unknowns. Where peer evidence contributed, it is
described in aggregate and **no other business is ever identified**.

`getPrescriptionExport` produces a serializable snapshot for later PDF,
email, portal or API delivery. Rendering is out of scope; the data is not.

### Boundaries

- **vs. Adaptive Strategy** — Adaptive decides what to do next; the agent
  decides whether it is permitted, who must approve, and when it executes.
  There is no second strategy engine.
- **vs. Science** — Science evaluates evidence; the agent consumes verdicts
  and never re-derives them.
- **vs. Transfer / Genome** — both supply candidates capped at `suspect`.
- **vs. CreatorOS** — the agent prepares; CreatorOS executes.
- **vs. §24** — the static `SocialPrescription` remains the document form;
  this is its living, versioned, decision-making successor.

### Deterministic throughout

No LLM in the decision cycle. No embeddings, no semantic similarity, no web
search, no scraping. Identical state produces an identical plan.

---

## 27. The Complete Intelligence Loop

```
Research  (StrategyClaim, StrategyPrinciple)
      |
Profile Onboarding  (SocialProfile, ProfileBrain)
      |
Measurement + Audience Signals  (PostMeasurement, AttributionEvent, AudienceSignal)
      |
Science Engine  (baselines, comparisons, hypotheses, Findings)
      |
Adaptive Strategy  (next-best-action recommendations)
      |
Battle / Social Money Lab  (controlled competitions, scoped evidence)
      |
Intelligence Transfer  (is this evidence relevant to that profile?)
      |
Social Genome  (conditional map of what works, for whom, when)
      |
Agentic Social Prescription  (per-customer agent: mission, queue, approvals)
      |
CreatorOS execution  (publish, schedule, engage)
      |
new measurements  --> back to the top
```

**This is a learning loop, not a strict runtime pipeline.** No request
traverses these stages in order. Each layer reads what the ones beneath it
have already established, on its own cadence: a prescription can be built
without a battle ever running, transfer can operate on a cold-start profile
with no measurements of its own, and the Science Engine evaluates whenever
evidence arrives rather than on a schedule set from above.

What the diagram does describe is **the direction of dependency and the
direction of trust**. Evidence flows upward and gains scope only through
explicit, policy-gated steps; conclusions flow downward and never acquire
authority they did not earn. At every boundary the same three rules hold:

1. Raw evidence is never overwritten by an interpretation of it.
2. Scope is never widened automatically.
3. Missing is never the same as zero.

---

## 28. Development Milestones

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 — Intelligence Foundation | Architecture doc + `src/intelligence/` domain model + tests | Done |
| 2 — Intelligence Storage | Intelligence store port + JSONL adapter | Done |
| 3 — Profile Onboarding Mapping | Adapter from onboarding answers → `SocialProfile` + `ProfileBrain` init | Done |
| 4 — Audience Brain | Audience signals, observed segments, segment findings, segment performance, declared-vs-observed comparison | Done |
| 5 — Strategy & Research Intelligence | Research sources, strategy claims, observed associations, causal status, provenance, `StrategyPrinciple` evidence links | Done |
| 6 — Measurement Ingestion & Attribution | Raw CreatorOS snapshots, normalized post/profile observations, first-party attribution events, tracking context, raw/normalized lineage | Done |
| 7 — Science Engine | Baselines, comparisons, objective-metric policy, paired analysis, hypothesis evidence & evaluation, operational confidence, finding emission, decay/revalidation, science reports | Done |
| 8 — Adaptive Strategy Engine | Next-best-action recommendations, exploration/exploitation policy, constraints, content allocation, failure memory, information gain, strategy plans & versioning | Done |
| 9 — Battle Engine | Seasons, protocols, competitors, divisions, matchups, pre-registration, lab/growth modes, configurable scoring with vanity guard, standings, predictions, milestones, evidence provenance | Done |
| 10 — Intelligence Transfer | Explainable comparability across 17 dimensions, evidence hierarchy, negative transfer, cold start, hypothesis seeding | Done |
| 11 — Social Genome | Cross-profile conditional knowledge, context signatures, replication-gated lifecycle, contradiction retention, versioning, privacy-preserving queries | Done |
| **12 — Agentic Social Prescription** | Persistent per-customer agent state, mission, evidence states, action queue with approval boundaries, living versioned prescription, CreatorOS handoff, change log | **COMPLETE** |

Each milestone is additive and must leave CreatorOS execution untouched.

---

## 29. Non-Goals

Explicitly **not** part of Kairos Intelligence, now or later:

- Re-implementing anything CreatorOS does: account connection, authentication,
  scheduling, publishing, platform API calls, comment/DM delivery, webhooks,
  analytics retrieval, skill delivery/installation/updates.
- Replacing or shadowing `creatorOsAccountId`.
- A parallel platform abstraction that diverges from the CreatorOS platform
  matrix.
- Ecommerce/payment integration (offers are descriptive only through
  Milestone 8; `AttributionEvent` records outcomes, it does not process
  payments).
- Individual psychological dossiers or sensitive-trait inference of any kind
  (race/ethnicity, religion, sexual orientation, medical conditions,
  political affiliation, criminal history) — see §16's privacy boundary.
- Treating outside knowledge (any `StrategyClaim`) as automatically
  validated — see §17's core rule.
- Treating a CreatorOS platform analytics response as proof of revenue —
  see §18's business-outcomes rule.
- Declaring a winner by searching across metrics after the fact, or letting
  a secondary metric overturn a registered dependent metric — see §19's
  no-p-hacking rule.
- Deriving a causal `Finding` from an `ObservedAssociation` without
  controlled experimental evidence — see §19's observed-association
  safeguard.
- Executing a recommendation without human approval, or letting outside
  advice become a validated action — see §20's approval seam and
  research-integration rule.

Explicitly **not** part of Milestone 4:

- AI classification of audience signals or segments; embeddings; clustering.
- Live platform ingestion of comments/replies/DMs — the vocabulary exists,
  no adapter produces it yet.
- Personalizing public feeds.
- Semantic declared-vs-observed matching (`compareDeclaredToObserved` always
  returns `insufficient_evidence` today — see §16).

Explicitly **not** part of Milestone 5:

- AI extraction of claims from raw text/video/PDF — ingestion is manual and
  structured only (`ingestResearchSource`/`ingestStrategyClaim`).
- Web crawling or platform scraping.
- Automatically testing a claim or generating a `Hypothesis`/`Experiment`
  from it.
- Automatically altering a profile's strategy based on any claim.
- Any modification to CreatorOS's skill-delivery system — Kairos consumes
  skills as a research input, never replaces how they are shipped.

Explicitly **not** part of Milestone 6:

- Baseline calculation — `PostMeasurement`/`ProfileMeasurementSnapshot` are
  built to be query-ready for it, but nothing computes one yet.
- Any Science Engine decision about what worked, or any automatic strategy
  change from ingested data.
- Multi-touch attribution modelling — `AttributionMethod` represents
  uncertainty honestly; it does not resolve it.
- Any ecommerce/payment-provider integration (e.g. WooCommerce) — the
  `AttributionEvent` foundation exists for one to plug into later.
- A URL shortener or checkout logic — `TrackingContext` is data only.
- Any modification to CreatorOS's analytics retrieval, posting, or account
  contracts.

Explicitly **not** part of Milestone 7:

- Any LLM call, embedding, or generated prose — every statement the engine
  produces is composed deterministically and conservatively.
- Content generation of any kind.
- Automatic strategy change: `identifyRevalidationCandidates` returns ids
  and reasons only; nothing is scheduled, allocated or published.
- Cross-profile synthesis — findings default to the narrowest justified
  (profile) scope and cannot widen themselves.
- Academically rigorous statistical inference: `computeOperationalConfidence`
  is an operational score with documented deterministic rules, explicitly
  not a Bayesian posterior or a p-value.
- Multi-touch attribution modelling, pattern detection across profiles, or
  audience auto-classification.
- Persisting derived calculations (`ComparisonResult`, `ScienceReport`)
  that are recomputable from stored evidence.

Explicitly **not** part of Milestone 8:

- Any LLM call — every recommendation reason and rationale is composed
  deterministically.
- Content generation: the engine decides what KIND of test or pattern to
  pursue ("test a quantified-outcome hook"), never the final copy.
- Automatic execution or self-approval: recommendations are always created
  `proposed`, and `setRecommendationStatus` is the human seam.
- Recomputing anything the Science Engine owns — baselines, effect sizes,
  confidence, hypothesis evaluation, finding emission, decay assessment.
- Cross-profile evidence precedence and synthesis; that is Milestone 10's
  Intelligence Waterfall.
- Presenting `priorityScore` or `InformationGainScore` as statistical
  quantities. Both are operational, explainable scores.

Explicitly **not** part of Milestone 9:

- Any LLM call, or any content generation.
- Publishing or scheduling — CreatorOS remains the execution layer.
- Recomputing statistics the Science Engine owns; the Battle Engine
  orchestrates and delegates.
- Emitting a `Finding` from a leaderboard position, under any circumstances.
- Duplicating measurements already stored by Measurement Ingestion.
- Any customer-facing dashboard or presentation surface. Entertainment
  labels are derived views, and none are computed here.

Explicitly **not** part of Milestone 10:

- Any LLM call, embedding, or fuzzy/semantic matching — every comparison is
  exact and deterministic.
- Creating a `Finding` from transferred evidence, under any path.
- Transferring a leaderboard position as evidence.
- Inferring sensitive traits, or building any per-individual record.
- Rewriting Adaptive Strategy; the integration point is
  `TransferAssessment` feeding future experiment prioritization.

Explicitly **not** part of Milestone 11:

- Any LLM call or content generation. Hook *patterns* come from evidence;
  example executions are caller-supplied illustrations that cannot carry
  evidence.
- Presenting a specific sentence as scientifically supported.
- Collapsing evidence classes into one certainty score.
- Writing a `Finding`, or letting a prescription become evidence.
- Any customer dashboard, delivery surface or publishing.

Explicitly **not** part of Milestone 12:

- Any LLM call, embedding or automated inference of relationships.
- A universal best-strategy table, or any context-free claim.
- Automatic generalization of scope.
- A second similarity engine — Intelligence Transfer is reused.
- Creating prescriptions; the Genome supplies structured intelligence only.
- Any per-individual record or sensitive-trait inference.
- Rewriting historical snapshots.
- Onboarding changes, dashboard changes, CreatorOS execution changes.

---

## Design Principle

> **Kairos is not a machine that knows the answer.**
> **Kairos is a machine designed to discover increasingly reliable answers for a
> specific profile, objective, platform, niche and audience — and to remember
> what it learns.**
