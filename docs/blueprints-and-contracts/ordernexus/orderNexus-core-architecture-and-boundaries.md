# OrderNexus - Core Architecture & Boundaries**

**Version:** 2.0 (Locked Blueprint)
**Last Updated:** 2025-01-15
**Related Documents:**

- OrderNexus - External Contracts & Integration
- OrderNexus - Engine Implementation
- OrderNexus - Product Vision & Evolution

---

# OrderNexus – Locked Blueprint

**Role:** Profit-First Order Intelligence Module  
**Job:** *Single source of truth for order-level profitability and leakage*

---

## 0. Responsibility & Boundaries

### 0.1 Mission

> **OrderNexus Mission:** Be the canonical source for **order-level profitability**, **profit leakage detection**, and **order-centric customer profitability** inside LaSyncro.

### 0.2 Owns vs Not Owns

**OrderNexus OWNS:**

- True landed cost per order
- Net profit & margin %
- Order-level profit status: `HEALTHY | AT_RISK | UNPROFITABLE`
- Profit leakage classification per order
- Customer profitability tiers **from realized orders** (whale curve)
- Basic profit interventions (suggestions, not execution)

OrderNexus OWNS `returns_rate_30d`:

- It computes `returns_rate_30d` per product using:
  - Order history, and
  - ReturnOutcomeEvent / ReturnAnalyticsEvent from ReturnNexus.
- It exposes this as part of `product_demand_signals` (or a compatible view).
- SKU OS MUST NOT recompute returns rate; it only consumes `returns_rate_30d`.

**OrderNexus DOES NOT OWN:**

- Customer behavior & LTV models → **Specter**
- SKU-level stock & replenishment → **SKU OS**
- Cash flow, P&L, forecasting → **Financial Intelligence**
- Fulfillment routing & warehouse ops → **WMS Lite**
- Task workflows & approvals → **Echo Hub**
- Global dashboards & cross-module charts → **Analytics Core**
- Return case lifecycle, refund / exchange decisions → **ReturnNexus**

## 0.3 CNS Integration (LOCKED v1)

 OrderNexus does NOT own merchant mode, behavior mode selection, or UX emphasis.
 These are exclusively produced by the CNS Core (Central Nervous System).

 OrderNexus MUST:

- Compute order profitability deterministically.
- Emit OrderNexusSignal → CNS (profit stability, leakage, trends).
- Consume CnsContextSnapshot only for **interpretation**, NEVER computation.

 OrderNexus MUST NOT:

- Predict or assign merchant modes.
- Store mode-related fields.
- Alter profitability thresholds based on mode.

 CNS Core is the ONLY source of:

- mode: 'survival' | 'growth' | 'architect'
- revenueBand
- burningPriority
- UI timeContext

 OrderNexus remains *mathematically stable*, CNS handles interpretation.

---

## 1. Core Types – The Canonical Model

### 1.1 Profit & Cost Types

```typescript
// packages/order-nexus/src/types/core-types.ts

export type ProfitStatus = 'HEALTHY' | 'AT_RISK' | 'UNPROFITABLE';

export type ComputationSourceReason =
  | 'initial'
  | 'recomputation'
  | 'basic_fallback';

export type CostModelSource = 'finance' | 'local';

export interface ModePolicies {
  minMarginPercent: number;
  allowUnprofitableOrders: boolean;
  requireApprovalBelowMargin: boolean;
  leakageAlertThreshold: number;
  automatedInterventions: string[];
  maxCustomerAcquisitionCost: number;
}

export interface LandedCost {
  cogs: number;
  shipping: number;
  handling: number;
  packaging: number;
  paymentFees: number;
  overhead: number;
  total: number;
  currency: string;
}

export interface OrderProfitability {
  orderId: string;
  shopId: number;
  revenue: number;
  landedCost: LandedCost;
  netProfit: number;
  marginPercent: number;
  profitStatus: ProfitStatus;
  leakage: LeakageDetection[];
  calculatedAt: Date;

  // Versioning / audit
  costModelVersion: string;
  costModelSource: CostModelSource;           // 'finance' | 'local'
  computationSource: ComputationSourceReason; // 'initial' | 'recomputation' | 'basic_fallback'

  // For recomputations
  previousNetProfit?: number;
  previousCostModelVersion?: string;
}
```

