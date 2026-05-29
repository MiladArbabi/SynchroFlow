# Warehouse Analytics Module — Blueprint

**Module:** `@lasyncro/wms` (Analytics submodule)
**Route:** `/wms/analytics`
**Tier:** Growth
**Access:** Owner / admin (operators have no access on web; operators see only dispatch/jobs on mobile)
**Status:** 🟢 Complete · All zones implemented · Floor Display live
**Last updated:** 2026-05-29 (implementation complete)

---

## 1. Purpose

Warehouse Analytics is the **management and floor-culture surface** for warehouse operations. Two distinct consumers, two distinct surfaces:

- **Owner page** (`/wms/analytics`) — laptop-bound, dense, three-row scroll-free dashboard. Answers the owner's daily and weekly questions: who's slipping, where is work stuck, what is exception cost, what is our cost per fulfilled order.
- **Floor Display** (`/wms/analytics/display?token=…`) — TV-bound, large-type, rotating, no-auth (token-bound) read-only view. Shows team-aggregated pace against required CPT throughput. Creates ambient pace pressure on the floor without surveillance.

The split is fundamental: **Analytics = owner; Display = floor.** Individual operator metrics never appear on the Display.

---

## 2. Design Principles (Locked)

1. **Scroll-free** — entire owner page fits in one viewport (~1440×720). Density over decoration. Overflow opens side drawers, never expands inline.
2. **No surveillance theatre on the floor** — Display shows team-aggregated UPH only, no operator names. Per-operator management lives on the owner page.
3. **Personal baseline by default** — operators are compared to themselves, not each other. Team-average is a secondary toggle.
4. **Cross-module linkage** — every signal that points to a problem has a CTA to the resolution surface (Problem-center, Orders, Inventory).
5. **Dumb display** — Floor Display has no interaction, no pause, no cursor. Rotation is the contract.
6. **Soft schedules** — operator scheduling is a capacity-projection tool, not a hard lock. Off-schedule activity is flagged weekly, never daily.
7. **Editorial closing line** — the cost zone ends with a server-generated sentence summarising the period vs prior period. Not a chart.

---

## 3. Surface Architecture

### 3.1 Owner page (`/wms/analytics`)

