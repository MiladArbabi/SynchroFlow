# Overview Pulse, Signal Dedup & Pipeline Fixes — 2026-06-20

> **Scope:** Session that (1) built the Overview Business Pulse rail, (2) de-duplicated the operational/SLA signals, and (3) fixed a chain of data-pipeline bugs uncovered along the way.
> **Audience:** Backend/frontend engineers working on Overview, the constraint/alert system, or the projection engine.
> **Verified:** 2026-06-20, local dev (docker `synchroflow_db`, shop_id=1, `owner@test.com`).
> **Companion docs:** `overview-module-playbook.md`, `lifecycle_playbook.md`, `modules/overview-module-architecture.md`.

---

## 1. What shipped

### 1.1 Business Pulse rail (ISSUE-003)

Overview's right column previously rendered **Today's Flow** (Ready/Picking/Blocked/Breached) — identical to the Orders module's rail. That rail is order-domain operational state and belongs to Orders. It has been replaced on Overview by a cross-domain **Business Pulse**.

**Design principle — the two rails are NOT the same altitude:**

- **Orders → Today's Flow** counts work-in-progress *queues* (orders being picked/blocked). Operational throughput.
- **Overview → Business Pulse** reports business *outcomes* (money realized / at-risk / blocked). "Is the business winning today?"

**Rows (all real data, no customers/analytics dependency):**

| Row | Source |
|---|---|
| Revenue today (hero) + Δ vs yesterday | `revenue_projection_daily` (latest 2 dates) |
| Collected today | `orders_operational_control_snapshot.realized_revenue` |
| At risk | `orders_operational_control_snapshot.at_risk_revenue` |
| Blocked (+ top blocking domain) | `orders_operational_control_snapshot.blocked_revenue`, `top_blocking_type` |

Margin was intentionally dropped (fragile per-order cost join; revisit later). Customers row dropped — the customers module is deprecated and slated for replacement by analytics/PostHog.

**Files:**

- `apps/backend/src/services/overview-ft2/overviewPulse.resolver.ts` (NEW) — `getOverviewPulse(shopId)`.
- `apps/backend/src/services/overview-modules-ft2/overviewModulesFt2.resolver.ts` — exposes `pulse` on the snapshot.
- `apps/frontend/src/pages/overview/useOverviewModulesFt2Snapshot.ts` — `pulse` added to the snapshot type.
- `apps/frontend/src/pages/overview/useOverviewFt2Adapter.ts` — maps `snapshot.pulse` → props.
- `apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx` — passes `pulse` through (removed the `pulse={null}` override).
- `modules/overview/src/ui/pages/OverviewModuleFT2.tsx` — `FlowSidebar` replaced by `BusinessPulse`; `pulse` prop reshaped to the financial contract.

### 1.2 Operational vs SLA signal dedup

The brief showed two near-identical critical signals on the same 8 orders / $3,800: "8 orders overdue" (`operational`) and "8 orders past shipping SLA" (`sla_breach`). They were the **same condition computed twice**: the operational evaluator hardcoded `block_type = 'sla_breach'` using the exact 24h-age rule already owned by `order_age_snapshot.is_shipping_sla_breached`.

**Fix:** gutted SLA logic from the operational path and repurposed it for genuine physical blockers.

- `apps/backend/src/services/constraints/evaluators/operationalConstraintEvaluator.ts` — now evaluates **unresolved `pick_exceptions`** (item_missing / short_pick / product_defect / packaging_defect / wrong_item), mapped to operational `block_type`s. No longer re-derives SLA timing.
- `apps/backend/src/projections/orderOperationalConstraintProjection.ts` — stores the evaluator's `meta.blockType` instead of hardcoding `'sla_breach'`.
- `apps/backend/src/services/alerts/alerts.aggregator.ts` — operational alert title reframed to "N orders blocked at fulfillment".

**Result:** `operational` and `sla_breach` are now orthogonal. SLA = time signal; operational = physical pick-exception signal. They only co-fire when an order is both late AND physically blocked (legitimately two problems).