### 1.2 NormalizedOrder – The Only Order Type Engines See

```typescript
// packages/order-nexus/src/types/core-types.ts

export interface NormalizedOrder {
  id: string;
  shopId: number;

  // Time – Phase 1: all time series use createdAt
  createdAt: string;    // Shopify 'created_at' (UTC)
  updatedAt: string;    // Shopify 'updated_at'
  processedAt?: string; // Shopify 'processed_at' if present

  // Monetary
  currency: string;
  totalPrice: number;    // total_price
  subtotalPrice: number; // subtotal_price
  totalTax: number;      // total_tax

  // Shipping lines
  shippingLines: Array<{
    price: number; // parsed price
    title: string;
    code?: string;
  }>;

  // Line items
  lineItems: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price: number;  // item price
    cogs?: number;  // optional, from SKU OS later
  }>;

  // PCD-compliant customer
  customer?: {
    hashedId: string; // from shared PcdHasher
  };
}
```

### 1.3 Profit Interventions & Leakage

```typescript
// packages/order-nexus/src/types/profit-types.ts

export type ProfitInterventionType =
  | 'MARGIN_PROTECTION'
  | 'CUSTOMER_TERMS_ADJUSTMENT'
  | 'SUGGEST_REVIEW'
  | 'SHIPPING_OPTIMIZATION'
  | 'SERVICE_LEVEL_ADJUSTMENT';

export interface ProfitIntervention {
  type: ProfitInterventionType;
  action: string;         // e.g. 'REMOVE_FREE_SHIPPING'
  reason: string;         // human-readable explanation
  expectedImpact: number; // monetary impact in shop currency
  confidence?: number;    // 0–1
  requiresApproval: boolean;
}

export type LeakageType =
  | 'SHIPPING_INEFFICIENCY'
  | 'SERVICE_OVERKILL'
  | 'RETURNS_RISK'
  | 'PAYMENT_FEES_HIGH'
  | 'PACKAGING_OVERKILL';

export interface LeakageDetection {
  type: LeakageType;
  amount: number; // leakage amount
  reason: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}
```

### 1.4 Customer Profit Context

```typescript
// packages/order-nexus/src/types/profit-types.ts

export interface CustomerProfitContext {
  tier: string;               // 'VIP' | 'CORE' | etc.
  predictedLTV: number;
  churnRisk: number;          // 0–1
  priceSensitivity: number;   // 0–1
  returnsRisk: number;        // 0–1
  source: 'specter' | 'fallback' | 'default';
  confidence: number;         // 0–1
}
```

Centralized mapper:

```typescript
// packages/order-nexus/src/mappers/customer-signal-mapper.ts

export class CustomerSignalMapper {
  static toCustomerProfitContext(
    result: CustomerSignalResult
  ): CustomerProfitContext {
    return {
      tier: result.signal.specterCustomerTier,
      predictedLTV: result.signal.predictedLTV,
      churnRisk: result.signal.churnRisk,
      priceSensitivity: result.signal.priceSensitivity,
      returnsRisk: result.signal.returnsRisk,
      source: result.source,
      confidence: result.confidence
    };
  }
}
```

---

## 5. Normalization Boundary – No Raw Shopify Beyond This

```typescript
// packages/order-nexus/src/normalization/order-normalization-service.ts

export class OrderNormalizationService {
  constructor(private readonly pcdHasher: PcdHasher) {}

  normalizeShopifyOrder(rawOrder: any): NormalizedOrder {
    const shopId = Number(rawOrder.shop_id);

    return {
      id: String(rawOrder.id),
      shopId,
      createdAt: rawOrder.created_at,
      updatedAt: rawOrder.updated_at,
      processedAt: rawOrder.processed_at || undefined,
      currency: rawOrder.currency,
      totalPrice: parseFloat(rawOrder.total_price),
      subtotalPrice: parseFloat(rawOrder.subtotal_price),
      totalTax: parseFloat(rawOrder.total_tax || '0'),
      shippingLines: (rawOrder.shipping_lines || []).map((line: any) => ({
        price: parseFloat(line.price),
        title: line.title,
        code: line.code
      })),
      lineItems: (rawOrder.line_items || []).map((item: any) => ({
        productId: String(item.product_id),
        variantId: item.variant_id ? String(item.variant_id) : undefined,
        quantity: item.quantity,
        price: parseFloat(item.price)
      })),
      customer: rawOrder.customer
        ? {
            hashedId: this.pcdHasher.hashCustomerId(
              shopId,
              String(rawOrder.customer.id)
            )
          }
        : undefined
    };
  }
}
```

