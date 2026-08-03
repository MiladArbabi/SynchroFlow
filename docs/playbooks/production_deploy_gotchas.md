# Production Deploy — Gotchas

## Failed releases are silent

A failing `release_command` aborts the deploy *before* machine swap. Production
keeps serving the previous version with passing health checks and no alert.
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
export PGURL=$(flyctl ssh console -a synchroflow -C "printenv DATABASE_URL" 2>/dev/null
| tr -d '\r' | grep '^postgresql://'
| sed 's/synchroflow-db.flycast/localhost/' | sed 's/:5432/:5434/')
psql "$PGURL" # terminal 2

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

**Rotating the production DB password requires updating TWO secrets.**
The app reads credentials from both DATABASE_URL and the discrete PGPASSWORD /
PGHOST / PGPORT / PGUSER / PGDATABASE set (database.config.ts selects by
NODE_ENV). Updating only DATABASE_URL leaves the app unable to authenticate and
takes production down with FATAL: password authentication failed. Set both in
one `flyctl secrets set` invocation.

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