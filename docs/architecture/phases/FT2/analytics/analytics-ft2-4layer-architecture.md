# 🔐 Analytics Module — Canonical 4-Layer FT2 Architecture Blueprint

**Status:** 🔒 FT2-compliant • Test-sealed • Cross-module-safe
**Purpose:** Expose **observability of business data surfaces** without leaking intelligence, causation, or strategy.

---

## 0. Architectural Intent (Why This Exists)

Analytics is **not** a business evaluator.
Analytics is **not** a financial interpreter.
Analytics is **not** a reporting engine.

Analytics is a **cross-module observability aggregator** that answers only:

> *What is visible? What is absent? What is unknowable?*

It exists to:

* Aggregate **observability facts** across modules
* Normalize **presence / absence / blindness**
* Preserve ambiguity
* Expose **nothing that implies performance, quality, or causation**

The architecture enforces:

* ❌ No business intelligence in UI
* ❌ No financial meaning
* ❌ No outcomes or trends
* ❌ No inferred readiness
* ❌ No lifecycle logic in controllers
* ❌ No silent defaults

---

## 1. High-Level Flow (LOCKED)

```
Persistence / FT2 Modules
  ↓
[Layer 1] Analytics Facts (Observability Substrate)
  ↓
[Layer 2] Analytics Intelligence (Observability Classification)
  ↓
[Layer 3] Analytics FTEP (Truth Exposure Policy)
  ↓
[Layer 4] Analytics FT2 HTTP Controller
  ↓
Frontend FT2 Adapter (Identity Pipe)
```

Each layer is **structurally incapable** of violating FT2 doctrine.

---

## 2. Layer 1 — Analytics Facts (Observability Substrate)

### 📍 Location

```
apps/backend/src/services/analytics-facts/
```

### Files

* `analyticsFacts.service.ts`
* `analyticsFacts.types.ts`

### Responsibility

Extract **raw observability facts** from:

* Canonical persistence **or**
* Upstream **FT2-safe module exposures**

This layer answers only:

* Do rows exist?
* How many?
* Is time observable?

### Canonical Shape (SEALED)

```ts
export interface AnalyticsFacts {
  shopId: number;

  snapshotId: string;
  extractedAt: string;

  domains: {
    orders: AnalyticsDomainFacts;
    products: AnalyticsDomainFacts;
    customers: AnalyticsDomainFacts;
    finances: AnalyticsDomainFacts;
  };
}

export interface AnalyticsDomainFacts {
  presence: boolean | null;
  observationCount: number | null;
  nullSurface: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}
```

### Domain Sourcing Rules (CRITICAL)

| Domain    | Source of Truth                                 |
| --------- | ----------------------------------------------- |
| Orders    | **Orders FT2 exposure** (provider-level)        |
| Products  | Canonical products tables / Products FT2        |
| Customers | Canonical customers tables / Customers FT2      |
| Finances  | Canonical financial transactions / Finances FT2 |

🔒 **Hard Rule:**
Analytics **never** queries operational tables owned by another module when an FT2 provider exists.

---

### Invariants (Enforced)

* `null ≠ 0`
* Presence is **not readiness**
* Count is **not performance**
* Time is **observation span**, not business period
* No joins across domains
* No derived metrics
* No interpretation

Facts **do not help the consumer**.

---

## 3. Layer 2 — Analytics Intelligence (Observability Classification)

### 📍 Location

```
apps/backend/src/services/analytics-intelligence/
```

### Files

* `analyticsIntelligence.service.ts`
* `analyticsIntelligence.types.ts`

### Responsibility

Convert **observability facts → observability states**.

This layer:

* Classifies
* Preserves ambiguity
* Never explains
* Never judges quality or success

### Input

```ts
AnalyticsFacts
```

### Output (Internal Only, Never Exposed Directly)

```ts
export interface AnalyticsIntelligence {
  snapshot: {
    id: string;
    extractedAt: string;
  };

  domains: {
    orders: AnalyticsDomainIntelligence;
    products: AnalyticsDomainIntelligence;
    customers: AnalyticsDomainIntelligence;
    finances: AnalyticsDomainIntelligence;
  };
}
```

