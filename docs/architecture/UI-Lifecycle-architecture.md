# UI Lifecycle Architecture — Canonical Documentation (v2)

## Purpose

This document defines the **single source of truth** for UI lifecycle handling across **Dashboard and Modules** in SynchroFlow. It explains:

* What lifecycle phases exist
* Where lifecycle decisions are made
* How Dashboard and Modules participate
* What is **explicitly forbidden**

---

## 1. Core Principles (Non-Negotiable)

### 1.1 One Shop-Level Lifecycle Brain

There is **exactly one authority** that decides the **shop lifecycle phase**:

```
ShopLifecycleShell
```

It evaluates **backend integration state** and exposes a **canonical shop phase** via context.

No other component may decide or infer shop lifecycle.

### 1.2 Lifecycle Decision ≠ Lifecycle Rendering

Lifecycle is split into **three strict layers**:

| Layer                     | Responsibility                            |
| ------------------------- | ----------------------------------------- |
| **ShopLifecycleShell**    | Decides *shop phase* (state machine only) |
| **ShopLifecycleGate**     | Decides *which subtree exists*            |
| **GenericLifecycleShell** | Maps UI lifecycle → UI                    |

No layer may absorb responsibility from another.

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
apps/frontend/src/lifecycle/ShopLifecycleShell.tsx
```

```ts
export type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'   // No integration exists
  | 'FT0_SYNCING'    // Backend actively syncing (blocking)
  | 'FT0_PREPARING'  // Sync done, data not ready
  | 'FT1_READY';     // Fully usable app
```

These phases are **shop-level only**.

---

## 3. ShopLifecycleShell (State Machine Only)

```
apps/frontend/src/lifecycle/ShopLifecycleShell.tsx
```

### 3.1 Responsibilities

* Read **integration sync status**
* Resolve **ShopLifecyclePhase**
* Publish phase via `ShopLifecycleContext`

### 3.2 Explicit Non-Responsibilities

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

### 4.1 Purpose

The **only place** allowed to block or allow routes.

### 4.2 Phase → UI Mapping

| Shop Phase      | Rendered UI                           |
| --------------- | ------------------------------------- |
| `FT_MINUS_ONE`  | Activation surface (dashboard config) |
| `FT0_SYNCING`   | Blocking `DataSyncingModal`           |
| `FT0_PREPARING` | `EmptyDashboardState`                 |
| `FT1_READY`     | `<Outlet />` (real app routes)        |

### 4.3 Hard Rule

> **If a route is not reachable at a given phase, it must not exist in the tree.**

No conditional rendering inside pages.

---

## 5. UI Lifecycle (Within FT1 Only)

Once the shop reaches **FT1_READY**, UI lifecycle applies **inside routes**.

Defined in:

```
apps/frontend/src/lifecycle/types.ts
```

```ts
export type UILifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0_SYNCING'
  | 'FT0_PREPARING'
  | 'FT1_READY'
  | 'FT2_PAYWALL';