12-column grid, three rows.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ROW 1 — Zone 1 — Today's Capacity (live, ignores date toggle)        │
│ Pipeline strip · operators-on-shift · CPT countdown · on-track signal│
├─────────────────────────────────────┬───────────────────────────────┤
│ ROW 2L (7 cols)                     │ ROW 2R (5 cols)               │
│ Zone 2 — Operator Performance Board │ Zone 4 — Exception Intel       │
│ (table, personal/team toggle)       │ (Top-5 SKUs + heat grid)       │
├─────────────────────────────────────┼───────────────────────────────┤
│ ROW 3L (7 cols)                     │ ROW 3R (5 cols)               │
│ Zone 3 — Pipeline Stage Velocity    │ Zone 5 — Cost & Throughput     │
│ + receive-to-pickable latency       │ Story (cost-per-order,         │
│ + return-to-restock latency         │ cost-per-unit, exception cost) │
└─────────────────────────────────────┴───────────────────────────────┘
```

**Top-right controls:** 7d / 30d / 90d toggle · Cast button.

**Date toggle behaviour:** drives zones 2, 3, 4, 5. Zone 1 (Capacity strip) ignores it — always live.

### 3.2 Floor Display (`/wms/analytics/display?token=…`)

- Dedicated stripped-down route, no authentication, token-bound, read-only
- High-contrast theme, large type, readable from 5 metres
- Capacity strip (operators-on-shift as a **count only**, no roster + CPT countdown + on-track signal) **pinned across all slots**
- 4-slot rotation, 20 seconds per slot, 80-second full cycle
- No pause, no interaction, no cursor — dwell times equal and fixed
- "Display safe" mode toggle (owner setting) suppresses sensitive data

**Rotation slots:**

| # | Slot | Content | Owner-only data filtered? |
|---|------|---------|---------------------------|
| 1 | Team Performance | Team UPH (live, trailing 60min) · Required UPH (to next CPT) · Standard UPH (30d baseline) · Orders-shipped progress bar · CPT countdown · Colour signal on live vs required (green/amber/red) | ✅ No operator names |
| 2 | Pipeline Velocity | Horizontal stacked bar of stage time + receive-to-pickable + return-to-restock | — |
| 3 | Exception Top-5 | SKU-only list, no operator attribution on display | ✅ SKUs only |
| 4 | 3D Warehouse Map | IsometricCanvas reused with auto-orbit (1 rotation / 40s), live scan-pulse on bins, PROBLEM bins amber/red, no bin labels | ✅ Activity only, no names |

---

## 4. Zone Specifications

### Zone 1 — Today's Capacity (live)

**Signals (left-to-right):**

- Pipeline mini-visualisation: Released → Picking → Packing → Ship-ready → Shipped (counts at each stage)
- Operators-on-shift: count + small avatars (owner page); count only (display)
- CPT countdown: `1h 47m to 4:00pm cutoff`
- On-track signal: green / amber / red light + label

**Computation:**

- Pipeline counts: live from `order_warehouse_status`
- On-shift count: operators with active scheduled hours covering current time, intersected with active sessions
- CPT countdown: shop CPT − `now()`
- On-track: required UPH derived from `(unfulfilled_orders × avg_units_per_order) / (operators_on_shift × hours_to_cpt)`; compared to trailing-hour live UPH

**Refresh:** every 60 seconds (live tier, distinct from date-range zones)

---

### Zone 2 — Operator Performance Board (owner only)

**Columns:**

| Column | Source | Notes |
|---|---|---|
| Name | `users.first_name` + `last_name` | |
| Role | `shop_memberships.role` | operator/admin/owner |
| Picks | `inventory_movements` where `movement_type = 'sale'` AND `picked_by = user_id` AND `created_at` in window | |
| Packs | `pack_scan_log` aggregated by `packed_by` | |
| UPH | `units_picked / hours_active` | Δ vs personal baseline OR team average (toggle) — green/amber/red |
| Accuracy % | `1 − (exceptions / picks)` | |
| Exceptions | `pick_exceptions` count by `raised_by` | Click → Problem-center filtered |
| Avg batch time | `pick_completed_at − pick_claimed_at` median | |
| Scan-source mix | `inventory_movements.scan_source` distribution | camera / USB / manual |

**Toggle (top-right of table):** `Compare to: [Personal baseline] [Team average]`

**Row visibility:** 5–8 rows by default. Larger teams → "View all" opens side drawer with full list and per-operator deep-dive.

**Row click:** opens operator side drawer (matches Orders detail panel pattern) with extended window (90d) and recent activity feed.

---

### Zone 3 — Pipeline Stage Velocity

**Visual:** horizontal stacked bar, one segment per stage, segment width = avg time-in-stage.

**Stages:** Released → Picking → Packing → Ship-ready → Shipped

**Plus two latency callouts beside the bar:**

| Latency | Source | Signal |
|---|---|---|
| Receive-to-pickable | `purchase_orders.actual_delivery_date` → first `inventory_movements.sale` for that variant | "Avg 2.4 days · trending ↑" |
| Return-to-restock | `refund_executions.executed_at` → matching `inventory_movements.refund_return` | "Avg 11 hours · improving" |

**Click any stage:** opens drawer with batches dwelling longest in that stage.

---

### Zone 4 — Exception Intelligence

Two stacked panels in the 5-column slot:

**Top panel — Top-5 problem SKUs (this window):**

- Variant title + SKU
- Exception count
- Breakdown by exception type (`item_missing`, `short_pick`, `product_defect`, `packaging_defect`, `order_cancelled`, `wrong_item`)
- CTA: "Fix in Inventory → Problem Center" (variant-filtered)

**Bottom panel — Exception heat grid (small):**

- Rows: operators (top 8 by activity)
- Columns: Pick / Pack
- Cells: exception rate %, coloured intensity
- CTA: "Open Problem-center" (full surface)

**Display mode:** Top-5 SKUs only — no operator attribution, no heat grid.

---

### Zone 5 — Cost & Throughput Story (owner only)

**Three stat numbers stacked vertically:**

| Metric | Computation |
|---|---|
| Cost per fulfilled order | Σ (operator hourly_cost × hours active in window) / orders shipped in window |
| Cost per unit picked | Σ (operator hourly_cost × hours active in window) / units picked in window |
| Exception cost (period) | Σ exception resolution time × resolving operator's hourly_cost |

**Bottom:** server-generated editorial sentence.

Example: *"This week you shipped 312 orders at £1.42 cost-per-order, down from £1.61 last week. Accuracy improved 2.1pp."*

**Empty state (no hourly_cost entered):** Zone degrades gracefully — *"Add hourly costs in Team to unlock cost-per-order →"* with deep link to Members.

---

## 5. Required UPH & CPT Model

### 5.1 CPT (Carrier Pickup Time)

**v1 scope:** single per-shop CPT.

- New field: `shop_operational_settings.daily_cpt_local` (TIME, e.g. `16:00`)
- New field: `shop_operational_settings.daily_cpt_timezone` (already on shop)
- Owner sets in Shop Settings (new section: "Carrier cutoff")
- Drives Zone 1 countdown and required-UPH calculation
- Drives Display slot 1 (Team Performance)

**Data model future-proofing:** if/when per-carrier CPTs are added, a new `shop_carrier_cutoffs` table will be created; the single `daily_cpt_local` becomes the "default" cutoff. No migration cost to current shape.

### 5.2 Three UPH signals on Display slot 1

```
        TEAM UPH       REQUIRED       BASELINE
           23             28             24
         (live)      (to 4pm CPT)    (30d avg)

         [ progress bar: 142 of 180 orders shipped ]

           ⏱ 1h 47m to next cutoff (DPD 4:00pm)
