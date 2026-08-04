# LaSyncro — Overview Live Map Playbook

> **Scope:** The live-map redesign of the Overview module — concept, architecture, phasing, and every implementation decision locked in the July 2026 workshop.
> **Supersedes:** The layout section of `overview-module-playbook.md` (§1 triage layout). The data pipeline, alert spine, and seeding runbook in that document remain unchanged and authoritative.
> **Companion docs:** `docs/blueprints/WarehouseGrid.md`, `docs/blueprints/WarehouseModule.md`, `overview-module-playbook.md`
> **Last updated:** August 4, 2026 — OV-136 active operator markers and phase placement verified locally.
> **Status:** v1-A ✅ · v1-B ✅ · v2 ✅ · v2.1 Core teaser ✅ · OV-135 ✅ local · OV-136 ✅ local · v3 parked.
---

## 1. Why this exists — the product thesis

The ICP (1–20-operator SMB merchant, own warehouse, $100K–$50M, high SKU complexity) currently starts every operational day by reconstructing reality from fragments: Shopify for order status, a spreadsheet for inventory, the floor lead for what's stuck, the carrier portal for what's moving. The reconstruction ritual is the problem laSyncro is built to eliminate.

The current Overview (triage-first signals + Business Pulse rail) solves the *decision* side of that problem. The live map solves the *spatial intuition* side: instead of reading "8 orders past SLA" in a table, the owner sees a growing red stack at the order apron. Instead of asking the floor lead what's moving, they see picker positions and batch progress on the floor. One picture replaces the reconstruction ritual.

**Design thesis:** numbers overwhelm; space orients. The map is not a dashboard widget — it is the front door to operational control. Every number that has a physical location on the floor should live there first and appear as text only in the 25% mirror card.

---

## 2. Locked layout

```ts
┌─────────────────────────────────────────────────────────────────────────┐
│  HEADER: greeting · date · summary line · Export brief                  │
├──────────────────────────────────────────┬──────────────────────────────┤
│                                          │  MERGED PULSE CARD (25%)     │
│  LIVE MAP  (75%)                         │                              │
│                                          │  Decisions (top 3 + +N more) │
│  [ INBOUND APRON ]                       │  ─────────────────────────── │
│    Order pool tokens (eligible count)    │  Business pulse strip        │
│    Blocked/constrained sub-stack (red)   │   Revenue today              │
│    SLA-breached badge (pulsing)          │   Collected                  │
│                                          │   At risk                    │
│  [ WAREHOUSE FLOOR ]                     │   Blocked                    │
│    Isometric bins + occupancy overlay    │                              │
│    Picker positions (v2)                 │  ─────────────────────────── │
│    Batch progress (v2)                   │  WMS strip (v2)              │
│    Stow pressure at RECEIVE-1 (v2)       │   Pool · Batches · Stow      │
│                                          │                              │
│  [ OUTBOUND APRON ]                      │                              │
│    Shipped today count                   │                              │
│                                          │                              │
└──────────────────────────────────────────┴──────────────────────────────┘
```

**Geometry rules:**

- Layout is stable regardless of signal count — no dynamic layout swaps.
- Map area: `flex: '1 1 0'`, min-width 0, bounded by the 75/25 split.
- Pulse card: `flex: '0 0 280px'` — same fixed width as the current BusinessPulse rail.
- On mobile (below `md` breakpoint): pulse card leads full-width, map collapses behind a "View floor →" expander. Ties to parked issue #962.
- On `isLoading`: map area shows skeleton floor plate, pulse card shows existing skeleton rows.

---

## 3. Tier and zone gate — three-branch logic

Resolved at `OverviewFT2Page` level. The page owns subscription and data-state resolution; `OverviewModuleFT2` remains layout-only and receives rendered `mapContent` and `upgradeTeaser` props.

| Branch | Condition | Overview renders |
| --- | --- | --- |
| **Live map** | tier is `growth` or `scale`, layout request succeeds, and `zones.length > 0` | Full `IsometricCanvas` with occupancy, apron stations, and live picker activity |
| **Teaching empty** | tier is `growth` or `scale`, layout request succeeds, and `zones.length === 0` | “Build your floor” teaching state with CTA to `/floor-planning` |
| **Upgrade teaser** | owner/admin tier is below `growth` | Core triage layout remains fully available, followed by a compact, dismissible live-map teaser with CTA to `/settings/billing` |

