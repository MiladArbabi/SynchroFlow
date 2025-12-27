# 🧠 LaSyncro Lifecycle Architecture (Locked & Sealed)

## Purpose

Guarantee a **stable, flicker-free, monotonic onboarding lifecycle** for ecommerce merchants:

* No UI flashes
* No regressions
* No race-condition artifacts
* No coupling between UX and backend timing

This system **intentionally separates concerns**:

* Backend truth
* Logical lifecycle resolution
* Visual gating
* Routing protection

---

## 🧩 Lifecycle Phases (Canonical)

Defined in `apps/frontend/src/lifecycle/types.ts`

```ts
export type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'   // Not connected to Shopify
  | 'FT0_SYNCING'    // Backend syncing
  | 'FT0_PREPARING'  // Readiness checks
  | 'FT1_READY';     // Fully usable app
```

### Invariants (NON-NEGOTIABLE)

1. **FT1 is valid only if an integration exists**
2. **Removing integration MUST reset to FT_MINUS_ONE**
3. **Once FT1 is reached, it must never regress**
4. **Refresh must not cause flicker**
5. **First paint must be correct (no “ghost frames”)**

---

## 🏗️ System Layers (Top → Bottom)

```
App.tsx
└─ ShopLifecycleShell        ← single source of truth
   └─ ShopLifecycleContext
      └─ ShopLifecycleGate  ← structural rendering switch
         ├─ ActivationSurface (FT_MINUS_ONE)
         ├─ EmptyDashboard   (FT0)
         └─ <Outlet />       (FT1)
```

---

## 🧠 Integration Layer (Backend Truth)

### File

`apps/frontend/src/contexts/integration/IntegrationProvider.tsx`

### Responsibilities

* Query `/integrations/sync-status`
* Convert backend noise into **stable semantic facts**
* Hide auth churn
* Never guess

### Outputs

Via `useIntegration()`:

```ts
{
  bootResolved: boolean
  existence: 'NONE' | 'EXISTS'
  syncStatus: 'IDLE' | 'PENDING' | 'SYNCING' | 'COMPLETED'
}
```

> ⚠️ IMPORTANT
> `existence === 'EXISTS'` is the **ONLY** signal that Shopify is connected.

---

## 🧠 Lifecycle Resolution (THE CORE)

### File

`apps/frontend/src/lifecycle/ShopLifecycleShell.tsx`

### This is the ONLY file allowed to:

* Read integration state
* Read onboarding readiness
* Read/write FT1 seal
* Decide lifecycle phase

Nothing else may.

---

## 🔐 FT1 Seal (Persistence Contract)

### What it is

A **localStorage latch** proving FT1 was reached **once** for a shop.

```ts
shop:${shopId}:ft1-seen = "true"
```

### Rules

| Situation                 | FT1 Seal              |
| ------------------------- | --------------------- |
| Cold boot, no integration | ❌ removed             |
| Integration created       | ❌ not set yet         |
| Readiness complete        | ✅ set                 |
| Refresh                   | ✅ read synchronously  |
| Integration removed       | ❌ removed immediately |

### Why it exists

Because **effects are too late**.

To prevent FT_MINUS_ONE flashes, FT1 **must be restored synchronously on first render**.

---

## ⚠️ CRITICAL FIX (Do Not Undo)

### File

`ShopLifecycleShell.tsx`

### The fix that eliminated the last flash

```ts
const [latchedPhase, setLatchedPhase] =
  useState<ShopLifecyclePhase | null>(() => {
    // 🔒 Synchronous restore on refresh
    if (ft1Sealed) {
      return 'FT1_READY';
    }
    return null;
  });
```

### Why this is sacred

* Runs **before first paint**
* Prevents FT_MINUS_ONE from ever rendering on refresh
* Effects cannot do this
* Guards cannot do this
* Refs cannot do this

> ❗ If someone “simplifies” this later, the flash WILL come back.

---

## 🧮 Logical Phase Resolution (Pure Logic)

Still inside `ShopLifecycleShell.tsx`:

```ts
if (!bootResolved || !shopId) {
  resolvedPhase = 'FT_MINUS_ONE';
} else if (!integrationExists) {
  resolvedPhase = 'FT_MINUS_ONE';
} else if (syncStatus !== 'COMPLETED') {
  resolvedPhase = 'FT0_SYNCING';
} else if (readiness?.ft1?.isComplete === true) {
  resolvedPhase = 'FT1_READY';
} else {
  resolvedPhase = 'FT0_PREPARING';
}
```

This logic is:

* deterministic
* monotonic
* backend-driven
* UX-agnostic

---

## 🧷 Visual Latch (Anti-Regression)

Still in `ShopLifecycleShell.tsx`

Purpose:

* Prevent backward transitions
* Enforce FT0 dwell only on first FT1
* Ignore backend jitter

Key properties:

* `hasEverReachedFT1Ref`
* `prevExistenceRef`
* `ft0EnteredAtRef`

This is **stateful by design**.

---

## 🚦 Structural Rendering Gate

### File

`apps/frontend/src/lifecycle/ShopLifecycleGate.tsx`

### Responsibilities

* NO logic
* NO effects
* NO timers

Just:

```ts
switch (phase) {
  case 'FT_MINUS_ONE': return <ActivationSurface />
  case 'FT0_*':        return <EmptyDashboard />
  case 'FT1_READY':    return <Outlet />
}
```

This is intentionally dumb.

---

## 🛡️ Safety Nets (DEV-ONLY)

### DashboardLifecycleShell

Crashes if mounted before FT1.

### ModuleLifecycleShell

Crashes if modules mount before FT1.

These are **guard rails**, not logic.

---

## ✅ Final Verified Behavior

| Scenario                      | Result                   |
| ----------------------------- | ------------------------ |
| Cold app load, no integration | FT_MINUS_ONE only        |
| Click CTA                     | FT0 → FT1                |
| First FT1                     | FT0 shown once           |
| Refresh after FT1             | **Instant FT1**          |
| Integration removed           | FT_MINUS_ONE immediately |
| Auth churn                    | No flicker               |
| Backend races                 | No flicker               |

---

## 🚫 What Must NEVER Be Done

* ❌ Move lifecycle logic out of `ShopLifecycleShell`
* ❌ Initialize `latchedPhase` without FT1 seal check
* ❌ Re-introduce `VisualLifecycleGate`
* ❌ Let routing decide lifecycle
* ❌ Infer integration existence anywhere except `IntegrationProvider`

---

## 🧠 Mental Model (Remember This)

> **Lifecycle is resolved synchronously.
> UX reacts to lifecycle.
> Effects are too late for correctness.**

---