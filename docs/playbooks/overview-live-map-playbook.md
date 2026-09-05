# LaSyncro — Overview Live Map Playbook

> **Scope:** The live-map redesign of the Overview module — concept, architecture, phasing, and every implementation decision locked in the July 2026 workshop.
> **Supersedes:** The layout section of `overview-module-playbook.md` (§1 triage layout). The data pipeline, alert spine, and seeding runbook in that document remain unchanged and authoritative.
> **Companion docs:** `docs/blueprints/WarehouseGrid.md`, `docs/blueprints/WarehouseModule.md`, `overview-module-playbook.md`
> **Last updated:** September 5, 2026 — `COMMERCIAL-ACCESS-ARCH-01` P0-A3-2 commercial-access convergence (§3, §3.1, §6), deployed.
> **Status:** v1-A ✅ · v1-B ✅ · v2 ✅ · v2.1 Core teaser ✅ · OV-135 ✅ local · OV-136 ✅ local · OV-145 ✅ local · OV-152 ✅ local · P0-A3-2 commercial convergence ✅ **CLOSED / VERIFIED / DEPLOYED** 2026-09-05 at `8e72888136011fc0298499b32664257f2bdf064e` · v3 parked.
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
│    SLA-breached badge (pulsing)          │   At risk                    │
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

> **Commercial authority superseded 2026-09-05 by `COMMERCIAL-ACCESS-ARCH-01` P0-A3-2** (`monetization_billing_playbook.md` §32 "### P0-A3-2"). The three branches, the layout, and the `hasPlacedFloor` predicate below are all unchanged — **only the commercial half of each condition is.** Wherever a row reads "tier is `growth` or `scale`" or "tier is below `growth`", the live authority is now one canonical capability decision:
>
> ```ts
> const { decide, isResolved } = useCommercialAccess();
> const liveMapDecision = decide('overview.live_map');
> const hasMapAccess = isResolved && liveMapDecision.allowed;
> ```
>
> `overview.live_map` is declared once in `@lasyncro/commercial-policy` (`moduleId: overview`, `minimumTier: growth`). `OverviewFT2Page` no longer reconstructs eligibility from a raw tier string — `tier === 'scale' || tier === 'growth'` is gone — and `useEntitlements()` survives on this page only for the unrelated `displayCurrency`. Read the rows below as "the tenant holds `overview.live_map`" / "does not hold it". Scale inherits Growth: there is deliberately **no** Growth-vs-Scale distinction for this capability, and a persisted bespoke grant can allow the capability below Growth without any change here.

| Branch | Condition | Overview renders |
| --- | --- | --- |
| **Live map** | tier is `growth` or `scale`, layout request succeeds, and `hasPlacedFloor` | Full `IsometricCanvas` with occupancy, apron stations, and live picker activity |
| **Teaching empty** | tier is `growth` or `scale`, layout request succeeds, and `!hasPlacedFloor` | “Build your floor” teaching state with CTA to `/floor-planning` |

> **OV-34 (Aug 2026):** the gate predicate is `hasPlacedFloor` — `zones.some(z => z.position_x != null && z.position_y != null)` — not `zones.length`. Every shop is bootstrapped with `WH-{shopId}-ROOT` (null geometry) at creation, so row count is never 0 and the teaching state was unreachable. The predicate mirrors `IsometricCanvas.tsx:508` (`positionedZones`) so the gate and the canvas cannot disagree about whether a floor exists. Any future change to one must change the other.
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

