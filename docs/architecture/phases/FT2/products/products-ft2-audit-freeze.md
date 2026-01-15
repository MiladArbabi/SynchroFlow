# 📦 Products / SKU-OS — FT2 Contract Audit (LOCKED)

## Audit Status

* **Module:** Products (SKU-OS)
* **Surface:** FT2
* **Audit Type:** Truth & Exposure Integrity
* **State:** **Frozen / Sealed**
* **Evidence Basis:** Source scans only

---

## 1. Canonical Architecture Confirmation

Products / SKU-OS strictly implements the FT2 4-layer model:

```
Persistence (canonical_products)
→ Layer 1: Facts
→ Layer 2: Intelligence
→ Layer 3: FTEP (Truth Exposure Policy)
→ Layer 4: FT2 UI
```

There are **no shortcuts, bypasses, or cross-layer leaks**.

---

## 2. Layer 1 — Facts Contract (Canonical Truth)

### 2.1 Source of Truth

* **Database table:** `canonical_products`
* **Query scope:** `WHERE shop_id = ?`
* **Joins:** none
* **Enrichment:** none

### 2.2 Facts Interface (As-Is)

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

### 2.3 Null Semantics

* **If zero rows returned:**

  * All numeric facts → `null`
  * Status counts → `null`
* `null` explicitly means **“no observable truth”**
* `null ≠ 0` is enforced at code and type level

### 2.4 Guarantees

* All values are **raw counts**
* No ratios, percentages, thresholds, or interpretation
* Grouping (`platform_product_id`) is **internal only**
* Facts are **complete or null**, never partial

✅ **Layer 1 is canonical, conservative, and correct**

---

## 3. Layer 2 — Intelligence Contract (Internal Classification)

### 3.1 Purpose

Convert factual observations into **internal, non-exposed signals**.

### 3.2 Intelligence Interface (As-Is)

```ts
ProductsIntelligence {
  productsObserved: number | null

  outcome: {
    status: 'positive' | 'negative' | 'unknown'
  }

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown'
  }

  catalogHealth: 'healthy' | 'degraded' | 'unknown'
  skuCoverage: 'complete' | 'partial' | 'missing' | 'unknown'
  variantComplexity: 'simple' | 'complex' | 'unknown'
}
```

### 3.3 Missing-Facts Gate (Critical)

If **any** of the following are `null`:

* `productsObserved`
* `statusCounts.active`
* `productsWithSkuCount`
* `variantsObserved`

➡ **ALL intelligence collapses to `unknown`**

```ts
outcome.status = 'unknown'
trend.direction = 'unknown'
catalogHealth = 'unknown'
skuCoverage = 'unknown'
variantComplexity = 'unknown'
```

### 3.4 Classification Rules (Only When Complete)

#### Outcome

* `positive` → ≥1 active product
* `negative` → 0 active AND ≥1 inactive or archived
* `unknown` → all other cases

#### Catalog Health

* `unknown` → productsObserved === 0
* `healthy` → ≥1 active
* `degraded` → otherwise

#### SKU Coverage

* `complete` → productsWithSkuCount === productsObserved
* `partial` → productsWithSkuCount > 0
* `missing` → productsWithSkuCount === 0

#### Variant Complexity

* Default: `simple`
* `complex` → (variantsObserved / productsWithVariantsCount) > 2

#### Trend

* Always `unknown`
* No historical data exists

### 3.5 Exposure Status

* **NEVER exposed directly**
* Used only by FTEP

✅ **Layer 2 is gated, conservative, and intentionally incomplete**

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### 4.1 Role

The **hard security and truth boundary** between intelligence and UI.

### 4.2 Exposure Interface (FT2-Safe)

```ts
ProductsFT2Exposure {
  context: {
    period: { from: string; to: string }
    productsObserved: number | null
  }

  outcome: { status: 'positive' | 'negative' | 'unknown' } | null

  trend: { direction: 'up' | 'down' | 'flat' | 'unknown' } | null

  signals: {
    catalog: 'ok' | 'attention' | 'unknown'
    skuCoverage: 'ok' | 'gaps' | 'unknown'
    variantComplexity: 'simple' | 'complex' | 'unknown'
  } | null
}
```

### 4.3 Mandatory Rules

* `context.period` is **always exposed**
* `productsObserved` is exposed **only inside context**
* **No raw facts**
* **No intelligence internals**
* **No explanations or advice**

### 4.4 Total Downgrade Rule

If:

```ts
intelligence.outcome.status === 'unknown'
```

➡ Then:

```ts
outcome = null
trend = null
signals = null
```

This is **policy-driven nullification**, not missing data.

### 4.5 Signal Downgrades (Lossy by Design)

| Intelligence | Exposed Signal |
| ------------ | -------------- |
| healthy      | ok             |
| degraded     | attention      |
| complete     | ok             |
| partial      | gaps           |
| simple       | simple         |
| complex      | complex        |
| otherwise    | unknown        |

Signals are:

* Non-semantic
* Non-explanatory
* Non-actionable

✅ **Layer 3 is a strict, enforced downgrade boundary**

---

## 5. Layer 4 — FT2 UI Contract

### 5.1 Snapshot Acquisition

* Endpoint: `/api/v1/modules/products/ft2`
* No params
* Backend owns period
* Read-only
* No transformation

### 5.2 Adapter Behavior

* Pure function
* Only operation: `undefined → null`
* No inference
* No computed values

### 5.3 Rendering Semantics

* All fields rendered as-is
* `null` → rendered as `'—'`
* `'—'` explicitly means:

  > *Truth exists but is withheld or unknown by policy*

### 5.4 UI Behavior Guarantees

* No conditional logic based on values
* No fallback intelligence
* No UI-side recovery
* No blending with FT1 logic

### 5.5 FT1 Separation

* FT1 (`ProductsPage`, scenarios, CTAs) is **entirely separate**
* No FT2 data is consumed in FT1 paths

✅ **Layer 4 is observational, honest, and policy-faithful**

---

## 6. Final Cross-Surface Truth Alignment

| Layer        | State                             |
| ------------ | --------------------------------- |
| Facts        | Canonical, complete-or-null       |
| Intelligence | Conditional, gated                |
| FTEP         | Lossy, suppressive, deterministic |
| FT2 UI       | Observational only                |

---

## 7. Final Verdict (Sealed)

* No accidental gaps
* No leakage
* No compensation
* No semantic drift
* All nulls are intentional and meaningful
* `'—'` is architecturally correct
* Products / SKU-OS FT2 contract is **correct as-is**

---

## 🔒 AUDIT STATUS: **LOCKED & SEALED**

This audit is complete.
No further interpretation is permitted without new scans or code changes.