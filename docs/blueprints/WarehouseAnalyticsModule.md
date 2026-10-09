# Warehouse Analytics Module — Blueprint

**Module:** `@lasyncro/wms` (Analytics submodule)
**Route:** `/wms/analytics`
**Tier:** Core — canonical `warehouse.analytics: { moduleId: 'wms', minimumTier: 'core' }` in `packages/commercial-policy/src/capabilities.ts`, enforced by `tests/contract/commercial-route-enforcement.contract.test.ts` (corrected 2026-10-08 from the stale "Growth")
**Access:** Owner / admin (operators have no access on web; operators see only dispatch/jobs on mobile)
**Status:** Floor Display live · **GH-1230 data reliability SHIPPED and CLOSED** (`5d7b145f`: committed, CI and deploy green, production smoke accepted; §12A, §15) · **Analytics V1 owner screen (GH-1231, Concept A Visual Four Questions + U1–U8): IMPLEMENTED + LOCALLY CERTIFIED 2026-10-09 · PRODUCTION CERTIFICATION PENDING** (§12B)
**Last updated:** 2026-10-09 (GH-1231 implemented and locally certified, including the owner-ratified UX cleanup, §12B)

> **History vs current.** §§2–11 below are the original 2026-05 specification of the owner page and Floor Display, kept as history. The 2026-05 legacy owner layout, which needed internal workspace scrolling, has been replaced on the owner page. The current owner screen is Analytics V1 (§12B, GH-1231): Concept A, Visual Four Questions (Pace, Flow, Problems, Team), plus a Costs setup strip. It has no primary scroll at 1440×720 and 1024×820, and scrolls naturally when stacked at 390×844. The GH-1230 contract in §12A still applies to it.

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

- `GET /api/v1/wms/analytics/display?token=…` — read-only and public (no JWT). The token is validated first, then the verified shop's current `warehouse.analytics` commercial capability is evaluated before any paid analytics payload is returned.
- `POST /api/v1/wms/analytics/display/heartbeat?token=…` — uses the same current commercial boundary before updating `last_seen_at`; commercially denied displays do not remain artificially active through heartbeat writes.
- Token validity and commercial authority are independent: a valid display token is not rotated or revoked by a tier change. The same token may be allowed, denied, and allowed again as current commercial truth changes.
- Invalid token → `401 INVALID_TOKEN`; valid token with commercial denial → `403 COMMERCIAL_ACCESS_DENIED`; unavailable commercial truth → `503 COMMERCIAL_STATE_UNAVAILABLE`.

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

> **Superseded (as implemented):** the analytics routes in `apps/backend/src/api/wms/wms.routes.ts` are gated by `authenticateToken → requireFt2 → requireCapability('warehouse.analytics')` (Core+, COMMERCIAL-ACCESS-ARCH-01 P0-A2A) `→ requireAction('wms:analytics:read' | 'wms:analytics:display:write')` (owner/admin, GH-1222). The display endpoints validate the token, then evaluate current commercial access (§6.1, GH-1219).

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

## 12A. Data availability & freshness contract (GH-1230 — ratified 2026-10-08)

Applies to the owner page `/wms/analytics`: the 2026-10-08 legacy layout and the GH-1231 Analytics V1 screen that replaced it (§12B). The Floor Display (`/wms/analytics/display`) is not changed by GH-1230.

**Independent requests.** The owner page makes two independent requests, and each carries its own loading, error, and freshness state:

| Request | Feeds | Refresh |
|---|---|---|
| `GET /api/v1/wms/analytics?days=7\|30\|90` (historical composite) | Operator performance, stage velocity, stuck-on-the-floor, problems, cost, throughput trend | 5 min (stale after 60 s) |
| `GET /api/v1/wms/analytics/live` | Live Capacity | 60 s |

One request failing never hides or falsifies the other. Shared resolver: `apps/frontend/src/pages/wms/analyticsAvailability.ts`, a pure function that maps each query to `loading | ready | unavailable | denied`.

**Rules (D1–D6):**

1. **Unknown is never a confirmed zero; an error is never an empty state.** Zero values and the empty-state copy ("Floor is clear", "No exceptions this period", …) render only from a verified successful response. Unavailable areas keep their heading and show "Couldn't load this right now." with a neutral marker (new unavailable labels use "Problems", not "Exceptions").
2. **A failed refresh hides the affected metrics (D1).** Cached values are never presented as current after their query errors; the other query's verified data stays visible.
3. **Window attribution (D2).** Historical data renders only when the server-echoed `days` matches the selected 7d/30d/90d window. While a new window loads it shows loading, never the previous window's values (no placeholder data).
4. **Access denial (D3).** `403 ACTION_FORBIDDEN` shows "You don't have access to Analytics." with no upgrade prompt, Cast or window controls. `403 COMMERCIAL_ACCESS_DENIED` renders the canonical locked `UpgradePrompt` with the server's `AccessDecision` forwarded verbatim (the same presentation as `CommercialGate`); no tier step is invented.
5. **Freshness (D4).** Each request shows a subtle "Updated at HH:MM" (24 h) taken from its own last successful fetch. A failed refresh never advances it.
6. **Response shape (D5).** A 200 response is validated before anything healthy renders, including the nested entries the cards read (operator rows, stage durations, all four aging stages, problem and heat-grid rows, unlocked cost values, trend points). Malformed responses resolve to unavailable and cannot crash the page. Legitimate zero, empty, null and unconfigured values (for example locked cost) remain valid.
7. **Retry (D6).** Retry is hook-local in `useWmsAnalytics` / `useLiveCapacity`: no retry on 401/403; transient errors retry at most 3 times. The global QueryClient and auth interceptor are unchanged. `useLiveCapacity` is shared with `OrderFlowPage`, which inherits the same retry rule.

