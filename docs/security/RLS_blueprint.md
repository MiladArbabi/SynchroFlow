# RLS Architecture — SynchroFlow

## Row Level Security: Design, Invariants & Operational Guide

---

## 1. What RLS Does and Why It Exists

SynchroFlow is a multi-tenant B2B SaaS. Every Shopify merchant is a **tenant** — their orders, inventory, customers, and financials must be completely invisible to every other tenant, at all times, under all query paths.

Row Level Security (RLS) is PostgreSQL's built-in mechanism to enforce this at the database layer. Even if application code has a bug that passes the wrong `shop_id`, or omits a `WHERE` clause entirely, RLS blocks the query before any data is returned.

**Without RLS:** one buggy API endpoint could expose merchant A's revenue data to merchant B. In a B2B SaaS handling financial data, that ends the company.

**With RLS correctly configured:** the database itself is the last line of defence. Application bugs become data access violations, not data breaches.

---

## 2. The Two Database Roles

SynchroFlow uses two PostgreSQL roles with strictly separated responsibilities.

### `sf_user` — Migration Superuser

- **Privileges:** SUPERUSER, BYPASSRLS
- **Used by:** `knexfile.cjs` (migrations), direct psql admin sessions
- **Purpose:** Schema changes, RLS policy creation, role management
- **Never used by:** the running application
- **Credentials:** `PGMIGRATION_USER=sf_user`, `PGMIGRATION_PASSWORD=sf_pass`

### `sf_app` — Application Runtime Role

- **Privileges:** SELECT, INSERT, UPDATE, DELETE on all tables. No superuser. No BYPASSRLS.
- **Used by:** the Express API server, all workers
- **Purpose:** All runtime data access — subject to RLS policies
- **Credentials:** `PGUSER=sf_app`, `PGPASSWORD=sf_app_pass`

**Critical rule:** `sf_user` bypasses all RLS policies silently. Any query run as `sf_user` will see all tenants' data regardless of `app.current_tenant`. Never use `sf_user` credentials in `.env` for the running application.

### Switching Between Roles

**Direct psql as superuser (migrations, schema changes, pen-tests):**

```zsh
docker exec -e PGPASSWORD=sf_pass synchroflow_db psql -U sf_user -d synchroflow_db
```

**Direct psql as app user (verify RLS works as the app sees data):**

```zsh
docker exec -e PGPASSWORD=sf_app_pass synchroflow_db psql -U sf_app -d synchroflow_db
```

**Migrations always use sf_user automatically:**

```zsh
npx knex migrate:latest --knexfile apps/backend/knexfile.cjs
```

---

## 3. The Tenant Context Variable

RLS policies evaluate against a PostgreSQL session variable: `app.current_tenant`.

This variable holds the integer `shop_id` of the current authenticated tenant. It must be set at the start of every database transaction before any tenant-scoped query runs.

### Setting Tenant Context

```sql
-- Inside a transaction (mandatory pattern):
SET LOCAL app.current_tenant = '1';
```

`SET LOCAL` is scoped to the current transaction only. It resets automatically when the transaction commits or rolls back. This is the only safe way to set tenant context.

**Never use `SET app.current_tenant`** (without LOCAL) — it persists for the entire connection session, which in a connection pool means subsequent requests on the same connection inherit the wrong tenant.

### The Default Value

The database is configured with a safe default:

```sql
ALTER DATABASE synchroflow_db SET app.current_tenant = '0';
```

`'0'` matches no real shop (IDs start at 1), so any query that runs without explicitly setting tenant context returns zero rows from tenant-scoped tables. This is intentional — it means forgetting to set context is safe (returns nothing) rather than dangerous (returns everything).

### The Tenant Context Guard

`packages/backend-core/src/db.ts` wraps all Knex queries with a runtime check that throws if `app.current_tenant` is not set. This catches missing tenant context at development time before it reaches production.

The canonical entrypoint for tenant-scoped operations is `withTenant()`:

```typescript
import { withTenant } from '@lasyncro/backend-core/db.js';

await withTenant(shopId, async (trx) => {
  // All queries here are tenant-scoped via RLS
  const orders = await trx('orders').where({ shop_id: shopId });
});
```

---

## 4. Policy Architecture

### Standard Tenant Tables (Data Tables)

The vast majority of tables use a simple ALL-command policy:

```sql
CREATE POLICY table_name_tenant_isolation_policy
ON table_name
USING (shop_id = current_setting('app.current_tenant')::int)
WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
```

This means:

- **SELECT:** only rows where `shop_id` matches current tenant
- **INSERT:** only allowed if `shop_id` matches current tenant
- **UPDATE/DELETE:** only rows where `shop_id` matches current tenant

### Auth-Path Tables (Split Policies)

Some tables are read during the authentication flow **before** a tenant context exists. These require split policies:

| Table | Why Pre-Tenant Access Needed |
|---|---|
| `shops` | Registration creates a shop before tenant ID exists |
| `users` | Login queries user by email before tenant is known |
| `shop_memberships` | Login checks membership before tenant context is set |
| `refresh_tokens` | Token issuance writes before tenant context is set |
| `user_sessions` | Session management is pre-tenant |
| `user_lifecycle_snapshot` | Read during JWT issuance to determine phase |
| `shop_subscriptions` | Read during JWT issuance to determine tier |

**Split policy pattern for auth tables:**

```sql
-- SELECT: allow when no tenant context (auth flow) or correct tenant (authenticated flow)
CREATE POLICY table_select_policy
ON table_name FOR SELECT
USING (
  shop_id = current_setting('app.current_tenant', true)::int
  OR current_setting('app.current_tenant', true) IN ('', '0')
  OR current_setting('app.current_tenant', true) IS NULL
);

-- ALL (INSERT/UPDATE/DELETE): strictly tenant-scoped
CREATE POLICY table_write_policy
ON table_name FOR ALL
USING (shop_id = current_setting('app.current_tenant', true)::int)
WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
```

The `current_setting('app.current_tenant', true)` — note the `true` second argument — returns NULL instead of throwing an error when the setting doesn't exist. This is required for auth-path tables to function before tenant context is established.

### The `shops` Table Special Case

`shops` is the root tenant entity — it has no `shop_id` column (it IS the shop). Its isolation policy uses `id`:

```sql
-- SELECT: allow when no tenant or correct tenant (for auth/registration)
CREATE POLICY shops_select_tenant_isolation
ON shops FOR SELECT
USING (
  id = current_setting('app.current_tenant', true)::int
  OR current_setting('app.current_tenant', true) IN ('', '0')
  OR current_setting('app.current_tenant', true) IS NULL
);

-- INSERT: open (registration creates a shop with no prior tenant context)
CREATE POLICY shops_insert_open
ON shops FOR INSERT
WITH CHECK (true);

-- UPDATE/DELETE: strictly tenant-scoped
CREATE POLICY shops_update_tenant_isolation ON shops FOR UPDATE
USING (id = current_setting('app.current_tenant', true)::int);

CREATE POLICY shops_delete_tenant_isolation ON shops FOR DELETE
USING (id = current_setting('app.current_tenant', true)::int);
```

### RLS-Exempt Tables

Some tables are intentionally exempt from RLS because they are pipeline-internal and contain no tenant-sensitive data, or because cross-tenant access is architecturally required:

| Table | Reason |
|---|---|
| `projection_cursors` | Internal projection state — no tenant data |
| `exchange_rates` | Shared reference data — no tenant association |
| `waitlist_signups` | Pre-tenant marketing data |

Exempt tables are annotated with `// @rls-exempt` in their migration file, which suppresses the RLS check script.

### Tables Enforced via Join

Some tables have no direct `shop_id` but enforce tenant isolation via a join to a parent table:

```sql
-- Example: order_revenue_units (no shop_id column)
CREATE POLICY order_revenue_units_tenant_isolation_policy
ON order_revenue_units
USING (
  lasyncro_order_id IN (
    SELECT lasyncro_order_id FROM orders
    WHERE shop_id = current_setting('app.current_tenant')::int
  )
);
```

## 4b. OAuth-Path Tables

These tables are accessed during the Shopify OAuth flow **after** a shop exists but **before** a stable tenant context is guaranteed. They use the same split-policy pattern as auth-path tables.

| Table | Why Pre-Tenant Access Needed |
|---|---------|
| `shopify_app_installations` | Written during OAuth callback before tenant context is set |
| `integrations` | Written during OAuth token exchange before tenant context is set |
| `domain_events` | Read/written during OAuth-triggered sync bootstrap |
| `integration_oauth_states` | CSRF state token read during OAuth callback (no shop context yet) |
| `shop_module_entitlements` | Read during post-OAuth entitlement grant before tenant context |
**Verification:** All five tables confirmed to have split SELECT + ALL policies via `current_setting('\''app.current_tenant'\'', true)` in their migrations.\

---

## 5. Migration Rules

### Every New Table Must Have RLS