> **P0-A3-2 (2026-09-05) — two corrections to the locked behaviour above.**
>
> **1. Denied tenants no longer FETCH premium data, they never merely hid it.** The bullet "No customer floor, occupancy, order-pool, or live-activity data is exposed through the preview" was a *rendering* guarantee. `useFloorPlanning()` was called unconditionally by the paragraph above, so a Starter/Core tenant still issued `GET /api/v1/floor-planning/layout` and received real floor geometry it was never shown. That is now an **acquisition** rule: `useFloorPlanning` accepts `enabled` (defaulting to `true`, so `FloorPlanningPage` is unaffected), and `OverviewFT2Page` passes the same `hasMapAccess` boolean into it. One canonical decision now gates `useFloorPlanning`, `useWarehouseGridOccupancy`, `useIdleAlerts`, `useProblemCenter` map enrichment, `useWmsLiveActivity`, the operational-map warning state, and the real-map-vs-teaser branch. **Rule for future work: any new premium map source must take the same boolean — hiding a rendered surface is not a commercial gate.**
>
> **2. The teaser's required tier is read from the decision, not assumed.** "The CTA reads 'See Growth plan →'" described a hardcoded `requiredTier: 'growth'`. The teaser now derives its copy and its `upgrade_prompt.*` analytics payload from `liveMapDecision.requiredTier`. When the decision carries no tier step (a module or feature denial rather than a tier one), the teaser falls back to neutral wording — "Available on a higher plan" / "Upgrade to unlock →" — rather than inventing a tier. Everything else in this section (session dismissal key, synthetic geometry, hidden SVG labels, owner/admin-only, the three analytics events) is unchanged.
>
> The teaser remains explicitly preview/upgrade UX built from static sample geometry. It is never blurred or degraded real merchant data.

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
  id: string;                          // stable key per stage
  label: string;                       // 'Blocked' | 'Order Pool' | 'Staged' | 'Shipped Today'
  side: 'inbound' | 'outbound';        // which rail
  count: number;                       // OV-40: single quantity, no sub-stack
  rank: number;                        // OV-40: 1 = nearest the slab, ascending outward
  tone?: 'accent' | 'critical';        // OV-40: reinforcement only, never the sole signal
  footprint?: { tw: number; td: number };  // OV-40: form carries state
  deepLink?: string;                   // click target
}
```

### 5.2 Projection

**Rail grammar (OV-40).** Located work appears where it is; unlocated work waits at the threshold. Blocked orders and the release queue are order-scoped with no location, so both ride a rail. Work already on the floor needs no block — the floor *is* the block.

Inbound rides the **right** rail, outbound the **left** (OV-13 — anchored in screen space, not world X; shifting world X alone translates a box diagonally). Placement works in the rotated basis `v = wx − wy` (screen X) and `u = wx + wy` (screen Y): a block is pinned `GUTTER` clear of the slab's outermost `v`, centred on mid-`u`, then inverted back to world coords.

`rank` steps each further block outward along `v` by its own footprint + `RANK_GAP`, so blocks on one rail never overlap at any bar height, zone count, or zoom. Both the base anchor and the step invert under `flipped`. Rank ascends with distance from being worked:

BLOCKED (2) ORDER POOL (1) ║ floor ║ SHIPPED (1) STAGED (2)


Zero-count stages are omitted, not drawn empty. Bars are projected polygon volumes (three faces, painter order per `IsometricBox`), not `rect` groups.

**Overview fit contract (2026-08-14).** The physical floor owns the primary viewport. Synthetic apron stations must not shrink the warehouse merely because an unlocated workflow block sits farther from the slab.

Overview therefore opts into `fitPhysicalFloorFirst`:

- physical warehouse geometry determines auto-fit zoom
- `apronReserveRatio={0.22}` reserves the right side for workflow-rail volume
- Overview uses `fitPadding={0.88}`
- other `IsometricCanvas` consumers retain the original whole-layout fit unless they explicitly opt in
- apron geometry remains part of pan/clamp bounds; this rule changes initial fit ownership, not whether apron work exists

This separation is semantic as well as spatial: the floor represents physical truth; the apron represents work waiting outside or after a physical stage.

### 5.3 Data sources

| Apron field | Source |
| --- | --- |
| `inbound.count` | `GET /api/v1/wms/order-pool` → `eligible_order_count` |
| `blocked.count` | `GET /api/v1/wms/order-pool` → `summary.blocked_count` |
| `staged.count` | `GET /api/v1/wms/live-activity` → `packedNotShipped` |
| `shipped.count` | `GET /api/v1/wms/live-activity` → `shippedToday` |

`pulsingBadge` was specified here but never implemented and is not on the type; row removed rather than left as a phantom contract.

**Floor Planning does not receive `stations` prop.** Only Overview passes it.

### 5.4 Spatial-signal spine consistency rule

Map badges must derive from the same `alerts` table rows that drive the bell count and the pulse card signals. Do not recompute conditions client-side. Each block derives from one canonical count — `Blocked` from `summary.blocked_count`, `Order Pool` from `eligible_order_count` (OV-40: separate blocks, no sub-stack). The pulsing SLA badge derives from `morningBrief.signals` (which reads alerts), not from a direct order query. One fact source → one signal everywhere.

---

## 6. Live-activity endpoint — minimal v1 scope (WG-11)

`GET /api/v1/wms/live-activity` — authenticated, `requireFt2`, `requireAction('wms:read')`.

> **Updated 2026-09-05 by `COMMERCIAL-ACCESS-ARCH-01` P0-A3-2 — backend parity.** The route's real chain is now
>
> `authenticateToken → requireFt2 → requireCapability('overview.live_map') → requireAction('wms:read') → httpGetLiveActivity`
>
> The commercial gate was previously **absent entirely** on this route: the frontend hid the map while the endpoint itself would still serve live floor activity to a Starter/Core caller holding `wms:read`. Commercial access and RBAC are two separate, both-required checks and stay in that order — `requireCapability` answers "is this tenant entitled to the capability", `requireAction('wms:read')` answers "is this user permitted the action". Neither weakens the other; the controller is unchanged. Denials return the `COMMERCIAL_ACCESS_DENIED` contract (§32 "### P0-A2A"). No other WMS route was migrated in that slice.

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
- The client grades on `Math.max(last_scan_at, batch_activity_at)` (OV-153). Both clocks represent legitimate activity, so the newest wins; the earlier `last_scan_at ?? batch_activity_at` let an old immutable position scan override newer batch activity and marked live operators idle. `last_scan_at` is null for packers by design and coerces to 0 in the comparison. A bin where every operator is stale renders its pill in `#D9A23B`; mixed bins stay default. The marker key appends `· N idle`. Stale operators are never hidden — an operator who stopped moving is the case a merchant most needs to see.
- `pack_scan_log` has no station or location field. Packing activity is therefore phase-level: it anchors to the first active pack zone ordered by `location_code`. No packing position is emitted when the warehouse has no active pack zone. Exact multi-station attribution requires a future station-assignment data model.
- `activeBatches`: `pick_batches` where `status IN ('picking', 'packing')`, exposing batch progress from `units_picked`, `total_line_items`, `total_units`, and `units_packed`.
- `stowPressure.by_location`: pending `stow_tasks` grouped by `location_code`; badges use summed units while `pending_count` remains a task count.
- `receiveAtDock`: `inventory_units` where `status = 'received'`, grouped by `current_location_code`.
- `awaitingPackUnits`: summed `pick_batches.total_units` where `status = 'pick_complete'`.