### 3.1 Core upgrade bridge

The teaser closes the discovery gap between Core and Growth without replacing Core’s actionable “Needs a decision” workflow.

Locked behaviour:

- The teaser appears only for owners/admins below Growth.
- Core’s triage list and Business Pulse remain unchanged and fully usable.
- The teaser spans the triage layout width but does not occupy the permanent 75% map slot.
- The preview uses `IsometricCanvas` with static sample warehouse geometry and static occupancy values.
- No customer floor, occupancy, order-pool, or live-activity data is exposed through the preview.
- SVG text labels are hidden in the teaser so the miniature communicates floor shape and racks without visual clutter.
- Dismissal is stored in `sessionStorage` under `overview-live-map-teaser-dismissed`.
- The CTA reads “See Growth plan →” and routes to `/settings/billing`.
- The teaser emits `upgrade_prompt.shown`, `upgrade_prompt.dismissed`, and `upgrade_prompt.clicked` with `surface: 'overview'`.
- Operators do not receive the billing upgrade prompt.

The live Growth/Scale map currently receives layout zones from `useFloorPlanning()`, occupancy from `useWarehouseGridOccupancy()`, order-pool station data from `useOrderPool()`, and picker activity from `useWmsLiveActivity()`.

---

## 4. Calm state

When the floor is idle (evenings, weekends, no active batches, no pool pressure), the map must not read as broken. Rules:

- Floor renders normally with occupancy overlay (bins still have stock — occupancy is always meaningful).
- Aprons show `0` counts in a muted style (not hidden — absence of orders is information).
- No picker dots visible (v2 feature, so this is the default state at launch).
- A single ambient line below the canvas: "Floor is clear · No active batches" in `var(--ink-4)` at 11px.
- No empty-state illustration — the map IS the content; do not replace it.

---

## 5. Aprons — synthetic station contract

Aprons are **not** `WarehouseZone` rows. They are a new optional prop on `IsometricCanvas` projected in the same isometric space but not part of the warehouse geometry. Schema remains clean.

### 5.1 New prop

```typescript
// Add to IsometricCanvasProps in IsometricCanvas.types.ts
stations?: SyntheticStation[];

export interface SyntheticStation {
  id: string;                          // 'inbound' | 'outbound' — stable keys
  label: string;                       // 'Order pool' | 'Shipped today'
  side: 'inbound' | 'outbound';        // determines projection position
  count: number;                       // token stack height driver
  urgentCount?: number;                // red sub-stack (blocked/constrained)
  pulsingBadge?: boolean;              // SLA-breached indicator
  deepLink?: string;                   // click target
}
```

### 5.2 Projection

Inbound apron projects to the left of the warehouse envelope (negative x offset from `position_x` minimum). Outbound projects to the right (beyond `position_x` maximum + `width`). Both render at `position_y` midpoint of the floor, at ground level (z = 0). Token stacks are SVG `rect` groups — no geometry data, no rack_levels.

### 5.3 Data sources

| Apron field | Source |
| --- | --- |
| `inbound.count` | `GET /api/v1/wms/order-pool` → `eligible_order_count` |
| `inbound.urgentCount` | `computeConstraintMetrics` result → `constrained_orders` (already the Orders header source per W1 — same field, same API) |
| `inbound.pulsingBadge` | `morningBrief.signals` any signal with `priority <= 2` AND `module === 'orders'` with SLA context — derived client-side from existing brief data, no new endpoint |
| `outbound.count` | `GET /api/v1/wms/analytics` → `summary.fulfilled_today` (already exists) |

**Floor Planning does not receive `stations` prop.** Only Overview passes it.

### 5.4 Spatial-signal spine consistency rule

Map badges must derive from the same `alerts` table rows that drive the bell count and the pulse card signals. Do not recompute conditions client-side. The inbound apron's red sub-stack is `constrained_orders` from `computeConstraintMetrics`, which is already the canonical constrained count. The pulsing SLA badge derives from `morningBrief.signals` (which reads alerts), not from a direct order query. One fact source → one signal everywhere.

---

## 6. Live-activity endpoint — minimal v1 scope (WG-11)

