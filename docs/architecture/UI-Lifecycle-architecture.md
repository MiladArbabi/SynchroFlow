Below is the **UI Lifecycle Architecture — Canonical Documentation (v2.1)**.
This is a **surgical update** to v2: no philosophy changes, no rewrites, only corrections and clarifications that reflect the system **as it now actually works**.

---

# UI Lifecycle Architecture — Canonical Documentation (v2.1)

> **Status:** Canonical
> **Supersedes:** v2
> **Change scope:** Clarification + tightening (no architectural changes)

---

## Purpose

This document defines the **single source of truth** for UI lifecycle handling across **Dashboard and Modules** in SynchroFlow.

It specifies:

* What lifecycle phases exist
* Where lifecycle decisions are made
* How routing, structure, and UI rendering are separated
* What is **explicitly forbidden**

---

## 1. Core Principles (Non-Negotiable)

### 1.1 One Shop-Level Lifecycle Brain

There is **exactly one authority** that decides the **shop lifecycle phase**:

```
ShopLifecycleShell
```

It evaluates **backend integration + onboarding readiness** and exposes a **canonical shop phase**.

No other component may decide or infer shop lifecycle.

---

### 1.2 Lifecycle Decision ≠ Lifecycle Rendering

Lifecycle is split into **three strict layers**:

| Layer                     | Responsibility                            |
| ------------------------- | ----------------------------------------- |
| **ShopLifecycleShell**    | Decides *shop phase* (state machine only) |
| **ShopLifecycleGate**     | Decides *what subtree exists*             |
| **GenericLifecycleShell** | Renders UI *after FT1 only*               |

No layer may absorb responsibility from another.

---

### 1.3 Dashboard and Modules Are Equal

* Dashboard is **not special**
* Modules are **not special**
* Neither computes lifecycle
* Both **inherit shop lifecycle**

Any deviation is a bug.

---

## 2. Canonical Shop Lifecycle Phases

Defined in:

```
apps/frontend/src/lifecycle/types.ts
```

```ts
export type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'   // No integration exists
  | 'FT0_SYNCING'    // Backend actively syncing (blocking)
  | 'FT0_PREPARING'  // Sync completed, UI not yet unlocked
  | 'FT1_READY';     // Fully usable app
```

These phases are **shop-level only**.

---

## 3. ShopLifecycleShell (State Machine Only)

```
apps/frontend/src/lifecycle/ShopLifecycleShell.tsx
```

### Responsibilities

* Read **integration sync status**
* Read **onboarding readiness**
* Resolve **ShopLifecyclePhase**
* Publish phase via `ShopLifecycleContext`

### Explicit Non-Responsibilities

❌ Render UI
❌ Route
❌ Show modals
❌ Decide dashboard/module behavior

> This component is a **pure state machine**.

---

## 4. ShopLifecycleGate (Structural Gate)

```
apps/frontend/src/lifecycle/ShopLifecycleGate.tsx
```

### Purpose

The **only place** allowed to:

* Block routes
* Allow routes
* Render **pre-FT1 UI**

---

### 4.1 Phase → Structure / UI Mapping

| Shop Phase      | What Exists / Renders                              |
| --------------- | -------------------------------------------------- |
| `FT_MINUS_ONE`  | Activation surface (route-aware config)            |
| `FT0_SYNCING`   | Blocking `DataSyncingModal`                        |
| `FT0_PREPARING` | `EmptyDashboardState` (“Preparing your dashboard”) |
| `FT1_READY`     | `<Outlet />` (real application routes)             |

---

### 4.2 Hard Rule

> **If a route is not reachable at a given phase, it must not exist in the tree.**

No conditional rendering inside pages.

---

## 5. FT0 UI Substates (Presentation Only — NOT Lifecycle)

**Important clarification introduced in v2.1**

FT0 has **UI substates**, not lifecycle phases.

They are **presentation concerns**, handled exclusively by `ShopLifecycleGate`.

### 5.1 FT0-A — Blocking Sync

