# 📜 DashboardPageFT2 Contract (As-Is / Canonical)

> **Status:** Canonical, scan-aligned
> **Applies to:** `apps/frontend/src/pages/DashboardFT2Page.tsx`
> **Lifecycle Phase:** FT2_READY only
> **Authority:** `LifecycleRouteHost`
> **Nature:** Hard contract (violations are architectural defects)

---

## 1. Purpose & Scope

### 1.1 Purpose

`DashboardPageFT2` is the **authoritative FT2 dashboard surface**.

Its sole purpose is to present a **governed, read-only, system-level observability snapshot** of the platform at FT2.

It answers exactly one question:

> **“What does the system currently observe, with governed confidence?”**

---

### 1.2 Scope

This contract governs:

* Rendering behavior
* Data access rules
* Lifecycle interaction
* UI semantics
* Forbidden behaviors

It does **not** define:

* Backend FT2 semantics
* Analytics meaning
* KPI definitions
* Insight interpretation

---

## 2. Lifecycle Authority (Hard Boundary)

### 2.1 Page-Level Lifecycle Ownership

`DashboardPageFT2` exists **only** when:

```
shopLifecycle.phase === FT2_READY
```

This guarantee is enforced exclusively by:

* `LifecycleRouteHost`

---

### 2.2 Lifecycle Invariants

**HARD RULES:**

* `DashboardPageFT2` **must not**:

  * Read lifecycle state
  * Import lifecycle hooks
  * Branch on lifecycle
  * Infer FT2 eligibility
* Lifecycle correctness is **assumed**, not verified

If lifecycle handling appears in this file, the architecture is broken.

---

## 3. Relationship to FT1 Dashboard

### 3.1 Mutual Exclusivity

`DashboardPageFT2` and `DashboardPageFT1`:

* Must never be mounted together
* Must never share components
* Must never share data hooks
* Must never share UI semantics

This is enforced by **page-level routing**, not by guards.

---

### 3.2 No FT1 Leakage (Critical)

`DashboardPageFT2` must **never**:

* Import FT1 modules
* Import FT1 adapters
* Import FT1 readiness hooks
* Render onboarding CTAs
* Render diagnostic messaging

Any FT1 artifact inside FT2 is a **contract violation**.

---

## 4. Data Model Contract

### 4.1 Single Snapshot Rule (Non-Negotiable)

The FT2 dashboard must consume **exactly one backend snapshot**.

**Allowed:**

* One query
* One adapter
* One render pass

**Forbidden:**

* Aggregating module FT2 snapshots
* Stitching data client-side
* Calling multiple FT2 endpoints

---

### 4.2 Snapshot Semantics

The FT2 dashboard snapshot must be:

* Backend-governed
* Read-only
* Shape-stable
* Nullable by default
* Non-derivative

Frontend responsibilities are limited to:

```
undefined → null normalization
```

No computation.
No inference.
No enrichment.

---

### 4.3 Adapter Rules

The adapter mapping snapshot → UI props must:

* Be pure
* Have zero side effects
* Perform no calculations
* Perform no interpretation
* Never invent meaning

Adapters that “improve” data are invalid.

---

## 5. Rendering Semantics

### 5.1 Allowed UI Semantics

FT2 dashboard UI must be:

* Observational
* Deterministic
* Passive
* Non-directive
* Boring by design

Acceptable content includes:

* Observation windows
* Coverage counts
* System health states
* Confidence indicators

---

### 5.2 Forbidden UI Semantics

The following are **explicitly forbidden**:

* Calls to action (CTAs)
* “Unlock”, “Improve”, “Fix”, “Complete” language
* Recommendations
* Guidance
* Explanations of causality
* Trend derivation
* “Why this matters” copy

If the UI attempts to **help**, FT2 is broken.

---

## 6. Interaction & Navigation Rules

### 6.1 Navigation

FT2 dashboard may include:

* Passive navigation links to FT2 module pages

Navigation must be:

* Optional
* Non-promotional
* Non-progressive

---

### 6.2 Intents

`DashboardPageFT2` must not:

* Emit onboarding intents
* Emit lifecycle intents
* Trigger mutations
* Initiate background jobs

FT2 dashboard is **read-only**.

---

## 7. Error & Loading States

### 7.1 Loading

While snapshot data is unresolved:

* A neutral loading state may be rendered
* No placeholders implying data completeness are allowed

---

### 7.2 Errors

Error handling must:

* Be non-blocking
* Avoid lifecycle messaging
* Avoid remediation guidance

Errors represent **observability gaps**, not user failure.

---

## 8. Structural Constraints

### 8.1 Imports (Hard Rules)

`DashboardPageFT2` must **never** import:

* `useOnboardingReadiness`
* FT1 adapters
* FT1 modules
* Lifecycle hooks
* Checklist components
* AHA adapters

Violations indicate lifecycle contamination.

---

### 8.2 Composition Boundary

FT2 dashboard must **not** be composed of:

* FT2 module components
* Module-level UI reused at dashboard level

Dashboard FT2 is a **first-class surface**, not a container.

---

## 9. Mental Model Guarantee

At FT2, the system promises:

* Truth without guidance
* Observation without prescription
* Visibility without judgment

If the dashboard implies “next steps”, the contract is violated.

---

## 10. Non-Goals (Explicit)

This contract does **not**:

* Define FT2 graduation mechanics
* Define KPI correctness
* Define analytics maturity
* Define optimization readiness

Those belong to **separate contracts**.

---

## 11. Enforcement Notes

Violations of this contract are:

* Architectural defects
* Lifecycle regressions
* Not UX issues

Fixing them requires **architecture correction**, not UI polish.

---

## 12. Seal Statement

This contract represents the **canonical, As-Is definition** of `DashboardPageFT2`.

Any future change requires:

1. Scan evidence
2. Explicit amendment
3. Clear before/after diff

Silent drift is forbidden.

---

**END OF DASHBOARDPAGEFT2 CONTRACT**

---