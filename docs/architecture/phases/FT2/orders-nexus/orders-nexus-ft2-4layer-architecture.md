# 🔒 Order-Nexus FT2 — 4-Layer Architecture Blueprint

**Status:** Canonical · Enforced · Leak-Safe
**Applies To:** All FT2 modules
**Reference Implementation:** Order-Nexus

---

## 0. Why This Architecture Exists

Order-Nexus handles the **highest-risk truth** in LaSyncro:

* revenue
* cost signals
* fulfillment exposure
* operational correctness

Any shortcut in this module:

* corrupts trust,
* contaminates downstream modules,
* breaks Echo Hub and WMS-Lite assumptions.

Therefore, Order-Nexus is implemented using **four hard, one-way layers**.

FT2 represents the **maximum resolution of truth allowed to leave the backend**.

---

## 1. Architectural Overview

```
Persistence / Canonical Orders
        ↓
Layer 1 — Order Facts        (What is true)
        ↓
Layer 2 — Order Intelligence (What it means, internally)
        ↓
Layer 3 — FTEP               (What may be exposed)
        ↓
Layer 4 — FT2 UI             (What the user sees)
```

### Inviolable Rules

* Data flows **downward only**
* Each layer **destroys information**
* No layer may compensate for missing truth
* UI must render correctly with **null everywhere**

Violation of any rule = **architecture breach**

---

## 2. Layer 1 — Order Facts

**Canonical Truth Layer**

---

### Purpose

Extract **raw, interpretation-free facts** directly from persistence.

This is the **only layer allowed to read the database**.

---

### What This Layer Is

* Deterministic
* Auditable
* Recomputable
* Stateless (except DB reads)

---

### What This Layer Is NOT

* ❌ Intelligent
* ❌ Explanatory
* ❌ User-facing
* ❌ Opinionated

---

### 2.1 Location

```
apps/backend/src/services/order-facts/
├── orderFacts.service.ts
├── orderFacts.types.ts
└── index.ts
```

---

### 2.2 Canonical Types

```ts
export interface OrderFacts {
  shopId: number;
  period: { from: string; to: string };

  ordersObserved: number | null;

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  dataCoverage: {
    completenessPct: number | null;
  };

  extractedAt: string;
}
```

---

### 2.3 Design Constraints (Hard)

* ❌ No derived percentages
* ❌ No statuses
* ❌ No booleans like “loss”
* ❌ No heuristics
* ❌ No defaults other than `null`
* ✅ Preserve absence explicitly

`null` represents **unknown**, not failure.

---

### 2.4 Responsibilities

* Query canonical tables
* Perform **only** counts and sums
* Apply time windows
* Never infer missing data
* Never join domains unless explicitly allowed

---

## 3. Layer 2 — Order Intelligence

**Internal Meaning Layer**

---

### Purpose

Convert **facts → classified signals**, strictly for **internal use**.

This layer is allowed to *think* — but must **never speak directly**.

---

### 3.1 Location

```
apps/backend/src/services/order-intelligence/
└── orderIntelligence.service.ts
```

---

### 3.2 Intelligence Types (Internal Only)

```ts
export interface OrderNexusIntelligence {
  ordersObserved: number | null;

  margin: {
    averagePct: number | null;
    status: 'healthy' | 'at_risk' | 'loss' | 'unknown';
  };

  loss: {
    exists: boolean | null;
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  dataCoveragePct: number | null;
}
```

---

### 3.3 Allowed Operations

* Classification (threshold-based)
* Direction detection
* Deterministic mapping
* Null-safe derivation

---

### 3.4 Forbidden Operations

* ❌ Explanations
* ❌ Drivers or causes
* ❌ Recommendations
* ❌ Forecasting
* ❌ Cross-module enrichment

If intelligence becomes **descriptive**, the layer is broken.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

**Security Boundary**

---

This is the **most critical layer**.

FTEP defines **what truth is allowed to leave the backend**.

---

### 4.1 Location

```
apps/backend/src/services/order-ftep/
├── orderFtep.types.ts
├── orderFtep.service.ts
└── index.ts
```

---

### 4.2 Core Principle

> **Intelligence must always be downgraded.**

If raw intelligence is exposed → **hard violation**.

---

### 4.3 Input Contract

```ts
export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}
```

---

### 4.4 Output Contract (FT2 Exposure)

```ts
export interface OrderNexusFT2Exposure {
  context: {
    period: { from: string; to: string };
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };
}
```

---

### 4.5 Downgrade Rules (Non-Negotiable)

| Intelligence Signal | FT2 Exposure Result      |
| ------------------- | ------------------------ |
| Margin percentage   | ❌ removed                |
| Loss existence      | positive / negative only |
| Trend delta         | direction only           |
| Confidence          | ❌ removed                |
| Explanations        | ❌ forbidden              |

Unknown intelligence is downgraded to **`null`**, not `'unknown'`.

---

### 4.6 Leak-Prevention Tests (Mandatory)

Tests must assert:

* No intelligence fields exist in output
* No percentages leak
* No causation language appears
* Serialized output is clean

**If any test fails, the build must fail.**

---

## 5. Layer 4 — FT2 UI

**Read-Only Observability Layer**

---

### Purpose

Render **exactly what FTEP allows** — nothing more.

---

### 5.1 Location

```
modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts
```

---

### 5.2 UI Invariants

* ❌ No CTAs
* ❌ No recommendations
* ❌ No intelligence language
* ❌ No assumptions
* ✅ Deterministic rendering
* ✅ Null-safe everywhere

---

### 5.3 Adapter Role (Critical Gate)

Adapters must:

* Normalize `undefined → null`
* Preserve backend semantics
* Perform **zero computation**

If logic appears here → **truth leak detected**.

---

## 6. Lifecycle Integration

* FT2 eligibility resolved by `FT2EvaluatorService`
* FT2 latch written only on explicit confirmation
* Order-Nexus FT2 delivered **only through lifecycle resolution**

No module may bypass lifecycle.

---

## 7. Replication Rules (All Future FT2 Modules)

To claim FT2 compliance, a module must:

1. Implement **Facts** (Layer 1)
2. Implement **Intelligence** (Layer 2)
3. Implement **FTEP** (Layer 3)
4. Implement **Read-Only FT2 UI** (Layer 4)
5. Include **leak-prevention tests**
6. Be gated by **lifecycle**

If Layer 3 is missing → **module is rejected**.

---

## 8. Why This Is Non-Negotiable

Because:

* Echo Hub depends on clean truth
* WMS-Lite depends on clean truth
* Cross-module intelligence requires strict ownership
* **Trust is the product**

Order-Nexus is the **keystone**.

If it leaks, everything downstream lies.

---

## 9. Status

* ✅ Order-Nexus is the reference FT2 module
* 🔒 Architecture is locked
* 🔁 Pattern is mandatory for all FT2 modules

---