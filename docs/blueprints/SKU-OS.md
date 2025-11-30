# SKU OS – Product Health & Inventory Intelligence (v1 Clean Integration Blueprint)

> **Mission:** Be the single source of truth for **product-level health, stock risk, and attention ranking**, driven by demand, returns, and quality signals – without owning returns, inventory ledger, or profitability.

Any change to **locked external contracts** requires a versioned contract (`v2`) and a migration plan.

---

## 0. Role, Mission & Boundaries

### 0.1 Role in LaSyncro

**Module Name:** `sku-os`

**Role:** CNS node for **product health & inventory intelligence**:

* “Which products need attention today, and why?”
* “Where are we at risk – stockouts, overstock, quality, returns?”

### 0.2 SKU OS OWNS

* Product health scoring logic & thresholds.
* Product attention ranking API.
* Internal `ProductHealthSnapshot` model.
* Mapping from **demand + returns + quality** → `healthScore`, `stockoutRisk`, `marginHealth`, `confidence`.

### 0.3 SKU OS DOES NOT OWN

* Order-level profitability or landed cost → **OrderNexus / MarginCore**
* Return lifecycle, refund decisions → **ReturnNexus**
* Physical inventory & locations → **WMS-Lite**
* Warehouse issues, evidence, root cause → **ProblemCenter**
* Customer intent & LTV → **Specter**
* Global analytics warehouse → **InsightCore**

> **Boundary:**
> SKU OS decides **“this product is at risk and here’s what to do.”**
> It never computes order profit, controls returns, or mutates inventory ledger.

---

## 1. Core v1 Output Contracts

### 1.1 Product Attention API – Empty Set & Null Handling (Locked)

> **Purpose:** Drive the “N products that need attention today” UI.

**Empty set behavior:**

```ts
// When NO products are at risk:
{
  data: [],
  meta: {
    total_at_risk: 0,
    recalculated_at: null,  // explicitly null when empty
    confidence_summary: {
      high: 0,
      medium: 0,
      low: 0
    }
  }
}

// UI MUST show: "🎉 All products look healthy today!"
```

**Null field handling (UI contract, no interpretation drift):**

```ts
const NULL_HANDLING_RULES = {
  days_of_supply: {
    display: 'Days of supply: —',
    tooltip: 'Not enough data to estimate yet.'
  },
  estimated_margin: {
    display: 'Margin: Unknown',
    cta: 'Add cost to unlock margin insights'
  },
  margin_health: {
    when: 'unknown',
    display: 'Margin health: ❓ Unknown',
    tooltip: 'We need cost data to assess margin health'
  }
};
```

The **shape** of the product attention API is locked; we’re only clarifying inputs and degradation rules.

### 1.2 ProductHealthAnalyticsEvent → InsightCore (Locked)

SKU OS exposes (unchanged):

```ts
// sku-os → insight-core

export interface ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;
  healthScore: number;          // 0–100
  stockoutRisk: number;         // 0–1
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  recalculatedAt: string;       // ISO
}
```

SKU OS is the **only producer** of `ProductHealthAnalyticsEvent`.

---

## 2. Inputs – Who Feeds SKU OS, And How

### 2.1 OrderNexus → SKU OS – Demand & Returns Rate

**Table:** `product_demand_signals` (owned by OrderNexus or its analytics sidecar)

```sql
CREATE TABLE product_demand_signals (
  product_id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_count_7d INTEGER DEFAULT 0,
  order_count_30d INTEGER DEFAULT 0,
  unit_sales_7d INTEGER DEFAULT 0,
  unit_sales_30d INTEGER DEFAULT 0,
  returns_rate_30d DECIMAL(4,3),  -- fraction 0–1, derived by OrderNexus from ReturnNexus
  avg_selling_price DECIMAL(10,2),
  last_order_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Locked behavior:**

* `order_count_*` and `unit_sales_*` are derived **only** from OrderNexus’s normalized order stream.
SKU OS MUST treat `returns_rate_30d` as a read-only input.

* Ownership: OrderNexus
* Source: OrderNexus + ReturnNexus linkage
* Contract: SKU OS MUST NOT recompute returns rate from raw orders or returns.
  Any change to how `returns_rate_30d` is calculated is done in OrderNexus and
  reflected here via schema-compatible updates.

* SKU OS treats this table as **read-only**.

### 2.2 OrderNexus → SKU OS – Real-Time Events (Optional v1)

```ts
// order-nexus → sku-os