```

---

## 6. GenericLifecycleShell (Only UI Renderer)

```
apps/frontend/src/lifecycle/GenericLifecycleShell.tsx
```

### 6.1 Responsibilities

* Accept **facts only**
* Resolve `UILifecyclePhase`
* Render exactly one UI per phase

### 6.2 Forbidden

GenericLifecycleShell must **never**:

❌ Fetch data  
❌ Decide shop lifecycle  
❌ Inspect routes  
❌ Special-case dashboard or modules

---

## 7. Adapters (Fact Providers Only)

Adapters **translate facts → lifecycle inputs**. They contain **zero lifecycle logic**.

### 7.1 DashboardLifecycleShell

```
apps/frontend/src/lifecycle/DashboardLifecycleShell.tsx
```

Provides:

* `backendPhase` → inherited from shop phase
* `activationState` → always `ACTIVE` post-FT1
* `isReady` → derived from `DashboardStateContext`
* `activationConfig` → dashboard config

Dashboard **never** promotes lifecycle.

### 7.2 ModuleLifecycleShell

```
apps/frontend/src/lifecycle/ModuleLifecycleShell.tsx
```

Rules:

* Must only render when shop phase = `FT1_READY`
* May **assert invariants** in DEV
* Delegates fully to `GenericLifecycleShell`

Modules do **not**:

❌ Block routes  
❌ Render activation UI  
❌ Decide paywalls

---

## 8. Activation System (Orthogonal)

Activation:

* Is **runtime state only**
* Reports `ACTIVE`, `SYNC_IN_PROGRESS`, etc.
* Does **not** decide readiness or routing

Activation configs live in:

```
apps/frontend/src/activation/configs/
```

Each config defines **presentation**, not lifecycle.

---

## 9. Entitlements & Monetization

Monetization is expressed **only** via:

* `requiresPayment`
* `hasPaidEntitlement`

Paywalls render **only** in `GenericLifecycleShell`.

No page or module may check entitlements directly for UI.

---

## 10. Hard Rules (Enforced)

❌ No lifecycle conditionals outside shells  
❌ No routing logic outside `ShopLifecycleGate`  
❌ No lifecycle inference in pages  
❌ No dashboard special-cases  
❌ No module autonomy

✅ Add behavior only via:

1. ShopLifecycleShell
2. ShopLifecycleGate
3. GenericLifecycleShell
4. Thin adapters

---

## 11. Mental Model (Updated)

> **Shop lifecycle decides what exists.  
> UI lifecycle decides how it looks.  
> Pages never decide either.**

If this stops being true, the architecture is broken.

---

## 12. Shop Lifecycle — Canonical State Diagram

This diagram describes **only the shop-level lifecycle** handled by `ShopLifecycleShell`. It is **authoritative**.

### 12.1 States

```
FT_MINUS_ONE
FT0_SYNCING
FT0_PREPARING
FT1_READY
```

### 12.2 State Meanings (Non-Interpretive)

| State           | Meaning                                      |
| --------------- | -------------------------------------------- |
| `FT_MINUS_ONE`  | No integration record exists                 |
| `FT0_SYNCING`   | Backend integration sync is actively running |
| `FT0_PREPARING` | Sync completed, but UI/data not ready        |
| `FT1_READY`     | App is fully usable                          |

### 12.3 Transition Diagram (Textual)

```
┌────────────────────┐
│    FT_MINUS_ONE    │
│                    │
│ No integration     │
│ exists             │
└─────────┬──────────┘
          │
          │ User connects store
          │ (integration record created)
          ▼
┌────────────────────┐
│    FT0_SYNCING     │
│                    │
│ Backend syncing    │
│ data               │
└─────────┬──────────┘
          │
          │ Sync completes
          │ (status = COMPLETED)
          ▼
┌────────────────────┐
│   FT0_PREPARING    │
│                    │
│ Data exists but    │
│ UI not ready       │
└─────────┬──────────┘
          │
          │ UI readiness achieved
          │ (dashboard/modules hydrated)
          ▼
┌────────────────────┐
│     FT1_READY      │
│                    │
│ Fully usable app   │
└────────────────────┘
```

### 12.4 Transition Rules (Hard Constraints)

#### 12.4.1 FT_MINUS_ONE → FT0_SYNCING

Occurs **only if**:

* An integration record is created
* Backend sync starts

❌ Cannot skip directly to FT0_PREPARING  
❌ Cannot skip directly to FT1_READY

#### 12.4.2 FT0_SYNCING → FT0_PREPARING

Occurs **only if**:

* Backend reports sync complete

❌ UI readiness does NOT matter here  
❌ Entitlements do NOT matter

#### 12.4.3 FT0_PREPARING → FT1_READY

Occurs **only if**:

* UI declares readiness (dashboard + modules hydrated)

This transition is **frontend-controlled**.

### 12.5 Illegal Transitions (Must Never Happen)

| From          | To            | Why                                 |
| ------------- | ------------- | ----------------------------------- |
| FT_MINUS_ONE  | FT0_PREPARING | No integration exists               |
| FT_MINUS_ONE  | FT1_READY     | No activation                       |
| FT0_SYNCING   | FT1_READY     | Skips preparation                   |
| FT0_PREPARING | FT0_SYNCING   | No backward transitions             |
| FT1_READY     | Any           | Terminal unless integration removed |

### 12.6 Removal / Reset Rule

If integration is **deleted**:

```
ANY STATE → FT_MINUS_ONE
```

This is a **hard reset**. No other backward transitions are allowed.

### 12.7 Relationship to Routing

| Phase         | Routes Exist? |
| ------------- | ------------- |
| FT_MINUS_ONE  | ❌ No          |
| FT0_SYNCING   | ❌ No          |
| FT0_PREPARING | ❌ No          |
| FT1_READY     | ✅ Yes         |

All routing is gated **structurally** by `ShopLifecycleGate`.

### 12.8 Relationship to UI Lifecycle

* Shop lifecycle decides **what subtree exists**
* UI lifecycle decides **what UI is rendered**
* UI lifecycle **cannot override** shop lifecycle

### 12.9 One-Line Invariant

> **If the shop is not FT1_READY, application routes must not exist.**

If you ever see a page rendering outside this rule, something is wired incorrectly.

---

## 13. Combined Shop + UI Lifecycle — Canonical Diagram

This diagram shows **who decides what**, **when**, and **what is allowed to render**.

### 13.1 Legend

* **Shop Lifecycle** = structural / routing gate
* **UI Lifecycle** = rendering decision via `resolveUILifecyclePhase`
* **Adapters** = fact providers only
* **Shell** = renderer only

### 13.2 High-Level Flow

```
┌──────────────────────────────┐
│        App Layout            │
│ (TopNav, SideNav, Shell)     │
│  ALWAYS MOUNTED              │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     ShopLifecycleShell       │   ← STATE MACHINE
│  (integration sync status)   │
└──────────────┬───────────────┘
               │ provides
               ▼