The migration runner runs `scripts/check_rls.sh` before applying migrations. It fails if a `createTable` migration does not include `ENABLE ROW LEVEL SECURITY`. This is enforced at CI level — migrations without RLS will not run.

### Standard Migration Template

```typescript
// After createTable():

await knex.raw(`
  ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
  ALTER TABLE my_table FORCE ROW LEVEL SECURITY;
`);

await knex.raw(`
  DROP POLICY IF EXISTS my_table_tenant_isolation_policy ON my_table;
`);

await knex.raw(`
  CREATE POLICY my_table_tenant_isolation_policy
  ON my_table
  USING (shop_id = current_setting('app.current_tenant')::int)
  WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
`);
```

**Always include `FORCE ROW LEVEL SECURITY`** — without it, the table owner bypasses RLS even when `sf_app` is configured correctly.

**Always DROP POLICY before CREATE POLICY** — migrations may be re-run in development; idempotency is required.

### When a New Table Is Auth-Path

If the new table is read or written during login, token issuance, or registration — before a tenant context exists — use the split policy pattern from Section 4.

### Granting Access to sf_app

Migration 0105 (`_0105_create_app_role_and_grants.ts`) runs as part of every migration batch and ensures `sf_app` has `SELECT/INSERT/UPDATE/DELETE` on all tables. The `ALTER DEFAULT PRIVILEGES` clause means new tables created after 0105 are automatically granted.

However, if a migration creates a table before 0105 has run (e.g. in a fresh `db:reset`), the grants are applied retroactively by 0105 when it runs later in the batch. This is idempotent.

---

## 6. Pen-Testing RLS

Run this after every schema change or new migration to verify tenant isolation:

```zsh
# Test as sf_app (the actual app role) with non-existent tenant 999
docker exec -e PGPASSWORD=sf_app_pass synchroflow_db psql -U sf_app -d synchroflow_db -c "
BEGIN;
SET LOCAL app.current_tenant = '999';
SELECT 'orders' as tbl, COUNT(*) FROM orders
UNION ALL SELECT 'alerts', COUNT(*) FROM alerts
UNION ALL SELECT 'inventory_truth', COUNT(*) FROM inventory_truth
UNION ALL SELECT 'variants', COUNT(*) FROM variants
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'order_revenue_units', COUNT(*) FROM order_revenue_units;
COMMIT;
"
```

**Expected result:** all counts are 0. Any non-zero count is a critical RLS failure.

```zsh
# Verify tenant 1 can still read its own data
docker exec -e PGPASSWORD=sf_app_pass synchroflow_db psql -U sf_app -d synchroflow_db -c "
BEGIN;
SET LOCAL app.current_tenant = '1';
SELECT 'orders' as tbl, COUNT(*) FROM orders
UNION ALL SELECT 'variants', COUNT(*) FROM variants;
COMMIT;
"
```

**Expected result:** counts match seeded data.

---

## 7. Common Failure Modes

### "new row violates row-level security policy"

**Cause:** An INSERT is blocked because the table's `WITH CHECK` clause rejects it.
**Common cause:** The inserting role is `sf_app` but `app.current_tenant` is not set (or set to `'0'`), and the table uses a strict ALL-command policy.
**Fix:** Ensure `SET LOCAL app.current_tenant` is called before the INSERT, or if this is an auth-path table, apply the split policy pattern.

### "query would be affected by row-level security policy"

**Cause:** `SET LOCAL row_security = off` was attempted by a non-superuser role.
**Fix:** Only `sf_user` can disable row security. `sf_app` cannot. Use split policies instead.

### All counts return data for wrong tenant

**Cause:** Queries are being run as `sf_user` (superuser with BYPASSRLS), not `sf_app`.
**Fix:** Check `.env` — `PGUSER` must be `sf_app`, not `sf_user`. Run pen-test as `sf_app` explicitly.

### Login fails with AUTH_INVARIANT_VIOLATION

**Cause:** `refresh_tokens` or `user_sessions` INSERT is blocked — auth-path table missing the open write policy.
**Fix:** Apply split policy pattern to the affected table's migration.

### Tier shows "starter" after login despite growth subscription

**Cause:** `shop_subscriptions` SELECT is blocked during JWT issuance — auth-path table missing the open SELECT policy.
**Fix:** Apply split policy pattern to `shop_subscriptions`.

### Phase shows "FT_MINUS_ONE" despite FT2 seed

**Cause:** `user_lifecycle_snapshot` SELECT is blocked during JWT issuance.
**Fix:** Apply split policy pattern to `user_lifecycle_snapshot`.