Ready-for-release orders remain authoritative in `GET /api/v1/wms/order-pool`. Packed-not-shipped orders are exposed as `packedNotShipped` on the live-activity response (OV-157), alongside `shippedToday`. Both derive from `order_warehouse_status`, which has no `shop_id` column — tenancy joins through `orders`, and a missing join would leak across tenants. `shipped_at` is monotonic per migration 0088's trigger, so a shipped-today count cannot silently revert.

The two feed **two** outbound blocks (OV-40): `Shipped Today` at rank 1, `Staged` at rank 2 with `tone: 'critical'`. This closed OV-159 — the two-segment bar could not encode independent counts, and the assumption that inbound's were nested turned out to be wrong there too (OV-39): an order is releasable *or* blocked, never both. Both rails now carry one quantity per block.

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

### 6.5 Headline warning consistency

The Morning Brief is not the only source of operational warnings on Overview.
OV-152 therefore prevents the positive headline from relying on
`morningBrief.hasUrgentIssues` alone.

`OverviewFT2Page` consolidates the relevant page-level state into
`operationalWarningState`:

- `warning` when visible idle-operator alerts or blocked order-pool items exist
- `clear` when those sources have resolved without warnings
- `unknown` while entitlements, floor planning, or enabled warning sources are
  loading or have failed

`OverviewModuleFT2` combines that state with Morning Brief decisions and blocked
revenue. Positive copy such as “All operations are on track” is rendered only
when every relevant source is resolved and clear. Warning states use
action-oriented copy and never claim that everything else is on track.

Verification completed locally on August 5, 2026: the module build passed, the
focused TypeScript error was resolved, and the rendered Overview showed
“3 decisions pending. Review the issues below.” alongside the visible warehouse
warning. Automated regression coverage remains optional and non-blocking.

---

### 6.6 Live markers on bins (OV-129, OV-129b/c/d)

Identity stays inline, live state goes on the box face. Bins keep their
`location_code` label from `IsometricBox`; work state renders as a badge on the
top face.

The warehouse name is no longer SVG world geometry. Overview renders the
current warehouse as screen-aligned UI chrome at the top-left of the canvas.
This keeps warehouse identity readable at every zoom and prepares the same
surface for the canonical multi-warehouse selector without changing floor
geometry.

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

### 6.7 Physical-floor visual grammar

The Live Map uses a state-first colour hierarchy.

**Normal physical state**
- Physical zones share one neutral `storage` colour family.
- Zone identity comes from location label, geometry and position — not a permanent rainbow of zone-type colours.
- Existing per-zone alpha differences remain for structural depth.
- Strong `--zone-*` colours remain available to explicit analytical overlays such as occupancy and stock risk.

**Operational state**
- Strong colour is reserved for information that needs attention now.
- Critical/problem state uses `var(--critical-ink)`.
- Colour is reinforcement only: icon, count and accessible text remain authoritative.
- A problem at a physical bin keeps the underlying physical/analytical fill and adds a critical perimeter/tint plus the `! N` marker.
- This prevents operational state and analytical fill from competing for ownership of the same face colour.

State precedence is:

`physical geometry → analytical fill → operational outline/marker → hover → selection`

The resulting merchant-facing rule is: **if the neutral floor gains strong colour, something operationally meaningful is happening there.**

### 6.8 Warehouse context

Warehouse identity is UI context, not warehouse geometry.

Overview renders the current editable warehouse `name` as a horizontal,
screen-aligned context element at the top-left of the map. It does not
participate in projection, auto-fit bounds or SVG edge-label geometry.

Current behavior:
- one warehouse name is displayed
- no click or dropdown affordance is exposed while no selector handler exists

Future behavior:
- the same element becomes the warehouse selector
- selection swaps the warehouse-scoped floor and operational data together
- UUIDs and root location codes remain internal and are never the primary label

