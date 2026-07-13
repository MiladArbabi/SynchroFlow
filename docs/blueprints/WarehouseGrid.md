# WarehouseGrid — Blueprint & Integration Spec

**Last updated: July 13, 2026**  
**Status: 2D grid and SVG isometric renderers implemented — overlay contract verified**

---

## Location

```tsx
modules/shared/src/ui/WarehouseGrid/
  index.tsx                 ← public component, exported from @lasyncro/shared/ui
  WarehouseGrid.types.ts    ← all interfaces, exported from @lasyncro/shared/ui
  BinCell.tsx               ← single bin renderer (4 states + live pulse)
  AisleColumn.tsx           ← vertical aisle grouping
  PickPathOverlay.tsx       ← SVG polyline with numbered stops (Phase 2 — COMPLETE)

modules/floor-planning/src/ui/components/
  CanvasEditor.tsx          ← 2D SVG floor plan editor (Phase 2 — COMPLETE)
  BinLogDrawer.tsx          ← slide-in activity timeline for selected bin
  PrintPreviewPanel.tsx     ← barcode label sheet preview + print isolation
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
  pickPath?: string[];                             // ordered pick route
  focusedBins?: string[];                          // focus mode: bright; rest dimmed
  liveActivity?: Record<string, LiveBinState>;     // keyed by location_code
  onBinSelect?: (locationCode: string) => void;
  mode?: 'map' | 'pick' | 'heatmap' | 'focus';
  variant?: 'full' | 'mini' | 'inline';
  renderer?: 'svg' | 'three';                      // 'three' = Phase 3
}
```

### WarehouseLocation (migration 0108 — floor coordinates added)

```typescript
interface WarehouseLocation {
  location_code: string;
  type: 'warehouse' | 'lane' | 'shelf' | 'bin';
  parent_location_code: string | null;
  barcode: string | null;
  active: boolean;
  position_x: number | null;   // metres from top-left origin
  position_y: number | null;
  width: number | null;        // physical rack width in metres
  depth: number | null;        // physical rack depth in metres
  orientation: number;         // 0/90/180/270 degrees
  rack_levels: number | null;  // vertical shelf levels — drives 3D height
  zone_type: WarehouseZoneType | null; // drives colour coding
}
```

---

## Grid Derivation

- Grid renders **bin-type locations only** — warehouse/lane/shelf are structural, not rendered as cells
- Aisle = the bin's `parent_location_code` (the lane it belongs to). **Do NOT** string-split `location_code` — that breaks on quarantine/problem bins with no aisle prefix (fixed June 2026, WMS-FP-01/02). Aisle counts exclude `zone_type='quarantine'` bins.
- Bins sorted `ASC` within each aisle — matches `wms.controller.ts` pick route sort
- Aisles sorted alphabetically left→right

---

## Canvas Editor (Phase 2)

```tsx
modules/floor-planning/src/ui/components/CanvasEditor.tsx
```

SVG floor-plan editor rendered in the Setup tab. It reads `position_x/y`, `width`, `depth`, and `rack_levels` from `WarehouseZone`.

| Feature | Detail |
|---|---|
| Scale | 60px per metre |
| Snap grid | 0.1m, supporting standard 0.5m bin depth |
| Canvas size | 20m × 15m virtual workspace with pan and zoom |
| Zoom range | 40%–300% |
| Drag reposition | Writes `position_x/y` through `PATCH /zones/:locationCode` on drag-end |
| Resize handles | East, south, and SE handles write `width/depth` on resize-end |
| Collision clamping | Bins clamp to the nearest non-overlapping edge during drag and resize |
| Frame zones | Warehouse, lane, and shelf frames do not participate in bin collision clamping |
| Selection | Opens the `RackInspector` panel |
| Unpositioned zones | Zones with null coordinates can be placed from the palette |
| 2D/3D toggle | Switches between the editable 2D canvas and the live SVG isometric view |
| Saved state | Toolbar timestamp updates after successful position or dimension writes |
| Zone colours | Operational bins use shared `--zone-*` tokens; warehouse/lane/shelf frames use gold territory styling |
| Supported semantic zones | Pick, pack, receive, ship, returns, problem, quarantine, kitting, and storage |
| Creation palette | Eight creation tiles: Aisle, Pick, Pack, Receive, Ship, Returns, Quarantine, and Materials |
| Pan/Select modes | Pan moves the canvas; Select supports zone selection and marquee interaction |
| Scroll behavior | Vertical scroll pans Y; Shift+scroll pans X; zoom remains toolbar-controlled |
| Render order | Warehouse frames render behind lanes, with operational bins in front |

