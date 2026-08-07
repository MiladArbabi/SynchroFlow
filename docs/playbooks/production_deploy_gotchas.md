# Production Deploy — Gotchas

## Failed migration jobs block runtime deployment

A failing external migration job aborts the GitHub workflow before `flyctl
deploy`. Production keeps serving the previous version with passing health
checks, so inspect both the migration step and the final deployment step.
On 2026-08-01 we found v238–v242 had all failed on Jul 29, leaving production
on the **Jul 28 build for four days** while the app was under App Store review.

**Check `flyctl releases --app synchroflow | head -5` before assuming a fix is
live.** A green `flyctl deploy` scrollback is not proof — read the last lines.

## "App is not listening on the expected address" is a FALSE ALARM

Every deploy prints this, and it has never once been real. Do not audit it again.

    WARNING The app is not listening on the expected address...
    Found these processes inside the machine with open listening sockets:
     PROCESS        │ ADDRESSES
     /.fly/hallpass │ [fdaa:...]:22

**Why:** `apps/backend/src/server.ts` opens the socket *last*. `start()` awaits
`initRedisClient` → `initSpecterStore` → `runSchemaGuard` → `initQueue` →
`declareTopology` → `startWorkers` before reaching `app.listen` (line 34). Redis,
RabbitMQ topology, the schema guard and every background worker must finish
first — ~1.5s on v247. Fly probes listening sockets the moment the machine
reaches `started`, lands inside that window, and sees only the SSH sidecar.
The bind happens immediately after and the health check passes.

Because the ordering is structural, this warning fires on **every** deploy, not
intermittently.

