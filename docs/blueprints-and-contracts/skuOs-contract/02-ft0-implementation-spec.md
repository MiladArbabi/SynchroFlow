FT0 (What Ships Now — Locked Minimal Value)
Goal
Out-of-the-box "aha" moment — show product health for a subset of SKUs and provide a single actionable widget.

FT0 Scope
Core Functionality:
Ingest canonical_products and seed sku-os.productCount

Produce simple healthScore computed from:

Recent inventory level (if available)

Sales velocity (derived from canonical_orders / canonical_order_line_items) — last 30 days

Cost margin proxy using estimated_unit_cost (if present)

Basic heuristics for stockout risk and turnover

Emit ProductHealthAnalyticsEvent for each product on a schedule (e.g., daily)

Provide a single UI widget: Top-10 At-Risk SKUs (stockout risk or margin critical)

Readiness Signals:
integration.syncCompleted dependency (platform)

sku-os.productHealthEvents (>=1) used in onboarding

Free Tier Exposure:
Top-10 at-risk (read-only)

Full product list gated to paid tiers

FT0 API Contract (Locked)
typescript
export interface ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;        // canonical product id
  healthScore: number;      // 0..100
  stockoutRisk: number;     // 0..1
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  recalculatedAt: string;   // ISO
}
Note: InsightCore and dashboards expect this exact contract.

FT1 (First Expansion — High Value)
Goal:
Make SKU-OS actionable — enable playbooks, alerts, and finer signals.

FT1 Scope:
More sophisticated health model:

Use seasonality / time-series smoothing for velocity (7/30/90 day windows)

Use inventory lead times & inbound receipts (if WMS or vendor receipts available) to compute projected stockout date

Include product health decay and SKU age

Add degradationReason tags per product (e.g., low_velocity, high_return_rate, low_margin, supply_delay)

Provide product-level playbooks and quick actions:

"Create replenish suggestion" (hook to WMS / Reorder engine)

"Flag product for price review" (ties to Price recommendations or MarginCore)

"Create product health alert" (notifications)

UI widgets:

Product Health time series (trend)

Stockout forecast table

Margin Health distribution

Health map (grid) with filters

Eventing:

Emit SkuHealthChangeEvent when healthScore crosses thresholds (<=50)

Integrate with Problem Center for persistent issues

Free tier: limited list of critical SKUs, 7-day velocity; paid features: full list, forecasts, playbooks

---