`CanvasEditor` and `IsometricCanvas` are separate SVG renderers over the same `WarehouseLocation` geometry. The 2D view owns drag and resize editing; the isometric view provides spatial inspection without geometry editing.

---

## Variant Scale

| variant | Use case | Toolbar | Right panel | Interaction |
|---|---|---|---|---|
| `full` | Floor Planning, WMS overview | yes | yes | click → panel |
| `mini` | Order detail, Batch detail, Demand | no | no | click → tooltip |
| `inline` | Product detail, SKU Gaps embed | no | no | read-only, expand on tap |

---

## Renderer and Overlay Behaviour

`WarehouseGrid` remains the shared 2D renderer for compact WMS, Demand, product, and receiving contexts. The main Floor Planning Map uses the shared SVG `IsometricCanvas`.

### Shared WarehouseGrid modes

| Mode | Behaviour | Use case |
|---|---|---|
| `map` | Standard 2D bin layout | Compact warehouse views |
| `heatmap` | Quantity-driven bin heatmap | Demand and WMS summaries |
| `focus` | Emphasizes `focusedBins` and dims other bins | Product and receiving context |
| `pick` | Shows highlighted bins and ordered pick routes | WMS batch detail |

### Floor Planning IsometricCanvas overlays

| Overlay | Visual contract |
|---|---|
| Occupancy | Calculates each bin’s fill from `on_hand_quantity` relative to `rack_levels × 10`; missing occupancy entries are treated as empty. Empty bins are grey, followed by green, orange, and red occupancy bands. |
| Stock-out risk | Bins with stock between 1 and 3 units are emphasized in red. Every face, label, and stroke belonging to non-matching bins is dimmed as one visual group. |
| Empty bins | Bins with zero units, including bins absent from the occupancy map, receive an explicit empty-grey emphasis. Stocked bins are dimmed. |
| No overlay | Displays the physical layout using semantic zone colours without occupancy or focus overrides. |

Only the Occupancy overlay receives occupancy heatmap data. Stock-out and Empty use semantic focus props, while No overlay receives neither.

---

## Backend Endpoints

| Endpoint | Controller | Purpose |
|---|---|---|
| `GET /api/v1/floor-planning/layout` | `httpGetLayout` | Zones + product barcodes. `children_count` is a live subquery (integer). |
| `GET /api/v1/floor-planning/grid` | `httpGetGrid` | All warehouse_locations with floor coordinates |
| `GET /api/v1/floor-planning/grid/occupancy` | `httpGetBinOccupancy` | inventory_truth per bin, grouped by location_code |
| `GET /api/v1/floor-planning/bin/:locationCode/log` | `httpGetBinLog` | Merged inventory_movements + pick_scan_log, 50 events DESC |
| `GET /api/v1/floor-planning/bin/:locationCode/stats` | `httpGetBinStats` | picks_7d, last_pick_at, last_pick_by, reorder_in_days |
| `GET /api/v1/floor-planning/variant/:variantId/bins` | `httpGetVariantBins` | Bin locations for a variant (alert deep-links) |
| `POST /api/v1/floor-planning/zones` | `httpCreateZone` | Create zone with optional floor coordinates |
| `PATCH /api/v1/floor-planning/zones/:locationCode` | `httpUpdateZone` | Update active, barcode, position, dimensions, zone_type |
| `DELETE /api/v1/floor-planning/zones/:locationCode` | `httpDeleteZone` | Delete zone — blocked if has stock |
| `PATCH /api/v1/floor-planning/products/:lasyncroVariantId/barcode` | `httpUpdateProductBarcode` | Correct barcode on external_product_identity_map |

All require: `authenticateToken` + `requireFt2` + `requireAction('floor-planning:read|write')`

### Known bug fixed (May 2026)
`httpGetBinStats` previously ran two sequential transactions — the first was dead code. Now single transaction. The `order_revenue_units` subquery omits `shop_id` filter and relies on RLS `SET LOCAL` tenant isolation.

---

## Frontend Hooks

