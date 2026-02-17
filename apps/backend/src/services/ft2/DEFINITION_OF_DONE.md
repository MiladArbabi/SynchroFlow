# FT2 Completion — Definition of Done (FROZEN)

## Purpose

FT2 Completion defines **when FT2 is considered complete** from a **system truth perspective**.

It is **not** a UX concept.  
It is **not** a commercial concept.  
It is **not** a lifecycle inference engine.

FT2 Completion answers **one question only**:

> Are all mandatory FT2 realities terminal, trustworthy, and safe to expose?

---

## Core Principle

**FT2 Completion is declarative, not inferred.**

Nothing becomes “complete” because:

- enough data exists
- UI rendered successfully
- time passed
- user interacted
- downstream modules look healthy

Completion is granted **only** by explicit, verifiable conditions.

---

## Single Authority

- `confirmFt2` (lifecycle.controller.ts) is the ONLY write authority for FT2 promotion.
- No standalone completion service exists.
- No background latch service exists.
- No frontend logic may influence completion.
- No resolver may “assume” completion.

FT2 completion is:

- Explicit
- User-triggered
- Transaction-bound
- Lifecycle-synchronized

---

## Mandatory Preconditions (ALL REQUIRED)

FT2 is considered complete **only if ALL are true**:

### 1. Trust FT2 Gate

- `trustEligible === true`
- Any `false` or `null` blocks completion
- Trust is inherited, never recomputed

---

### 2. Required FT2 Snapshots Exist

The following **must exist and be terminal**:

| Domain        | Requirement |
|--------------|-------------|
| Orders FT2   | Snapshot resolved |
| Products FT2 | Snapshot resolved |
| Customers FT2| Snapshot resolved |
| Finances FT2 | Snapshot resolved |
| Specter FT2  | Snapshot resolved |

Rules:

- `null` snapshot = **not complete**
- Partial objects = **not complete**
- Exceptions are not allowed

---

### 3. No Resolver Throws

- FT2 completion assumes **resolvers are stable**
- Any resolver throwing = FT2 **blocked**
- Errors must surface, not be swallowed

---

## Explicit Non-Requirements (IMPORTANT)

FT2 Completion does **NOT** require:

- Data quality thresholds
- Freshness recency
- Alignment planes to resolve
- Revenue presence
- Activity presence
- Any “positive” signal

Completion is about **structural readiness**, not business health.

---

## Epistemic Rules

- `unknown` values are allowed
- `null` exposures are allowed *within* snapshots
- Missing snapshots are **not allowed**

Completion tolerates **uncertainty**, not **absence**.

---

## Output Contract

### `FT2CompletionState`

```ts
{
  isComplete: boolean
  blockingModules: string[]
  completedModules: string[]
  evaluatedAt: string
}
````

Rules:

* `blockingModules` must be explicit
* No inferred blockers
* No ordering guarantees
* Time is observational only

---

## Forbidden Behavior (NON-NEGOTIABLE)

FT2 Completion MUST NOT:

* Infer readiness from UI behavior
* Infer readiness from lifecycle state
* Trigger side effects
* Unlock features directly
* Downgrade or upgrade trust
* Mask errors
* Retry or heal missing modules

---

## Relationship to Lifecycle

* Lifecycle **may reference** FT2 Completion
* FT2 Completion **must not reference lifecycle**
* There is no circular dependency

FT2 Completion is **read-only truth**.

---

## Relationship to Overview FT2

* Overview FT2 may only render when FT2 is complete
* Overview FT2 must not override completion logic
* Overview FT2 must not backfill missing modules

---

## Error Semantics

FT2 Completion logic must never throw.

Failures are represented as:

* `isComplete = false`
* explicit blockers listed

---

## Test Coverage (MANDATORY)

The following cases MUST be covered:

* Trust blocked → FT2 incomplete
* Any missing snapshot → FT2 incomplete
* All snapshots present → FT2 complete
* Unknown values tolerated
* Null snapshots rejected
* Deterministic output for identical inputs

Tests must fail if:

* Completion is inferred
* Lifecycle logic leaks in
* UI assumptions affect completion

---

## Final Status

FT2 Completion is considered **DONE** when:

* Completion logic is centralized
* All rules are explicit
* No TODOs remain
* No silent fallbacks exist
* All tests are green

This file is **FROZEN**.
Any changes require an explicit architectural review.

---