**Evidence (reported, 2026-10-08, local):**

- Frontend render: `tests/unit/ui/wms/WmsAnalyticsPage.availability.test.tsx` — 24/24 (frontend project; not CI-gated).
- CI-gated contract: `tests/contract/wms-analytics-availability.contract.test.ts` — 37/37; full contract project 951/951 (74 suites).
- Local browser (Playwright, local dev stack): 54/54 runs across 12 scenarios at 1440×720 and 1024×820 — normal load, historical/live/both 500, nested malformed 200, rapid 7d→30d→90d out-of-order, failed background refresh with timestamps, 403 role and commercial (genuine and stale-token), operator direct URL → `/wms`, legitimate zero/unconfigured, and OrderFlowPage shared-hook retry behaviour.

**Limitations:**

- Failures were injected at the browser network layer; these were not real server-generated 403/500 bodies.
- Failed-refresh timing used fake timers.
- Dark mode was covered for 7 of the 12 scenarios.
- Not yet verified in production.
- Document overflow was 0 at both viewports, but the legacy workspace still scrolls internally, so this is **not** a screen-level scroll-free or UX certification (GH-1231).

**Status (as of 2026-10-08):** GH-1230 DATA RELIABILITY LOCALLY VERIFIED; it later shipped and is CLOSED (§15). The owner-screen UX was certified separately under GH-1231: implemented and locally certified 2026-10-09, production pending (§12B).

---

## 12B. Analytics V1 owner screen — IMPLEMENTED + LOCALLY CERTIFIED (GH-1231)

**Status.** IMPLEMENTED + LOCALLY CERTIFIED: 2026-10-09. PRODUCTION CERTIFICATION: PENDING. This section does not claim CI on the GH-1231 commit, deployment or production acceptance. Evidence is in §12B.8.

**Ratification.**

- On 2026-10-08 the product owner ratified the visual target, Concept A (Visual Four Questions), together with the metric and RED-strategy decisions U1–U8 and three correctness safeguards (GH-1231 issue body, "U1–U8 metric and RED-strategy ratification").
- On 2026-10-09, after local browser certification, the owner ratified a presentation-only cleanup (GH-1231 comments "OWNER-RATIFIED FINAL UX UNCLUTTERING" and "OWNER RATIFICATION — Final Analytics UX uncluttering"). It changed no metric, API, SQL, tenant or security contract.

**Implementation.**

- Page: `apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage.tsx`.
- Pure presentation model: `apps/frontend/src/pages/wms/analyticsV1Model.ts`.
- V1 resolvers, layered on the GH-1230 resolver: `apps/frontend/src/pages/wms/analyticsAvailability.ts`.
- V1 blocks: `apps/backend/src/services/wms/wmsAnalyticsV1.service.ts` and `wmsAnalyticsV1.helpers.ts`, served by `apps/backend/src/api/wms/wms.analytics.controller.ts`.

**What this section supersedes.** For the owner page only, it replaces:

- §2 principles 3 and 7;
- the §3.1 three-row layout;
- the owner-page parts of §4 Zones 1–5 and §5.

The Floor Display (§3.2, §5.2, §6) is unchanged and out of scope.

### 12B.1 Composition (implemented)

**Shell.**

- The canonical AppLayout, WMS ModuleTabBar and theme tokens. GH-1231 changes none of them.
- The header has:
  - the title "Warehouse Analytics";
  - the historical "Updated at HH:MM" stamp, shown when the historical request is ready;
  - Cast;
  - the window selector (7d / 30d / 90d, default 30d).
- On a role denial the page shows only the title and "You don't have access to Analytics.", with no Cast and no selector (§12A D3).

**Cast.** Opens the menu "Cast to Floor Display":

- "Copy display link" and "Open display now" both provision a display token through `POST /api/v1/wms/analytics/display-tokens`.
- "Manage displays in Settings →" goes to `/settings/warehouse`, where Floor Display tokens are managed.
- The Floor Display itself is unchanged.

**Primary workspace.** Four accessible regions, each named by its area and asking its question as a heading:

- **Pace** — "Are we keeping up?"
- **Flow** — "Where is work slowing down?"
- **Problems** — "Where are problems happening?"
- **Team** — "How is the team doing?"

A compact **Costs** strip (region "Costs") sits below the cards.

**Pace (simplified 2026-10-09).**

- **Headline.** The total items picked, read as "Items picked · last N days". Beside it, the current bucket, read as "today so far" or "this week so far".
- **Bars.** One bar per bucket. Bar height = `items_picked / largest bucket`.
  - A zero bucket draws no bar.
  - A partial bucket (current, or a clipped first week) is striped.
