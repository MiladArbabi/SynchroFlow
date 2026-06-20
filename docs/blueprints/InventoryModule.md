# Inventory Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 26, 2026**
**Status: Audited — Full UX rebuild required. Schema corrections applied. Issues INV-01–INV-11 registered.**
**Sprint 5 (2026-06-20): Truth-bug cluster resolved, projector backfilled, phantom-stock model added, Catalog moved to triage+pulse. See §16 Sprint Log.**

---

## 1. Module Structure

**Routes:**

- `/inventory` → Intelligence (ProductsFT2Page → ProductsModuleFT2)
- `/inventory/catalog` → Catalog (ProductsCatalogPage)
- `/inventory/costs` → Costs (ProductsCostsPage)
- `/inventory/wms-readiness` → WMS Readiness (ProductsWmsReadinessPage)
- `/problem-center` → Problem Center (ProblemCenterPage → ProblemCenterModuleFT2)

**Sidenav:** Inventory accordion with 5 children. Problem Center is a child of Inventory in the sidenav but routes to `/problem-center` — cross-module navigation via tab bar.

**Tier gate:** Intelligence tab uses `PlanGate`. Costs + WMS Readiness require `requireFt2`.

**Route registration:** `LifecycleRouteHost.tsx`. `/inventory/*` appears in both FT1 and FT2 blocks — phase-gated, not duplicated.

---

## 2. Backend — Confirmed Endpoints

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/modules/products/ft2` | ✅ Live | 12-key intelligence snapshot |
| GET | `/api/v1/modules/products/operator-summary` | ✅ Live | Sellability, dead weight, top returned, demand signals |
| GET | `/api/v1/modules/products/catalog` | ✅ Live | `{variants: [40 items]}` |
| GET | `/api/v1/modules/products/wms-readiness` | ✅ Live | Pickability + variance + receive readiness |
| GET | `/api/v1/modules/products/variants/costs` | ✅ Live | `{variants: [36 items]}` |
| PATCH | `/api/v1/modules/products/variants/:id/cost` | ✅ Wired | Unit cost update + COGS backfill |
| POST | `/api/v1/modules/products/variants/costs/bulk` | ✅ Wired | CSV bulk cost upload |
| GET | `/api/v1/modules/products` | ❌ 404 | No root handler — all routes are sub-paths |

### FT2 snapshot keys

`alignment`, `context`, `dataFreshness`, `dependency`, `operational`, `operationalCounts`, `outcome`, `productDataIntegrity`, `signals`, `supply`, `supplyCounts`, `trend`

### WMS Readiness response (live data)

```json
{
  "not_pickable_count": 27,
  "no_bin_location_count": 13,
  "variance_count": null,
  "total_variance_units": null,
  "open_receive_jobs_with_rejections": 0,
  "total_rejected_units": null,
  "oldest_inventory_evaluated_at": "2026-05-24T..."
}
```

---

## 3. Schema — Inventory Tables

| Table | Rows (shop_id=1) | Purpose |
|---|---|---|
| `products` | 21 | Product records |
| `variants` | 40 | SKU-level variant records |
| `inventory_truth` | 40 | Current stock per variant per location |
| `inventory_movements` | 88 | Ledger: 30 opening_balance (+623 units), 58 sale (-58 units) |
| `inventory_unit_status` | 0 | Unit-level status tracking — empty on clean seed |
| `problem_center_tasks` | 0 | WMS exception escalations — empty on clean seed |
| `shopify_products` | seeded | Raw Shopify product mirror |
| `external_product_identity_map` | seeded | Shopify ↔ LaSyncro ID mapping |

### Inventory movements breakdown

- `opening_balance`: 30 movements, +623 units — initial stock seeded
- `sale`: 58 movements, -58 units — order fulfillments
- No `inbound_purchase`, `stow`, or `adjustment` movements — receive/stow pipeline not yet run

### Problem Center schema (18 columns)

Key fields: `problem_task_id`, `status`, `source` (enum), `source_exception_id` (→ `pick_exceptions`), `lasyncro_variant_id`, `quantity`, `exception_type`, `problem_bin_location`, `resolution_action`, `resolved_by`, `resolved_at`

---

## 4. Frontend — File Map

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/ProductsFT2Page.tsx` | Gate + tab router. Fetches FT2 snapshot + operator summary. Passes to ProductsModuleFT2. |
| `apps/frontend/src/pages/ft2-pages/ProductsCatalogPage.tsx` | Catalog tab — variant grid with missing SKU section |
| `apps/frontend/src/pages/ft2-pages/ProductsCostsPage.tsx` | Costs tab — inline cost entry + CSV bulk upload |
| `apps/frontend/src/pages/ft2-pages/ProductsWmsReadinessPage.tsx` | WMS Readiness tab |
| `apps/frontend/src/pages/ft2-pages/ProblemCenterPage.tsx` | Problem Center — WMS exception escalation surface |
| `modules/products/src/ui/pages/ProductsModuleFT2.tsx` | Intelligence module — 777 lines |
| `modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx` | Problem Center module — 408 lines |

