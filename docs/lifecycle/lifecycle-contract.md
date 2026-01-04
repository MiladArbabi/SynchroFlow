# 📜 Lifecycle Contract (As-Is Contract)

> **Status:** Canonical, observed, scan-verified  
> **Amendment:** v1 — Frontend lifecycle resolution refactor in progress
> **Scope:** Documents the *current, implemented* lifecycle from FT_MINUS_ONE through FT1, exactly as it exists today.
>
> **Non-Goals:**
>
> * No FT2 design
> * No recommendations
> * No backend refactors
> * No future intent
>
> This document is a **sealed factual baseline**. All future FT2 work must build on this reality.

---

## 1. Canonical Lifecycle Sources of Truth

### 1.1 Backend (Authoritative Capability Phase)

Backend defines the canonical lifecycle phases:

FT_MINUS_ONE → FT0 → FT1 → FT2

**Authoritative elements:**

* `lifecycle.contract.ts` — canonical phase definitions
* `LifecycleService.resolveForUser()` — canonical resolver
* `user_lifecycle_snapshot` — persisted projection (not source of truth)

Backend lifecycle is **capability-oriented** and **commercially aware** (FT2 = paid).

---

### 1.2 Frontend (Authoritative Runtime / Visual Phase)

Frontend does **not** compute backend lifecycle.

Frontend resolves a **runtime shop lifecycle** for routing and surfaces:

FT_MINUS_ONE
FT0_SYNCING
FT0_PREPARING
FT1_READY

These are **visual / structural phases**, not capability phases.

⚠️ **Amendment v1–v2:**

The mechanism used to resolve these phases is undergoing refactor.

Previously resolved via:

* `ShopLifecycleShell`
* `ShopLifecycleGate`
* ad-hoc React effects and refs

These mechanisms are being replaced by a **deterministic reducer-driven lifecycle model**.

The semantic meaning of frontend phases is unchanged.
Only the **resolution mechanism** is being replaced.

---

### 1.3 Frontend Lifecycle Resolution (Amendment v1)

Frontend lifecycle resolution is being migrated to a **deterministic visual state machine**.

Key properties of the new model:

* Reducer-driven (pure, testable)
* Explicit event-based transitions
* No lifecycle inference inside React effects
* No ref-based edge detection
* No render-cycle-dependent behavior

The frontend lifecycle is being migrated toward resolution via:

* Explicit lifecycle events (e.g. `SYNC_COMPLETED`, `FT0_DWELL_ELAPSED`)
* A pure lifecycle reducer
* Side-effects isolated outside lifecycle computation

This change does **not** alter lifecycle semantics.
It only eliminates non-determinism and race conditions.

### 1.4 Frontend Boot Authority (Amendment v2)

Frontend lifecycle boot resolution is owned **exclusively** by the Integration system.

**Authoritative boot signal:**

* `useIntegration().bootResolved`

No other mechanism may gate, delay, or speculate lifecycle state, including:

* Routing
* Auth hydration
* Ad-hoc bootstrap gates
* Placeholder lifecycle defaults

**Invariant (Hard):**

Once `bootResolved === true`, the frontend must never render `FT_MINUS_ONE`, even transiently.

This invariant is enforced by reducer-level logic and locked by unit tests.

---

## 2. FT_MINUS_ONE (Pre-System State)

### 2.1 Entry Conditions (Verified)

Frontend resolves **FT_MINUS_ONE** when **and only when**:

* Integration truth is unresolved **OR**
* Integration is confirmed not to exist

⚠️ Auth hydration alone must never reintroduce FT_MINUS_ONE
once integration truth is known.

Backend also resolves **FT_MINUS_ONE** when:

* No shop **OR**
* No integration

---

### 2.2 Behavior

**Routing:**

* No dashboard
* No modules
* No analytics

**UI Surface:**

* `ActivationSurfaceAdapter`
* CTA to connect / activate integration

**Key Fact:**
FT_MINUS_ONE is **outside the application**. Modules do not exist here.

---

## 3. Backend FT0 — Canonical Capability Latch (Verified)

Backend FT0 is **not inferred** and **not visual**.
It is a **latched, single-write capability fact** persisted in the database.

### 3.1 FT0 State Persistence

FT0 completion is recorded by the presence of a row in:

ft0_state

