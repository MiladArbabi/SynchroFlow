# 🔐 Analytics Module — Canonical 4-Layer FT2 Architecture Blueprint

**Status:** FT2-compliant, test-sealed, lifecycle-safe
**Purpose:** Expose *observations* about business performance without leaking intelligence, causation, or strategy.

---

## 0. Architectural Intent (Why This Exists)

Analytics is **not** a reporting module.

It is a **truth observability surface** that:

* Extracts **raw economic signals**
* Classifies them **internally**
* Downgrades them into **safe, non-strategic observables**
* Exposes them **only** when FT2 is already unlocked upstream

The architecture enforces:

* ❌ No intelligence in UI
* ❌ No percentages, margins, or strategy
* ❌ No lifecycle inference in controllers
* ❌ No silent assumptions

---

## 1. High-Level Flow (Locked)

```
Database
  ↓
[Layer 1] Analytics Facts
  ↓
[Layer 2] Analytics Intelligence
  ↓
[Layer 3] Analytics FTEP
  ↓
[Layer 4] Analytics FT2 HTTP Controller
  ↓
Frontend FT2 Adapter (dumb pipe)
```

Each layer is **structurally incapable** of doing the wrong thing.

---

## 2. Layer 1 — Analytics Facts (Canonical Truth)

### 📍 Location

```
apps/backend/src/services/analytics-facts/
```

### Files

* `analyticsFacts.service.ts`
* `analyticsFacts.types.ts`
* `index.ts`

### Responsibility

Extract **raw, interpretation-free truth** from persistence.

This is the **only layer** allowed to:

* Import `api-db`
* Run SQL
* Perform aggregates

### Data Extracted (Exact)

```ts
interface AnalyticsFacts {
  shopId: number;

  period: { from: string; to: string };

  revenueObserved: number | null;
  cogsObserved: number | null;

  ordersObserved: {
    processing: number | null;
    delivered: number | null;
    in_transit: number | null;
  };

  extractedAt: string;
}
```

### Invariants (Enforced)

* `null ≠ 0`
* No derived values
* No statuses
* No percentages
* No margins
* No health labels
* No defaults

### Example Guarantees

* If **no sales exist** → `revenueObserved = null`
* If **some statuses missing** → only those keys are `null`
* If DB returns strings → parsed to numbers, nothing else

Facts **never help the consumer**.

---

## 3. Layer 2 — Analytics Intelligence (Internal Classification)

### 📍 Location

```
apps/backend/src/services/analytics-intelligence/
```

### Files

* `analyticsIntelligence.service.ts`
* `analyticsIntelligence.types.ts`
* `index.ts`

### Responsibility

Convert **facts → internal meaning**.

This layer:

* **Decides**
* But **does not speak**

### Input

```ts
AnalyticsFacts
```

### Output (Internal Only)

```ts
interface AnalyticsIntelligence {
  revenueObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };
}
```

### Classification Rules (Locked by Tests)

* `revenueObserved === null` → `unknown`
* `revenueObserved === 0` → `negative`
* `revenueObserved > 0` → `positive`
* `trend.direction` → always `'unknown'` (no historical inference)

### Forbidden (Structurally)

* ❌ DB access
* ❌ Percentages
* ❌ Margins
* ❌ Profit / loss
* ❌ Explanations
* ❌ Recommendations

This layer **cannot leak**, because it is never exposed.

---

## 4. Layer 3 — Analytics FTEP

*(Facts → Truth Exposure Policy)*

### 📍 Location

```
apps/backend/src/services/analytics-ftep/
```

### Files

* `analyticsFtep.service.ts`
* `analyticsFtep.types.ts`
* `index.ts`

### Responsibility

**Downgrade intelligence into FT2-safe observability.**

This is the **most critical safety layer**.

### Input

```ts
{
  facts: AnalyticsFacts;
  intelligence: AnalyticsIntelligence;
}
```

### Output (FT2 Exposure)

```ts
interface AnalyticsFT2Exposure {
  context: {
    period: { from: string; to: string };
    revenueObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;
}
```

### Downgrade Rules (Non-Negotiable)

* Intelligence `unknown` → `outcome = null`, `trend = null`
* Only **one metric** exposed: `revenueObserved`
* No derived fields added
* No raw facts leaked
* No intelligence internals leaked

### Explicitly Impossible to Expose

* ❌ Margin %
* ❌ Profit / loss
* ❌ Perfect order %
* ❌ Inventory health
* ❌ Reasons
* ❌ Thresholds
* ❌ Benchmarks

### Leak-Prevention Tests Enforce

* Serialization scan (`percent|margin|profit|loss|because`)
* Field absence assertions
* Null-safety guarantees

---

## 5. Layer 4 — Analytics FT2 HTTP Controller (Transport)

### 📍 Location

```
apps/backend/src/api/analytics/
```

### Files

* `analytics.ft2.controller.ts`
* `analytics.routes.ts`
* `index.ts`

### Route

```
GET /api/v1/analytics/ft2?from=YYYY-MM-DD&to=YYYY-MM-DD
```

### Responsibility

**Pure transport pipe. Nothing else.**

### What It Does

1. Authenticates shop (via middleware)
2. Validates query period
3. Calls FT2 provider:

   ```
   Facts → Intelligence → FTEP
   ```
4. Returns JSON

### What It Explicitly Does NOT Do

* ❌ Lifecycle resolution
* ❌ FT2 entitlement decisions
* ❌ Business logic
* ❌ Aggregation
* ❌ Intelligence
* ❌ Mutation

**Lifecycle gating is enforced upstream**, not here
(canonically aligned with Specter).

---

## 6. Analytics FT2 Provider (Orchestration Only)

### 📍 Location

```
apps/backend/src/services/analytics-ft2.provider.ts
```

### Responsibility

Deterministically wire the pipeline.

```ts
Facts → Intelligence → FTEP
```

No logic. No branching. No persistence.

This file exists so:

* Controllers stay thin
* Pipeline is reusable
* Testing is isolated

---

## 7. Test Coverage (What Makes This Unbreakable)

### Unit Tests Added

```
tests/unit/backend/analytics/
├── analyticsFacts.service.test.ts
├── analyticsIntelligence.service.test.ts
└── analyticsFtep.service.test.ts
```

### What They Guarantee

* Facts return raw truth only
* Intelligence classifies without math or DB
* FTEP strips intelligence aggressively
* No forbidden semantics can serialize
* Nulls propagate safely

If a future engineer tries to:

* add a percentage
* leak margin
* expose reasoning

→ tests **will fail immediately**

---

## 8. What Analytics FT2 Is — and Is Not

### It IS

* A **truth observability surface**
* A **signal that something exists**
* A **directionless snapshot**
* A **safe primitive for future / AI layers**

### It Is NOT

* A dashboard
* A report
* A recommendation engine
* A strategy module
* A financial analysis tool

---

## 9. Replication Contract (For Future Modules)

To replicate Analytics FT2 for another module:

* Clone **directory structure**
* Copy **test philosophy**
* Enforce **Facts → Intelligence → FTEP**
* Never skip FTEP
* Never let controllers think

If any layer is merged or bypassed → **architecture is invalid**.

---

## 🔒 Final Status

**Analytics FT2 is now:**

* Deterministic
* Leak-proof
* Lifecycle-safe
* Test-sealed
* Canonical

This module can now safely:

* Feed dashboards
* Power readiness signals
* intelligence later

Nothing more is allowed.
