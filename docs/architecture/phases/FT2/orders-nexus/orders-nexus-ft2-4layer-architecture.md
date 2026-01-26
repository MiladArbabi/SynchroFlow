# 🔒 Order-Nexus FT2 — 4-Layer Architecture Blueprint (CURRENT · SEALED)

**Status:** ✅ Canonical · Enforced · Leak-Safe
**Applies To:** All FT2 modules
**Reference Implementation:** Order-Nexus
**Apex Rule:** **FT2 is final. There is no FT3.**

---

## 0. Why This Architecture Exists

Order-Nexus handles the **highest-risk economic truth** in LaSyncro:

* order presence
* revenue presence
* economic direction
* epistemic usability of data
* system grounding (is data even flowing?)

Any shortcut in this module:

* corrupts trust,
* contaminates downstream modules,
* breaks Analytics, Echo Hub, and Ops reasoning.

Therefore, Order-Nexus is implemented using **four hard, one-way layers**.

> **FT2 is the maximum resolution of truth allowed to leave the backend**
> → *orientation without advice*.

---

## 1. Architectural Overview (LOCKED)

```
Persistence / Canonical Orders
        ↓
Layer 1   — Canonical Facts          (What exists)
Layer 1½  — Temporal Facts           (How it moves)
        ↓
Layer 2   — Intelligence             (What it means — internal only)
        ↓
Layer 3   — FTEP                     (What may be exposed)
        ↓
Layer 4   — FT2 UI                   (What the user sees)
```

### Inviolable Rules

* Data flows **downward only**
* Each layer **destroys information**
* No layer may compensate for missing truth
* UI must render correctly with **null everywhere**

Violation of any rule = **architecture breach**.

---

## 2. Layer 1 — Canonical Facts (Truth)

**Canonical Observation Layer**

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
├── orderTrendFacts.service.ts
├── orderFacts.types.ts
└── index.ts
```

---

### 2.2 Canonical Types (CURRENT)

```ts
export interface OrderFacts {
  shopId: number;

  ordersObserved: number | null;

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;   // always null (non-existent fact)
    currency: string | null;    // always null (not inferable)
  };

  dataCoverage: {
    completenessPct: number | null;
  };

  extractedAt: string;
}
```

```ts
export interface OrderTrendFacts {
  previousWindowOrders: number | null;
  currentWindowOrders: number | null;
}
```

---

### 2.3 Design Constraints (HARD)

* ❌ No derived percentages
* ❌ No statuses
* ❌ No booleans like “healthy”
* ❌ No heuristics
* ❌ No defaults other than `null`
* ✅ Preserve absence explicitly

`null` represents **epistemic absence**, not failure.

---

### 2.4 Responsibilities

* Query canonical tables only
* Perform **counts and sums only**
* Apply resolved FT2 temporal window
* Never infer missing data
* Never interpret meaning

---

## 3. Layer 2 — Intelligence (INTERNAL ONLY)

**Meaning Without Voice**

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

### 3.2 Intelligence Outputs (Internal)

```ts
export interface OrderNexusIntelligence {
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  visibility: {
    status: 'sufficient' | 'insufficient' | 'unknown';
  };

  revenueContinuity: {
    status: 'isolated' | 'continuous' | 'unknown';
  };
}
```

---

### 3.3 Intelligence Gates (NON-NEGOTIABLE)

Intelligence **activates only if data is usable**.

| Condition       | Result   |
| --------------- | -------- |
| Coverage `null` | unusable |
| Coverage < 80%  | unusable |
| Coverage ≥ 80%  | usable   |

Unusable → `unknown`.

No gate bypass is allowed.

---

### 3.4 Key Intelligence Semantics

#### Economic Outcome (Orientation Only)

* Revenue > 0 → `positive`
* Revenue ≤ 0 → `negative`
* Data unusable → `unknown`

#### Trend Direction

* Two fixed 7-day windows
* Direction only
* Non-predictive
* Non-explanatory

#### Revenue Continuity (L1½)

* Continuous → signal persists across windows
* Isolated → single-window presence
* No magnitude
* No slope
* No explanation

---

### 3.5 Forbidden Operations

* ❌ Explanations
* ❌ Drivers or causes
* ❌ Recommendations
* ❌ Forecasting
* ❌ Cross-module enrichment

If intelligence becomes descriptive, **the layer is broken**.

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

Raw intelligence must never cross this boundary.

---

### 4.3 Input Contract

```ts
export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}
```

---

### 4.4 Output Contract (FT2 Snapshot)

```ts
export interface OrderNexusFT2Exposure {
  context: {
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
  };

  outcome: { status: 'positive' | 'negative' } | null;

  trend: { direction: 'up' | 'down' | 'flat' } | null;

  revenueContinuity: { status: 'isolated' | 'continuous' } | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;
}
```

---

### 4.5 Downgrade Rules (LOCKED)

| Internal Signal | FT2 Exposure |
| --------------- | ------------ |
| `unknown`       | `null`       |
| Percentages     | ❌ removed    |
| Margin details  | ❌ removed    |
| Trend deltas    | ❌ removed    |
| Explanations    | ❌ forbidden  |

**Critical invariant:**
`unknown` is never emitted.
Unknown → **absence (`null`)**.

---

## 5. Layer 4 — FT2 UI (APEX)

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

### 5.3 Adapter Role (CRITICAL GATE)

Adapters must:

* Normalize `undefined → null`
* Preserve backend semantics
* Perform **zero computation**

Adapters are **pipes**, not brains.

---

### 5.4 System Grounding (NEW · MANDATORY)

FT2 UI must expose **grounding reality** explicitly:

* Ingestion presence
* Temporal freshness
* Revenue continuity
* Data coverage
* Visibility gate

If grounding fails, **everything downstream remains silent**.

---

### 5.5 Trust FT2 (META)

Trust is **not a domain**.

* Fetched via Trust FT2 snapshot
* Passed through adapter unchanged
* Interpreted **only in module UI**
* Rendered as **FT2Surface boundary only**

No text. No icons. No explanations.

---

## 6. Lifecycle & Time Ownership

* Time is resolved **outside FT2**
* FT2 receives range, not authority
* Analytics and intelligence do **not** own time

This prevents temporal drift and retroactive truth mutation.

---

## 7. Replication Rules (ALL FT2 MODULES)

To be FT2-compliant, a module must:

1. Implement **Layer 1 Facts**
2. Implement **Layer 1½ Temporal Facts** (if applicable)
3. Implement **Layer 2 Intelligence**
4. Enforce **Layer 3 FTEP**
5. Render **Layer 4 Read-Only UI**
6. Integrate **Trust FT2** as META boundary

If Layer 3 is missing → **module is rejected**.

---

## 8. Why This Is Non-Negotiable

Because:

* Analytics depends on clean truth
* Echo Hub depends on clean truth
* Ops tooling depends on clean truth
* Cross-module reasoning collapses without strict ownership

**Trust is the product.**

Order-Nexus is the **keystone**.

If it leaks, everything lies.

---

## 9. Final Seal

* System grounding formalized
* Revenue continuity correctly placed at L1½
* Trust elevated to META boundary
* UI aligned to two-core-surface model
* FT2 confirmed as apex

🔐 **Order-Nexus FT2 4-Layer Architecture is current, enforced, and sealed.**

---