export interface OrderEvents {
  ORDER_COMPLETED: {
    orderId: string;
    shopId: number;
    lineItems: Array<{
      productId: number;
      quantity: number;
      finalPrice: number;
    }>;
    completedAt: string;
  };

  ORDER_RETURNED: {
    orderId: string;
    shopId: number;
    lineItems: Array<{
      productId: number;
      quantity: number;
    }>;
    returnedAt: string;
  };
}
```

**ORDER_RETURNED** is an OrderNexus → SKU-OS event.

* It is purely a demand correction signal (net units), not a quality signal.
* It is derived from ReturnNexus outcomes and WMS/Lite truth.

**Contract:**

* `ORDER_COMPLETED` drives **velocity / recency**.
* `ORDER_RETURNED` is **coarse demand correction** only (net demand). Quality is handled via returns & ProblemCenter events.

### 2.3 ProblemCenter → SKU OS – Product Quality Signals

SKU OS no longer listens directly to WMS-Lite for quality; it listens to the **canonical issue model** in ProblemCenter.

```ts
// problem-solve → sku-os

export interface ProductQualityEvent {
  shopId: number;
  productId: string;

  issueType: IssueType;           // from shared issue enums
  severity: IssueSeverity;
  sourceStep: IssueSourceStep;
  issueId: string;

  occurredAt: string; // ISO
}
```

**Hard rule:**

* **ProblemCenter is the only producer** of `ProductQualityEvent` in the platform.
* SKU OS only **consumes** it and never emits its own version.

### 2.4 ReturnNexus → SKU OS – Normalized Returns Quality

SKU OS uses ReturnNexus’ **canonical quality enums** (no local mapping).

```ts
// return-nexus → sku-os (same shape as → insight-core)

import {
  ReturnReasonCategory,
  InspectionResult,
  IssueRootCause
} from '@lasyncro/shared/contracts/returns-quality-contract';

export interface ReturnAnalyticsEvent {
  shopId: number;
  returnId: string;
  orderId: string;
  productId: string;
  quantity: number;  // units for this return line

  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;

  refundAmount: number;  // for this product line
  currency: string;
  restockable: boolean;

  processedAt: string;   // ISO – when the return was financially closed
}
```

**Rules:**

SKU OS **does not** compute or normalize:

* `ReturnReasonCategory`
* `InspectionResult`
* `IssueRootCause`
* `restockable`

All four come from ReturnNexus using the shared
`returns-quality-contract` + `docs/shared/returns-quality-mapping.md`.
SKU OS treats them as opaque enums for degradation logic and analytics joins.


### 2.5 Optional: WMS-Lite ReturnInspectionEvent (Read-Only)

SKU OS **may** also subscribe to WMS-Lite’s `ReturnInspectionEvent` for richer raw context, but:

* It **must not** invent its own alternative mapping from `PhysicalConditionCode` to `InspectionResult` / `IssueRootCause`.
* Any such mapping must be via shared `returns-quality-contract` and/or a mapping table owned by ReturnNexus / InsightCore.

If there’s any conflict, **ReturnNexus enums win**.

---

## 3. Canonical Returns & Quality Degradation Mapping

This is where the previous version was messy. We’re now locking a **single source of truth** for how returns & quality events affect product health.

### 3.1 Degradation Buckets

SKU OS MUST classify each return- or issue-related signal into:

```ts
export type DegradationBucket = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface DegradationEffect {
  bucket: DegradationBucket;
  healthScoreDelta: number;   // negative = worse
}
```

### 3.2 Returns-Driven Degradation (ReturnAnalyticsEvent-based)

Canonical mapping from `InspectionResult` × `IssueRootCause`:

| InspectionResult            | IssueRootCause        | Bucket | healthScoreDelta |
| --------------------------- | --------------------- | ------ | ---------------- |
| APPROVED_REFUND_SCRAP       | MANUFACTURING_QUALITY | HIGH   | -10              |
| APPROVED_REFUND_SCRAP       | PACKAGING_QUALITY     | HIGH   | -10              |
| APPROVED_REFUND_SCRAP       | CARRIER_DAMAGE        | MEDIUM | -6               |
| APPROVED_REFUND_RESTOCKABLE | MANUFACTURING_QUALITY | MEDIUM | -5               |
| APPROVED_REFUND_RESTOCKABLE | PACKAGING_QUALITY     | MEDIUM | -5               |
| APPROVED_REFUND_RESTOCKABLE | CARRIER_DAMAGE        | LOW    | -3               |
| PARTIAL_REFUND              | FULFILLMENT_ERROR     | MEDIUM | -5               |
| PARTIAL_REFUND              | CUSTOMER_EXPECTATIONS | LOW    | -2               |
| PARTIAL_REFUND              | CUSTOMER_MISUSE       | LOW    | -2               |
| REJECTED_REFUND             | CUSTOMER_MISUSE       | NONE   | 0                |
| REJECTED_REFUND             | CUSTOMER_EXPECTATIONS | LOW    | -1               |
| REJECTED_REFUND             | MANUFACTURING_QUALITY | MEDIUM | -4               |
| *any*                       | UNKNOWN               | LOW    | -2               |

**Selection rules:**

1. If an exact (`inspectionResult`, `issueRootCause`) row exists, use it.
2. Else, if a row with same `inspectionResult` and `IssueRootCause = UNKNOWN` exists, use that.
3. Else, default to:

   ```ts
   { bucket: 'LOW', healthScoreDelta: -2 }
   ```

### 3.3 Quantity Scaling (Linear, But Not Re-Mapping)

SKU OS MAY scale the impact per event by units returned.

Canonical helper:

```ts
export interface DegradationInputFromReturn {
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;
  unitsReturned: number;       // from ReturnAnalyticsEvent.quantity
  unitsOrdered?: number;       // optional; if not provided, assume per-unit effect
}