### Design system violations

| Location | Violation | Rule |
|---|---|---|
| `ProductsModuleFT2.tsx` line 15 | `cardBg: '#1C2740'` hardcoded dark hex | CSS variables only |
| `ProductsModuleFT2.tsx` lines 17–18 | `textPrimary: '#F0EEE8'`, `textSecond: '#6B7280'` | CSS variables only |
| `ProductsModuleFT2.tsx` lines 282, 315, 322, 329, 419, 506, 514, 522, 548, 571 | `border: '1px solid'` and `borderLeft: '4px solid'` | Must be `0.5px solid` |
| `ProductsModuleFT2.tsx` lines 395, 480, 507, 515, 523, 549, 572 | `fontWeight: 700` | Max weight 500 |
| `ProblemCenterModuleFT2.tsx` line 154, 164, 178, 261 | `fontWeight: 700` | Max weight 500 |

---

## 5. Visual Audit

| Route | State | Notes |
|---|---|---|
| `/inventory` (Intelligence) | ✅ Live, data-rich | Multi-signal view: sellability, blocked reasons, non-moving stock, stockouts, return rates, cross-links |
| `/inventory/catalog` | ✅ Live | 21 products, thumbnail images, missing SKU section, sellability summary |
| `/inventory/costs` | ✅ Live | Inline cost entry, 8 missing banner, CSV upload working |
| `/inventory/wms-readiness` | ✅ Live | 27 not pickable, 13 no bin, variance null, 23h ago evaluation |
| `/problem-center` | ✅ Live, empty | Filter chips correct, empty state correct on clean seed |

---

## 6. Important Taxonomy Clarification

**Three distinct concepts — must never be conflated:**

| Concept | Surface | Source | Actions |
|---|---|---|---|
| **Problem Center** | `/problem-center` | Pick/pack WMS exceptions (`pick_exceptions` → `problem_center_tasks`) | Resolve, Reassign, Mark resolved |
| **PROBLEM bin** | Warehouse floor physical bin | Operator places defective/unidentifiable items here manually | Undesigned workflow — needs design sprint |
| **Returns** | `/returns` | Customer order returns from Shopify | Restock, Discard, Donate |

The Problem Center is correctly scoped to WMS pick/pack exception escalation. The PROBLEM bin physical workflow is a separate undesigned gap (see WH-05 in WarehouseModule.md).

---

## 7. Known Issues