* Condition: backend sync actively running
* Lifecycle phase: `FT0_SYNCING`
* UI:

  * `DataSyncingModal`
  * App layout blocked
* Routes: ❌ none

---

### 5.2 FT0-B — Preparing UI

* Condition: backend sync complete, FT1 not unlocked
* Lifecycle phase: `FT0_PREPARING`
* UI:

  * `EmptyDashboardState`
  * “Preparing your dashboard…”
* Routes: ❌ none
* Layout: mounted

---

### 5.3 Hard Rule

> FT0-A and FT0-B MUST NOT be modeled as lifecycle phases.

They are **pure UI substates**.

---

## 6. UI Lifecycle (Post-FT1 Only)

UI lifecycle exists **only after** the shop reaches `FT1_READY`.

Defined implicitly by `GenericLifecycleShell`.

### 6.1 Canonical UI Lifecycle Phases

```ts
export type UILifecyclePhase =
  | 'FT1_READY'
  | 'FT2_PAYWALL';
```

There is **no UI lifecycle** for FT-1 or FT0.

---

## 7. GenericLifecycleShell (Renderer Only)

```
apps/frontend/src/lifecycle/GenericLifecycleShell.tsx
```

### Responsibilities

* Accept **facts only**
* Render:

  * `FT1_READY` → children
  * `FT2_PAYWALL` → paywall UI

### Forbidden

GenericLifecycleShell must **never**:

❌ Fetch data
❌ Decide shop lifecycle
❌ Handle FT-1 / FT0
❌ Inspect routes
❌ Special-case dashboard or modules

> GenericLifecycleShell is a **post-FT1 renderer only**.

---

## 8. Adapters (Fact Providers Only)

Adapters translate **facts → props**.
They contain **zero lifecycle logic**.

---

### 8.1 DashboardLifecycleShell

```
apps/frontend/src/lifecycle/DashboardLifecycleShell.tsx
```

Provides:

* `backendPhase = 'FT1'`
* `isReady` (dashboard hydration signal)
* children

**Does NOT:**

* Handle activation surfaces
* Promote lifecycle
* Gate routes

---

### 8.2 ModuleLifecycleShell

```
apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx
```

Rules:

* Must render **only when shop phase = FT1_READY**
* Asserts invariants in DEV
* Delegates rendering to `GenericLifecycleShell`

Modules do **not**:

❌ Render activation UI
❌ Gate routes
❌ Decide lifecycle

---

## 9. Activation System (Orthogonal)

Activation:

* Is **runtime / UX state only**
* Is resolved structurally in `ShopLifecycleGate` (FT-1)
* Is rendered via `ActivationSurfaceAdapter`

Activation configs live in:

```
apps/frontend/src/activation/configs/
```

They define **presentation only**, never lifecycle.

---

## 10. Entitlements & Monetization

Monetization is expressed **only** via:

* `requiresPayment`
* `hasPaidEntitlement`

Paywalls render **only** inside `GenericLifecycleShell`.

No page or module may inspect entitlements directly for UI.

---

## 11. Hard Rules (Enforced)

❌ No lifecycle conditionals outside shells
❌ No routing logic outside `ShopLifecycleGate`
❌ No lifecycle inference in pages
❌ No dashboard special-cases
❌ No module autonomy

✅ All behavior added via:

1. ShopLifecycleShell
2. ShopLifecycleGate
3. GenericLifecycleShell
4. Thin adapters

---

## 12. Shop Lifecycle — Canonical State Diagram

```
FT_MINUS_ONE
    ↓
FT0_SYNCING
    ↓
FT0_PREPARING
    ↓
FT1_READY
```

### One-Line Invariant

> **If the shop is not FT1_READY, application routes must not exist.**

---

## 13. Final Mental Model (v2.1)

> **Shop lifecycle decides what exists.
> FT0 UI decides how waiting looks.
> UI lifecycle decides how usable UI renders.
> Pages decide nothing.**

If this stops being true, the architecture is broken.

---

**End of Canonical Documentation v2.1**
