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
| Morning brief (greeting, ranked signals, semantic revenue labels) | `morning_brief_snapshots` | `overviewMorningBrief.resolver.ts` → reads `alerts` |
| Today's Flow (Ready / Picking / Blocked / Breached) | `orders_operational_control_snapshot` + queue metrics | `shopOperationalSnapshot.worker.ts` |

**Critical fact:** the brief resolver reads **only the `alerts` table** (CHANGE POLICY: "Never query raw tables here — always read from `alerts`"). It does not read constraints/orders directly. So to change the brief, you change what's in `alerts` — which means changing the order facts the AL-01 aggregator derives alerts from.

### OV-DATA-02 - Overview decision/revenue semantics (2026-08-31)

**Status:** implementation complete; automated verification PASS; localhost live browser verification PASS; production certification PENDING deployment.

**Problem:** Overview combined the total decision count with blocked revenue as generic `"$X at stake"`, conflating independent operational concepts.

Canonical semantics:

- **BLOCKED:** active constraint prevents an order progressing.
- **FULFILLMENT SLA:** merchant-configured payment-to-fulfillment duration.
- **CPT / Carrier Pickup Time:** daily warehouse/carrier cutoff. It is NOT a synonym for Fulfillment SLA.

Final Overview behavior:

- Header: `"N decisions pending. Review the issues below."`
- SLA signal: `"N orders past Fulfillment SLA"`; `<amount>`; `"order value"`.
- Blocked signal: `"N orders blocked"`; `<amount>`; `"blocked revenue"`.

Implementation notes:

- Alert calculations and `revenue_impact` values are unchanged.
- `alertType` is the sole discriminator for revenue labels; do not infer labels from title, id, deepLink, or module.
- Both `TriageRow` and map-layout `MergedPulseCard` render the semantic labels.
- No CPT logic, `fulfillment_sla_hours` thresholds, blocker calculations, alert ordering, or revenue calculations changed.

Regression evidence:

- Test ownership: `UNOWNED=0 / MULTI_OWNED=0`.
- Backend alert copy: `7/7 PASS`.
- Frontend semantic helper: `5/5 PASS`.
- Backend TSC: `0 errors`.
- Overview module build: `PASS`.
- Localhost live browser: `PASS`.

Deferred separate issues:

- `SLA-SEM-01` - **CLOSED 2026-09-01.** Approaching Fulfillment SLA is
  paid-age only with warning window `MIN(4h, 25% of configured SLA)`;
  Watch/Aging remains broader operational attention.
- `CPT-MODEL-01` - Order Flow CPT/SLA conflation remains separate and deferred.

### OV-UX-18 - Overview morning-brief refresh boundary (2026-09-01)

**Status:** implementation complete; automated verification PASS; targeted frontend tests `5/5 PASS`; Overview module build PASS; localhost live-browser localized refresh behavior PASS; production certification PENDING deployment.

**Problem:** manual morning-brief refresh previously used a boolean `forceRefresh` inside the React Query key. That created a new query identity on each toggle, made `morningBrief` data become `undefined` while pending, and caused `OverviewModuleFT2` to enter its full loading state. The visible effect was header/body/map/right-side content being replaced by skeletons and the warehouse map visually unmounting/remounting, even though floor/live data itself was not refetched. Alternating clicks also alternated between force and non-force endpoints.

Final refresh contract:

- Canonical morning-brief query identity is stable: `['overview', 'morning-brief']`.
- Initial/background fetch uses `/api/v1/modules/overview/morning-brief`.
- Manual refresh always uses `/api/v1/modules/overview/morning-brief?force=true`.
- Manual refresh is a dedicated operation, not another query identity.
- Existing morning-brief data remains rendered while manual refresh is pending.
- Successful manual refresh updates the canonical morning-brief cache.
- Explicit `isRefreshingBrief` state is propagated to `OverviewModuleFT2`.
- Duplicate manual refresh requests are guarded.
- Manual refresh does not invalidate/refetch floor/live-map queries.
- The warehouse map and unrelated Overview content remain visually stable during morning-brief refresh.
- Refresh controls use `aria-label="Refresh morning brief"`, `type="button"`, and disabled state while refreshing.
- `RefreshCw` has pending rotation treatment and reduced-motion handling.

Regression contracts:

- `OV-REFRESH-01` - no document/router reload.
- `OV-REFRESH-02` - explicit pending state.
- `OV-REFRESH-03` - pending refresh feedback.
- `OV-REFRESH-04` - existing content remains visible during refresh.
- `OV-REFRESH-05` - floor/live queries remain independent.
- `OV-REFRESH-06` - successful refresh updates canonical morning brief.
- `OV-REFRESH-07` - every manual refresh uses `force=true`.
- `OV-REFRESH-08` - duplicate concurrent refresh prevented.
- `OV-REFRESH-09` - accessible refresh control.

Automated evidence:

- Two targeted frontend suites PASS.
- Targeted frontend tests: `5/5 PASS`.
- Overview module build PASS.
- Generated dist verified.
- Full refresh-control rendering automation remains partial due known shared-ui Jest import-resolution debt.
- Live-browser verification covers the consequential interaction boundary.

Deferred separate issues:

- `OV-UX-18B` - Refresh icon pending animation is too subtle / not reliably visible. This does not block OV-UX-18 because the primary localized refresh boundary is fixed.

### OV-DATA-02B - Overview freshness scope (2026-09-01)

**Status:** implementation complete; automated verification PASS (`6` targeted frontend suites / `15` tests); Overview module build PASS; localhost live-browser verification PASS.

**Audit result:** the suspected snapshot-selector defect was disproven. `morning_brief_snapshots` is unique per shop, and `orders_operational_control_snapshot` is unique on `(shop_id, snapshot_date)`, so the current latest-row selectors are deterministic. The actual issue was a product-contract gap: Overview intentionally combines independently evaluated data sources, but the map layout visually placed `morningBrief.generatedAt` beneath both Needs a Decision and Business Pulse, falsely implying that one timestamp described both surfaces.

Final freshness contract:

- `morningBrief.generatedAt` belongs only to the Morning Brief / Needs a Decision surface.
- Morning Brief manual refresh remains Morning-Brief-only.
- Business Pulse does not inherit or display Morning Brief freshness.
- No shared atomic snapshot version, run ID, or cross-module `asOf` boundary is introduced.
- In the map layout, Morning Brief freshness and its refresh control appear before Business Pulse and are labelled `Brief updated at <time>`.
- In the triage layout, freshness remains inside Needs a Decision and is labelled `Brief updated <time>`.
- Whole-page `Live` semantics are a separate freshness concern and are not redefined by OV-DATA-02B.

Regression contracts:

- `OV-FRESH-01` - Morning Brief `generatedAt` is explicitly labelled as brief freshness.
- `OV-FRESH-02` - Business Pulse does not inherit Morning Brief freshness.
- `OV-FRESH-03` - map-layout Morning Brief freshness and refresh controls occur before Business Pulse rather than in a shared footer beneath it.
- `OV-FRESH-04` - triage freshness remains scoped to Needs a Decision and explicitly identifies itself as brief freshness.
- `OV-FRESH-05` - manual refresh remains Morning-Brief-only.
- `OV-FRESH-06` - no shared snapshot/version/`asOf` architecture is introduced.

Verification evidence:

- RED-first freshness-scope regression test failed for the intended semantic reasons before implementation.
- Targeted frontend verification: `6` suites / `15` tests PASS.
- Static freshness-scope checks PASS.
- Existing morning-brief hook remained unchanged.
- Overview module build PASS and generated dist verified.
- Localhost browser verification confirmed the freshness row is visually attached to Needs a Decision, Business Pulse begins below its own divider, refresh behavior remains localized, and layout integrity is preserved.

### OV-DATA-03 - Business Pulse financial semantics (2026-09-01)

**Status:** implementation complete; automated verification PASS; localhost live browser verification PASS; production certification PENDING deployment.

**Problem:** Business Pulse showed both `"Revenue today"` and `"Collected today"`. Audit proved the old `collectedRevenue` value came from the latest `orders_operational_control_snapshot.realized_revenue`, which is not today-scoped, not payment-date-scoped, not capture/settlement data, and effectively cumulative net revenue up to the snapshot cutoff. The row was semantically invalid and was removed rather than renamed or replaced.

Final Business Pulse rows:

- **Blocked**
- **Revenue today**
- **At risk**

Canonical `Revenue today` contract:

- Payment condition: `orders.payment_state = 'paid'`.
- Business-date owner: `orders.order_created_at`.
- Merchant timezone: `shops.timezone`.
- Timezone fallback: `UTC`.
- Revenue source: `order_revenue_units_net.net_revenue`.
- Refund behavior: net of recorded `refund_execution_line_items` via the existing `order_revenue_units_net` view.
- Yesterday: immediately preceding merchant-local calendar day.

Implementation notes:

- The daily revenue projection no longer buckets by `DATE(order_revenue_units.created_at)` / `DATE(runet.created_at)`.
- `getOverviewPulse` no longer uses DB/server `CURRENT_DATE` as merchant truth; it resolves today/yesterday from the shop timezone and queries `revenue_projection_daily` by explicit dates.
- `projectRevenueDaily()` refreshes projection-owned deterministic fields on conflict: `gross_revenue`, `order_count`, `at_risk_revenue`, and `evaluated_at`.
- `evaluated_at` preserves deterministic event-anchor semantics via `EXCLUDED.evaluated_at`; `updated_at` remains operational metadata.
- Existing `blockedRevenue`, `topBlockingType`, and operational `atRiskRevenue` semantics remain unchanged.
- No broader operational snapshot overlap/double-counting model, Finances module semantics, or replacement fourth Business Pulse metric was changed.

Regression contracts:

- `OV-REV-01` - Revenue today includes paid orders only.
- `OV-REV-02` - Revenue-day attribution belongs to `orders.order_created_at`, not the revenue-unit row timestamp.
- `OV-REV-03` - Day bucketing uses `shops.timezone` / merchant-local calendar date.
- `OV-REV-04` - Revenue today remains net of recorded refunds.
- `OV-REV-05` - Daily projection recomputation refreshes existing aggregate values.
- `OV-REV-06` - Overview today/yesterday comparison uses merchant-local current and immediately preceding calendar dates.
- `OV-REV-07` - Overview Business Pulse contains no `"Collected today"` row.
- `OV-REV-08` - Existing `blockedRevenue`, `topBlockingType`, and operational `atRiskRevenue` semantics remain unchanged.

Verification evidence:

- RED-first frontend evidence: `OV-REV-07` failed because `"Collected today"` still rendered.
- RED-first backend evidence: unpaid revenue counted; revenue-unit timestamp controlled day bucket; recomputation left existing daily rows stale. Refund-net path already passed.
- Targeted frontend: `1 suite / 1 test PASS`.
- Backend integration: `1 suite / 5 tests PASS`.
- Existing relevant Overview tests: `OverviewFT2Page.refresh-boundary.test.tsx PASS`; `OverviewModuleFT2.header.test.tsx PASS`.
- Disposable integration DB cleanup: `TEST_DB_DROPPED` confirmed.
- Overview module build: `PASS`; generated module semantics verified.
- `git diff --check`: `PASS`.
- Localhost live browser: Business Pulse renders **Blocked**, **Revenue today**, **At risk**; `"Collected today"` absent; layout has no broken spacing, blank fourth-row artifact, or clipping.

Deferred separate issues:

- Broader operational snapshot overlap/double-counting around `realizedRevenue + pendingRevenue + atRiskRevenue`.
- `OV-UX-18B` - refresh icon animation remains subtle/deferred.
- General Finances module semantics.
- Any new fourth Business Pulse metric.

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
| `operational` | critical | **CORRECTED 2026-06-28 — this row was wrong.** Unresolved pick exception (item missing, short pick, defect, wrong item) — see `operationalConstraintEvaluator.ts`. Has NO relationship to age/time; that's `sla_breach`'s job. See §10 below for how this stayed wrong for two rounds of fix attempts before being caught against the source directly. |
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

## 5. Known separate bug — REBUILD-03 (P2, still open as of 2026-08-06)

**`MARGIN_COMPUTATION_FAILED — [PROJECTION_WRITE_VIOLATION] order_margin_snapshot`**: during rebuild, reconciliation's `computeOrderMargin` writes to `order_margin_snapshot` **without** setting `SET LOCAL synchroflow.projection = 'true'`, so the projection-writer guard rejects every margin write. Non-fatal (logged + skipped), and the Overview does not read margin — but margin data is not being rebuilt. Fires on original AND seeded orders, so it predates this work. Fix = wrap the margin write in the projection-writer context, like the other projection writers.