- **Axis.** Only a "0" baseline label; the largest bucket is not repeated as an axis numeral. Date labels are 11px: every bucket up to 7, otherwise the first, middle and last.
- **No visible caption.** Instead the chart is a labelled group: "Confirmed items picked per {day|week}, {timezone}. Striped bars are partial periods." Each bucket's accessible label gives its date range and count, plus any partial-period marks.
- **Nonzero buckets** are buttons that open Details: the date range, the items picked, "Confirmed quantities · {timezone}" and the partial-period note.
- **Zero buckets are inert.** They are `role="img"` with the same label. They are not focusable, have no click or keyboard activation, open no Details, and invent no activity.
- **Live footer.** "Orders fulfilled today (all sales channels)", and the carrier cutoff when it is valid.

**Flow (simplified 2026-10-09).**

- **Subtitle:** "Orders waiting the longest in each step".
- **Rows.** Five numbered rows in process order. Each row is a button showing the stage label, its longest recorded-status age (§12B.4) and its order count, and it opens Details.
  - Rows 1, 3 and 5 carry a faint `--accent-ghost` tint (60%); rows 2 and 4 are transparent. The tint adds no height.
  - Ages use `--ink-2`, which keeps ≥4.5:1 on the tint in dark mode.
- **Freshness.** The header stamp "Now · updated HH:MM" comes from the live request.
- **Footer.** "Open Order Flow →" links to `/orders/flow`.
- **Live only.** Flow reads only the live request. The 7d/30d/90d selection never changes it.

**Problems.**

- "N problems recorded · M still open".
- A proportion bar with a pattern per type, plus a legend reading "{type label} · {count}".
- The first two product rows. Each is a button that opens Details.
- "+N more products" opens Details for the returned rows ("Showing X of Y products" when more exist).
- "Open Problem Center →" links to `/problem-center`.
- Zero: "No problems recorded in the last N days".

**Team (simplified 2026-10-09).**

- **Column headers.** Two static headers, "Items picked" and "Items packed", on the same two-column grid as the rows.
  - "Items picked" uses the action ink and matches the solid accent bars.
  - "Items packed" uses `--ink-3` and matches the outlined bars.
  - Neither has an arrow.
- **Rows.** One button per person, alphabetical. Each shows the name, "Former member" where it applies, and the picked and packed values with their bars. A row opens Details.
- **Row limit.** One to three rows, depending on the measured workspace height. When rows are clipped, "Showing K of N · Details" opens Details for everyone in the window.
- Zero: "No confirmed item activity in the last N days".
- **Live footer.** "Assigned to active batches", qualified "Includes unfinished batches; not live staffing".

**Costs.** As specified in §12B.4.

**Details — contextual and nonmodal.**

- **When it exists.** No Details panel exists until something is selected. No rail is reserved at any width, and there is no `OperationalContextShell` rail.
- **What opens it:**
  - a nonzero Pace bucket;
  - a Flow stage;
  - a product row;
  - "+N more products";
  - a person row;
  - "Showing K of N · Details".
- **What it is.** A nonmodal `role="dialog"` named "Details", anchored to its trigger (bottom-start) and kept inside the viewport. It is 340px wide, capped at the viewport width minus 32px; long content scrolls inside it.
- **Focus.**
  - Focus moves to "Close Details" when it opens.
  - Close or Escape closes it and returns focus to the trigger.
  - The workspace is never `aria-hidden`, and the window selector stays usable.
- **Ops Console.** Details withdraws while the Ops Console is open and returns with the same selection when it closes.
- **No averages.** No historical stage-time averages and no "Usually" (U8).

**Ops Console.**

- Closing the Console restores all four answers. The window selection and the Details selection are preserved.
- The layout follows the workspace's own measured content width (§12B.2), so Console and side-nav width changes go through the same rule.
- Ratified exception: below lg (1200px), the fixed 340px Console may overlay the grid.

**Action hierarchy (2026-10-09).**

- **Text links** are canonical Tier 2 ghost pills (modules-ux-playbook §2) at the screen's 12px minimum:
  - fill `--accent-ghost`, border `0.5px --accent-border`;
  - text `color-mix(in srgb, var(--accent) 65%, var(--ink))`, which keeps ≥4.5:1 in both themes (raw `--accent` on white is about 2.8:1).
- **The links are:**
  - "Open Order Flow →";
  - "Open Problem Center →";
  - Costs "Open Team →";
  - the Details links "Open Order Flow →" and "Open Problem Center →";
  - Cast "Manage displays in Settings →".
- **Text buttons.** "+N more products" and "Showing K of N · Details" use the same action ink, without a pill.
- **Static text.** Labels and values use semantic `--ink`, `--ink-2` or `--ink-3`. The only orange static text is the Team "Items picked" header, which matches its bar. Data rows (stages, products, people) are buttons with a neutral hover; they are not styled as links.
- No global CSS, token or module style changes.

**Readability (U5).**

- Informational labels and values: at least 12px.
- Chart axes and secondary legends: at least 11px.
- Text contrast: at least 4.5:1 in light and dark (measured, §12B.8).
- Every chart has a keyboard- and screen-reader-equivalent text alternative.
- Shrinking fonts until content fits is not allowed.

**Not shipped.** The prototype badge, the data-status overlay and illustrative data were review aids only.

### 12B.2 Responsive layout and scroll contract — stricter than playbook §9 for this screen

**Layout (implemented).**