### "FIRST_INSIGHT_POST_COMMIT_FAILED" — domain_event_outbox RLS violation

**Cause:** `FirstInsightService` and similar services insert into `domain_events` inside a `db.transaction()` without setting `app.current_tenant`. The `auto_create_domain_event_outbox` trigger fires on INSERT and attempts to write to `domain_event_outbox`, but the outbox INSERT policy requires the calling session to have tenant context.
**Fix:** Add `await trx.raw("SET LOCAL app.current_tenant = '${shopId}'")`  as the first line of any transaction that inserts into `domain_events`. Alternatively use `withTenant()`.
**Note:** `domain_event_outbox` has a split policy — SELECT is tenant-scoped, INSERT is open (trigger-only writer, no tenant-sensitive data).

### FT0/FT2 lifecycle evaluation returns wrong results despite data existing

**Cause:** Services like `FT2EvaluatorService`, `FT0CompletionService`, and `lifecycle.controller.ts` query strict RLS tables (`orders`, `system_readiness_state`, `user_lifecycle_snapshot`) using bare `db()` calls without tenant context. RLS returns 0 rows silently — no error thrown.
**Fix:** Wrap all reads from strict RLS tables in `withTenant(shopId, trx => ...)` or `db.transaction` with `SET LOCAL app.current_tenant`. The `db` proxy only checks that `app.current_tenant` is *set* — it does not verify it is non-zero.

### Shopify sync fails with products/orders RLS violation

**Cause:** `shopify.service.ts` opens `db.transaction()` for product/order sync but acquires a new connection from the pool — the `SET app.current_tenant` in `sync.worker.ts` was set on a *different* connection.
**Fix:** Set `SET LOCAL app.current_tenant = '${shopId}'` as the first statement inside each sync transaction, not outside it in the worker.

### Projection rebuild fails with PROJECTION_WRITE_VIOLATION

**Cause:** `rebuildInventoryProjectionForVariants` writes to `order_fulfillment_status`, which is guarded by `enforce_projection_writer` trigger requiring `synchroflow.projection = 'true'`. When called from sync (not projection engine), this GUC is not set.
**Fix:** Add `await trx.raw("SET LOCAL \"synchroflow.projection\" = 'true'")` before any write to projection-guarded tables outside the projection engine.

---

## 8. Environment Configuration

```bash
# .env — application runtime (RLS enforced)
PGUSER=sf_app
PGPASSWORD=sf_app_pass

# .env — migration credentials (superuser, BYPASSRLS)
PGMIGRATION_USER=sf_user
PGMIGRATION_PASSWORD=sf_pass
```

`knexfile.cjs` automatically uses `PGMIGRATION_USER` when running migrations:

```javascript
user: process.env.PGMIGRATION_USER ?? process.env.PGUSER,
password: process.env.PGMIGRATION_PASSWORD ?? process.env.PGPASSWORD,
```

---

## 9. Architecture Decision Record

**Why not use application-level tenant filtering instead of RLS?**
Application-level filtering (e.g. always adding `.where({ shop_id })` to every query) is fragile — one missed WHERE clause leaks data. RLS enforces isolation at the database layer, independent of application code correctness. Defense in depth.

**Why split policies for auth tables instead of making them fully open?**
Fully open SELECT would allow any role to read all users, tokens, and subscriptions across all tenants — a significant privilege escalation risk. The split policy allows only the minimum pre-tenant access required for auth flows, while keeping writes strictly tenant-scoped.

**Why `current_setting('app.current_tenant', true)` with the true flag?**
The second argument `true` makes `current_setting` return NULL instead of throwing an error when the GUC doesn't exist. This is required for auth-path tables where the setting may not be initialized yet.

**Why `FORCE ROW LEVEL SECURITY`?**
Without it, the table owner (the role that created the table) bypasses RLS. In PostgreSQL, the role that runs migrations owns the tables. Using `FORCE RLS` ensures even the table owner is subject to policies when connecting as `sf_app`.

**Why database-level default `app.current_tenant = '0'`?**
Setting `ALTER DATABASE synchroflow_db SET app.current_tenant = '0'` ensures the GUC is always recognized by non-superuser roles. Without this, `current_setting('app.current_tenant')` throws "unrecognized configuration parameter" for `sf_app`. The value `'0'` is safe because no shop has ID 0.

### `systemQuery()` does not bypass RLS — only the app-level guard

