# Inventory Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Audited — Production-ready, DS violations, variance tracking gap**

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
| INV-06 | P3 | Test/sample variants (test, test1, test2, testXL, testXXL) appear in Costs tab — seed data noise, not a bug |
| INV-07 | P3 | Catalog `image_url: null` for Canvas Tote, Linen Shirt, Wool Sweater — no images synced from Shopify for these products |
| INV-08 | P3 | `problem_bin_location` in `problem_center_tasks` schema references a bin that has no workflow design (see WH-05) |

---

## 8. Workshop Verdict

**Keep all five sub-modules. No cuts.**

The Intelligence tab is the strongest intelligence surface in the entire app — it directly answers "what's wrong with my inventory right now and why" in a single scroll. The Catalog's missing-SKU section and the WMS Readiness pickability signals are operationally critical for the target user (own warehouse, mobile scanning, high SKU complexity).

**What needs work before production:**

1. DS cleanup — same hex/fontWeight/border pattern as Demand and WMS (INV-01 through INV-03)
2. Variance tracking gap — `variance_count` always null (INV-04)
3. Gift card filter in Catalog (INV-05)

**What is production-ready as-is:**

- Intelligence tab — signal quality is excellent
- Costs — inline editing + CSV bulk upload complete
- WMS Readiness — correct and useful
- Problem Center — filter system built, empty state correct

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
