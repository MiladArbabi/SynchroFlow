# SKU-OS — Complete blueprint ft0-ft1

## 1) One-line summary

SKU-OS: make product health & inventory intelligence automatic — detect risk (stockouts, overstock, margin erosion), surface priority actions, and feed the CNS for cross-module analytics.

---

## 2) Current status — what we already implemented for ft0-ft1

* **Readiness provider (FT0)** added in `apps/backend/src/onboarding/readiness.providers.ts`:

  * Emits `skuOs.productCount`, `skuOs.productHealthEvents`, `sku-os.freeTierState`, `sku-os.freeTierRemaining`.
  * Logic uses `canonical_products` / `productCount` and derives `productHealthEvents` as productCount for v1 stub.
* **Docs / blueprints**: `docs/blueprints/SKU-OS.md` exists and defines high level responsibilities (we referenced it in InsightCore blueprint).
* **Canonical schema**:

  * `canonical_products` migration exists (`20251203092225_create_canonical_products.ts`) and will provide product rows (you showed migration list).
  * `canonical_order_line_items` already present (line item quantities, unit prices, estimated_unit_cost) — usable for SKU cost signals.
* **InsightCore** will ingest `ProductHealthAnalyticsEvent` from SKU-OS and has `fact_product_health` schema locked in InsightCore blueprint.

---

## 3) Mission & boundaries (locked intent)

**Mission (v1):** Continuously score each SKU for health (0–100) and surface top problems (stockout risk, low margin, slow turnover) so merchants can prioritize action.

**SKU-OS OWNS (v1):**

* Product health score (`healthScore` 0–100).
* Stockout risk (0–1).
* Margin health (`healthy | at_risk | critical | unknown`).
* Confidence band (`low | medium | high`).
* Emits `ProductHealthAnalyticsEvent` to InsightCore.

**SKU-OS DOES NOT:**

* Decide vendor purchase orders (WMS / Reorder engines do that).
* Override cost models (MarginCore owns cost model).
* Mutate order / profitability state.

---

## 4) FT0 (what ships now — locked minimal value)

**Goal:** Out-of-the-box “aha” — show product health for a subset of SKUs and a single actionable widget.

**FT0 scope**

* Ingest `canonical_products` and seed `skuOs.productCount`.
* Produce simple `healthScore` computed from:

  * Recent inventory level (if available),
  * Sales velocity (derived from `canonical_orders` / `canonical_order_line_items`) — last 30 days,
  * Cost margin proxy using `estimated_unit_cost` (if present),
  * Basic heuristics for stockout risk and turnover.
* Emit `ProductHealthAnalyticsEvent` for each product on a schedule (e.g., daily).
* Provide a single UI widget: **Top-10 At-Risk SKUs** (stockout risk or margin critical).
* Readiness signals:

  * `integration.syncCompleted` dependency (platform).
  * `skuOs.productHealthEvents` (>=1) used in onboarding.
* Free tier exposure: top-10 at-risk (read-only); full product list gated to paid tiers.

**FT0 API contract (locked):**

```ts
export interface ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;        // canonical product id
  healthScore: number;      // 0..100
  stockoutRisk: number;     // 0..1
  marginHealth: 'healthy'|'at_risk'|'critical'|'unknown';
  confidence: 'low'|'medium'|'high';
  recalculatedAt: string;   // ISO
}
```

(InsightCore and dashboards expect this exactly.)

---

## 5) FT1 (first expansion — high value)

**Goal:** Make SKU-OS actionable — enable playbooks, alerts and finer signals.

**FT1 scope**

* More sophisticated health model:

  * Use seasonality / time-series smoothing for velocity (7/30/90 day windows).
  * Use inventory lead times & inbound receipts (if WMS or vendor receipts available) to compute projected stockout date.
  * Include product health decay and SKU age.
* Add `degradationReason` tags per product (e.g., `low_velocity`, `high_return_rate`, `low_margin`, `supply_delay`).
* Provide product-level playbooks and quick actions:

  * “Create replenish suggestion” (hook to WMS / Reorder engine),
  * “Flag product for price review” (ties to Price recommendations or MarginCore),
  * “Create product health alert” (notifications).