**Cause:** `systemQuery()` (in `db.ts`) sets `__skipTenantCheck = true`,
which skips *only* this codebase's own Proxy check (the one that throws
"app.current_tenant is not set"). It does nothing at the Postgres level.
If `app.current_tenant` is genuinely at its database-level default `'0'`
(see §3), a `systemQuery()`-wrapped read against a table with the
standard strict RLS policy still silently returns zero rows — RLS
itself is still active and evaluating `shop_id = 0`, which never
matches. `systemQuery()` is only safe for tables that are RLS-exempt
(§4, e.g. `projection_cursors`) or have a deliberately permissive policy
(e.g. `domain_events`' write policy, `USING (true)`) — never for a
strict-policy table you're trying to read cross-tenant by a
globally-unique key.

**Real incident (2026-06-29, Thread A-2):** `projection.db.worker.ts`'s
per-event-loop intent reconciliation looked up `orders.aggregate_version`
by `lasyncro_order_id` (globally unique, shop_id not yet known — the
exact chicken-and-egg case auth-path tables solve with split policies).
Wrapped the read in `systemQuery()`, assuming it was a Postgres-level
bypass like `sf_user`. It is not. The query silently returned `undefined`
instead of throwing, was misread as a real version mismatch, and the
intent was skipped — not corrupted, just silently stuck, masked for
several poll cycles before being traced back to this.

**Fix:** for a genuine chicken-and-egg lookup (global ID known, tenant
not yet known, table has a strict policy) there is no safe generic
bypass available to `sf_app` — `sf_app` has no `BYPASSRLS`. The two real
options are: (a) add a split SELECT policy to the specific table,
matching the auth-path pattern in §4, if this kind of tenant-blind
lookup is a legitimate, recurring need; or (b) restructure the caller so
shop_id is already known/passed in before this point, avoiding the
lookup entirely. Reaching for `systemQuery()` as a default "make RLS go
away" tool is the trap — confirm the target table's actual policy text
first, every time.

**Confirmed second instance, same root cause, still dormant:**
`execution.dispatcher.worker.ts` uses the identical `systemQuery()`
pattern to poll `decision_execution_queue` cross-tenant, then reads
`decisions` immediately after — both standard strict policies (verified
2026-06-29, `decision_execution_queue_isolation`, no permissive
carve-out). Neither has failed yet only because both tables have been
empty system-wide since `decisions` was never populated (see
decision-engine-playbook.md). The instant decisions start flowing for
real, this worker will hit the exact same silent-zero-rows failure
unless fixed first.
### FOR UPDATE silently returns zero rows under cross-tenant split policies

**Cause:** `SELECT ... FOR UPDATE` does not only evaluate the table's
SELECT policy — Postgres also requires the row to pass the table's
UPDATE policy, because locking a row implies you might write to it. A
table with a split policy (permissive SELECT for cross-tenant infra
scans, strict ALL/write policy — see §4 pattern) will silently return
**zero rows** from a `FOR UPDATE` query run with no tenant context set,
even though a plain `SELECT count(*)` against the identical table, same
connection, same missing context, correctly returns the real count.

**Verified directly, 2026-06-30:**
```sql
-- as sf_app, no tenant context set:
SELECT count(*) FROM order_reconciliation_intents;              -- → 18
SELECT count(*) FROM (
  SELECT * FROM order_reconciliation_intents
  ORDER BY created_at FOR UPDATE SKIP LOCKED
) sub;                                                            -- → 0
```

**Real incident:** `projection.db.worker.ts`'s Step 4 polls
`order_reconciliation_intents` cross-tenant (genuine infra scan, same
shape as auth-path tables) using `.forUpdate().skipLocked()` — copied
from `processDomainEvent.ts`'s pattern without re-examining whether
locking was actually needed in this context. The table's split policy
(permissive SELECT, strict write) meant this specific query always
returned `[]`, silently — no crash, no error, no log output at all. The
worker appeared completely healthy (cursor advancing, no errors) while
genuinely doing nothing with the reconciliation backlog, for hours.

**Fix:** if the query is read-only discovery (finding out what's pending
before acting on individual rows one at a time, not racing other
concurrent consumers for the same rows), drop `FOR UPDATE` entirely.
Don't reach for it by default just because a similar-looking pattern
elsewhere used it — confirm whether *this* call site actually has
concurrent writers to guard against.

**Diagnostic:** if a cross-tenant poll against a split-policy table
returns suspiciously empty with zero errors, test with and without
`FOR UPDATE` as two separate `BEGIN; ... ROLLBACK;` blocks under
`sf_app`, no tenant context, before assuming the table or its policy is
broken. The policy is very likely fine — `FOR UPDATE` is invoking a
second policy you didn't mean to invoke.
