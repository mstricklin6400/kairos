# Architecture Audit & Freeze

**Kairos Intelligence Foundation → Social Money Lab product readiness**

| | |
| --- | --- |
| Branch | `feature/kairos-intelligence-foundation` |
| Audit date | 2026-08-20 |
| Milestones audited | 1–12 (complete) |
| Head at audit start | `4a12fb7` (M12), `9cfd949` (M11) |
| Baseline | typecheck clean · 1025 / 1026 tests passing |
| Final | typecheck clean · 1062 / 1063 tests passing |
| Sole failure | pre-existing, unrelated banner credential test (untouched) |

---

## 1. Executive Summary

The twelve milestones **do** operate as one coherent system at the level of
types, boundaries and discipline. Port/adapter separation is perfect,
platform neutrality is total, security is clean, and the privacy seams hold.
There are no circular runtime dependencies and no CreatorOS duplication.

Three things are nonetheless true, and they shape the freeze decision:

1. **The layer has no consumers.** 14,899 lines of intelligence code are
   imported by nothing outside `src/intelligence/`. There is no API, no CLI
   command, no agent tool, no dashboard page. It is a complete, well-tested,
   entirely unwired library.

2. **A third of the engines are orphaned.** `SocialGenomeEngine`,
   `IntelligenceTransferEngine`, `BattleEngine` and the static
   `SocialPrescriptionEngine` — roughly 4,969 LOC — are constructed only in
   their own test files. The single wired chain is
   `AgenticPrescriptionEngine → AdaptiveStrategyEngine → ScienceEngine`.

3. **There is no tenant boundary below Milestone 12.** `workspaceId` exists
   only on M12 records. Several store queries take no required scope and
   return every customer's records.

None of these is a *correctness* defect. All three are *product-readiness*
defects, and they are precisely the work the Social Money Lab MVP consists
of. That distinction is what makes the freeze safe.

**Decision: READY TO FREEZE WITH SMALL FIXES.** One blocker-class fix was
applied during this audit (F-1, experiment-lock derivation). The remaining
pre-MVP list is integration and scoping work, not new intelligence concepts.

---

## 2. Milestones 1–12

| # | Module | Status | Wired into the customer path? |
| --- | --- | --- | --- |
| 1 | `common`, `profiles`, `performance`, `strategy` | Done | Yes (types) |
| 2 | `storage` (port + JSONL adapter) | Done | Yes |
| 3 | `onboarding` | Done | Yes |
| 4 | `audience` | Done | Partial — read by the prescription, no producer |
| 5 | `research` | Done | **No** — no consumer |
| 6 | `measurement` | Done | Yes |
| 7 | `science` | Done | Yes |
| 8 | `adaptive` | Done | Yes |
| 9 | `battle` | Done | **No** — engine never constructed |
| 10 | `transfer` | Done | Data yes, engine **no** |
| 11 | `genome` | Done | **No** — neither data nor engine |
| 12 | `agentic` | Done | Yes — the entry point |

---

## 3. Module Inventory

| Module | LOC | Principal types | Engine | Upstream | Downstream | Critical? |
| --- | ---: | --- | --- | --- | --- | --- |
| `common` | 160 | `Platform`, `Confidence`, `KnowledgeScope`, `GrowthObjective` | — | CreatorOS matrix | all | Yes |
| `profiles` | 214 | `SocialProfile`, `Offer` | — | common | onboarding, adaptive, transfer | Yes |
| `performance` | 121 | `PerformanceMetric`, `MeasurementTier`, `PerformanceBaseline` | — | common | science, audience, battle | Yes |
| `onboarding` | 439 | `ProfileOnboardingInput` | `onboardProfile` (fn) | profiles, audience, **CreatorOS matrix** | research, measurement | Yes |
| `audience` | 356 | `AudienceSignal`, `ObservedAudienceSegment`, `SegmentFinding` | aggregate fns | performance | strategy, agentic | Yes |
| `research` | 780 | `ResearchSource`, `StrategyClaim` | ingest fns | onboarding, strategy | *(none)* | No |
| `measurement` | 647 | `CreatorOsMeasurementSnapshot`, `PostMeasurement`, `AttributionEvent` | ingest fns | onboarding, science | science, agentic | Yes |
| `science` | 1498 | `Finding`, `Hypothesis`, `Experiment` | `ScienceEngine` | performance, measurement | adaptive, battle, transfer, genome, agentic | Yes |
| `strategy` | 176 | `ProfileBrain`, `StrategyPrinciple` | — | science, audience | onboarding | Partial |
| `adaptive` | 1155 | `StrategyRecommendation`, `AdaptiveStrategyPlan` | `AdaptiveStrategyEngine` | science, profiles | agentic, prescription | Yes |
| `battle` | 1448 | `BattleSeason`, `BattleProtocol`, `BattleOutcome` | `BattleEngine` | science, adaptive | *(none)* | Season 1 |
| `transfer` | 1183 | `TransferAssessment`, `PeerCohort` | `IntelligenceTransferEngine` | science, battle, profiles | agentic (data only) | Yes |
| `genome` | 1298 | `GenomePattern`, `PublicGenomePattern` | `SocialGenomeEngine` | science | *(none)* | Yes |
| `prescription` | 1040 | `SocialPrescription` (static) | `SocialPrescriptionEngine` | science, adaptive, transfer | *(none)* | **Superseded** |
| `agentic` | 2325 | `SocialIntelligenceAgent`, `AgentMission`, `LivingSocialPrescription`, `AgentAction` | `AgenticPrescriptionEngine` | science, adaptive | *(none — entry point)* | Yes |
| `storage` | 1746 | `IntelligenceStore` (46 entities) | `JsonlIntelligenceStore` | all domain types | all engines | Yes |
| **Total** | **14,899** | | | | | |

---

## 4. Dependency Direction

**Verdict: clean. No runtime cycles.**

The value-import (runtime) graph is a DAG:

```
agentic ──→ adaptive ──→ science
   │            │
   └────────────┘
prescription ─→ adaptive, science          (superseded module)
battle ──────→ science
genome ──────→ science/statistics
transfer ────→ science/statistics
measurement ─→ onboarding/validate
research ────→ onboarding/validate
onboarding ──→ audience, CreatorOS platformMatrix
```

Verified properties:

- **Port purity.** `storage/store.ts` contains *zero* value imports — it is
  a type-only interface file.
- **No adapter leakage.** `JsonlIntelligenceStore` is imported by **no**
  production file. All thirteen engines/services import
  `import type { IntelligenceStore }` from the port.
- **No upward dependency.** Nothing below `agentic` imports `agentic`. The
  only reference is the store port naming its types, which is type-only and
  erased.
