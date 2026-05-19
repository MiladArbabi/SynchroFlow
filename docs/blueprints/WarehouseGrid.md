# WarehouseGrid — Blueprint & Integration Spec

**Last updated: May 2026**
**Status: Phase 1 complete — Phase 2 complete — Phase 3 interface locked**

---

## Location

```tsx
modules/shared/src/ui/WarehouseGrid/
  index.tsx                 ← public component, exported from @lasyncro/shared/ui
  WarehouseGrid.types.ts    ← all interfaces, exported from @lasyncro/shared/ui
  BinCell.tsx               ← single bin renderer (4 states + live pulse)
  AisleColumn.tsx           ← vertical aisle grouping
  PickPathOverlay.tsx        ← SVG polyline with numbered stops (Phase 2 — COMPLETE)

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
- Aisle label = segment before first `-` in `location_code` (e.g. `"A"` from `"A-1"`)
- Bins sorted `ASC` within each aisle — matches `wms.controller.ts` pick route sort
- Aisles sorted alphabetically left→right

---

## Canvas Editor (Phase 2)

```tsx
modules/floor-planning/src/ui/components/CanvasEditor.tsx
```

SVG floor plan editor rendered in the Setup tab. Reads `position_x/y`, `width`, `depth` from `WarehouseZone`.

| Feature | Detail |
|---|---|
| Scale | 60px per metre |
| Snap grid | 0.5m |
| Canvas size | 20m × 15m virtual, pan + zoom |
| Zoom range | 40%–300% |
| Drag reposition | writes `position_x/y` via `PATCH /zones/:locationCode` on drag-end |
| Resize handles | east / south / SE corner handles — writes `width/depth` on resize-end |
| Collision clamping | bins clamp to nearest non-overlapping edge during drag and resize — multi-pass, ref-based |
| Frame zones | warehouse/lane/shelf are containers — no collision, resize freely, gold label bar always visible |
| Click to select | opens `RackInspector` right panel with editable fields |
| Unpositioned list | palette shows zones with null coordinates — click to place at canvas centre |
| 2D/3D toggle | stub in toolbar — 3D greyed, activates `renderer='three'` in Phase 3 |
| Saved X ago | toolbar timestamp — updates after every successful drag-end or resize-end commit |
| Snap grid | 0.1m — allows fine positioning including 0.5m standard bin depth |
| Zone colour coding | bins by `zone_type`, frames by `zone.type` (gold for lane/warehouse/shelf) |
| Zone colour coding | by `zone_type` — 8 colours, all via rgba tokens |
| Toggle | List/Canvas toggle in Setup tab header |
| Palette click-to-create | click tile → enter location code → creates zone via POST + places at canvas centre |
| Pan/Select mode toggle | toolbar — pan pans canvas, select allows marquee (issue #961) |
| Scroll to pan | vertical scroll pans Y, shift+scroll pans X — zoom is toolbar-only |
| Zone render order | warehouse back, lanes middle, bins front — SVG painters model |
| Frame colour | warehouse/lane/shelf render gold — visually distinct from operational zones |
| Palette simplified | 8 tiles: Aisle (frame) + Pick/Pack/Receive/Ship/Returns/Quarantine/Materials (operational) |

**Phase 3 note:** `CanvasEditor` is a separate renderer from `WarehouseGrid`. The same `WarehouseLocation` data model feeds both — `position_x/y`, `width`, `depth`, `rack_levels` feed Three.js geometry unchanged.

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

## Dev Seed — Floor Coordinates

All 16 dev warehouse locations have real floor coordinates seeded in `apps/backend/seeds/dev_seed.ts`:

- `WH-1-ROOT` — 12m × 10m warehouse envelope
- Lanes A/B/C — 4.4m × 1m, spaced 3m apart on Y axis
- Bins — 1.0m × 0.8m, 0.1m gap between bins, 3 rack levels
- `PROBLEM` bin — quarantine zone at (8, 1)

Run after `dev:full-reset` if coordinates are missing (issue #960):

```zsh
PGPASSWORD=sf_pass psql -h localhost -p 5432 -U sf_user -d synchroflow_db -c "SET app.current_tenant='1'; SELECT location_code, position_x, position_y FROM warehouse_locations ORDER BY location_code;"
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

