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

### Pre-Tenant Authentication

Some operations begin before a tenant context exists. Their tables still use
the same strict positive-tenant policy as every other tenant-owned table.

| Table | Why Pre-Tenant Access Needed |
|---|---|
| `shops` | Registration creates a shop before tenant ID exists |
| `users` | Login queries user by email before tenant is known |
| `shop_memberships` | Login checks membership before tenant context is set |
| `refresh_tokens` | Refresh/logout resolves an opaque token hash before tenant context is set |
| `user_sessions` | Session management is pre-tenant |
| `user_lifecycle_snapshot` | Read during JWT issuance to determine phase |
| `shop_subscriptions` | Read during JWT issuance to determine tier |

Pre-tenant access uses narrow `SECURITY DEFINER` functions. Each function accepts
one normalized identifier or high-entropy token, returns only the minimum fields
needed for that operation, revokes `PUBLIC`, and grants execution only to
`sf_app`:

```sql
CREATE FUNCTION resolve_auth_user_by_email(p_email text)
RETURNS jsonb
SECURITY DEFINER
SET search_path = pg_catalog, public
...;

REVOKE ALL ON FUNCTION resolve_auth_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_auth_user_by_email(text) TO sf_app;
```

The function owner bypasses RLS only inside that audited function. The runtime
role never gains table-wide visibility at tenant `0`, empty, or missing context.

### The `shops` Table Special Case

`shops` is the root tenant entity — it has no `shop_id` column (it IS the shop). Its isolation policy uses `id`:

`shops` uses a strict `id = app.current_tenant` policy for every command.
Registration calls `create_tenant_shop(name)`, receives only the new ID, sets
that tenant on the same transaction, and performs every dependent write under
normal RLS.

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

OAuth is not an RLS bypass. `shopify_app_installations`, `integrations`, and
`domain_events` require a positive, matching `app.current_tenant` for reads and
writes. Pre-tenant callbacks may use narrowly scoped `SECURITY DEFINER`
functions that return tenant identifiers only; credential and payload access
then runs inside `withTenant()`.

`integration_oauth_states` is a deliberate pre-tenant CSRF-token boundary and
must be marked with the explicit application `systemQuery`/`systemTransaction`
exception. Entitlement reads and writes occur only after tenant resolution.

---

## 5. Migration Rules

### Every New Table Must Have RLS

The migration runner runs `scripts/check_rls.sh` before applying migrations and
then interrogates the migrated database. The post-migration release gate
requires `sf_app` to be non-superuser/non-bypass, requires every RLS table to be
forced, rejects public `shop_id` tables without RLS, rejects RLS tables without
policies, and proves an invalid tenant sees no rows as `sf_app`.

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

If a table is read or written during login, token issuance, or registration
before tenant context exists, keep strict RLS and add a narrow, explicitly
granted `SECURITY DEFINER` function. Never add a tenant-zero split policy.

### Forward-only release-gate recovery

Migration `0138` closed the known tenant-zero access paths. After it was
applied, the strengthened release gate identified one additional legacy
policy on `activation_audit_events` that permitted `shop_id IS NULL`.

Because `0138` was already applied and checksum-recorded, it must remain
immutable. Migration `0139` is the forward-only correction:

- abort when historical rows without `shop_id` exist;
- make `activation_audit_events.shop_id` non-nullable;
- enforce strict tenant equality in both `USING` and `WITH CHECK`;
- preserve nullable `user_id`, existing events, keys, and indexes;
- reject rollback because restoring the permissive policy is unsafe.

Never edit, remove, roll back, or rewrite the checksum of an applied
security-boundary migration. Add a new forward migration instead.

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
**Fix:** Ensure `SET LOCAL app.current_tenant` is called before the INSERT. For a
genuine pre-tenant operation, add or call the approved narrow resolver.

### "query would be affected by row-level security policy"

**Cause:** `SET LOCAL row_security = off` was attempted by a non-superuser role.
**Fix:** Only `sf_user` can disable row security. `sf_app` cannot. Use a narrow
`SECURITY DEFINER` function for a genuine pre-tenant operation.

### All counts return data for wrong tenant

**Cause:** Queries are being run as `sf_user` (superuser with BYPASSRLS), not `sf_app`.
**Fix:** Check `.env` — `PGUSER` must be `sf_app`, not `sf_user`. Run pen-test as `sf_app` explicitly.

### Login fails with AUTH_INVARIANT_VIOLATION

**Cause:** Auth code queried a tenant table directly before resolving its tenant.
**Fix:** Route the operation through the approved pre-tenant resolver, then use
`withTenant()` for all subsequent reads and writes.

### Tier shows "starter" after login despite growth subscription

**Cause:** Token issuance read subscriptions before resolving membership.
**Fix:** Resolve membership through the narrow resolver, then read the
subscription under `withTenant()`.

### Phase shows "FT_MINUS_ONE" despite FT2 seed

