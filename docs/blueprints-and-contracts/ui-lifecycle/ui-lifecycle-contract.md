# **SynchroFlow UI Lifecycle Contract**

### **FT_MINUS_ONE & FT0 — Structural & Architectural Lock**

**Status:** 🔒 SEALED
**Audience:** Core engineers, future maintainers, reviewers
**Enforcement Level:** NON-NEGOTIABLE

---

## 0. Purpose of This Contract

This document **locks** the architecture governing:

* `FT_MINUS_ONE`
* `FT0_SYNCING`
* `FT0_PREPARING` (FT0-A / FT0-B UI substates)

Its purpose is to ensure:

* Structural correctness
* Deterministic lifecycle transitions
* Zero future regression into “conditional spaghetti”
* Clear fault boundaries when bugs occur

> **Any code that violates this contract is considered architecturally invalid, regardless of whether it “works”.**

---

## 1. Core Invariant (Absolute)

> **Shop lifecycle decides what exists.
> UI lifecycle decides how it looks.
> Pages decide nothing.**

If this invariant is broken, the system is broken.

---

## 2. Canonical Lifecycle Authority

### 2.1 Single Source of Truth

There is **exactly one authority** for shop lifecycle:

```
ShopLifecycleShell
```

Responsibilities:

* Reads backend integration facts
* Resolves `ShopLifecyclePhase`
* Exposes phase via context

Non-responsibilities:

* ❌ Rendering
* ❌ Routing
* ❌ UI timing
* ❌ Readiness inference

---

## 3. Structural Gate (Uncrossable Boundary)

### 3.1 ShopLifecycleGate — Structural Only

File:

```
apps/frontend/src/lifecycle/ShopLifecycleGate.tsx
```

This component is the **only place** where:

* Routes are allowed or denied
* Pre-FT1 UI is rendered

> **If a route is not allowed, it must not exist in the React tree.**

No exceptions.

---

## 4. Canonical Shop Lifecycle Phases (Locked)

```ts
type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0_SYNCING'
  | 'FT0_PREPARING'
  | 'FT1_READY';
```

These phases are:

* Shop-level
* Structural
* Immutable in meaning

No feature may reinterpret them.

---

## 5. Phase → Structural Mapping (Sealed)

| Phase           | Structural Behavior              |
| --------------- | -------------------------------- |
| `FT_MINUS_ONE`  | Only activation surface exists   |
| `FT0_SYNCING`   | Blocking modal, no routes        |
| `FT0_PREPARING` | Empty dashboard state, no routes |
| `FT1_READY`     | Real routes allowed              |

If any route renders outside `FT1_READY`, the architecture is violated.

---

## 6. FT0-A / FT0-B (UI Substates)

### 6.1 Nature of FT0 Substates

FT0-A and FT0-B are:

* **UI-only**
* **Non-canonical**
* **Non-persistent**
* **Non-authoritative**

They exist **only** to improve UX continuity.

They must never:

* Affect lifecycle resolution
* Affect routing
* Affect backend state

---

### 6.2 FT0-A (Data Sync Modal)

FT0-A may render **only** when:

1. Backend reports syncing (`FT0_SYNCING`)
2. OR integration was *just created* and sync completed too fast

FT0-A is:

* Blocking
* Temporary
* Session-scoped

It must **never** reappear after FT1 is reached.

---

### 6.3 FT0-B (Preparing UI)

FT0-B exists to:

* Hold space while frontend declares readiness
* Prevent premature route mounting
* Smooth UX transition

FT0-B:

* Must have a minimum perceptual duration
* Must not guess readiness
* Must not auto-promote lifecycle

---

## 7. Promotion Rule (Critical)

> **FT0_PREPARING → FT1_READY is NOT time-based.**

Promotion may occur **only** when:

* The frontend explicitly declares readiness
* Via an aggregated readiness barrier
* In a single, centralized location

The backend may never force FT1.

---

## 8. Forbidden Actions (Hard Fail)

The following are **architectural violations**:

❌ Pages checking lifecycle
❌ Pages rendering activation or FT0 UI
❌ Modules gating themselves
❌ Timeouts triggering lifecycle promotion
❌ Backend responses directly causing FT1
❌ Conditional routing outside `ShopLifecycleGate`
❌ Lifecycle logic inside UI components

Any of the above must be rejected in review.

---

## 9. Instrumentation Contract

Every lifecycle boundary **must** emit logs:

* FT0-A start / end
* FT0-B start / end
* FT0-B → FT1 promotion

Missing instrumentation = incomplete implementation.

---

## 10. Debuggability Rule

> **If a lifecycle bug occurs, it must be traceable to exactly one layer.**

| Bug Type                 | Responsible Layer     |
| ------------------------ | --------------------- |
| Wrong phase              | ShopLifecycleShell    |
| Route exists incorrectly | ShopLifecycleGate     |
| Wrong UI shown           | GenericLifecycleShell |
| Premature content        | Readiness provider    |

If a bug spans layers, the contract was violated.

---

## 11. Non-Evolution Clause

This contract may **only** be changed if:

1. A new lifecycle phase is introduced
2. The change is documented
3. The contract is versioned
4. Migration rules are defined

Ad-hoc evolution is forbidden.

---

## 12. Final Lock Statement

> **This architecture is not “flexible by design”.
> It is rigid by necessity.**

Flexibility lives **inside** allowed layers — never across them.

Any future contributor who feels “blocked” by this structure
is experiencing the **intended protection mechanism**.

---

### ✅ Status: SEALED

Breaking this contract is equivalent to breaking the system.

---