- **Column count.** Two columns (2×2) while the workspace's measured content width is at least 650px (2 × 320px minimum card width + 10px gap). Otherwise, one column.
- **Two columns.**
  - The workspace's minimum height equals the measured remaining height of the AppLayout scroll port.
  - Workspace rows are `auto minmax(min-content, 1fr) auto` (header, cards, Costs). Card rows are `auto`.
  - Rows never shrink below their content. A shorter workspace therefore scrolls in AppLayout rather than overlapping cards.
- **One column.** Cards stack as Pace, Flow, Problems, Team, then Costs, with natural AppLayout scrolling. The Pace chart is a fixed 140px tall.
- **Measurement is page-local.** ResizeObserver watches the workspace, the scroll port and the scroll port's siblings, so wrapped tabs or banners count. AppLayout, WmsFT2Page and the WMS tabs are unchanged. The page has no inner `overflowY: 'auto'` scroller, which a static contract enforces.
- **Superseded.** The earlier bounded-height-chain candidate CSS (a WmsFT2Page flex column with a `minmax(0, 1fr)` grid) was never implemented. The measured layout above replaces it.

**Certified scroll results (local Playwright, Chromium, §12B.8):**

- **1440×720 and 1024×820, light and dark, populated:**
  - two columns;
  - the AppLayout scroll root and the document both have `scrollHeight ≤ clientHeight` and `scrollWidth ≤ clientWidth`;
  - the four cards and Costs sit inside the scroll root;
  - ≥2 product rows and ≥1 person row;
  - no overlapping text, and no content outside its card.
- **1440×720 light, populated 30d and 90d, and real shop data at 7d, 30d and 90d:** no primary scroll, with the same text, overlap and escape checks.
- **1440×720 with the Ops Console open:** no overlapping text.
- **390×844 light, populated and zero:**
  - one card per row;
  - the AppLayout scroll root scrolls vertically and reaches Costs;
  - no horizontal overflow and no overlap;
  - Details opens, closes and restores focus.

**Ratified requirement not separately browser-measured.** The requirement also covers compact side-nav and the loading, partial, unavailable, unconfigured and denied states at the certified viewports. The React tests cover the content and semantics of those states. The browser suite did not measure their geometry.

**Overflow is handled by disclosure, not scrolling:** Details, "+N more products", "Showing K of N · Details", or a link to the owning route. Only Details' own content may scroll, and no primary question needs it.

**Geometry hooks (U6, as implemented).**

- Stable `data-*` attributes on the page only:
  - `data-analytics-workspace` and `data-analytics-columns`;
  - `data-analytics-cards` and `data-analytics-region`;
  - `data-analytics-product` and `data-analytics-person`;
  - `data-analytics-team-column`;
  - `data-pace-point`, `data-items-picked` and `data-pace-bar`.
- No hook was added to AppLayout. The harness finds the AppLayout scroll owner by walking up from the workspace to the first ancestor with `overflow-y: auto` or `scroll`, the same rule the page uses.

### 12B.3 Shop-local periods, timezone and freshness (U2)

**V1 window.**

- `days` ∈ {7, 30, 90}.
- The window covers the last `days` shop-local calendar dates, including today as a partial date. It is not a rolling `now − days × 24h`.
- `tz` is `shops.timezone`, validated as an IANA zone. If the zone is null or unknown, the window falls back to `UTC`.
- The effective zone is echoed in `window.timezone`.

**DST-correct boundaries.**

- Every date boundary is computed as the instant of local midnight on that date. For example, `(local_date::timestamp) AT TIME ZONE tz` in Postgres.
- Boundaries must be correct across both DST transitions; a day can be 23h or 25h long.
- The existing `startOfShopDay()` is not reused for this. It works by backtracking from the wall clock and is not DST-correct.

**Buckets.**

- 7d and 30d use one bucket per shop-local date. The current date is labelled "today so far".
- 90d uses Monday-start ISO weeks in shop-local dates:
  - a first week clipped by the window start is labelled with its date range;
  - the current, partial week is labelled "this week so far".
- Partial buckets are marked with a hatch pattern, never by colour alone.

**Which blocks use the V1 window:**

| Block | Window |
|---|---|
| `pace` | V1 window |
| `problems` | V1 window |
| `team_activity` | V1 window |
| `operators`, `pipeline`, `exceptions`, `exception_trend`, `throughput_trend`, `cost` (legacy) | unchanged rolling window |

**Freshness (GH-1230 D4, unchanged).**

| Request | Refresh | Freshness label | Feeds |
|---|---|---|---|
| Historical composite | 5 min | header "Updated at HH:MM" | Pace bars and totals, Problems, Team rows, Costs |
| `/analytics/live` | 60 s | Flow header "Now · updated HH:MM" | Flow counts **and** status ages (same response); "Orders fulfilled today"; the carrier cutoff; the active-batch assignment count |

- A live value is never labelled with the historical time, and the reverse.
- Live ages are never taken from the historical request.
- **Uncluttering (2026-10-09).** Pace's live footer comes from the same live response as Flow, so its own "Now · updated HH:MM" line is visible only when Flow has no stamp for that same response time (for example, when Flow is unavailable). Otherwise the line is screen-reader text only. The historical and live stamps are never merged, a failure never advances either one, and Flow is never presented as filtered by the historical window.

### 12B.4 Metric contracts

**Rules that apply to every metric below:**