**Cause:** Lifecycle state was read before resolving membership.
**Fix:** Resolve membership first and read lifecycle state under `withTenant()`.

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

**Related — REBUILD-03:** the same class on `order_margin_snapshot`, via reconciliation's `computeOrderMargin` during rebuild. Open, non-fatal (logged and skipped, so rebuild still exits 0 — which is why it survives). That table needs **both** `synchroflow.projection` and `synchroflow.reconciliation`. Full writeup: `docs/playbooks/overview-module-playbook.md` §5.

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

**Why strict policies plus SECURITY DEFINER resolvers for auth tables?**
Tenant-zero SELECT policies expose every row to the runtime role, including
password hashes and reset tokens. Narrow functions preserve the required
chicken-and-egg lookup without granting table-wide visibility.

**Why `current_setting('app.current_tenant', true)` with the true flag?**
The second argument `true` makes `current_setting` return NULL instead of
throwing when the GUC does not exist. Strict policies then fail closed; they do
not treat NULL, empty, or zero as an access mode.

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
matches. `systemQuery()` is only safe for explicitly RLS-exempt system tables
or for calling an approved narrow resolver — never for a
strict-policy table you're trying to read cross-tenant by a
globally-unique key.

**Real incident (2026-06-29, Thread A-2):** `projection.db.worker.ts`'s
per-event-loop intent reconciliation looked up `orders.aggregate_version`
by `lasyncro_order_id` (globally unique, shop_id not yet known — the
exact chicken-and-egg case now solved by narrow resolver functions).
Wrapped the read in `systemQuery()`, assuming it was a Postgres-level
bypass like `sf_user`. It is not. The query silently returned `undefined`
instead of throwing, was misread as a real version mismatch, and the
intent was skipped — not corrupted, just silently stuck, masked for
several poll cycles before being traced back to this.

**Fix:** for a genuine chicken-and-egg lookup (global ID known, tenant
not yet known, table has a strict policy) there is no safe generic
bypass available to `sf_app` — `sf_app` has no `BYPASSRLS`. The two real
options are: (a) add a narrow `SECURITY DEFINER` resolver that returns only the
minimum locator fields; or (b) restructure the caller so
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
### Webhook handlers silently ignored tenant context (ISS-RLS2)

**Cause:** `webhookRouter.ts` set tenant context via a bare, non-transactional
`db.raw("SET app.current_tenant = '${shopId}'")` before dispatching to
handler functions, which then made their own independent `db(...)` calls
assuming that context survived. Per §3, plain `SET` inside no transaction at
all is even more fragile than the `withTenant()` case above — there was no
transaction boundary holding the connection, so every downstream query in a
handler could land on a completely different pooled connection with no
tenant context whatsoever. Once ISS-SEC1 closed the accidental
connection-leak workaround, this pattern had nothing left to hide behind.

**Verified directly, 2026-07-15:** confirmed via the same class of
`current_setting('app.current_tenant', true)` check used for ISS-SEC1 — a
live `getUsage`-style read against a shop's own `shop_usage_metrics` row
returned zeroed-out data despite a real row existing, because RLS silently
matched zero rows for the connection's actual (default `'0'`) tenant
setting.

**Fix:** `webhookRouter.ts`'s entire ledger-write → dispatch → ledger-mark
flow now runs inside a single `db.transaction()` with `SET LOCAL
app.current_tenant`. The `WebhookHandler` type signature was changed to
require `(envelope, trx)`, and all 9 Shopify handlers plus
`webhook-ledger.service.ts` and `order-identity-guard.service.ts` were
updated to accept and use that `trx` instead of importing the bare `db`
singleton. Handler-level errors are caught and `markFailed` is written
*inside* the transaction, but the error itself is re-thrown *after* commit
— throwing inside the transaction callback would have rolled back the
`markFailed` write along with everything else.

**Known remaining gap (ISS-RLS3, tracked separately):** `WebhookRouter` is
shared infrastructure also used by Stripe billing webhooks
(`stripe.webhook.ts`) and carrier tracking webhooks
(`sendcloud.tracking.handler.ts`, `shippo.tracking.handler.ts`). These
still use the old 1-argument handler signature and bare `db` internally.
TypeScript compiles them fine against the new `WebhookHandler` type (a
function with fewer parameters is assignable to one expecting more), so
this doesn't surface as a build error — it has to be checked for
explicitly, file by file.

**Lesson:** a handler function silently accepting fewer arguments than its
declared type allows a partially-migrated codebase to compile cleanly while
still being broken at specific call sites. `grep` for the old bare `db`
import is a more reliable signal than a clean `tsc` build when migrating a
shared handler type incrementally.

**Cause:** Despite §3 explicitly stating "Never use `SET app.current_tenant`
(without LOCAL)," the canonical `withTenant()` implementation in `db.ts` did
exactly that — `await trx.raw(\`SET app.current_tenant = '${shopId}'\`)`. Since
plain `SET` persists on the physical connection past `COMMIT`, and every
tenant-scoped call site funnels through this one function, this was a
codebase-wide cross-tenant leak vector rather than an isolated call-site bug.

