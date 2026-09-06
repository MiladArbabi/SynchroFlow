# Migration Drift & Dev-vs-Prod Playbook

**Created:** 2026-07-28
**Origin:** PROD-ZONE1 incident and the DRIFT-AUDIT-01 sweep that followed it.
**Audience:** Anyone (including future Claude sessions) touching `apps/backend/migrations/` or the deploy pipeline.

---

## 1. The Core Problem — Read This First

**Knex tracks migrations by filename in `knex_migrations`, not by file content.** Once a migration has run in an environment, Knex will never look at that file's `up()` again for that environment — no matter how much you edit it afterward.

This means: **if you amend an already-run migration file to add a table, column, enum value, or RLS policy, that change is silently invisible to any environment where the migration already ran.** No error. No warning. Nothing in the logs. The file in the repo says one thing; the real database says another — permanently, until someone notices.

This happened **eight separate times** in this codebase's history before it was caught (see §6, Incident Log). Every single instance had the same shape:

1. A migration runs in production (usually batch 1, 2026-06-18).
2. Someone later realizes the migration was incomplete or buggy — often after a real incident.
3. They fix it by **editing the already-run migration file** instead of writing a new one.
4. Local dev, fresh installs, and CI all pick up the fix immediately (they run every migration from scratch).
5. **Production silently does not.** It's frozen at whatever the file looked like the moment it ran.
6. Nobody notices until the missing table/column/policy causes a real failure — sometimes weeks later, sometimes never (if the code path hadn't fired yet).

### Why this is so dangerous
Fresh local setups and the disposable backend-integration harness build databases by running migrations from empty (`npm run dev:setup`, `npm run test:integration`). That fresh-schema verification still **cannot reveal migration drift already present in production.** A clean local/test database can work perfectly while production remains frozen at an older version of an already-executed migration. The only way to catch that class of drift is to compare production's *actual* schema against what the current migration files would produce from scratch.

---

## 2. Rule 7 — Updated

The original workflow rule was: *"Database migrations — never create patch files; always amend base migrations. Keep migration directory clean."*

**This rule is now split by whether the migration has run in production:**

| State | Rule |
|---|---|
| Migration has **not yet run in production** | Amend freely. Keep the migration directory clean — no patch files. |
| Migration **has already run in production** | **NEVER amend it.** Write a new forward migration instead, even for a one-line fix. |

This is enforced by the checksum guard (§3), not just convention — a tampered already-run migration file will now fail the release phase outright.

**If you're not sure whether a migration has run in prod:** check `knex_migrations` in prod directly. Don't guess from commit dates.

---

## 3. The Checksum Guard — What It Does and Where It Lives

**File:** `apps/backend/src/scripts/runMigrationsWithChecksum.ts` (compiles to `dist/src/scripts/runMigrationsWithChecksum.js`)

**What it does, in order:**
1. Runs `scripts/check_rls.sh` — scans every migration `.ts` file for `createTable` calls and verifies each one either has RLS enabled or is explicitly annotated as exempt (see `RLS_EXEMPT_MIGRATIONS` array in the script).
2. Hashes every `.js` migration file in `dist/migrations/` (SHA-256).
3. Compares each hash against what's stored in the `migration_checksums` table.
4. **If any already-recorded migration's hash doesn't match → throws `[MIGRATION_DRIFT_DETECTED]` and aborts.** This is what catches someone amending an already-run migration.
5. If checks pass, runs `db.migrate.latest()` as normal.
6. Records/updates the checksum for every migration (including new ones) in `migration_checksums`.

**This guard existed since 2026-03-17 (migration `0066`) but was never wired into the actual production deploy path until 2026-07-28.** Production's `fly.toml` `release_command` called a separate, bare script (`migrate-prod.mjs` — since deleted) that did plain `knex.migrate.latest()` with zero drift detection. That gap is what allowed all eight incidents in §6 to reach production undetected.

**Current state (as of 2026-07-28):** `fly.toml`'s `release_command` now runs the checksum-guarded script directly:
```toml
[deploy]
  release_command = "node /app/apps/backend/dist/src/scripts/runMigrationsWithChecksum.js"
```

### What this means going forward
- Every `fly deploy` now runs this check as part of the release phase.
- If a release fails with `[MIGRATION_DRIFT_DETECTED] <filename> has been modified after execution`, **do not force past it.** That means someone amended an already-run migration. Write a forward migration instead (see §5).
- The **first** deploy after this guard went live (2026-07-28) established baseline checksums for all ~130 migrations *as they existed at that moment*. It does **not** retroactively detect drift that happened before that date — see §6 for what was already found and fixed manually.

---

## 4. Dev vs Prod: The Two Databases You Actually Need

Local dev and CI **cannot** reveal migration drift, because they always build from empty. To actually verify a fix, or to audit for unknown drift, you need two different kinds of scratch database. Get the naming straight — this trips people up:

### `fresh_scratch` — "what a brand-new install looks like"
Built by running **every migration in the repo, in order, from a completely empty database.** This is the canonical, "if history had gone perfectly" schema. Use it to answer: **"does my new migration break a fresh install / CI / a new team member's laptop?"**

```zsh
PGPASSWORD=sf_pass psql -h localhost -p 5432 -U sf_user -d postgres -c "DROP DATABASE IF EXISTS fresh_scratch;"
PGPASSWORD=sf_pass psql -h localhost -p 5432 -U sf_user -d postgres -c "CREATE DATABASE fresh_scratch;"
NODE_ENV=production DATABASE_URL="postgresql://sf_user:sf_pass@localhost:5432/fresh_scratch" node apps/backend/dist/src/scripts/runMigrationsWithChecksum.js
```

### `prod_scratch` — "an exact clone of real production, sitting safely on your laptop"
Built by dumping real prod (schema + data) and restoring it locally. This is where you rehearse a fix against the *actual, currently broken* state — with zero risk to real customer data. Use it to answer: **"does my migration actually fix the real prod problem, without breaking anything else?"**

```zsh
# 1. Open a tunnel to prod's DB (leave this running in its own terminal tab)
fly proxy 5434:5432 -a synchroflow-db

# 2. Dump real prod through the tunnel
pg_dump "postgresql://<user>:<pass>@localhost:5434/synchroflow" -F c -f /tmp/prod_snapshot.dump

# 3. Create the scratch DB and restore into it
PGPASSWORD=sf_pass psql -h localhost -p 5432 -U sf_user -d postgres -c "DROP DATABASE IF EXISTS prod_scratch;"
PGPASSWORD=sf_pass psql -h localhost -p 5432 -U sf_user -d postgres -c "CREATE DATABASE prod_scratch;"
PGPASSWORD=sf_pass pg_restore -h localhost -p 5432 -U sf_user -d prod_scratch --no-owner --no-privileges /tmp/prod_snapshot.dump
```

> A `pg_restore: error: ... unrecognized configuration parameter "transaction_timeout"` is expected and harmless if your local Postgres is an older major version than prod (e.g. local 16 vs prod 17). It's one preamble `SET` statement, not real data. Always verify the restore actually landed by comparing row counts / table lists against real prod directly afterward — don't just trust "no fatal error."

### The required rehearsal order for every migration, no exceptions
1. Write the migration.
2. Compile: `cd apps/backend && npx tsc --project tsconfig.migrations.json`
3. **Check `dist/migrations/` for stale duplicate compiled files** if you renamed the migration file at any point (see §7, gotcha #3).
4. Run against `fresh_scratch` — must succeed as a **clean no-op** if the tables/columns already exist there. If it errors with "already exists," your migration isn't idempotent — fix that before going further (see §5).
5. Run against `prod_scratch` — must succeed and actually produce the fix. Verify the resulting schema matches `fresh_scratch`'s.
6. Only then run against real prod, through the same `fly proxy` tunnel.
7. Verify real prod's resulting schema matches what you saw in `prod_scratch`.
8. If the bug was reachable from a live HTTP endpoint, hit it live (see §7, "verify live, don't assume").

---

## 5. Writing a Forward-Fix Migration — Requirements Checklist

Every migration written to backfill prod drift must satisfy **all** of these:

- [ ] **New file, new number.** Never edit the drifted migration itself. Check the actual highest migration number in use first — don't assume the last one you see in a directory listing is current (see §7, gotcha #4).
- [ ] **Idempotent.** Must be a safe no-op on `fresh_scratch` (where the original migration already did the job correctly) and a real fix on `prod_scratch` (where it didn't). Use `knex.schema.hasTable()` / `hasColumn()` guards for anything that might already exist. `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for enums. This was missed on the very first fix of the night (migration `0128`) and broke fresh installs — don't repeat that.
- [ ] **Explains itself.** Header comment states: which original migration drifted, what batch/date it ran, what was added and when, why it never reached prod, and which new migration fixes it.
- [ ] **Matches the confirmed target schema, not a guess.** Base the fix on the *current* migration file's `up()` (which represents the intended, corrected design) cross-checked against a real schema diff — not on inference from commit messages alone.
- [ ] **Backfill data if needed.** If the missing column must be `NOT NULL` and existing rows need a real value (not a default), write the backfill `UPDATE` before adding the constraint. If the table is empty in prod, say so explicitly in the comment and skip backfill logic.
- [ ] **Add a drift warning to the original migration file** once the fix is verified (see template in §7).
- [ ] **Rehearse per §4 before touching real prod. No exceptions, even for "obviously safe" changes.**

---

## 6. Incident Log — Every Drift Instance Found and Fixed (2026-07-28)

All eight were the exact same root cause (§1). Listed for reference so nobody re-diagnoses the same thing twice.

| # | Migration(s) drifted | What was missing in prod | Forward fix | Severity |
|---|---|---|---|---|
| 1 | `0048`, `0049` | `warehouses` table entirely; `warehouse_id` column | `0128` | **Critical — broke all signup/Shopify install**, confirmed live 500s |
| 2 | `0010`, `0056` | `historical_sales`, `product_costs`, `user_milestones` tables | `0129` | High — active code paths, presumed failing |
| 3 | `0037` | `order_reconciliation_intents.shop_id` + RLS entirely | `0130` | **Critical, unfired** — next real order created in prod would have failed outright |
| 4 | `0075`, `0078`, `0008` | `FORCE ROW LEVEL SECURITY` + split policies on `commands`/`decision_execution_queue`; `WITH CHECK` on `return_jobs` | `0131` | High — real tenant-isolation gap, app connects as table owner |
| 5 | `0067`, `0094` | `suppliers.moq`/`lead_time_days`; `shop_operational_settings.returns_aging_*` | `0132` | Medium — active code paths |
| 6 | `0006`, `0084` | `fulfillment_status_type` missing `'address_corrected'`; `stow_task_trigger` missing `'return_restock'` | `0133` | Medium — would throw invalid-enum error on use |

**Also fixed, separate root cause (not drift — a mechanism gap):**
- `CHECKSUM-GUARD-01` — the checksum guard existed but was never wired into the actual prod release command. Fixed by swapping `fly.toml`'s `release_command` and deleting the dead `migrate-prod.mjs`.

**Still open, lower priority, not confirmed as live incidents:**
- A handful of nullability mismatches (some columns stricter/looser than canonical) — not yet triaged.
- `carrier_integration`-type table: `public_key`/`private_key`/`api_token` are `NOT NULL` in prod but nullable in canonical.
- `warehouse_locations_parent_same_warehouse_fk` — the composite 3-column FK from `0049`'s current file was never established in prod; prod still runs the older 2-column FK. Not broken today, but a real gap if anything ever depends on the composite version.
- `shop_operational_settings` has never had `FORCE ROW LEVEL SECURITY` in its migration file at any point — this is a pre-existing design gap, not drift, and should be triaged separately.

---

## 7. Gotchas — Things That Actually Bit Us Tonight

**Read this section before you start.** Every one of these cost real time during the session that produced this playbook.

1. **`NODE_ENV` controls which `knexfile.cjs` block is used, and the two blocks connect completely differently.**
   `development` builds its connection from discrete `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` env vars (loaded from root `.env`) and **ignores `DATABASE_URL` entirely.** `production` uses `DATABASE_URL` directly. If you're pointing at a scratch DB or a proxied prod tunnel via `DATABASE_URL`, you must set `NODE_ENV=production` or your connection string will be silently ignored and you'll connect to whatever `.env` points at instead.

2. **Migrations must be compiled before they can run.** `apps/backend/migrations/*.ts` are not directly runnable — `knexfile.cjs` points at `dist/migrations/*.js`. Always `cd apps/backend && npx tsc --project tsconfig.migrations.json` after writing or editing a migration, before trying to run it anywhere.

3. **Renaming a migration file leaves a stale compiled duplicate behind.** If you write a migration, compile it, then rename the source file (e.g. to fix a numbering collision), the *old* compiled `.js`/`.js.map` under the old name stays in `dist/migrations/` until you delete it manually. Two files creating the same table will collide. Always check `ls dist/migrations/ | grep <feature-name>` after a rename and delete the stale pair before recompiling.

4. **Always check the real highest migration number before naming a new one.** Don't assume the last migration you've seen recently is the newest — someone else's work (or a different session) may have added a higher-numbered one you haven't seen. Check with: `ls apps/backend/migrations/ | grep -oE '_[0-9]{4}[a-z]?_' | sort -u | tail -10`

5. **`fly.toml`'s `[build] dockerfile = "..."` tells you which Dockerfile is actually live.** This repo has two (`./Dockerfile` and `./apps/backend/Dockerfile`) — only the one referenced in `fly.toml` is what Fly actually builds and deploys. The other is dead. Don't assume; check `fly.toml` directly.

6. **The production Docker image contains the full build stage output, not just `dist/`.** `COPY --from=build /app /app` in the runtime stage means `.ts` migration sources, `scripts/check_rls.sh`, etc. are all present at runtime, at the same relative paths as in the repo. This is why the checksum guard's RLS check (which globs `.ts` files) works correctly in production — verify this kind of assumption inside a real built image (`docker build` + `docker run --rm <image> ls <path>`) rather than guessing from the Dockerfile alone.

7. **`fly logs -a <app>` without `--no-tail` only shows a live-streaming tail — it will NOT search historical logs, and an empty grep result against it proves nothing.** Use `fly logs -a <app> --no-tail` for anything you need to actually search, or better: start a background log capture, fire the request, then grep the captured file.

8. **`fly ssh console -a <db-app>` for an "Unmanaged Fly Postgres" app connects you directly into a working `postgres=#` prompt on the real database** — this is often simpler and more reliable than fighting `fly proxy` port conflicts, if you just need to run a few queries and don't need a local tool like `pg_dump`/`pg_restore` connected to it.

9. **`fly proxy <port>:5432` can fail with "address already in use" from a stale process on that port** — check `lsof -i :<port>` (or `sudo lsof -i :<port>` if it's a system port like 5432 already bound by Docker) and either kill the stale process or just pick a different local port.

10. **Get real prod credentials from the app that connects to the DB, not the DB app itself.** `fly ssh console -a <backend-app> --command "printenv DATABASE_URL"` gives you the real connection string the backend actually uses (host, port, user, password, db name all correct) — far more reliable than trying to reconstruct it manually.

11. **`ALTER TYPE ... ADD VALUE` is safe as its own migration, but cannot be used in the same transaction as the new value.** Keep enum-value additions in their own standalone migration/transaction, separate from any code that would immediately use the new value.

12. **Postgres does not support removing enum values.** Any migration that adds an enum value should have a `down()` that either does nothing (documented as such) or fully rebuilds the type — don't leave a `down()` that silently fails or lies about reverting.

13. **`FORCE ROW LEVEL SECURITY` only matters if the app connects as the table owner (or another privileged role).** Without `FORCE`, Postgres exempts the owner from RLS entirely, regardless of how strict the policies are. Before treating a missing `FORCE` as low-priority cosmetic drift, check: `SELECT tablename, tableowner FROM pg_tables WHERE tablename = '<table>';` and compare against the role in your `DATABASE_URL`.

14. **macOS ships BSD `cat`/`grep`, not GNU.** `cat -A` (GNU, shows line endings) fails on macOS — use `cat -evt` instead. `grep -P` (Perl regex) isn't supported by BSD grep either. If a command errors with "illegal option," suspect a GNU/BSD mismatch before anything else.

15. **`git log origin/main` is the only real proof of a push — never trust "committed and pushed" as a status report.** A local commit can silently fail to push (auth issue, network blip, wrong branch) with no obvious error in a truncated terminal view. Always verify: `git log origin/main -3 --oneline` and confirm your commit hash is actually there.

16. **Verify live, don't assume from schema alone.** A migration succeeding doesn't prove the original bug is fixed in practice — where possible, exercise the actual code path live (e.g. hit the real HTTP endpoint) before declaring the issue closed. We caught the `warehouses`/signup bug this way (confirmed 500 → 201) but couldn't do the same for the products-FT2 endpoint (blocked by an unrelated lifecycle gate) — in that case we relied on schema diff + static code audit instead, and said so explicitly rather than claiming full verification we didn't have.

17. **Clean up test data created during live verification.** Any throwaway shop/user created to prove a live fix works should be deleted afterward (`DELETE FROM shops WHERE id = <test-shop-id>`, relying on `ON DELETE CASCADE` to clean up everything downstream) — verify the cascade actually worked with follow-up count queries, don't just trust the `DELETE` succeeded silently.

---


### 2026-08-25 — `DEPLOY-MIGRATION-DRIFT-89`: committed code depended on an uncommitted migration

This was **not migration ordering drift**. Migration numbers were contiguous.

Observed state:

- `20260821180000_0156_add_allow_overage_to_shop_subscriptions.ts` existed locally but was untracked.
- Its compiled `.js` already existed under `apps/backend/dist/migrations/` and had been applied to the local DB.
- committed `wms.controller.ts` already selected and used `shop_subscriptions.allow_overage`.
- therefore a clean deployment of `main` to an environment that had never seen local `0156` could execute committed code against a schema that could not contain the required column.

The deploy-safety repair was to ship `0156` independently. At the time of that repair, `0157_make_billing_outbox_durable` and the broader billing work remained separate scope. That follow-up was subsequently resolved under `DEPLOY-MIGRATION-0157` as a coupled migration/runtime unit rather than a standalone migration.

#### Local DB connection contract

Root `.env` defines PostgreSQL connectivity using:

- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`
- `PGMIGRATION_USER`
- `PGMIGRATION_PASSWORD`

A fresh shell must not assume `DATABASE_URL` already exists.

For ordinary standalone application-role SQL:

    set -a
    . ./.env
    set +a
    export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

`PGUSER` is the restricted application role (`sf_app` locally).

Do not print `DATABASE_URL`, `PGPASSWORD`, or migration credentials.

#### Scratch migration role contract

Scratch databases are owned/administered by the configured migration role, not `sf_app`.

For production-mode migration rehearsal, both URLs must target the same scratch database with different roles:

    export NODE_ENV=production
    export DATABASE_URL="postgresql://${PGMIGRATION_USER}:${PGMIGRATION_PASSWORD}@${PGHOST}:${PGPORT}/fresh_scratch"
    export APP_DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/fresh_scratch"

`DATABASE_URL` is the privileged migration connection.

`APP_DATABASE_URL` is the restricted runtime connection required by production database configuration.

Use the equivalent pair for `prod_scratch`.

Using `sf_app` to drop/create scratch databases fails ownership/permission checks. Omitting `APP_DATABASE_URL` causes the production-mode migration runner to fail before migrations execute.

#### Bounded migration proof

`migrate:latest` is insufficient when proving migration N can ship independently of later migration N+1, because it applies every pending migration.

For an independent-shippability check:

1. create an isolated scratch database;
2. apply migrations sequentially with Knex `migrate:up <filename>` only through the target migration;
3. verify the target appears in `knex_migrations`;
4. verify the later migration does not appear;
5. verify the resulting schema directly.

For `0156`, this proof passed:

    0156 recorded
    0157 absent
    shop_subscriptions.allow_overage = boolean, NOT NULL, default true

This established that `0156` is independently shippable.

Because `0156` itself had not been committed/deployed previously, this incident does not require adding a historical drift warning to an older migration file. The defect was the committed-runtime/uncommitted-schema dependency itself.


### 2026-08-25 — `DEPLOY-MIGRATION-0157`: migration changes an existing runtime dispatch contract

`0157_make_billing_outbox_durable` was locally applied while its source migration and matching durable dispatcher work remained uncommitted.

Unlike `0156`, `0157` is not safe to classify as a migration-only deploy repair. It changes the existing outbox dispatcher contract by excluding `billing/overage` from generic dispatch and introduces the claim/mark/failure functions used by the durable billing worker.

The atomic production unit is therefore:

- `0157_make_billing_outbox_durable.ts`
- `domain-event-outbox.dispatcher.ts`
- `stripe.meter.service.ts`
- `shopify.events.service.ts`

Shipping the dispatcher without `0157` would make runtime calls to missing DB functions. Shipping `0157` without the durable dispatcher would exclude `billing/overage` from generic dispatch without activating its intended durable delivery path.

Verification completed before commit:

- full `fresh_scratch` and `prod_scratch` production-mode migration rehearsals;
- isolated bounded DOWN/UP proving `0157` applies directly after `0156` and rollback restores the old dispatcher contract;
- `sf_app` EXECUTE grants on all three durable billing functions;
- controlled one-pass worker acceptance for success, failure/backoff, published-event replay, and concurrent claim behavior;
- no real Stripe or Shopify billing request during controlled worker acceptance.

Standing rule: when a migration modifies the behavior of an existing database function consumed by runtime code, audit the **runtime coupling**, not only migration ordering or schema independence. A migration can be technically reversible and independently applicable while still being unsafe to deploy without the matching runtime change.

### 2026-09-05 — `RETURNS-SCHEMA-DRIFT-01`: `0008` amended after prod applied it (the §1 root cause, again)

Textbook §1. `20260212162717_0008_refund_executions_sovereign` ran in production
on 2026-06-18 (batch 1). It was later **amended in source** to add five
line-level decision columns. Knex had already recorded `0008` as complete, so it
never re-ran and those additions never reached production.

Confirmed production drift on `refund_execution_line_items` — missing:

| Column | Canonical type |
|---|---|
| `return_job_id` | `uuid`, nullable |
| `owner_decision` | `return_owner_decision_type`, nullable |
| `decision_notes` | `text`, nullable |
| `decision_by` | `integer`, nullable |
| `decision_at` | `timestamptz`, nullable |

...plus the single-column index on `return_job_id` and the FK
`refund_execution_line_items.return_job_id -> return_jobs.return_job_id ON DELETE CASCADE`.
Production still had the LEGACY job-level decision fields on `return_jobs`.

**Live impact, not theoretical.** `listItemsAwaitingDecision()`
(`returnJobs.service.ts`) selects `reli.owner_decision` / `decision_notes` /
`decision_at` and joins `reli.return_job_id`. On the drifted shape that query
cannot execute at all — the Returns items surface is down, not degraded.

**Note the causal link to a documented practice.** `ReturnsResolutionModule.md`
recorded a deliberate preference — *"always fix base migrations, never leave
patch files in active development"* — under which several patch migrations were
folded back into `0008`. That practice is exactly what §1 forbids for any
migration that has already run in production. This incident is its consequence.
The preference is fine for a migration that has never shipped; it is unsafe the
moment prod has recorded the file as applied.

Forward fix: `20260828120000_0165_repair_refund_execution_line_item_decision_columns`,
carrying the stable marker `RETURNS-SCHEMA-DRIFT-01`. `0008` was **not** edited —
its own DRIFT WARNING remains authoritative.

Against the §5 checklist:

- **New file, new number** — `0165`, verified as the next unoccupied slot.
- **Idempotent** — `ADD COLUMN IF NOT EXISTS`; FK and index presence are decided
  by inspecting `pg_constraint` / `pg_index` **structurally**, not by constraint
  name, so a correct FK created under a different name is never duplicated. Safe
  no-op on a canonical/fresh database.
- **Explains itself** — header states which migration drifted, when it ran, what
  was added afterwards, why it never reached prod, and what repairs it.
- **Matches confirmed target schema** — types taken from `0008`'s current `up()`.
- **Backfill** — `return_job_id` is backfilled ONLY through the deterministic
  relationship `reli.lasyncro_refund_execution_id = rj.lasyncro_refund_execution_id`.
  Zero matches stay NULL; an existing non-null link is preserved; **ambiguity
  fails closed by throwing before any write**. No timestamp/order heuristic, no
  `LIMIT 1`. Legacy `return_jobs` owner-decision values are deliberately NOT
  copied into the line-level columns — job-level is a per-job summary, line-level
  is a per-unit disposition, and copying would fabricate dispositions no operator
  ever made.
- **Rehearse per §4 before touching real prod** — still required; see status below.

`down()` is intentionally a **no-op**. These five columns, the index and the FK
are canonical `0008` structures this migration only RESTORES; they are not
feature-owned additions it introduced, so they are not its to remove. A
destructive inverse would re-create this very incident on rollback and destroy
line-level decision data written after the repair. A faked destructive inverse
would be actively dangerous, so none was written.

**Ambiguity is currently unreachable, and the guard stays anyway.** Canonical
schema carries `return_jobs_refund_execution_unique` (UNIQUE on
`return_jobs.lasyncro_refund_execution_id`, `0008`), so one refund execution can
never map to more than one return job. The fail-closed branch guards the case
where that invariant is ever weakened or itself drifts. The regression suite
proves the constraint exists and that the database rejects a second job for the
same refund execution, rather than dropping a canonical constraint to manufacture
an impossible state.

Permanent regression contract:
`tests/integration/returns/returns-schema-drift-01.test.ts` — **11/11 PASS**
targeted, **21/21 PASS** combined with
`tests/integration/returns/returned-undelivered-contract.test.ts`. It locates the
repair migration by marker (never by number), reproduces the production-shaped
drift inside a rolled-back transaction, invokes the real compiled migration
against it, and proves: all five columns restored with correct types/nullability;
exactly one canonical CASCADE FK; one usable single-column index; deterministic
backfill; unmatched stays NULL; existing link preserved; job-level decisions not
copied; canonical/fresh rerun safe; non-destructive `down()`; and the original
`listItemsAwaitingDecision` read path executing again. Disposable DB
created → migrated → runtime OK → dropped, `ORPHAN_COUNT=0`.

**Status at the time of writing: implementation and local verification
COMPLETE / PASS, not yet committed or deployed.**

> **Updated 2026-09-06.** `0165` has since shipped: its backend production repair
> and certification stand. The five decision columns are present in production.
> Its remaining *visual* Returns certification is still outstanding — it needs
> reviewer seed data, which cannot be loaded until `RETURNS-SCHEMA-DRIFT-02`
> (below) is deployed and the production schema is certified. Do not re-read the
> paragraph above as a current statement.

---

### 2026-09-06 — `RETURNS-SCHEMA-DRIFT-02`: the same `0008` amendment, a second surface

Same file, same root cause, a **different** set of columns from the -01 incident.
`20260212162717_0008_refund_executions_sovereign` was amended after production
had already applied it, so production retained an OLDER
`refund_execution_line_items` shape while canonical `0008` had moved on to the
scan-intake/runtime semantics.

Confirmed production drift, before repair:

| Column | Production | Canonical `0008` |
|---|---|---|
| `lasyncro_refund_execution_id` | `uuid NOT NULL` | `uuid NULL` |
| `refunded_amount` | `numeric(14,2) NOT NULL` | `numeric(14,2) NULL` |
| `created_at` | `timestamptz NULL`, no default | `timestamptz NOT NULL DEFAULT now()` |
| `source` | **absent** | `varchar(50) NOT NULL DEFAULT 'refund_webhook'` |

**Explicitly NOT part of -02** — all verified already correct in production and
untouched by the repair: the PK; the execution-id, revenue-unit and
`return_job_id` indexes; the execution/revenue-unit unique constraint; all three
FKs; RLS enabled **and** forced; `refund_execution_line_items_tenant_isolation_policy`;
and the five decision columns (`return_job_id`, `owner_decision`,
`decision_notes`, `decision_by`, `decision_at`) already repaired by
`RETURNS-SCHEMA-DRIFT-01` / `0165`.

**Production data-risk audit before repair:** `refund_execution_line_items` row
count **0**; `refunded_amount` precision/scale **14/2**; RLS enabled **true**;
FORCE RLS **true**; tenant policy **present**. The zero row count is what made
production's NOT NULL tightening possible in the first place, and it is why the
missing `source` column can be added with a default at all.

**How it was found.** `seed_returns_test_data.sql`, being loaded to produce
reviewer seed data, failed on the missing `source` column. The seed transaction
aborted and the final `COMMIT` resolved to `ROLLBACK`. **No production seed data
persisted, and the failed seed mutated nothing** — it was a read of reality, not
a write to it.

Forward fix:
`20260906120000_0166_repair_refund_execution_line_item_scan_intake_columns`,
marker `RETURNS-SCHEMA-DRIFT-02`. Neither `0008` nor `0165` was edited.

`0166` behaviour, against the §5 checklist:

- **validates live column types BEFORE any ALTER** — `uuid`, `numeric(14,2)`,
  `timestamptz`. An incompatible type fails closed rather than coercing or
  recreating a production column;
- `DROP NOT NULL` on `lasyncro_refund_execution_id` and `refunded_amount`
  (no-op when already nullable, so safe on fresh installs);
- `created_at` — counts NULLs first and **fails closed** if any exist rather than
  inventing timestamps for historical rows, then `SET DEFAULT now()` and
  `SET NOT NULL`;
- `source` — absent + zero rows ⇒ add `varchar(50) NOT NULL DEFAULT 'refund_webhook'`;
  absent + existing rows ⇒ **fail closed**, because a defaulted NOT NULL add would
  fabricate `'refund_webhook'` provenance for lines that may have been
  scan-intake; already present ⇒ validate `varchar(50)` compatibility, then
  converge default and nullability only, never replacing an incompatible
  definition;
- **preserves** every index, constraint, FK, RLS setting and policy — nothing is
  dropped or recreated;
- validates the final canonical shape and throws rather than leaving a
  half-repaired schema;
- **idempotent** — exact drifted shape repairs, canonical/fresh DB is a no-op,
  `up()` twice is safe.

`down()` is intentionally a **no-op**. These nullability settings, defaults and
the `source` column are canonical `0008` structures `0166` only RESTORED, not
structures it introduced. Reverting them would deliberately reintroduce a
known-invalid production schema — breaking `createManualReturnLine()` again and
dropping the provenance column.

Permanent regression contract:
`tests/integration/returns/returns-schema-drift-02.test.ts`, proving exact
production drift → canonical repair, scan-intake runtime insert semantics
(NULL execution id and amount accepted; `source` defaults to `'refund_webhook'`;
`created_at` non-null), canonical fresh-DB no-op, `up()` idempotency,
preservation of indexes/constraints/FKs/RLS/policy compared by *definition*
rather than generated name, and non-destructive `down()`.

Combined targeted Returns suite — **3 suites passed, 31 tests passed, 0 failed**
(`returns-schema-drift-01`, `returns-schema-drift-02`,
`returned-undelivered-contract`). Disposable DB
CREATED → MIGRATING → MIGRATED → RUNTIME_OK → DROPPED, `ORPHAN_COUNT=0`.
`git diff --check` PASS.

#### Standing rule learned here — a stable issue marker is a SINGLE-OWNER identifier

Both drift regression suites locate their repair migration by scanning migration
sources for their issue marker. They originally also required the repair to sort
*after every migration not carrying that marker* — which silently assumed the
repair was the newest file in the repo. `0166` disproved it: the moment a newer
unrelated migration landed, the `-01` suite found zero repairs and collapsed.

Both suites now select **purely on marker presence** and assert that exactly one
migration owns the marker; timestamps are deterministic display order only, never
eligibility.

Corollary, and a real hazard worth repeating: **never quote another issue's
marker verbatim in migration source.** Doing so makes that file look like the
other issue's repair and breaks its locator. Refer to sibling repairs by number.

**Status at the time of writing: implementation and automated verification
COMPLETE / PASS, not yet committed or deployed.**

> **PRODUCTION CERTIFIED 2026-09-06 — supersedes the paragraph above.**
> `0166` shipped in commit `ecaef445eced63b4044ac23bc455765332ad0661` and applied
> cleanly in production as
> `20260906120000_0166_repair_refund_execution_line_item_scan_intake_columns.js`
> — `knex_migrations` id **165**, batch **40**, migration_time
> **2026-09-06 10:48:13.527+00**. Pre-seed row count was **0**, as audited.
>
> Production shape certified canonical after apply:
>
> | Column | Certified in production |
> |---|---|
> | `created_at` | `timestamptz`, NOT NULL, DEFAULT `now()` |
> | `lasyncro_refund_execution_id` | `uuid`, nullable |
> | `refunded_amount` | `numeric(14,2)`, nullable |
> | `source` | `varchar(50)`, NOT NULL, DEFAULT `'refund_webhook'` |
>
> Preservation certified in production — the repair took nothing with it:
> **5 indexes** present, **3 foreign keys** present, RLS enabled **true**,
> FORCE RLS **true**, and `refund_execution_line_items_tenant_isolation_policy`
> present with cmd **ALL**.
>
> **Reviewer seed then succeeded and PERSISTED**, which is the direct
> counterpart to the aborted-and-rolled-back attempt that originally revealed
> this drift: `seed_refunds` = **9**, seeded `refund_execution_line_items` = **9**,
> browser-verification fixtures = **2**
> (`FIXTURE:BROWSER-VERIFY:PROCESS_RETURN` — status `pending`;
> `FIXTURE:BROWSER-VERIFY:REVIEW_RETURN` — status `awaiting_decision`).
> Final marker: `RETURNS_PROD_REVIEWER_SEED=PASS`.
>
> `RETURNS-SCHEMA-DRIFT-02` — **PRODUCTION BACKEND CERTIFICATION: CLOSED / PASS ·
> REVIEWER SEED: CLOSED / PASS · RETURNS VISUAL FUNCTIONAL CERTIFICATION:
> CLOSED / PASS.** `RETURNS-SCHEMA-DRIFT-01`'s backend certification remains
> valid, and its visual blocker — missing reviewer data — is now **CLEARED**.
>
> Both drifts on `refund_execution_line_items` are closed. One cosmetic item was
> found during the visual pass (`RETURNS-OVERVIEW-UI-01`, a stray literal `...`
> text node) — a rendering defect, not schema drift, recorded in
> `docs/blueprints/ReturnsResolutionModule.md` §14 rather than here. It has since
> shipped (commit `15ba7a11`) and been production re-checked, so **no Returns
> item remains open** from this incident.

---

## 8. Standing Workflow Reminder

This playbook supplements, not replaces, the existing AUDIT → IMPLEMENT → DOCUMENT → COMMIT workflow. The addition is:

- **AUDIT phase for drift-suspected issues must include a real schema diff or a direct prod query — never conclude "probably fine" from migration file inspection alone.**
- **IMPLEMENT phase for any prod-drift fix must go through the full dev/prod rehearsal sequence in §4 before touching real prod.**
- **DOCUMENT phase for historical migration-content drift must include a drift warning added to the original migration file.** This does not apply when the defect is an uncommitted migration dependency and no already-run migration file was amended. Use this template:

```typescript
/**
 * ⚠️ DRIFT WARNING (added post <ISSUE-ID>, <date>)
 * -----------------------------------------------------
 * This migration ran in production on <original run date> (batch <N>)
 * BEFORE <what was added> was added to this file (<amend date if known>,
 * <reason if known>). Knex marks this migration complete and will
 * NEVER re-run it — so this file's current `up()` does NOT reflect
 * what actually existed in prod before <fix date>.
 *
 * <What was missing> was backfilled into production separately via
 * migration <NNNN> (<filename>).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Use a new forward migration instead (rule 7).
 */
```

- **COMMIT phase pushes must be verified with `git log origin/main`**, per gotcha #15.