---

## 10. Data Model – SQL Schema (Phase 1)

```sql
-- Core profitability snapshot
CREATE TABLE order_profitability (
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,

  -- Maps to Shopify 'created_at' (UTC)
  order_date TIMESTAMPTZ NOT NULL,

  -- Core metrics
  revenue_total DECIMAL(10,2) NOT NULL,
  landed_cost_total DECIMAL(10,2) NOT NULL,
  net_profit DECIMAL(10,2) NOT NULL,
  margin_percent DECIMAL(5,2) NOT NULL,
  profit_status VARCHAR(16) NOT NULL,

  -- Leakage (aggregated + detail)
  leakage_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  leakage_categories JSONB,

  -- Versioning / audit
  cost_model_version VARCHAR(64) NOT NULL,
  cost_model_source VARCHAR(16) NOT NULL, -- 'finance' | 'local'
  computation_source VARCHAR(32) NOT NULL DEFAULT 'initial',
  previous_net_profit DECIMAL(10,2),
  previous_cost_model_version VARCHAR(64),

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (shop_id, order_id)
);

COMMENT ON COLUMN order_profitability.order_date IS
  'Source: Shopify created_at (UTC). Used for time-series profitability reporting.';

CREATE INDEX idx_order_profitability_shop_status
  ON order_profitability(shop_id, profit_status);

CREATE INDEX idx_order_profitability_shop_date
  ON order_profitability(shop_id, order_date);

-- History table (recomputations)
CREATE TABLE order_profitability_history (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  cost_model_version VARCHAR(64) NOT NULL,
  net_profit DECIMAL(10,2) NOT NULL,
  computation_source VARCHAR(32) NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_profit_history_order
  ON order_profitability_history(shop_id, order_id);

CREATE INDEX idx_order_profit_history_version
  ON order_profitability_history(cost_model_version);

CREATE TABLE order_return_impact (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  return_id VARCHAR(64) NOT NULL,

  total_refund_amount DECIMAL(10,2) NOT NULL,
  total_restocking_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_writeoff_cost DECIMAL(10,2) NOT NULL DEFAULT 0,

  currency VARCHAR(8) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,       -- from ReturnOutcomeEvent.processedAt
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_return_impact_order
  ON order_return_impact (shop_id, order_id);

CREATE INDEX idx_order_return_impact_return
  ON order_return_impact (shop_id, return_id);
```

---

## 13. Developer Contract – Final Locked Statement

> **OrderNexus Developer Contract**
>
> Given Shopify orders (via webhooks or backfill) and a basic cost configuration, **OrderNexus guarantees**:
>
> - Computation of **true landed cost**, **net profit**, **margin %**, and **profit status** for every ingested order.
> - **Basic profit leakage detection** (shipping + service overkill at minimum).
> - **Customer profitability tiers** derived from realized order history (whale curve) when Specter is available.
> - **Graceful degradation**:
>   - If Financial Intelligence is unavailable → falls back to local cost models (`costModelSource = 'local'`, `computationSource = 'basic_fallback'`).
>   - If Specter is unavailable → uses inferred/default customer signals with explicit confidence.
> - **Operational SLA**:
>   - Target processing time: **5 seconds** per order under normal load.
>   - 99% of orders have profit data within **60 seconds** of webhook receipt.
>   - Queue delay warnings emitted after **25 seconds**.
> - **Auditability**:
>   - All recomputations tracked with:
>     - previous net profit
>     - previous cost model version
>     - history entries in `order_profitability_history`.
>   - Cost model sources (`finance` vs `local`) and computation reasons (`initial`, `recomputation`, `basic_fallback`) are explicitly stored and queryable.
>   - Post-return economic impact is stored separately in `order_return_impact`, sourced exclusively from `ReturnOutcomeEvent` emitted by ReturnNexus.