**Verified directly, 2026-07-15:** a standalone script called
`withTenant(1, trx => trx.raw('SELECT 1'))`, let it commit, then fired 25
subsequent `db.raw(\`SELECT current_setting('app.current_tenant', true)\`)`
calls with zero tenant context of their own. All 25/25 returned `'1'` —
i.e. any unrelated request that drew the same pooled connection after a
shop-1 request would silently operate as shop 1 for every RLS-gated query,
including writes, until that connection happened to be reused by another
`withTenant()` call.

**Fix:** changed the single line in `db.ts` to `SET LOCAL app.current_tenant
= '${shopId}'`, matching §3's documented pattern. Re-ran the same script
post-fix to confirm the leak no longer reproduces.

**Lesson:** this doc having the correct rule in §3 did not prevent the bug
— the canonical helper function itself drifted from it, undetected, likely
since `withTenant()` was first written. Documented conventions need to be
spot-checked against their own reference implementation periodically, not
just applied by new call sites.

**Cause:** `SELECT ... FOR UPDATE` does not only evaluate the table's
SELECT policy — Postgres also requires the row to pass the table's
UPDATE policy, because locking a row implies you might write to it. A
table with the historical split-policy shape (permissive SELECT and strict
write policy) will silently return
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
shape as pre-tenant resolvers) using `.forUpdate().skipLocked()` — copied
from `processDomainEvent.ts`'s pattern without re-examining whether
locking was actually needed in this context. The table's historical split policy
(permissive SELECT, strict write) meant this specific query always
returned `[]`, silently — no crash, no error, no log output at all. The
worker appeared completely healthy (cursor advancing, no errors) while
genuinely doing nothing with the reconciliation backlog, for hours.

**Fix:** use the bounded discovery resolver to obtain identifiers, then perform
locking and mutation under `withTenant(shop_id)`. Do not restore a permissive
cross-tenant SELECT policy.

**Diagnostic for historical incidents:** compare the old plain SELECT and
`FOR UPDATE` behavior to explain a stuck worker, then replace the cross-tenant
policy with a bounded resolver. The current architecture must not retain the
split policy merely to support polling.

### ISS-RLS3/ISS-RLS4: Stripe and carrier webhook handlers had the same gap — one was a live revenue-path outage

**Cause:** `WebhookRouter` is shared infrastructure used by Shopify, Stripe,
and carrier-tracking webhooks alike. The ISS-RLS2 fix updated the router and
all 9 Shopify handlers, but Stripe's 5 billing handlers
(`handleSubscriptionUpsert`, `handleSubscriptionDeleted`,
`handlePaymentFailed`, `handleInvoicePaid`, `handleCheckoutSetupComplete`)
and 2 carrier handlers (`sendcloud.tracking.handler.ts`,
`shippo.tracking.handler.ts`) were still on the old 1-argument handler
signature, still importing bare `db`. This compiled cleanly against the
updated `WebhookHandler` type — TypeScript allows a function with fewer
parameters to satisfy a type expecting more — so nothing surfaced at build
time; it had to be found by grepping for the old bare `db` import pattern
file by file.

**ISS-RLS4, found and fixed in the same pass — critical:**
`handleSubscriptionUpsert.ts`, the primary Stripe tier-granting handler, was
worse than the others: it opened its own **separate**
`db.transaction()` with **no tenant context set at all** — not even the
bare `SET` anti-pattern, nothing. Verified directly at the Postgres level:
an identical `INSERT ... ON CONFLICT` as `sf_app` with no tenant context
throws `new row violates row-level security policy for table
"shop_subscriptions"`. This means any real `customer.subscription.created`
or `customer.subscription.updated` webhook — i.e. every new paid
subscription or tier change — would fail this exact way, every time,
including on Stripe's automatic retries, since the failure is
deterministic. This shipped independent of ISS-SEC1/RLS2 and had nothing to
do with connection-pool leakage; it never worked correctly in the first
place. Re-verified fixed with the identical query after the change, this
time with `SET LOCAL app.current_tenant` set: clean `INSERT 0 1`.

**Fix:** all 7 remaining handlers converted to accept and use the router's
`trx`, matching the ISS-RLS2 pattern. Two of the five billing handlers
(`handleInvoicePaid`, `handleCheckoutSetupComplete`) already had a
correctly-scoped inner `db.transaction()` with `SET LOCAL` — these were
simplified to use the router's `trx` directly instead, removing the
redundant nested transaction rather than leaving two valid patterns
side by side.

**Lesson:** when a shared dispatcher's handler type changes, grep for every
registration call site (`WebhookRouter.register`), not just the ones in the
directory you were already working in — `stripe.webhook.ts` and the carrier
handlers live in entirely different folders from the Shopify handlers and
were easy to miss. A shared type change is only as complete as its least
visible caller.