This follows the canonical warehouse-context contract in
`docs/blueprints/product-structure.md`.

### 6.9 Problem Center spatial state (OV-41)

Overview projects unresolved Problem Center work back onto the physical floor
when the task carries a real `problem_bin_location`.

**Data contract**
- Overview consumes the existing `GET /api/v1/wms/problem-center` surface.
- `useProblemCenter` is enabled only when the live map tier is available and a
  placed floor exists.
- Overview polls Problem Center every 15 seconds, matching the live-map activity
  cadence.
- `problemByLocation` counts unresolved tasks by `problem_bin_location`.
- Counts represent **problem tasks, not units**.

**Location truth**
- A non-null `problem_bin_location` may activate the matching physical bin.
- A null `problem_bin_location` is never fabricated onto `PROBLEM` or any other
  warehouse location.
- Null-location tasks remain globally visible through the marker-key total as
  `N location unknown`.
- The floor therefore reports recorded spatial truth rather than inventing a
  plausible location.

**Rendering**
- A bin with one or more unresolved tasks receives the operational critical
  treatment defined in §6.7: `var(--critical-ink)` perimeter/tint while
  preserving its physical or analytical fill.
- The bin also renders `! N`, where `N` is the number of unresolved tasks at
  that exact location.
- The SVG marker exposes an accessible label such as
  `1 open problem at PROBLEM`.
- The marker key reports the total number of unresolved problems and appends
  the unlocated count when applicable.

**Resolution behavior**
Problem state is derived rather than persisted in the canvas. When the
Problem Center task disappears from the API, the next poll removes the
critical perimeter, `! N` badge, and marker-key row automatically. No
separate map cleanup action exists.

Local runtime verification on 2026-08-14 proved both directions with a
temporary `ov41_visual_verification` task at `PROBLEM`: the critical state
appeared while the task was open and disappeared after guarded fixture
cleanup and the following poll.

---

### 6.10 Transient hover focus (OV-HOVER-01)

Selection is persistent and orange. Hover is transient and neutral — it answers
"which object am I about to click?" without competing with operational severity.

**Opt-in.** `enableHoverFocus?: boolean` defaults to `false`; only the Overview
main map passes it. Every other `IsometricCanvas` consumer is unchanged.

**Physical bins.** The hovered bin takes a `var(--ink-2)` stroke at 1.4 on the
top face. Unrelated bins drop to `opacity 0.55` — softened, still readable.
Analytical `isDimmed` stays stronger at `0.25` so the two never read alike.

**Synthetic rail.** Rail blocks share the grammar: `var(--ink-2)` perimeter on
all three faces when hovered, and they soften to `0.55` while a physical bin is
hovered. Hovering a rail block softens the physical floor.

**Protected from softening.**

- the selected zone — selection outranks hover
- any bin with unresolved Problem Center tasks
- any rail block with `tone === 'critical'`
- warehouse/lane/shelf frames are not hover targets at all

Severity is never converted into interaction state: a critical object stays
critical while its neighbours soften.

**Stale-state guard.** `activeHoveredCode` resolves only when the hovered code
is still a rendered physical bin, so a filter or layout change cannot leave the
floor dimmed against a bin that no longer exists.

Hover neither navigates nor mutates. Click still owns selection and deep-links.

**Known gap.** Rail blocks do not soften each other — `stationOpacity` keys on
`activeHoveredCode` only. Hovering one rail block leaves its siblings at full
opacity. Registered as OV-HOVER-01b, not fixed here.

**Verified.** Physical bins `A-3` and `PACK-1`, and rail blocks `Order Pool`
and `Blocked`, on shop 1 (23/23 placed zones). Blocked held full red under both
physical and rail hover, proving the critical exemption.

### 6.11 Location Pulse (OV-HOVER-02)

Hover identifies an object; Location Pulse says what is happening there. A
~228px read-only plate, not a mini-dashboard: title plus at most six
two-column rows, answerable in about two seconds.

**Ownership split.** `OverviewFT2Page` composes the payloads; `IsometricCanvas`
only anchors, clamps and renders. The `LocationPulse` type carries no warehouse
vocabulary — `title`, optional `subtitle`, and `rows` of `{label, value, tone}`.
Row wording and tone are merchant-facing product decisions and stay next to the
OV-40 label rules, not inside a renderer shared with floor-planning.

Props: `locationPulseByCode` (keyed by `location_code`) and `stationPulseById`.
An absent key renders no plate, which is how an object with nothing to say
stays silent. A physical bin outranks a rail block; only one plate at a time.

**Rows are omitted at zero**, never padded. `On hand` is the sole exception —
every bin can answer it truthfully, so a calm bin legitimately shows one row.
Order: On hand, Operators, Open problems, Awaiting stow, At dock, Last activity.
Operators fold phase into one row (`2 · 1 picking, 1 packing`) rather than
consuming three.

