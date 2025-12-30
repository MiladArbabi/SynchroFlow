SKU-OS — Complete Blueprint FT0-FT1
1. One-line Summary
SKU-OS: Make product health & inventory intelligence automatic — detect risk (stockouts, overstock, margin erosion), surface priority actions, and feed the CNS for cross-module analytics.

2. Current Status — What We Already Implemented for FT0-FT1
Implemented Components:
Readiness Provider (FT0) - Added in apps/backend/src/onboarding/readiness.providers.ts:

Emits skuOs.productCount, skuOs.productHealthEvents, sku-os.freeTierState, sku-os.freeTierRemaining

Logic uses canonical_products / productCount and derives productHealthEvents as productCount for v1 stub

Documentation - docs/blueprints/SKU-OS.md exists and defines high-level responsibilities (referenced in InsightCore blueprint)

Canonical Schema:

canonical_products migration exists (20251203092225_create_canonical_products.ts) and provides product rows

canonical_order_line_items already present (line item quantities, unit prices, estimated_unit_cost) — usable for SKU cost signals

InsightCore Integration - Will ingest ProductHealthAnalyticsEvent from SKU-OS and has fact_product_health schema locked in InsightCore blueprint

3. Mission & Boundaries (Locked Intent)
Mission (v1):
Continuously score each SKU for health (0–100) and surface top problems (stockout risk, low margin, slow turnover) so merchants can prioritize action.

SKU-OS OWNS (v1):
Product health score (healthScore 0–100)

Stockout risk (0–1)

Margin health (healthy | at_risk | critical | unknown)

Confidence band (low | medium | high)

Emits ProductHealthAnalyticsEvent to InsightCore

SKU-OS DOES NOT:
Decide vendor purchase orders (WMS / Reorder engines do that)

Override cost models (MarginCore owns cost model)

Mutate order / profitability state