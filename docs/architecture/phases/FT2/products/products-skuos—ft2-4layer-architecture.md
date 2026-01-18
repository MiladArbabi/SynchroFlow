# 📦 Products / SKU-OS — 4-Layer FT2 Architecture Contract

**Phase:** FT2
**Module:** Products / SKU-OS
**Status:** **Canonical · Locked · Enforced**
**Deviation:** ❌ Not permitted without re-scan

---

## 1. Purpose & Scope (Clarified)

This document defines the **only approved FT2 architecture** for the **Products / SKU-OS module**.

Products FT2 provides:

* **Read-only truth exposure**
* **Lossy, policy-enforced observability**
* **Zero intelligence leakage**
* **Zero lifecycle control**
* **Deterministic, testable behavior**

FT2 answers **one question only**:

> *“What is observably true about the product catalog, right now?”*

It explicitly does **not** answer:

* Why something happened
* What action to take
* What the business impact is
* How to fix anything

Those belong to **FT1, playbooks, or other modules**.

---

## 2. Canonical Data Source (Confirmed)

### Authoritative Table

Products FT2 is derived **exclusively** from:

```
canonical_products
```

**Why this table only:**

* Platform-agnostic
* Deduplicated
* Lifecycle-safe
* Already canonicalized upstream
* Stable across time windows

---

### Explicit Exclusions (Re-affirmed)

The following **MUST NOT** be used in Products FT2:

* `shopify_products`
* `inventory_truth`
* `canonical_orders`
* Cost, margin, or stock tables
* Any platform-specific tables

> Inventory, economics, demand, and health **are separate FT2 surfaces or separate modules**.

---

## 3. Four-Layer Architecture (Non-Negotiable)

```
DATABASE
   ↓
[Layer 1] ProductsFacts
   ↓
[Layer 2] ProductsIntelligence
   ↓
[Layer 3] ProductsFTEP (Truth Exposure Policy)
   ↓
[Provider] Products FT2 Provider
   ↓
[Transport] HTTP Controller
```

Each layer:

* Has **exactly one responsibility**
* Has **hard prohibitions**
* Is **independently testable**
* May **not collapse into adjacent layers**

---

## 4. Layer 1 — ProductsFacts (Canonical Truth)

### Location

```
apps/backend/src/services/products-facts/
```

### Responsibility

Extract **raw, interpretation-free facts** from `canonical_products`.

---

### Allowed

✅ Direct DB access (Knex)
✅ Counts & distinct counts
✅ Time-window filtering
✅ Status grouping
✅ Null preservation

---

### Forbidden

❌ Classification
❌ Ratios or percentages
❌ Thresholds
❌ “Healthy / unhealthy” language
❌ Trends
❌ Business meaning

---

### Facts Output Contract (As-Is)

```ts
export interface ProductsFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  productsObserved: number | null;

  skusObserved: number | null;
  distinctSkusObserved: number | null;
  productsWithSkuCount: number | null;
  productsWithoutSkuCount: number | null;

  variantsObserved: number | null;
  productsWithVariantsCount: number | null;
  singleVariantProductsCount: number | null;

  statusCounts: {
    active: number | null;
    inactive: number | null;
    archived: number | null;
  };

  extractedAt: string;
}
```

---

### Invariants

* `null ≠ 0`
* Missing data stays missing
* Facts **never** imply meaning
* Facts **never** guide decisions

---

### Required Tests

* Raw counts correctness
* Null preservation when no rows
* No derived or semantic fields
* No access to non-canonical tables

---

## 5. Layer 2 — ProductsIntelligence (Internal Only)

### Location

```
apps/backend/src/services/products-intelligence/
```

### Responsibility

Convert **facts → internal classification**.

This layer **decides**, but **never speaks**.

---

### Allowed

✅ Deterministic classification
✅ Boolean logic
✅ Guarded inference

---

### Forbidden

❌ Database access
❌ UI formatting
❌ Explanations
❌ Recommendations
❌ Lifecycle logic

---

### Intelligence Output Contract (Actual)

