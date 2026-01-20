# 📦 Products / SKU-OS — 4-Layer FT2 Architecture Contract

**Phase:** FT2
**Module:** Products / SKU-OS
**Status:** **Canonical · Locked · Enforced**
**Deviation:** ❌ Not permitted without re-scan & amendment

---

## 1. Purpose & Scope (Expanded · Corrected)

This document defines the **only approved FT2 architecture** for the **Products / SKU-OS module**.

Products FT2 provides:

* **Read-only truth exposure**
* **Lossy, policy-enforced observability**
* **Zero intelligence leakage**
* **Zero lifecycle control**
* **Deterministic, testable behavior**
* **Multi-domain product reality (structural, operational, economic)**

FT2 answers **only these classes of questions**:

> *“What is observably true about products — structurally, operationally, and economically — within the permitted window?”*

It explicitly does **not** answer:

* Why something happened
* What action to take
* What should be optimized
* What the business outcome will be

Those belong to **FT1, playbooks, execution modules, or humans**.

---

## 2. Canonical Data Sources (Amended · Explicit)

### 2.1 Primary Canonical Source — Structural Truth

```
canonical_products
```

Used **only** for:

* Product existence
* SKU presence
* Variant structure
* Catalog status distribution

This table remains:

* platform-agnostic
* deduplicated
* lifecycle-safe

---

### 2.2 Secondary Canonical Sources — Scoped Operational & Economic Truth

The following tables **ARE NOW PERMITTED**, but **ONLY** in their respective Facts layers:

| Domain      | Tables (Examples)                      | Purpose                      |
| ----------- | -------------------------------------- | ---------------------------- |
| Inventory   | `inventory_truth`                      | Stock observability          |
| Orders      | `canonical_orders`, `order_line_items` | Demand pressure              |
| Fulfillment | `order_fulfillment_status`             | Execution visibility         |
| Economics   | `product_costs`, `historical_sales`    | Cost & revenue observability |

⚠️ **Important Constraint**

These tables:

* ❌ MUST NOT influence `ProductsFacts`
* ✅ MAY be read by **domain-specific Facts layers**
* ❌ MUST NOT be joined directly into UI or Intelligence

---

### 2.3 Explicit Prohibitions (Still Enforced)

Even with expanded scope, the following remain forbidden:

* Recommendations
* Forecasts
* Health scores
* Optimization signals
* Lifecycle inference
* Cross-domain inference without explicit correlation layers

---

## 3. Multi-Fact, Single-Doctrine Architecture (Updated)

Products FT2 now formally supports **multiple Facts pipelines**, all governed by the same doctrine.

```
DATABASE
   ↓
[Layer 1a] ProductsFacts (Structural)
[Layer 1b] ProductOperationalFacts
[Layer 1c] ProductEconomicFacts
   ↓
[Layer 2] ProductsIntelligence
[Layer 2b] OperationalIntelligence
[Layer 2c] EconomicIntelligence
   ↓
[Layer 3] ProductsFTEP
[Layer 3b] OperationalFTEP
[Layer 3c] EconomicFTEP
   ↓
[Provider] Products FT2 Provider
   ↓
[Transport] HTTP Controller
```

Each pipeline:

* Is **independent**
* Has **its own null gates**
* Has **its own downgrade logic**
* Never cross-contaminates another

---

## 4. Layer 1 — ProductsFacts (Structural Truth)

### Location

```
apps/backend/src/services/products-facts/
```

### Responsibility

Extract **raw, interpretation-free structural facts** from `canonical_products`.

---

### Allowed

✅ Direct DB access (Knex)
✅ Counts & distinct counts
✅ Grouping (internal only)
✅ Time-window filtering
✅ Null preservation

---

### Forbidden

❌ Ratios or percentages
❌ “Healthy / unhealthy” language
❌ Trends
❌ Operational joins
❌ Economic joins

---

### Structural Facts Contract (Unchanged)

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

## 5. Layer 1b — ProductOperationalFacts (New · Canonical)

### Location

```
apps/backend/src/services/products-operational-facts/
```

### Responsibility

