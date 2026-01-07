# 📦 Products / SKU-OS — 4-Layer FT2 Architecture Contract

**Phase:** FT2
**Module:** Products / SKU-OS
**Status:** Canonical, Locked
**Deviation:** Requires architectural review

---

## 1. Purpose & Scope

This document defines the **only approved FT2 implementation** for the **Products / SKU-OS module**.

FT2 for Products provides:

* **Read-only truth exposure**
* **No intelligence leakage**
* **No explanations or recommendations**
* **No lifecycle mutation**
* **Deterministic, testable behavior**

FT2 answers only:

> *“What is observably true about products, right now?”*

It does **not** answer:

* *Why*
* *What to do*
* *What it means for the business*

---

## 2. Canonical Data Source

### Authoritative Table

FT2 Products is derived **exclusively** from:

```
canonical_products
```

Reasons:

* Platform-agnostic
* Deduplicated
* Lifecycle-safe
* Already canonicalized upstream

### Explicit Exclusions

The following tables **MUST NOT** be used in Products FT2:

* `shopify_products`
* `inventory_truth`
* Any platform-specific or operational tables

Inventory, costs, or health are **separate FT2 surfaces** and are out of scope.

---

## 3. Four-Layer Architecture (Non-Negotiable)

```
DATABASE
   ↓
[Layer 1] ProductsFacts
   ↓
[Layer 2] ProductsIntelligence
   ↓
[Layer 3] ProductsFTEP
   ↓
[Provider] Products FT2 Provider
   ↓
[Transport] HTTP Controller
```

Each layer:

* Has **exactly one responsibility**
* Has **hard prohibitions**
* Is **independently testable**

---

## 4. Layer 1 — ProductsFacts

### Location

```
apps/backend/src/services/products-facts/
```

### Responsibility

Extract **raw, interpretation-free truth** from `canonical_products`.

### Allowed

* Direct database access (Knex)
* Counts
* Distinct counts
* Time window filtering
* Null preservation

### Forbidden

❌ Status classification
❌ Trends
❌ Thresholds
❌ Percentages
❌ “Healthy / unhealthy” language
❌ Any business meaning

---

### Facts Output Contract

```ts
export interface ProductsFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  productsObserved: number | null;
  skusObserved: number | null;

  statusCounts: {
    active: number | null;
    inactive: number | null;
    archived: number | null;
  };

  extractedAt: string;
}
```

### Invariants

* `null` ≠ `0`
* Missing data stays missing
* Facts never help the consumer interpret anything

---

### Required Tests

* Raw counts returned correctly
* Nulls preserved when no data
* No derived or semantic fields
* No access to non-canonical tables

---

## 5. Layer 2 — ProductsIntelligence

### Location

```
apps/backend/src/services/products-intelligence/
```

### Responsibility

Convert **facts → internal classification**.

This layer **decides**, but **never speaks**.

### Allowed

* Classification
* Boolean checks
* Deterministic rules

### Forbidden

❌ Database access
❌ UI formatting
❌ Explanations
❌ Recommendations
❌ Lifecycle logic

---

### Intelligence Output Contract

```ts
export interface ProductsIntelligence {
  productsObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };
}
```

### Classification Rules (Locked)

* **positive**

  * `active > 0`
* **negative**

  * `active === 0` AND (`inactive > 0` OR `archived > 0`)
* **unknown**

  * Any missing facts

Trend is **always** `unknown` in FT2 Products (no historical comparison).

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

**Downgrade intelligence into FT2-safe observability**.

This is the **security boundary**.

---

### Allowed

* Dropping fields
* Converting intelligence → neutral exposure
* Returning `null`

### Forbidden

❌ Adding information
❌ Re-interpreting facts
❌ Exposing intelligence internals
❌ Semantic language

---

### FT2 Exposure Contract

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
}
```

### Downgrade Rules

* If intelligence status is `unknown`:

  * `outcome = null`
  * `trend = null`
* Raw status counts are **never exposed**
* Timestamps are **never exposed**

---

### Mandatory Leak-Prevention Tests

Each Products FTEP implementation **must assert**:

* ❌ No intelligence objects exposed
* ❌ No raw status counts
* ❌ No timestamps
* ❌ No words like:

  * `because`
  * `reason`
  * `driver`
  * `recommend`
  * `should`
* ❌ No platform-specific terms

Serialization scans are **required**.

---

## 7. Products FT2 Provider

### Location

```
apps/backend/src/services/products-ft2.provider.ts
```

### Responsibility

Orchestrate the FT2 pipeline:

```
Facts → Intelligence → FTEP → return
```

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

### Invariants

* Deterministic for identical inputs
* No enrichment
* No mutation
* No leakage

---

### Required Tests

* Pipeline orchestration order
* No mutation beyond FTEP output
* No exposure of facts or intelligence

(Mock modules, **not spies**, due to ESM bindings.)

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

### Responsibilities

* Resolve `shopId` (middleware / headers)
* Parse period
* Delegate to FT2 provider
* Return JSON

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

Frontend assumes **FTEP is already enforced**.

---

## 10. Replication Checklist (Products FT2)

Before copying this architecture:

* [ ] Facts read **only** canonical tables
* [ ] Intelligence has **no DB access**
* [ ] FTEP strips all intelligence internals
* [ ] Provider mirrors Specter pattern
* [ ] Transport is lifecycle-agnostic
* [ ] Leak-prevention tests exist
* [ ] All tests green

If **any** box fails → stop.

---

## 11. Final Laws (Products FT2)

1. Facts ≠ Intelligence
2. Intelligence ≠ Exposure
3. Exposure ≠ Insight
4. Lifecycle is external
5. FTEP is the security boundary
6. If a test can’t prove non-leakage, the layer is incomplete

---

**This document is authoritative.**
Any deviation must be reviewed against FT2 doctrine.