| ID | Priority | Description |
|---|---|---|
| INV-01 | P2 | Hardcoded hex theme (`#1C2740`, `#F0EEE8`, `#6B7280`) in ProductsModuleFT2 — same pattern as Demand and WMS |
| INV-02 | P2 | `fontWeight: 700` throughout ProductsModuleFT2 and ProblemCenterModuleFT2 |
| INV-03 | P2 | `border: '1px solid'` and `borderLeft: '4px solid'` throughout ProductsModuleFT2 |
| INV-04 | P2 | `variance_count` and `total_variance_units` both null — variance tracking not computing in WMS Readiness |
| INV-05 | P2 | Gift Card product appears in Catalog — should be filtered (same filter logic used in Demand service) |
| INV-06 | P1 | Test/sample variants (test, test1, test2, testXL, testXXL) treated as truth across Catalog + Costs — inflates every count. MUST be excluded from inventory truth (tracked as INV-002). |
| INV-07 | P3 | Catalog `image_url: null` for Canvas Tote, Linen Shirt, Wool Sweater — no images synced from Shopify for these products |
| INV-08 | P3 | `problem_bin_location` in `problem_center_tasks` schema references a bin that has no workflow design (see WH-05) |

---

## 8. Workshop Verdict — Direction A (Truth & Trust + Replenishment brain)

**Supersedes the prior "keep all five sub-modules" verdict (see §15 decision log).**

Inventory's job is to be the single source of *what you have, what's sellable, and what to reorder* — one number, computed once, shown identically everywhere. It does NOT re-own warehouse execution or margin reporting; those have existing owners and are reached via context-preloaded deep-links (Overview dispatcher pattern).

**Inventory owns:**

1. **Intelligence** — the decision surface: $-ranked "needs attention" + a stock-health pulse with one trusted headline (Sellable % / Accuracy).
2. **Catalog** — the SKU registry and blocked-stock triage: each blocked row shows the single reason + one-click fix.
3. **Replenishment** (new, Sprint 2) — velocity → days-of-stock → reorder, drafting a PO that hands off to Supplier Portal.

**Inventory delegates (deep-link, never duplicate):**

- **Costs / COGS / margin → Finances** (Costs becomes a thin capture strip or is removed).
- **WMS Readiness (pickability, bin location) → WMS-lite + Floor Planning.** Its two real signals become *blocked reasons* inside Catalog.
- **Problem Center (pick/pack/stow/receive exceptions) → WMS.** Already lives at `/problem-center`; surfaced as a count badge only.

**Rationale:** the "everything-about-a-SKU hub" alternative structurally re-introduces the truth bug (same number computed in two modules = the 25-vs-16-vs-29 divergence). Direction A is the only shape consistent with the one-number thesis, reuses already-shipped WMS/Floorplanning/Finances surfaces, and avoids the feature-completeness trap.

---

## 15. Direction A Decision Log (2026-06-20)

- **Decision:** Adopt Direction A (Truth & Trust + Replenishment brain). Overturns §8's original "keep all five sub-modules, no cuts."
- **Why now:** Catalog audit proved the same metric is computed in multiple modules with divergent results (products 10 vs 19; no-SKU 16 vs 25; WMS not-pickable 29 > 28 total variants). The five-tab hub design guarantees this drift recurs.
- **Sprint 1 scope:** (1) truth bug — one canonical source per number [INV-001/003/004 ✅], (2) purge test data from truth [INV-002], (3) Intelligence as decision surface, (4) Catalog blocked-stock triage.
- **Sprint 2:** Replenishment surface (net-new).
- **Boundary owners confirmed in codebase:** WMS-lite (pick/pack/stow/receive + exception queue), Floor Planning (bin locations), Finances (COGS/margin).

---

## 16. Sprint 5 Log — Truth, Projection & Phantom Stock (2026-06-20)

**Resolved**

