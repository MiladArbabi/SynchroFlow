# 📦 Products / SKU-OS — FT2 Contract Audit (LOCKED)

## Audit Status

* **Module:** Products (SKU-OS)
* **Surface:** FT2
* **Audit Type:** Truth, Exposure & Conversion Spine Integrity
* **State:** **Frozen / Sealed**
* **Evidence Basis:** Repository scans + implemented FT2 surfaces only

---

## 1. Canonical Architecture Confirmation

Products / SKU-OS strictly implements the **FT2 4-layer architecture** with **explicit sub-dimensions** introduced in this audit cycle.

```
Persistence (canonical_products, inventory, orders, costs)
→ Layer 1: Facts
→ Layer 2: Intelligence
→ Layer 3: FTEP (Truth Exposure Policy)
→ Layer 4: FT2 UI
```

There are:

* ❌ no shortcuts
* ❌ no lifecycle logic
* ❌ no entitlement inference
* ❌ no cross-layer leaks

All extensions introduced preserve this structure.

---

## 2. Layer 1 — Facts Contract (Canonical Truth)

### 2.1 Sources of Truth (Expanded)

| Domain      | Tables (Read-Only)                |
| ----------- | --------------------------------- |
| Products    | `canonical_products`              |
| Inventory   | `inventory_truth`                 |
| Sales       | `historical_sales`, orders tables |
| Costs       | `product_costs`                   |
| Fulfillment | `order_fulfillment_status`        |

**Joins are permitted only inside Facts**, never beyond.

---

### 2.2 ProductsFacts Interface (Unchanged, Canonical)

```ts
ProductsFacts {
  shopId: number

  period: {
    from: string
    to: string
  }

  productsObserved: number | null

  skusObserved: number | null
  distinctSkusObserved: number | null
  productsWithSkuCount: number | null
  productsWithoutSkuCount: number | null

  variantsObserved: number | null
  productsWithVariantsCount: number | null
  singleVariantProductsCount: number | null

  statusCounts: {
    active: number | null
    inactive: number | null
    archived: number | null
  }

  extractedAt: string
}
```

---

### 2.3 OperationalFacts (NEW — Canonical)

```ts
ProductOperationalFacts {
  shopId: number
  period: { from: string; to: string }

  productsWithInventoryCount: number | null
  totalProductsChecked: number | null

  productsWithFulfillmentSignalsCount: number | null

  productsWhereSalesExceedStockCount: number | null

  systemsTouchedPerProductAvg: number | null
  productsTouchingMultipleSystemsCount: number | null

  extractedAt: string
}
```

---

### 2.4 Null Semantics (Reconfirmed)

* If **no rows** exist → **ALL facts = null**
* `null` explicitly means **no observable truth**
* `null ≠ 0` is enforced across all fact domains
* Facts are **complete-or-null**, never partial

✅ **Layer 1 remains conservative and canonical**

---

## 3. Layer 2 — Intelligence Contract (Internal Classification)

### 3.1 Purpose (Expanded)

Translate raw facts into **internal-only classifications** across **three independent dimensions**:

1. Product Structure
2. Operational Visibility
3. Economic Observability

No dimension may infer from another.

---

### 3.2 Products Intelligence (Updated)

```ts
ProductsIntelligence {
  outcome: {
    status: 'positive' | 'negative' | 'unknown'
  }

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown'
  }

  // Structural (Data Integrity)
  structuralIntegrity: 'ok' | 'attention' | 'unknown'
  duplicationPresence: 'present' | 'absent' | 'unknown'

  // Operational (NEW)
  inventoryVisibility: 'ok' | 'gaps' | 'unknown'
  fulfillmentVisibility: 'visible' | 'missing' | 'unknown'
  operationalStability: 'stable' | 'fragile' | 'unknown'
}
```

---

### 3.3 Missing-Facts Collapse Rule (Global)

If **any required fact for a dimension is null**:

➡ That **entire dimension collapses to `unknown`**

There is:

* no partial intelligence
* no fallback logic
* no cross-dimension borrowing

---

### 3.4 Exposure Status

* Intelligence is **never exposed**
* Exists solely to support FTEP downgrade decisions

✅ **Layer 2 remains invisible, gated, and deterministic**

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### 4.1 Role (Expanded)

FTEP is the **only authority** allowed to decide:

* what truth survives
* what truth is suppressed
* what truth is downgraded

---

### 4.2 Products FT2 Exposure (UPDATED)