**Last activity** reuses `max(last_scan_at, batch_activity_at)`, which the
Overview reducer already computed for staleness grading and discarded. It is
now preserved as `LiveBinActivity.lastActivityAt`. No second fetch. The row
appears only when an operator row produced a clock — absence is silence, never
"never".

**Synthetic rail** carries `Orders` plus a plain-English `State`, mapped from
station id in the page (`Needs attention`, `Ready for release`,
`Packed · awaiting carrier`, `Shipped today`).

**Not shown, deliberately.** No occupancy percentage — capacity is a
`rack_levels × 10` visual proxy, not merchant truth. No blocked revenue — the
`$180` elsewhere on Overview has no per-rail-stage source. Neither ships until
its data contract is audited.

**Placement.** HTML/MUI overlay, `pointerEvents: 'none'`, outside the
projection bbox and auto-fit. The SVG has no viewBox, so user units are
container pixels 1:1; a plate position is `project(...).sx + offset.x`.

The anchor spans the object rather than marking a point: `x` is the right edge,
`leftX` the left. Flipping mirrors around the anchor, so a single mid-object
point overlaps on whichever side it lands — this was observed twice during
implementation, first anchoring at the bar centre and again at the far corner.
Vertical position clamps within the container.

No click, no pinning, no pointer-following in v1.

**Verified.** Bins `A-4 · PICK` and `SHIP-1 · SHIP` rendered the calm
single-row state against empty occupancy; `BLOCKED` rendered `Orders 3` in
critical tone with `State Needs attention`, clearing the block after the anchor
fix. Rail blocks other than Blocked are unreachable at present — they are
zero-count and omitted by OV-40.

### 6.12 Dock bay geometry (ZONE-SHAPE-01)

Every zone rendered as an identical rectangle, so a merchant could not tell a
loading dock from a storage bin without reading the label. `ship` and `receive`
zones now carry a truck berth carved out of the slab — recognisable by
silhouette before the label is legible.

**Scope.** `ship` and `receive` only. Other zone types have no unambiguous
physical shape, and inventing one per type turns the floor into iconography.

**Direction is derived, not stored.** `warehouse_locations.orientation` exists
but is 0 on every row and no renderer reads it, so there is no truth to honour.
The bay faces whichever building edge the zone sits nearest, measured against a
world-space bbox of physical zones.

That bbox is deliberately NOT `bboxRef`: that one projects to screen space and
includes synthetic stations. Since `sx = (wx - wy) * TILE_W/2` collapses both
world axes into one, a screen bbox cannot answer "which edge is this near", and
`flipped` would mirror north into south.

When the two nearest edges are within 15% of each other the zone is effectively
cornered and no bay is drawn — a dock facing the wrong way is worse than a plain
rectangle. The Core upgrade teaser's RECEIVE zone hits this case (east 0.118 vs
south 0.162) and is correctly left unchanged.

**Projection shading rule.** `sy = (wx + wy) * TILE_H/2 - wz * LEVEL_H`, so +x
and +y both run toward the viewer and the near corner of any box is
`(wx+ww, wy+wd)`. Exactly two faces of a solid are ever visible: the +y face
(`lFill`) and the +x face (`lFillDark`). A wall facing -x or -y sits behind the
solid and must not be drawn.

**The bay is a cut, not a container.** There is no bay floor and no lid — the
notch in the top face lets the ground show through. Only walls of the remaining
solid are drawn, and only those facing the viewer:

- **south bay** — the +y face splits into two segments, plus the back of the
  recess (facing +y) and the single +x-facing return
- **east bay** — the +x face splits, plus recess back and one +y-facing return
- **north and west bays** cut the far edges, so every exposed wall faces away
  and nothing beyond the top-face notch is drawn

Three attempts were needed to reach this. Drawing invisible back walls produced
an L-shaped step; adding a bay floor at `z1` produced a lid sitting flush in the
notch. Both are the same error — treating the bay as a box rather than absence.

Bay proportions: 40% of the wall-facing extent, 35% deep.

**Verified.** Shop 1: SHIP-1 (centre 9.05, 8.75) resolves south; RECEIVE-1
(centre 10, 2.75) resolves north. Both render as berths; all other zones
unchanged.

### 6.13 Multi-select consumers — `onZoneClick` (RECOUNT-CTA-33b)

`onSelect(locationCode | null)` is single-selection state: it toggles one code
and emits `null` when the current selection is cleared. A consumer that needs
independent multi-selection cannot reuse that toggle-to-null semantic without
changing it for every other consumer.

**Additive.** `onZoneClick?: (locationCode: string) => void` fires on every
physical-zone click, alongside the existing `onSelect` callback — it does not
replace or alter `onSelect`. Every existing single-select consumer, and
`onSelect`'s own toggle/`null` behaviour, is unchanged.

First consumer: the WMS Reconcile-inventory dialog (`WmsModuleFT2`), which
owns its own multi-select list independently of the canvas's internal
single-selection state, and drives `focusedBins`/`focusTone="risk"` from that
list.