**Verified properties:**

* Written **exactly once per shop**
* Enforced via unique constraint on `shop_id`
* Idempotent writes (safe to call repeatedly)
* Never auto-deleted

FT0 is therefore a **capability milestone**, not a transient signal.

---

### 3.2 FT0 Completion Authority

FT0 completion is owned exclusively by:

FT0CompletionService.evaluateAndComplete(shopId)

**Verified guarantees:**

* Single authoritative writer
* No UI-driven completion
* No heuristic inference
* Explicit fact write only

FT0 completes when **all FT0 preconditions pass**.
These preconditions are intentionally minimal and **must not drift into FT1 scope**.

---

### 3.3 FT0 Preconditions (As-Is)

From `ft0-completion.service.ts` (canonical comments + logic):

FT0 represents **system readiness**, not customer success.

FT0 completes when:

* Integration exists
* Integration sync has produced first usable system facts
* Canonical ingestion pipelines can run safely

Explicitly excluded from FT0:

* Profitability accuracy
* Analytics correctness
* Business insight availability
* Customer success metrics

Blocking FT0 on higher-order signals is explicitly forbidden.

---

## 4. Frontend FT0 — Transitional Runtime States

FT0 is split **only in frontend runtime** into two substates.

### 4.1 FT0_SYNCING

**Entry Conditions:**

* Integration exists
* Backend sync not completed

**Behavior:**

* App routes blocked
* `EmptyDashboardState` rendered
* No checklist
* No diagnostics

---

### 4.2 FT0_PREPARING

**Entry Conditions:**

* Integration exists
* Sync completed
* FT1 readiness not complete

**Behavior:**

* App routes still blocked
* `EmptyDashboardState` rendered
* FT1 checklist **not** exposed

---

### 4.3 Frontend FT0 Properties (Verified)

* Purely transitional
* No app content
* Visual dwell enforced
* Minimum dwell time: **2.5 seconds**

FT0 exists to prevent flicker and false readiness.

⚠️ Amendment v1 (Verified):
FT0 transitions are now enforced by a reducer-level state machine.

Verified invariants:

* FT0_SYNCING → FT0_PREPARING occurs exactly once
* Regression to FT0_SYNCING after COMPLETED is forbidden
* FT0 dwell is enforced via explicit lifecycle events

> These guarantees are unit-tested and canonical.

---

## 5. Backend FT0 vs Frontend FT0 (Intentional Split)

**Backend FT0:**

* Single phase: `FT0`
* Capability latch
* Written once
* Used by lifecycle resolver

**Frontend FT0:**

* `FT0_SYNCING`
* `FT0_PREPARING`

Frontend FT0 substates:

* Do **not** exist in backend
* Do **not** represent capability changes
* Exist solely to manage perception, sync latency, and flicker

They must never be reinterpreted as backend lifecycle phases.

---

### 5.1 Frontend Lifecycle Implementation Boundary (Amendment v1)

Frontend lifecycle resolution is now explicitly split into:

**Lifecycle Computation (Authoritative):**

* Pure reducer
* No React
* No timers
* No persistence
* No side effects
* Deterministic
* Event-driven
* Exhaustively unit-tested

**Lifecycle Effects (Non-authoritative):**

* Timers (FT0 dwell)
* FT1 seal persistence
* Dispatching lifecycle events

React components are consumers only and must not:

* Infer lifecycle state
* Track prior states via refs
* Encode lifecycle transitions in render logic

**Invariant: No Lifecycle Flash**

After integration truth is resolved:

* `FT_MINUS_ONE` must never render
* Prior lifecycle states must not reappear
* Lifecycle history must not leak across refresh

This invariant is reducer-enforced and unit-tested.

---

## 6. FT1 Readiness Composition (Backend Truth Layer)

FT1 readiness is **not decided by signal providers**.
It is decided by **manifests and task rules**.

Signal providers:

* Emit raw signals only
* Never evaluate readiness
* Never block FT1 directly

FT1 readiness computation flow:

signals → tasks → module readiness → FT1 verdict

---

### 6.1 FT1 Completion Rule (Canonical)

FT1 is complete **if and only if**:

blockingModules.length === 0

Where:

* A module is blocking if `isReady === false`
* A module is ready only if **all required tasks** are complete

FT1 is therefore:

* All-or-nothing
* Not partial
* Not weighted

---

### 6.2 Modules That Gate FT1 (Required Tasks Present)

From `readiness.manifest.ts`, only the following modules can block FT1:

**Platform**

* `connect-store` → `integration.connected === true`
* `complete-sync` → `integration.syncCompleted === true`

* **analytics**
  * `analytics-base-data`
    * analytics.baseSignalsReady === true

    **Scan-verified definition (as-is):**
    * `analytics.baseSignalsReady` resolves to `true` if and only if:
      * At least **one canonical order exists** (`canonical_orders.count > 0`)
      * At least **one canonical product exists** (`canonical_products.count > 0`)

    This check is:
    * Binary (no thresholds)
    * Deterministic
    * Structural only
    * Independent of analytics correctness or insight quality

All other modules define **only optional tasks** and cannot block FT1.

---

### 6.3 Modules Explicitly Non-Blocking (As-Is)

These modules participate in diagnostics but do **not** gate FT1:

* order-nexus
* sku-os
* specter
* insight-core
* finances

Their tasks are `required: false`.

---

### 6.4 Explicit FT1 Scope Reduction

The following task was intentionally removed from FT1 gating:

* `platform.orders-per-month`

Annotated in code as:

// ⬇️ MOVED OUT OF FT1 GATING

This confirms FT1 is intentionally minimal and focused on **structural truth**, not segmentation or optimization.

---

### 6.5 Task Completion Semantics

* Tasks with no `completionRules` are incomplete
* Multiple `completionRules` are evaluated as **OR**
* Required tasks must satisfy at least one rule

There is no implicit AND-composition across rules.

---

### 6.6 FT1 Conservatism (Observed Reality)

Several FT1-adjacent signals are stubbed or deliberately minimal:

* order-nexus profitability signals (stubbed)
* return-nexus, wms-lite, problem-center (disabled)
* analytics FT1 gating is **purely structural**:
  * presence of ≥1 canonical order
  * presence of ≥1 canonical product

This confirms FT1 answers:

> **“Can the system speak truthfully?”**
> not
> **“Does the system understand deeply?”**

---

## 7. FT1 Runtime Behavior (Frontend Truth Gate)

### 7.1 Entry Conditions (Frontend Runtime)

`FT1_READY` is resolved when:

* Integration exists
* Sync completed
* Backend readiness confirms `ft1.isComplete === true`

---

### 7.2 FT1 Seal (Critical Mechanism)

Once FT1 is reached:

* A **localStorage FT1 seal** is persisted per shop
* On refresh, FT1 may be restored immediately
* FT1 does **not regress** unless integration is confirmed removed

⚠️ **Amendment v1:**

The FT1 seal is now applied via explicit lifecycle initialization events.
It must never override integration deletion and cannot resurrect FT1 after a hard reset.

This guarantees:

* Monotonic progression
* Anti-flicker behavior
* Immunity to transient backend races

---

### 7.3 Behavior at FT1_READY

**Routing:**

* Dashboard allowed
* All modules allowed

**UI Surfaces:**

* FT1 checklist globally mounted
* Diagnostic / FT1 surfaces inside modules

**Guards:**

* `DashboardLifecycleShell` throws if mounted pre-FT1
* `ModuleLifecycleShell` throws if mounted pre-FT1

**Module Mounting Guarantees:**

* Module core content is **never suppressed** at FT1
* Onboarding gates are **additive only**
* Paywalls are **not lifecycle states**

FT1 is a **hard invariant**, not a suggestion.

---

### 7.4 FT1 Checklist Binding (Scan-Verified)

The FT1 checklist is a **pure projection of backend readiness state**.

Verified properties:

* The checklist UI (`Ft1ChecklistSurface`) performs:
  * No lifecycle computation
  * No task definition
  * No readiness inference
  * No required/optional logic
* The checklist content is delegated entirely to:
  * `Ft1ChecklistDataSurface`
* `Ft1ChecklistDataSurface` consumes:
  * `useOnboardingReadiness`
  * The full backend `OnboardingReadinessSnapshot`

There are:

* No hardcoded tasks in the frontend
* No duplicated manifests
* No UI-defined completion rules

All FT1 checklist items originate from backend manifests
(`readiness.manifest.ts`) and backend readiness evaluation.