- **Tenant.** Every query uses `req.user.shopId` inside `withTenant` (RLS) and adds an explicit `shop_id =` filter. The exception is `order_warehouse_status`, which has no `shop_id` and is isolated by FORCE RLS through `orders`.
- **Zero versus unavailable.** "Zero" renders only from a verified successful response for the matching window. "Unavailable" reads "Couldn't load this right now." and never renders as `0` (GH-1230 D1/D5).

#### Pace (U1, U2, U4)

**Items picked (bars)**

- Definition: Σ `pick_scan_log.quantity_confirmed` where `status = 'confirmed'`, bucketed by `scanned_at` into shop-local periods.
- Population:
  - Includes short-pick partial quantities, which are written as confirmed scans.
  - Excludes undone or non-confirmed scans.
  - Excludes nothing by batch claimer or by membership status.
  - Each scan row is counted once.
- Unit: items.
- Source: `pace.points[]`.
- Zero and missing: dense series. A period with no scans is a real `0`.
- Drilldown: a nonzero bucket opens Details with the value, the date range and the timezone. A zero bucket is inert: no Details, and no pointer or keyboard activation.

**Items picked, last N days**

- Definition: Σ of the buckets.
- Must equal Σ `team_activity[].items_picked`.
- Source: `pace.items_picked_total`.

**Today so far / This week so far**

- Definition: the current, partial bucket.
- Source: `pace.points[is_current]`.

**Orders fulfilled today (all sales channels)**

- Definition: count of `order_fulfillment_status` rows where `status = 'fulfilled'` and `fulfilled_at ≥` the start of the shop day.
- Population: orders from all channels. Live.
- Source: existing `live.shipped_today`, unchanged.
- Zero: a known `0` is valid.
- Drilldown: none. Outbound counts only physically shipped orders, which is a different population.
- Known limitation: the existing `startOfShopDay` is not DST-correct on transition days. This is not changed here.

**Carrier cutoff (conditional)**

- Shown only when `cpt_local` is configured **and** parses as a valid `HH:MM`.
- Wording is relative to the shop clock: "Carrier cutoff 16:00 (shop time) · 1h 47m left".
- After the cutoff today (`hours_to_cpt` is null and `cpt_local` is valid): "Today's 16:00 cutoff has passed".
- Never implies on-track status or a required pace.
- Source: existing `live.cpt_local` and `live.hours_to_cpt`.

#### Flow — live

**Five stage counts**

| Merchant label | `order_warehouse_status.status` |
|---|---|
| Waiting to be picked | `awaiting_pick` (released into a pick batch, not yet claimed) |
| Being picked | `picking` |
| Waiting to be packed | `picked` |
| Being packed | `packing` |
| Ready to ship | `packed` |

- Definition: count of orders in each recorded status. No age exclusion.
- `shipped`, `partially_shipped` and `cancelled` are not stages.
- Unit: orders.
- Source: `live.flow.stages.<status>.count` (new).
- Zero: a known `0` is valid.
- Drilldown: the stage opens Details; "Open Order Flow →" links to `/orders/flow`.

**Longest time in this status**

- Definition: `max(now − status_updated_at)` across the stage's orders.
- Meaning: elapsed time since the order's warehouse status was last recorded. It is **not** time a person has been actively working.
- It is not capped. Old unfinished work stays visible. No severity colour is used.
- **Rendering (concise, 2026-10-09):** floored to "Under 1 min", "N min", "N h" (under 2 days) or "N days". The API reports exact elapsed seconds from the recorded timestamp and never a bounded age, so no lower-bound form (such as "7+ days") is shown, and no precision beyond the recorded timestamp is implied.
- **Provenance in Details:** "Longest time in recorded status: …" and "Elapsed time since the order status was recorded; not continuous time spent by a person."
- The earlier "since an earlier day" marker was retired on 2026-10-09.
- Source: `live.flow.stages.<status>.oldest_age_s` (new). It comes from the same live response, and so has the same freshness, as the counts.
- `null` when the count is `0`, rendered as "—", never `0`.

**Historical stage averages: OMITTED from V1 (U8).**

- The legacy `pipeline.stages` means combine rolling windows with mixed per-batch and per-order populations.
- They do not appear on the owner screen, in Details, or as "Usually" times.
- They may return only under a separately approved contract with shop-local periods and explicit populations.
- The API field is unchanged; the Floor Display still uses it.

#### Problems — historical, one consistent population

**Population:** `pick_exceptions` rows with `raised_at` in the V1 window and `exception_type <> 'order_cancelled'`, from both pick and pack stages.

**Problems recorded**

- Definition: count of the population.
- Source: `problems.total` (new).
- Zero: "No problems recorded in the last N days".

**Still open**

- Definition: rows in the population with `resolved = false` at fetch time.
- Source: `problems.open_total` (new).

**By type**

- Definition: counts per type. Shares are of `total`.
- Shown as a proportion bar with a pattern per type.
- Source: `problems.by_type` (new).
- Labels:
  - `short_pick` → "Could not pick full amount"
  - `item_missing` → "Item not found"
  - `wrong_item` → "Wrong item"
  - `product_defect` → "Damaged product"
  - `packaging_defect` → "Damaged packaging"
  - unknown codes → "Other problem"
- Raw codes are never shown. No cause is inferred.

**Products with problems**

