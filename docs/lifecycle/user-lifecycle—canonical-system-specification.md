# 🧬 User Lifecycle — Canonical System Specification

> **Status:** Implemented, enforced, and production-ready
> **Owner:** `LifecycleService`
> **Scope:** User progression from first contact → paid maturity
> **Non-negotiable:** There is exactly **one lifecycle source of truth**

---

## 1. Purpose of Lifecycle

The **user lifecycle** represents the **authoritative maturity stage of a user** in the system.

It is used for:

* Feature gating
* Onboarding UX
* Promotions & upgrades
* Analytics & growth funnels
* Long-lived business decisions

It is **not**:

* Activation UI state
* Integration sync state
* Readiness signal aggregation
* Entitlement inference

Those are **inputs**, not lifecycle.

---

## 2. Canonical Lifecycle Phases

Defined in **one place only**:

```ts
// apps/backend/src/services/lifecycle.contract.ts

export type LifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0'
  | 'FT1'
  | 'FT2';
```

### Phase meanings

| Phase          | Meaning              | Human description                           |
| -------------- | -------------------- | ------------------------------------------- |
| `FT_MINUS_ONE` | No shop              | User exists but has no shop connected       |
| `FT0`          | Technical onboarding | Shop + integration exist, FT0 not completed |
| `FT1`          | Product ready        | FT0 complete, readiness satisfied           |
| `FT2`          | Commercial           | FT1 complete + paid entitlement             |

⚠️ **No other lifecycle phases are allowed**
⚠️ **No renaming, no aliases, no derived labels**

---

## 3. Single Source of Truth (SSOT)

### 🚨 Absolute Rule

> **All lifecycle decisions MUST go through:**
>
> ```ts
> LifecycleService.resolveForUser(userId)
> ```

No exceptions.
No “temporary logic”.
No “just checking”.

### Why this exists

* Prevents drift
* Prevents contradictory states
* Prevents accidental regressions
* Allows safe evolution later

### Enforced by tests

* Guardrail tests scan the codebase
* Any lifecycle derivation outside `LifecycleService` **fails CI**

---

## 4. Lifecycle Resolution Flow

### Location

```ts
apps/backend/src/services/lifecycle.service.ts
```

### Inputs (facts only)

The service **reads facts**, it does not infer intent.

| Fact              | Source                       |
| ----------------- | ---------------------------- |
| User existence    | `users`                      |
| Shop existence    | `users.shop_id`              |
| Integrations      | `integrations`               |
| FT0 completion    | `ft0_state`                  |
| FT1 readiness     | `OnboardingReadinessService` |
| Paid entitlements | `EntitlementsService`        |

### Decision logic

Lifecycle is resolved by a **pure resolver**:

```ts
resolveLifecyclePhase({
  hasShop,
  hasIntegration,
  ft0Completed,
  ft1Complete,
  hasPaidEntitlements,
});
```

This guarantees:

* Determinism
* Testability
* No side effects

---

## 5. Promotion Detection & Audit

### Promotion is **observed**, not guessed

Promotions are detected by comparing:

* last known lifecycle phase
* current resolved lifecycle phase

### Service

```ts
LifecycleTransitionService.auditIfTransitioned(...)
```

### Properties

* Idempotent
* Promotion-only (no regressions)
* Explicit transitions only
* Safe under concurrency

### Allowed promotions

```ts
FT0 → FT1
FT1 → FT2
```

❌ No skipping
❌ No backward moves
❌ No silent rewrites

### Storage

Promotions are written to:

```sql
lifecycle_audit_events
```

This is the **historical truth**.

---

## 6. Lifecycle Snapshot (Materialized State)

### Table

```sql
user_lifecycle_snapshot
```

### Purpose

* Fast reads
* UI consumption
* Cross-service consistency
* Avoid recomputation everywhere

### Schema (simplified)

| Column          | Meaning                   |
| --------------- | ------------------------- |
| `user_id`       | User                      |
| `shop_id`       | Shop                      |
| `phase`         | Current lifecycle phase   |
| `since`         | When this phase started   |
| `last_event_id` | Promotion audit reference |
| `updated_at`    | Last update               |

### Rule

This table **does not decide lifecycle**
It **reflects lifecycle decisions**

---

## 7. Where Lifecycle Is Used (Approved)

### ✅ Allowed usage

| Location                                 | Purpose                   |
| ---------------------------------------- | ------------------------- |
| `GET /api/lifecycle`                     | Read current phase        |
| `UserStateService.getOnboardingProgress` | Expose lifecycle to UI    |
| Feature gating                           | Based on resolved phase   |
| Analytics                                | Based on snapshot / audit |

### ❌ Forbidden usage

* Returning `FT0`, `FT1`, `FT2` from any other service
* Switch/case on lifecycle outside `LifecycleService`
* Re-deriving lifecycle from readiness or integrations
* Embedding lifecycle meaning into activation logic

All of these are **guarded by tests**.

---

## 8. Relationship to Activation & FT0

This is critical and non-obvious.

### Activation ≠ Lifecycle

| Concept    | Purpose                     |
| ---------- | --------------------------- |
| Activation | UI/UX onboarding guidance   |
| FT0Phase   | Technical integration state |
| Lifecycle  | Business maturity stage     |

### FT0Phase

* Lives in `@lasyncro/shared/activation`
* Values: `PRE_INTEGRATION`, `SYNCING`, `COMPLETED`
* **Does NOT define lifecycle**