### 1.3 Alert reconciliation (orphaned-alert leak)

`aggregateAlertsForShop` only upserted alerts it produced; an alert whose signal cleared lingered `is_active=true` forever. Added a reconcile step: after upsert, deactivate any active alert whose `alert_key` is not in the freshly-computed set (empty set ⇒ clear all). Without this, the gutted operational alert stayed visible despite zero source constraints.

### 1.4 SLA breach count fix

`aggregateSlaAlerts` counted raw `order_age_snapshot` rows → 59 instead of 8 (version multiplication), and included fulfilled orders. Now: filter to latest `aggregate_version` per order (correlated subquery), exclude fulfilled (`order_fulfillment_status.status != 'fulfilled'`), `countDistinct` orders. 59 → 8, $28,465 → $3,800.

### 1.5 Two missing tables (modules-ft2 500)

`historical_sales` and `product_costs` were referenced by the products-FT2 fact resolvers but **never migrated** → modules-ft2 500'd → entire Overview blanked (the page returns null on `overviewModules.isError`). Both tables added to the **base migration** `20260225131705_0056_revenue_projection_daily.ts` (not a patch migration, per the repo's "fix base migrations in dev" rule), with FORCE RLS tenant-isolation matching house style.

### 1.6 Dead revenue projection wired in

`projectRevenueDaily` (writes `revenue_projection_daily`) was listed in `projectionExecutionOrder` but **never invoked by the engine** — the table was permanently empty. Wired into `projection.engine.ts` after the per-order projections (idempotent shop-level daily aggregation, savepoint-guarded). This is what the Pulse hero reads.

---

## 2. PITFALLS — read before touching Overview / projections / dev DB

These cost real time this session. Avoid repeating them.

### P1 — Stale module `dist/` (the #1 time sink)

The running frontend imports `@lasyncro/overview` from **`modules/overview/dist/`**, NOT `src/`. Editing the `.tsx` does nothing visible until you rebuild:
npm run build -w modules/overview
Symptom: "I applied the fix but the UI is unchanged." Diagnosis: compare `dist` vs `src` mtimes (`ls -la dist/...`, `stat -f "%Sm" src/...`) and `grep -c <NewComponentName> dist/...`. This bit us on both the FlowSidebar guard AND the BusinessPulse swap.

### P2 — Rebuild resets lifecycle to FT0

`npm run rebuild` truncates `user_lifecycle_snapshot` → phase reverts to FT0 → every FT2-gated endpoint (incl. the brief, modules-ft2) returns `403 FT2 access requires confirmed FT2 lifecycle`. After EVERY rebuild:
```sql
SET app.current_tenant='1';
UPDATE user_lifecycle_snapshot SET phase='FT2', subphase=NULL, updated_at=now() WHERE shop_id=1;
```
(The real FT0→FT1→FT2 chain requires an integration row + the OAuth event chain — see `lifecycle_playbook.md`. The dev seed writes FT2 directly; rebuild wipes it.)

### P3 — `dev:setup` seeds SAFE mode only → no membership

`npm run dev:setup` runs the default (safe) seed, which creates the shop+user but **NO shop membership** ("This user CANNOT log in"). Lifecycle endpoints then 500 with `SHOP_CONTEXT_REQUIRED`. Always follow with:
DEV_SEED_MODE=full_identity npm run seed --workspace ./apps/backend
This creates the owner membership and sets FT2.

### P4 — `db:reset` fails if dev servers are running

`docker exec ... DROP DATABASE` → `database "synchroflow_db" is being accessed by other users`. Stop the dev servers (api/worker/ui) before `dev:setup`.

### P5 — Versioned snapshot tables multiply counts

`order_age_snapshot` and `orders_operational_control_snapshot` accumulate rows (by `aggregate_version` / `snapshot_date`). ANY count/sum over them MUST filter to the latest version per order/day, or numbers inflate (this was the 59-vs-8 SLA bug). Pattern (house style, from `OrdersOperatorFacts`):
.andWhere('oas.aggregate_version',

db('order_age_snapshot as oas2')

.where('oas2.lasyncro_order_id', db.raw('oas.lasyncro_order_id'))

.max('oas2.aggregate_version'))

