# Activation Surface Contract

**Status:** 🔒 Locked
**Audience:** Backend, Frontend, Product, QA
**Applies to:** Dashboard, Modules, Activation Gates
**Location:** `docs/activation/activation-surface.md`
**Last Updated:** 2025-12-23

---

## 1. Purpose of This Contract

This document defines **Activation Surface** as the **only allowed interface** between:

* Backend activation logic
* Frontend activation UX
* Dashboard state
* Module gating

It exists to:

* Eliminate duplicate activation logic
* Prevent frontend inference
* Guarantee dashboard ↔ module alignment
* Make activation auditable, replayable, and evolvable

If something is not expressed via **Activation Surface**,
**frontend is not allowed to reason about it**.

---

## 2. What Is the Activation Surface?

> **Activation Surface is a read-only, derived UI contract produced by the backend.**

It is:

* Deterministic
* Versioned
* Auditable
* Environment-agnostic

It is **not**:

* A UI state
* A component
* A frontend derivation
* A collection of flags

---

## 3. Single Source of Truth (Non-Negotiable)

### 🔑 Backend owns activation truth

Frontend **must never** derive activation state from:

* user fields
* integrations
* sync status
* entitlements
* milestones
* timing
* heuristics

Frontend may **only** consume:

```ts
activationSurface
```

Returned by:

```
GET /api/v1/activation/verdict
```

---

## 4. Contract Shape (Authoritative)

### Canonical Shape

```ts
interface ActivationSurface {
  ft0: {
    phase: 'SYNCING' | 'ANALYZING' | 'COMPLETED';
  };

  modules: Record<
    ModuleId,
    {
      state: 'LOCKED' | 'ACTIVATABLE' | 'ACTIVE';
      blockingReason?: string;
      primaryCTA?: {
        actionId: string;
        label: string;
      };
    }
  >;
}
```

This shape is **append-only**.
Breaking changes are forbidden.

---

## 5. FT0 Portion of the Surface

### Responsibility

* Declare lifecycle phase
* Synchronize dashboard + modules
* Gate FT1 availability

### Rules

* `phase` is monotonic
* `COMPLETED` is terminal
* Frontend must not override

### Mapping

| ft0.phase | Meaning                            |
| --------- | ---------------------------------- |
| SYNCING   | Integration active, data ingesting |
| ANALYZING | Data present, insights pending     |
| COMPLETED | First insight delivered            |

---

## 6. Module Activation Portion

Each module receives its **own activation state**, derived centrally.

### Allowed States

| State       | Meaning                 |
| ----------- | ----------------------- |
| LOCKED      | Cannot be activated yet |
| ACTIVATABLE | Activation CTA allowed  |
| ACTIVE      | Module is fully live    |

### Rules

* Modules never infer FT state
* Modules never inspect user/integration directly
* Modules must trust their surface slice

---

## 7. Frontend Consumption Rules (Hard)

### Allowed ✅

```ts
const { activationSurface } = useActivationVerdict();
```

* Render based on surface
* Route based on surface
* Show CTAs from surface
* Block access from surface

### Forbidden ❌

```ts
if (user.first_insight_delivered) { ... }
if (orders.length > 0) { ... }
if (syncStatus === 'COMPLETED') { ... }
```

If you do this, you are **breaking the architecture**.

---

## 8. Activation Gate Responsibility

### CommerceActivationGate is the only gate

* One gate
* One verdict
* One surface

No module may implement its own activation logic.

---

## 9. Backend Responsibilities

Backend must:

1. Derive activation via **pure functions**
2. Emit `activationSurface`
3. Persist audit events
4. Guarantee determinism

Backend must **not**:

* Shape UI flows
* Add UX timing
* Leak internal flags

---

## 10. Frontend Responsibilities

Frontend must:

* Treat Activation Surface as immutable truth
* Never persist derived activation state
* Never cache beyond allowed TTL
* Never “fix” activation inconsistencies

Frontend may:

* Add UX latches (FT0-A)
* Add skeletons
* Animate transitions

But **never** alter lifecycle.

---

## 11. Audit & Replay Guarantee

Every activation evaluation produces:

* Input snapshots
* Derived verdict
* Derived surface
* Version stamp

This enables:

* Debugging
* Replay
* Forensics
* Compliance

Frontend does **not** participate in audit.

---

## 12. Evolution Rules

### Allowed Changes

* Add new module states
* Add new surface fields
* Add new FT phases (append-only)

### Forbidden Changes

* Removing fields
* Renaming states
* Frontend-only activation logic
* Multiple activation sources

All changes must:

1. Update shared types
2. Update backend derivation
3. Update this document

---

## 13. Invariants (Must Always Hold)

1. Dashboard and modules see the same activation truth
2. Activation never depends on UI timing
3. Refresh does not change activation
4. FT1 is backend-completed only
5. Modules never disagree with dashboard

If any invariant breaks → **bug, not UX choice**.

---

## 14. Common Failure Modes (Guardrails)

| Symptom                       | Cause                  |
| ----------------------------- | ---------------------- |
| Dashboard FT1, modules FT0    | Frontend promoted FT1  |
| Module locked, dashboard live | Multiple derivations   |
| Works after refresh           | Timing-based bug       |
| Feature flags everywhere      | Missing surface fields |

---

## 15. Final Lock Statement

> **Activation Surface is the language the backend speaks to the UI.
> The UI does not interpret — it listens.**

This contract is **binding**.

🔒 **Locked. Enforced. Non-negotiable.**

---