FT0 completion is merely **one input** to lifecycle.

---

## 9. Promotion Model (Important)

Lifecycle promotion is:

* **Pull-based**
* Triggered on lifecycle resolution
* Not event-driven

This is intentional.

Why:

* Prevents partial state transitions
* Avoids async race conditions
* Keeps lifecycle deterministic

Later, a background reconciler may exist — **not now**.

---

## 10. How to Use Lifecycle (Rules for Engineers)

### If you need lifecycle:

```ts
await LifecycleService.resolveForUser(userId)
```

### If you need history:

```ts
LifecycleHistoryService.getForUser(userId)
```

### If you need to react to promotions:

* Subscribe to audit events
* Or read `user_lifecycle_snapshot`

### Never:

* Infer lifecycle from activation
* Store lifecycle in frontend state
* Add lifecycle flags to random tables

---

## 11. What Is Intentionally NOT Done (Yet)

This is by design:

* No FT3+
* No downgrade paths
* No event-driven lifecycle engine
* No cross-product lifecycle unification
* No background lifecycle cron

The system is **complete at current scope**.

---

## 12. Final Invariants (Print These)

1. **Lifecycle is singular**
2. **Lifecycle is deterministic**
3. **Lifecycle is audited**
4. **Lifecycle is immutable in history**
5. **Lifecycle is never inferred elsewhere**
6. **Violations fail tests**

If someone breaks these rules, they are not “iterating” —
they are **corrupting the system**.

---

## 13. User Lifecycle Flow Diagram
Lifecycle Resolution & Promotion Pipeline
┌──────────────────────────┐
│        FACT SOURCES      │
│  (read-only, objective)  │
└─────────────┬────────────┘
              │
              │
              ▼
┌──────────────────────────────────────────────┐
│                FACTS                         │
│                                              │
│  users                                       │
│   └─ user exists?                            │
│   └─ shop_id?                                │
│                                              │
│  integrations                                │
│   └─ any integration connected?              │
│                                              │
│  ft0_state                                   │
│   └─ FT0 completed?                          │
│                                              │
│  onboarding_readiness                        │
│   └─ FT1 readiness complete?                 │
│                                              │
│  entitlements                                │
│   └─ paid / premium flags?                   │
└─────────────┬────────────────────────────────┘
              │
              │  (NO interpretation here)
              │
              ▼
┌──────────────────────────────────────────────┐
│        LifecycleService.resolveForUser        │
│                                              │
│  - Reads facts                               │
│  - Calls pure resolver                       │
│  - NO side effects                           │
│                                              │
│  resolveLifecyclePhase({                     │
│    hasShop,                                  │
│    hasIntegration,                           │
│    ft0Completed,                             │
│    ft1Complete,                              │
│    hasPaidEntitlements                       │
│  })                                          │
└─────────────┬────────────────────────────────┘
              │
              │  returns LifecyclePhase
              │
              ▼
┌──────────────────────────────────────────────┐
│          RESOLVED LIFECYCLE PHASE             │
│                                              │
│   FT_MINUS_ONE | FT0 | FT1 | FT2              │
│                                              │
│   (canonical, deterministic)                 │
└─────────────┬────────────────────────────────┘
              │
              │
              ▼
┌──────────────────────────────────────────────┐
│   LifecycleTransitionService.auditIfTransitioned │
│                                                  │
│  - Loads last audited phase                      │
│  - Compares previous → current                  │
│  - Allows only explicit promotions              │
│    FT0 → FT1                                    │
│    FT1 → FT2                                    │
│  - Idempotent                                   │
│  - No regressions                               │
└─────────────┬──────────────────────────────────┘
              │
              │  (only if valid promotion)
              │
              ▼
┌──────────────────────────────────────────────┐
│           lifecycle_audit_events              │
│                                              │
│  Immutable historical truth                  │
│                                              │
│  - event_id                                  │
│  - user_id                                   │
│  - shop_id                                   │
│  - from_phase                                │
│  - to_phase                                  │
│  - occurred_at                               │
└─────────────┬────────────────────────────────┘
              │
              │
              ▼
┌──────────────────────────────────────────────┐
│        user_lifecycle_snapshot                │
│                                              │
│  Materialized current state                  │
│                                              │
│  - user_id                                   │
│  - shop_id                                   │
│  - phase                                     │
│  - since                                     │
│  - last_event_id                             │
│  - updated_at                                │
│                                              │
│  (fast reads, no logic)                      │
└──────────────────────────────────────────────┘

Key Guarantees (Diagram Truths)
1️⃣ Facts never decide lifecycle

They are inputs only.

2️⃣ Resolver is the only decision point

All lifecycle meaning lives in one place:

LifecycleService → resolveLifecyclePhase()

3️⃣ Promotion is observed, not assumed

No service decides promotion.
Promotion is detected by comparison.

4️⃣ History is immutable

lifecycle_audit_events is append-only truth.

5️⃣ Snapshot is a mirror, not a brain

user_lifecycle_snapshot never derives, it reflects.

Anti-Patterns This Diagram Explicitly Prevents

❌ “If FT0 completed then lifecycle = FT1”
❌ “Activation says ready, so promote user”
❌ “Frontend tracks lifecycle locally”
❌ “We’ll just compute lifecycle again here”

All of these break the flow above and are guarded by tests.

How to Reference This Diagram in Code Reviews

When someone proposes logic, ask:

“Which box in the lifecycle diagram does this belong to?”

If the answer is unclear — it doesn’t belong.