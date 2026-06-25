# LaSyncro — Overview Module Playbook

> **Scope:** The Overview module (FT2 morning brief + Today's Flow) — its data pipeline, how to seed/repopulate it, and every operational gotcha discovered during the 2026-06-18 reviewer-seed work.
> **Audience:** Backend/ops engineers who need to populate, debug, or rebuild the Overview surface for any shop.
> **Last verified:** 2026-06-18 against production (shop_id=1, `contact@lasyncro.com`).
> **Companion doc:** `docs/modules/overview-module-architecture.md` (component/UX architecture).

---

## 1. What the Overview renders, and where each number comes from

The Overview has two surfaces, both **derived** — never authored directly:

| Surface | Source table | Written by |
|---|---|---|
| Morning brief (greeting, ranked signals, $ at stake) | `morning_brief_snapshots` | `overviewMorningBrief.resolver.ts` → reads `alerts` |
| Today's Flow (Ready / Picking / Blocked / Breached) | `orders_operational_control_snapshot` + queue metrics | `shopOperationalSnapshot.worker.ts` |

**Critical fact:** the brief resolver reads **only the `alerts` table** (CHANGE POLICY: "Never query raw tables here — always read from `alerts`"). It does not read constraints/orders directly. So to change the brief, you change what's in `alerts` — which means changing the order facts the AL-01 aggregator derives alerts from.

---

## 2. The full pipeline (verified end-to-end)

```
domain_events  (append-only, immutable; the only authored layer)
     │  npm run rebuild  →  processDomainEvent (runtime === rebuild path)
     ▼
orders (canonical, upserted)  +  order_line_items  +  order_revenue_units
     │
     ├─► order_fulfillment_status   (current-state; PK = order_id)
     ├─► order_age_snapshot          (VERSIONED; PK = order_id + aggregate_version)
     ├─► order_risk_snapshot         (VERSIONED; PK = order_id + aggregate_version)
     ├─► order_constraints           (operational / inventory / customer)
     └─► computeShopOperationalSnapshot
              │
              ▼
          AL-01 alerts.aggregator  ──upserts──►  alerts (is_active, severity, revenue_impact)
              │
              ▼
   overviewMorningBrief.resolver  ──reads active alerts (≤5, severity→revenue)──►  morning_brief_snapshots
```

### Alert types the AL-01 aggregator derives (all from order facts)
| alert_type | severity | Trigger (verified rule) |
|---|---|---|
| `operational` | critical | order paid + fulfillment `pending` + age_since_paid ≥ `fulfillment_sla_hours`×3600 (default **24h**) |
| `sla_breach` | critical | shipping/delivery SLA breach (age snapshot flags) |
| `revenue_at_risk` | warning | from `orders_operational_control_snapshot` |
| `missing_cogs` | warning | active (non-fulfilled) order has a variant with `unit_cost = 0` / null `estimated_unit_cost` |
| `inventory` | warning | `SUM(available_quantity) FILTER (wl.type='bin') ≤ 0` for the variant — **requires bin-type warehouse_locations** |
| `customer` | warning | active `customer` constraint / `customer_block_type` set by reconciliation |

---

## 3. Seeding the Overview for a shop (the runbook)

Goal: produce a believable order book that yields a populated, mixed-priority brief and realistic flow buckets. We seed **domain_events**, then rebuild — the same path the real Shopify sync uses, so it survives reviewer scrutiny and dates are fully controllable.

### 3.1 Event shape per order
Each order = **3 events minimum**:
1. `orders/paid`  → `{"id":"<numeric_id>"}`, `external_event_id="<id>:paid"`
2. `orders/sync`  → the fat payload (line items, totals, address, `displayFulfillmentStatus`), `external_event_id="<id>"`
3. **`orders/fulfillment_updated`** → `{"status":"pending","order_id":"<id>"}` for UNFULFILLED orders, **OR** `orders/fulfilled` → `{"status":"fulfilled","order_id":"<id>"}` for fulfilled ones.

> ⚠️ **GOTCHA #1 — every order needs a fulfillment event.** `orders/sync` alone does **not** materialize an `order_fulfillment_status` row. Without a `orders/fulfilled` or `orders/fulfillment_updated` event, the order has no status row, and the constraint/age/risk projections will skip (post-patch) or crash (pre-patch) on it. The original ingestion path always emits one; a hand-written seed must too.

### 3.2 Line items MUST use real variant gids
Line items resolve via `external_product_identity_map.external_variant_id` (the `gid://shopify/ProductVariant/...`), **not** by SKU (SKUs are frequently blank). Pull real gids:
```sql
SELECT m.external_variant_id, v.unit_cost, v.title
FROM external_product_identity_map m
JOIN variants v ON v.lasyncro_variant_id = m.lasyncro_variant_id
WHERE m.shop_id = <shop>;
```
- Use `unit_cost > 0` variants for normal/breach orders.
- Use a `unit_cost = 0` variant on one unfulfilled order to fire `missing_cogs`.

### 3.3 Calibrating buckets (verified rules)
- **Breached / overdue (operational):** paid + unfulfilled + age > SLA (24h). Control via `paid`/`createdAt` offset.
- **Ready to ship:** paid + unfulfilled + within SLA + no active constraint. Date < 24h ago.
- **Inventory block:** only fireable if the shop has **bin-type** `warehouse_locations`. If only a `warehouse`-type root exists, defer to the WMS pass — it cannot fire.
- **Picking & packing:** WMS (`pick_batches`); stays `—` until WMS seeding. Leave honest.

### 3.4 Insert + rebuild sequence
```zsh
# 0. Open proxy to the PG cluster (NOT the app) — see GOTCHA #4
fly proxy 5433:5432 -a synchroflow-db   # cluster app name, not "synchroflow"

# 1. Insert events (idempotent via ON CONFLICT on (shop_id, external_event_id))
PGPASSWORD=*** psql -h localhost -p 5433 -U synchroflow -d synchroflow -f seed_overview.sql

# 2. Rebuild (replays ALL events through processDomainEvent)
cd apps/backend
PGPORT=5433 PGHOST=localhost PGUSER=synchroflow PGPASSWORD=*** PGDATABASE=synchroflow npm run rebuild

# 3. ⚠️ ADVANCE THE CURSOR — see GOTCHA #4 (THE app-killer)
PGPASSWORD=*** psql -h localhost -p 5433 -U synchroflow -d synchroflow \
  -c "UPDATE projection_cursors SET last_processed_event_id = (SELECT max(id) FROM domain_events) WHERE projection_name='orders_projection';"

# 4. Force brief recompute
curl -s "https://app.lasyncro.com/api/v1/modules/overview/morning-brief?force=true" \
  -H "Authorization: Bearer <REVIEWER_JWT>" | jq '{signals:(.signals|length), summary:.summaryLine, titles:[.signals[].title]}'
```

### 3.5 Verification queries
```sql
-- every order has fulfillment status (current-state table = order count)
SELECT (SELECT count(*) FROM orders WHERE shop_id=<s>) orders,
       (SELECT count(*) FROM order_fulfillment_status) ofs;
-- flow split
SELECT status, count(*) FROM order_fulfillment_status ofs
  JOIN orders o ON o.lasyncro_order_id=ofs.lasyncro_order_id
  WHERE o.shop_id=<s> GROUP BY status;
-- active alerts feeding the brief
SELECT alert_type, severity, is_active, revenue_impact FROM alerts
  WHERE shop_id=<s> ORDER BY is_active DESC, severity;
```

---

## 4. GOTCHAS (every one cost real debugging time — read before touching rebuild)

### GOTCHA #1 — Fulfillment event required per order
See §3.1. Missing it = no `order_fulfillment_status` row = downstream projections skip/throw. The error chain when absent: `[OPERATIONAL_CONSTRAINT_INVARIANT] / [CONSTRAINT_PROJECTION_INVARIANT] / [RISK_PROJECTION_INVARIANT] fulfillment status missing`.

### GOTCHA #2 — Projection replay-resilience patches (3 files)
The constraint/operational/risk projections originally **threw** when `order_fulfillment_status` wasn't yet materialized for an order during replay — fatal, halting the whole rebuild. A missing status mid-replay is legitimate (event ordering), so it must **skip, not throw**. Patched files:
- `services/constraints/evaluators/operationalConstraintEvaluator.ts` — `if (!ofs) return { type:'operational', isActive:false, meta:{ blockType:null } }`
- `projections/orderConstraintProjection.ts` — `if (!ofs) return;`
- `projections/orderRiskProjection.ts` — `if (!ofs) return;`

### GOTCHA #3 — Versioned snapshot tables (counts > order count are CORRECT)
`order_age_snapshot` and `order_risk_snapshot` have PK `(lasyncro_order_id, aggregate_version)` — one row **per order per version**. After a rebuild of 36 orders you may see 190 rows. This is expected history, not duplication. Confirm with `count(DISTINCT lasyncro_order_id)` = order count. UI surfaces filter to MAX(aggregate_version).

### GOTCHA #4 — ⚠️ THE APP-KILLER: advance `projection_cursors` after rebuild
`rebuild` truncates `projection_cursors` and replays, but leaves `orders_projection.last_processed_event_id` **behind** `max(domain_events.id)`. On next app boot, the runtime `projection.db.worker` detects the gap and **fatals** (`[DB_PROJECTION_GAP_FATAL] HALTED — operator intervention required`), crash-loops to max-restart, and the app serves **502**.
**Fix (mandatory after every seed+rebuild):**
```sql
UPDATE projection_cursors SET last_processed_event_id = (SELECT max(id) FROM domain_events)
WHERE projection_name = 'orders_projection';
```
Do NOT use the value the fatal log suggests (it points to the pre-gap id, which would re-process already-applied events). Use `max(id)` because rebuild already processed everything.

### GOTCHA #5 — Proxy / app naming + prod target
- The Postgres cluster Fly app is **`synchroflow-db`**, the web app is **`synchroflow`**. `fly proxy ... -a synchroflow` fails DNS; use `-a synchroflow-db`.
- Port **5433** via `fly proxy` = **PRODUCTION** (`[DB_IDENTITY] host: fdaa:...`). A local docker Postgres (`synchroflow_db`) also wants 5433 and will collide — only one can hold the port. Confirm `[DB_IDENTITY]` in rebuild output before trusting which DB you hit.
- **Seed/test against local docker, then apply the verified seed to prod once.** Do not iterate on prod (this session did, and truncating rebuilds left prod inconsistent mid-debug).

### GOTCHA #6 — `domain_events` is immutable
`no_update` / `no_delete` triggers (`domain_events is immutable`). You cannot DELETE a bad seed. Corrections must be **additive** new events. Design event ids/`external_event_id` so re-runs are idempotent (`ON CONFLICT (shop_id, external_event_id) DO NOTHING`).

### GOTCHA #7 — DEV trust bypass
`computeMorningBrief` has a dev-only trust-gate bypass (`NODE_ENV==='development'`). In production the brief is trust-gated; ensure the shop's trust snapshot is eligible or the brief returns null/204.

---

## 5. Known separate bug (file as its own ticket — NOT fixed here)

**`MARGIN_COMPUTATION_FAILED — [PROJECTION_WRITE_VIOLATION] order_margin_snapshot`**: during rebuild, reconciliation's `computeOrderMargin` writes to `order_margin_snapshot` **without** setting `SET LOCAL synchroflow.projection = 'true'`, so the projection-writer guard rejects every margin write. Non-fatal (logged + skipped), and the Overview does not read margin — but margin data is not being rebuilt. Fires on original AND seeded orders, so it predates this work. Fix = wrap the margin write in the projection-writer context, like the other projection writers.

---

## 6. Verified end state (2026-06-18, shop_id=1)

- 36 orders (18 fulfilled / 18 pending), all with fulfillment status.
- Brief: **3 signals** — "14 orders overdue" (critical, $24,724) · "8 orders out of stock" (watch, $3,800) · "2 products missing cost data" (watch).
- Today's Flow: Ready 4 / Blocked 14 / Breached 13.
- Account on **Scale** tier, app healthy (health check passing), verified in incognito.

---

## 7. 2026-06-20 update — Pulse rail + signal dedup + pipeline fixes

The Overview right rail is **no longer Today's Flow** — it is now a cross-domain **Business Pulse** (revenue today, collected, at-risk, blocked). The operational/SLA signal duplication, the inflated SLA count, two missing tables (`historical_sales`, `product_costs`), and a dead `projectRevenueDaily` were all fixed. Full detail + the dev pitfalls (stale `dist`, FT2 reset on rebuild, safe-seed membership gap, versioned-snapshot count multiplication, uninvoked projections) are documented in:

**`docs/playbooks/overview_pulse_and_signal_dedup_2026_06_20.md`**

Note: §6's "verified end state" above is from the 2026-06-18 prod seed and predates these changes (e.g. the brief now shows 2 de-duplicated signals, not the older "14 orders overdue" set).

## 8. 2026-06-25 update — daily operational brief dispatch fix + local dev seed scripts

`dailyOperationalBriefProjection` was fully declared in the contracts/dependencies/execution-order registries but never dispatched anywhere — fixed by wiring it into `shopSnapshotJob.dispatcher.ts` alongside its two siblings. Also added `npm run dev:full-seed` / `dev:trigger-snapshot` for local dev DB resets (distinct from §3.4's production seeding flow). GOTCHA #4 and §5's margin bug were both observed behaving differently than documented in this session, but neither status is confirmed — see full detail and explicit caveats in:

**`docs/playbooks/overview_daily_brief_dispatch_and_dev_seed_fix_2026_06_25.md`**