`GET /api/v1/wms/live-activity` — authenticated, `requireFt2`, `requireAction('wms:read')`.

No new writers. Derive from existing tables only.

**OV-129 addition — `stowPressure.by_location`.** The original `stowPressure`
collapsed every pending task to one integer and pinned it to a hardcoded
`anchor_location: 'RECEIVE-1'` — a location that usually holds no stow tasks at
all, since tasks carry the *destination* bin. Per-bin detail existed in
`stow_tasks.location_code` and was discarded by the `.count()`. Added alongside
the scalar rather than replacing it, since `pending_count` is part of the
existing contract:
    by_location: [{ location_code, pending_units, pending_tasks }]

`pending_units` sums `stow_tasks.quantity`; `pending_tasks` counts rows. **These
are different numbers and must not be interchanged** — the map badges show
units, and a floor-wide total built from `pending_count` would not reconcile
with them (8 tasks vs 132 units on the dev tenant).

```typescript
{
  pickerPositions: {
    operator_id: string;
    location_code: string;      // last confirmed pick scan location
    last_scan_at: string;       // ISO timestamp
    batch_id: string;
  }[];
  activeBatches: {
    batch_id: string;
    status: 'picking' | 'packing';
    picked_lines: number;       // legacy field name; value is units_picked
    total_lines: number;
    total_units: number;
    units_packed: number;
  }[];
  stowPressure: {
    pending_count: number;      // pending task count
    anchor_location: string;    // legacy compatibility field
    by_location: {
      location_code: string;
      pending_units: number;
      pending_tasks: number;
    }[];
  };
  receiveAtDock: {
    location_code: string;
    units: number;
  }[];
  awaitingPackUnits: number;
}
```

### 6.2 Derivation queries

- `pickerPositions` is the legacy response-field name for active picking and packing operator positions (OV-142).
- OV-132: liveness is a property of the BATCH, not of scan recency. Presence comes from `pick_batches` in `picking`/`packing` status. The former four-hour filter on `scanned_at` made an operator vanish mid-batch whenever a walk between bins outran the window, and no single value satisfies both "picker crossing a long aisle" and "batch genuinely abandoned". Production ran at 1785 minutes idle and showed an empty floor.
- Picking positions: identity and liveness from `pick_batches.picked_by` / `pick_last_activity_at`. Position from a LATERAL lookup of the latest confirmed `pick_scan_log` row for that batch and operator — **unbounded**, no time filter. A picker with no scan yet anchors to the first active `zone_type='pick'` location; if neither resolves, the row is dropped rather than rendered at a nonexistent bin.
- Packing positions: identity from `COALESCE(packed_by, assigned_packer_id)`, liveness from `COALESCE(pack_last_activity_at, pick_last_activity_at)` — a batch in `packing` has necessarily been picked, so the pick clock is a valid floor (OV-149). `pack_scan_log` is **not joined**: it carries no location (OV-139), so position already came from the pack zone, and identity plus recency both live on `pick_batches`. Joining it only added a failure mode — prod has zero pack scans (OV-147).
- Freshness is reported, never filtered. Each entry carries `last_scan_at` (null for packers by design, and for pickers yet to scan) and `batch_activity_at` (never null on a live batch). The response also carries `staleThresholdMinutes` from `shop_wms_settings.idle_alert_threshold_minutes`, default 15 — `idleAlert.service.ts:52` returns early when the row is missing, which the map cannot do, since that would mean nothing is ever stale.
- The client grades on `last_scan_at ?? batch_activity_at`. A bin where every operator is stale renders its pill in `#D9A23B`; mixed bins stay default. The marker key appends `· N idle`. Stale operators are never hidden — an operator who stopped moving is the case a merchant most needs to see.
- `pack_scan_log` has no station or location field. Packing activity is therefore phase-level: it anchors to the first active pack zone ordered by `location_code`. No packing position is emitted when the warehouse has no active pack zone. Exact multi-station attribution requires a future station-assignment data model.
- `activeBatches`: `pick_batches` where `status IN ('picking', 'packing')`, exposing batch progress from `units_picked`, `total_line_items`, `total_units`, and `units_packed`.
- `stowPressure.by_location`: pending `stow_tasks` grouped by `location_code`; badges use summed units while `pending_count` remains a task count.
- `receiveAtDock`: `inventory_units` where `status = 'received'`, grouped by `current_location_code`.
- `awaitingPackUnits`: summed `pick_batches.total_units` where `status = 'pick_complete'`.