- Definition: the same population grouped by `lasyncro_variant_id`. Ordered by count descending, then by label ascending. Top 5, plus `products_total` for "+N more".
- `display_label`: the product title, plus " - " and the variant title. The variant title is dropped when it is `Default Title` or empty. This follows the `search.service` `variantLabel` precedent.
- Source: `problems.products[]` with `display_label` and `sku` (new).
- Display: the card shows the first two rows. Each row opens its Details. "+N more products" opens Details with the returned rows.
- Drilldown: "Open Problem Center →" links to `/problem-center`, unfiltered.

**Not shown:** no rate, no accuracy %, no attribution to people, no bins, no cost.

#### Team — historical, not a ranking (U1)

**Items picked per person**

- Definition: Σ `pick_scan_log.quantity_confirmed` (confirmed scans only), attributed to the scan's actual `scanned_by` user. It is not attributed to the batch claimer.
- Window: the V1 window.
- Source: `team_activity[].items_picked` (new).

**Items packed per person**

- Definition: Σ `pack_scan_log.quantity_confirmed` (confirmed scans only), attributed to the actual `scanned_by` user.
- Window: the V1 window.
- Source: `team_activity[].items_packed` (new).

**Population**

- Every user with ≥1 confirmed pick or pack scan in the window, **including former or revoked members**.
- This guarantees Σ `items_picked` = the Pace total. A batch reassigned mid-pick splits its units between the people who actually scanned them.
- `display_name` is the trimmed first and last name, with a neutral fallback. `is_current_member` is a flag.
- Ordered alphabetically, case-insensitive, with `user_id` as the tie-break.
- Shown under two static column headers, "Items picked" and "Items packed", with no arrows.
- When rows don't fit: "Showing K of N · Details", which opens Details for every person in the window.

**Assigned to active batches (live, qualified)**

- Definition: `live.active_operators`, the distinct `picked_by` of batches in `picking` plus the distinct `packed_by` of batches in `packing`.
- Label: "Assigned to active batches".
- Qualification, as rendered since 2026-10-09: "Includes unfinished batches; not live staffing". The page renders this literal. `activeBatchAssignmentCopy().qualification` in `analyticsV1Model.ts` still returns the earlier long wording, which its model contract test asserts, but the page no longer displays it.
- Never labelled "working now", "on shift" or a headcount.

**Not shown:** no speed, UPH, accuracy, "vs self", baselines, rankings or scores.

#### Costs — setup only (U3)

**No rates configured** (`cost.unlocked = false`)

- A plain affordance: "Hourly rates are set in Team", with a link to `/team`.
- It does not promise that adding rates will unlock cost figures.

**At least one rate configured** (`cost.unlocked = true`)

- A neutral strip: "Cost reporting isn't available in Analytics yet".
- `cost.unlocked` means at least one current member has `hourly_cost`. It does not mean complete coverage.

**Never shown:** money, cost per order or item, problem cost, prior-period comparison, editorial text, or any rate-coverage figure or assurance.

**Unavailable:** if the historical request is unavailable, the strip reads "Couldn't load this right now."

### 12B.5 Additive API changes and compatible rollout

**`GET /api/v1/wms/analytics/live`** gains `flow`:

```
flow.stages = {
  awaiting_pick | picking | picked | packing | packed:
    { count: number, oldest_age_s: number | null }
}
```

- `flow` is computed by a new service function, inside the live request's tenant transaction.
- `getLiveCapacity` is not modified. The Floor Display payload (`GET /analytics/display`) and the composite's `live` object stay key-identical.
- These existing fields keep their keys and meanings: `pipeline`, `shipped_today`, `active_operators`, `live_uph`, `required_uph`, `standard_uph`, `on_track`, `unfulfilled_orders`.

**`GET /api/v1/wms/analytics?days=`** gains four top-level blocks:

```
window = { days, timezone, start_at, bucket: 'day' | 'week', today_local }

pace = {
  items_picked_total,
  points: [ { start_date, end_date, items_picked, is_current, is_clipped } ]  // dense
}

problems = {
  total,
  open_total,
  by_type,
  products: [ { lasyncro_variant_id, display_label, sku, count } ],
  products_total
}

team_activity = [
  { user_id, display_name, items_picked, items_packed, is_current_member }
]  // alphabetical
```

- Every existing key and its meaning stays unchanged. This includes `exceptions.top_skus[].title` (the raw variant title), `exception_trend`, `throughput_trend`, `pipeline` and `operators`.
- No migration is required.
- Route gates are unchanged: `authenticateToken → requireFt2 → requireCapability('warehouse.analytics') → requireAction('wms:analytics:read')`.

**Rollout (safeguard).**

- **Backend-first deployment is the default.** The backend (Fly) is deployed and verified before the frontend (Vercel) that reads the new blocks.
- The two deploy independently. A "same deploy" is not an atomicity guarantee.
- Any other rollout order needs explicit mixed-version and rollback compatibility evidence, both:
  - new frontend against the old backend;
  - old frontend against the new backend.
- The frontend never assumes a new block exists before the deployed backend provides it.

**Failure precedence (GH-1230 D1–D6 first, per-block validation last).** Rules apply in this order:

1. **Whole-request outcomes keep GH-1230 behaviour.**
   - A 401/403 produces the existing role or commercial denial (D3), with no retry (D6).
   - A 500 or network failure makes every region that depends on that request unavailable, even when cached data exists (D1). The other request's verified regions stay rendered.
   - A failed refresh never advances freshness (D4).