- **Type-level cycle, by design.** `storage` references every domain
  module's types and every module references the port's type. This is the
  standard port pattern; because both directions are `import type`, nothing
  survives to runtime.

### CreatorOS coupling — exactly two edges

```
src/intelligence/common/types.ts       →  ../../client/platformMatrix.js   (Platform union)
src/intelligence/onboarding/validate.ts →  ../../client/platformMatrix.js  (normalizePlatform, platformLabel)
```

Both are read-only reuse of the CreatorOS platform vocabulary — the intended
behaviour, not a violation. No other file in the intelligence layer touches
any CreatorOS surface.

---

## 5. Source-of-Truth Matrix

46 store entities, each with exactly one `save*` method. **No entity has two
authoritative stores.**

| Concept | Canonical store | Write discipline |
| --- | --- | --- |
| `SocialProfile` | `saveProfile` | upsert by id |
| `ProfileBrain` | `saveProfileBrain` | upsert by profileId — **materialized summary, not truth** |
| `AudienceSignal` | `saveAudienceSignal` | append-only raw evidence |
| `ObservedAudienceSegment` / `SegmentFinding` | own stores | upsert by id |
| `SegmentPerformance` | `saveSegmentPerformance` | append-only |
| `ResearchSource` / `StrategyClaim` / `StrategyPrinciple` | own stores | upsert by id |
| `Experiment` | `saveExperiment` | upsert by id |
| `ExperimentObservation` | `saveExperimentObservation` | **append-only, never overwritten** |
| `Hypothesis` / `HypothesisEvidence` | own stores | upsert / append |
| `CreatorOsMeasurementSnapshot` | `saveMeasurementSnapshot` | **append-only raw** |
| `PostMeasurement` | `savePostMeasurement` | normalized, carries `sourceSnapshotId` |
| `AttributionEvent` | `saveAttributionEvent` | append-only, first-party only |
| `Finding` | `saveFinding` | upsert by id — canonical over `ProfileBrain`'s embedded copies |
| `StrategyRecommendation` / `AdaptiveStrategyPlan` | own stores | upsert by id |
| Battle (13 entities) | own stores | upsert by id, season-scoped |
| `TransferAssessment` / `PeerCohort` | own stores | upsert by id, earlier assessments retained |
| `GenomePattern` (+ history) | two stores by design | upsert + versioned history |
| `SocialPrescription` (static) | `saveSocialPrescription` | **superseded — see §6** |
| `SocialIntelligenceAgent` | `saveAgent` | upsert by id |
| `AgentMission` | `saveAgentMission` | new record supersedes; prior retained |
| `AgentPermissionPolicy` | `saveAgentPermissionPolicy` | upsert by agentId |
| `AgentAction` | `saveAgentAction` | upsert; `humanDecisions` appended |
| `LivingSocialPrescription` | `saveLivingPrescription` | versioned; prior marked superseded |
| `CreatorOsExecutionHandoff` | `saveExecutionHandoff` | upsert by id |
| `AgentChangeRecord` | `saveAgentChangeRecord` | append-only |

### Conflicts found

- **`activeExperimentIds` is declared in three types** — `ProfileBrain`,
  `SocialIntelligenceAgent` and `AgentState` — initialized to `[]` in two,
  and **written by nothing**. `decisionLoad.experimentsRunning` is therefore
  permanently `0`. (Debt M-2.)
- **`ProfileBrain.performanceBaselines` and `.strategyMemory`** embed
  materialized copies of records that live authoritatively elsewhere. The
  store header documents this correctly, but no code ever refreshes them.
  (Debt M-5.)

---

## 6. Static Prescription — Legacy Artifact Audit

Milestone 12 replaced the static `SocialPrescription` document with the
living, versioned `LivingSocialPrescription`. The static module remains in
full, and both are exported from the public index.

| Static artifact (`prescription/`) | Living equivalent (`agentic/`) | Class |
| --- | --- | --- |
| `SocialPrescription` | `LivingSocialPrescription` | **DEPRECATE** |
| `SocialPrescriptionEngine` (1040 LOC) | `AgenticPrescriptionEngine` | **DEPRECATE** |
| `AudiencePrescription` | `AudienceStrategy` | DEPRECATE |
| `ContentPrescription`, `HookPrescription`, `CtaPrescription` | `ContentStrategyItem` | DEPRECATE |
| `PlatformPrescription` | `PlatformAllocation` | DEPRECATE |
| `CadencePrescription` | `CadenceStrategy` | DEPRECATE |
| `PrescriptionUnknown` | `PrescriptionUnknownItem` | DEPRECATE |
| `PrescriptionVersion` | `version` + `PrescriptionDelta` | DEPRECATE |
| `PrescriptionExperiment` | `ExperimentPlanItem` | DEPRECATE |
| `PrescriptionEvidence`, `EvidenceClass` | `AgentEvidenceRefs`, `EvidenceStateEntry` | DEPRECATE |
| `PrescriptionExample` | `ContentBrief` | DEPRECATE |
| `OfferPrescription` | **no equivalent** | **MIGRATE** |
| `saveSocialPrescription` / `listSocialPrescriptions` | living-prescription store | REMOVE LATER |
| `tests/intelligencePrescription.test.ts` (77 tests) | agentic suite (169) | KEEP until removal |

**Nothing is ACTIVELY CONFLICTING** — the two systems never write to the
same store and never contradict each other. The risk is consumer confusion:
a future Social Money Lab developer reading the public index sees two
complete prescription vocabularies with no marker saying which is current.

`OfferPrescription` is the one genuine loss. The living prescription has an
`offerStrategy` field that is **always empty** — offer guidance regressed in
M12 and should be migrated rather than dropped.

**Recommendation:** do not delete during freeze. Stop exporting the static
types from `src/intelligence/index.ts`, add a deprecation header to
`prescription/types.ts`, migrate `OfferPrescription`, then remove after the
MVP proves the living prescription covers the ground.

---

## 7. Old Genome Artifacts

**Clean.** A grep for `GenomeNode`, `GenomeEdge`, `GenomeSnapshot`,
`GenomeEvidence`, `GenomeConfidence` and `GenomeConsistency` across `src`,
`tests` and `docs` returns no surviving type, store, export or test. The
Milestone 11 rebuild removed its predecessor completely. The only hit is a
local test helper *function* named `genomeEvidence` in the content-DNA
suite, which constructs the current `GenomeEvidenceReference` type.

The new Genome is canonical.

---

## 8. ProfileBrain vs. AgentState

Responsibilities are correctly separated in principle:

| | `ProfileBrain` | `AgentState` |
| --- | --- | --- |
| Question | What have we learned about this profile? | What is the agent doing right now? |
| Scope | one profile | one agent (may span profiles) |
| Owner | strategy module | agentic module |
| Lifetime | slowly accumulating | rebuilt per read |