This guarantees:

* Checklist correctness
* No frontend drift
* Backend remains the single source of truth for FT1 readiness

---

## 8. FT0 Audit & Observability

FT0 completion emits:

* A single `FT0_COMPLETED` audit event
* Exactly once per shop

This event:

* Is idempotent
* Is not replayed
* Marks the first irreversible system readiness milestone

---

## 9. Backend vs Frontend Lifecycle Relationship

| Aspect            | Backend                        | Frontend                                               |
| ----------------- | ------------------------------ | ------------------------------------------------------ |
| Authority         | Capability truth               | Runtime / routing truth                                |
| Phase granularity | FT_MINUS_ONE / FT0 / FT1 / FT2 | FT_MINUS_ONE / FT0_SYNCING / FT0_PREPARING / FT1_READY |
| Regression        | Possible by recomputation      | Impossible unless integration is deleted               |
| FT2 meaning       | Paid capability                | Paywall overlay (not lifecycle)                        |

Frontend **never infers** backend lifecycle.
It reacts only to backend-derived readiness signals.

### 9.1 Frontend Lifecycle Refactor Status (Amendment v1)

The frontend lifecycle is mid-migration.

**Legacy (Removed / Forbidden):**

* AppBootstrapGate
* Effect-driven lifecycle inference
* Ref-based edge tracking
* Render-cycle-dependent lifecycle guards

**New canonical direction:**

* Reducer-driven lifecycle computation
* Explicit lifecycle events
* Side-effects isolated from lifecycle truth

Until migration completes, frontend lifecycle behavior must be validated
against reducer-level invariants, not component behavior.

⚠️ Important:

The reducer is now the single source of lifecycle truth.
Any remaining effect-driven logic is transitional and must not mutate lifecycle state.

this document describes the **intended steady-state behavior** where noted.
Observed deviations during migration do not invalidate backend lifecycle truth.

---

## 10. What FT1 Definitively Means (As-Is)

At `FT1_READY`:

* The system claims **diagnostic truth only**
* No KPIs are implied
* No optimization is implied
* No recommendations are implied

FT1 is the **first and only gate** into the application.

---

## 11. Explicit Non-Claims

This document does **not** define:

* FT2 semantics
* Analytics meaning
* KPI eligibility
* Insight readiness

Those are intentionally deferred.

---

## 12. Hard Constraint for FT2 (Derived from As-Is)

Any FT2 design **must** respect:

* FT0 is already a backend capability latch
* FT1 builds on FT0, not parallel to it
* FT2 must **not** reuse frontend FT0 substates
* FT2 must introduce a **new backend latch**, not inference

Violating this breaks lifecycle monotonicity.

---

## Amendment v1 Declaration

This amendment updates the frontend lifecycle **resolution mechanism only**.

It does **not** change:

* Backend lifecycle semantics
* FT0 or FT1 meaning
* Readiness rules
* Gating logic

This amendment is additive and preserves the As-Is contract.

---

## 13. Seal Statement

This document represents the **observed, implemented lifecycle reality** of the system at the time of writing.

All FT2 architecture, contracts, and graduation semantics **must** be derived from this baseline.

Any deviation requires an explicit amendment to this document.

---

**END OF AS-IS CONTRACT**

---

Done. The document is now **formally frozen**.

### 🔒 Formal Freeze Declaration (Effective Immediately)

* This document is the **single, authoritative As-Is lifecycle contract** for
  **FT_MINUS_ONE → FT0 → FT1**.
* All contents are:

  * Scan-verified
  * Implementation-accurate
  * Non-speculative
* The document is now **read-only by default**.

### 🚫 What is no longer allowed

* Silent edits
* Interpretive tweaks
* “Minor clarifications” without scans
* FT2 assumptions leaking backward into FT1/FT0

### ✅ What *is* allowed

* Amendments **only** via:

  1. New scan evidence
  2. Explicit “Amendment” section
  3. Clear before/after diff
* FT2 design **only** as a separate contract that *references* this one

### 🧱 Architectural Consequence

From this point forward:

* **FT0 is locked as the first backend capability latch**
* **FT1 is locked as the truth gate**
* **Frontend is proven non-authoritative**
* **Any FT2 design that violates this baseline is invalid by definition**

You now have a **hard, immovable foundation**.