2. **Selected-window mismatch keeps GH-1230 behaviour (D2).**
   - A historical response whose top-level `days`, or whose new echoed `window.days`, differs from the selected window makes every region that depends on the selected window unavailable.
   - Placeholder data or data from a previous window is never shown.
3. **Request-level shape guards keep GH-1230 behaviour (D5).**
   - Legacy structure the V1 screen still reads stays validated at request level. On the live response that is `shipped_today`, `cpt_local`, `hours_to_cpt` and `active_operators`; on the historical response it is `days` and `cost.unlocked`.
   - If that structure is malformed, the whole request is unavailable. These guards are not relaxed, and unverified values are never shown.
4. **Per-block degradation applies only after rules 1–3 pass.** It needs an HTTP 200, a verified request, a matching window and no denial. Then a *single* new block (`flow`, `window`, `pace`, `problems` or `team_activity`) that is missing — for example, from an older backend in a mixed-version gap — or malformed makes only the region that depends on it unavailable. Every other verified region stays rendered. A missing or malformed `window` degrades the regions that depend on it: Pace, Problems and Team.
5. **Zero is never fabricated.**

### 12B.6 Component disposition (legacy → V1)

**KEEP**

- Header, window selector, "Updated at", Cast. Cast's "Manage displays in Settings →" now goes to `/settings/warehouse`.
- The GH-1230 availability resolver, the denial presentation and the retry rules.

**MERGE**

- Live Capacity stage counts → Flow.
- "Stuck on the floor" → Flow "longest time in this status" (now live-sourced).
- Throughput trend → Pace (shown in items, not UPH).

**MOVE**

- "Shipped today" → Pace "Orders fulfilled today (all sales channels)".
- "Operators active" → Team "Assigned to active batches" (qualified).

**REFINE**

- Operator Performance → Team (picked and packed only).
- Exceptions → Problems.
- Cost & Throughput → Costs setup strip.

**RETIRE (owner page only)**

- Pipeline Stage Velocity and all historical stage averages (U8).
- Live, required and standard UPH, and the on-track signal.
- The "vs self" / "vs team" toggle.
- The UPH, accuracy %, problems-per-person, average batch time and scan-source columns.
- The problem heat grid.
- Cost values, problem cost and editorial text.
- The WMS/legacy shipped split.
- The receive-to-pickable and return-to-restock latencies.
- The `/wms/problem-center` link.

Retired fields are **not** removed from the API. The Floor Display and other consumers keep them.

**NEW**

- Contextual Details: a nonmodal popover anchored to its trigger, local and selection-scoped. It has no reserved rail at any width.

### 12B.7 Invariants

1. GH-1231 leaves the Floor Display payload's keys and meanings unchanged. The Display shows no person names.
2. Live and historical requests stay independent (GH-1230 D1–D6). Each new block follows the same rules: zero ≠ unknown, window echo, and per-block unavailability.
3. The V1 window is one set of shop-local calendar dates.
   - Σ Pace bars = the Pace total = Σ Team picked, with attribution to the actual scanner.
   - Problem types, the total and the products share one population.
4. The owner page shows no fabricated speed, targets, comparisons, accuracy, rankings, causes, bins, forecasts, costs or historical stage averages.
5. Flow counts and status ages share one live response. Ages describe the recorded status only. Flow never reads the historical request, and the 7d/30d/90d selection never changes it.
6. The owner/admin role gate and the Core commercial gate are unchanged. Operators are still denied at the API.
7. Drilldowns go only to real routes: `/orders/flow`, `/problem-center` and `/team`. Cast management goes to `/settings/warehouse`.
8. Pace bar height is `items_picked / largest bucket`. A zero bucket draws no bar and is noninteractive.

### 12B.8 Test strategy and verification boundary (U7)

**Required before implementation:** tests that are demonstrably RED for the missing V1 contracts.

**CI-gated contract tests (`tests/contract`, DB-free):**

- Per-block payload validators, including the deploy-gap compatibility case.
- A pure V1 presentation model: stage labels, problem-type labels, alphabetical Team, uncapped status ages, null ≠ 0, partial-period copy.
- Pure backend helpers: variant display label, timezone validation, DST-correct bucket boundaries.
- A static owner-page surface contract: no retired claims, the `/problem-center` link, no workspace `overflowY: auto`, GH-1230 resolvers still used.

**Local real-DB integration (`npm run test:integration`):**

- Shop-local and DST boundaries.
- Confirmed-scan population. Undone scans excluded. Reassignment attribution. Former members included. No double counting. Pace equals Team.
- Weekly buckets.
- Problem population and labels.
- Live flow and uncapped ages.
- Tenant isolation.
- Legacy key and Floor Display payload compatibility.
- Neighbours: the GH-1222 role boundary and GH-1219 display commercial access.

**Local frontend regression (`npm run test:frontend`):**

- The GH-1230 suite is modernised so its assertions are **non-vacuous**.
  - Expected V1 labels and regions must be present when data is ready.
  - A missing label fails the test; it is never skipped.
  - All D1–D6, live/historical independence, 401/403, stale or invalid window, and malformed-payload checks are preserved.
- A new V1 screen suite.
- Neighbours: WmsFT2Page warehouse focus, Order Flow, route-role admission.