### P6 — Projections in `projectionExecutionOrder` are NOT auto-invoked

That list is a declarative contract. The engine (`projection.engine.ts`) must **explicitly call** each projection. `projectRevenueDaily` was listed but never called → dead. When adding a projection, wire the actual call AND add it to the list.

### P7 — `pulse={null}` hardcode overriding a spread prop

`OverviewFT2Page.tsx` spread `{...overviewProps}` (which included the real pulse) but then re-set `pulse={null}` on the next line, nullifying it. When a prop won't appear, check for an explicit override after the spread.

### P8 — Empty/un-migrated DB mid-session

A stray `db:reset` (or interrupted setup) can leave the DB with zero tables; queries then error `relation "X" does not exist`. Confirm with `\dt` / `SELECT COUNT(*) FROM knex_migrations`. Recovery = full `dev:setup` + `full_identity` seed + overview seeds + rebuild + FT2 restore.

### P9 — Brief compute can't run via ts-node one-liner

`overviewMorningBrief.resolver` (via the trust resolver) imports `@lasyncro/backend-core/utils/ft2Period.js`, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` under a bare `node --loader ts-node/esm` invocation. Drive the brief through the running API (`GET /api/v1/modules/overview/morning-brief?force=true`) instead. Snapshot + aggregator DO run fine via the one-liner.

---

## 3. Repeatable post-rebuild sequence (dev)

After any `npm run rebuild`:

1. restore FT2
psql ... -c "SET app.current_tenant='1'; UPDATE user_lifecycle_snapshot SET phase='FT2', subphase=NULL, updated_at=now() WHERE shop_id=1;"
2. snapshot + aggregator (worker does this automatically if running; else:)
cd apps/backend && REBUILD_MODE=true node --loader ts-node/esm -e "

const snap = await import('./src/workers/projections/shopOperationalSnapshot.worker.ts');

const agg  = await import('./src/services/alerts/alerts.aggregator.ts');

await snap.computeShopOperationalSnapshot('1');

await agg.aggregateAlertsForShop(1);

process.exit(0);"
3. brief + pulse via API (needs running server)
TOKEN=$(curl -s -X POST <http://localhost:3000/api/v1/auth/login> -H 'Content-Type: application/json' -d '{"email":"<owner@test.com>","password":"password123"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

curl -s "<http://localhost:3000/api/v1/modules/overview/morning-brief?force=true>" -H "Authorization: Bearer $TOKEN"
**TODO (durability):** fold steps 1-2 into a single dev helper script so this isn't manual each reset.

---

## 4. Verified end state (2026-06-20, shop_id=1, local)

- Orders 21 (18 seed 9000xx + 3 QA), domain_events 70, all 4 pulse/fact tables present.
- Brief: **2 signals** — "8 orders past shipping SLA" (critical, $3,800) · "1 product missing cost data" (watch). No operational/SLA duplication.
- Business Pulse: Revenue today USD260 (▼ USD455 vs yesterday) · Collected USD8,645 · At risk USD1,620 · Blocked USD0 (mostly customer).
- Today's Flow removed from Overview; remains on Orders.
- Operational constraints: 0 active (no pick exceptions seeded) — confirms SLA dedup.

---

## 5. Still open (not addressed this session)

- **`system_readiness_state` empty** → `ft2/readiness` returns `ready:false` locally. Expected: only populated by the full `ft0.completed` OAuth chain. Will be true on the connected reviewer account.
- **`MARGIN_COMPUTATION_FAILED`** — pre-existing (see overview playbook §5), unrelated to this work.
- **ISSUE-001** (shared Today's-Flow/decision component), **ISSUE-005** (dead deep-link routes in DEEP_LINK_MAP).
- **Durability helper script** (see §3 TODO).
- **Pulse "Revenue today" label** — currently shows the latest *available* day (Jun 18 in seed data), not literally today. Correct for a live store with same-day orders; consider relabeling to "Latest revenue" if demo data shows a gap.