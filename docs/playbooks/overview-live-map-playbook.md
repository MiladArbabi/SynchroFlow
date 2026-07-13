# LaSyncro — Overview Live Map Playbook

> **Scope:** The live-map redesign of the Overview module — concept, architecture, phasing, and every implementation decision locked in the July 2026 workshop.
> **Supersedes:** The layout section of `overview-module-playbook.md` (§1 triage layout). The data pipeline, alert spine, and seeding runbook in that document remain unchanged and authoritative.
> **Companion docs:** `docs/blueprints/WarehouseGrid.md`, `docs/blueprints/WarehouseModule.md`, `overview-module-playbook.md`
> **Last updated:** July 13, 2026 — Growth+ live-map gate and Core upgrade teaser shipped and visually verified.
> **Status:** v1-A ✅ · v1-B ✅ · v2 ✅ · v2.1 Core teaser ✅ · v3 parked.

---

## 1. Why this exists — the product thesis

The ICP (1–20-operator SMB merchant, own warehouse, $100K–$50M, high SKU complexity) currently starts every operational day by reconstructing reality from fragments: Shopify for order status, a spreadsheet for inventory, the floor lead for what's stuck, the carrier portal for what's moving. The reconstruction ritual is the problem laSyncro is built to eliminate.

The current Overview (triage-first signals + Business Pulse rail) solves the *decision* side of that problem. The live map solves the *spatial intuition* side: instead of reading "8 orders past SLA" in a table, the owner sees a growing red stack at the order apron. Instead of asking the floor lead what's moving, they see picker positions and batch progress on the floor. One picture replaces the reconstruction ritual.

**Design thesis:** numbers overwhelm; space orients. The map is not a dashboard widget — it is the front door to operational control. Every number that has a physical location on the floor should live there first and appear as text only in the 25% mirror card.

---

## 2. Locked layout

```
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
|---|---|---|
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
|---|---|
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

### 6.1 Response shape

```typescript
{
  pickerPositions: {
    operator_id: string;
    location_code: string;      // last scan location from pick_scan_log
    last_scan_at: string;       // ISO timestamp
    batch_id: string;
  }[];
  activeBatches: {
    batch_id: string;
    status: 'picking' | 'packing';
    picked_lines: number;
    total_lines: number;
  }[];
  stowPressure: {
    pending_count: number;      // stow_tasks WHERE status = 'pending'
    anchor_location: string;    // 'RECEIVE-1' — the physical stow zone
  };
}
```

### 6.2 Derivation queries

- `pickerPositions`: `SELECT DISTINCT ON (operator_id) operator_id, location_code, scanned_at FROM pick_scan_log WHERE shop_id = $shopId AND scanned_at > NOW() - INTERVAL '4 hours' ORDER BY operator_id, scanned_at DESC`
- `activeBatches`: `pick_batches` WHERE `status IN ('picking','packing')` + line counts from `pick_batch_orders`
- `stowPressure`: `COUNT(*) FROM stow_tasks WHERE shop_id = $shopId AND status = 'pending'` + hardcoded anchor `RECEIVE-1` (single warehouse phase)

### 6.3 Poll interval

Overview polls every 15s. `useWarehouseGridOccupancy` already polls 60s — live-activity is a separate hook with its own `refetchInterval: 15_000`.

### 6.4 `liveActivity` prop wiring

`IsometricCanvas` currently has no `liveActivity` prop — that lives on `WarehouseGrid` (the 2D grid, WG-11). For the isometric canvas, picker positions render as small dot markers at the bin's centroid (projected x,y). Add to `IsometricCanvasProps`:

```typescript
liveActivity?: Record<string, { operatorCount: number; hasActivePick: boolean }>;
// keyed by location_code — same shape as WarehouseGrid.liveActivity for consistency
```

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
|---|---|---|
| FP-OV-01 | No IsometricCanvas in Overview | v1-B: wired via `useWarehouseGrid` in page layer |
| FP-OV-02 | No warehouse hooks in `OverviewFT2Page` | v1-B: `useWarehouseGrid` + `useWarehouseGridOccupancy` added |
| FP-OV-03 | No standalone `useOrderPool` hook | v1-B: extracted from `OrderFlowPage` into `apps/frontend/src/pages/wms/useOrderPool.ts` |
| FP-OV-04 | WG-11 — no live-activity endpoint | ✅ CLOSED July 2026 — `GET /api/v1/wms/live-activity` live, `useWmsLiveActivity` 15s poll, picker dots on `IsometricCanvas` |
| FP-OV-05 | Layout inverted vs target | v1-A: layout flip, map 75% / pulse card 25% |
| FP-OV-06 | No tier/zone gate | v1-A: three-branch gate per §3 |
| FP-OV-07 | BusinessPulse is revenue-only, no WMS signals | ✅ PARTIAL July 2026 — picker dots wired; WMS strip (Pool · Batches · Stow chips in pulse card) remains v3 |
| FP-OV-08 | `operationalControl = null` dead code | v1-A: removed |
| FP-OV-09 / OV-MAP-001 | Core users had no visible path to discover or upgrade to the live operations map | ✅ CLOSED July 13, 2026 — compact static map teaser added below Core triage with dismissal, billing CTA, and conversion events |

---

## 12. Implementation order

| Block | Tasks | Issues closed |
|---|---|---|
| **v1-A** ✅ | Layout flip · tier/zone gate · dead code removal · pulse card merged layout | FP-OV-05, FP-OV-06, FP-OV-07 (partial), FP-OV-08 |
| **v1-B** ✅ | Page-level grid+occupancy hooks · `useOrderPool` wired · `IsometricCanvas` embed · `SyntheticStation` apron (inbound pool + blocked sub-stack) · `LiveBinActivity` type | FP-OV-01, FP-OV-02, FP-OV-03 |
| **v2** ✅ | `GET /api/v1/wms/live-activity` · `useWmsLiveActivity` 15s poll · picker dot markers on `IsometricCanvas` | FP-OV-04, FP-OV-07 (partial) |
| **v2.1** ✅ | Core triage-preserving Growth teaser · static `IsometricCanvas` preview · session dismissal · billing CTA · conversion events | FP-OV-09 / OV-MAP-001 |
| **v3** — Parked | WMS strip in pulse card (Pool · Batches · Stow chips) · token animation · wave release from apron · order-detail drill from tokens | FP-OV-07 (remaining) |

Update `WarehouseGrid.md` consumer map and `product-structure.md` §5 and §11 after each block ships.
