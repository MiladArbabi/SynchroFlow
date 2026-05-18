# WarehouseGrid — Blueprint & Integration Spec

**Last updated: May 2026**
**Status: Phase 1 complete — Phase 2 largely complete — Phase 3 interface locked**

---

## Location

```
modules/shared/src/ui/WarehouseGrid/
  index.tsx                 ← public component, exported from @lasyncro/shared/ui
  WarehouseGrid.types.ts    ← all interfaces, exported from @lasyncro/shared/ui
  BinCell.tsx               ← single bin renderer (4 states + live pulse)
  AisleColumn.tsx           ← vertical aisle grouping
  PickPathOverlay.tsx        ← Phase 2 stub (returns null)
```

---

## Import

```tsx
import { WarehouseGrid } from '@lasyncro/shared/ui';
import type { WarehouseGridProps, WarehouseLocation, BinOccupancy } from '@lasyncro/shared/ui';
```

---

## Props Contract (renderer-agnostic — stable through Phase 3)

```typescript
interface WarehouseGridProps {
  locations: WarehouseLocation[];
  occupancy?: Record<string, BinOccupancy>;       // keyed by location_code
  highlightedBins?: string[];                      // accent border
  pickPath?: string[];                             // ordered pick route (Phase 2)
  focusedBins?: string[];                          // focus mode: bright; rest dimmed
  liveActivity?: Record<string, LiveBinState>;     // keyed by location_code
  onBinSelect?: (locationCode: string) => void;
  mode?: 'map' | 'pick' | 'heatmap' | 'focus';
  variant?: 'full' | 'mini' | 'inline';
  renderer?: 'svg' | 'three';                      // 'three' = Phase 3
}
```

---

## Grid Derivation

- Grid renders **bin-type locations only** — warehouse/lane/shelf are structural, not rendered as cells
- Aisle label = segment before first `-` in `location_code` (e.g. `"A"` from `"A-1"`)
- Bins sorted `ASC` within each aisle — matches `wms.controller.ts` pick route sort
- Aisles sorted alphabetically left→right

---

## Variant Scale

| variant | Use case | Toolbar | Right panel | Interaction |
|---|---|---|---|---|
| `full` | Floor Planning, WMS overview | yes | yes | click → panel |
| `mini` | Order detail, Batch detail, Demand | no | no | click → tooltip |
| `inline` | Product detail, SKU Gaps embed | no | no | read-only, expand on tap |

---

## Mode Behaviour

| mode | Fill logic | Border logic | Use case |
|---|---|---|---|
| `map` | green alpha if stock, var(--bg-3) if empty | accent if selected/highlighted | Floor Planning |
| `heatmap` | 3-band green→amber→red by qty | accent if selected | WMS overview, Demand |
| `focus` | bright if in focusedBins, dimmed otherwise | accent if focused | Product detail, PO receiving |
| `pick` | same as map | accent on highlightedBins | WMS batch detail |

---

## Backend Endpoints

| Endpoint | Controller | Purpose |
|---|---|---|
| `GET /api/v1/floor-planning/grid` | `httpGetGrid` | All warehouse_locations for current shop |
| `GET /api/v1/floor-planning/grid/occupancy` | `httpGetBinOccupancy` | inventory_truth per bin, grouped by location_code |

Both require: `authenticateToken` + `requireFt2` + `requireAction('floor-planning:read')`

---

## Frontend Hooks

```
apps/frontend/src/pages/floor-planning/useWarehouseGrid.ts
  useWarehouseGrid()          — grid layout, staleTime 5min
  useWarehouseGridOccupancy() — per-bin stock, polls every 60s
```

---

## Current Consumer Map

| Module | variant | mode | Extra props |
|---|---|---|---|
| Floor Planning `/floor-planning` | `full` | `map` | `onBinSelect` → right panel |
| WMS Batch Detail (Phase 2) | `mini` | `pick` | `pickPath`, `highlightedBins` |
| Demand `/demand` (Phase 2) | `mini` | `heatmap` | `occupancy` |
| Product Detail (Phase 2) | `inline` | `focus` | `focusedBins` |
| PO Receiving (Phase 2) | `mini` | `focus` | `focusedBins` |
| WMS Overview (Phase 2) | `full` | `heatmap` | `liveActivity`, `occupancy` |

---

## Phase 1 — Shipped (May 2026)

- ✅ `WarehouseGrid` component — `full/mini/inline` variants, `map/heatmap/focus/pick` modes
- ✅ `GET /api/v1/floor-planning/grid` — bin layout endpoint
- ✅ `GET /api/v1/floor-planning/grid/occupancy` — per-bin stock endpoint
- ✅ Floor Planning page — Map / Setup / Barcodes tabs
- ✅ Per-tab serif headers matching Overview/Orders pattern
- ✅ Map tab — toolbar, legend bar, dynamic subline, bin detail panel
- ✅ Barcodes tab — Locations + Products sub-tabs, stat row, filter pills, dynamic subline
- ✅ Tab count badges (bin count / zone count / barcoded count)
- ✅ All tokens aligned to design system (CSS vars + `theme.palette.*`)

---

## Phase 2 — Shipped (May 2026)

- [x] Wire `mini/pick` into WMS batch detail — show pick map, expand on demand, highlight pick locations
- [x] Wire `mini/heatmap` into Demand page — warehouse occupancy snapshot above variant list
- [x] Alert deep-link — stockout alerts → `/floor-planning?variantId=<uuid>` → focused grid
- [x] `GET /api/v1/floor-planning/bin/:locationCode/stats` — picks 7D, last pick, reorder signal
- [x] `GET /api/v1/floor-planning/variant/:variantId/bins` — bin locations for a variant
- [x] Bin detail panel — occupancy %, progress bar, contents, picks 7D, last pick, reorder in
- [x] Bin Activity Log drawer — scoped slide-in, 30s polling, merged inventory_movements + pick_scan_log
- [x] Left filter rail — 4 overlays (occupancy/stockout/empty/none), zone filters
- [x] Map tab toolbar — bin count, overlay label, zoom/refresh controls
- [x] Legend bar — EMPTY / BELOW 55% / 55-85% / HOT 85%+

## Phase 2 Engineer Checklist — Remaining

- [x] `PickPathOverlay.tsx` — SVG polyline with numbered stops, dashed accent line, mathematical coordinate derivation
- [ ] `GET /api/v1/wms/live-activity` — feeds `liveActivity` prop from `inventory_unit_status` (no writers yet)
- [ ] Wire `inline/focus` into Product detail page (page doesn't exist yet — needs product detail sprint)
- [ ] Surfaced Today panel — left rail live intelligence (see GitHub issue #958)
- [ ] Velocity + Open orders overlays (need writers for `inventory_unit_status`)
- [ ] `canReleaseBatch` toolbar action in Map tab (add aisle/bin management UI)

## Phase 3 Engineer Checklist

- [ ] Implement `renderers/ThreeRenderer.tsx` — Three.js isometric drop-in
- [ ] `renderer="three"` prop activates it — no other prop changes
- [ ] Add 2D/3D toggle button inside `variant="full"` toolbar
- [ ] Never couple business logic to renderer — props contract is frozen