export function computeDegradationFromReturn(
  input: DegradationInputFromReturn
): DegradationEffect {
  const base = lookupFromTable(input.inspectionResult, input.issueRootCause);

  const ratio =
    input.unitsOrdered && input.unitsOrdered > 0
      ? Math.min(1, input.unitsReturned / input.unitsOrdered)
      : 1;

  return {
    bucket: base.bucket,
    healthScoreDelta: base.healthScoreDelta * ratio
  };
}
```

**Locked:**

* The **table values** are locked.
* Using a linear scaling factor is allowed; implementers may refine ratio sourcing, but **must not** change bucket or base deltas without a v2.

### 3.4 WMS / ProblemCenter Issue Compounding

`ProductQualityEvent` from ProblemCenter is interpreted via a fixed mapping:

```ts
export interface DegradationInputFromIssue {
  issueType: IssueType;
  severity: IssueSeverity;
}

export function computeDegradationFromIssue(
  input: DegradationInputFromIssue
): DegradationEffect;
```

Canonical mapping:

| IssueType               | IssueSeverity | Bucket | healthScoreDelta |
| ----------------------- | ------------- | ------ | ---------------- |
| PRODUCT_DEFECT          | HIGH/CRITICAL | HIGH   | -8               |
| PRODUCT_DEFECT          | MEDIUM        | MEDIUM | -5               |
| PRODUCT_DEFECT          | LOW           | LOW    | -2               |
| PACKAGING_DEFECT        | HIGH/CRITICAL | MEDIUM | -5               |
| PACKAGING_DEFECT        | MEDIUM        | LOW    | -3               |
| PACKAGING_DEFECT        | LOW           | LOW    | -1               |
| SHIPPING_DAMAGE         | HIGH/CRITICAL | MEDIUM | -5               |
| SHIPPING_DAMAGE         | MEDIUM        | LOW    | -3               |
| SHIPPING_DAMAGE         | LOW           | LOW    | -1               |
| MISSING_ITEM            | any           | MEDIUM | -5               |
| WRONG_ITEM              | any           | MEDIUM | -5               |
| OTHER_FULFILLMENT_ERROR | any           | LOW    | -2               |

**Rules:**

1. HIGH and CRITICAL are treated the same in this table.

2. If no explicit row exists for `(IssueType, IssueSeverity)` → default:

   ```ts
   { bucket: 'LOW', healthScoreDelta: -2 }
   ```

3. If a **return-driven degradation** and a **ProblemCenter issue** occur for the same `(shopId, productId)` within a small time window (e.g., same day), SKU OS MAY sum their `healthScoreDelta` but MUST clamp to **≥ -15** per product per day.

### 3.5 Canonical Helper Interface

```ts
export interface DegradationInputFromReturn {
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;
  unitsReturned: number;
  unitsOrdered?: number;
}