┌──────────────────────────────┐
│     ShopLifecycleGate        │   ← STRUCTURAL GATE
│ (what subtree is allowed)    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Dashboard / Modules Exist?  │
│   (YES only at FT1_READY)    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  GenericLifecycleShell       │   ← RENDERER
│ resolveUILifecyclePhase()    │
└──────────────────────────────┘
```

### 13.3 Full State Diagram (Combined)

```
┌────────────────────────────────────────────────────────────┐
│                        FT_MINUS_ONE                         │
│                                                            │
│ Shop: no integration record                                 │
│ UI phase: FT_MINUS_ONE                                      │
│                                                            │
│ Rendered UI:                                                │
│ - ActivationSurfaceAdapter (dashboard config)               │
│ - CTA: Connect Store                                        │
│                                                            │
│ Routes exist? ❌ NO                                         │
└───────────────┬────────────────────────────────────────────┘
                │
                │ User connects store
                │ Integration record created
                ▼
┌────────────────────────────────────────────────────────────┐
│                        FT0_SYNCING                          │
│                                                            │
│ Shop: backend syncing                                      │
│ UI phase: FT0_SYNCING                                      │
│                                                            │
│ Rendered UI:                                                │
│ - DataSyncingModal (blocking)                               │
│                                                            │
│ Routes exist? ❌ NO                                         │
└───────────────┬────────────────────────────────────────────┘
                │
                │ Backend sync completed
                ▼
┌────────────────────────────────────────────────────────────┐
│                       FT0_PREPARING                         │
│                                                            │
│ Shop: integration complete                                  │
│ UI: activated but not ready                                 │
│                                                            │
│ Rendered UI:                                                │
│ - EmptyDashboardState                                       │
│ - "Preparing your dashboard"                                │
│                                                            │
│ Routes exist? ❌ NO                                         │
└───────────────┬────────────────────────────────────────────┘
                │
                │ UI readiness achieved
                │ (dashboard + modules hydrated)
                ▼
┌────────────────────────────────────────────────────────────┐
│                        FT1_READY                            │
│                                                            │
│ Shop: fully active                                          │
│ UI: ready                                                   │
│                                                            │
│ Rendered UI (via GenericLifecycleShell):                    │
│ - Dashboard content                                         │
│ - Module content                                            │
│ - (Optional FT2 paywalls inside modules)                    │
│                                                            │
│ Routes exist? ✅ YES                                        │
└────────────────────────────────────────────────────────────┘
```

### 13.4 Where Each Decision Is Made (Critical)

| Decision            | Location                    | Notes              |
| ------------------- | --------------------------- | ------------------ |
| Integration exists? | `IntegrationContext`        | API truth only     |
| Shop phase          | `ShopLifecycleShell`        | State machine only |
| Routes exist?       | `ShopLifecycleGate`         | Structural         |
| UI phase            | `resolveUILifecyclePhase`   | Single brain       |
| What renders        | `GenericLifecycleShell`     | No logic           |
| Readiness           | Dashboard / Module adapters | Facts only         |

### 13.5 Dashboard & Modules Participation

```
Dashboard / Module Adapter
│
├─ backendPhase      ← from shop lifecycle
├─ activationState   ← from activation surface
├─ isReady           ← from data hydration
├─ requiresPayment   ← static per module
└─ hasPaidEntitlement← entitlements context
            │
            ▼
   resolveUILifecyclePhase()
            │
            ▼
   GenericLifecycleShell
```

They **never**:

* Gate routes
* Decide FT transitions
* Render lifecycle UI directly

### 13.6 One Invariant That Must Hold

> **If ShopLifecyclePhase ≠ FT1_READY, no dashboard or module route may exist.**

If violated:

* Errors like you saw **must** occur
* The architecture is broken

### 13.7 Why This Matters (Blunt Truth)

Right now, your bugs came from **violating layer boundaries**:

* Shop lifecycle leaking into UI
* UI lifecycle leaking into routing
* Integration status being interpreted differently in multiple places

This diagram is the **contract** that prevents that.
