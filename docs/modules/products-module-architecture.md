# Products Module — System Architecture & Engineering Reference

**Project:** SynchroFlow / laSyncro  
**Module:** Products  
**Status:** Production-ready (post-audit implementation complete)  
**Last updated:** 2026-05-13  
**Prepared by:** Engineering session with Milad Arbabi (Co-founder)

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Tab Architecture](#2-tab-architecture)
3. [Backend Architecture](#3-backend-architecture)
4. [API Endpoints](#4-api-endpoints)
5. [Database Schema](#5-database-schema)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Cross-Domain Integrations](#7-cross-domain-integrations)
8. [RLS & Tenant Isolation](#8-rls--tenant-isolation)
9. [WMS-Lite Integration](#9-wms-lite-integration)
10. [Data Flow Diagrams](#10-data-flow-diagrams)
11. [Signal Inventory](#11-signal-inventory)
12. [Known Constraints & Future Work](#12-known-constraints--future-work)
13. [Key Commands](#13-key-commands)

---

## 1. Module Overview

The Products module is the catalog intelligence and warehouse operability surface for laSyncro. It serves SMB commerce operators (1–10 people, $100K–$50M revenue, own warehouse, high SKU complexity) who suffer from data fragmentation, Excel chaos, and daily firefighting.

**Core purpose:** Answer four operator questions in one surface:
- Can I actually sell this? (sellability)
- Am I making money on it? (margin / cost)
- What's about to run out? (supply risk)
- Can my warehouse handle it? (WMS-Lite operability)

**Module ID:** `products`  
**Nav group:** `catalog` (order: 10)  
**Base route:** `/products`  
**Entitlement:** `requiredModuleId: 'products'` — no tier gate on the module itself; individual signals may be growth-gated

---

## 2. Tab Architecture

The module uses `ModuleTabBar` (`apps/frontend/src/components/ModuleTabBar.tsx`) for internal tab navigation. All tabs are registered under the `/products/*` wildcard route in `LifecycleRouteHost.tsx`.

### Tab 1 — Intelligence (`/products`)

**Purpose:** Daily-driver surface. Priority signals ranked by $ impact. Opens by default.

**Signals rendered:**
- Product count + outcome chip (✓ Looking good / ✗ Needs attention)
- Data trust bar (freshness per domain: Stock, Inventory, Sales, Fulfillment, Cost)
- Sellability: `X of Y products ready to sell` + progress bar
- Blocked reasons: no product code (→ Catalog tab CTA), no inventory, zero stock
- Dead weight: products with no sales this period
- Supply signals (growth-tier cross-domain): critical SKUs, dead capital $, reorder now list
- Returns: top returned SKUs with return rate bar + revenue leakage $

**Data sources:** `/api/v1/modules/products/ft2` + `/api/v1/modules/products/operator-summary`

### Tab 2 — Catalog (`/products/catalog`)

**Purpose:** Full SKU management. No intelligence signals — catalog facts only.

**Signals rendered:**
- No-SKU products: full list grouped by product, variant options shown, count + variant count
- Catalog drift: products added this period (suppressed on first sync when added = total)
- Sellability summary: sellable / blocked / no SKU / zero stock counts

**Data source:** `/api/v1/modules/products/operator-summary`

**Note:** Catalog drift is suppressed when `addedThisPeriod >= totalProducts` — this detects first-sync noise where the entire catalog appears as "new."

### Tab 3 — Costs (`/products/costs`)

**Purpose:** Cost entry and bulk CSV upload. Setup task surface, not daily signal.

**Signals rendered:**
- Missing cost count + alert banner
- Per-variant cost entry (inline text field)
- Bulk CSV upload (`sku,unit_cost` format)
- Gift cards and non-physical products filtered out

**Data source:** `/api/v1/modules/products/variants/costs`

**Important:** Only `product_type = 'physical'` variants are shown. Gift cards (`product_type = 'gift_card'`), digital, and service products are excluded.

### Tab 4 — WMS Readiness (`/products/wms-readiness`)

**Purpose:** Warehouse operability signals. Answers: "can my WMS-Lite actually pick, receive, and count this product?" Available to all tiers — WMS-Lite operability is a core differentiator.

**Signals rendered:**
- Pickability: not pickable count (no SKU), no bin location count
- Inventory trust: variance count, total variance units, last evaluation timestamp
- Receive readiness: open receive jobs with rejections, total rejected units

**Data source:** `/api/v1/modules/products/wms-readiness`

### Sidenav Highlighting

All product sub-routes keep "Products" highlighted in the sidenav via `relatedPaths` in `SidenavContent.tsx`:

```typescript
// apps/frontend/src/layouts/AppLayout/SidenavContent.tsx
const relatedPaths: Record<string, string[]> = {
  orders: ['/fulfillment'],
  products: ['/products/catalog', '/products/costs', '/products/wms-readiness'],
};
```

---

## 3. Backend Architecture

### Service Layer Pipeline

The products backend follows the **Facts → Intelligence → FTEP** pipeline pattern:

```
Controller
    └── Provider (withTenant wrap — RLS boundary)
            ├── Facts service (raw DB queries)
            ├── Intelligence service (pure computation, no DB)
            └── FTEP service (exposure policy, entitlement downgrade)
```

### Provider Files

| Provider | Path | Purpose |
|---|---|---|
| `getProductsFt2Snapshot` | `services/products-ft2.provider.ts` | Orchestrates all FT2 sub-pipelines |
| `getProductDataIntegritySnapshot` | `services/products-data-integrity.provider.ts` | Data integrity sub-pipeline |
| `getProductsOperatorSummary` | `services/products-operator/ProductsOperatorSummary.provider.ts` | Operator summary (direct surface, no FTEP) |

### Facts Services

| Service | Path | Tables queried |
|---|---|---|
| `getProductsFacts` | `services/products-facts/ProductsFacts.service.ts` | `variants` |
| `getProductOperationalFacts` | `services/products-operational-facts/ProductOperationalFacts.service.ts` | `products`, `inventory_truth`, `order_revenue_units`, `historical_sales`, `order_fulfillment_status` |
| `getProductSupplyFacts` | `services/products-supply-facts/ProductSupplyFacts.service.ts` | `products`, `inventory_truth`, `order_fulfillment_status` |
| `getProductDataFreshnessFacts` | `services/products-data-freshness-facts/ProductDataFreshnessFacts.service.ts` | `products`, `inventory_truth`, `order_revenue_units`, `order_fulfillment_status` |
| `getProductDataIntegrityFacts` | `services/products-data-integrity-facts/ProductDataIntegrityFacts.service.ts` | `variants` |
| `getProductDependencyFacts` | `services/products-dependency-facts/ProductDependencyFacts.service.ts` | `products`, `inventory_truth`, `historical_sales`, `order_fulfillment_status`, `product_costs` |
| `getProductsOperatorFacts` | `services/products-operator/ProductsOperatorFacts.service.ts` | `variants`, `inventory_truth`, `order_revenue_units`, `refund_executions` |
| `getProductsWmsReadinessFacts` | `services/products-operator/ProductsWmsReadinessFacts.service.ts` | `variants`, `inventory_unit_status`, `inventory_truth`, `receive_jobs` |

### Cross-Domain Bridge

| Service | Path | Purpose |
|---|---|---|
| `getProductsDemandSignals` | `services/products-operator/ProductsDemandBridge.service.ts` | Pulls velocity, days-of-stock, capital-at-risk from demand service |

The demand bridge calls `computeDemandIntelligence(shopId)` which owns its own transaction and RLS context. No `trx` threading needed — demand is a separate domain. Returns `null` gracefully if demand data is unavailable. The bridge runs in parallel with `getProductsOperatorFacts` via `Promise.all` in the operator summary provider.

### RLS Pattern — CRITICAL

**Every** Facts service that queries RLS-protected tables MUST receive a `trx` from a `withTenant` caller. The established pattern:

```typescript
// Sub-service signature
export async function getProductsFacts(
  input: GetProductsFactsInput,
  trx?: Knex | Knex.Transaction  // optional — injected by withTenant caller
): Promise<ProductsFacts> {
  const qb = trx ?? db;  // always use qb, never bare db()
  return qb('variants').where(...)
}

// Provider wraps in withTenant and passes trx
export async function getProductsFt2Snapshot(input) {
  return withTenant(shopId, async (trx) => {
    const facts = await getProductsFacts(input, trx);
    ...
  });
}
```

**Bare `db()` calls on RLS tables silently return 0 rows.** This was the systemic bug found during audit (P-001 to P-010). All services have been fixed.

---

## 4. API Endpoints

All endpoints registered under `/api/v1/modules/products/` in `apps/backend/src/api/products/products.ft2.routes.ts`.

### `GET /api/v1/modules/products/ft2`

**Auth:** `authenticateToken` + `requireFt2`  
**Query params:** `preset` (FT2DateRangePreset), `from`, `to` (for custom range)  
**Returns:** Full FT2 snapshot — signals, FTEP exposure, context counts  
**Handler:** `getProductsFt2` in `products.ft2.controller.ts`  
**Provider:** `getProductsFt2Snapshot` in `products-ft2.provider.ts`

### `GET /api/v1/modules/products/operator-summary`

**Auth:** `authenticateToken` (no `requireFt2` — direct operator surface)  
**Query params:** `preset`, `from`, `to`  
**Returns:** Sellability, dead weight, drift, top returned, no-SKU products, demand signals  
**Handler:** `getProductsOperatorSummaryHandler` in `products.operator.controller.ts`  
**Provider:** `getProductsOperatorSummary` in `ProductsOperatorSummary.provider.ts`

**Response shape:**
```typescript
{
  period: { from: string; to: string };
  sellability: {
    sellable: number | null;
    blocked: number | null;
    blockedReasons: { noSku: number | null; noInventory: number | null; zeroStock: number | null };
  };
  deadWeight: { noSalesCount: number | null };
  drift: { addedThisPeriod: number | null };
  topReturned: Array<{ variantTitle, sku, unitsReturned, revenueLeakage, returnRatePct }>;
  noSkuProducts: Array<{ productTitle, variants: Array<{ variantTitle }> }>;
  demand: ProductsDemandSignals | null; // null if growth tier not enabled
}
```

### `GET /api/v1/modules/products/wms-readiness`

**Auth:** `authenticateToken` (all tiers)  
**Query params:** none (point-in-time, not period-based)  
**Returns:** Warehouse operability signals  
**Handler:** `getProductsWmsReadinessHandler` in `products.wms-readiness.controller.ts`  
**Service:** `getProductsWmsReadinessFacts` in `ProductsWmsReadinessFacts.service.ts`

**Response shape:**
```typescript
{
  not_pickable_count: number | null;        // active variants with no SKU
  no_bin_location_count: number | null;     // SKU present, never stowed
  variance_count: number | null;            // on_hand != reserved+committed+available
  total_variance_units: number | null;      // sum of delta across variance variants
  open_receive_jobs_with_rejections: number | null;
  total_rejected_units: number | null;
  oldest_inventory_evaluated_at: string | null;
}
```

### `GET /api/v1/modules/products/variants/costs`

**Auth:** `authenticateToken` + `requireFt2`  
**Returns:** All physical variants with unit_cost, sorted missing-first  
**Note:** Filters `product_type = 'physical'` — excludes gift cards, digital, service

### `PATCH /api/v1/modules/products/variants/:variantId/cost`

**Auth:** `authenticateToken` + `requireFt2`  
**Body:** `{ unit_cost: number }`  
**Side effects:** Backfills unfulfilled `order_revenue_units.estimated_unit_cost`; resolves `missing_cogs` alert when all variants have cost

### `POST /api/v1/modules/products/variants/costs/bulk`

**Auth:** `authenticateToken` + `requireFt2`  
**Body:** Parsed CSV rows `[{ sku: string, unit_cost: number }]`  
**Side effects:** Same as PATCH per variant

---

## 5. Database Schema

### Core Tables

#### `variants`

Primary atomic unit for products. All revenue, inventory, and cost facts are keyed to `lasyncro_variant_id`.

| Column | Type | Notes |
|---|---|---|
| `lasyncro_variant_id` | UUID PK | Immutable once assigned |
| `lasyncro_product_id` | UUID FK → products | Grouping only |
| `shop_id` | INT FK → shops | RLS column |
| `sku` | VARCHAR(255) nullable | Unique per shop. Null = not warehouse-ready |
| `title` | VARCHAR(255) nullable | Shopify variant title. "Default Title" = single-variant product |
| `barcode` | VARCHAR(255) nullable | **EAN/UPC/GTIN synced from Shopify.** Drives receive flow branching: if present → scan-to-match; if null → manual PO line selection + label print |
| `unit_cost` | DECIMAL(12,2) NOT NULL | Defaults to 0 — operator must enter actual cost via Costs tab |
| `status` | VARCHAR(255) | 'active' / 'archived' |

**RLS policy:** `shop_id = current_setting('app.current_tenant')::int`

#### `products`

Product container (grouping only). Revenue and cost facts never aggregate at product level — always at variant level.

| Column | Type | Notes |
|---|---|---|
| `lasyncro_product_id` | UUID PK | |
| `shop_id` | INT FK | RLS column |
| `title` | VARCHAR(255) | Shopify product title |
| `product_type` | VARCHAR | `'physical'` / `'digital'` / `'gift_card'` / `'service'` — mapped from Shopify `productType` |
| `status` | VARCHAR | `'active'` / `'archived'` / `'draft'` |

#### `inventory_truth`

Per-variant per-location inventory projection. Updated by WMS workflows.

| Column | Type | Notes |
|---|---|---|
| `shop_id` | INT | RLS column |
| `lasyncro_variant_id` | UUID | |
| `location_code` | VARCHAR | Bin location |
| `on_hand_quantity` | INT | Physical count |
| `reserved_quantity` | INT | Allocated to orders |
| `committed_quantity` | INT | In pick/pack workflow |
| `available_quantity` | INT | Sellable stock |
| `sellable_quantity` | INT | |
| `last_evaluated_at` | TIMESTAMP | Used in WMS Readiness freshness signal |

**Variance signal:** `SUM(on_hand) != SUM(reserved + committed + available)` per variant → shrinkage or unrecorded movement

#### `inventory_unit_status`

Tracks physical warehouse state per variant per bin. Written by stow/pick/pack workflows.

| Column | Type | Notes |
|---|---|---|
| `shop_id` | INT | RLS |
| `lasyncro_variant_id` | UUID | |
| `location_code` | VARCHAR | Bin location |
| `status` | `inventory_unit_status_type` | `stowed` / `picked` / `shipped` |

**WMS Readiness use:** LEFT JOIN to check if variant has ever been stowed (no row = no bin location)

#### `refund_executions`

Refund event header. One row per refund.

Key fields added in migration 0008:
- `return_reason` (`return_reason_type` enum): `wrong_item`, `damaged_in_transit`, `damaged_on_arrival`, `not_as_described`, `quality_issue`, `changed_mind`, `duplicate_order`, `other`
- `return_notes` (TEXT): free text, required when `return_reason = 'other'`

#### `refund_execution_line_items`

Per-unit return data.

Key field added in migration 0008:
- `item_condition` (`return_item_condition_type` enum): `resellable`, `repackable`, `damaged`, `unsellable` — set by operator during mobile returns inbound scan. Drives restow vs write-off decision.

#### `receive_jobs`

One per delivery event. Lifecycle: `pending → in_progress → inspection → barcode_assignment → stow_ready → closed`

#### `receive_job_lines`

Per-variant per-receive-job. Tracks `quantity_expected`, `quantity_accepted`, `quantity_rejected`.

#### `receive_exceptions`

Per-unit problems raised during inspection. Types: `defect`, `packaging_damage`, `wrong_item`, `wrong_variant`, `wrong_quantity`, `barcode_mismatch`, `other`. Feeds Problem Center and supplier defect rate.

#### `barcode_print_jobs`

Label print queue. Created at receive confirmation (per line item batch — not per unit).

Key fields added in migration 0100:
- `label_type` (`barcode_label_type` enum): `lasyncro` (standard identity label) / `problem` (PROBLEM-BIN label for rejected units)
- `printer_id` (UUID nullable): FK to `printers` table (no DB FK — application layer enforces)

#### `printers`

Shop-scoped label printer registry (added migration 0106).

| Column | Type | Notes |
|---|---|---|
| `printer_id` | UUID PK | |
| `shop_id` | INT | RLS |
| `name` | VARCHAR | Display name e.g. "Receiving Dock Printer" |
| `connection_type` | `printer_connection_type` | `bluetooth` / `wifi` / `usb` |
| `address` | VARCHAR nullable | BT MAC or IP address |
| `model` | VARCHAR nullable | e.g. "Zebra ZQ520" — for driver selection on mobile |
| `is_default` | BOOL | Pre-selected for new receive sessions |
| `active` | BOOL | Inactive = hidden from operator selection |

#### `purchase_orders` / `purchase_order_line_items`

PO header and line items. Key field added to line items (migration 0096):
- `has_global_identifier` (BOOL nullable): set at PO creation based on `variants.barcode`. Drives receive flow branching on mobile — `true` = scan-to-match, `false` = manual selection + generate laSyncro barcode + print job.

#### `warehouse_locations`

Hierarchical bin location registry. Composite PK: `(shop_id, location_code)`. Types: `warehouse → lane → shelf → bin`.

#### `problem_center_tasks`

Physical warehouse exception tracking. Source: `pick`, `stow`, `receive`, `pack`. Lifecycle: `open → investigating → resolved | discarded | returned_to_supplier`. Links to `problem_bin_location` from `shop_wms_settings`.

---

## 6. Frontend Architecture

### Page Gate

`apps/frontend/src/pages/ft2-pages/ProductsFT2Page.tsx`

The main gate component. Owns:
- `ModuleTabBar` with 4 tabs
- Shared `FT2DateRange` state (passed to Intelligence + Catalog tabs)
- `useProductsFt2Snapshot(range)` — Intelligence tab data
- `useProductsOperatorSummary(range)` — Intelligence + Catalog tab data
- React Router `<Routes>` for tab content switching

### Tab Components

| Component | Path | Data hook |
|---|---|---|
| `ProductsModuleFT2` | `modules/products/src/ui/pages/ProductsModuleFT2.tsx` | Props from page |
| `ProductsCatalogPage` | `apps/frontend/src/pages/ft2-pages/ProductsCatalogPage.tsx` | `useProductsOperatorSummary` |
| `ProductsCostsPage` | `apps/frontend/src/pages/ft2-pages/ProductsCostsPage.tsx` | `CostEntryPanel` (internal hook) |
| `ProductsWmsReadinessPage` | `apps/frontend/src/pages/ft2-pages/ProductsWmsReadinessPage.tsx` | `useProductsWmsReadiness` |

### Data Hooks

| Hook | Path | Endpoint |
|---|---|---|
| `useProductsFt2Snapshot` | `pages/products/useProductsFt2Snapshot.ts` | `GET /modules/products/ft2` |
| `useProductsOperatorSummary` | `pages/products/useProductsOperatorSummary.ts` | `GET /modules/products/operator-summary` |
| `useProductsWmsReadiness` | `pages/products/useProductsWmsReadiness.ts` | `GET /modules/products/wms-readiness` |

### Adapter / Type Layer

`apps/frontend/src/pages/products/useProductsFt2Adapter.ts`

Pure function `mapProductsFt2Props(snapshot) → ProductsModuleFT2Props`. Normalises `undefined → null`. No inference, no computation.

### Module Entry

`modules/products/src/ui/ModuleEntry.tsx` — minimal descriptor. Nav registration is owned by `navBootstrap.ts`, not the module entry.

### Theming

`ProductsModuleFT2.tsx` uses a local `useProductsTheme()` hook (mirrors `OrdersModuleFT2` pattern):

```typescript
function useProductsTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
  };
}
```

All other frontend pages use `useAppTheme()` from `apps/frontend/src/hooks/useAppTheme.ts` (canonical CSS var tokens: `pal.surface`, `pal.rule`, `pal.ink`, etc.).

---

## 7. Cross-Domain Integrations

### Demand Module

**File:** `services/products-operator/ProductsDemandBridge.service.ts`

Calls `computeDemandIntelligence(shopId)` from `services/demand/demandIntelligence.service.ts`. The demand service owns its own `db.transaction` and `SET LOCAL app.current_tenant` — no `trx` threading needed.

**Data extracted:**
- `critical_reorder_count` — SKUs with < 7 days of stock
- `warning_reorder_count` — SKUs with 7–14 days of stock
- `stockout_count` — SKUs with `available_quantity <= 0`
- `total_inventory_value` — `SUM(unit_cost × available_quantity)`
- `dead_capital_value` — `SUM(unit_cost × available_quantity)` for `reorder_urgency = 'no_velocity'`
- `reorder_now` — sorted by `days_of_stock_remaining` ASC, top items shown in Intelligence tab

**Tier gating:** Demand module requires `growth` tier at the API level (`requireTier('growth')` in `demand.routes.ts`). The bridge returns `null` gracefully for non-growth shops — all demand cards in the UI handle `null` and render nothing.

**Parallelism:** Fetched in parallel with `getProductsOperatorFacts` via `Promise.all`:
```typescript
const [facts, demand] = await Promise.all([
  withTenant(shopId, (trx) => getProductsOperatorFacts(input, trx)),
  getProductsDemandSignals(shopId),
]);
```

### Shopify Sync

**File:** `services/shopify/shopifyProducts.core.ts` — `syncProducts()`

On every Shopify sync, `variants.barcode` is written from `variant.barcode` (Shopify's EAN/UPC field). This field is critical for the receive flow — its presence determines whether WMS-Lite can scan-to-match at inbound or must use manual PO line selection.

---

## 8. RLS & Tenant Isolation

### The Systemic Bug (Now Fixed)

Every bare `db(table)` call on a strict RLS table without `SET LOCAL app.current_tenant` silently returns 0 rows. This caused all products module surfaces to show empty/zeroed data before this audit.

### Fixed Services

All 7 facts services and 2 providers now follow the `withTenant` + `qb` pattern. See Section 3 for the pattern.

### RLS Pen-test

```bash
docker exec -e PGPASSWORD=sf_app_pass synchroflow_db psql -U sf_app -d synchroflow_db -c "
BEGIN; SET LOCAL app.current_tenant = '999';
SELECT 'variants', COUNT(*) FROM variants
UNION ALL SELECT 'inventory_truth', COUNT(*) FROM inventory_truth
UNION ALL SELECT 'products', COUNT(*) FROM products;
COMMIT;"
```

All counts must be 0 for tenant 999 (non-existent shop). Any non-zero count = RLS regression.

---

## 9. WMS-Lite Integration

### Receive Flow — Product Identity

The Products module feeds the WMS receive flow through two data points:

1. **`variants.barcode`** — EAN/UPC from Shopify. If present: operator scans product barcode at receive → system matches to variant → confirm receipt → print laSyncro label batch for that line item.

2. **`purchase_order_line_items.has_global_identifier`** — set at PO creation based on `variants.barcode`. If `false`: no global barcode exists → operator selects PO line item manually on mobile → system generates laSyncro barcode → queues print job (`barcode_print_jobs`) on receive confirmation.

### Label Printing

Labels are printed **per line item batch at receive confirmation** — not pre-printed, not per unit. This avoids label chaos (pre-printed labels getting mixed up).

Print job flow:
```
Operator confirms line item (e.g. 7 accepted, 1 problematic)
    ↓
System creates barcode_print_jobs:
  - 7× label_type='lasyncro' (standard identity label)
  - 1× label_type='problem' (PROBLEM-BIN label)
    ↓
Printer (selected at session start from printers table) outputs both batches
    ↓
Operator attaches lasyncro labels → stow queue
Operator attaches problem label → drops in PROBLEM-BIN
```

### WMS Readiness Signals

The WMS Readiness tab (`/products/wms-readiness`) surfaces warehouse operability before problems occur in pick/pack:

- **Not pickable (27):** Active variants with no SKU — WMS-Lite camera scan will fail at pick step. Fix: add SKU in Shopify and re-sync.
- **No bin location (13):** SKU present but no `inventory_unit_status` row with `status = 'stowed'` — product exists in catalog but warehouse doesn't know where it is. Fix: create receive job and stow.
- **Variance:** `inventory_truth` where `on_hand != reserved + committed + available` — signals shrinkage or unrecorded movements.
- **Last evaluation:** `MIN(last_evaluated_at)` across `inventory_truth` — how stale is the inventory projection.

---

## 10. Data Flow Diagrams

### Intelligence Tab Data Flow

```
ProductsFT2Page
    ├── useProductsFt2Snapshot(range)
    │       └── GET /modules/products/ft2
    │               └── getProductsFt2Snapshot(shopId, period)
    │                       └── withTenant(shopId, async (trx) => {
    │                               getProductsFacts(input, trx)
    │                               getProductDataIntegritySnapshot(input, trx)
    │                               getProductOperationalFacts(input, trx)
    │                               getProductSupplyFacts(input, trx)
    │                               getProductDataFreshnessFacts(input, trx)
    │                               getProductDependencyFacts(input, trx)
    │                               [alignment + ftep computation]
    │                           })
    │
    └── useProductsOperatorSummary(range)
            └── GET /modules/products/operator-summary
                    └── getProductsOperatorSummary(input)
                            ├── withTenant → getProductsOperatorFacts(input, trx)
                            └── getProductsDemandSignals(shopId)
                                    └── computeDemandIntelligence(shopId) [own transaction]
```

### WMS Readiness Data Flow

```
ProductsWmsReadinessPage
    └── useProductsWmsReadiness()
            └── GET /modules/products/wms-readiness
                    └── getProductsWmsReadinessFacts(shopId)
                            └── withTenant(shopId, async (trx) => {
                                    qb('variants') → not_pickable_count
                                    qb('variants').leftJoin('inventory_unit_status') → no_bin_location_count
                                    qb('inventory_truth').groupBy().having → variance_count
                                    qb('receive_jobs').whereIn(status) → open_receive_jobs
                                    qb('inventory_truth').min → oldest_evaluated_at
                                })
```

---

## 11. Signal Inventory

### Intelligence Tab — Signal Source Map

| Signal | Source table(s) | Tier gate | Notes |
|---|---|---|---|
| Products observed | `variants` | None | |
| Data trust (freshness) | `products`, `inventory_truth`, `order_revenue_units`, `order_fulfillment_status` | None | Per-domain freshness |
| Sellable / blocked count | `variants`, `inventory_truth` | None | Operator facts |
| No SKU count + list | `variants` | None | Count in Intelligence, full list in Catalog |
| No inventory count | `inventory_truth` | None | |
| Zero stock count | `inventory_truth` | None | |
| Dead weight (no sales) | `order_revenue_units` | None | |
| Critical SKUs | `order_revenue_units`, `inventory_truth` | Growth | From demand bridge |
| Dead capital $ | `variants.unit_cost` × `inventory_truth.available_quantity` | Growth | From demand bridge |
| Reorder now list | Demand velocity computation | Growth | Top 2 shown; "See all in Demand →" |
| Top returned SKUs | `refund_executions`, `refund_execution_line_items` | None | |
| Revenue leakage $ | `refund_execution_line_items.refunded_amount` | None | |

### Signal Deduplication Rules

Each signal lives in exactly one tab:

| Signal | Tab | Rationale |
|---|---|---|
| No-SKU product list (full) | Catalog | Management task |
| No-SKU count + blocked reason | Intelligence | Priority signal |
| Not pickable (WMS) | WMS Readiness | Warehouse lens |
| Catalog drift (added this period) | Catalog | Setup task |
| Cost entry | Costs | Setup task |
| Supply velocity + reorder | Intelligence (summary) + Demand (full) | Cross-module |

---

## 12. Known Constraints & Future Work

### Current Limitations

| ID | Description | Notes |
|---|---|---|
| A-004 | `products` migration strict ALL-command RLS — sync worker compensates but fragile | Review in security pass |
| — | Return reason clusters signal not buildable | `refund_executions.return_reason` now exists (migration 0008) but no data yet — mobile returns workflow not yet built |
| — | Margin per SKU signal not yet built | `unit_cost` exists; `order_revenue_units` has `estimated_unit_cost` — margin computation ready to build |
| — | Negative margin alert not yet built | Requires margin computation |
| — | Net margin post-return not yet built | Requires margin + returns join |

### Mobile Returns Workflow (Planned)

The data model is ready (migration 0008 added `return_reason_type` + `return_item_condition_type`). The mobile flow needs to be built in the WMS mobile app:

1. Operator opens return job (triggered from order)
2. Scans product barcode (laSyncro barcode)
3. Selects `return_reason` from enum
4. Photographs product condition
5. Selects `item_condition` per unit
6. System routes: `resellable` → restow queue, `damaged`/`unsellable` → write-off + Problem Center

### PO Creation Flow (Planned)

`purchase_order_line_items.has_global_identifier` is now in the schema. The PO creation UI needs to:
- Auto-detect `has_global_identifier` based on `variants.barcode` presence
- For `has_global_identifier = false`: generate laSyncro barcode for line item, no pre-print needed (labels printed at receive confirmation)

### Printer Registration (Planned)

`printers` table (migration 0106) is ready. Needs:
- Shop settings UI for printer registration
- Mobile receive session start: operator selects active printer from `printers` list
- `barcode_print_jobs.printer_id` populated at job creation

---

## 13. Key Commands

### Dev Reset + OAuth

```bash
npm run dev:full-reset

# Get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@test.com","password":"password123"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# Trigger OAuth
curl -s "http://localhost:3000/api/v1/integrations/oauth/initiate?shop=development-store-15820042357.myshopify.com&platform=shopify" \
  -H "Authorization: Bearer $TOKEN" \
  | grep -o '"authorizationUrl":"[^"]*"' | cut -d'"' -f4 | xargs open
```

### Test Endpoints

```bash
# FT2 snapshot
curl -s "http://localhost:3000/api/v1/modules/products/ft2?preset=past_30_days" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Operator summary
curl -s "http://localhost:3000/api/v1/modules/products/operator-summary?preset=past_30_days" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# WMS readiness
curl -s "http://localhost:3000/api/v1/modules/products/wms-readiness" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Variant costs (physical only)
curl -s "http://localhost:3000/api/v1/modules/products/variants/costs" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### RLS Pen-test

```bash
docker exec -e PGPASSWORD=sf_app_pass synchroflow_db psql -U sf_app -d synchroflow_db -c "
BEGIN; SET LOCAL app.current_tenant = '999';
SELECT 'variants', COUNT(*) FROM variants
UNION ALL SELECT 'inventory_truth', COUNT(*) FROM inventory_truth;
COMMIT;"
# All counts must be 0
```

### Build Commands

```bash
# Full build
npm run build -w apps/backend
npm run build -w apps/frontend
npm run build -w modules/products

# Type check only
npx tsc --noEmit -w apps/backend
npx tsc --noEmit -w apps/frontend

# DB reset + migrate
npm run db:reset && npm run migrate -w apps/backend

# Find bare db() calls (RLS regression check)
grep -rn "await db(" apps/backend/src/services/products-*/ --include="*.ts" | grep -v dist/
```

### Audit Scan Commands

```bash
# Check for bare db() calls in products services
grep -rn "await db(" apps/backend/src/services/products-*/ --include="*.ts" | grep -v dist/

# Verify withTenant is used in providers
grep -n "withTenant" apps/backend/src/services/products-ft2.provider.ts
grep -n "withTenant" apps/backend/src/services/products-operator/ProductsOperatorSummary.provider.ts

# Check demand bridge
grep -n "getProductsDemandSignals\|Promise.all" apps/backend/src/services/products-operator/ProductsOperatorSummary.provider.ts
```

---

## Appendix — File Reference

### Backend Files

```
apps/backend/src/
├── api/products/
│   ├── products.ft2.routes.ts          # Route registration
│   ├── products.ft2.controller.ts      # GET /ft2
│   ├── products.operator.controller.ts # GET /operator-summary
│   ├── products.wms-readiness.controller.ts # GET /wms-readiness
│   ├── products.cost.controller.ts     # GET+PATCH+POST /variants/costs
│   └── products.service.ts             # Legacy product list (FT1)
└── services/
    ├── products-ft2.provider.ts        # Main FT2 orchestrator
    ├── products-data-integrity.provider.ts
    ├── products-facts/                 # variants facts
    ├── products-operational-facts/     # products + inventory + sales + fulfillment
    ├── products-supply-facts/          # products + inventory + fulfillment
    ├── products-data-freshness-facts/  # freshness per domain
    ├── products-data-integrity-facts/  # SKU coverage, duplication
    ├── products-dependency-facts/      # cross-product dependencies
    ├── products-[intelligence|ftep]/   # computation + exposure layers
    ├── products-operational-[intelligence|ftep]/
    ├── products-supply-[intelligence|ftep]/
    ├── products-data-freshness-[intelligence|ftep]/
    ├── products-data-integrity-[intelligence|ftep]/
    ├── products-dependency-[intelligence|ftep]/
    ├── products-cross-domain-alignment/
    └── products-operator/
        ├── ProductsOperatorFacts.service.ts   # sellability, dead weight, returns
        ├── ProductsOperatorSummary.provider.ts # orchestrates + demand bridge
        ├── ProductsDemandBridge.service.ts    # cross-domain demand signals
        └── ProductsWmsReadinessFacts.service.ts # warehouse operability
```

### Frontend Files

```
apps/frontend/src/
├── pages/ft2-pages/
│   ├── ProductsFT2Page.tsx             # Gate + ModuleTabBar + router
│   ├── ProductsCatalogPage.tsx         # Catalog tab
│   ├── ProductsCostsPage.tsx           # Costs tab
│   └── ProductsWmsReadinessPage.tsx    # WMS Readiness tab
├── pages/products/
│   ├── useProductsFt2Snapshot.ts       # Hook: GET /ft2
│   ├── useProductsFt2Adapter.ts        # Adapter: snapshot → props
│   ├── useProductsOperatorSummary.ts   # Hook: GET /operator-summary
│   └── useProductsWmsReadiness.ts      # Hook: GET /wms-readiness
└── components/
    └── CostEntryPanel.tsx              # Cost entry UI (used in Costs tab)

modules/products/src/ui/
├── pages/
│   ├── ProductsModuleFT2.tsx           # Intelligence tab component
│   └── ProductsPage.tsx                # Legacy FT1 page
├── components/                         # InfoBlock components per zone
└── ModuleEntry.tsx                     # Module descriptor
```

### Migration Files (Products-related)

| Migration | Description |
|---|---|
| `0008_refund_executions_sovereign` | Refund tables + `return_reason_type` + `return_item_condition_type` enums |
| `0027_create_variants_table` | Variants + `barcode` (EAN/UPC) field |
| `0048_create_warehouse_locations` | Warehouse bin hierarchy |
| `0088_create_warehouse_status_tables` | `inventory_unit_status` (stow tracking) |
| `0095_create_purchase_orders` | PO header |
| `0096_create_purchase_order_line_items` | PO lines + `has_global_identifier` |
| `0097_create_receive_jobs` | Receive job lifecycle |
| `0098_create_receive_job_lines` | Per-variant receive tracking |
| `0099_create_receive_exceptions` | Inbound exception types |
| `0100_create_barcode_print_jobs` | Label print queue + `label_type` + `printer_id` |
| `0103_create_problem_center_tasks` | Problem center + `problem_bin_location` |
| `0106_create_printers` | Shop-scoped label printer registry |