`AgentState` is correctly a **derived read model** — `buildAgentState`
recomputes it on every call and stores nothing. There is no hidden
duplication of mission, actions, approvals or prescriptions.

The one real overlap is `activeExperimentIds` (§5), which appears in both
and is authoritative in neither. Truth for in-flight experiments should be
the `Experiment` store, read via
`AdaptiveStrategyEngine.evaluateStrategyConstraints` — which is exactly what
fix F-1 now does.

---

## 9. Genome vs. Transfer vs. Science vs. Adaptive vs. Agentic

**No code collapses these responsibilities.** Each boundary is enforced by
the type system rather than by convention:

| Layer | Question | Enforcement |
| --- | --- | --- |
| Science | How strong is the evidence? | Only layer that emits a `Finding` |
| Genome | What holds across contexts? | Only layer that writes `GenomePattern`; every query match carries `requiresTransferAssessment: true` |
| Transfer | Does that apply here? | Only layer that writes `TransferAssessment` |
| Adaptive | What should this profile do next? | Only layer that writes `StrategyRecommendation` |
| Agentic | What is permitted, who approves, when does it run? | Only layer that writes `AgentAction`; consumes Adaptive rather than re-deriving |
| Prescription (§24) | *(superseded)* | — |

The strongest structural guarantee: `deriveEvidenceState` in
`agentic/policy.ts` reserves `know` for first-party validated evidence.
Transferred, Genome and research evidence cap at `suspect` regardless of
confidence — verified at confidence `0.95` in
`tests/intelligenceEndToEnd.test.ts`.

---

## 10. Evidence Lineage

| Chain | Status |
| --- | --- |
| Raw CreatorOS snapshot → `PostMeasurement` | **Works.** `sourceSnapshotId` links them; verified end-to-end |
| Measurement → baseline → comparison → `HypothesisEvidence` → evaluation → `Finding` | **Works.** Verified with a real emitted finding, and with a correct refusal when the effect is indistinguishable from baseline |
| `Finding` → agent evidence state (`know`) | **Works.** Verified |
| `StrategyRecommendation` → `AgentAction` | **Works.** Every proposed action carries `strategyRecommendationIds` |
| `AgentAction` → `CreatorOsExecutionHandoff` → measurement refs | **Works.** Verified both directions |
| `Finding` → prescription refresh → new version → change record | **Works.** Verified |
| `TransferAssessment` → source evidence | **Partial.** The type carries `findingId` and `sourceClass`, and the agent reads assessments — but nothing *produces* them in production (H-4) |
| `GenomePattern` → evidence references → agent | **Absent.** The agent never reads a `GenomePattern` (H-2) |
| Battle result → Genome / Transfer | **Absent.** `BattleEngine` has no consumer (H-3) |

**Orphan risk:** `Finding.sourceExperimentIds` is a string array with no
referential integrity — a finding can name an experiment that was never
stored. Acceptable for a JSONL store; worth a validation pass at the API
boundary.

---

## 11. Double-Counting Audit

The system's defence against evidence inflation is `lineageRoots` plus
union-find deduplication in `genome/lineage.ts`. Applied where it matters
most: **Genome promotion is gated on distinct profiles and distinct
experiments, not on evidence volume**, so a measurement, its experiment, a
finding built from it, and a transfer derived from that finding count as
*one*.

**But lineage dedup exists only in the Genome module.** No other layer
imports `countIndependentEvidence` or `deduplicateByLineage`.

The concrete exposure is in `AgenticPrescriptionEngine.getEvidenceStateSummary`,
which iterates findings, then transfers, then hypotheses with no cross-dedup.
A finding, a transfer assessment derived from that same finding, and an open
hypothesis on the same subject produce **three** entries. The `know` /
`suspect` / `test` tally can therefore exceed the number of independent
pieces of evidence.

**Severity: MEDIUM, not HIGH.** This is a display tally, not a promotion
gate — no finding is validated and no pattern is promoted on the strength of
it. The consequence is a customer-facing count that overstates how much the
system knows. (Debt M-1.)

Science, Battle and Transfer were checked and do not double-count within
their own aggregations.

---

## 12. Multi-Customer / Tenant Safety

**This is the most serious finding. Severity: BLOCKER for MVP.**

`workspaceId` appears in exactly two files outside the agentic module, both
of which are the storage port and adapter referencing agentic types. **No
pre-Milestone-12 entity carries a tenant field.** `SocialProfile` has
`creatorOsAccountId` — a CreatorOS account reference, not a Social Money Lab
workspace.

Store queries that take **no required scope** and return every record:

| Method | Returns |
| --- | --- |
| `listProfiles(query?)` | every customer's profiles |
| `listFindings(query?)` | every customer's findings |
| `listExperiments(query?)` | every customer's experiments |
| `listHypotheses(query?)` | every customer's hypotheses |
| `listAgents(query?)` | every customer's agents |
| `listResearchSources(query?)`, `listStrategyClaims(query?)`, `listStrategyPrinciples(query?)` | all — arguably legitimately global |
| `listBattleSeasons(query?)`, `listBattleProtocols()`, `listPeerCohorts()` | all — legitimately global |
| `listGenomePatterns(query)` | all — **correct by design**, the Genome is cross-profile |

Isolation today rests entirely on **caller discipline**: pass `profileId`,
get one customer's data; pass nothing, get everyone's. Nothing is exposed at
present because the layer has no HTTP surface — but the first endpoint built
over `listFindings` will cross-serve customer data unless scoping is added
first.

The M12 records (`Agent`, `Mission`, `Action`, `LivingPrescription`,
`Handoff`, `ChangeRecord`) *are* correctly scoped by `agentId`, and
`listAgents` supports a `workspaceId` filter. So the pattern is established
— it simply has not been pushed down.

**Can the domain enforce tenancy cleanly later? Yes.** Every record already
chains to a `profileId`, and profiles are the natural leaf of a workspace.
The fix is to add `workspaceId` to `SocialProfile`, make it required on
scope-bearing queries, and resolve profile→workspace at the port. This is
mechanical, not architectural.

