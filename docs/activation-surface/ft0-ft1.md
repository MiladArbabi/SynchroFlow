# FT0 → FT1 Activation Contract

**Status:** 🔒 Locked
**Audience:** Backend, Frontend, Product, QA
**Scope:** Activation, Onboarding, Dashboard, Modules
**Last Updated:** 2025-12-23

---

## 1. Purpose of This Contract

This document defines **the only valid way** a user transitions from **FT0** to **FT1**.

It exists to prevent:

* UI/backend desynchronization
* Phantom states
* Timing-based bugs
* “It worked locally” regressions
* Re-implementations of activation logic

If behavior is not described here, **it is undefined and disallowed**.

---

## 2. Definitions (Authoritative)

### FT0 (First-Time Zero)

The onboarding phase **after integration** but **before insight readiness**.

FT0 has **two UX sub-phases**:

* **FT0-A** — Emotional buffer (DataSyncingModal)
* **FT0-B** — Analyzing state (“We are crunching your numbers”)

> FT0 is **backend-owned**, UX-latched only for emotional continuity.

---

### FT1 (First-Time One)

The first *fully activated* experience.

FT1 means:

* Canonical data exists
* First insight is delivered
* Dashboard widgets are live
* Modules exit activation surfaces
* The product becomes “real”

FT1 is **never guessed**.
FT1 is **observed**.

---

## 3. Single Source of Truth (Non-Negotiable)

### 🔑 Backend is authoritative

The **only** signal that FT1 is allowed is:

```ts
activationSurface.ft0.phase === 'COMPLETED'
```

### Forbidden promotion signals ❌

The following **must never** promote FT0 → FT1:

* `first_insight_delivered === true`
* Timers / delays
* Session flags
* UI transitions
* Component mount/unmount
* User actions (clicks)

These are **UX signals only**, never lifecycle truth.

---

## 4. FT0 Completion Criteria (Backend)

FT0 is completed **only when ALL are true**:

1. Shopify integration exists
2. Integration sync status === `COMPLETED`
3. Canonical orders > 0
4. First insight delivered (commit latch)

This is enforced **only** by:

```
FT0CompletionService.evaluateAndComplete()
```

No other code path may complete FT0.

---

## 5. Backend Contract (API)

### Endpoint

```
GET /api/v1/activation/verdict
```

### Required Response Shape

```json
{
  "activationSurface": {
    "ft0": {
      "phase": "SYNCING" | "ANALYZING" | "COMPLETED"
    }
  }
}
```

### Guarantees

* `phase` is monotonic (never regresses)
* `COMPLETED` is terminal
* The value reflects persisted state

---

## 6. Frontend Contract (All Consumers)

### 6.1 Phase Derivation Rule

Frontend **must derive phase exclusively from**:

```ts
activationSurface.ft0.phase
```

### Mapping (Authoritative)

| activationSurface.ft0.phase | UI State               |
| --------------------------- | ---------------------- |
| undefined                   | FT-1 (pre-integration) |
| SYNCING                     | FT0-A                  |
| ANALYZING                   | FT0-B                  |
| COMPLETED                   | FT1                    |

---

## 7. FT0-A (DataSyncingModal) Rules

### Purpose

Emotional buffer after store connection.

### Rules

* Must show **at least once per session**
* May complete before backend sync
* Must **never** block backend truth
* Must **never** extend FT0 artificially

### Implementation Constraint

Frontend-latched via `sessionStorage`.

This latch **does not affect lifecycle**.

---

## 8. FT0-B (Analyzing State) Rules

### Purpose

Communicate background processing.

### Rules

* Shown when `ft0.phase !== COMPLETED`
* Must appear in:

  * Dashboard
  * All modules
* Must not disappear until backend completes FT0
* May include skeletons / placeholders

FT0-B is **backend-controlled**, not time-based.

---

## 9. FT1 Promotion Rules

### How promotion happens

FT1 occurs when the frontend **observes**:

```ts
activationSurface.ft0.phase === 'COMPLETED'
```

### How observation is implemented (current)

* Polling `activation-verdict` while FT0 is active
* Polling stops automatically when COMPLETED

### What must happen automatically

* Dashboard switches to widgets
* Modules exit activation states
* No refresh required
* No user interaction required

---

## 10. Polling Contract (Current Implementation)

### Allowed

```ts
refetchInterval: phase !== 'COMPLETED' ? 3000 : false
```

### Required Behavior

* Polling only during FT0
* Polling stops at FT1
* No polling once FT1 is reached

Polling is **intentional**, not technical debt.

---

## 11. What Is Explicitly Forbidden ❌

* Frontend promoting FT1
* Modules using different promotion rules
* Using `first_insight_delivered` to gate FT1
* Session flags influencing lifecycle
* Multiple activation derivations
* Deep imports into activation logic
* Re-deriving FT0 phase outside shared logic

Violations **will cause desync** and are regressions.

---

## 12. Invariants (Must Always Hold)

1. Dashboard and modules are always in the same FT phase
2. FT1 never appears without backend completion
3. FT0 never reappears after FT1
4. Refreshing the page does not change lifecycle
5. Backend truth always wins

If any invariant breaks, **the system is wrong**.

---

## 13. Testing & Verification Checklist

### FT0 → FT1 works if:

* Connect store
* See FT0-A once
* Land in FT0-B everywhere
* Wait
* Without refresh, UI transitions to FT1 everywhere

### Regression signal

If dashboard ≠ modules → contract violation.

---

## 14. Change Policy

Any change to:

* FT phases
* Promotion rules
* Completion criteria
* API shape

**Requires updating this document first.**

No exceptions.

---

## 15. Final Lock Statement

> **FT1 is not a feeling, a delay, or a guess.
> FT1 is a backend fact, observed by the UI.**

This contract is **binding**.

🔒 **Locked. Enforced. Non-negotiable.**

---