**REBUILD-03 (2026-08-06).** Still unfixed; re-confirmed firing on every order during `npm run dev:full-seed`. Two GUCs are required, not one — `synchroflow.projection` *and* `synchroflow.reconciliation`, set inside `withTenant`; see `docs/modules/finances-module-architecture.md:496` and the reference implementation at `rebuildInventoryProjection.ts:78`. Note the "Overview does not read margin" caveat above is now narrower than it was: the Finances module does read margin, so this is no longer purely cosmetic.

---

## 6. Verified end state (2026-06-18, shop_id=1)

- 36 orders (18 fulfilled / 18 pending), all with fulfillment status.
- Brief: **3 signals** — "14 orders overdue" (critical, $24,724) · "8 orders out of stock" (watch, $3,800) · "2 products missing cost data" (watch).
- Today's Flow: Ready 4 / Blocked 14 / Breached 13.
- Account on **Scale** tier, app healthy (health check passing), verified in incognito.

---

## 7. 2026-06-20 update — Pulse rail + signal dedup + pipeline fixes

The Overview right rail is **no longer Today's Flow** — it is now a cross-domain **Business Pulse** (revenue today, at-risk, blocked). `Collected today` was removed by OV-DATA-03 because its source was not today-scoped collection data. The operational/SLA signal duplication, the inflated SLA count, two missing tables (`historical_sales`, `product_costs`), and a dead `projectRevenueDaily` were all fixed. Full detail + the dev pitfalls (stale `dist`, FT2 reset on rebuild, safe-seed membership gap, versioned-snapshot count multiplication, uninvoked projections) are documented in:

**`docs/playbooks/overview_pulse_and_signal_dedup_2026_06_20.md`**

Note: §6's "verified end state" above is from the 2026-06-18 prod seed and predates these changes (e.g. the brief now shows 2 de-duplicated signals, not the older "14 orders overdue" set).

## 8. 2026-06-25 update — daily operational brief dispatch fix + local dev seed scripts

`dailyOperationalBriefProjection` was fully declared in the contracts/dependencies/execution-order registries but never dispatched anywhere — fixed by wiring it into `shopSnapshotJob.dispatcher.ts` alongside its two siblings. Also added `npm run dev:full-seed` / `dev:trigger-snapshot` for local dev DB resets (distinct from §3.4's production seeding flow). GOTCHA #4 and §5's margin bug were both observed behaving differently than documented in this session, but neither status is confirmed — see full detail and explicit caveats in:

**`docs/playbooks/overview_daily_brief_dispatch_and_dev_seed_fix_2026_06_25.md`**

## 9. 2026-06-27 update — CTA deep-link playbook created; `aging_72h` naming bug flagged

A full audit of Overview's outbound CTAs (and every page they target) surfaced that `DEEP_LINK_MAP` — previously living only in `overviewMorningBrief.resolver.ts` — has a misleading slug: `operational` maps to `?filter=aging_72h`, but AL-01's actual `operational` rule (table in §2 above) uses a 24-hour threshold, unrelated to the `aging_72h_plus` column this slug implies. Also found a second, independent hardcoded copy of the same deep link in `aha.controller.ts`. Full register, corrected mapping table, and the planned shared-module extraction are now tracked in:

**`docs/playbooks/cta-deeplink-playbook.md`**

## 10. 2026-06-28 correction — `operational` row above was wrong, caused two downstream bugs

The AL-01 table's `operational` row (above) described a 24h fulfillment-SLA age check. That description was stale — superseded by the same dedup fix §7/§9 already reference, but the table cell itself was never updated to match. Two separate fix attempts in `docs/playbooks/cta-deeplink-playbook.md` trusted this table instead of reading `alerts.aggregator.ts` directly, and both landed on a wrong urgency-based rename before the actual source was finally checked.

**Ground truth, verified directly against `alerts.aggregator.ts`'s `aggregateConstraintAlerts` and `operationalConstraintEvaluator.ts`:** `operational` = unresolved pick exception, a physical-blocker signal, unrelated to age. Full detail, the two-round correction history, and the corrected deep-link mapping are in `docs/playbooks/cta-deeplink-playbook.md` §3.

**Standing lesson for this doc:** treat this table as a convenience summary, not a substitute for reading the aggregator source when precision matters.