export interface DegradationInputFromIssue {
  issueType: IssueType;
  severity: IssueSeverity;
}

export function computeDegradationFromReturn(
  input: DegradationInputFromReturn
): DegradationEffect {
  // MUST implement 3.2 + 3.3 semantics
}

export function computeDegradationFromIssue(
  input: DegradationInputFromIssue
): DegradationEffect {
  // MUST implement 3.4 semantics
}
```

Any SKU OS implementation that:

* Changes bucket definitions,
* Changes the numeric `healthScoreDelta` table,
* Or adds multiplicative modifiers beyond the ratio described,

is a **breaking change** and requires a v2 degradation contract.

---

## 4. Internal Product Health Model

### 4.1 ProductHealthSnapshot (Internal, But Shape Stable for v1)

```ts
export interface ProductHealthSnapshot {
  shopId: number;
  productId: number;

  healthScore: number;      // 0–100
  stockoutRisk: number;     // 0–1
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  returnsRisk: number;      // 0–1, driven by ReturnAnalyticsEvent + returns_rate_30d
  defectRate: number;       // 0–1, driven by ProductQualityEvent
  confidence: 'low' | 'medium' | 'high';

  demandVelocity30d: number;  // from product_demand_signals.unit_sales_30d
  updatedAt: string;          // ISO
}
```

Only `ProductHealthAnalyticsEvent` is external; the rest may evolve, as long as their **meaning** remains consistent with the degradation contract.

---

## 5. Health Engine – How SKU OS Uses Inputs (Non-Overlapping)

### 5.1 Applying Issue & Returns Impacts

Reference implementation (must respect tables; formulas can be equivalent):

```ts
export class ProductHealthDegradationEngine {
  applyReturnImpact(
    snapshot: ProductHealthSnapshot,
    events: ReturnAnalyticsEvent[]
  ): ProductHealthSnapshot {
    let health = snapshot.healthScore;
    let returnsRisk = snapshot.returnsRisk;

    for (const ev of events) {
      if (Number(ev.productId) !== snapshot.productId) continue;

      const effect = computeDegradationFromReturn({
        inspectionResult: ev.inspectionResult,
        issueRootCause: ev.issueRootCause,
        unitsReturned: ev.quantity
      });

      health += effect.healthScoreDelta;              // delta is negative
      returnsRisk = Math.min(1, returnsRisk + 0.02);  // simple incremental bump; internal logic
    }

    return {
      ...snapshot,
      healthScore: clamp(health, 0, 100),
      returnsRisk
    };
  }