```ts
export interface ProductsIntelligence {
  productsObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  catalogHealth: 'healthy' | 'degraded' | 'unknown';
  skuCoverage: 'complete' | 'partial' | 'missing' | 'unknown';
  variantComplexity: 'simple' | 'complex' | 'unknown';
}
```

---

### Missing-Facts Gate (Critical)

If **any required fact is `null`**, then:

```ts
outcome.status = 'unknown'
trend.direction = 'unknown'
catalogHealth = 'unknown'
skuCoverage = 'unknown'
variantComplexity = 'unknown'
```

This prevents **hallucinated certainty**.

---

### Required Tests

* Positive / negative / unknown classification
* Deterministic output
* No side effects
* No persistence access

---

## 6. Layer 3 — ProductsFTEP (Truth Exposure Policy)

### Location

```
apps/backend/src/services/products-ftep/
```

### Responsibility

Act as the **hard downgrade & suppression boundary** between intelligence and UI.

---

### Allowed

✅ Field dropping
✅ Downgrading meaning
✅ Returning `null` intentionally

---

### Forbidden

❌ Adding information
❌ Re-interpreting facts
❌ Exposing intelligence internals
❌ Semantic explanations

---

### FT2 Exposure Contract (Locked)

```ts
export interface ProductsFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    productsObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  signals: {
    catalog: 'ok' | 'attention' | 'unknown';
    skuCoverage: 'ok' | 'gaps' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';
  } | null;
}
```

---

### Mandatory Downgrade Rules

If intelligence is **unknown**:

```ts
outcome = null
trend = null
signals = null
```

Additionally:

* Raw counts are **never exposed**
* Status distributions are **never exposed**
* Timestamps are **never exposed**

---

### Mandatory Leak-Prevention Tests

Each FTEP implementation **must assert**:

❌ No intelligence objects
❌ No raw counts
❌ No timestamps
❌ No causal language
❌ No recommendations
❌ No platform terms

Serialization scans are **required**.

---

## 7. Products FT2 Provider (Orchestration Only)

### Location

```
apps/backend/src/services/products-ft2.provider.ts
```

### Responsibility

```
Facts → Intelligence → FTEP → return
```

---

### Explicit Non-Responsibilities

❌ Lifecycle gating
❌ Lifecycle mutation
❌ Business logic
❌ Persistence

---

### Provider Contract

```ts
export async function getProductsFt2Snapshot(input: {
  shopId: number;
  period: { from: string; to: string };
}): Promise<ProductsFT2Exposure>;
```

---

### Required Tests

* Correct orchestration order
* Deterministic output
* No leakage of facts or intelligence

(Mock modules, not spies.)

---

## 8. Transport — HTTP Controller

### Location

```
apps/backend/src/api/products/products.ft2.controller.ts
```

### Route

```
GET /api/v1/products/ft2
```

---

### Responsibilities

* Resolve `shopId`
* Parse period
* Delegate to provider
* Return JSON

---

### Forbidden

❌ Lifecycle logic
❌ Business logic
❌ Persistence
❌ Intelligence handling

Transport is a **pipe**, not a brain.

---

## 9. Frontend Contract (Read-Only)

Frontend adapters must:

* Preserve shape
* Convert `undefined → null`
* Never infer
* Never compute
* Never explain

Frontend **trusts FTEP completely**.

---

## 10. Replication Checklist (Mandatory)

Before copying this architecture:

* [ ] Facts read **only** canonical tables
* [ ] Intelligence has **no DB access**
* [ ] FTEP strips **all** intelligence internals
* [ ] Provider is orchestration-only
* [ ] Transport is lifecycle-agnostic
* [ ] Leak-prevention tests exist

If **any** fail → stop.

---

## 11. Final Laws (Products FT2)

1. Facts ≠ Intelligence
2. Intelligence ≠ Exposure
3. Exposure ≠ Insight
4. Lifecycle is external
5. FTEP is the security boundary
6. If non-leakage can’t be proven, the layer is invalid

---

## 🔒 STATUS: **CANONICAL · LOCKED · ENFORCED**

This document now fully matches:

* the sealed FT2 audit
* the real codebase
* the FT2 doctrine
* the CNS direction

Any deviation requires **new scans, not opinion**.