Extract **raw operational observability facts**, such as:

* Inventory visibility
* Overselling presence
* Fulfillment signal existence
* System-touch surface

---

### Allowed

✅ Joins across operational tables
✅ Aggregates & averages
✅ Null preservation

---

### Forbidden

❌ “Risk” classification
❌ Labels like stable / unstable
❌ Business interpretation

Facts are **still just facts**.

---

## 6. Layer 2 — Intelligence (Expanded, Still Internal)

### Location

```
apps/backend/src/services/products-intelligence/
apps/backend/src/services/products-operational-intelligence/
```

### Responsibility

Translate **complete facts → internal classifications**.

Examples:

* structural consistency
* duplication presence
* inventory visibility class
* operational stability class

---

### Global Rules (Unchanged)

* Intelligence **never escapes**
* Missing facts collapse intelligence to `unknown`
* No DB access
* Deterministic only

---

## 7. Layer 3 — FTEP (Expanded · Still the Hard Boundary)

### Location

```
apps/backend/src/services/products-ftep/
apps/backend/src/services/products-operational-ftep/
```

### Responsibility

* Downgrade intelligence
* Suppress unsafe truth
* Enforce FT2 exposure rules

---

### Expanded FT2 Exposure Contract (Authoritative)

Products FT2 may expose **multiple independent surfaces**, each lossy:

```ts
ProductsFT2Exposure {
  context: {
    period: { from: string; to: string };
    productsObserved: number | null;
  };

  outcome: { status: 'positive' | 'negative' | 'unknown' } | null;

  trend: { direction: 'up' | 'down' | 'flat' | 'unknown' } | null;

  productDataIntegrity: {
    integrity: 'ok' | 'attention' | 'unknown';
    duplication: 'present' | 'absent' | 'unknown';
  } | null;

  operational: {
    inventory: 'ok' | 'gaps' | 'unknown';
    fulfillment: 'visible' | 'missing' | 'unknown';
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;

  economicBlindSpots: {
    costCoverage: 'complete' | 'partial' | 'missing' | 'unknown';
  } | null;
}
```

---

### Mandatory Downgrade Rules (Still Absolute)

If **any intelligence dimension is unknown**:

* That dimension → `null`
* No compensation
* No partial exposure

---

## 8. Products FT2 Provider (Expanded Orchestration)

### Location

```
apps/backend/src/services/products-ft2.provider.ts
```

### Responsibility

Orchestrate **multiple pipelines**, nothing more:

```
Facts → Intelligence → FTEP → merge → return
```

---

### Explicit Non-Responsibilities (Reconfirmed)

❌ Lifecycle gating
❌ Entitlement resolution
❌ Persistence
❌ UI semantics

---

## 9. Transport — HTTP Controller (Unchanged)

Transport remains a **pure pipe**.

No intelligence, no logic, no policy.

---

## 10. Frontend Contract (Still Read-Only)

Frontend:

* Renders what it receives
* Converts `undefined → null`
* Does not infer
* Does not explain
* Does not optimize

`'—'` remains a **truthful state**, not a fallback.

---

## 11. Updated Replication Checklist (Expanded)

Before extending Products FT2:

* [ ] Structural facts isolated
* [ ] Operational facts isolated
* [ ] Economic facts isolated
* [ ] Intelligence gated per domain
* [ ] FTEP suppresses independently
* [ ] Provider only orchestrates
* [ ] UI remains observational

If **any box fails** → architecture violation.

---

## 12. Final Laws (Reaffirmed & Extended)

1. Facts ≠ Intelligence
2. Intelligence ≠ Exposure
3. Exposure ≠ Insight
4. Domains must not bleed
5. FTEP is the security boundary
6. Blindness is allowed; hallucination is not

---

## 🔒 STATUS: **CANONICAL · LOCKED · ENFORCED**

This document now correctly reflects:

* the **actual codebase**
* the **expanded Products FT2 scope**
* the **multi-domain FT2 doctrine**
* the **conversion-safe CNS trajectory**

No further changes are permitted without:

* new scans
* explicit diffs
* architectural review

**This contract is now authoritative.**