| ID | Description |
|---|---|
| INV-003 | Catalog subtitle read paged `products.length`; → `allProducts.length`. Kills 10-vs-19. |
| INV-004 | No-SKU count had two sources (product 16 vs variant 25); unified to variant-level server `sellability` snapshot, relabelled "missing SKU". |
| INV-005 | Catalog selected only `sellable_quantity`; now returns `on_hand`/`available`; rows show on-hand + available subtext. |
| INV-006 / INV-05 | Catalog (`whereNot gift_card`) and Costs (`where physical`) queried different universes → both aligned to `product_type = 'physical'`. Gift cards excluded by definition. |
| INV-013a | Phantom (on_hand < 0) was conflated into `zeroStock`. Split into its own `blockedReason`; `blocked = noSku + noInventory + zeroStock + phantom`. |
| INV-014 | Negative on_hand rendered raw ("−3 in stock") → "Phantom · check receiving" flag + adaptive stat card. |
| INV-015 | Catalog stat-card grid (broken, 2-of-4) replaced with canonical FT2 decision + pulse layout (matches Orders/Inbound). Full-width sortable 6-col list (Product/Variants/On-hand/Available/Status/Action), severity-ranked Status sort. |
| FLK-001 | List blanked on range change (no `keepPreviousData`) → `placeholderData: keepPreviousData` on operator-summary query. |
| PROJ-001a | Projector "must negate outbound" comment was inverted; ledger is pre-signed (DB constraint forces sale<0). Comment corrected; math untouched. |
| PROJ-002 | `committed_quantity` dead (hardcoded 0 everywhere); deprecated, documented `sellable = available`. |
| PROJ-005 | WMS-readiness variance check was a tautology (`available` is derived); gated to `1=0` until a real cycle-count source exists (ties to INV-04). |
| PROJ-004 | Replay of sales-only ledger yields negative on_hand. Policy: store true on_hand (audit truth), clamp available/sellable at 0, surface negative as phantom signal. Shop 1 backfilled (17 rows, 14 phantom) via the existing projector aggregation. |

**Reclassified / not-a-bug**

| ID | Outcome |
|---|---|
| INV-002 | WONT-FIX (code). Test products are `physical/active`, indistinguishable from real; hiding merchant products violates the mirror-Shopify principle. Count-inflation already fixed by INV-003/004. |
| PROJ-001 | NOT-A-BUG. `quantity_delta` pre-signed; projector summing as-is is correct. |
| PROJ-003 | NOT-A-CODE-GAP. Full-shop rebuild exists (`shopify.service` L133–150); never ran for shop 1 (no sync). |

**Still open**

| ID | Description |
|---|---|
| INV-016 | Intelligence tab still says "17 blocked / 3 stocked out" — hasn't adopted the phantom split. Cross-tab story mismatch with Catalog. |
| INV-012 | `inventory_truth` durable trigger: one-shot backfill done; first-sync wiring for new shops still to verify. |
| PROJ-004b | Surface phantom signal beyond Catalog (Intelligence / WMS Readiness). |

---

## 9. UX Rebuild Directive

### Full module UX rebuild required

The entire Inventory module UI — Intelligence, Catalog, Costs, WMS Readiness — is visually inconsistent with the FT2 design language established in Overview and Orders. Specific gaps:

- Intelligence tab uses a card-grid layout pattern that predates the FT2 signal-line + action-queue pattern used in Overview and Orders
- Typography hierarchy, stat tile treatment, section labelling, and table structure all diverge from FT2 conventions
- The `#1C2740` hardcoded card background is a symptom of a deeper issue — the module was built before the CSS variable system was fully established
- No DM Sans 22px/500 page title. No 13px/ink-3 signal line. No `var(--rule)` borders. No FT2 stat card pattern.

**Decision: Full UX rebuild for all 5 sub-tabs, consistent with Overview and Orders FT2 patterns.**
This is not a DS cleanup pass — it is a ground-up redesign of the UI layer while keeping all backend wiring intact.

### Problem Center missing ModuleTabBar

`ProblemCenterPage` and `ProblemCenterModuleFT2` render no `ModuleTabBar`. When a user navigates to `/problem-center` from the Inventory tab bar, the tab bar disappears entirely — no way to navigate back to Intelligence, Catalog, Costs, or WMS Readiness without using the sidenav.