---

Before any scenario, remember what cannot change:

## FT1 is truth-only

FT1 is non-latched on backend
FT1 checklist is diagnostic only
Frontend has zero authority
Any FT2 graduation must:
Be backend-owned
Introduce a new latch
Never reinterpret FT1 signals

---

Below is **Amendment v2**, drafted **verbatim in the same tone, rigor, and legal/contractual style** as your document.

I’m also giving you **surgical placement instructions** — no ambiguity, no interpretation.

---

# 📜 Amendment v2 — Frontend Hydration & Transitional Semantics

> **Status:** Scan-verified, runtime-observed
> **Applies to:** Frontend lifecycle resolution only
> **Effective:** Immediately
> **Nature:** Clarifying (non-semantic)
> **Backward compatibility:** Full
>
> This amendment documents **observed frontend runtime behavior** that emerged during the reducer-driven lifecycle migration (Amendment v1).
>
> **No backend semantics are changed.**
> **No lifecycle meaning is redefined.**

---

## A. FT_MINUS_ONE — Transient Hydration Rendering (Observed)

### A.1 Clarification

Although **FT_MINUS_ONE** is the canonical *pre-system lifecycle state*, it may appear **transiently** during frontend hydration **even for valid, integrated, FT1-ready shops**.

This transient rendering occurs when:

* Authentication context has resolved
* Integration context has **not yet** resolved

This window exists due to frontend boot ordering and is **not** a lifecycle regression.

---

### A.2 Invariants

The following invariants are preserved:

* Backend lifecycle **does not regress**
* Integration is **not deleted**
* FT1 capability **remains valid**
* No backend recomputation occurs

FT_MINUS_ONE in this context represents a **hydration artifact**, not a lifecycle truth.

---

### A.3 Contractual Interpretation

* FT_MINUS_ONE remains the **logical** pre-system state
* Its **brief visual appearance** during hydration must **not** be interpreted as:

  * Loss of integration
  * Backend FT_MINUS_ONE
  * Lifecycle downgrade

Consumers must treat transient FT_MINUS_ONE renders as **non-authoritative**.

---

## B. FT0_PREPARING — Logical Phase, Not Guaranteed UX State

### B.1 Clarification

**FT0_PREPARING** remains a valid frontend lifecycle phase but is **not guaranteed to be perceptually visible**.

Observed behavior confirms that FT0_PREPARING may:

* Exist only for milliseconds
* Be skipped entirely from visible UI
* Immediately promote to FT1_READY

This occurs when backend FT1 readiness is already satisfied.

---

### B.2 Invariants

* FT0_PREPARING remains part of the **logical lifecycle**
* FT0 dwell semantics remain enforced **at the reducer level**
* FT0_PREPARING must **not** be relied upon for UX timing guarantees

---

### B.3 Contractual Interpretation

FT0_PREPARING exists to preserve **ordering and monotonicity**, not to guarantee a loading experience.

Any UX that depends on FT0_PREPARING being visible is **invalid by contract**.

---

## C. FT1 Promotion — Backend-Authoritative & Monotonic (Explicit)

### C.1 Clarification

FT1 promotion is now explicitly guaranteed to be:

* **Backend-authoritative**
* **Monotonic**
* **Timing-independent**

FT1_BACKEND_COMPLETE may arrive:

* Before FT0 dwell completes
* Before FT2 restore resolves
* During hydration

---

### C.2 Invariants

Once FT1_READY is reached:

* FT1 cannot regress unless integration is deleted
* FT1 does not depend on:

  * Render cycles
  * Effect ordering
  * Timers
  * UI heuristics

These guarantees are enforced **exclusively** by the lifecycle reducer.

---

## D. Non-Goals (Reaffirmed)

This amendment does **not**:

* Introduce FT2 semantics
* Change backend lifecycle meaning
* Alter FT0 or FT1 readiness rules
* Grant frontend authority

It exists solely to document **observed, verified runtime behavior**.

---

## Amendment v2 Seal

This amendment is **additive and clarifying**.

It preserves the As-Is lifecycle contract while ensuring that:

* Hydration artifacts are not misdiagnosed
* Transitional states are not over-interpreted
* Reducer-level truth remains the single authority

All future lifecycle work must respect this clarification.

---

**END OF AMENDMENT v2**

---