Ready-for-release orders remain authoritative in `GET /api/v1/wms/order-pool`. Packed-not-shipped orders are represented by `order_warehouse_status.status = 'packed'` but are not yet exposed by the live-activity response.

### 6.3 Poll interval

Overview polls every 15s. `useWarehouseGridOccupancy` already polls 60s — live-activity is a separate hook with its own `refetchInterval: 15_000`.

### 6.4 `liveActivity` prop wiring

`OverviewFT2Page` reduces the API positions by `location_code` into `LiveBinActivity`. It preserves separate `pickingCount` and `packingCount` values so co-located mixed-phase operators are not collapsed into one ambiguous status.

`IsometricCanvas` renders a semantic operator pill at the projected zone centroid:

- person glyph plus `1 op` or `N ops`
- blue phase dot for picking
- orange phase dot for packing
- native SVG title and accessible label with the phase breakdown
- floor-wide marker-key row such as `2 active operators · 1 picking · 1 packing`

```typescript
liveActivity?: Record<string, LiveBinActivity>;
```

The marker communicates operator count and operational phase. Picking placement is scan-precise; packing placement is currently pack-zone-level because pack scans do not identify a station.

---

### 6.5 Live markers on bins (OV-129, OV-129b/c/d)

Identity stays inline, live state goes on the box face. Bins keep their
`location_code` label from `IsometricBox`; work state renders as a badge on the
top face. The warehouse slab is the exception — its name moved to the near
corner (OV-128) because the slab's centre is the middle of the floor.

**Anchoring.** The badge sits at `wx + ww * 0.85, wy + wd * 0.85` on the top
face, not the centre. `IsometricBox` draws the location code at the face
centre, and bins here are 3-level towers, so a centred badge buries the bin's
identity. The badge is also suppressed while `hasActivePick` is true so the
pick dot and the badge never contend for one anchor.

**Why the glyph exists (OV-129b).** A bare integer on a bin cannot say what it
counts — stock on hand, units to pick, units to stow and capacity would all
render identically. The arrow-into-tray glyph disambiguates between marker
types and reserves the same slot for pick and pack markers so they read as one
family. Silhouette weight only; detail is illegible at ~6px.

**Why the glyph is not sufficient (OV-129c).** An icon at 6px reminds a user of
a label they already learned; it cannot teach one. The `showMarkerKey` prop
renders a key with the glyph and the words "N units awaiting stow".

`showMarkerKey` is deliberately separate from `showLegend`: the latter controls
the occupancy COLOR-SCALE legend (`legendMode`) and is `false` at both Overview
call sites, so a marker key folded into it would never render on the screen
that needs it.

**Total (OV-129d).** The key's total is summed from `by_location` units, never
from `stowPressure.pending_count`. See the warning in §6.1.

**Staleness.** Badges reflect `stow_tasks` with `status = 'pending'` and update
on the 15s poll. Unlike batch-derived operator markers, they have no recency
window — a task pending for a week still shows.

**Receive (OV-131).** Badged from `inventory_units.current_location_code` where
`status = 'received'`, **not** from `receive_jobs`. That table has no location
column at all — a job is attached to a PO, never to a dock — and its
`total_units` is the *expected* PO quantity rather than an observation.
`receive_job_lines.suggested_location_code` is the eventual destination bin, not
where stock currently sits.

The map reports physical truth; job-level progress belongs to the Warehouse
module, which already shows it. **The two will disagree** — on the dev tenant,
`receive_jobs` reports 280 units across two jobs while `inventory_units` reports
12 at the dock. Both are correct: job headers count expected units, unit rows
count tracked ones. The marker key says "N units at dock" so the badge is
explicitly scoped rather than reading as a broken total.

Dock zones are flat, so the badge lifts `wh + 0.15` rather than stow's `0.35`,
and offsets to 0.82 of the face — the dock carries its own location label at
centre, same collision as the 3-level bins.

**Anchor codes are never hardcoded.** Local's receive bin is `RECEIVE-1`;
production's is `RECEIVE`. The legacy `stowPressure.anchor_location: 'RECEIVE-1'`
constant matches no production location and is dead weight kept only for
contract compatibility.

