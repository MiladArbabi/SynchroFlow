# Warehouse Module — Audit Blueprint

**LaSyncro | Sprint 4 Audit | May 25, 2026**
**Status: Multi-warehouse foundation implementation in progress**

---

## 1. Module Structure

**Routes:**

- `/wms` → Operations (WmsPage.tsx → WmsModuleFT2)
- `/floor-planning` → Floor Planning (FloorPlanningPage.tsx → FloorPlanningModuleFT2)
- `/wms/analytics` → Analytics (WmsAnalyticsPage.tsx)

**Sidenav:** Warehouse accordion, 3 children *(was 4 before June 2026)*. Module gated on `requiredModuleId: 'wms-lite'`. Floor Planning requires tier `scale`. Analytics requires tier `growth`.

> **Departed, June 2026 nav restructure:** `WMS Readiness` (`/wms/readiness`) moved to **Inventory → Data Quality**. This document's own §5 never listed Readiness in its route table to begin with — independent confirmation it was never really this module's content; it covers SKU/catalog data completeness (no product code, no bin assignment, count mismatches), not warehouse-floor operations. The route itself is unchanged; only its sidenav parent and page H1 changed (was "WMS Readiness," now "Data Quality"). §6/§8's discussion of the `PROBLEM` vs `quarantine` vs `returns` zone-type conflation is unaffected by this move — that's floor-physical zoning, correctly still owned here.

**Route registration:** `LifecycleRouteHost.tsx` — `/wms/analytics` registered before `/wms/*` (correct — wildcard would shadow it).

---

## 2. Backend — Confirmed Endpoints

