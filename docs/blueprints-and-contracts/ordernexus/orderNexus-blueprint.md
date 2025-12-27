# OrderNexus — Complete blueprint (work in this thread)

## 1) One-line summary

OrderNexus makes order-level profitability obvious and actionable. In this thread we implemented FT0 readiness signal plumbing (provider), discovered a column-name / contract mismatch (DB ↔ readiness SQL), and designed two alternative fixes: adopt canonical columns or compute profitability from existing canonical line-item data. Below are the locked contracts, current state, problems, and exact fixes.

---

## 2) What we changed so far (timeline / summary)

* Added/updated the OrderNexus **onboarding signal provider** in:
  `apps/backend/src/onboarding/readiness.providers.ts`
  — it now:

  * counts `canonical_orders` → `ordersIngested`
  * computes `orderNexus.profitabilityActive` (ordersIngested > 0)
  * returns FT0 stub signals: `orderNexus.missingCostCount`, `orderNexus.hasNegativeMarginOrder`, `orderNexus.modeDetermined`, and `order-nexus.freeTierState`/`freeTierRemaining`.
* Ran the app; UI hit readiness endpoint; provider attempted an SQL that referenced legacy/cents column names:

  * `total_product_cost_cents`, `total_shipping_cost_cents`, `total_fees_cost_cents`, `total_profit_cents`
* Error in server logs: `column "total_product_cost_cents" does not exist`.
* Inspected canonical migrations: `apps/backend/migrations/20251201183427_create_canonical_commerce_tables.ts` — canonical_orders does **not** include those cents columns; instead it has decimal `total_price`, `subtotal_price`, `total_tax` and canonical_order_line_items has `estimated_unit_cost`.
* You searched codebase: no other references to the cents columns — they were introduced mistakenly in readiness provider SQL. Good: single source to fix.
* Current workable options:

  1. Add the cost/profit columns into canonical_orders (migration + backfill) to match readiness SQL; **or**
  2. Update readiness provider to compute missing-cost and negative-margin signals from existing tables (preferable short/clean fix without schema churn).

I recommend option (2) unless we've committed to persisting order-level aggregates in `canonical_orders` in docs/contracts.

---

## 3) Source of truth & contracts

* **Docs / sealed contracts** live under `docs/blueprints/OrderNexus.md` (and `docs/` more broadly). You said contracts must be locked first — agree: any column name change must be reflected/approved in `docs/` before migrations.
* Current canonical DB migration for `canonical_orders` (locked by migration file) uses:

  * `total_price` decimal
  * `subtotal_price` decimal
  * `total_tax` decimal
* `canonical_order_line_items` has `estimated_unit_cost` (decimal, nullable).

**Conclusion:** DB currently supports computing order costs from line items (`estimated_unit_cost * quantity`) plus revenue from `canonical_orders.total_price`. So we can compute missing-costs and negative-margin from existing schema.

---

## 4) Concrete definitions (signals OrderNexus must provide)

(OrderNexus provider must emit these Readiness signals — some are already present):

* `orderNexus.profitabilityActive: boolean`
  true if there are orders ingested and at least some cost data available (opinionated).
* `orderNexus.ordersIngested: number`
  total canonical_orders rows for shop.
* `orderNexus.missingCostCount: number`
  count of orders (or order line items) missing cost data.
* `orderNexus.hasNegativeMarginOrder: boolean`
  true if any recent order has computed net profit < 0.
* `orderNexus.modeDetermined: boolean`
  whether the merchant selected an operating mode (manual UI: B2B/B2C, or how to treat fees) — FT0 false by default.
* `order-nexus.freeTierState` & `order-nexus.freeTierRemaining` (via `computeModuleAccessState`).

---

## 5) Problems found (exact)

1. **Readiness provider ran SQL referencing columns that don't exist**:

   ```
   ... where "shop_id" = $1 and ("total_product_cost_cents" is null or "total_shipping_cost_cents" is null or "total_fees_cost_cents" is null)
   ```

   → Postgres error `column "total_product_cost_cents" does not exist` (code 42703).
2. **Mismatch** between provider assumptions and canonical migrations/contract.
3. No other code references those cents columns — only readiness provider used them — so fix is local.

