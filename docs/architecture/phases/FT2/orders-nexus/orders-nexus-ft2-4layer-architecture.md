# Order-Nexus FT2 — 4-Layer Architecture Blueprint

**(Canonical · Enforced · Leak-Safe)**

---

## 0. Why This Architecture Exists

Order-Nexus handles **the most dangerous data in LaSyncro**:
money, fulfillment, and operational truth.

Any shortcut here:

* corrupts trust,
* pollutes other modules,
* and breaks Echo Hub / WMS-Lite downstream.

Therefore the system is built as **four hard layers** with **one-way flow only**.

There is **no FT3**.
FT2 is the highest possible resolution of truth.

---

## 1. Architectural Overview

```
Persistence / Canonical Orders
        ↓
Layer 1 — Order Facts        (What is true)
        ↓
Layer 2 — Order Intelligence (What it means, internally)
        ↓
Layer 3 — FTEP               (What is allowed to be exposed)
        ↓
Layer 4 — FT2 UI             (What the user sees)
```

### Inviolable Rules

* Data flows **down only**
* Each layer **destroys information**
* No layer may compensate for missing truth
* UI must survive **null everywhere**

---

## 2. Layer 1 — Order Facts

**Canonical Truth Layer**

### Purpose

Extract **raw, interpretation-free facts** directly from persistence.

### What This Layer Is

* Deterministic
* Auditable
* Recomputable
* Stateless (except DB reads)

### What This Layer Is NOT

* Not intelligent
* Not explanatory
* Not user-facing
* Not opinionated

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

### Design Constraints

* ❌ No percentages derived from math
* ❌ No statuses (healthy / unhealthy)
* ❌ No booleans like “loss”
* ❌ No guesses
* ✅ `null` preserved exactly

---

### 2.3 Service Responsibilities

* Query canonical tables
* Aggregate counts and sums only
* Never infer missing data
* Never join across domains unless explicitly allowed

---

## 3. Layer 2 — Order Intelligence

**Internal Meaning Layer**

### Purpose

Convert **facts → classified signals**, strictly for internal use.

This is where *meaning* exists — but it must **never leak directly**.

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
* Null-safe derivation
* Deterministic mapping

---

### 3.4 Forbidden Operations

* ❌ Explanations
* ❌ Drivers
* ❌ Recommendations
* ❌ Forecasting
* ❌ Cross-module enrichment

If this layer starts *talking* — it is broken.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

**Security Boundary**

This is the **most important layer**.

It enforces **what truth is allowed to leave the backend**.

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

If intelligence is exposed raw → **architecture violation**.

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

### 4.5 Downgrade Rules (Hard)

| Intelligence | FT2 Exposure          |
| ------------ | --------------------- |
| Margin %     | ❌ removed             |
| Loss exists  | → positive / negative |
| Trend delta  | → direction only      |
| Confidence   | ❌ removed             |
| Explanations | ❌ forbidden           |

---

### 4.6 Leak-Prevention Tests

Mandatory tests assert:

* No intelligence fields exist
* No percentages leak
* No causation language
* Serialized output is clean

**If these tests fail, the build must fail.**

---

## 5. Layer 4 — FT2 UI

**Read-Only Observability**

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

* ❌ No CTA
* ❌ No recommendations
* ❌ No intelligence language
* ❌ No assumptions
* ✅ Null-safe rendering
* ✅ Deterministic output

---

### 5.3 Adapter Role (Critical)

The adapter:

* Normalizes `undefined → null`
* Preserves semantics
* Does **zero computation**

If logic appears here → **leak detected**.

---

## 6. Lifecycle Integration (Current State)

* FT2 eligibility handled by `FT2EvaluatorService`
* FT2 latch written only on explicit confirmation
* Order-Nexus FT2 exposure will be delivered **through lifecycle resolver**

No module bypasses lifecycle.

---

## 7. Extension Rules (For All Future Modules)

To replicate this architecture:

1. Create **Facts** (Layer 1)
2. Create **Intelligence** (Layer 2)
3. Create **FTEP** (Layer 3)
4. Create **Read-Only FT2 UI** (Layer 4)
5. Add **leak-prevention tests**
6. Wire via **lifecycle only**

If step 3 is skipped → module is rejected.

---

## 8. Why This Architecture Is Non-Negotiable

Because:

* Echo Hub depends on truth
* WMS-Lite depends on truth
* Cross-module intelligence depends on clean ownership
* Trust is the product

Order-Nexus is the **keystone**.

If it leaks, everything downstream lies.

---

## 9. Status

* ✅ Order-Nexus is the reference module
* ✅ Architecture is locked
* 🔒 Pattern is mandatory for all FT2 modules

---