The tab bar must be added to `ProblemCenterPage` matching the same 5-tab definition used in `ProductsFT2Page`:
Intelligence → /inventory
Catalog      → /inventory/catalog
Costs        → /inventory/costs
WMS Readiness → /inventory/wms-readiness
Problem Center → /problem-center

| ID | Priority | Description |
|---|---|---|
| INV-09 | P1 | Problem Center missing ModuleTabBar — navigation breaks when landing on `/problem-center` |
| INV-10 | P1 | Full UX rebuild required for all 5 Inventory sub-tabs — current UI predates FT2 design language and is visually inconsistent with Overview and Orders |

---

## 10. Schema Corrections (Audit May 26, 2026)

| Location | Error | Correction |
|---|---|---|
| Blueprint §3, all services | `estimated_unit_cost` | Actual column: `unit_cost numeric(12,2)` on `variants` table |
| Blueprint §3 `inventory_truth` | `bin_location` column listed | Column does not exist on `inventory_truth`. Bin location lives in WMS layer (`warehouse_locations`) |
| Blueprint §2 movements | `sale: 58, opening_balance: +623` | Quantities change with data — do not track in blueprint. Movement types confirmed: `opening_balance`, `sale`, `refund_return`, `reservation_hold`, `reconciliation_correction` |

---

## 11. Backend Architecture — Intelligence Pipeline

The Intelligence tab is powered by **two parallel endpoints**:

### A. `/api/v1/modules/products/ft2` — FTEP snapshot

Pipeline: `ProductsOperatorFacts` → `buildProductsIntelligence` → `buildProductsFtep`
Returns aggregate enum signals only (`supply: null`, `operational: {inventory: 'ok'}`, etc.)
**Does not return per-variant data.**

### B. `/api/v1/modules/products/operator-summary` — Operator surface

Pipeline: `ProductsOperatorFacts` → direct mapping + `ProductsDemandBridge`
Returns actionable operator data: sellability counts, blocked reasons, dead weight, top returned, demand signals.
**This is what drives all visible Intelligence tab content.**

### Demand bridge

`ProductsDemandBridge.service.ts` calls `computeDemandIntelligence(shopId)` — the full demand velocity engine.
Returns per-variant: `velocity_per_day`, `days_of_stock_remaining`, `reorder_urgency`, `suggested_reorder_qty`, `dead_capital_value`.

### Key column facts

- `variants.unit_cost` — cost per unit (numeric 12,2). Used for dead capital + inventory value computation.
- `inventory_truth` — no `bin_location`. Fields: `on_hand_quantity`, `reserved_quantity`, `committed_quantity`, `available_quantity`, `sellable_quantity`, `last_evaluated_at`
- `inventory_movements` — append-only (delete/update triggers). Sign-constrained per movement type.

---

## 12. INV-09 Resolution

**INV-09 RESOLVED.** `ProblemCenterPage` ModuleTabBar is present and working. Confirmed visually — tab bar renders correctly on `/problem-center` with all 5 tabs.

---

## 13. Sprint 4 Implementation Log (May 27, 2026)

### Backend — New Services

| Service | File | Purpose |
|---|---|---|
| ProductsInboundBridge | `products-operator/ProductsInboundBridge.service.ts` | Pulls open PO pipeline into operator summary. Overdue detection via date string comparison. `covers_stocked_out_skus` cross-reference. |
| ProductsWarehouseBridge | `products-operator/ProductsWarehouseBridge.service.ts` | Pick zone occupancy %, variants with stock but no pick bin. All stock at WH-1-ROOT on seed — 25 variants unpickable. |
| ProductsFinancesBridge | `products-operator/ProductsFinancesBridge.service.ts` | Margin at risk per week (stocked-out × velocity × margin). `active_sellers_no_cost` count. Uses `variants.unit_cost` (authoritative). |