`fly.toml` is correct (`PORT=8080`, `internal_port=8080`). `server.ts:16` reads
`HOST` from the machine env, which is `0.0.0.0`; the `|| '127.0.0.1'` fallback
there is local-dev only and never applies on Fly. (`node-start.js` has a similar
fallback but does not perform the production listen — don't chase it.)

**Authoritative signals — check these, ignore the warning:**

    flyctl logs -a synchroflow --no-tail | grep "Server is listening"
    # → Server is listening on http://0.0.0.0:8080
    curl -sS -o /dev/null -w "%{http_code}\n" https://synchroflow.fly.dev/
    # → 200

Health check `servicecheck-00-http-8080` passing in `flyctl status` is the same
proof. If log + curl are green, **the deploy is good.** Verified 2026-08-03,
v247 (PROD-DEPLOY-4, closed NOT-A-BUG).

**Aside:** `/api/v1/health` returns 404 — that path does not exist. Curl `/`.

## Migration checksum drift

`runMigrationsWithChecksum.js` hashes every compiled `.js` in `dist/migrations`
and aborts if any hash differs from `migration_checksums`. Two properties make
this painful:

1. **It throws on the first mismatch**, alphabetically. Each failed deploy
   reveals exactly one drifted file, at ~2.5 min per cycle, with no indication
   of how many remain. (PROD-DEPLOY-3a: collect all mismatches, throw once.)
2. **A forward migration cannot fix drift.** Validation runs *before*
   `db.migrate.latest()`, so a new migration that would repair the checksum row
   is unreachable. Reconciliation must be a direct UPDATE on
   `migration_checksums`.

### Amending a base migration that already ran in production

Only safe when the amendment is a genuine no-op on already-migrated databases
(e.g. wrapping `up()` in a `hasTable` guard). Procedure:

1. Verify the migration's objects already exist in prod (tables, columns, FKs).
2. Diff **all** recorded checksums against a fresh local build before deploying,
   so you learn the true drift count in one pass:

psql "$PGURL" -At -F'|' -c "select name, checksum from migration_checksums order by name" > /tmp/prod-checksums.txt
cd apps/backend && npm run build
cd dist/migrations && shasum -a 256 *.js | awk '{print $2"|"$1}' | sort > /tmp/local-checksums.txt
join -t'|' /tmp/prod-checksums.txt /tmp/local-checksums.txt | awk -F'|' '$2 != $3 {print $1}'

3. UPDATE the checksum row(s) to the new hash. Deploy.

Prefer a forward migration whenever the change is not a no-op.

**PROD-DEPLOY-3b (open):** the guard hashes compiled `.js`, so a tsc version or
tsconfig change would flag all ~134 migrations as drifted with zero source
changes. Hash the `.ts` instead.

## Prod database access

flyctl proxy 5434:5432 -a synchroflow-db # terminal 1, foreground
# terminal 2: use the privileged URL from the approved operator secret store,
# replacing its host/port with localhost:5434. Never retrieve it from runtime.
psql "postgresql://<migration-user>:<password>@localhost:5434/<database>"

The app machine has no `psql` binary — use the proxy, not `ssh console`.

## Local does not reproduce prod

`dev:full-seed` starts with `db:reset` and produces a tenant whose zones are all
parented to `WH-1-ROOT`. Production zones are largely **unparented**. FP-201 was
invisible locally for exactly this reason. When a bug reproduces in prod but not
locally, compare the *data shape* before suspecting the code.

## Access tokens expire in 15 minutes

Long enough to start a build, not long enough to finish one. Grab the token
after the deploy completes, not before:

copy(localStorage.getItem('accessToken')) // DevTools console

**Runtime and migration database credentials are intentionally separated.**
The Fly runtime app contains only `APP_DATABASE_URL` for restricted `sf_app`.
The privileged `MIGRATION_DATABASE_URL` exists only in GitHub Actions (and the
approved operator secret store) and reaches Postgres through a temporary Fly
proxy. Runtime startup fails if `DATABASE_URL` is present.

After a credential change, require both startup evidence and an RLS probe:

    [DB_RUNTIME_IDENTITY_VERIFIED] { current_user: 'sf_app', ... }
    [migration-runner] RLS release gate passed

If either is absent, the cutover is not verified.

Also: psql does not expand shell variables. `ALTER ROLE x WITH PASSWORD
'$MYVAR';` sets the password to the literal string $MYVAR. Run the ALTER
non-interactively via `psql -c "..."` with double quotes so the shell expands.

**flyctl secrets set reports false deploy failures.** "smoke checks failed: the
app appears to be crashing" fired while the app was healthy — same root cause as
the listening-address false alarm: server.ts awaits five async initializers
before app.listen. Verify with `flyctl status` and curl, not flyctl's verdict.

**Local invoice testing needs a shopify_app_installations row.**
httpGetOrderInvoice inner-joins shops to shopify_app_installations for
shop_domain. Seeded dev shops skip OAuth so the row never exists, and the
endpoint throws SHOP_NOT_FOUND -> 500 on every call. Prod shop 1 has the row;
this is local-only. Insert a fixture row with a clearly fake access_token.
Registered separately as INV-01 (P2): the inner join also means an uninstalled
merchant loses invoice printing for existing orders.

### Applied migration followed by a failed RLS gate

A post-migration RLS gate failure does not mean the migration was rolled
back. Confirm the migration and checksum records before taking further
action.

When the migration is already recorded:

- keep the applied migration immutable;
- do not delete or rewrite migration history;
- do not deploy the application;
- create a new forward-only corrective migration;
- rerun the migration runner and require the RLS release gate to pass.

The `0138` to `0139` sequence is the reference recovery case.

## Forward migrations: local verification vs production application

A successful local migration does **not** mean the migration has run in
production.

Local development uses the backend migration script against the local database.
This is where a new forward migration should first be compiled, applied, entered
into `knex_migrations`, registered in `migration_checksums`, and exercised
against the RLS release gate.

Production applies migrations separately through `.github/workflows/fly-deploy.yml`:

1. build the migration runner;
2. open the privileged temporary Fly Postgres proxy;
3. run `runMigrationsWithChecksum.js` with the migration-only database
   credentials;
4. validate existing migration checksums before `db.migrate.latest()`;
5. apply new migrations and register their checksums;
6. require the production RLS release gate to pass;
7. only then deploy the restricted runtime application.

Therefore:

- a migration applied locally has not changed production;
- a new migration file may be finalized before its first production execution;
- once production records that migration, its file is immutable;
- if an applied migration is followed by a failed RLS/deploy step, verify
  `knex_migrations` and `migration_checksums` before taking action;
- never rewrite an already-applied production migration — use a new
  forward-only migration;
- production is not considered updated until both the migration workflow and
  the subsequent runtime deployment/health verification are green.

LIFECYCLE-ID-01 / migration `0141_repair_lifecycle_founder_identity` followed
this sequence locally on 2026-08-07: the migration compiled, applied, registered
its checksum, passed the 85-table RLS release gate, and repaired all observed
founder/snapshot identity mismatches. Production remains unchanged until the
migration reaches `main` and the production workflow executes it.