**Marker key rows are conditional.** A row renders only when its total is
above zero, so the key never explains a glyph that isn't on screen. Rows are
ordered by material flow: dock → stow.

---

## 7. Pulse card — merged layout

The right card absorbs both decisions and stats without becoming a junk drawer. Rules:

- **Decisions section** (top): max 3 visible, ranked by `signal.priority`, same severity color language (critical `#E5484D`, watch `#D9A23B`, on-track `#4CAF7A`). Overflow: "+N more →" expander deeplinks to `/order-flow`.
- **Divider** between decisions and stats.
- **Business pulse strip** (bottom): existing `BusinessPulse` component stats, compressed to `12px` label / `16px` value pairs.
- **WMS strip** (v2, below pulse strip): Pool · Active batches · Stow pending — three inline chips, visible only when `liveActivity` is wired.
- Self-hides decisions section entirely when `signals.length === 0` (calm state — stats only).
- No "Everything else / on-track" section in the card — calm state goes to the ambient line below the map canvas instead.

---

## 8. Signal >3 criticals rule

Layout does NOT flip when critical count exceeds 3. The map is the stable front door regardless of signal volume. Resolution:

- Top 3 criticals visible in pulse card decisions section.
- "+N more →" chip in severity red deeplinks to `/order-flow` (the triage surface).
- The spatial badges on the inbound apron (pulsing red stack) carry the urgency visually for anyone looking at the map.
- Header summary line already carries the total: "5 decisions pending · $3,800 at stake" — this is the count signal for owners who read text first.

---

## 9. Onboarding

One coach mark on first visit using the existing three-layer system (spotlight coach marks, resolved at page level per module boundary rule):

- Spotlight target: the map canvas area.
- Text: "This is your floor, live. Everything in motion, in one place."
- Trigger: `activation_audit_events` — fires once on first map render, never repeats.
- Dismiss: "Got it" — same pattern as Order Pool and Sourcing spotlights.

---

## 10. Future-proofing notes (design only — no build now)

