This document is written to **freeze intent**, **prevent drift**, and **onboard future engineers without oral history**.

---

# Activation System – Backend Architecture & Guarantees

📍 **Location:** `apps/backend/src/api/activation`
📍 **Scope:** Activation decisioning, FT0/FT1 readiness, audit trail
📍 **Status:** FT0 foundation hardened, FT1 in progress

---

## 1. Purpose of the Activation System

The Activation system is the **single authoritative backend source of truth** for determining whether a user/shop is:

* **BLOCKED** – cannot proceed
* **PENDING** – allowed but incomplete
* **ACTIVE** – fully activated and entitled

It exists to answer one question **deterministically**:

> *“Given the current backend state, should this user be considered activated?”*

This decision:

* Must be reproducible
* Must be auditable
* Must never depend on frontend assumptions
* Must survive refactors and new modules

---

## 2. Core Design Principles (Non-Negotiable)

### 2.1 Pure Derivation

All activation decisions are derived from **pure functions** located in `modules/shared/activation`.

No IO, no DB access, no side effects.

### 2.2 IO at the Edge

The controller:

* Collects snapshots (identity, integrations, entitlements)
* Calls derivation
* Writes audit events
* Returns the verdict

**No business logic lives in the controller.**

### 2.3 Append-Only Audit Trail

Every activation evaluation:

* Is recorded
* Is immutable
* Can be replayed
* Can be inspected months later

If an activation decision cannot be explained from stored data, the system is broken.

---

## 3. Directory Structure

```
activation/
├── activation.controller.ts
├── activation.routes.ts
├── buildActivationAuditEvent.ts
├── README.md   ← this file
└── __tests__/
    ├── createActivationTestApp.ts
```

Related shared logic:

```
modules/shared/src/activation/
├── types.ts
├── deriveFT0Phase.ts
├── deriveActivationVerdict.ts
└── tests/
```

---

## 4. Activation Flow (Step-by-Step)

### 4.1 Request Entry

```
GET /api/v1/activation/verdict
```

* Authenticated via `authenticateToken`
* No request body
* Read-only operation

---

### 4.2 Snapshot Collection (Controller Responsibility)

The controller gathers **facts**, not opinions:

#### IdentitySnapshot

```ts
{
  userId: number | null
  shopId: number | null
  entryChannel: 'SHOPIFY_APP' | 'WEB' | null
}
```

#### IntegrationSnapshot[]

```ts
{
  platform: string
  syncStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
}
```

#### EntitlementSnapshot[]

```ts
{
  moduleKey: string
  enabled: boolean
}
```

No transformation. No inference.

---

### 4.3 FT0 Phase Derivation

`deriveFT0Phase(integrations)` classifies the integration lifecycle:

* `PRE_INTEGRATION`
* `SYNCING`
* `RESOLVED`

This phase is:

* Used by activation logic
* Stored in audit payload
* Returned to the frontend

---

### 4.4 Activation Verdict Derivation

`deriveActivationVerdict({ identity, integrations, entitlements })`

Possible results:

#### BLOCKED

```ts
{
  verdict: 'BLOCKED'
  reason: 'NOT_AUTHENTICATED' | 'NO_SHOP' | 'NO_INTEGRATION'
  explanation: string
  retryable: boolean
}
```

#### PENDING

```ts
{
  verdict: 'PENDING'
  reason: 'FT0_SYNCING' | 'ENTITLEMENT_PENDING'
  explanation: string
  retryable: boolean
}
```

#### ACTIVE

```ts
{
  verdict: 'ACTIVE'
  activatedModules: string[]
}
```

No other verdicts are allowed.

---

## 5. Audit Trail (Critical FT1 Infrastructure)

### 5.1 Why the Audit Exists

The audit trail answers:

* *Why was this user blocked?*
* *What did the backend know at the time?*
* *Can we reproduce this decision later?*

Without this, support, compliance, and debugging all fail.

---

### 5.2 Audit Event Construction

Handled by:

```
buildActivationAuditEvent.ts
```

Stored fields include:

* `event_id` (UUID)
* `user_id`
* `shop_id`
* `entry_channel`
* `verdict`
* `reason` (when applicable)
* `payload` (full snapshot)
* `payload_hash`
* `evaluated_at`

### 5.3 Audit Payload Schema

```ts
{
  schemaVersion: 'activation_audit.v1'
  evaluatedAt: string
  identity: IdentitySnapshot
  integrations: IntegrationSnapshot[]
  entitlements: EntitlementSnapshot[]
  ft0Phase: string
  verdict: ActivationVerdict
}
```

This payload is **append-only** and must never be mutated after write.

---

## 6. Testing Strategy (Why This Is Hard, and Correct)

### 6.1 Unit Tests (Shared)

* `deriveFT0Phase.test.ts`
* `deriveActivationVerdict.test.ts`

Guarantee:

* Determinism
* Exhaustive coverage
* No IO dependencies

### 6.2 Backend Activation Tests

Located in:

```
tests/unit/backend/activation/
```

Key test:

* `activation.audit.test.ts`

This test uses a **minimal activation test app** to:

* Avoid full Express bootstrap
* Avoid Shopify / session / queue side effects
* Verify real controller behavior
* Assert audit invariants

> The mock DB is intentionally stateful to simulate insert → select behavior.

This prevents false positives.

---

## 7. What Is Done (As of Now)

✅ Pure derivation logic implemented and tested
✅ Activation controller wired correctly
✅ FT0 phase derivation integrated
✅ Immutable audit trail implemented
✅ Minimal activation test app created
✅ Activation audit tests green
✅ Regression-safe mocking strategy established

This is a **solid FT0 foundation**.

---

## 8. What Is Explicitly NOT Done Yet (Next Steps)

### Step 4 – Derivation Versioning (FT1)

* Introduce `ACTIVATION_DERIVATION_VERSION`
* Persist it in audit records
* Guard against silent logic changes

### Step 5 – Audit Immutability Enforcement

* DB constraints (no UPDATE)
* Optional payload hash verification

### Step 6 – Activation Read Model (Optional)

* Read-optimized view for support/debugging
* Never used for decisioning

### Step 7 – Multi-Module Activation Expansion

* Support partial activation by module
* Maintain backward compatibility

---

## 9. Rules for Future Changes (Read Before Editing)

* ❌ Do not add logic to the controller
* ❌ Do not infer state not present in snapshots
* ❌ Do not introduce new verdicts casually
* ❌ Do not mutate audit records
* ❌ Do not bypass derivation functions

If you feel tempted to break one of these rules:
👉 Stop and update this README first.

---

## 10. Final Note

This system is intentionally **boring**.

Boring means:

* Predictable
* Auditable
* Trustworthy
* Scalable

If activation ever becomes “clever”, it has failed.

---