**Verified.** Independent per-bin toggle, multi-bin highlight, and deselect —
live-browser verified in the Reconcile-inventory dialog canvas.

### 6.14 Selected-label and dark-mode zone contrast (RECOUNT-CTA-33b)

Two contrast defects in `IsometricBox`, both live-browser verified in light
and dark mode — not covered by an automated visual-regression check:

- **Selected label on a coloured overlay.** The top-face label used
  `var(--accent)` unconditionally when selected. `focusTone="risk"` (and the
  occupancy heatmap's `fillOverride`) paint a saturated red/orange top face,
  and `--accent` is also orange, so a selected label on that fill lost
  contrast. The label now falls back to `var(--bg)` — the token this file
  already uses for text on saturated fills (the Problem Center badge, the
  edge-label plate) — whenever a colour overlay is active; the unselected /
  base-fill case is unchanged.
- **Dark-mode `--zone-storage`.** Every physical-zone base fill resolves to
  the single `--zone-storage` RGB token regardless of `colorKey`
  (`ZONE_COLORS`/`ZONE_STROKE`), and unlike every other `--zone-*` token it
  was identical between light and dark schemes. Its value (`36,48,80`) sits
  within 5 points of lightness of dark-mode `--bg-2` (`28,39,64`) at the same
  hue/saturation, so unselected and dimmed bins were nearly indistinguishable
  from the dark canvas. Corrected the dark-scheme value only, same
  hue/saturation family, lifted lightness — no new colour system, no change
  to the light-mode value or any other `--zone-*` token (those stay
  mode-invariant on purpose, same rule as `--accent`).

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
- Header summary line carries only the count: "N decisions pending. Review the issues below." OV-DATA-02 keeps revenue semantics on each signal row: Fulfillment SLA amounts render as "order value"; blocked-order amounts render as "blocked revenue". Local verification is complete; production certification is pending deployment.
- Morning-brief manual refresh is localized to the brief. OV-UX-18 keeps the canonical query identity stable (`['overview', 'morning-brief']`), performs manual refresh via `/api/v1/modules/overview/morning-brief?force=true`, preserves existing brief data while pending, and does not invalidate/refetch floor/live-map queries. The map and unrelated Overview content remain visually stable during refresh. Localhost live-browser verification PASS; production certification PENDING deployment. Deferred separately: OV-UX-18B (refresh icon pending animation too subtle / not reliably visible).
- Business Pulse has three rows in the merged right rail: **Blocked**, **Revenue today**, and **At risk**. OV-DATA-03 removed `"Collected today"` because its former `realized_revenue` source was not today-scoped collection data. `Revenue today` is paid-order net revenue bucketed by `orders.order_created_at` in the merchant timezone. Local automated and live-browser verification PASS; production certification PENDING deployment.

---

## 9. Onboarding

One coach mark on first visit using the existing three-layer system (spotlight coach marks, resolved at page level per module boundary rule):

- Spotlight target: the map canvas area.
- Text: "This is your floor, live. Everything in motion, in one place."
- Trigger: `activation_audit_events` — fires once on first map render, never repeats.
- Dismiss: "Got it" — same pattern as Order Pool and Sourcing spotlights.

---

## 10. Future-proofing notes (design only — no build now)

- **Multi-warehouse (#963):** the screen-aligned warehouse context is the future selector surface. Selecting another warehouse swaps the warehouse-scoped `zones`, `stations`, and related live data together. `SyntheticStation` already carries `warehouse_id`, so the apron contract needs no migration. Do not introduce a competing warehouse-tab pattern on the map.
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
| OV-128 | Warehouse identity competed with floor labels when rendered inside projected geometry | Replaced projected slab-edge label with a horizontal screen-aligned warehouse context, future-ready for the canonical multi-warehouse selector | ✅ |
| OV-129 | Stow pressure aggregated to a scalar pinned to a hardcoded RECEIVE-1; per-bin detail discarded | `by_location` added to live-activity; badges on bin top faces | ✅ |
| OV-129b | Bare integer badge could not say what it counted | Arrow-into-tray glyph prefix | ✅ |
| OV-129c | Glyph alone does not teach meaning | `showMarkerKey` — glyph + words, independent of `showLegend` | ✅ |
| OV-129d | No floor-wide total | Summed from `by_location` units | ✅ |
| OV-131 | Receive had no signal on the map; receive_jobs has no location column | Badge from inventory_units.current_location_code where status='received'; key row "N units at dock" | ✅ |
| OV-135 | Reviewer batches used fabricated totals and omitted canonical order, line-item and pack-scan state | Seed only eligible orders; derive real totals; create picking, picked, packing and packed states with reconciling scan evidence | ✅ local |
| OV-136 | Active operator markers were ambiguous, and packing operators inherited their final picking location | Add semantic operator pills and phase counts; derive packers from pack scans and anchor them to the active pack zone | ✅ local |
| OV-145 | One-level bins rendered as raised top faces without closed vertical sides | Normalize rendered rack levels to at least one and draw one filled side-face tier for every non-flat bin | ✅ local |

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
| **OV-145 geometry repair** ✅ local | Close one-level bins with a filled vertical tier while preserving existing multi-level bands, occupancy and zone styling | OV-145 |
| **v3** — Parked | WMS strip in pulse card (Pool · Batches · Stow chips) · token animation · wave release from apron · order-detail drill from tokens | FP-OV-07 (remaining) |

Update `WarehouseGrid.md` consumer map and `product-structure.md` §5 and §11 after each block ships.

| OV-132 | P1 | Operators vanished after 4h; markers and idle alerts disagreed | CLOSED — liveness from pick_batches, freshness graded client-side |
| OV-154 | P1 | Footer claimed an idle operator on a batch whose clock was 113s old | CLOSED — idle alerts stranded on completed batches now resolved by a sweep in idleAlert.service.ts |
| OV-157 | P1 | Outbound apron never rendered; map ended at packing | CLOSED — shippedToday and packedNotShipped added to live-activity; outbound station constructed |
| OV-157b | P1 | Apron suppressed whenever shippedToday was 0 | CLOSED — stationPlacements filters on either stack having weight; divisor moved to stackTotal |
| OV-158 | P1 | No shipped or staged orders existed on the reviewer tenant | CLOSED — seed_reviewer_outbound.ts |
| OV-159 | P2 | Urgent stack fills the whole bar when it meets or exceeds count | CLOSED by OV-40 — one stage per volume; the two-segment encoding is gone |
| OV-39 | P1 | Apron badge showed `count` while the bar represented count+urgent; type doc claimed nested, both callers passed disjoint | CLOSED — disjoint documented, badge showed the total (superseded by OV-40) |
| OV-40 | P1 | One block per rail carried two stages separable only by colour, with `showLegend={false}` — read "Order Pool · 3" on a red block while the pool was empty. Also a WCAG 1.4.1 failure | CLOSED — split into named, independently counted, ranked blocks |
| OV-41 | P1 | Open Problem Center tasks had no spatial representation on the Overview Live Map | CLOSED — unresolved tasks are counted by real `problem_bin_location`; physical bins receive critical outline/tint + `! N`; null locations remain unlocated rather than being fabricated onto the floor; 15s polling removes state automatically after resolution |
| OV-HOVER-01 | P2 | Physical zones had pointer cursor and click selection but no feedback identifying the object under the pointer | CLOSED — opt-in `enableHoverFocus`; neutral `var(--ink-2)` focus, unrelated objects soften to 0.55; selection, critical bins and critical rail blocks exempt |
| OV-HOVER-01b | P3 | Rail blocks do not soften sibling rail blocks on hover | OPEN — `stationOpacity` keys on `activeHoveredCode` only |
| OV-HOVER-02 | P2 | Hover identified the object under the pointer but said nothing about it | CLOSED — read-only ~228px pulse plate; page composes payloads, canvas renders; rows omitted at zero; occupancy % and blocked revenue withheld pending a truthful source |
| OV-HOVER-02a | P2 | Pulse plate covered the hovered object — anchoring at a mid-object point overlaps on whichever side the flip lands | CLOSED — anchor spans the object (`x` right edge, `leftX` left edge); flip mirrors off the far edge |
| ZONE-SHAPE-01 | P2 | Every zone rendered as an identical rectangle — a loading dock was indistinguishable from a storage bin | CLOSED — `ship` and `receive` carry a dock bay cut from the slab on their nearest building edge; direction derived from a world-space bbox, cornered zones suppressed |
| ZONE-SHAPE-01a | P2 | Dock bay inner faces assume the standard projection; `flipped` mirrors the geometry correctly but inverts which faces are viewer-facing | OPEN — reachable on `WmsDisplayPage`, which omits `showControls` (defaults true). Overview passes false and is unaffected |
| ZONE-SHAPE-01b | P3 | 15% ambiguity threshold untuned against real merchant layouts | ✅ CLOSED — explicit `dock_face` warehouse truth + conservative Auto fallback; API, DB constraint, Canvas control, renderer, CRUD and localhost visuals verified 2026-08-15 |
| OV-160 | P2 | Order Pool apron fell to 0 after the outbound seed claimed the last eligible orders | CLOSED — Production’s 42 orders reconcile exactly: 13 already batched, 8 blocked, 21 fulfilled, and 0 ready for release. The API and database agree; local also correctly reports zero eligible orders. |
| OV-146 | P2 | Prod has 3 pack stations; first-active-zone heuristic stacks all packers on PACK-01 | Open |
| OV-147 | P1 | Prod shop 1 has zero pack_scan_log rows; prod's 4-batch shape predates OV-135 and came from the Sprint 2/3 hand repair | Open — no longer blocks the map |
| OV-148 | P1 | Batches b8ad06f2 and 99495ddc attributed to user 1 (<contact@lasyncro.com>) — the reviewer is seeded as their own operator. seed_reviewer_activity.ts falls back to owner?.id | Open |
| OV-149 | P2 | pack_last_activity_at NULL on all prod batches incl. the active packing one | Open — non-blocking, packer query falls back to pick_last_activity_at |
| OV-150 | P2 | "2 active operators · 2 idle" is self-contradictory when stale === total | Open |
| OV-151 | P2 | Pack queue badge and operator pill are two unlabelled numbers on one zone. Relocate packQueueCount to the flow rail — not a deletion | Held, coupled to the rail |
| OV-152 | P1 | Positive headline could contradict visible idle-operator or blocked-order warnings | CLOSED — consolidated operational warning state now suppresses positive copy while warnings exist or relevant sources are unresolved; build and visual verification passed locally |
| CANVAS-COLOR-01 | P3 | Five hardcoded colour literals in IsometricCanvas vs ZONE_COLORS' var(--zone-{type}) | Open |
| BUILD-01 | P2 | No tsc --noEmit gate between commit and Docker build; tsx strips types without checking | Open |

#### ZONE-SHAPE-01b — explicit dock-face truth

Dock orientation is now persisted warehouse truth rather than renderer-only
inference.

`warehouse_locations.dock_face` is a nullable enum:

- `north`, `south`, `east`, `west` — explicit merchant-selected opening
- `none` — deliberately render the dock as a solid zone
- `NULL` — Auto; preserve legacy layouts by resolving the nearest world-space
  floor edge

Renderer precedence in `modules/shared/src/ui/IsometricCanvas.tsx` is:

1. explicit cardinal `dock_face`
2. `none` → no bay
3. `NULL` → automatic nearest-edge resolution
4. ambiguous Auto geometry → no bay rather than guessing the wrong direction

The existing Auto ambiguity threshold remains `0.15`; it is now only a safe
fallback, not the source of truth for explicitly configured docks.

Floor Planning → Setup → Canvas exposes **Dock opening** only for `ship` and
`receive` zones, with `Auto / North / South / East / West / None`. Writes flow
through `PATCH /api/v1/floor-planning/zones/:locationCode`.

Backend invariants:

- explicit `dock_face` is rejected for non-`ship`/`receive` zones
- changing a dock zone to another `zone_type` clears stale `dock_face`
- invalid enum values return HTTP 400
- DB constraint enforces the same dock-zone ownership, including rejecting an
  explicit face when `zone_type IS NULL`

Schema history:

- `20260815131000_0149_add_dock_face_to_warehouse_locations.ts`
- `20260815154500_0150_harden_dock_face_zone_check.ts`

`warehouse_locations.orientation` remains geometric rotation in degrees and is
not used as dock-facing truth.

### ZONE-SHAPE-01c-ii — dock creation defaults to `none`

`POST /api/v1/floor-planning/zones` now writes `dock_face='none'` when a
`ship`/`receive` zone is created without an explicit direction. Non-dock zone
types remain `NULL` — migration 0150's check constraint rejects any face on
other types.

Rationale: `NULL` means Auto, and Auto renders a solid slab whenever geometry
is ambiguous (`DOCK_BAY_AMBIGUITY = 0.15`). That reads as a settled merchant
choice nobody made. `none` is the same visual result stated honestly, and the
merchant changes it from the Floor Planning inspector.

Consequence: explicit `dock_face: null` is no longer reachable at creation for
dock zones. Auto remains reachable via `PATCH`, which treats `null` distinctly.

Existing rows are untouched — this is creation-time only. Legacy ambiguous docks
remain open as ZONE-SHAPE-01c; surfacing them in the inspector is ZONE-SHAPE-01d.

### ZONE-SHAPE-01c-i' — seeded docks state their facing

All three seed sites now write an explicit `dock_face`:

| Site | RECEIVE-1 | SHIP-1 |
|---|---|---|
| `apps/backend/seeds/dev_seed.ts` (two blocks) | `east` | `east` |
| `apps/backend/src/scripts/seed_reviewer.ts` | `west` | `south` |

Auto could not be relied on. Against the dev layout's world box, SHIP-1 sits
0.1007 from its second-nearest edge — inside `DOCK_BAY_AMBIGUITY` (0.15) — so
Auto correctly declines and the dock renders solid. For a seeded warehouse the
layout's author *is* the merchant, so declaring the face is stating intent, not
inferring it from ambiguous geometry.

`dev_seed` docks share the easternmost column (x 9-11); `east` is also
viewer-facing under the isometric projection, so the carve is visible.

`seed_reviewer`'s RECEIVE-1 centres at (3, 2.5) — genuinely the west edge. West
faces away from the viewer, so its carve will not be visible. That is a
rendering limitation tracked as ZONE-SHAPE-01a, not a reason to misstate the
layout.

Not runtime-verified — proving it requires a reseed, which destroys the dev
database. Verify on the next natural reseed.