```tsx
apps/frontend/src/pages/floor-planning/useWarehouseGrid.ts
  useWarehouseGrid()               — grid layout, staleTime 5min
  useWarehouseGridOccupancy()      — per-bin stock, polls every 60s

apps/frontend/src/pages/floor-planning/useZoneManagement.ts
  useCreateZone()                  — POST /zones
  useUpdateZone()                  — PATCH /zones/:locationCode (active, barcode, position, dimensions)
  useDeleteZone()                  — DELETE /zones/:locationCode
  useUpdateProductBarcode()        — PATCH /products/:lasyncroVariantId/barcode

apps/frontend/src/pages/floor-planning/useFloorPlanning.ts
  useFloorPlanning()               — GET /layout (zones + product_barcodes)

apps/frontend/src/pages/floor-planning/useBinLog.ts
  useBinLog(locationCode)          — GET /bin/:locationCode/log (enabled when bin selected)

apps/frontend/src/pages/floor-planning/useBinStats.ts
  useBinStats(locationCode)        — GET /bin/:locationCode/stats
```

---

## FloorPlanningPageProps — Key Props

```typescript
onCreateZone        — POST /zones
onDeleteZone        — DELETE /zones/:locationCode
onToggleZoneActive  — PATCH /zones/:locationCode { active }
onUpdateZone        — PATCH /zones/:locationCode { position_x, position_y, width, depth, orientation, rack_levels, zone_type }
onUpdateProductBarcode — PATCH /products/:lasyncroVariantId/barcode
```

---

## Development Seed — Layout and Occupancy

The development seed creates 23 active floor locations:

- One 12m × 12m warehouse envelope: `WH-1-ROOT`
- Three lane frames: A, B, and C
- Twelve pick bins: A-1 through C-4
- Six operational zones: `PACK-1`, `RECEIVE-1`, `SHIP-1`, `RETURNS-1`, `QUARANTINE-1`, and `KITTING-1`
- One separate problem zone: `PROBLEM`

Pick bins are 1m × 0.5m with three rack levels. Operational zones use their own dimensions and semantic `zone_type`. PROBLEM uses `zone_type='problem'`; it is not a quarantine zone.

`seed_overview_products.sql`, executed by the full development seed workflow, inserts deterministic `inventory_truth` rows across A-1 through C-4. The verified fixture contains:

- 14 inventory rows
- 197 total units
- Stock in all 12 pick bins
- Two stock-out-risk bins at 3 units: A-1 and B-1
- Quantities spanning the green, orange, and red occupancy bands

Verify the seeded layout and occupancy with:

```zsh
PGPASSWORD=sf_pass psql -h localhost -p 5432 -U sf_user -d synchroflow_db -c "\pset pager off" -c "SELECT COUNT(*) AS locations, COUNT(*) FILTER (WHERE type = 'bin') AS bins FROM warehouse_locations WHERE shop_id = 1 AND active = true; SELECT location_code, SUM(on_hand_quantity) AS units FROM inventory_truth WHERE shop_id = 1 GROUP BY location_code ORDER BY location_code;"
```

---

## Current Consumer Map

| Module | variant | mode | Extra props |
|---|---|---|---|
| Floor Planning `/floor-planning` | `full` | `map` | `onBinSelect` → right panel |
| WMS Batch Detail | `mini` | `pick` | `pickPath`, `highlightedBins` |
| Demand `/demand` | `mini` | `heatmap` | `occupancy` |
| Product Detail | `inline` | `focus` | `focusedBins` (page not built yet) |
| PO Receiving | `mini` | `focus` | `focusedBins` |
| Overview `/overview` | `IsometricCanvas` (direct) | `map` + occupancy | `occupancy`, `stations` (aprons), `liveActivity` (picker dots) — scale tier only |

---

## Phase 1 — Complete (May 2026)

- ✅ `WarehouseGrid` component — `full/mini/inline` variants, `map/heatmap/focus/pick` modes
- ✅ `GET /api/v1/floor-planning/grid` — bin layout endpoint
- ✅ `GET /api/v1/floor-planning/grid/occupancy` — per-bin stock endpoint
- ✅ Floor Planning page — Map / Setup / Barcodes tabs
- ✅ Per-tab serif headers matching Overview/Orders pattern
- ✅ Map tab — toolbar, legend bar, dynamic subline, bin detail panel
- ✅ Barcodes tab — Locations + Products sub-tabs, stat row, filter pills
- ✅ Tab count badges (bin count / zone count / barcoded count)
- ✅ All tokens aligned to design system (CSS vars + `theme.palette.*`)

---

## Phase 2 — Complete (May 2026)

