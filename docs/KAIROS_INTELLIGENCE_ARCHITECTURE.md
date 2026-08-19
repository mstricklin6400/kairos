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
(`src/onboarding/`) is untouched. A later milestone will map interview answers
onto `SocialProfile` via an adapter.

---

## 16. Storage Architecture

Kairos already has a storage port at `src/storage/store.ts` with a JSONL
adapter (`src/storage/jsonlStore.ts`), designed so a Postgres adapter can
replace it without touching callers.

Intelligence storage will follow the **same discipline**:

- an intelligence port defined as an interface,
- JSONL-on-disk as the first adapter (append-only, latest-line-wins per `id`),
- a durable adapter later, without changing callers.

All intelligence domain types therefore carry a stable `id` and are plain,
serializable, JSON-round-trippable data. No classes, no methods, no
non-serializable fields.

**Milestone 1 ships types only — no store, no adapter, no persistence.**

---

## 17. Battle Engine (Future Module)

The Battle Engine is the future component that turns the domain model into
continuous competition: pairing variants, allocating posting capacity between
exploitation and exploration according to `experimentMode`, promoting winners,
retiring losers and scheduling revalidation of decaying findings.

It is deliberately **out of scope** for Milestone 1. The domain model is built
so the Battle Engine can be added as a consumer — `pairId`, `variant`,
`controlVariable`, `testVariables`, `experimentMode` and `currentAllocations`
all exist for it — without any change to the types below it.

---

## 18. Development Milestones

| Milestone | Scope | Status |
| --- | --- | --- |
| **1 — Intelligence Foundation** | Architecture doc + `src/intelligence/` domain model + tests | **This milestone** |
| 2 — Intelligence Storage | Intelligence store port + JSONL adapter | Planned |
| 3 — Profile Onboarding Mapping | Adapter from onboarding answers → `SocialProfile` | Planned |
| 4 — Measurement Ingestion | CreatorOS analytics → `ExperimentResult`, baseline calculation | Planned |
| 5 — Science Engine | Hypothesis lifecycle, finding emission, decay, pattern detection | Planned |
| 6 — Battle Engine | Variant allocation, winner promotion, revalidation scheduling | Planned |
| 7 — Social Genome | Commercial dashboard/product surface | Planned |

Each milestone is additive and must leave CreatorOS execution untouched.

---

## 19. Non-Goals

Explicitly **not** part of Kairos Intelligence, now or later:

- Re-implementing anything CreatorOS does: account connection, authentication,
  scheduling, publishing, platform API calls, comment/DM delivery, webhooks,
  analytics retrieval.
- Replacing or shadowing `creatorOsAccountId`.
- A parallel platform abstraction that diverges from the CreatorOS platform
  matrix.
- Ecommerce/payment integration (offers are descriptive only in Milestone 1).

Explicitly **not** part of Milestone 1:

- AI agents, LLM calls, prompt engineering.
- The research process that populates niche/audience intelligence.
- Baseline calculation, pattern detection, winner/failure detection.
- The Battle Engine, the Science Engine runtime, Social Genome UI.
- Onboarding changes, dashboard changes, persistence.

---

## Design Principle

> **Kairos is not a machine that knows the answer.**
> **Kairos is a machine designed to discover increasingly reliable answers for a
> specific profile, objective, platform, niche and audience — and to remember
> what it learns.**
