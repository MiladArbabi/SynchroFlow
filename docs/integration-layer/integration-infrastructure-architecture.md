# Integration Infrastructure Architecture

**SynchroFlow Frontend**

---

## 1. Purpose of the Integration Layer

The Integration infrastructure is responsible for answering **one and only one category of questions**:

> **Does an integration exist, and what is its structural sync state?**

It deliberately **does NOT**:

* decide UI lifecycle phases
* decide feature availability
* decide onboarding completeness
* decide dashboard readiness
* drive rendering logic directly

Those responsibilities belong elsewhere (primarily `ShopLifecycleShell` and downstream lifecycle contexts).

---

## 2. Architectural Principles

This system is designed around five non-negotiable principles:

### 2.1 Single Public API

There is exactly **one** public entry point:

```ts
useIntegration()
```

All consumers must use this hook.
Direct access to context is **forbidden**.

---

### 2.2 Structural, Not Visual

The Integration layer models **backend structure**, not UX state.

It answers:

* *Does an integration record exist?*
* *Is syncing happening?*
* *Is syncing complete?*

It does **not** answer:

* *Should we show onboarding?*
* *Should we render FT0 or FT1 UI?*
* *Is the user “ready”?*

---

### 2.3 Auth Churn Is Noise

Temporary auth errors (401 / 403) **must not**:

* reset lifecycle
* reset integration existence
* cause visual regressions

The system preserves the **last known stable truth** across auth churn.

---

### 2.4 Backend Volatility Is Hidden

Transient backend states are collapsed into **stable semantic states**.
Consumers never see raw backend enums.

---

### 2.5 Explicit Boot Phase

Before the integration model resolves at least once, **nothing can be assumed**.

This is explicitly modeled via `bootResolved`.

---

## 3. File & Module Structure

```
apps/frontend/src/contexts/integration/
├── _internal/
│   └── IntegrationContext.tsx   # INTERNAL ONLY
├── IntegrationProvider.tsx      # Implementation
├── useIntegration.tsx           # Public API
└── index.ts                     # Public exports
```

### Public Surface

```ts
export { IntegrationProvider } from './IntegrationProvider';
export { useIntegration } from './useIntegration';
```

Nothing else is exported.

---

## 4. Internal Context (Implementation Detail)

### Location

```
contexts/integration/_internal/IntegrationContext.tsx
```

### Status

🚫 **INTERNAL — DO NOT IMPORT DIRECTLY**

### Responsibility

* Holds **raw structural state**
* Stores nullable, transitional values
* Exists only to support the provider + hook

### Types

```ts
export type IntegrationBootState = 'BOOTING' | 'READY';

export type IntegrationExistence = 'NONE' | 'EXISTS';

export type IntegrationSyncState =
  | 'IDLE'
  | 'PENDING'
  | 'SYNCING'
  | 'COMPLETED'
  | 'FAILED';
```

### Context Shape

```ts
export interface IntegrationContextValue {
  bootState: IntegrationBootState;
  existence: IntegrationExistence | null;
  syncState: IntegrationSyncState | null;

  hasIntegration: boolean;
  isSyncComplete: boolean;

  refresh: () => void;
}
```

⚠️ Nullable fields are **intentional** and never exposed publicly.

---

## 5. IntegrationProvider

### Responsibility

`IntegrationProvider`:

* talks to the backend
* normalizes backend responses
* absorbs auth churn
* preserves last stable truth
* feeds the internal context

### Backend API

```
GET /api/v1/integrations/sync-status
```

### Backend Status Mapping

| Backend Status  | Internal Sync State |
| --------------- | ------------------- |
| COMPLETED       | COMPLETED           |
| PENDING         | PENDING             |
| FAILED          | FAILED              |
| SYNCING_*       | SYNCING             |
| COMPLETING      | SYNCING             |
| NOT_FOUND (404) | NONE (existence)    |

---

### Boot Resolution Logic

* Before first successful resolution:

  ```ts
  bootState = 'BOOTING'
  existence = null
  syncState = null
  ```

* After first resolution (any outcome):

  ```ts
  bootState = 'READY'
  ```

This guarantees consumers can distinguish:

* “not loaded yet”
* vs “loaded and empty”

---

### Auth Churn Handling

On `401` / `403`:

* **Do not reset state**
* Preserve last known existence + sync state
* Continue reporting `READY` if already resolved

This prevents:

* FT regressions
* empty-state flashes
* lifecycle resets during token refresh

---

### 404 Handling

A `404` response is **authoritative**:

```ts
existence = 'NONE'
syncState = null
```

This explicitly means:

> No integration record exists.

---

## 6. Public Hook: `useIntegration()`

### Purpose

This is the **only supported consumer API**.

It:

* hides nullable values
* hides backend noise
* exposes stable, semantic facts
* prevents misuse

---

### Return Type

```ts
export interface UseIntegrationResult {
  bootResolved: boolean;

  existence: IntegrationExistence;
  syncStatus: IntegrationSyncState;

  hasIntegration: boolean;
  isSyncComplete: boolean;

  refresh: () => void;
}
```

---

### Guarantees

| Property         | Guarantee                        |
| ---------------- | -------------------------------- |
| `bootResolved`   | True only after first resolution |
| `existence`      | Never null                       |
| `syncStatus`     | Never null                       |
| `hasIntegration` | Pure derived convenience         |
| `isSyncComplete` | Pure derived convenience         |

---

### Critical Design Choice

```ts
const existence = ctx.existence ?? 'NONE';
const syncStatus = ctx.syncState ?? 'IDLE';
```

This ensures:

* No consumer can accidentally depend on partial state
* UI logic remains deterministic
* Lifecycle logic never sees “half states”

---

## 7. Relationship to ShopLifecycle

### Pre-FT1

* `useIntegration()` is a **signal source**
* It provides *structural truth only*

### Post-FT1

* `ShopLifecycleContext` becomes authoritative
* Integration state must **not** be consulted for lifecycle decisions

This separation prevents:

* FT regressions on refresh
* FT1 → FT0 flicker
* lifecycle coupling to backend noise

---

## 8. What Was Intentionally Removed

### ❌ `useIntegrationSyncStatus`

* Deprecated adapter
* Lifecycle-leaking abstraction
* Removed entirely once all consumers migrated

### ❌ Direct IntegrationContext imports

* Now physically impossible without violating `_internal`

---

## 9. Common Misuse (Now Prevented)

| Old Anti-Pattern                    | Why It Was Dangerous   |
| ----------------------------------- | ---------------------- |
| Reading integration status for UI   | Lifecycle regression   |
| Treating sync complete as readiness | Incorrect FT promotion |
| Reacting to 401 as NOT_FOUND        | Flicker + resets       |
| Using nullable context fields       | Race-condition bugs    |

All of these are now structurally impossible.

---

## 10. Mental Model Summary

> **Integration is about structure.
> Lifecycle is about experience.
> Readiness is about capability.**

They are intentionally **not the same thing**.

---

## 11. Final Invariants

The Integration infrastructure now guarantees:

1. Integration existence is monotonic unless explicitly deleted
2. Auth churn cannot regress lifecycle
3. Backend volatility cannot cause UI flicker
4. All consumers see stable, semantic facts
5. Lifecycle decisions live in exactly one place

---

## 12. Status

✅ **Complete**
✅ **Production-grade**
✅ **Future-safe**

This infrastructure is now something you can **build on without fear**.