* UI widgets:

  * Product Health time series (trend),
  * Stockout forecast table,
  * Margin Health distribution,
  * Health map (grid) with filters.
* Eventing:

  * Emit `SkuHealthChangeEvent` when `healthScore` crosses thresholds (<=50).
  * Integrate with Problem Center for persistent issues.
* Free tier: limited list of critical SKUs, 7-day velocity; paid features: full list, forecasts, playbooks.

---

## 6) Analytics primitives SKU-OS owns

* `healthScore` (0–100)
* `stockoutRisk` (0–1)
* `turnoverRate` (inventory turns, units per period)
* `daysOfCover` (projected days until stockout given velocity)
* `marginHealth` categorical
* `degradationReasons` (tag set)
* `confidence` band

These become metric/dimension seeds for InsightCore (e.g., `health_score_latest`, `stockout_risk_latest`, `days_of_cover`).

---

## 7) Data model (canonical & warehouse)

**Canonical inputs (already present):**

* `canonical_products` (product ids, title, platform ids)
* `canonical_order_line_items` (quantity, unit_price, estimated_unit_cost)
* future: `inventory_truth` / WMS receipts (migrations exist)

**SKU-OS warehouse (logical fact table)** (seeded into InsightCore `fact_product_health`):

```sql
fact_product_health (
  shop_id INTEGER,
  product_id INTEGER,
  health_score DECIMAL(5,2),
  stockout_risk DECIMAL(4,3),
  margin_health VARCHAR(16),
  confidence VARCHAR(16),
  recalculated_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
)
```

(InsightCore blueprint already has this table; SKU-OS writes to it via events.)

---

## 8) Providers & Readiness signals (what we added / must add)

**Already added (FT0, in readiness.providers.ts):**

* `skuOs.productCount` — number of canonical products
* `skuOs.productHealthEvents` — v1 stub = productCount
* `sku-os.freeTierState`, `sku-os.freeTierRemaining`

**What must be refined (next patches):**

* Make `skuOs.productHealthEvents` reflect actual emitted events (count of events in last X days).
* Add freshness timestamps: `skuOs.lastProductHealthEventAt`.
* Add readiness predicate for product health dashboards:

  * `canShowProductHealthDashboards = has product health events AND productCount >= 1`.

---

## 9) What we planned but NOT YET implemented (action backlog)

* Real health model (seasonality + inventory lead time).
* Degradation reasons & playbooks.
* Stockout forecasting using lead times & open purchase orders.
* `SkuHealthChangeEvent` and integration into Problem Center alerts.
* UI widgets beyond Top-10 at-risk.
* Export / CSV and API queries for product health.
* Unit/Integration tests for the health scoring pipeline.

---

## 10) Tests & QA to add

* Unit tests for scoring functions:

  * velocity → healthScore mapping,
  * margin → marginHealth mapping,
  * daysOfCover calculation.
* Integration test: seed canonical_products + order_line_items, run SKU-OS recalculation, assert `fact_product_health` rows inserted with expected values.
* Readiness provider tests: mock DB rows to assert `skuOs.productCount` & `skuOs.productHealthEvents` results.
* e2e: UI widget shows top-10 at-risk after a sync.

---

## 11) Patch plan — prioritized (patch by patch, small → large)

### Patch 0 — Readiness signal hardening (quick)

**What:** Make `skuOs.productHealthEvents` reflect actual events & add `lastProductHealthEventAt`. Prevent readiness endpoint false negatives.
**Why:** Onboarding must be honest about SKU-OS readiness.
**Files:** `apps/backend/src/onboarding/readiness.providers.ts`
**Deliverable:** provider reads `fact_product_health` or `product_health_events` table (if you emit events).

### Patch 1 — FT0 scoring job (urgent)

**What:** Implement a scheduled job (daily) that:

* Aggregates last 30d sales velocity per product (from `canonical_order_line_items`),
* Computes simple healthScore = weighted combination: velocity, daysOfCover (if inventory), margin proxy,
* Emits `ProductHealthAnalyticsEvent` for each product (or top N for free tier) to event bus/InsightCore ingestion endpoint.
  **Why:** Provides the data InsightCore & UI expect.
  **Files:** new worker in `apps/backend` or `apps/ai-engine` job.

