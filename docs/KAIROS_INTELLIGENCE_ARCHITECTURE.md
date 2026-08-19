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

## 19. Storage Architecture

Kairos already has a storage port at `src/storage/store.ts` with a JSONL
adapter (`src/storage/jsonlStore.ts`), designed so a Postgres adapter can
replace it without touching callers.

Intelligence storage follows the **same discipline**, built in Milestone 2
(`src/intelligence/storage/store.ts` + `jsonlIntelligenceStore.ts`) and
extended by Milestone 4 (audience stores), Milestone 5 (research stores) and
Milestone 6 (measurement/attribution stores):

- an intelligence port defined as an interface (`IntelligenceStore`),
- JSONL-on-disk as the first adapter (append-only; mutable knowledge is
  latest-line-wins per `id`, raw evidence — `ExperimentObservation`,
  `AudienceSignal`, `SegmentPerformance`, `CreatorOsMeasurementSnapshot`,
  `PostMeasurement`, `ProfileMeasurementSnapshot` — is never collapsed),
- a durable adapter later, without changing callers.

All intelligence domain types therefore carry a stable `id` (or, for
`PerformanceBaseline`, a stable derived key) and are plain, serializable,
JSON-round-trippable data. No classes, no methods, no non-serializable
fields.

**Milestone 1 shipped types only. Milestone 2 added the store. Milestone 3
added the onboarding adapter. Milestone 4 added the audience stores.
Milestone 5 added the research stores. Milestone 6 added the
measurement/attribution stores.**

---

## 20. Battle Engine (Future Module)

The Battle Engine is the future component that turns the domain model into
continuous competition: pairing variants, allocating posting capacity between
exploitation and exploration according to `experimentMode`, promoting winners,
retiring losers and scheduling revalidation of decaying findings.

It is deliberately **out of scope** through Milestone 6. The domain model is
built so the Battle Engine can be added as a consumer — `pairId`, `variant`,
`controlVariable`, `testVariables`, `experimentMode` and `currentAllocations`
all exist for it — without any change to the types below it.

---

## 21. Development Milestones

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 — Intelligence Foundation | Architecture doc + `src/intelligence/` domain model + tests | Done |
| 2 — Intelligence Storage | Intelligence store port + JSONL adapter | Done |
| 3 — Profile Onboarding Mapping | Adapter from onboarding answers → `SocialProfile` + `ProfileBrain` init | Done |
| 4 — Audience Brain | Audience signals, observed segments, segment findings, segment performance, declared-vs-observed comparison | Done |
| 5 — Strategy & Research Intelligence | Research sources, strategy claims, observed associations, causal status, provenance, `StrategyPrinciple` evidence links | Done |
| **6 — Measurement Ingestion & Attribution** | Raw CreatorOS snapshots, normalized post/profile observations, first-party attribution events, tracking context, raw/normalized lineage | **This milestone** |
| 7 — Science Engine | Baseline calculation, hypothesis lifecycle, finding emission, decay, pattern detection, audience classification, claim → hypothesis mapping | Planned |
| 8 — Battle Engine | Variant allocation, winner promotion, revalidation scheduling | Planned |
| 9 — Social Genome | Commercial dashboard/product surface | Planned |

Each milestone is additive and must leave CreatorOS execution untouched.

---

## 22. Non-Goals

Explicitly **not** part of Kairos Intelligence, now or later:

- Re-implementing anything CreatorOS does: account connection, authentication,
  scheduling, publishing, platform API calls, comment/DM delivery, webhooks,
  analytics retrieval, skill delivery/installation/updates.
- Replacing or shadowing `creatorOsAccountId`.
- A parallel platform abstraction that diverges from the CreatorOS platform
  matrix.
- Ecommerce/payment integration (offers are descriptive only through
  Milestone 6; `AttributionEvent` records outcomes, it does not process
  payments).
- Individual psychological dossiers or sensitive-trait inference of any kind
  (race/ethnicity, religion, sexual orientation, medical conditions,
  political affiliation, criminal history) — see §16's privacy boundary.
- Treating outside knowledge (any `StrategyClaim`) as automatically
  validated — see §17's core rule.
- Treating a CreatorOS platform analytics response as proof of revenue —
  see §18's business-outcomes rule.

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

Explicitly **not** part of any milestone so far:

- The Science Engine, Adaptive Strategy, the Battle Engine, Social Genome.
- Onboarding changes, dashboard changes, CreatorOS execution changes.

---

## Design Principle

> **Kairos is not a machine that knows the answer.**
> **Kairos is a machine designed to discover increasingly reliable answers for a
> specific profile, objective, platform, niche and audience — and to remember
> what it learns.**