- **Multi-warehouse (#963):** `SyntheticStation` uses `warehouse_id` as a prop from day one. When warehouse tabs land, each tab swaps the `stations` and `zones` props; the apron contract needs no migration.
- **Wave release from map (v3):** Inbound apron click → opens release drawer (currently lives in Order Pool sticky panel). The `onNavigate` prop already supports deep-links; extend to `onApronAction` when ready.
- **Map snapshot in Export brief:** parked. Requires SVG-to-PNG server-side or canvas capture; not in scope.

---

## 11. Issue register — resolved by this playbook

| ID | Description | Resolution |
| --- | --- | --- |
| FP-OV-01 | No IsometricCanvas in Overview | v1-B: wired via `useWarehouseGrid` in page layer |
| FP-OV-02 | No warehouse hooks in `OverviewFT2Page` | v1-B: `useWarehouseGrid` + `useWarehouseGridOccupancy` added |
| FP-OV-03 | No standalone `useOrderPool` hook | v1-B: extracted from `OrderFlowPage` into `apps/frontend/src/pages/wms/useOrderPool.ts` |
| FP-OV-04 | WG-11 — no live-activity endpoint | ✅ CLOSED July 2026 — `GET /api/v1/wms/live-activity` live, `useWmsLiveActivity` 15s poll, picker dots on `IsometricCanvas` |
| FP-OV-05 | Layout inverted vs target | v1-A: layout flip, map 75% / pulse card 25% |
| FP-OV-06 | No tier/zone gate | v1-A: three-branch gate per §3 |
| FP-OV-07 | BusinessPulse is revenue-only, no WMS signals | ✅ PARTIAL July 2026 — picker dots wired; WMS strip (Pool · Batches · Stow chips in pulse card) remains v3 |
| FP-OV-08 | `operationalControl = null` dead code | v1-A: removed |
| FP-OV-09 / OV-MAP-001 | Core users had no visible path to discover or upgrade to the live operations map | ✅ CLOSED July 13, 2026 — compact static map teaser added below Core triage with dismissal, billing CTA, and conversion events |
| OV-128 | Warehouse name centred on slab, colliding with PACK-1 | Moved to near corner, rotated along the projected slab edge, plate with inverted fill | ✅ |
| OV-129 | Stow pressure aggregated to a scalar pinned to a hardcoded RECEIVE-1; per-bin detail discarded | `by_location` added to live-activity; badges on bin top faces | ✅ |
| OV-129b | Bare integer badge could not say what it counted | Arrow-into-tray glyph prefix | ✅ |
| OV-129c | Glyph alone does not teach meaning | `showMarkerKey` — glyph + words, independent of `showLegend` | ✅ |
| OV-129d | No floor-wide total | Summed from `by_location` units | ✅ |
| OV-131 | Receive had no signal on the map; receive_jobs has no location column | Badge from inventory_units.current_location_code where status='received'; key row "N units at dock" | ✅ |
| OV-135 | Reviewer batches used fabricated totals and omitted canonical order, line-item and pack-scan state | Seed only eligible orders; derive real totals; create picking, picked, packing and packed states with reconciling scan evidence | ✅ local |
| OV-136 | Active operator markers were ambiguous, and packing operators inherited their final picking location | Add semantic operator pills and phase counts; derive packers from pack scans and anchor them to the active pack zone | ✅ local |

---

## 12. Implementation order

| Block | Tasks | Issues closed |
| --- | --- | --- |
| **v1-A** ✅ | Layout flip · tier/zone gate · dead code removal · pulse card merged layout | FP-OV-05, FP-OV-06, FP-OV-07 (partial), FP-OV-08 |
| **v1-B** ✅ | Page-level grid+occupancy hooks · `useOrderPool` wired · `IsometricCanvas` embed · `SyntheticStation` apron (inbound pool + blocked sub-stack) · `LiveBinActivity` type | FP-OV-01, FP-OV-02, FP-OV-03 |
| **v2** ✅ | `GET /api/v1/wms/live-activity` · `useWmsLiveActivity` 15s poll · picker dot markers on `IsometricCanvas` | FP-OV-04, FP-OV-07 (partial) |
| **v2.1** ✅ | Core triage-preserving Growth teaser · static `IsometricCanvas` preview · session dismissal · billing CTA · conversion events | FP-OV-09 / OV-MAP-001 |
| **v2.2 data foundation** ✅ local | Canonical reviewer seed for Ready · Picking · Picked · Packing · Packed, with real line-item totals and scan reconciliation | OV-135 |
| **v2.3 operator clarity** ✅ local | Self-explanatory operator pills · picking/packing phase breakdown · correct pack-zone placement · accessible marker labels | OV-136 |
| **v3** — Parked | WMS strip in pulse card (Pool · Batches · Stow chips) · token animation · wave release from apron · order-detail drill from tokens | FP-OV-07 (remaining) |

Update `WarehouseGrid.md` consumer map and `product-structure.md` §5 and §11 after each block ships.

| OV-132 | P1 | Operators vanished after 4h; markers and idle alerts disagreed | CLOSED — liveness from pick_batches, freshness graded client-side |
| OV-146 | P2 | Prod has 3 pack stations; first-active-zone heuristic stacks all packers on PACK-01 | Open |
| OV-147 | P1 | Prod shop 1 has zero pack_scan_log rows; prod's 4-batch shape predates OV-135 and came from the Sprint 2/3 hand repair | Open — no longer blocks the map |
| OV-148 | P1 | Batches b8ad06f2 and 99495ddc attributed to user 1 (contact@lasyncro.com) — the reviewer is seeded as their own operator. seed_reviewer_activity.ts falls back to owner?.id | Open |
| OV-149 | P2 | pack_last_activity_at NULL on all prod batches incl. the active packing one | Open — non-blocking, packer query falls back to pick_last_activity_at |
| OV-150 | P2 | "2 active operators · 2 idle" is self-contradictory when stale === total | Open |
| OV-151 | P2 | Pack queue badge and operator pill are two unlabelled numbers on one zone. Relocate packQueueCount to the flow rail — not a deletion | Held, coupled to the rail |
| CANVAS-COLOR-01 | P3 | Five hardcoded colour literals in IsometricCanvas vs ZONE_COLORS' var(--zone-{type}) | Open |
| BUILD-01 | P2 | No tsc --noEmit gate between commit and Docker build; tsx strips types without checking | Open |