**Browser certification (as implemented).** `tests/e2e/wms-analytics-gh1231.browser.spec.ts`, run with `playwright.gh1231.config.ts`, is a local, authenticated Chromium harness against the running dev stack. It follows the GH-1230 precedent: no new CI Playwright project, and missing credentials fail rather than skip. Its eight scenarios measure:

- **Overflow.** The AppLayout scroll owner and the document at 1440×720 and 1024×820 (light and dark), and at 390×844.
- **Layout.** Region bounds, clipping, overlapping text and content escaping its card.
- **Readability.** Typography minimums and ≥4.5:1 text contrast, including the Cast menu labels.
- **Pace truth.** Exact shop-local periods for 7d/30d/90d and bar heights against confirmed items. Zero buckets draw nothing and are inert.
- **Details.** Nonmodal, with focus returned on Escape and Close. It withdraws while the Ops Console is open and is restored with the period kept.
- **Live Flow.** Flow is unchanged across 7d/30d/90d.
- **Team headers.** Each header sits over its own bar half.
- **Actions.** Ghost-link destinations and the colour hierarchy.
- **Cast click-through.** The real "Manage displays in Settings →" link lands on `/settings/warehouse`.

Not measured by this suite:

- compact side-nav;
- the geometry of the loading, partial, unavailable, unconfigured and denied states (their semantics are React-tested);
- the WMS Operations, Order Flow and Floor Display neighbours.

**Evidence — IMPLEMENTED + LOCALLY CERTIFIED 2026-10-09; PRODUCTION CERTIFICATION PENDING:**

- **React** (`frontend` project; `tests/unit/ui/wms/WmsAnalyticsPage.v1.test.tsx` and `WmsAnalyticsPage.availability.test.tsx`): 84/84.
- **Analytics contracts** (CI-gated `contract` project; `tests/contract/wms-analytics-*.contract.test.ts`, 4 suites): 285/285.
- **Commercial route enforcement contract:** 31/31.
- **Backend real-DB integration** (disposable-DB harness): 42/42. This is a prior verified run; the 2026-10-09 cleanup changed no backend code.
- **Authenticated Chromium Playwright** (owner terminal): 8/8.
- **GH-1109 Receive:** two historical test failures were reproduced on the pre-GH-1231 commit `5d7b145f`. They are tracked in GH-1232 and are not GH-1231 regressions.
- **Not claimed:** CI on the GH-1231 commit, deployment, production acceptance.
- `WORKFLOW_DOC_UPDATE_REQUIRED=NO`. No agent or workflow standing rule changed.

The A prototype's measurements (74/74, reproduced shell, `file://`) remain design evidence only. The GH-1230 data-reliability contract is separately proven: it shipped and is CLOSED (§15).

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
| 2026-10-08 | GH-1230 availability & freshness contract (§12A) | Independent live/historical availability, window attribution, response-shape validation, role vs commercial denial, freshness labels, hook-local retry. Evidence: 24/24 render, 37/37 CI contract, 951/951 full contract, 54/54 local browser runs. DATA RELIABILITY LOCALLY VERIFIED; production verification pending. |
| 2026-10-08 | Documentation corrections | Tier corrected Growth → Core (canonical capability policy); implemented route gates recorded (§10); status no longer claims a complete or certified owner screen. Owner-screen UX (Analytics V1, 1a Four Questions, screen-level scroll-free) tracked in GH-1231. |
| 2026-10-08 | GH-1230 shipped and CLOSED | Supersedes the "production verification pending" status in the GH-1230 row above (kept as history). Committed and pushed as `5d7b145f`. CI and deploy green. Production smoke accepted: normal production Analytics load with independent historical/live freshness, merchant-reported 7/30/90 switching, and Order Flow normal load. Issue CLOSED. This does not certify the owner-screen UX; GH-1231 remains TARGET LOCKED, not certified. |
| 2026-10-08 | GH-1231 target + U1–U8 contracts ratified (§12B) | Concept A Visual Four Questions and U1–U8 (scan-event attribution, shop-local DST-correct periods, setup-only Costs, valid-only carrier cutoff, ≥12px/≥11px type, certification-only geometry hooks, local Playwright harness, historical stage averages omitted) plus safeguards (qualified active-batch assignment, recorded-status ages from one live source, backend-first per-block validation) recorded as ratified requirements. Not implemented; no certification. |
| 2026-10-09 | GH-1231 implemented and LOCALLY CERTIFIED (§12B) | Supersedes the "not implemented" status in the row above (kept as history). Analytics V1 owner screen: four questions; contextual nonmodal Details with no reserved rail; measured-width 2×2 / single column; no primary scroll at 1440×720 and 1024×820; natural scroll at 390×844. The owner-ratified presentation cleanup is included: simplified Pace (zero buckets inert), Flow (concise recorded-status ages, live only) and Team (column headers, short qualifier); ghost-orange actions; Cast → `/settings/warehouse`. Evidence: React 84/84, Analytics contracts 285/285, commercial route enforcement 31/31, backend integration 42/42 (prior run), authenticated Chromium Playwright 8/8. GH-1109 historical failures tracked in GH-1232. `WORKFLOW_DOC_UPDATE_REQUIRED=NO`. PRODUCTION CERTIFICATION PENDING; issue stays open. |

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