  applyIssueImpact(
    snapshot: ProductHealthSnapshot,
    issues: ProductQualityEvent[]
  ): ProductHealthSnapshot {
    let health = snapshot.healthScore;
    let defectRate = snapshot.defectRate;

    for (const issue of issues) {
      if (Number(issue.productId) !== snapshot.productId) continue;

      const effect = computeDegradationFromIssue({
        issueType: issue.issueType,
        severity: issue.severity
      });

      health += effect.healthScoreDelta;
      defectRate = Math.min(1, defectRate + Math.abs(effect.healthScoreDelta) / 100);
    }

    return {
      ...snapshot,
      healthScore: clamp(health, 0, 100),
      defectRate
    };
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
```

**Important:**

* The *tables* and *sign* of deltas are locked; you can tweak how `returnsRisk`/`defectRate` accumulate as internal implementation, but not the core mapping.
* SKU OS still **never** modifies returns, refunds, or WMS issues; it only reads signals.

---

## 6. Demand Forecasting & Replenishment (Phase 2, Interface-Only)

This section stays conceptual; it must not break the v1 contracts.

### 6.1 Order-Enhanced Demand Predictor

```ts
export interface EnhancedDemandForecast {
  baseDemand: number;
  enhancedForecast: number;
  confidence: 'low' | 'medium' | 'high';
  reorderRecommendation: ReorderRecommendation | null;
  stockoutProbability: number; // 0–1
}

export class OrderEnhancedDemandPredictor {
  async forecastWithOrderHistory(productId: number): Promise<EnhancedDemandForecast> {
    const [health, patterns, seasonality] = await Promise.all([
      this.healthScorer.getHealthScore(productId),
      this.orderAnalyzer.getProductOrderPatterns(productId),
      this.seasonalityDetector.getSeasonalFactors(productId)
    ]);

    const base = patterns.unit_sales_30d;
    const trend = this.calculateTrend(patterns.unit_sales_7d, patterns.unit_sales_30d);
    const seasonal = seasonality.currentMultiplier;

    const enhancedForecast = Math.max(0, base * (1 + trend) * seasonal);

    return {
      baseDemand: base,
      enhancedForecast,
      confidence: this.calculateForecastConfidence(patterns.historyLength, health),
      reorderRecommendation: await this.generateReorder(productId, health, patterns),
      stockoutProbability: this.calculateStockoutRisk(health, patterns)
    };
  }
}
```

### 6.2 ReorderRecommendation Shape (Stable)

```ts
export interface ReorderRecommendation {
  productId: number;
  recommendedQuantity: number;
  urgency: 'critical' | 'high' | 'medium';
  reason: string;
  expectedStockoutDate: string | null;
  confidence: 'low' | 'medium' | 'high';
  supplierLeadTime: number; // days
  estimatedCost: number;
  expectedROI: number;
}
```

Internals for `urgency`, `expectedROI`, etc. are free to evolve as long as they’re consistent with the inputs (demand, stock, healthScore).

---

## 7. Integration SLAs & Quality Gates

### 7.1 Data Freshness

```ts
const SKU_OS_SLAs = {
  order_events: {
    processing_latency: '< 5 minutes',
    completeness: '> 99.9% of orders processed'
  },
  demand_signals: {
    recalculation_frequency: 'Hourly batches + real-time triggers',
    freshness: '< 1 hour from order creation'
  },
  health_scores: {
    event_driven_recalc: '< 2 minutes from order / return / quality events',
    daily_batch_completion: 'Before 6 AM shop local time',
    high_confidence_min_history_days: 14
  }
};
```

### 7.2 Monitoring

```ts
const SKU_OS_MONITORING = {
  data_flow_health: {
    orders_to_products_latency: 'Alert if > 10 minutes',
    missing_demand_signals: 'Alert if > 5% of active products lack recent signals',
    missing_quality_signals: 'Alert if ReturnAnalyticsEvent or ProductQualityEvent streams are silent > 24h on active shops'
  },
  business_impact: {
    stockout_prevention_rate: '% of predicted stockouts actually prevented',
    inventory_turnover_improvement: 'Days-of-supply improvement vs baseline',
    return_related_degradation: '% of SKUs at-risk due to high returnsRisk/defectRate'
  }
};
```

---

## 8. Developer Contract – Final Statement (SKU OS)

> **SKU OS Developer Contract**
>
> Given:
>
> * Demand & returns-rate signals from **OrderNexus**
> * Normalized returns quality via `ReturnAnalyticsEvent` from **ReturnNexus**
> * Product quality events via `ProductQualityEvent` from **ProblemCenter**
> * Optional raw context from WMS-Lite (read-only)
>
> SKU OS guarantees:
>
> * A stable **product health model** expressed via `ProductHealthAnalyticsEvent`.
> * A product attention API with explicit empty/unknown semantics.
> * A **single, deterministic degradation mapping** from returns quality + warehouse issues → `healthScore` changes, using:
>
>   * `InspectionResult` / `IssueRootCause` (returns-quality-contract)
>   * `IssueType` / `IssueSeverity` (ProblemCenter issue taxonomy)
> * No recomputation of:
>
>   * Order-level profit (OrderNexus’ job),
>   * Return decisions (ReturnNexus’ job),
>   * Warehouse issues or root causes (ProblemCenter’s job),
>   * Inventory ledger (WMS-Lite’s job).
>
> Any implementation that:
>
> * Recomputes returns quality enums,
> * Produces its own `ProductQualityEvent`,
> * Hard-forks the degradation tables or invents new categories
>
> is **not SKU OS v1** – it’s a breaking variant and must be versioned as v2 with a migration plan.