This gap is asserted rather than papered over in
`tests/intelligenceEndToEnd.test.ts` ("documents that findings are NOT
workspace-scoped below Milestone 12"), so it will fail loudly when fixed.

---

## 13. Social Genome Privacy

**Clean.** `PublicGenomePattern` is a **separate type**, not a filtered view
of `GenomePattern`. It carries counts (`sourceProfileCount: 17`) and never
ids. Because it is a distinct type, a future field holding customer data
cannot leak by omission — it would have to be added to the public shape
deliberately.

`GenomeEvidenceSummary` likewise carries only counts and ratios.

Verified by serializing a public pattern built from evidence with
deliberately identifiable ids (`prof_private_1`, `exp_private_1`,
`fnd_private_1`) and asserting none appear in the output.

Internal evidence remains fully auditable via `explainGenomePattern` and the
non-public `GenomePattern`, so the privacy boundary costs nothing in
inspectability.

Nothing shared through the Genome requires customer names, handles, profile
ids, experiment ids, revenue, offers or audience signals.

---

## 14. Customer-Specific Memory

**Present and sufficient.** Each customer's agent retains, as separate
persisted state:

| Memory | Store | Retention |
| --- | --- | --- |
| Mission | `saveAgentMission` | superseded, never overwritten |
| Permissions | `saveAgentPermissionPolicy` | upsert by agent |
| Profile state | `saveProfile` / `saveProfileBrain` | versioned |
| Prescription history | `saveLivingPrescription` | every version retained |
| Action history | `saveAgentAction` | full queue, all statuses |
| Human overrides | `AgentAction.humanDecisions` | appended, never replaced |
| Execution history | `saveExecutionHandoff` | linked to action and measurements |
| Change log | `saveAgentChangeRecord` | append-only |
| Experiment history | `saveExperiment` / `saveExperimentObservation` | append-only observations |

**No separate AI model per customer is required** — the architecture is
deterministic and shared; only state differs. This is stated explicitly in
the `agentic/types.ts` header and in §26 of the architecture document.

**Missing relation:** experiment history is stored per *profile*, not linked
to the agent. `SocialIntelligenceAgent.activeExperimentIds` exists but is
never written (M-2). Not blocking — the join through `profileIds` works.

---

## 15. CreatorOS Boundary

**No duplication whatsoever.** Verified by search across the intelligence
layer:

| CreatorOS responsibility | Duplicated? |
| --- | --- |
| Publishing / scheduling | No — `CreatorOsExecutionHandoff` records intent only |
| OAuth / platform authentication | No — no tokens, no credentials, no `process.env` |
| Analytics retrieval | No — `measurement` ingests what is handed to it |
| Message / comment APIs | No |
| Webhooks | No |
| Skills delivery | No — `research` models skills as `StrategyClaim` inputs |
| Workspace provisioning | No |

No `fetch`, no HTTP client, no `child_process`, no network call anywhere in
`src/intelligence/`. Node imports are `node:crypto` (id generation, ×10) and
`node:fs`/`node:path` confined entirely to the JSONL adapter.

The intended model holds exactly:

```
INTELLIGENCE ENGINE  decides / prepares
        → CreatorOsExecutionHandoff
        → CreatorOS executes
        → analytics return
        → ingestMeasurementSnapshot
        → Science → Finding → refreshed prescription
```

Handoff requires **both** an approved action **and** a covering permission —
approval alone is insufficient, verified by test.

---

## 16. Platform Neutrality

**Perfect.** A search for `'threads'`, `'twitter'`, `'linkedin'`,
`'instagram'`, `'tiktok'`, `'youtube'`, `'facebook'` and `'reddit'` as
string literals across all production intelligence code returns **zero
matches**. All 169 occurrences are test fixtures.

Platform is carried as the CreatorOS `Platform` union, treated everywhere as
a contextual variable rather than a hierarchy. The Genome can represent
multi-platform replication without ever concluding that one platform is
universally superior.

A three-platform mission (Threads + X + LinkedIn) is representable today:
`AgentMission.platformScope` is a `Platform[]`, and the living prescription
emits one `PlatformAllocation` per platform in scope.

---

## 17. Business-Objective-First

**Holds throughout.** No layer optimizes followers, likes or views by
default:

- **Science** — `metricsForObjective()` maps objective → metrics via
  `DEFAULT_OBJECTIVE_METRICS`; `assessExperimentOutcome` requires the *right
  metric for the objective* before declaring a winner.
- **Adaptive** — recommendations carry `objective`; `resolveObjectiveMetrics`
  is imported from Science rather than reinvented.
- **Genome** — `objective` is a first-class field; a reach-scoped pattern
  does not answer a revenue query, and caveats state *"engagement evidence is
  not commercial evidence."*
- **Transfer** — `objective_mismatch` is an explicit negative-transfer
  reason.
- **Agentic** — `AgentMission.primaryObjective` drives the prescription;
  `PlatformAllocation.objective` inherits it.

**Revenue is never inferred from engagement.** Verified: a post with 500,000
views, 40,000 likes and 3,000 replies yields `revenue: 0`, `sales: 0`,
`attributionQuality: 'none'` and the note *"Revenue is never inferred from
platform analytics."*

---

## 18. Money / Attribution

| Step | Status |
| --- | --- |
| post | `PostMeasurement` |
| → click | `AttributionEvent` with `trackingContext` (UTM) |
| → lead | `eventType: 'lead'` |
| → sale | `eventType: 'purchase' \| 'repeat_purchase'` |
| → revenue | `value` + ISO-4217 `currency` |

Confirmed properties:

- Platform analytics and revenue are **structurally separate stores**.
- First-party attribution is a distinct entity with `evidenceSource:
  'first_party'`.
- Attribution uncertainty is represented: `attributionMethod: 'unknown'`
  produces `attributionQuality: 'unknown'` and caps the evidence state at
  `suspect`, never `know`.
- Partial attribution is reported honestly ("1 of 2 event(s) have unknown
  attribution").
- Refunds are **not** currently representable — `AttributionEventType` has no
  refund/chargeback member. (Debt M-7.)

**External integrations still required:** payment processor (Stripe et al.)
for real purchase events, CRM for lead qualification, and a link-tracking
service for click attribution. None is built, and none is faked.

---

## 19. Action / Autonomy Safety

Every §42 control was verified structurally, several adversarially:

| Control | Result |
| --- | --- |
| Default autonomy bounded | `copilot`, never higher |
| Agent cannot self-upgrade | `setAutonomyLevel` requires `actor.kind === 'human'`; agent attempt returns an error and leaves stored autonomy at `copilot` |
| Restricted cannot auto-execute | `test_offer` **and any unrecognized action type** → `restricted`; requires approval at every level including `autonomous_lab` |
| Spending disabled | `spendActionsAllowed: false` typed as the literal `false` — the compiler rejects enabling it |
| Offer/pricing disabled | `offerChangesAllowed: false`, same technique; `isActionPermitted('test_offer')` returns `false` unconditionally |
| Controlled experiments protected | See §20 and fix F-1 |
| Approval ≠ executable | Verified adversarially: a human **approves** a restricted action and the handoff is still refused |
| Handoff needs approval + policy | `canHandOffToCreatorOs` requires both |
| Human override preserves proposal | Rejection appends to `humanDecisions`; the agent's original `reason` is unchanged |

The adversarial test that matters most — *human approves a restricted
action, does the system comply?* — is in the integration suite and the
answer is no.

---

## 20. Active Experiment Integrity

**One real defect found and fixed during this audit.**

`AdaptiveStrategyEngine` correctly derives locks from stored experiments:
`evaluateStrategyConstraints` reads each in-flight experiment's
`design.controlVariable` and `design.testVariables` and emits an
`active_experiment` constraint. "In flight" means published with no results
yet.

`AgenticPrescriptionEngine.runDecisionCycle`, however, accepted
`lockedVariables` **only as a caller-supplied parameter** and never derived
them. An ordinary `runDecisionCycle()` call therefore proposed actions with
zero experiment protection — the agent silently failed to defend a running
experiment whenever the caller forgot to say one existed.

**Fix F-1 applied** (small, confined to `src/intelligence/agentic/engine.ts`,
uses an existing method on an engine the agent already holds):

- New `lockedVariablesFor(profileId)` reads locks from Adaptive Strategy's
  constraint evaluation rather than re-implementing the concept.
- `runDecisionCycle` now unions derived locks with any caller-supplied ones.
- The `experiment_incomplete` diagnostic names the locked variables.

Two regression tests cover it: locks are derived from a stored in-flight
experiment with no argument passed, and they are released once the
experiment carries results.

Remaining route to contamination: `buildLivingPrescription` does not consult
locks when emitting `platformStrategy`. A prescription rebuild mid-experiment
could shift platform allocation. Low risk (allocation is currently an even
split) but worth closing. (Debt M-8.)

`BattleEngine` respects its own pre-registration model and has no route into
the agent's action queue, so it cannot contaminate anything.

---

## 21. Social Genome Readiness

`GenomeContext` covers twelve dimensions, and `GenomePattern` adds
replication, contradiction and recency:

| Required dimension | Present |
| --- | --- |
| platform | `platforms` |
| niche | `niches`, `subNiches` |
| audience | `audienceDescriptors` |
| objective | `objectives` + first-class `objective` field |
| content format | `contentFormats` |
| content pillar | `contentPillars` |
| hook family | `hookFamilies` |
| CTA | `ctaTypes` |
| offer | `offerTypes` |
| funnel stage | `funnelStages` |
| recency | `firstObservedAt` / `lastObservedAt` / `freshness` |
| evidence replication | `sourceProfileCount`, `sourceExperimentCount` |
| contradictions | `contradictingEvidence`, `contradictionRatio`, `contested` status |

**No critical dimension is missing.** The Genome is structurally ready; it
is the *wiring* that is absent (H-2).

---

## 22. Cold-Start Readiness

Traced against real code with a bookkeeping customer, no history of any
kind:

| Step | Status |
| --- | --- |
| Onboard profile | **Works** — `onboardProfile` is pure and deterministic |
| Create mission | **Works** — business objective, platform scope, constraints |
| Represent UNKNOWN | **Works** — `unknown` evidence state, `unknowns[]` with `howToResolve` |
| Retrieve candidate Genome knowledge | **ABSENT** (H-2) — the agent never queries the Genome |
| Transfer assessment | **Partial** (H-4) — assessments are consumed if present; nothing produces them |
| Cautious Adaptive Strategy | **Works** — yields exactly one `collect_more_evidence` recommendation |
| Living prescription | **Works** — `cold_start` maturity, every platform `testRequired: true` |
| Recommend an initial experiment | **Partial** — the plan proposes evidence collection; experiment proposals depend on hypotheses that Transfer would normally seed |
| Avoid claiming first-party validation | **Works** — `know: 0` |

**Verdict:** cold start is honest but thin. The system correctly says "I
don't know yet, let's find out" — but the two mechanisms designed to make
cold start *useful* (Genome candidates and Transfer seeding) are not
connected. A first customer would get a defensible but sparse first week.

---

## 23. Mature-Profile Readiness

Traced with 90 days of measurements, multiple findings, attribution and
contradictory evidence:

| Question | Answer |
| --- | --- |
| Does own evidence dominate transferred advice? | **Yes.** Two validated first-party findings move maturity from `transferred_intelligence` to `profile_informed`, and platform `evidenceState` from `unknown` to `know`, while a peer transfer at 0.95 confidence stays `suspect` |
| Is contradictory evidence retained? | **Yes.** A validated and a rejected finding on the same statement coexist as `know` and `stopped`; neither is deleted |
| Does decay trigger revalidation? | **Yes.** `assessFindingFreshness` feeds the `finding_decay` refresh trigger |
| Does attribution reach the prescription? | **Partial.** `getBusinessOutcomeState` is exposed on `AgentState` but does not influence `platformStrategy` or content allocation |

**Verdict:** the mature path is the stronger of the two. The evidence
hierarchy demonstrably works. The gap is that business outcomes are
*reported* but do not yet *steer* the prescription.

---

## 24. Prescription Update Loop

**Fully implemented and verified end-to-end:**

```
experiment completion
  → ScienceEngine.evaluateHypothesis          ✓ real evaluation
  → ScienceEngine.emitFinding                 ✓ emits, or honestly refuses
  → assessPrescriptionRefresh                 ✓ 'refresh_required'
  → buildLivingPrescription                   ✓ version 2
  → previous version retained                 ✓ status 'superseded'
  → AgentChangeRecord                         ✓ with reason and before/after
```

Every hop is exercised in `tests/intelligenceEndToEnd.test.ts`. The
`changeSummary.evidenceAdded` array names the specific finding that caused
the rebuild.

**Not conceptual — this loop is real.** The only part still manual is that
nothing *schedules* the cycle; a caller must invoke it.

---

## 25. "What Should I Do Today?" Readiness

`buildTodaysPlan(agentId, profileId)` returns:

| Element | Status |
| --- | --- |
| Mission statement | READY |
| Proposed actions with status and priority | READY |
| Content briefs | READY — pattern-level, explicitly *"not evidence"* |
| Active experiment context | PARTIAL — only experiments already in the prescription's plan with `status: 'active'`, which nothing currently sets |
| Approvals required | READY |
| Why / evidence | READY via `explainAgentAction` |
| Honest no-action state | READY — *"Nothing to do today"* |

Verified at cold start: the plan returns the mission, `know: 0`, and a single
`collect_more_evidence` action. It does not invent work.

---

## 26. "Why?" Readiness

`explainAgentAction(actionId)` returns mission objective, evidence state,
evidence references, confidence, constraints, limitations, open unknowns and
a peer-evidence note.

| Explanation source | Available |
| --- | --- |
| Profile `Finding` | Yes |
| Segment `Finding` | Yes (`segmentFindingIds`) |
| `GenomePattern` | Field exists, **always empty** (H-2) |
| `TransferAssessment` | Yes |
| Adaptive recommendation | Yes (`strategyRecommendationIds`) |
| Science evidence | Yes (`experimentIds`, `hypothesisIds`) |
| Limitations | Yes |
| Constraints | Yes |

**Peer privacy holds.** Where transfer or Genome evidence contributed, the
explanation carries *"Where comparable-profile evidence contributed, it is
summarized in aggregate. No other business is identified."* Verified by
asserting no peer finding id appears anywhere in the serialized explanation.

---

## 27. Public Social Money Lab Readiness

| Surface | Status | Note |
| --- | --- | --- |
| Live Battle | NEEDS PUBLIC-SAFE ADAPTER | Battle types complete; no public read model, no engine consumer |
| Season progress | NEEDS PUBLIC-SAFE ADAPTER | `BattleSeason`, `BattleRound` exist |
| Money Board | NOT AVAILABLE | Would expose per-competitor revenue; no public projection exists and none should be built without an explicit consent model |
| Findings (public) | NEEDS PUBLIC-SAFE ADAPTER | `PublicGenomePattern` is the right vehicle and is already safe — but nothing populates the Genome |
| Leaderboard | NEEDS PUBLIC-SAFE ADAPTER | `BattleCategoryResult`, `BattleOutcome` exist |
| Lab alerts | NOT AVAILABLE | No event/notification concept anywhere |
| Fastest sale | NOT AVAILABLE | Requires cross-customer attribution comparison — privacy-sensitive |
| "We were wrong" | NEEDS PUBLIC-SAFE ADAPTER | `findContested()` and rejected findings are the natural source; genuinely a strong asset |

**Only `PublicGenomePattern` is publication-safe today.** Everything Battle-
related would need a deliberate public projection type built the same way —
a separate type, not a filtered view.

---

## 28. Private "My Lab" Readiness

| Surface | Status | Backed by |
| --- | --- | --- |
| My Prescription | READY | `getCurrentPrescription`, `getPrescriptionExport` |
| Today's Plan | READY | `buildTodaysPlan` |
| My Experiments | PARTIAL | `Experiment` store exists; no per-agent experiment read model |
| My Audience | PARTIAL | `ObservedAudienceSegment` exists; no producer wired |
| My Money Board | PARTIAL | `getBusinessOutcomeState` works; depends on external payment integration |
| What We've Learned | READY | `getEvidenceStateSummary` |
| Agent activity | READY | `getChangeLog` |
| Approvals | READY | `buildAgentState().pendingApprovalActionIds`, `approveAction`, `rejectAction` |
| Reports | PARTIAL | `PrescriptionExport` is serializable; no renderer (by design) |

The private surface is markedly more ready than the public one — which is
the right order, since the private product is the one that generates the
evidence the public product displays.

---

## 29. Performance / Scale Risks

The JSONL adapter reads and parses **the entire file on every query**
(`readLatestByKey`), with no index, no pagination and no compaction. Cost is
O(total records ever written), not O(records returned).

| Scale | Assessment |
| --- | --- |
| 20 Season accounts | Comfortable. Files stay in the low megabytes |
| 100 customers | **First constraint.** Measurement files reach hundreds of MB; every `listFindings` parses all of it. Cross-profile Genome aggregation degrades noticeably |
| 1,000 customers | Not viable. Multi-GB single-file reads per query |
| Large measurement histories | The dominant term — snapshots + observations grow per post per capture |
| Genome aggregation | Reads all patterns then filters in memory |
| Agent action history | Grows per decision cycle; unbounded |

**The migration path is already correct.** Because no production file
imports `JsonlIntelligenceStore` and all thirteen engines depend on
`IntelligenceStore`, swapping in a Postgres adapter is a single new class
plus a construction-site change. **No migration is recommended now** — do it
when the first real workload demands it, not before.

---

## 30. Data Retention / Growth

Fastest-growing stores, in order:

1. `measurement-snapshots.jsonl` + `post-measurements.jsonl` — two records
   per post per capture
2. `audience-signals.jsonl` — append-only, one per interaction
3. `agentic/actions.jsonl` — every proposal, plus a full rewrite per decision
4. `agentic/change-log.jsonl` — append-only, never pruned
5. `agentic/execution-handoffs.jsonl`
6. `experiment-results.jsonl`

Future requirements (**not implemented, correctly**): time-based
partitioning for measurements, compaction for upsert-style stores where only
the latest line is read, an index on `profileId`, and an archival policy for
change logs. All are adapter concerns and none touches the domain model.

---

## 31. Security Audit

**Clean. No findings.**

- No API keys, secrets, passwords, bearer tokens, authorization headers or
  `process.env` reads anywhere in `src/intelligence/`.
- No network capability: no `fetch`, no HTTP client, no `child_process`, no
  `exec`. The single `https?://` occurrence is a URL-normalization regex in
  `onboarding/validate.ts`.
- Filesystem access is confined to the JSONL adapter (`node:fs`,
  `node:path`). The entire domain layer is pure.
- No customer identifiers leak into public read models (§13).
- `CreatorOsMeasurementSnapshot.rawMetrics` is documented as never
  containing secrets, and the ingest path does not copy credentials.

No secret values were encountered, so none are reported.

---

## 32. Privacy Audit

**Clean.** A search for race, ethnicity, religion, sexual orientation,
gender, medical/health, disability, political affiliation, criminal history
and pregnancy across all production intelligence code returns **zero
matches** outside explicit prohibition comments.

Audience modelling is aggregate and behavioural: `ObservedAudienceSegment`
carries `descriptors` such as `solo-operators`, plus signal counts. There is
no individual visitor dossier type anywhere, and no per-person record.

Behavioural segmentation is not sensitive profiling here, and the type
system does not offer a place to put sensitive traits even if someone tried.

---

## 33. Open-Source / Brand Separation

**License:** MIT (`LICENSE`, `"license": "MIT"` in `package.json`,
"Copyright (c) 2026 Kairos contributors"). The package is not marked
`private`. MIT text permits use, modification, distribution and commercial
use, and requires that the copyright notice and permission notice be
retained in copies or substantial portions. **This is a factual reading of
the repository, not legal advice — a commercial launch built on this
foundation warrants review by a lawyer**, particularly regarding CreatorOS's
own licensing, which is a separate third party and was not audited here.

**Brand boundary:**

| Layer | Name | Customer-facing? |
| --- | --- | --- |
| Open-source foundation | Kairos | No |
| Third-party infrastructure | CreatorOS | No |
| Customer product | Social Money Lab | Yes |

Internal technical names safe to retain: every type and module in
`src/intelligence/` (`GenomePattern`, `SocialIntelligenceAgent`,
`ScienceEngine`, `kairos/intelligence/*.jsonl` paths). These are
implementation detail and renaming them would be pure churn.

Surfaces the future app must **not** expose: the `Kairos` name in customer
UI, `kairos` in public URL paths or API routes, `KAIROS_*` in customer-facing
document titles, and CreatorOS branding in customer-facing copy (it is
infrastructure the customer did not buy).

`docs/KAIROS_INTELLIGENCE_ARCHITECTURE.md` is correctly an internal
engineering document and needs no rebranding.

---

## 34. Testing Assessment

| Suite | Tests |
| --- | ---: |
| `intelligenceAgenticPrescription` | 169 |
| `intelligenceGenome` | 107 |
| `intelligenceBattle` | 84 |
| `intelligencePrescription` | 77 |
| `intelligenceScience` | 65 |
| `intelligenceTransfer` | 62 |
| `intelligenceAdaptive` | 58 |
| `intelligenceMeasurement` | 49 |
| `intelligenceResearch` | 48 |
| `intelligenceAudience` | 38 |
| **`intelligenceEndToEnd` (new)** | **37** |
| `intelligenceOnboarding` | 32 |
| `intelligenceStorage` | 25 |
| `intelligenceContentDna` | 24 |
| `intelligence` | 21 |
| **Total** | **896** |

**Quality findings:**

- **Weak conditional assertions: one remaining** (`intelligenceBattle.test.ts:698`,
  guarded on `battleVerdict === 'winner'`). One more was found and removed
  during this audit — an integration test that wrapped its assertion in
  `if (finding)`. Probing revealed the finding was **never emitted**; the
  test was passing vacuously. It is now split into two tests that assert both
  the emission and the refusal.
- **A fixture bug was found and fixed** in the new suite: treatment posts
  reused baseline post ids and silently overwrote them.
- **Type-only tests: none material.** 22 uses of `toBeDefined()` /
  `not.toBeNull()` across 896 tests, nearly all as guards preceding a real
  assertion.
- **Fake-store gaps: none.** Every engine has a port-discipline test proving
  it works against a minimal fake.
- **The real gap was integration**, now addressed: before this audit, every
  intelligence suite tested one module in isolation, and no test chained two
  engines together.

The new suite deliberately **asserts two gaps rather than faking them** — the
Genome is not wired to the agent, and findings are not workspace-scoped. Both
tests will fail when those gaps close, which is the intent.

---

## 35. Architectural Debt

### BLOCKER (for MVP — not for freeze)

**B-1 · No tenant boundary below Milestone 12**
*Modules:* `storage`, `profiles`, and every pre-M12 domain module.
*Consequence:* the first HTTP endpoint over `listFindings` / `listProfiles` /
`listExperiments` can serve one customer another's data.
*Fix:* add `workspaceId` to `SocialProfile`; make it required on
scope-bearing queries; resolve profile→workspace at the port.
*Before MVP:* **Yes — first.**

**B-2 · No service boundary or consumer**
*Modules:* all.
*Consequence:* 14,899 LOC that nothing can call. No API, CLI, tool or page.
*Fix:* a thin read/command service layer (see §37).
*Before MVP:* **Yes — this is the MVP.**

### HIGH

**H-1 · Two parallel prescription vocabularies**
*Modules:* `prescription`, `agentic`, `index`.
*Consequence:* ~11 duplicated concepts both publicly exported, with no
marker of which is current; `OfferPrescription` guidance was lost in M12.
*Fix:* deprecate the static module, stop exporting it, migrate
`OfferPrescription` into `offerStrategy`.
*Before MVP:* stop exporting — yes. Delete — later.

**H-2 · Social Genome is orphaned from the customer path**
*Modules:* `genome`, `agentic`.
*Consequence:* M11 (1,298 LOC) delivers no customer value.
`genomePatternIds` is threaded everywhere and always empty; `genomeCount: 0`
is hardcoded into maturity. Cross-profile learning — the Social Money Lab
flywheel — cannot reach a prescription.
*Fix:* have the agent query the Genome for candidates and route each match
through Transfer (which already caps them at `suspect`).
*Before MVP:* **Yes**, if the product claims cross-customer learning.

**H-3 · Battle Engine has no consumer**
*Modules:* `battle`.
*Consequence:* no path from a Season result into Genome or Transfer, so
Season 1 would generate no durable knowledge.
*Fix:* feed `BattleOutcome` into `GenomePattern` evidence with season and
protocol provenance intact.
*Before Season 1:* Yes. *Before MVP:* No.

**H-4 · Transfer producer never invoked**
*Modules:* `transfer`, `agentic`.
*Consequence:* the agent reads `TransferAssessment` records, but nothing
creates them, so cold start never receives peer-informed candidates.
*Fix:* call `IntelligenceTransferEngine` during the decision cycle for
cold-start profiles.
*Before MVP:* **Yes** — cold start is the first customer experience.

### MEDIUM

**M-1 · Evidence double-counting in the agent's tally** — a finding, a
transfer derived from it, and an open hypothesis on the same subject produce
three entries in `getEvidenceStateSummary`. Display inflation only; no
promotion is affected. *Fix:* dedup by lineage/subject. *Before MVP:* yes,
it is customer-visible.

**M-2 · `activeExperimentIds` declared three times, written never** —
`ProfileBrain`, `SocialIntelligenceAgent`, `AgentState`.
`experimentsRunning` is permanently 0. *Fix:* derive from the `Experiment`
store, as F-1 now does for locks.

**M-3 · Unpopulated Milestone 12 fields** — `ctaStrategy`, `offerStrategy`,
`actionIds`, `buyerSegmentIds`, `conversationSegmentIds`,
`recommendationsAdded/Removed` are always empty; `informationGain` is a
hardcoded `0.6`. *Fix:* populate or remove — an always-empty field reads as
a bug.

**M-4 · `onboarding/validate.ts` is a de-facto shared utility module** —
`research` and `measurement` import `normalizeUrl` / `isKnownPlatform` from
it. *Fix:* extract to `common/validate.ts`.

**M-5 · `ProfileBrain` embeds stale materialized copies** —
`performanceBaselines` and `strategyMemory` duplicate authoritative stores
and no code refreshes them.

**M-6 · JSONL reads the whole file per query** — see §29.

**M-7 · Refunds are not representable** — `AttributionEventType` has no
refund or chargeback member, so revenue can only go up. Material for a
commercially focused product.

**M-8 · `buildLivingPrescription` ignores experiment locks** — a rebuild
mid-experiment could shift platform allocation. Low risk today because
allocation is an even split.

### LOW

**L-1** One guarded assertion remains (`intelligenceBattle.test.ts:698`).
**L-2** No archival or compaction policy for append-only stores.
**L-3** `PrescriptionExport` has no renderer — by design, but the MVP will
need one.
**L-4** `Finding.sourceExperimentIds` has no referential integrity.

---

## 36. Fix Applied During This Audit

**F-1 · Agent now derives experiment locks instead of trusting the caller**

*File:* `src/intelligence/agentic/engine.ts`

`runDecisionCycle` accepted `lockedVariables` only as a parameter. An
ordinary call therefore proposed actions with no experiment protection at
all. Added `lockedVariablesFor(profileId)`, which reads locks from
`AdaptiveStrategyEngine.evaluateStrategyConstraints` rather than
re-implementing the concept, and unioned them with any caller-supplied
locks. Two regression tests added.

This met the §42 bar: small, clear, safe, confined to
`src/intelligence` + `tests`, and necessary for architectural correctness.
Everything else in §35 is reported, not fixed.

---

## 37. Freeze Decision

## **READY TO FREEZE WITH SMALL FIXES**

The intelligence architecture is coherent, safe and internally consistent.
Boundaries are enforced by types rather than convention; privacy, security
and platform neutrality are clean; the evidence hierarchy demonstrably works
end to end. **No new intelligence-engine concepts are needed before real-world
use.** The system's remaining problems are all of the form *"this correct
component is not connected to that correct component"* — integration, not
invention.

### Freeze rules

**Allowed after freeze:**
- Bug fixes.
- Security and privacy fixes.
- Integration gaps — specifically B-1, B-2, H-1 through H-4.
- Performance fixes and the storage-adapter migration.
- Changes driven by actual Season 1 or customer evidence.

**Not allowed after freeze:**
- New conceptual engines without product evidence demanding them.
- New domain modules under `src/intelligence/`.
- Extending the deprecated static prescription module.
- A thirteenth milestone of the same kind as 1–12.

### The test of a post-freeze change

*Does a real customer or a real Season result require this?* If the answer
is "it would make the architecture more complete", it is out of scope.

---

## 38. Social Money Lab MVP Backend Contract

Derived from what the code actually provides today.

### Public read contract — publication-safe

| Operation | Backing | Status |
| --- | --- | --- |
| `getPublishedFindings()` | `SocialGenomeEngine.query()` → `PublicGenomePattern[]` | **READY** — the one safe public model |
| `getPublishedContestedFindings()` | `findContested()` | READY — powers "We were wrong" |
| `getPublishedSeason(seasonId)` | `BattleSeason`, `BattleRound` | Needs a `PublicSeason` type |
| `getPublishedBattles(seasonId)` | `BattleMatchup`, `BattleOutcome` | Needs `PublicBattle` |
| `getPublishedLeaderboard(seasonId)` | `BattleCategoryResult` | Needs `PublicStanding` |
| `getPublishedMoneyBoard(seasonId)` | — | **Do not build without an explicit competitor consent model** |

Every public type must be a **separate type, never a filtered view** — the
`PublicGenomePattern` pattern, so a future field cannot leak by omission.

### Private customer contract

| Operation | Backing | Status |
| --- | --- | --- |
| `getMyAgentState()` | `buildAgentState` | READY |
| `getMyPrescription()` | `getCurrentPrescription` | READY |
| `getMyPrescriptionHistory()` | `getPrescriptionHistory` | READY |
| `getMyTodaysPlan()` | `buildTodaysPlan` | READY |
| `getMyEvidence()` | `getEvidenceStateSummary` | READY |
| `getMyMoneyBoard()` | `getBusinessOutcomeState` | READY (needs payment integration for data) |
| `getMyApprovals()` | `listAgentActions({ status: 'awaiting_approval' })` | READY |
| `approveAction` / `rejectAction` / `deferAction` | engine methods | READY |
| `explainAction(actionId)` | `explainAgentAction` | READY |
| `getMyActivity()` | `getChangeLog` | READY |
| `getMyReport()` | `getPrescriptionExport` | READY (needs a renderer) |
| `runMyDecisionCycle()` | `runDecisionCycle` | READY |
| `getMyExperiments()` | — | **Needs a read model** |
| `getMyAudience()` | `listObservedSegments` | Needs a read model + a signal producer |

**Every private operation must take a workspace context and enforce it —
B-1 must land before any of this is exposed.**

---

## 39. Recommended Social Money Lab App Boundary

## **Recommendation: B — a separate repository consuming this backend.**

| Consideration | Weight |
| --- | --- |
| Open-source branding | Kairos is MIT and public; Social Money Lab is commercial IP. Keeping the product in this repo publishes the business logic |
| Deployment | The intelligence layer has no runtime; the app needs one. Different artifacts, different cadences |
| Security | Customer auth, sessions and payment credentials must not live in a public repository |
| Auth | Nothing here does authentication, correctly. That belongs to the app |
| Customer isolation | B-1 must be enforced at the service boundary — cleanest as a deliberate seam between repos |
| Release cadence | The engine should move slowly (that is the point of the freeze); the product will move fast |
| CreatorOS dependency | The app talks to CreatorOS for execution and to this layer for decisions — two dependencies, neither owning the other |
| Commercial IP | The most decisive factor: the moat is the *product*, and MIT does not protect it |

**Shape:** publish this repository's intelligence layer as a versioned
package; the Social Money Lab application depends on it, adds the tenant
boundary, authentication, HTTP surface, rendering and CreatorOS wiring.

The one argument for A (a package inside this repo) is easier iteration
while the contract is unstable. That is real, and a short in-repo phase to
stabilize the service contract before extraction is defensible — but the
commercial-IP argument should decide the destination.

**Do not scaffold yet.**

---

## 40. Pre-MVP Fix List, In Order

1. **B-1** — Add `workspaceId` to `SocialProfile`; require it on scope-bearing
   store queries; resolve profile→workspace at the port. *Nothing customer-
   facing ships before this.*
2. **B-2** — Define the service layer of §38 (private contract first).
3. **H-4** — Invoke `IntelligenceTransferEngine` in the decision cycle so
   cold start receives peer-informed candidates.
4. **H-2** — Query the Genome for candidates and route matches through
   Transfer, so cross-profile learning reaches a prescription.
5. **H-1** — Stop exporting the static prescription types; add a deprecation
   header; migrate `OfferPrescription` into `offerStrategy`.
6. **M-1** — Deduplicate the agent's evidence-state tally by lineage.
7. **M-3** — Populate or remove the always-empty M12 fields.
8. **M-7** — Add refund/chargeback attribution event types.
9. **M-2 / M-8** — Derive `activeExperimentIds` from the store; make
   `buildLivingPrescription` respect experiment locks.
10. **L-3** — Build a renderer for `PrescriptionExport`.

**Before Season 1 (not before MVP):** H-3 — route Battle outcomes into the
Genome with season and protocol provenance.

**When real load demands it (not before):** M-6 — Postgres adapter behind the
existing port.