- ✅ `PickPathOverlay.tsx` — SVG polyline with numbered stops, mathematical coordinate derivation
- ✅ Wire `mini/pick` into WMS batch detail
- ✅ Wire `mini/heatmap` into Demand page
- ✅ Alert deep-link — stockout alerts → `/floor-planning?variantId=<uuid>` → focused grid
- ✅ Bin detail panel — occupancy %, progress bar, contents, picks 7D, last pick, reorder in
- ✅ Bin Activity Log drawer — merged inventory_movements + pick_scan_log
- ✅ Left filter rail — 4 overlays, zone type filters
- ✅ Migration 0108 — `position_x/y`, `width`, `depth`, `orientation`, `rack_levels`, `zone_type`
- ✅ `CanvasEditor` — SVG floor plan editor, drag-to-reposition, zone colour coding, inspector panel
- ✅ List/Canvas toggle in Setup tab
- ✅ `onUpdateZone` prop — writes canvas position/dimensions via `PATCH /zones/:locationCode`
- ✅ `useUpdateProductBarcode` — inline barcode edit in Products tab, writes `external_product_identity_map`
- ✅ `children_count` — live subquery (was hardcoded 0)
- ✅ Dev seed floor coordinates — all 16 locations positioned
- ✅ Development seed floor coordinates — all 23 locations positioned
- [x] Palette click-to-create — click tile, enter code, POST /zones with position, placed immediately on canvas
- [x] Scroll to pan — removed zoom-on-scroll, native wheel listener pans canvas; shift+scroll pans horizontally
- [x] Pan/Select mode toggle — toolbar icon buttons, modeRef pattern for stale closure safety
- [x] Frame zone collision fix — warehouse/lane/shelf excluded from drag and resize clamping
- [x] Warehouse removed from palette — canvas IS the warehouse; multi-warehouse via tabs (issue #963)
- [x] Palette simplified — 8 tiles: Aisle (lane/frame) + Pick/Pack/Receive/Ship/Returns/Quarantine/Materials
- [x] Label bar — sticky gold tab on frame zones always visible even when children fill the frame
- [x] Saved X ago — toolbar timestamp after every drag-end or resize-end commit
- [x] `last_printed_at` — migration in 0108, endpoint, hook, inspector wired, Barcodes tab live

## Phase 2 — Remaining

- [x] Marquee select — fixed hits.length guard; now selects zones dragged over; works over frame zones in select mode
- [ ] Marquee fill invisible — --accent-ghost CSS var undefined, issue #967
- [ ] Responsive collapsible side panels — issue #962  
- [ ] Multi-warehouse tab navigation — issue #963
- [x] `GET /api/v1/wms/live-activity` — closed WG-11 (July 2026). Endpoint live, `useWmsLiveActivity` hook polling 15s, picker dots on `IsometricCanvas`. See `overview-live-map-playbook.md` §6.
- [ ] Wire `inline/focus` into Product detail page (page doesn't exist yet)
- [ ] Surfaced Today panel — left rail live intelligence (GitHub issue #958)
- [ ] Velocity + Open orders overlays
- [ ] BUG-08/09 edge cases — zone overlap at corners with 3+ adjacent zones (parked)
- [ ] Template presets — Pick-pack-ship / U-shaped / Fish-bone (GAP-04, parked)

## Phase 2 — Complete (this session, May 2026)

- ✅ Resize handles — east/south/SE corner, writes `width/depth` via `onUpdateZone` on drag-end
- ✅ Unpositioned zone list in palette — click to place at canvas centre
- ✅ 2D/3D toggle button stub — 3D greyed out, Phase 3 placeholder
- ✅ Live 2D/3D toggle — switches between editable Canvas and shared SVG isometric inspection
- ✅ Map tab filter rail — zone type filters (pick/pack/receive/ship/returns/quarantine/kitting/storage)
- ✅ Map tab — Layers section (Floor & grid / Bins / Tote markers / Pick path stubs)
- ✅ Map tab — bin panel actions (Print bin label / Replenish / Move stubs)
- ✅ Map tab — CAPACITY derived from `rack_levels × 10` (was hardcoded 48)
- ✅ Tab + canvas view + barcodes sub-tab persisted via URL search params (`?tab=&view=&subTab=`)
- ✅ Barcodes tab — filter pills extended (ALL/BIN/LANE/SHELF/WAREHOUSE/TOTE/DOCK/SHIP/PACK/RET/KIT)
- ✅ Barcodes tab — table columns: Zone + Last Printed added, Parent removed
- ✅ Barcodes tab — Aisles fully labelled shows `N/M` fraction format
- ✅ String→float parse fix for `width/depth/position_x/y` from Postgres decimal columns
- ✅ Duplicate Surfaced Today block removed from filter rail
- ✅ `children_count` integer cast fix (was returning string)
- ✅ RackInspector delete — MUI Dialog replaces window.confirm() (issue #965)
- ✅ RackInspector duplicate — Dialog with editable code input, onCreateZone wired (issue #966)
- ✅ Isometric painter sort flipped fix — z-order correct in mirrored view
- ✅ IsometricZoneView embeddable — exported from module index for product/order detail embeds

---

## Isometric 2.5D Renderer

### Status

The pure SVG isometric renderer is implemented and verified in:

- Floor Planning → Map
- Floor Planning → Setup → Canvas → 3D
- `IsometricZoneView` embeds

Editing remains in the 2D Canvas view. The isometric view is the read-only spatial and operational surface.

### Component Structure

```text
modules/shared/src/ui/
  IsometricCanvas.tsx        — shared interactive isometric renderer
  IsometricCanvas.types.ts   — WarehouseZone contract
```

`IsometricCanvas.tsx` also exports `IsometricZoneView`, the non-interactive single-zone renderer used by compact embeds.

### Geometry

The renderer projects warehouse coordinates into SVG screen coordinates:

```
sx = (x - y) * TILE_W / 2
sy = (x + y) * TILE_H / 2 - z * LEVEL_H
```

Where:

- `x` and `y` come from `position_x` and `position_y`
- `width` and `depth` come from `width` and `depth`
- rack height is `rack_levels × 0.5m`
- one world metre uses a 60px base scale

Warehouse, lane, and shelf frames render as flat territory surfaces. Bin locations render with height derived from rack levels.

### Rendering

- Operational fills and strokes use shared `--zone-*` theme tokens.
- Rack levels render as individual side-face bands.
- Standard and mirrored views reverse painter sorting as required.
- Auto-fit recalculates when the visible layout changes.
- Overlay fills apply to the complete bin, including the top and rack-level side faces.
- Focus dimming applies at the SVG group level so faces, strokes, and labels remain visually consistent.

### Props Contract

```typescript
interface IsometricCanvasProps {
  zones: WarehouseZone[];
  onSelect?: (locationCode: string | null) => void;
  filteredCodes?: Set<string>;
  highlightZoneTypes?: Set<string>;
  focusedBins?: string[];
  focusTone?: 'empty' | 'risk';
  occupancy?: Record<string, { on_hand_quantity: number }>;
  showFloor?: boolean;
  showBins?: boolean;
  initialZoom?: number;
  initialOffset?: { x: number; y: number };
  autoFit?: boolean;
  fitPadding?: number;
}

interface IsometricZoneViewProps {
  zone: WarehouseZone;
  width?: number;
  height?: number;
}
```

### Interaction

- Click selects a location and opens its relevant detail or inspector context.
- Pan and zoom operate without modifying warehouse geometry.
- The mirrored-angle control changes projection and painter order.
- Floor and bin layers can be shown or hidden.
- Dragging, resizing, and marquee editing remain exclusive to the 2D Canvas view.

### Overlay Integration

The Floor Planning Map passes exactly one overlay contract at a time:

- Occupancy passes `occupancy`.
- Stock-out risk passes `focusedBins` with `focusTone='risk'`.
- Empty bins passes `focusedBins` with `focusTone='empty'`.
- No overlay passes none of these props.

Zone filters are supplied through `filteredCodes`. All supported operational types—including problem and quarantine—are enabled by default and can be independently filtered.

### Completed

- Shared SVG isometric renderer
- Map integration
- Setup 2D/3D toggle
- Standard and mirrored painter ordering
- Rack-level height and side-face bands
- Semantic zone colours from shared theme tokens
- Occupancy heatmap across complete bin geometry
- Stock-out and empty-bin semantic focus
- Group-level dimming for complete objects
- Floor and bin layer controls
- Auto-fit, pan, zoom, and reset controls
- IsometricZoneView shared export

### Planned Consumers

- Product detail: show the product’s stocked bins
- Order detail: show line-item pick locations

### Cross-references

- `OrderPool.md` — pick-route ordering uses warehouse coordinates.
- `WMS_process_blueprint.md` — pick sessions consume spatially ordered line items.