All routes require `Authorization: Bearer $TOKEN`.

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/v1/floor-planning/layout` | ✅ Live | Returns `{zones: [], product_barcodes: []}` |
| GET | `/api/v1/floor-planning/grid` | ✅ Live | Returns `{locations: [17 items]}` |
| GET | `/api/v1/floor-planning/grid/occupancy` | ✅ Live | Returns `{occupancy: []}` |
| GET | `/api/v1/floor-planning/bin/:code/stats` | ✅ Live | picks_7d, last_pick_at, reorder_in_days |
| GET | `/api/v1/floor-planning/bin/:code/log` | ✅ Live | `{location_code, events: []}` |
| GET | `/api/v1/floor-planning/variant/:id/bins` | ✅ Live | Variant focus bins |
| POST | `/api/v1/floor-planning/zones` | ✅ Wired | Zone creation |
| PATCH | `/api/v1/floor-planning/zones/:code` | ✅ Wired | Zone update |
| DELETE | `/api/v1/floor-planning/zones/:code` | ✅ Wired | Zone delete |
| PATCH | `/api/v1/floor-planning/products/:id/barcode` | ✅ Wired | Product barcode update |
| POST | `/api/v1/floor-planning/zones/:code/print` | ✅ Wired | Barcode print |
| GET | `/api/v1/wms/batches` | ✅ Live | `{batches: []}` |
| GET | `/api/v1/wms/stow-tasks` | ✅ Live | `{stow_tasks: []}` |
| GET | `/api/v1/wms/analytics` | ✅ Live | summary, operators, batches, exceptions, days (30 buckets) |
| GET | `/api/v1/operators` | ❌ 404 | Mounted but no root GET handler |

---

## 3. Schema — Warehouse Tables

### Multi-warehouse implementation status — July 11, 2026

Phase 1A and Phase 1B establish the warehouse identity boundary.

- `warehouse_id` is the stable internal UUID.
- `name` is the editable user-facing warehouse name.
- `root_location_code` bridges the existing location hierarchy during migration.
- One default warehouse is bootstrapped for every new or seeded shop.
- Every `warehouse_locations` row now has mandatory `warehouse_id` ownership.
- Parent and child locations are constrained to the same warehouse.
- New child zones inherit warehouse ownership from their parent.
- Root-level zones temporarily use the default warehouse until explicit warehouse context is added to the API.
- The standard `dev:full-reset` path provisions both owner and operator identities.
- Both `full_identity` and `full_data` seed one shop-scoped confirmed FT2 lifecycle snapshot, allowing authenticated warehouse endpoints to be verified immediately after reset.
- Location codes remain unique across the shop during this compatibility phase; warehouse-scoped duplicate codes are not enabled yet.

| Table | Rows after clean seed | Purpose |
|---|---:|---|
| `warehouses` | 1 | Stable warehouse identity, editable name, default status, and legacy root mapping |
| `warehouse_locations` | 17 | Physical hierarchy beneath the default warehouse root |
| `shop_wms_settings` | 1 | Current shop-wide WMS configuration; warehouse scoping pending |
| `pick_batches` | 0 | Active pick batches; warehouse scoping pending |
| `pick_batch_orders` | 0 | Orders per batch |
| `stow_tasks` | 0 | Post-receive stow jobs; warehouse scoping pending |
| `operator_availability` | 0 | Operator shift availability |
| `operator_task_log` | 0 | Per-operator task activity |

The generated root code remains an internal compatibility key. Users will manage and select warehouses by `warehouse_id` and editable `name`, not by changing `WH-{shopId}-ROOT`.

---

## 4. Frontend — File Map

| File | Role |
|---|---|
| `apps/frontend/src/pages/ft2-pages/WmsPage.tsx` | Gate page — all pick/pack/ship/stow/receive HTTP callbacks wired |
| `apps/frontend/src/pages/ft2-pages/FloorPlanningPage.tsx` | Gate page — layout, grid, occupancy hooks + zone CRUD + barcode callbacks |
| `apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage.tsx` | Analytics page — MetricTile, exception table, operator velocity |
| `apps/frontend/src/pages/floor-planning/useFloorPlanning.ts` | Fetches `/floor-planning/layout` |
| `apps/frontend/src/pages/floor-planning/useWarehouseGrid.ts` | Fetches `/floor-planning/grid` + `/grid/occupancy` |
| `apps/frontend/src/pages/floor-planning/useBinLog.ts` | Fetches `/floor-planning/bin/:code/log` |
| `apps/frontend/src/pages/floor-planning/useBinStats.ts` | Fetches `/floor-planning/bin/:code/stats` |
| `apps/frontend/src/pages/floor-planning/useZoneManagement.ts` | Zone CRUD + barcode mutations |
| `apps/frontend/src/pages/wms/useWms.ts` | Fetches batches + stow tasks |
| `apps/frontend/src/pages/wms/usePickAnalytics.ts` | Fetches `/wms/analytics` |
| `apps/frontend/src/pages/wms/useWmsOperators.ts` | Fetches operators — likely broken (404) |
| `modules/wms/src/ui/pages/WmsModuleFT2.tsx` | Main WMS module — 613 lines |
| `modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx` | Floor planning module — 1,254 lines |
| `modules/floor-planning/src/ui/components/IsometricCanvas.tsx` | 3D isometric renderer — 429 lines |
| `modules/floor-planning/src/ui/components/CanvasEditor.tsx` | 2D canvas drag-drop editor |
| `modules/floor-planning/src/ui/components/BinLogDrawer.tsx` | Per-bin activity drawer |
| `modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx` | Barcode print preview |
| `modules/shared/src/ui/WarehouseGrid/` | Shared grid primitives (AisleColumn, BinCell) |

---

## 5. Visual Audit — Route by Route

| Route | State | Notes |
|---|---|---|
| `/wms` | ✅ Renders | Empty state correct. Tab bar correct. Online badge present. |
| `/wms/analytics` | ✅ Renders | 4 metric tiles, time toggle, empty state. All zeros on clean seed. |
| `/floor-planning` (Map) | ✅ Renders | Full isometric 3D, 3 aisles, PROBLEM bin visible, overlay panel live |
| `/floor-planning?tab=setup` (List) | ✅ Renders | Zone hierarchy list, barcodes displayed, edit/delete controls present |
| `/floor-planning?tab=setup&view=canvas` (2D) | ✅ Renders | Drag-drop canvas, zone palette, layout templates |
| `/floor-planning?tab=setup&view=canvas` (3D) | ✅ Renders | Isometric view in setup context, 3D toggle works |
| `/floor-planning?tab=barcodes` | ⚠️ Not verified | Screenshot not captured |
| All routes (dark mode) | ⚠️ Not verified | Light mode only |

---

## 6. Known Issues

| ID | Priority | Description |
|---|---|---|
| WH-01 | P2 | Serif headers on Floor Planning ("Floor planning today. *Here's how the racks are running.*" and "Build your warehouse. *One zone at a time.*") — violates no-serif rule for operational modules |
| WH-02 | P2 | `fontWeight: 700` throughout WmsModuleFT2 (lines 192, 289, 301, 314, 327, 359, 379, 391, 538) and FloorPlanningModuleFT2 — DS max is 500 |
| WH-03 | P2 | `border: '1px solid'` in FloorPlanningModuleFT2 (lines 427, 459, 486) — must be `0.5px solid` |
| WH-04 | P2 | `color: '#fff'` hardcoded hex in FloorPlanningModuleFT2 line 277 — must use CSS variable |
| WH-05 | P1 | PROBLEM and Quarantine are conflated — `PROBLEM` bin has `zone_type: quarantine` but these are distinct workflows: PROBLEM = product defects (Problem Center), Quarantine = physical hold zone (undesigned), Returns = order-side (Returns module). Schema, zone palette, and settings all need separation before Problem Center can work correctly. |
| WH-06 | P2 | `GET /api/v1/operators` returns 404 — router mounted but no root GET handler; `useWmsOperators` hook likely fails silently |
| WH-07 | P3 | Dark mode not verified — screenshot pass needed |
| WH-08 | P3 | Barcodes sub-tab (`/floor-planning?tab=barcodes`) not visually confirmed |

---

## 7. Workshop Verdict

**Keep everything. No cuts.**

Every sub-module serves the target user (1–20 warehouse staff, own warehouse, high SKU complexity) directly and non-duplicatively:

- Operations: pick/pack/ship/stow execution surface — core daily workflow
- Floor Planning: visual warehouse layout + barcode management — prerequisite for mobile scanning accuracy
- Analytics: pick accuracy + exception rate + operator velocity — operational intelligence layer

**Assessment:** Production-ready infrastructure. Needs DS cleanup (weight, borders, serif headers, one hardcoded hex) before sprint 4 build work begins. The isometric 3D renderer and 2D canvas editor are genuinely differentiated — no SMB tool at this price point offers this.

**Next sprint priority for this module:** DS violations first (WH-01 through WH-04), then WH-05 (quarantine link) and WH-06 (operators 404).

## 8. Design Clarification — PROBLEM vs Quarantine vs Returns

These three concepts are currently conflated in the schema and must be treated as fully separate workflows:

### PROBLEM (product-side defects)

- Physical bin where items land due to product-level failures
- Triggers: damaged packaging, missing/unreadable barcode, quality failure, mis-pick residue
- Actions available: Resolve, Discard, Donate
- Owner: Problem Center module (`/problem-center`)
- Zone type needed: `problem` (does not exist yet — currently mis-typed as `quarantine`)
- Setting: `shop_wms_settings.problem_bin_location` should point to this bin
- Status: bin exists as `PROBLEM`, but zone_type is wrong and setting is unlinked

### Quarantine (containment for examination)

- Physical zone for items under hold — regulatory, supplier dispute, pre-acceptance inspection
- Not triggered by defects — triggered by operational decision to hold
- Actions: Release to stock, Escalate, Reject back to supplier
- Owner: TBD — not yet designed
- Zone type needed: `quarantine` (currently exists but conflated with PROBLEM)
- Status: concept exists in zone palette but workflow is entirely undesigned

### Returns (order-side problems)

- Items returned by customers against a specific order
- Populated from the Returns sub-tab in Orders module
- Actions: Restock, Discard, Donate (per returned item decision)
- Owner: Returns module (`/returns`) — already built
- Zone type: `returns` exists in floor planning palette
- Status: returns flow complete, physical returns bin in floor plan is cosmetic only (no routing logic)

### Required schema correction

`warehouse_locations.zone_type` enum currently has `quarantine` used for both PROBLEM and Quarantine bins.
Needs a new `problem` enum value, and the `PROBLEM` bin's `zone_type` must be migrated from `quarantine` → `problem`.
This is a prerequisite for Problem Center to correctly route items to the right bin.