---

## 6) Two recommended fix approaches (pick one)

### Option A — Fix provider to compute from existing schema (recommended)

No DB migrations. Implement SQL/Knex queries that:

* compute `missingCostCount` = number of orders that have any line item with `estimated_unit_cost IS NULL`.
* compute `hasNegativeMarginOrder` = exists order where:
  `total_price - (SUM(estimated_unit_cost * quantity) + assumed_shipping + assumed_fees) < 0`
  — **Note**: shipping and fees are not present in canonical_orders. For FT0 we treat them as `0` OR compute from order-level totals if platform provides them. Document this assumption and add a TODO to improve when shipping/fees arrive.

**Advantages:** fast, no schema churn, matches current migrations.

**Code sketch (Knex) — to drop into provider:**

```ts
// compute ordersIngested already present
const missingCostsRow = await db('canonical_orders as o')
  .where('o.shop_id', shopId)
  .join('canonical_order_line_items as li', function() {
    this.on('li.platform_order_id', '=', 'o.platform_order_id')
      .andOn('li.shop_id', '=', 'o.shop_id')
  })
  .whereNull('li.estimated_unit_cost')
  .count<{ count: string }>('distinct o.id as count')
  .first();

const missingCostCount = Number(missingCostsRow?.count ?? 0);

// negative margin: aggregate costs per order and compare to total_price
const negativeRow = await db('canonical_orders as o')
  .where('o.shop_id', shopId)
  .join('canonical_order_line_items as li', function() {
    this.on('li.platform_order_id', '=', 'o.platform_order_id')
      .andOn('li.shop_id', '=', 'o.shop_id')
  })
  .groupBy('o.id', 'o.total_price')
  .havingRaw(
    "o.total_price - COALESCE(sum(li.estimated_unit_cost * li.quantity), 0) < 0"
  )
  .count<{ count: string }>('o.id as count')
  .first();

const negativeMarginOrders = Number(negativeRow?.count ?? 0);
const hasNegativeMarginOrder = negativeMarginOrders > 0;
```

**Provider should then return these signals with proper names** (matching `ReadinessSignalName` from shared types).

### Option B — Add canonical order-level cost columns (if you want persisted aggregates)

Add columns to `canonical_orders`:

* `total_product_cost` DECIMAL(10,2) NULLABLE
* `total_shipping_cost` DECIMAL(10,2) NULLABLE
* `total_fees_cost` DECIMAL(10,2) NULLABLE
* `total_profit` DECIMAL(10,2) NULLABLE

**Migration sketch (Knex):**

```ts
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (t) => {
    t.decimal('total_product_cost', 10, 2).nullable();
    t.decimal('total_shipping_cost', 10, 2).nullable();
    t.decimal('total_fees_cost', 10, 2).nullable();
    t.decimal('total_profit', 10, 2).nullable();
  });
}
```

**Backfill** (optional): compute `total_product_cost` from `canonical_order_line_items` if `estimated_unit_cost` present:

```sql
UPDATE canonical_orders o
SET total_product_cost = sub.sum_cost
FROM (
  SELECT platform_order_id, shop_id, SUM(estimated_unit_cost * quantity) AS sum_cost
  FROM canonical_order_line_items
  GROUP BY shop_id, platform_order_id
) sub
WHERE o.shop_id = sub.shop_id AND o.platform_order_id = sub.platform_order_id;
```

**Then update providers** to query those precise columns (avoid _cents naming). Update docs/contracts to include these new canonical columns.

---

## 7) Which to choose?

* If you want **fast unblock and minimal schema changes**: choose **Option A** and update provider to compute from existing tables.
* If you want **canonical persisted aggregates** for analytics and faster reads later: choose **Option B**, but **update docs (sealed contract)** first and schedule migrations/backfill + tests.

Given your insistence on locked contracts in `docs/` and keeping canonical contracts consistent, Option B is valid *if* you update docs and treat migration as a contract change. For FT0 rollout, Option A is the pragmatic move.

---

## 8) Exact provider patch required (Option A — recommended)

Replace the erroneous SQL in `orderNexusOnboardingSignalProvider.getSignals` with the following logic:

1. `ordersIngested` — as before (count `canonical_orders`).
2. `missingCostCount` — count distinct orders with any `canonical_order_line_items.estimated_unit_cost IS NULL`.
3. `hasNegativeMarginOrder` — detect orders where `total_price - SUM(estimated_unit_cost * quantity) < 0`.
4. `profitabilityActive` — `ordersIngested > 0 && (some cost data exists)` — decide exact rule (we used >0 orders).

**Full provider code sketch (TS)**

```ts
export const orderNexusOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'order-nexus',
  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    const row = await db('canonical_orders').where({ shop_id: shopId }).count<{ count: string }>('id as count').first();
    const ordersIngested = Number(row?.count ?? 0);

    // missingCostCount
    const missingCostsRow = await db('canonical_order_line_items as li')
      .where('li.shop_id', shopId)
      .whereNull('li.estimated_unit_cost')
      .countDistinct<{ count: string }>('li.platform_order_id as count')
      .first();
    const missingCostCount = Number(missingCostsRow?.count ?? 0);

    // negative margin detection
    const negativeRow = await db('canonical_order_line_items as li')
      .select('li.platform_order_id')
      .where('li.shop_id', shopId)
      .groupBy('li.platform_order_id')
      .join('canonical_orders as o', function() { this.on('o.platform_order_id', '=', 'li.platform_order_id').andOn('o.shop_id', '=', db.raw('?', [shopId])) })
      .havingRaw('o.total_price - COALESCE(SUM(li.estimated_unit_cost * li.quantity), 0) < 0')
      .count<{ count: string }>('li.platform_order_id as count')
      .first();

    const negativeMarginOrders = Number(negativeRow?.count ?? 0);
    const hasNegativeMarginOrder = negativeMarginOrders > 0;

    // free tier state (existing helper)
    const entitlementAccess: ModuleEntitlementAccess = 'free-tier';
    const freeTier = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: ordersIngested,
      entitlementAccess
    });

    return [
      makeSignal('orderNexus.profitabilityActive', ordersIngested > 0),
      makeSignal('orderNexus.ordersIngested', ordersIngested),
      makeSignal('orderNexus.missingCostCount', missingCostCount),
      makeSignal('orderNexus.hasNegativeMarginOrder', hasNegativeMarginOrder),
      makeSignal('orderNexus.modeDetermined', false),
      makeSignal('order-nexus.freeTierState', freeTier.state),
      makeSignal('order-nexus.freeTierRemaining', freeTier.remaining)
    ];
  }
};
```

> Note: adjust `join`/`where` logic depending on how your canonical_order_line_items links to canonical_orders (we used `platform_order_id` and `shop_id`). Use indexes in production.

---

## 9) Tests to add / run (must-pass before merging)

* Unit tests for provider: mock DB responses to check each signal output.

  * Case A: no orders ingested → `ordersIngested = 0`, `profitabilityActive = false`, missingCostCount = 0
  * Case B: one order with line items missing estimated_unit_cost → `missingCostCount > 0`
  * Case C: one order where sum(costs) > total_price → `hasNegativeMarginOrder = true`
* Integration test hitting `/api/v1/onboarding/readiness?shopId=1` with seeded data (dev seed already creates shop 1 and synced 7 orders) — the endpoint should return 200 and consistent signals.
* Add a test to assert readiness provider does not run queries that reference non-existent columns.

---

## 10) Migration & docs actions (if choosing Option B)

If you choose to add persisted order-level cost/profit columns:

1. **Docs update (required)**
   Update `docs/blueprints/OrderNexus.md` and `docs/blueprints/CnsCore.md` to include the new `canonical_orders` column names you intend to add. This is contract change — lock and version (v1→v1.1 or v2 depending policy).

2. **Migration**
   Add a migration that `alterTable('canonical_orders')` to add `total_product_cost`, `total_shipping_cost`, `total_fees_cost`, `total_profit` (or suffix `_cents` if you standardize on cents — but pick one and update contract). Prefer decimal fields consistent with existing `total_price`.

3. **Backfill**
   Run backfill to populate `total_product_cost` from `canonical_order_line_items.estimated_unit_cost`. Optionally compute `total_profit = total_price - total_product_cost - total_shipping_cost - total_fees_cost`.