### Patch 2 — Emit to InsightCore (FT0 integration)

**What:** Hook job to send `ProductHealthAnalyticsEvent` (locked contract) to InsightCore ingestion endpoint.
**Why:** InsightCore requires these events for dashboards.
**Files:** SKU-OS producer + InsightCore consumer (consumer is in InsightCore blueprint).

### Patch 3 — UI widget & gating (FT0 UI)

**What:** Frontend widget Top-10 At-Risk SKUs; onboarding task uses `skuOs.productHealthEvents` to mark completion.
**Why:** Merchant aha moment.
**Files:** ui components; onboarding manifest.

### Patch 4 — FT1 scoring & forecasting

**What:** Implement forecasting using lead time & receipts; add degradation reasons; add playbooks and integration with Problem Center.
**Why:** Makes SKU-OS actionable and revenue impacting.

### Patch 5 — Alerts, webhooks, and exports

**What:** Add alerts, export APIs, and enhanced dashboards.
**Why:** Monetisation and retention.

---

## 12) Example SQLs / sketches useful now

Sales velocity (units per day last 30d):

```sql
SELECT li.canonical_product_id AS product_id,
       SUM(li.quantity) / 30.0 AS avg_units_per_day
FROM canonical_order_line_items li
JOIN canonical_orders o ON o.platform_order_id = li.platform_order_id AND o.shop_id = li.shop_id
WHERE li.shop_id = :shopId AND o.order_created_at >= now() - interval '30 days'
GROUP BY li.canonical_product_id;
```

Days of cover (requires on-hand inventory table `inventory_truth`):

```sql
SELECT p.product_id, inv.on_hand / NULLIF(vel.avg_units_per_day,0) AS days_of_cover
FROM (
  /* velocity subquery */
) vel
JOIN inventory_truth inv ON inv.sku = p.sku
```

Health score (simple heuristic pseudo):

```text
healthScore = clamp( 100 * (0.5*norm_daysOfCover + 0.3*norm_margin + 0.2*norm_velocity), 0, 100)
```

Where each `norm_*` is scaled 0..1 by sensible thresholds.

---

## 13) Free-tier gating recommendations

* Free tier (FT0): top 10 at-risk SKUs, a single widget, daily refresh, limited history (7d).
* FT1 / Paid: full product list, forecasts, playbooks, downloadable reports, advanced confidence levels, longer retention (90d+).
* Metrics gated: `stockoutForecast`, `degradationReasons`, `daysOfCover` — premium.

---

## 14) UX & Clear Paths (actions)

Each SKU row must offer a Clear Path action:

* Survival: “Mark reorder” / “Create replenishment request” → emits `replenish_suggestion` event.
* Growth: “Promote product” → link to Specter to create nudge campaigns.
* Architect: “Open product health config” → set thresholds, notification rules.

Closed-loop: when action executed (e.g., reorder placed), SKU-OS should observe outcome (inventory level increases, healthScore improves) and record `SkuHealthChangeEvent` for model retraining and auto-tuning thresholds.

---

## 15) Risks & open decisions (callouts)

* **Cost data availability**: marginHealth depends on `estimated_unit_cost`. If that’s missing widely, marginHealth falls to `unknown` — plan a UX to surface "missing cost" and link to OrderNexus task.
* **Inventory truth**: stockout forecasts need reliable on-hand + inbound data (WMS or inventory_truth) — make forecasts optional with graceful fallbacks.
* **Contract locking**: `ProductHealthAnalyticsEvent` is locked — any change requires a contract version update and InsightCore migration.
* **Performance**: per-product aggregation must be batched and indexed (`canonical_order_line_items` must be indexed on `(shop_id, canonical_product_id, platform_order_id)`).

---

## 16) Deliverables

1. Exact TypeScript worker that computes FT0 health scores and emits `ProductHealthAnalyticsEvent` (complete file + tests).
2. Readiness provider patch to make `skuOs.productHealthEvents` real (if events are present).
3. SQL diagnostics script that prints velocity, sample healthScore, and top risk SKUs for a shop.
4. Frontend widget spec (props + sample mock data) for Top-10 At-Risk SKUs.

---