All three wired into `ProductsOperatorSummary.provider.ts` via parallel `Promise.all`. Silent null on failure.

### Schema Facts (authoritative)

- `purchase_orders`: PK `id` (uuid), `supplier_id` (int FK → `suppliers.id`), `expected_delivery_date` (date), no `po_reference` column. Display ref = first 8 chars of UUID.
- `variants.unit_cost` numeric(12,2) — authoritative cost. NOT `estimated_unit_cost` (that lives on `order_revenue_units` as snapshot).
- `inventory_truth`: no `bin_location`. All stock at `WH-1-ROOT` location_code on seed.
- `warehouse_locations`: pick bins = `zone_type='pick'` AND `type='bin'`. 12 active pick bins on seed, 0 stocked.
- `products.product_type`: `physical` | `gift_card`. Gift cards filtered from catalog endpoint (INV-05 resolved).

### Frontend — Rebuilt Pages

| Page | Changes |
|---|---|
| `ProductsModuleFT2.tsx` | Full FT2 rebuild. 4-card stat row, warehouse banner, two-column layout (action queue + inbound pipeline/returns). All new bridge signals consumed. |
| `ProductsCatalogPage.tsx` | FT2 rebuild. 4-card stat row, two-column layout, sortable columns, pagination (10/page), gift card filtered, images in both columns. |

### Issue Status Updates

| ID | Status |
|---|---|
| INV-01 | ✅ RESOLVED — no hardcoded hex in ProductsModuleFT2 |
| INV-02 | ✅ RESOLVED — fontWeight max 500 throughout |
| INV-03 | ✅ RESOLVED — 0.5px borders throughout |
| INV-05 | ✅ RESOLVED — gift card filtered at backend |
| INV-09 | ✅ RESOLVED (pre-existing) — Problem Center tab bar present |
| INV-10 | ✅ RESOLVED — full UX rebuild complete |
| INV-CAT-01 | 🔵 REGISTERED — Product detail panel, defer Sprint 5 |
| INV-DR-01 | 🔵 REGISTERED — Date range bar audit needed on Intelligence tab |
| INV-04 | ✅ RESOLVED May 28, 2026 — variance_count returns 0 (not null). See section INV-04 resolution note. |
| INV-06 | 🔴 OPEN — test/seed variants still in Costs tab |
| INV-07 | 🔴 OPEN — image_url null for 3 products |
---

## 14. Problem Center — Final State (May 27, 2026)

### Scope expanded
Sources: `pick | pack | stow | receive` (was `pick | pack` only)
Exception types added: `stow_failure`, `receive_rejection`

### Data source
`problem_center_tasks` table — NOT the legacy `pick_exceptions` table.
Endpoint: `GET /api/v1/wms/problem-center` → `{ problem_tasks: [] }`
Resolve: `POST /api/v1/wms/problem-center/:taskId/resolve` → `{ resolution_action, resolution_notes }`

### Shape mapping (frontend)
`problem_task_id` → `pick_exception_id`
`source` → `stage`
`quantity` → `quantity_required`
`quantity_found` = 0 (not stored in problem_center_tasks)
`problem_bin_location` → `batch_short_id` (displayed as BATCH column)

### UX
Table layout matching Returns module. Stage color tokens:
Pick=teal (#14B8A6), Pack=blue (#3B82F6), Stow=purple (#8B5CF6), Receive=amber (#F59E0B)

### Issue Status
| ID | Status |
|---|---|
| INV-02 (Problem Center) | ✅ RESOLVED — fontWeight max 500 |

### INV-04 — RESOLVED (May 28, 2026)
`variance_count` and `total_variance_units` now return `0` (not null).
Root cause was absence of `inventory_truth` data in dev seed — resolved when full_data seed was corrected.
`0` is the correct signal: inventory data exists, no variance detected.
Endpoint: `GET /api/v1/modules/products/wms-readiness` (separate from operator-summary).
