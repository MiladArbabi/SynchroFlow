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
Local dev and CI both build their databases by running every migration from empty (`npm run dev:setup`, `test:setup`). This means **local dev can never reveal this class of bug.** Everything works perfectly on your machine, in review, and in CI — and is still broken in prod. The only way to catch it is to compare prod's *actual* schema against what the *current migration files* would produce from scratch.

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

## 8. Standing Workflow Reminder

This playbook supplements, not replaces, the existing AUDIT → IMPLEMENT → DOCUMENT → COMMIT workflow. The addition is:

- **AUDIT phase for drift-suspected issues must include a real schema diff or a direct prod query — never conclude "probably fine" from migration file inspection alone.**
- **IMPLEMENT phase for any prod-drift fix must go through the full dev/prod rehearsal sequence in §4 before touching real prod.**
- **DOCUMENT phase must include a drift warning added to the original migration file**, using this template:

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