- [ ] Marquee select not selecting zones — issue #961
- [ ] Responsive collapsible side panels — issue #962  
- [ ] Multi-warehouse tab navigation — issue #963
- [ ] `GET /api/v1/wms/live-activity` — feeds `liveActivity` prop (no writers — issue WG-11)
- [ ] Wire `inline/focus` into Product detail page (page doesn't exist yet)
- [ ] Surfaced Today panel — left rail live intelligence (GitHub issue #958)
- [ ] Velocity + Open orders overlays
- [ ] BUG-08/09 edge cases — zone overlap at corners with 3+ adjacent zones (parked)
- [ ] Template presets — Pick-pack-ship / U-shaped / Fish-bone (GAP-04, parked)

## Phase 2 — Complete (this session, May 2026)

- ✅ Resize handles — east/south/SE corner, writes `width/depth` via `onUpdateZone` on drag-end
- ✅ Unpositioned zone list in palette — click to place at canvas centre
- ✅ 2D/3D toggle button stub — 3D greyed out, Phase 3 placeholder
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

---

## Phase 3 Engineer Checklist

- [ ] Implement `renderers/ThreeRenderer.tsx` — Three.js isometric drop-in
- [ ] `renderer="three"` prop activates it — no other prop changes needed
- [ ] `position_x/y`, `width`, `depth` → Three.js XZ plane geometry
- [ ] `rack_levels` → vertical rack height
- [ ] `zone_type` → material colour
- [ ] Add 2D/3D toggle button inside `variant="full"` toolbar
- [ ] Never couple business logic to renderer — props contract is frozen

## Phase 3 — Isometric 2.5D Renderer

### Overview
Isometric SVG renderer activated by the 2D/3D toolbar toggle in `CanvasEditor`.
No Three.js — pure SVG isometric projection. Same data, different visual surface.
Read-only — editing remains in 2D mode only.

### Design Goals

- Show rack_levels as vertical height — operators can see how tall a rack is
- Colour-coded by zone_type — same ZONE_COLORS palette as 2D
- Embeddable as standalone `<IsometricZoneView />` in product/order detail pages
- Onboarding tool — new operators can visualise the warehouse in 3D before their first shift

### Coordinate System
Isometric projection from 3D (x, y, z) to 2D screen (sx, sy):
```tsx
sx = (x - y) * cos(30°) * SCALE
sy = (x + y) * sin(30°) * SCALE - z * SCALE
```
Where:

- `x` = position_x (metres, rightward)
- `y` = position_y (metres, downward in 2D = depth in 3D)
- `z` = rack height (rack_levels × LEVEL_HEIGHT, default 0.5m per level)
- `SCALE` = 60px/metre (same as 2D)

### Zone Rendering
Each zone renders as an isometric box with 3 visible faces:

- **Top face** — fill at 100% opacity, zone_type colour
- **Left face** — fill at 70% opacity (darker)
- **Right face** — fill at 50% opacity (darkest)
- **Label** — location_code on top face
- **Level markers** — L1/L2/L3 on front face at each rack_levels interval

Frame zones (warehouse/lane) render as flat floor tiles (z=0, no height).

### Render Order
Zones sorted by `position_x + position_y` descending — painter's algorithm,
back zones render first so front zones appear on top correctly.

### Interaction

- Click zone → select → opens RackInspector (read-only, no edit fields)
- Pan → same offset/zoom system as 2D (mouse drag on canvas)
- Scroll → pan (same native wheel listener)
- No drag/resize handles in isometric mode
- No marquee select in isometric mode

### Component Structure
```typescript
modules/floor-planning/src/ui/components/
  IsometricCanvas.tsx     — main isometric SVG renderer
  IsometricZoneView.tsx   — embeddable standalone single-zone view (product/order detail)
```

### Props
```typescript
interface IsometricCanvasProps {
  zones: WarehouseZone[];
  selected?: string | null;
  onSelect?: (locationCode: string | null) => void;
  offset?: { x: number; y: number };
  zoom?: number;
}

interface IsometricZoneViewProps {
  zone: WarehouseZone;
  width?: number;   // container width px, default 200
  height?: number;  // container height px, default 160
}
```

### Constants

```tsx
LEVEL_HEIGHT = 0.5    // metres per rack level
ISO_ANGLE    = 30     // degrees
ISO_SCALE    = 60     // px/metre (same as 2D SCALE)
```

### Toolbar Toggle

The existing 2D/3D stub in `CanvasEditor` toolbar activates `IsometricCanvas`
in place of the flat SVG canvas. Left palette and right inspector panels remain.
Inspector fields are read-only in 3D mode (no onUpdateZone calls).

### Embeddable Usage (future)

```tsx
// Product detail page — show where this product is stocked
<IsometricZoneView zone={primaryBin} width={240} height={180} />

// Order detail page — show all line item locations
{lineItemBins.map(bin => <IsometricZoneView key={bin.location_code} zone={bin} />)}
```

### Phase 3 — Completed

- [x] `IsometricCanvas.tsx` — pure SVG isometric renderer, no Three.js
- [x] 2D/3D toggle wired — swaps SVG canvas for isometric in-place
- [x] Palette hidden in 3D mode — editing is 2D only
- [x] Read-only RackInspector in 3D mode — onUpdateZone/onDeleteZone disabled
- [x] Painter's algorithm sort — back zones render first, correct z-order
- [x] Level markers on front face — dashed lines at each rack_levels interval
- [x] Angle presets — standard (↗) and mirrored (↙) toggle
- [x] `rack_levels` editable in inspector — zone height updates in 3D
- [x] `defaultRackLevels` in PALETTE_ITEMS — Pick=3, Pack=2, others=1
- [x] Toolbar zoom hidden in 3D — isometric has own zoom/reset/angle controls

### Phase 3 — Remaining

- [ ] `IsometricZoneView.tsx` — embeddable single-zone component for product/order detail pages
- [ ] Embed in product detail page — show where product is stocked
- [ ] Embed in order detail page — show line item bin locations
- [ ] Flipped painter sort — when flipped=true sort order should reverse for correct z-order