```ts
ProductsFT2Exposure {
  context: {
    period: { from: string; to: string }
    productsObserved: number | null
  }

  outcome: { status: 'positive' | 'negative' | 'unknown' } | null
  trend: { direction: 'up' | 'down' | 'flat' | 'unknown' } | null

  // Layer 1 — Data Gaps
  dataGaps: {
    productsWithConflictingDataCount: number | null
    totalProductsChecked: number | null
    productsWithMultipleSkusCount: number | null
    maxSkusPerProduct: number | null
    variantGrowth: TimeSeries | null
  } | null

  // FT2 — Product Data Integrity (NEW)
  productDataIntegrity: {
    integrity: 'ok' | 'attention' | 'unknown'
    duplication: 'present' | 'absent' | 'unknown'
  } | null

  // FT2 — Operational Exposure (NEW)
  operational: {
    inventory: 'ok' | 'gaps' | 'unknown'
    fulfillment: 'visible' | 'missing' | 'unknown'
    stability: 'stable' | 'fragile' | 'unknown'
  } | null

  // Layer 3 — Economic Blind Spots
  economicBlindSpots: {
    productsWithCostCount: number | null
    productsWithoutCostCount: number | null
    priceVsCostTrend: TimeSeries | null
    revenueVsProfit: Distribution | null
  } | null
}
```

---

### 4.3 Downgrade Rules (Strict)

* If intelligence dimension = `unknown` → exposure = `null`
* Exposure is **lossy by design**
* No raw facts cross this boundary

---

### 4.4 Meaning of `null` at FTEP

`null` means:

> *Truth exists but is intentionally withheld due to insufficient certainty or policy.*

This is **not missing data**.

---

## 5. Layer 4 — FT2 UI Contract (Updated)

### 5.1 Snapshot Acquisition

* Endpoint: `/api/v1/modules/products/ft2`
* Period resolved via **FT2DateRange authority**
* Backend owns time semantics
* Read-only, deterministic

---

### 5.2 Adapter Rules (Unchanged)

* Pure mapping
* `undefined → null` only
* No inference
* No computed values

---

### 5.3 Rendering Semantics (Expanded)

* All surfaces render as **KPIs**
* `null → '—'`
* `'—'` explicitly means:

> *Truth withheld or unknown by policy*

---

### 5.4 Composition Guarantees

* No nested rows
* No narrative surfaces
* No semantic grouping in UI
* All surfaces visible in a **single scan**

This is intentional and conversion-aligned.

---

## 6. Conversion Spine (NEW — Formalized)

Products FT2 now reveals, in order:

1. **Existence** – products detected
2. **Structural Trust** – data integrity
3. **Operational Visibility** – inventory & fulfillment exposure
4. **Economic Observability** – cost & profit blindness

Nothing is explained.
Nothing is optimized.
Nothing is sold.

The user connects the dots.

---

## 7. Final Cross-Layer Alignment

| Layer        | Status                             |
| ------------ | ---------------------------------- |
| Facts        | Canonical, complete-or-null        |
| Intelligence | Gated, internal, multi-dimensional |
| FTEP         | Lossy, suppressive, deterministic  |
| FT2 UI       | Observational, non-narrative       |

---

## 8. Visual Primitives Status (Reconfirmed)

### 8.1 Verified Absence

There are **no** FT2 visual primitives for:

* charts
* gauges
* graphs
* distributions
* trends

This is confirmed via repository scan.

---

### 8.2 Implication

FT2 is **data-complete but visually minimal**.

This is:

* safe
* correct
* and conversion-limiting (by design, for now)

---

## 9. Forward Compatibility Guarantee (Revalidated)

All exposed Products FT2 fields are:

* raw
* observational
* non-semantic
* visually renderable

A future **FT2 Visual Primitive Catalog** can be added **without modifying this contract**.

---

## 10. Explicit Non-Goals (Restated)

This contract does **not**:

* define visuals
* introduce entitlements
* split free vs paid
* recommend actions
* compute scores
* infer outcomes

Those are **separate system concerns**.

---

## 🔒 FINAL AUDIT VERDICT (UPDATED & SEALED)

* Products / SKU-OS FT2 is **architecturally correct**
* Data Integrity and Operational Exposure are **first-class**
* Conversion spine is **structural, not narrative**
* No refactor is required for monetization
* Only **constraint lifting** is needed for FT2-Paid

---

## 🔐 STATUS: **LOCKED, SEALED, & AUTHORITATIVE**

Any further changes require:

1. fresh repository scan
2. explicit diff
3. scope declaration
4. non-retroactive amendment

Silent drift is forbidden.

---