### 13.1 CNS & Mode Boundary (LOCKED)

OrderNexus MUST:

- Remain **mode-agnostic**: no internal `survival | growth | architect` branching.
- Produce consistent profitability outputs for the same inputs, regardless of CNS state.
- Expose signals and metrics that CNS can consume (profit stability, leakage, trend scores).

OrderNexus MUST NOT:

- Store or compute merchant maturity mode.
- Change thresholds based on mode or psychological framing.
- Own any UX, urgency, or "tone" decisions.

All behavioral variation (Survival vs Growth vs Architect) is handled by:

- **CNS Core** → generates `CnsContextSnapshot`
- **InsightCore & Widgets** → render context-aware UI using that snapshot

---

## 14. Onboarding & Readiness – OrderNexus (Draft)

**Goal:** Define exactly when a shop is considered OrderNexusReady, what must be true in the data plane and config plane, and how this maps to onboarding tasks surfaced in FT0 flows.

### 14.1 Role in FT0 & LaSyncro

OrderNexus is the economic backbone of LaSyncro:

It converts raw orders → normalized orders → profitability snapshots.

It feeds:

- InsightCore (analytics events, whale curves, profitability distributions),
- Specter (profit-aware customer tiers, interventions),
- ReturnNexus (post-return economics via order_return_impact),
- MarginCore / Finance (cost model usage + feedback loops),
- Echo Hub / WMS Lite (fulfilment profit signals, tasks).

Therefore, FT0 onboarding MUST guarantee that OrderNexus is healthy before higher-order intelligence (Specter, InsightCore, ReturnNexus dashboards) is considered "ready".

### 14.2 Readiness Definition

We define a concrete boolean:

```typescript
// Conceptual contract – not implementation detail
type OrderNexusReadinessFlag =
  | 'MISSING_SHOPIFY_INTEGRATION'
  | 'NO_ORDERS_INGESTED'
  | 'COST_MODEL_FALLBACK_ACTIVE'
  | 'COST_MODEL_PRECISE'
  | 'MODE_AUTODETECTED'
  | 'MODE_EXPLICITLY_SET'
  | 'PIPELINE_HEALTHY';

export interface OrderNexusReadinessSnapshot {
  shopId: number;
  isReady: boolean;
  flags: OrderNexusReadinessFlag[];
  lastEvaluatedAt: string; // ISO
}
```

`OrderNexusReady(shopId)` is **true** when **ALL** of the following hold:

1. **Shopify integration exists and initial sync is completed**
   - `platform.integration.connected === true`
   - `platform.integration.syncCompleted === true`

2. **At least one profitable order has been processed**
   - `orderNexus.profitabilityActive === true`
   - `orderNexus.ordersIngested >= 1` (backed by `order_profitability` rows)

3. **Cost model is hydrated (local or finance-driven)**
   - `orderNexus.costModelHydrated === true`
   - `orderNexus.costModelSource` is:
     - `'finance'` → precise cost model (preferred), or
     - `'local'` → fallback allowed, but flagged via readiness flags / UI.

4. **Operating mode is determined**
   - `orderNexus.modeDetermined === true`
   - Mode may be auto-detected or explicitly set by the merchant.

5. **Pipeline is healthy enough for FT0**
   - `orderNexus.pipelineHealthy === true`
   - Backed by `OrderProcessingSLA` metrics (99% of orders processed < `MAX_EXPECTED_TIME_MS`).

6. **Cost confidence is above a minimum floor**
   - `orderNexus.costConfidenceScore >= 0.2`
   - Below this, insights are considered too noisy to treat the module as fully "ready".

If any of 1–4 fails, `OrderNexusReady = false`.

If 5 is degraded but not catastrophically broken, `OrderNexusReady` may remain `true` but surfaced with **pipeline health warnings**.

Cost model **source** (`finance` vs `local`) influences nudging and labels, but **does not alone block** readiness as long as `orderNexus.costModelHydrated === true` and `orderNexus.costConfidenceScore >= 0.2`.

---

**End of Document 1: Core Architecture & Boundaries**