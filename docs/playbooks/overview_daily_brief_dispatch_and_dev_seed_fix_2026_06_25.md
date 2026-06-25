# Daily operational brief dispatch fix + local dev seed/reset runbook (2026-06-25)

## 1. Bug: `dailyOperationalBriefProjection` was fully declared, never dispatched

`projectDailyOperationalBrief` (in `projections/dailyOperationalBriefProjection.ts`) was registered in:
- `projections/contracts/projectionContracts.ts`
- `projections/contracts/projectionDependencies.ts` (depends on `orderRiskProjection`, `orderRevenueDailyProjection`)
- `projections/contracts/projectionExecutionOrder.ts`

...but never called from `projection.registry.ts` (the event dispatch table), nor from `rebuild-from-events.ts`, nor from `shopSnapshotJob.dispatcher.ts`. Schema-guard and contract-registry checks passed on every rebuild because they verify *structure*, not *invocation* — this let the gap go unnoticed indefinitely. `daily_operational_brief_snapshot` stayed empty regardless of seed/rebuild order.

This is a different uninvoked projection than the dead `projectRevenueDaily` fixed in `overview_pulse_and_signal_dedup_2026_06_20.md` — that fix did not touch this table.

### Why this is NOT a rebuild bug
`rebuild-from-events.ts` has its own header comment stating rebuild must rely entirely on the reconciliation pipeline to trigger snapshots, and must not introduce a bulk-recompute execution model. `projectDailyOperationalBrief` computes whole-shop aggregates (a `orders` sum, an `order_constraints` join, a top-10 `order_risk_snapshot` query) — calling it per-event would scale rebuild quadratically for no benefit. It correctly does NOT belong in `projection.registry.ts` or in rebuild.

### Fix
Added a call to `projectDailyOperationalBrief` inside `shopSnapshotJob.dispatcher.ts`, immediately after `aggregateAlertsForShop` — alongside its two siblings (`computeShopOperationalSnapshot`, `aggregateAlertsForShop`), which already run on the same 2-second poll loop against `shop_snapshot_jobs`. This is the one canonical place every shop-level snapshot already fires from.

Implementation note: `projectDailyOperationalBrief` requires a `Knex.Transaction` (the dispatcher didn't previously open one for this call) and an `aggregateVersion: number` parameter that is accepted but unused in the function body — passing `0` is safe, not a placeholder hack, confirmed by reading the full function body.

Verified live: inserting a manual `shop_snapshot_jobs` row for shop 1 produced a real row in `daily_operational_brief_snapshot` with `cash_realized_today: 8824.85` (a genuine aggregate against seeded order data), picked up by the already-running dev-worker within its normal 2-second poll interval — no restart required.

## 2. Local dev DB reset/reseed runbook (NOT the §3.4 production runbook)

§3.4 in `overview-module-playbook.md` seeds **production** via `fly proxy` against the Fly Postgres cluster. This section is for **local docker dev only** and is unrelated to that flow.

### The bug this fixes
`seed_overview.sql` (events) was being run before `seed_overview_products.sql` (products + `external_product_identity_map`). Event payloads reference variant GIDs that only resolve through the identity map. Running events first doesn't error at insert time — there's no FK constraint at that layer — so the seed appears to succeed. The failure only surfaces later, when `rebuild` tries to *project* an order event and throws `[ORDER_LINE_ITEM_VARIANT_IDENTITY_MISSING]`, halting rebuild entirely and leaving every downstream projection table empty.

### Fix — two new root `package.json` scripts