# 🔒 Order-Nexus FT2 — 4-Layer Architecture Blueprint (CURRENT)

**Status:** ✅ Canonical · Enforced · Leak-Safe
**Applies To:** All FT2 modules
**Reference Implementation:** Order-Nexus

---

## 0. Why This Architecture Exists

Order-Nexus handles the **highest-risk economic truth** in LaSyncro:

* revenue signals
* cost visibility (or lack thereof)
* order volume direction
* economic usability of data

Any shortcut in this module:

* corrupts trust,
* contaminates downstream modules,
* breaks Echo Hub, Analytics, and WMS-Lite assumptions.

Therefore, Order-Nexus is implemented using **four hard, one-way layers**.

FT2 represents the **maximum resolution of truth allowed to leave the backend** —
*orientation without advice*.

---

## 1. Architectural Overview

```
Persistence / Canonical Orders
        ↓
Layer 1 — Order Facts        (What is true)
        ↓
Layer 2 — Order Intelligence (What it means — internally)
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
    costTotal: number | null;   // always null
    currency: string | null;    // always null
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

`null` represents **epistemic absence**, not failure.

---

### 2.4 Responsibilities

* Query canonical tables
* Perform **only** counts and sums
* Apply resolved FT2 range
* Never infer missing data
* Never interpret

---

## 3. Layer 2 — Order Intelligence

**Internal Meaning Layer**

---

### Purpose

Convert **facts → classified orientation signals**, strictly for **internal use**.

This layer may *think* —
but must **never speak directly**.

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
    averagePct: number | null; // intentionally inactive
    status: 'healthy' | 'loss' | 'unknown';
  };

  loss: {
    exists: boolean | null;
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  dataCoveragePct: number | null;

  visibility: {
    status: 'sufficient' | 'insufficient' | 'unknown';
  };
}
```

---

### 3.3 Intelligence Gates (Non-Negotiable)

Intelligence **may only activate** if data is epistemically usable.

**Data usability rule:**

* `null` coverage → unusable
* `< 80%` coverage → unusable
* `≥ 80%` coverage → usable

No gate bypass is allowed.

---

### 3.4 Active Intelligence (CURRENT)

#### Margin Status (Directional, Not Accounting)

| Condition      | Status    |
| -------------- | --------- |
| Data unusable  | `unknown` |
| Revenue `null` | `unknown` |
| Revenue `<= 0` | `loss`    |
| Revenue `> 0`  | `healthy` |

This is **economic orientation**, not margin computation.

---

#### Trend Direction

Derived from **two consecutive fixed windows** (7 days each).

| Condition            | Direction |
| -------------------- | --------- |
| Data unusable        | `unknown` |
| Insufficient history | `unknown` |
| Increase > 5%        | `up`      |
| Decrease > 5%        | `down`    |
| Otherwise            | `flat`    |

* Deterministic
* Non-predictive
* Non-explanatory

---

#### Economic Visibility (Internal Constraint)

| Data Usable | Visibility     |
| ----------- | -------------- |
| `null`      | `unknown`      |
| `false`     | `insufficient` |
| `true`      | `sufficient`   |

This expresses **whether orientation is epistemically allowed**, not quality.

---

### 3.5 Forbidden Operations

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

> **All intelligence must be downgraded.**

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
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;
}
```

---

### 4.5 Downgrade Rules (Non-Negotiable)

| Intelligence Signal | FT2 Exposure Result        |
| ------------------- | -------------------------- |
| Margin percentage   | ❌ removed                  |
| Margin status       | positive / negative / null |
| Loss existence      | encoded via outcome only   |
| Trend delta         | direction only             |
| Visibility unknown  | ❌ removed (→ null)         |
| Explanations        | ❌ forbidden                |

> **Critical Rule:**
> `'unknown'` is never emitted.
> Unknown intelligence is downgraded to **absence (`null`)**.

---

### 4.6 Leak-Prevention Requirements

The following must always hold:

* No intelligence-only fields in exposure
* No percentages other than coverage
* No causation language
* No internal flags or debug metadata

Violation = **build must fail**.

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

## 6. Lifecycle & Time Ownership

* Time is resolved at the **controller / lifecycle layer**
* FT2 modules accept **range**, not period ownership
* Analytics and downstream observers **do not own time**

This prevents cross-domain temporal drift.

---

## 7. Replication Rules (All Future FT2 Modules)

To claim FT2 compliance, a module must:

1. Implement **Facts** (Layer 1)
2. Implement **Intelligence** (Layer 2)
3. Implement **FTEP** (Layer 3)
4. Implement **Read-Only FT2 UI** (Layer 4)
5. Enforce **downgrade semantics**
6. Be gated by **lifecycle**

If Layer 3 is missing → **module is rejected**.

---

## 8. Why This Is Non-Negotiable

Because:

* Analytics depends on clean truth
* Echo Hub depends on clean truth
* WMS-Lite depends on clean truth
* Cross-module reasoning requires strict ownership

**Trust is the product.**

Order-Nexus is the **keystone**.

If it leaks, everything downstream lies.

---

## 9. Status

* ✅ Order-Nexus is the reference FT2 module
* 🔒 Architecture is locked
* 🔁 Pattern is mandatory for all FT2 modules

---