```

- **TEAM UPH (live):** picks confirmed in last 60min ÷ operator-hours active in that window
- **REQUIRED UPH:** `(unfulfilled_orders × avg_units_per_order) / (on_shift_operators × hours_to_cpt)`
- **STANDARD UPH:** trailing 30-day team UPH at the same hour-of-day

**Colour signal on TEAM UPH:** green if ≥ REQUIRED · amber if within 10% · red if below

---

## 6. Floor Display Architecture

### 6.1 Token model

**New table:** `shop_display_tokens`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| shop_id | int FK shops | RLS-bound |
| token_hash | text | bcrypt or argon2 hash; raw token shown once at creation |
| created_at | timestamptz | |
| rotated_at | timestamptz nullable | set when token rotated |
| last_seen_at | timestamptz nullable | updated by heartbeat |
| label | text nullable | "Pick station 1 TV", "Warehouse main" |

**RLS:** standard `shop_id = current_tenant` pattern.

**Endpoint contract for display:**

- `GET /api/v1/wms/analytics/display?token=…` — read-only, public (no JWT), token-validated, returns same payload as `/api/v1/wms/analytics` minus owner-only fields (Zone 2 detail, Zone 5 cost detail)
- `POST /api/v1/wms/analytics/display/heartbeat?token=…` — updates `last_seen_at`

### 6.2 Token management surface (Team Settings, new section)

Owner/admin only:

- "Floor Display" section heading
- List of active tokens with label, created date, last-seen
- Per-token actions: "Copy URL", "Open in new tab", "Rename label", "Rotate token", "Revoke"
- "Generate new display URL" button
- Active-displays counter (computed from `last_seen_at` within 60s)

### 6.3 Display safe mode

Toggle in Team Settings → Floor Display: *"Hide flagged operators from display."*

When enabled, any operator with `shop_memberships.display_hidden = true` is excluded from all display-mode aggregations. Set per-operator on Members details page (PIP/sensitive cases).

Default: off.

### 6.4 3D map slot (rotation #4)

Reuses `modules/floor-planning/src/ui/components/IsometricCanvas.tsx`.

**Display-mode differences from `/floor-planning` Map tab:**

- Auto-orbit: one full rotation per 40 seconds
- Live scan-pulse: every `inventory_movements` insert in last 5 seconds triggers a 1.5s pulse animation on the matching bin
- PROBLEM bins highlighted amber/red (from Problem-center active tasks)
- No bin labels by default
- No interaction handlers wired
- Reads from a polling endpoint every 5 seconds for activity stream

---

## 7. Members Details Page (Foundation — built first)

**Route:** `/team/:userId`

### Owner/admin view

**Identity section:**

- Avatar, name, email, role, member since, last active

**Cost & Shift section (owner/admin write-only):**

- `hourly_cost` (currency follows shop `display_currency`)
- Scheduled hours per weekday (Mon–Sun, hour-based)
- Total hours scheduled this week (computed)
- "Hide from Floor Display" toggle (drives `display_hidden` flag)

**Performance section:**

- Rolling 30-day UPH, accuracy, exception count, scan-source mix
- Trend sparklines for each metric

**Recent Activity section:**

- Last 10 batches claimed (id, claimed_at, completed_at, outcome, exception count)

**Notes section:**

- Free-text owner notes, owner/admin visible only, never exposed to operator
- Soft markdown support

### Operator's own view (read-only)

- Identity (own)
- Own performance trend (UPH, accuracy)
- Own upcoming schedule
- **No** cost, **no** notes, **no** other operators

### Data model additions

**`shop_memberships` extensions:**

- `hourly_cost` numeric(10,2) nullable default null
- `display_hidden` boolean not null default false
- `owner_notes` text nullable

**New table:** `operator_schedules`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| shop_id | int FK | RLS |
| user_id | uuid FK users | |
| weekday | smallint | 0=Sun … 6=Sat |
| start_time | time | local time, shop tz |
| end_time | time | |
| effective_from | date | template versioning |
| effective_to | date nullable | |
| created_at, updated_at | timestamptz | |

Default shop template: created on shop init (Mon–Fri 09:00–17:00). Owner can override per-operator per-weekday.

**Schedule overrides (one-off):** `operator_schedule_overrides` (date-specific) — deferred to sprint-time decision.

---

## 8. Operator Scheduling Behaviour

- **Owner sets the schedule, not the operator** (deprecates the current self-service `operator_availability` model — to be migrated)
- **Hour-based granularity** required for Zone 1 capacity projection
- **Soft model** — operator can log in outside scheduled hours; system flags off-schedule activity in weekly retrospective, never in daily Zone 1
- **Operator mobile view** becomes read-only "your schedule this week"
- **Sprint-time decisions** (parked for build phase): copy-week templates, holidays, PTO marking, drag-shifts grid UI

### Migration of `operator_availability`

Current table is operator-managed boolean per day. Plan:

1. Keep table for backwards compatibility through one release
2. Backfill `operator_schedules` from existing availability data (best-effort defaults)
3. Switch UI to write to `operator_schedules`
4. Deprecate `operator_availability` next release

---

## 9. Build Sequence

Critical path top-to-bottom. Steps 1–2 are blocking. Steps 3+ can parallelise.

| # | Workstream | Blocks | Status |
|---|------------|--------|--------|
| 1 | Members details page + `hourly_cost` field + `operator_schedules` + shop CPT field | All | 🔴 Open |
| 2 | Zone 2 — Operator Performance Board (owner page) | Display | 🔴 Open |
| 3 | Zone 4 — Exception Intelligence | — | 🔴 Open |
| 4 | Zone 1 — Today's Capacity strip | Display slot 1 | 🔴 Open |
| 5 | Floor Display mode + `shop_display_tokens` + rotation engine + 3D slot reuse | — | 🔴 Open |
| 6 | Zone 3 — Pipeline Stage Velocity + latency joins | — | 🔴 Open |
| 7 | Zone 5 — Cost & Throughput Story | hourly_cost from step 1 | 🔴 Open |

---

## 10. API Contracts

### Existing — to extend

- `GET /api/v1/wms/analytics` — currently a stub. Needs full Zone 2–5 payload.
- `GET /api/v1/operators/team` — used for operator list. Needs extension for hourly_cost on owner/admin requests only.

### New endpoints

- `GET /api/v1/wms/analytics/live` — Zone 1 + display slot 1 data (60s cache)
- `GET /api/v1/wms/analytics/operators?window=30d` — Zone 2 data, owner/admin only
- `GET /api/v1/wms/analytics/pipeline?window=30d` — Zone 3 data
- `GET /api/v1/wms/analytics/exceptions?window=30d` — Zone 4 data
- `GET /api/v1/wms/analytics/cost?window=30d` — Zone 5 data, owner/admin only
- `GET /api/v1/wms/analytics/activity-stream?since=…` — 3D map pulse data, 5s polling
- `GET /api/v1/wms/analytics/display?token=…` — public, token-bound, display payload
- `POST /api/v1/wms/analytics/display/heartbeat?token=…` — token last-seen update
- `GET /api/v1/members/:userId` — Members details page payload
- `PATCH /api/v1/members/:userId` — update hourly_cost, display_hidden, owner_notes (owner/admin only)
- `GET /api/v1/members/:userId/schedule` — operator_schedules for a user
- `PUT /api/v1/members/:userId/schedule` — bulk upsert schedule
- `POST /api/v1/shop-settings/display-tokens` — create token
- `GET /api/v1/shop-settings/display-tokens` — list
- `PATCH /api/v1/shop-settings/display-tokens/:id` — rename label
- `POST /api/v1/shop-settings/display-tokens/:id/rotate` — rotate
- `DELETE /api/v1/shop-settings/display-tokens/:id` — revoke

All gated by `authenticateToken + requireFt2 + requireTier('growth')` except the display endpoints which use token validation.

---

## 11. Data Model — Migrations Needed

| # | Migration | Purpose |
|---|-----------|---------|
| M1 | `add_hourly_cost_to_shop_memberships` | Add `hourly_cost`, `display_hidden`, `owner_notes` columns |
| M2 | `create_operator_schedules` | New table per §7 |
| M3 | `add_daily_cpt_to_shop_operational_settings` | Add `daily_cpt_local` time column |
| M4 | `create_shop_display_tokens` | New table per §6.1 |

All migrations include RLS policies matching existing per-tenant pattern.

---

## 12. Invariants — Do Not Violate

1. **Operators never see other operators' performance** — Zone 2 detail and Zone 5 cost are owner/admin only at the API layer, not just UI hiding
2. **Display endpoints are read-only** — no mutation possible via display token
3. **No operator names on Floor Display** — even in rotation slot 1 (Team Performance) and slot 3 (Exception Top-5)
4. **Operator never sees their own hourly cost** in app — that's between owner and operator outside the system
5. **Off-schedule activity is weekly-only** — never surfaced in daily Zone 1 to avoid noise on busy floors
6. **Display rotation does not pause** — dwell times are equal and fixed at 20s
7. **Capacity strip ignores date toggle** — always live; date toggle drives historical zones only
8. **All write endpoints require `requireRole(['owner', 'admin'])`** in addition to tier gating
9. **Token rotation invalidates the previous token immediately** — old TV instances die on next 5-minute refresh
10. **The 3D map on Display is read-only** — no interaction handlers, no zoom, no labels

---

## 13. Open Decisions (Parked for Sprint Time)

- Schedule UI: drag-grid vs form-input for shift editing
- Schedule overrides for one-off days (sickness, PTO marking)
- Copy-week template UX
- Holiday calendar integration
- Per-carrier CPTs (deferred until merchant demand surfaces)
- 3D map pulse animation visual style (subtle vs prominent)
- Display token expiry option (currently rotation-only, never auto-expires)
- Cost trend sparkline style on Zone 5

---

## 14. Cross-Module Dependencies

| Module | Dependency |
|---|---|
| Team | Members details page, `hourly_cost`, `operator_schedules`, display tokens UI |
| Problem-center | Deep links from Zone 4; SKU exception data source |
| Inventory | Deep link from Zone 4 "Fix in Inventory → Problem Center" |
| Floor Planning | IsometricCanvas reuse on display slot 4 |
| Shop Settings | `daily_cpt_local` field |
| Orders / WMS Operations | Pipeline stage data sources for Zones 1, 3 |
| Suppliers | `purchase_orders.actual_delivery_date` for receive-to-pickable latency |
| Returns | `refund_executions` for return-to-restock latency |

---

## 15. Progress Log

| Date | Event | Notes |
|---|---|---|
**Status:** 🟢 Complete · All zones implemented · Floor Display live
**Last updated:** 2026-05-29 (implementation complete)
| 2026-05-29 | AUDIT complete · 13 issues registered (A-01–A-13) | A-13 resolved during audit (IsometricCanvas canonical source confirmed: modules/shared) |
| 2026-05-29 | Migrations M1–M4 applied to base migrations | shop_memberships: hourly_cost, display_hidden, owner_notes; operator_schedules table; shop_operational_settings: daily_cpt_local; shop_display_tokens table. All RLS policies confirmed. |
| 2026-05-29 | Backend Step 2 complete — Members detail + schedule endpoints | GET/PATCH /members/:userId, GET/PUT /members/:userId/schedule, all role-gated |
| 2026-05-29 | Backend Step 3 complete — Analytics service + all zone endpoints | wmsAnalytics.service.ts created; /analytics/live, /operators, /pipeline, /exceptions, /cost, /activity-stream, /display, /display/heartbeat, /display-tokens CRUD — all verified via curl |
| 2026-05-29 | Frontend Step 4 complete — WmsAnalyticsPage full rewrite | useWmsAnalytics + useLiveCapacity hooks; 5-zone scroll-free layout; currency from useEntitlements; row order: Pipeline+Cost top, Operator+Exception bottom; symmetric equal-height rows |
| 2026-05-29 | Frontend Step 5A complete — MemberDetailPage /team/:userId | Identity, 30d performance, recent batches, hourly_cost entry, display_hidden toggle, schedule grid, owner notes; operator own-view restricted; row click from MembersPage wired |
| 2026-05-29 | Open: B-01 Floor Display token management UI (Team Settings) | shop_display_tokens backend ready; frontend UI pending |
| 2026-05-29 | Open: B-02 CPT field in Shop Settings UI | daily_cpt_local column exists; owner cannot set it from UI yet |
| 2026-05-29 | Open: B-03 Floor Display frontend route /wms/analytics/display?token= | Backend endpoint ready; TV-optimised frontend pending |
| 2026-05-29 | Open: B-04 Zone 2 personal/team baseline toggle | Table renders; compare-to toggle not yet wired |
| 2026-05-29 | B-02 complete — Shop Settings page + CPT field | /settings route, CarrierCutoff + SLA + CashFlow sections, CPT persists and drives Zone 1 countdown |
| 2026-05-29 | B-01 complete — Floor Display token management UI | FloorDisplaySection in ShopSettingsPage — create/rename/rotate/revoke tokens, raw URL revealed once |
| 2026-05-29 | B-04 complete — Zone 2 baseline toggle | vs self (absolute thresholds) / vs team (relative to team avg UPH) |
| 2026-05-29 | B-03 complete — Floor Display frontend route | /wms/analytics/display?token= · 4-slot rotation · TV-optimised · heartbeat · IsometricCanvas slot 4 |
| 2026-05-29 | Implementation complete | All blueprint items delivered. GitHub issue #995 open for settings audit. |

---

## 16. Audit Targets (Next Step)

When AUDIT mode begins, scan these targets in order:

**Backend:**

- `apps/backend/src/services/wms/` — current analytics service shape
- `apps/backend/src/api/wms/wms.controller.ts` and `wms.routes.ts` — `/analytics` endpoint stub
- `apps/backend/src/api/operators/operators.controller.ts` — current `availability` model
- `apps/backend/src/api/members/members.controller.ts` — Members data shape
- `apps/backend/migrations/` — confirm shape of `shop_memberships`, `shop_operational_settings`, `pick_batches`, `pick_exceptions`, `inventory_movements`, `purchase_orders`, `refund_executions`
- `apps/backend/src/middleware/require-entitlement.middleware.ts` — `requireTier` pattern

**Frontend:**

- `apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage.tsx` — current stub
- `apps/frontend/src/pages/wms/usePickAnalytics.ts` — current hook
- `apps/frontend/src/pages/ft2-pages/MembersPage.tsx` — Members landing state
- `apps/frontend/src/runtime/navBootstrap.ts` — Analytics registration under Warehouse
- `modules/floor-planning/src/ui/components/IsometricCanvas.tsx` — for slot 4 reuse feasibility

**Cross-cutting:**

- Existing `requireTier('growth')` usage as template
- `display_currency` plumbing in entitlements context
- RLS policy patterns in recent migrations

Audit produces a complete issue register before any code is written.