```ts
export interface AnalyticsDomainIntelligence {
  presence: 'present' | 'absent' | 'unknown';
  observationLevel: 'none' | 'low' | 'partial' | 'full' | 'unknown';
  continuity: 'continuous' | 'intermittent' | 'missing' | 'unknown';

  timestamps: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };

  raw: {
    observationCount: number | null;
    nullSurface: number | null;
  };
}
```

### Classification Rules (Locked)

* `presence === null` → `'unknown'`
* `presence === false` → `'absent'`
* `presence === true` → `'present'`
* Volume → observationLevel only
* Missing timestamps → `'intermittent'`

🔒 **Contract Rule:**
Intelligence **never emits null**.
Ambiguity is encoded explicitly as `'unknown'`.

---

## 4. Layer 3 — Analytics FTEP (Truth Exposure Policy)

### 📍 Location

```
apps/backend/src/services/analytics-ftep/
```

### Files

* `analyticsFtep.service.ts`
* `analyticsFtep.types.ts`

### Responsibility

Downgrade **observability intelligence → FT2-safe exposure**.

This is the **only layer allowed to suppress truth**.

### Input

```ts
{
  intelligence: AnalyticsIntelligence;
}
```

### Output (FT2 Exposure — SEALED)

```ts
export interface AnalyticsFT2Exposure {
  snapshot: {
    id: string;
    extractedAt: string;
  };

  domains: {
    orders: AnalyticsDomainExposure | null;
    products: AnalyticsDomainExposure | null;
    customers: AnalyticsDomainExposure | null;
    finances: AnalyticsDomainExposure | null;
  };
}
```

### Suppression Rules (Non-Negotiable)

* `presence === 'unknown'` → domain = `null`
* Otherwise:

  * expose **raw observability only**
  * strip **all intelligence classifications**

### Explicitly Impossible to Expose

* ❌ Outcomes
* ❌ Trends
* ❌ Money
* ❌ Percentages
* ❌ Health
* ❌ Readiness
* ❌ Explanations

---

## 5. Layer 4 — Analytics FT2 HTTP Controller (Transport Only)

### 📍 Location

```
apps/backend/src/api/analytics/
```

### Files

* `analytics.ft2.controller.ts`

### Route

```
GET /api/v1/modules/analytics/ft2
```

### Responsibility

Pure transport.

### What It Does

1. Authenticates shop
2. Resolves FT2 period (lifecycle-owned)
3. Calls provider
4. Returns JSON

### What It NEVER Does

* ❌ Query DB
* ❌ Classify
* ❌ Infer
* ❌ Mutate
* ❌ Reconstruct intelligence

---

## 6. Analytics FT2 Provider (Orchestration Only)

### 📍 Location

```
apps/backend/src/services/analytics-ft2.provider.ts
```

### Responsibility

Deterministic wiring only:

```
Facts → Intelligence → FTEP
```

No logic.
No branching.
No defaults.

---

## 7. Frontend Adapter (Identity Only)

### 📍 Location

```
apps/frontend/src/pages/analytics/useAnalyticsFt2Adapter.ts
```

### Rule

```ts
mapAnalyticsFt2Props(snapshot) === snapshot
```

Any transformation here is a **contract violation**.

---

## 8. What Analytics FT2 Is — and Is Not

### It IS

* A **cross-module observability map**
* A **blindness detector**
* A **truth-preserving aggregator**
* A **safe substrate for future intelligence layers**

### It Is NOT

* A performance dashboard
* A KPI surface
* A business evaluator
* A financial analyzer
* A recommendation system

---

## 9. Replication Doctrine (Mandatory for New Modules)

To add a new Analytics-like module:

1. Facts must own observability
2. Intelligence must encode ambiguity
3. FTEP must suppress aggressively
4. Controllers must stay stupid
5. UI must never infer

If any layer is skipped → **architecture breach**.

---

## 🔒 FINAL STATUS

**Analytics FT2 is now:**

* Observability-only
* Cross-module-safe
* Intelligence-suppressed
* Null-honest
* Test-sealed
* Contractually minimal

Nothing more is allowed.

---