4. **Provider change**
   Change provider to read those columns (and guard `IS NULL` semantics). Update SQL references from cents names to actual column names.

5. **Tests & QA**
   Add migration tests and backfill validation scripts.

---

## 11) UX / Onboarding implications (what readiness now means)

* `orderNexus.profitabilityActive = true` only after orders and cost data exists. That prevents showing Profitability Dashboard prematurely.
* `orderNexus.missingCostCount` should feed the onboarding task "Fix missing costs so your profit is real" (task currently present, completion rule expects 0).
* `orderNexus.hasNegativeMarginOrder` can be surfaced as a widget/action: "Check Bleed Feed" (detect and cliﬀ the orders with negative margin).
* `orderNexus.modeDetermined` will be used for optional modal 'confirm operating mode' before enabling some automations.

---

## 12) Actionable prioritized patch plan (patch-by-patch)

### Patch 0 — small safety patch (BLOCKER)

* **What:** Replace the erroneous SQL string referencing `*_cents` in `readiness.providers.ts` with a defensive query that uses existing columns or returns early if columns missing. (Quick fix to avoid server 500s).
* **Why:** Stops 500s flooding logs.
* **Steps:**

  * Edit `apps/backend/src/onboarding/readiness.providers.ts`: remove any hard-coded usage of `total_product_cost_cents` etc.
  * Implement Option A sketch above.
  * Run `npm run dev` and call `curl /onboarding/readiness` — confirm 200 and signals appear.

### Patch 1 — unit tests (must)

* **What:** Add unit tests for provider signals (mock DB).
* **Why:** Prevent regressions.

### Patch 2 — optional: migration + docs (if canonical aggregation desired)

* **What:** Decide schema change → update docs `docs/` then add migration/backfill.
* **Why:** Enables faster reads, analytics alignment.
* **Note:** This is a contract change. Update Blueprints prior to migration.

### Patch 3 — performance / index follow-ups

* **What:** Ensure `canonical_order_line_items` has indexes on `(shop_id, platform_order_id)` and `estimated_unit_cost` queries are efficient (already present).
* **Why:** Aggregation per order must be fast.

### Patch 4 — dashboard wiring + onboarding UX

* **What:** Wire `orderNexus` signals to Onboarding TaskListTracker tasks and dashboard widgets.
* **Why:** Merchant sees actionable guidance.

---

## 13) Sample SQL queries (useful for diagnostics / manual checks)

Missing cost orders:

```sql
SELECT DISTINCT o.id, o.platform_order_id
FROM canonical_orders o
JOIN canonical_order_line_items li ON li.platform_order_id = o.platform_order_id AND li.shop_id = o.shop_id
WHERE o.shop_id = 1 AND li.estimated_unit_cost IS NULL;
```

Negative margin orders (assume shipping/fees = 0):

```sql
SELECT o.id, o.platform_order_id,
       o.total_price - COALESCE(sum(li.estimated_unit_cost * li.quantity), 0) as net_profit_est
FROM canonical_orders o
JOIN canonical_order_line_items li ON li.platform_order_id = o.platform_order_id AND li.shop_id = o.shop_id
WHERE o.shop_id = 1
GROUP BY o.id, o.platform_order_id, o.total_price
HAVING o.total_price - COALESCE(sum(li.estimated_unit_cost * li.quantity), 0) < 0;
```

Orders ingested:

```sql
SELECT COUNT(*) FROM canonical_orders WHERE shop_id = 1;
```

---

## 14) Notes / assumptions to call out (so we don't sneak in inconsistent names)

* We **do not** use `*_cents` columns in current canonical migration — canonical uses decimal `total_price`, etc. Don’t invent `_cents` column names without updating docs and migrations.
* `canonical_order_line_items.estimated_unit_cost` can be null — that's how we detect missing costs.
* Shipping & fees are currently not present in canonical_orders. Hence profit calculation is `revenue - line_item_costs` for FT0. Document this limitation and put it in backlog to enrich when platform provides shipping/fees (or when we create `total_shipping_cost`).
* All data-contract changes must be mirrored/locked in `docs/` before migrations (you insisted on this; I preserved that requirement).

---