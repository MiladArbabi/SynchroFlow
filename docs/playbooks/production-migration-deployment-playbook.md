# laSyncro Production Migration Deployment Playbook

## GitHub Actions → Fly PostgreSQL → Restricted Runtime Deployment

**System:** SynchroFlow / laSyncro
**Repository:** `MiladArbabi/SynchroFlow`
**Runtime Fly app:** `synchroflow`
**PostgreSQL Fly app:** `synchroflow-db`
**Primary region:** `arn`
**Production health endpoint:** `https://app.lasyncro.com/health`
**Node version:** `20.20.0`

---

# 1. Purpose

This playbook defines the mandatory procedure for safely deploying database migrations to production.

The production release model deliberately separates:

```text
Privileged database migration access
from
Restricted application runtime access
```

The deployment sequence is:

```text
Build migration code
→ Open temporary Fly PostgreSQL proxy
→ Run checksum-guarded migrations
→ Run production RLS release gate
→ Verify runtime has no privileged credential
→ Deploy application runtime
→ Verify production health and runtime identity
```

The workflow is implemented in:

```text
.github/workflows/fly-deploy.yml
```

It runs when a commit reaches `main`, and it can also be started manually through `workflow_dispatch`. It uses `concurrency: deploy-group`, preventing two migration/deployment jobs from executing concurrently.

---

# 2. Core architecture

## 2.1 Production database identities

There are two database identities.

### Privileged migration identity

Used only for:

* Applying migrations.
* Creating or altering tables.
* Creating RLS policies.
* Enabling and forcing RLS.
* Managing grants.
* Creating `SECURITY DEFINER` functions.
* Updating migration checksum metadata.
* Running production RLS release checks.

This identity is provided to GitHub Actions through:

```text
MIGRATION_DATABASE_URL
```

It must never be installed on the Fly runtime application.

### Restricted application identity

The running application connects as:

```text
sf_app
```

The required properties are:

```text
SUPERUSER = false
BYPASSRLS = false
LOGIN = true
```

The runtime receives this connection through:

```text
APP_DATABASE_URL
```

The production database configuration requires `APP_DATABASE_URL` and uses it for the application Knex connection. The privileged `DATABASE_URL` name is reserved for the external migration runner.

---

# 3. Mandatory secret inventory

## 3.1 GitHub Actions secrets

The repository must contain these three Actions secrets:

| Secret                   | Required value                                                    |
| ------------------------ | ----------------------------------------------------------------- |
| `FLY_API_TOKEN`          | Fly organization-scoped deploy token with access to both Fly apps |
| `FLY_POSTGRES_APP`       | `synchroflow-db`                                                  |
| `MIGRATION_DATABASE_URL` | Privileged PostgreSQL connection URL                              |

The workflow reads these exact names.

## 3.2 Fly runtime secret

The runtime Fly app must contain:

```text
APP_DATABASE_URL
```

using the restricted `sf_app` role.

The runtime Fly app must not contain:

```text
DATABASE_URL
```

The workflow explicitly blocks deployment when `DATABASE_URL` appears in the runtime secret list.

---

# 4. Fly API token requirements

## 4.1 Why an application-scoped token is insufficient

The workflow performs operations against two Fly applications:

```text
synchroflow-db
synchroflow
```

It must:

1. Open a proxy to `synchroflow-db`.
2. Inspect secrets on `synchroflow`.
3. Deploy `synchroflow`.

A token scoped only to the runtime app may successfully inspect or deploy `synchroflow` while failing to open the proxy to `synchroflow-db`.

That exact failure presents as:

```text
flyctl proxy never opens localhost:15432
```

followed by the workflow’s 30-second port-probe timeout.

Use an organization deploy token for this multi-app pipeline. Fly documents organization tokens as the appropriate option for automation that must manage multiple applications in one organization.

## 4.2 Creating a suitable token

Use the Fly organization slug:

```text
personal
```

Example:

```bash
fly tokens create org \
  --org personal \
  --name "SynchroFlow production deploy" \
  --expiry 720h
```

The exact expiry should follow the team’s rotation policy. Do not create a permanent personal authentication token when a scoped deploy token is sufficient. Fly recommends scoped deploy tokens for deployment infrastructure rather than broad personal credentials.

## 4.3 Store the token in GitHub

```bash
printf '%s' "$NEW_FLY_TOKEN" \
| gh secret set FLY_API_TOKEN \
    --repo MiladArbabi/SynchroFlow
```

GitHub supports setting repository Actions secrets through `gh secret set`.

## 4.4 Validate token scope before deployment

Before trusting a rotated token, verify both app boundaries:

```bash
export FLY_API_TOKEN='<token>'

fly status --app synchroflow
```

Then test database-app access:

```bash
fly proxy 15432:5432 \
  --app synchroflow-db
```

In another terminal:

```bash
nc -z 127.0.0.1 15432
echo $?
```

Expected:

```text
0
```

Stop the proxy afterward.

Do not update the GitHub secret until both runtime-app and database-app access have been verified.

---

# 5. Setting the remaining GitHub secrets

## 5.1 PostgreSQL app name

```bash
printf '%s' 'synchroflow-db' \
| gh secret set FLY_POSTGRES_APP \
    --repo MiladArbabi/SynchroFlow
```

## 5.2 Privileged migration URL

```bash
printf '%s' "$PRIVILEGED_DATABASE_URL" \
| gh secret set MIGRATION_DATABASE_URL \
    --repo MiladArbabi/SynchroFlow
```

The URL must contain:

```text
postgresql://
privileged username
privileged password
database hostname
database name
optional connection query parameters
```

Special characters in the username or password must be URL-encoded.

Do not print this URL into terminal logs.

Do not place it in:

```text
fly.toml
.env committed to source
Fly runtime secrets
application configuration
Docker build arguments
```

---

# 6. Runtime secret verification

Before deploying a migration, verify the runtime boundary:

```bash
fly secrets list --app synchroflow \
| grep -E 'APP_DATABASE_URL|DATABASE_URL'
```

Expected:

```text
APP_DATABASE_URL
```

Forbidden:

```text
DATABASE_URL
```

The application startup also rejects `DATABASE_URL` and verifies that the connected database role is exactly `sf_app`, without superuser or `BYPASSRLS` privileges.

---

# 7. Creating a production migration

## 7.1 Never modify an applied migration

Once a migration has run in any shared or production environment:

```text
Do not edit it.
Do not rename it.
Do not delete it.
Do not regenerate it.
```

Create a new forward migration.

The production migration runner hashes each compiled migration and compares it against `migration_checksums`. A changed historical migration causes:

```text
[MIGRATION_DRIFT_DETECTED]
```

## 7.2 Migration naming

Use the existing timestamped pattern:

```text
YYYYMMDDHHMMSS_NNNN_description.ts
```

Example:

```text
20260807120000_0140_add_inventory_audit_index.ts
```

Place the file in:

```text
apps/backend/migrations/
```

## 7.3 Forward compatibility requirement

The workflow applies migrations before deploying the new runtime.

Therefore every production migration must remain compatible with the currently deployed application until the new application version is healthy.

Use expand-and-contract migrations.

### Safe first phase

```text
Add nullable column
Add new table
Add new index
Add new policy alongside compatible code
Add new function
Backfill without removing old fields
```

### Later contraction phase

Only after the new runtime has been healthy and old code can no longer run:

```text
Remove old column
Remove old table
Make nullable field NOT NULL
Remove legacy function
Remove legacy policy
```

Do not combine a breaking schema removal with the application version that first stops using it.

If the runtime deployment fails after migrations succeed, the previous application version may temporarily continue against the migrated schema.

---

# 8. Local migration verification

Do not test a new migration against production first.

## 8.1 Confirm repository state

```bash
git status --short --branch
git diff --check
```

## 8.2 Build the shared database package

```bash
npm run build -w packages/backend-core
```

## 8.3 Build the backend and compiled migrations

```bash
SKIP_DEPS=1 npm run build -w apps/backend
```

The backend build compiles both the application and migration TypeScript projects.

## 8.4 Run the runtime-boundary tests

```bash
npm --workspace ./apps/backend \
  run test:rls-boundary
```

The suite verifies:

* Runtime uses `APP_DATABASE_URL`.
* Runtime rejects privileged credentials.
* Runtime identity is restricted.
* Tenant-zero policies are absent.
* Required RLS policies and resolver functions exist.
* Migration release gates remain present.
* Runtime source does not import the privileged system database client.

## 8.5 Run the migration on a disposable or local database

Use:

```bash
npm --workspace ./apps/backend run migrate
```

The local migration script:

1. Checks conflict usage.
2. Rebuilds the migration output.
3. Runs the checksum-aware migration runner.

## 8.6 Verify the migration result directly

Inspect:

```sql
SELECT
  id,
  name,
  batch,
  migration_time
FROM knex_migrations
ORDER BY id DESC
LIMIT 10;
```

Inspect checksum registration:

```sql
SELECT
  name,
  checksum
FROM migration_checksums
ORDER BY name DESC
LIMIT 10;
```

Verify the actual schema object rather than relying only on the migration command.

Examples:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = '<table>';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = '<table>';

SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid) AS using_expression,
       pg_get_expr(polwithcheck, polrelid) AS check_expression
FROM pg_policy
WHERE polrelid = 'public.<table>'::regclass;
```

---

# 9. Standard production deployment

## 9.1 Normal trigger

The standard production path is:

```text
Commit reaches main
→ GitHub Actions starts Fly Deploy automatically
```

Do not also trigger the workflow manually after pushing the same commit.

The current workflow supports both push and manual dispatch, but duplicate triggering is unnecessary. Its concurrency group serializes runs rather than making duplicate releases useful.

## 9.2 Manual dispatch use cases

Use manual dispatch only when:

* The previous run failed because of a transient Fly or GitHub infrastructure problem.
* A GitHub secret was corrected and no code change is required.
* A Fly token was rotated after a proxy authorization failure.
* A failed runtime deployment must be retried against the same commit.
* An operator explicitly needs to rerun the idempotent migration/deploy sequence.

Before manual dispatch:

```bash
gh run list \
  --repo MiladArbabi/SynchroFlow \
  --workflow 'Fly Deploy' \
  --limit 10
```

Confirm there is no active run for the same commit.

Then:

```bash
gh workflow run fly-deploy.yml \
  --repo MiladArbabi/SynchroFlow
```

---

# 10. What the workflow does

The current workflow performs these steps.

## 10.1 Checkout

```yaml
- uses: actions/checkout@v4
```

## 10.2 Install Node

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20.20.0
    cache: npm
```

## 10.3 Install dependencies

```yaml
- run: npm ci --legacy-peer-deps
```

## 10.4 Build the migration runner

```yaml
npm run build -w packages/backend-core
SKIP_DEPS=1 npm run build -w apps/backend
```

This produces the compiled runner:

```text
apps/backend/dist/src/scripts/runMigrationsWithChecksum.js
```

## 10.5 Install `flyctl`

```yaml
- uses: superfly/flyctl-actions/setup-flyctl@master
```

Fly’s official GitHub Actions deployment guidance uses this setup action and `flyctl deploy --remote-only`.

## 10.6 Validate required migration inputs

```bash
test -n "$FLY_POSTGRES_APP"
test -n "$PRIVILEGED_DATABASE_URL"
```

An unset GitHub secret resolves to an empty value in the workflow, so these checks prevent a less clear downstream failure.

## 10.7 Open a temporary database proxy

```bash
flyctl proxy 15432:5432 \
  -a "$FLY_POSTGRES_APP" \
  > /tmp/fly-proxy.log 2>&1 &
```

The proxy PID is captured:

```bash
PROXY_PID=$!
```

and cleanup is registered:

```bash
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
```

This ensures the proxy process is cleaned up when the migration step finishes.

## 10.8 Wait for the local proxy port

A Node probe repeatedly attempts to connect to:

```text
127.0.0.1:15432
```

for up to 30 seconds.

This prevents the migration runner from starting before the proxy is ready.

## 10.9 Rewrite the connection URL

The GitHub secret contains the privileged PostgreSQL credentials.

The workflow preserves:

* Protocol.
* Username.
* Password.
* Database name.
* Query parameters.

It replaces:

```text
hostname → 127.0.0.1
port → 15432
```

The resulting URL points through the temporary Fly proxy.

## 10.10 Execute the migration runner

```bash
NODE_ENV=production \
DATABASE_URL="$LOCAL_MIGRATION_DATABASE_URL" \
node apps/backend/dist/src/scripts/runMigrationsWithChecksum.js
```

Production migration configuration reads `DATABASE_URL`, while the application runtime reads `APP_DATABASE_URL`.

## 10.11 Reject privileged runtime credentials

After migrations pass, the workflow checks the runtime Fly app:

```bash
flyctl secrets list -a synchroflow
```

If it finds:

```text
DATABASE_URL
```

the deployment stops.

## 10.12 Deploy the runtime

Only after migration and credential gates succeed:

```bash
flyctl deploy --remote-only
```

The workflow’s current implementation follows this exact order.

---

# 11. What the migration runner does

The migration runner is:

```text
apps/backend/src/scripts/runMigrationsWithChecksum.ts
```

## 11.1 Runs the preliminary RLS check

It resolves and executes:

```text
scripts/check_rls.sh
```

If this check fails, migration execution is aborted.

## 11.2 Resolves compiled migrations

The production Knex configuration uses:

```text
apps/backend/dist/migrations/
```

with JavaScript migration files.

## 11.3 Checks historical migration integrity

For every compiled migration:

```text
SHA-256(file)
```

is compared against:

```text
migration_checksums.checksum
```

A mismatch fails before `db.migrate.latest()`.

## 11.4 Applies pending migrations

```ts
const [batchNo, log] = await db.migrate.latest();
```

The logs report:

```text
[migration-runner] applied
```

with the batch number and migration names.

## 11.5 Synchronizes checksums

After migration execution, every applied migration recorded in:

```text
knex_migrations
```

is inserted or updated in:

```text
migration_checksums
```

## 11.6 Runs the production RLS release gate

The gate checks:

* `sf_app` exists.
* `sf_app` is not superuser.
* `sf_app` does not have `BYPASSRLS`.
* No RLS-enabled table is missing `FORCE ROW LEVEL SECURITY`.
* No public `shop_id` table lacks RLS.
* No RLS table lacks a policy.
* No known unsafe tenant-zero or open-write predicate remains.
* A deliberately invalid tenant sees no rows.
* Tenant `0` sees no rows.
* Missing tenant context sees no rows.

The runner performs the probes after:

```sql
SET LOCAL ROLE sf_app
```

and blocks runtime deployment if any invariant fails.

---

# 12. Monitoring the release

## 12.1 Locate the workflow run

```bash
gh run list \
  --repo MiladArbabi/SynchroFlow \
  --workflow 'Fly Deploy' \
  --branch main \
  --limit 10
```

## 12.2 Watch the workflow

```bash
gh run watch <RUN_ID> \
  --repo MiladArbabi/SynchroFlow \
  --exit-status
```

A temporary GitHub API connection failure in the local CLI does not prove the remote workflow failed.

When the watch command disconnects:

```bash
gh run view <RUN_ID> \
  --repo MiladArbabi/SynchroFlow
```

## 12.3 Retrieve failed logs

```bash
gh run view <RUN_ID> \
  --repo MiladArbabi/SynchroFlow \
  --log-failed
```

Always identify:

```text
The first failed step
The first meaningful error inside that step
```

Do not diagnose from the final `Process completed with exit code 1` line.

---

# 13. Required success evidence

A production migration deployment is not complete until all of the following are confirmed.

## Migration runner

```text
[migration-runner] applied
[migration-runner] checksum sync complete
[migration-runner] RLS release gate passed
```

## Runtime credential guard

No:

```text
DATABASE_URL is still installed on the runtime app
```

## Runtime deployment

```text
flyctl deploy completed successfully
```

## Production health

```bash
curl \
  --silent \
  --show-error \
  --location \
  --write-out '\nHTTP=%{http_code}\n' \
  https://app.lasyncro.com/health
```

Expected:

```text
{"status":"ok"}
HTTP=200
```

## Fly Machine state

```bash
fly status --app synchroflow
```

Expected:

```text
STATE: started
CHECKS: passing
```

## Runtime database identity

```bash
fly logs \
  --app synchroflow \
  --no-tail \
| grep 'DB_RUNTIME_IDENTITY_VERIFIED' \
| tail
```

Expected:

```text
current_user: sf_app
rolsuper: false
rolbypassrls: false
```

---

# 14. Failure classification

Before taking corrective action, classify the failure.

| Failure stage                |  Were migrations applied? |    Was runtime deployed? |
| ---------------------------- | ------------------------: | -----------------------: |
| Dependency install/build     |                        No |                       No |
| Fly proxy authorization      |                        No |                       No |
| Proxy readiness timeout      |                        No |                       No |
| Checksum validation          |         No new migrations |                       No |
| Preliminary RLS check        |                        No |                       No |
| Migration execution          |                  Possibly |                       No |
| Checksum synchronization     | Migrations may be applied |                       No |
| Post-migration RLS gate      |               Usually yes |                       No |
| Runtime credential rejection |                       Yes |                       No |
| Fly image build              |                       Yes |                       No |
| Fly Machine update/health    |                       Yes |                 Possibly |
| Post-deploy health failure   |                       Yes | Yes or partially updated |

Never assume a failed workflow means the database is unchanged.

---

# 15. Failure mode: database proxy timeout

## Symptom

The port probe reaches its 30-second deadline.

Typical workflow location:

```text
Run privileged migrations outside the runtime app
```

## Most likely causes

1. `FLY_API_TOKEN` lacks access to `synchroflow-db`.
2. `FLY_POSTGRES_APP` is incorrect.
3. Fly API authentication is unavailable.
4. The database app is unavailable.
5. The proxy exited immediately.
6. The local port is unavailable.

## Required checks

Verify:

```bash
FLY_POSTGRES_APP=synchroflow-db
```

Test the token against both apps.

Inspect:

```text
/tmp/fly-proxy.log
```

## Current workflow limitation

The proxy output is redirected but is not automatically printed when the readiness probe fails.

Recommended workflow hardening:

```bash
if ! node <<'NODE'
  // readiness probe
NODE
then
  echo 'FLY_PROXY_LOG'
  cat /tmp/fly-proxy.log >&2 || true
  exit 1
fi
```

This should be added in a separate reviewed workflow change.

---

# 16. Failure mode: migration checksum drift

## Symptom

```text
[MIGRATION_DRIFT_DETECTED]
```

## Meaning

A compiled migration differs from the checksum recorded when it was previously applied.

## Default resolution

Do not alter the checksum row.

Do not edit the historical migration again.

Restore the original migration and create a new forward migration.

## Existing runner limitation

The current runner hashes compiled `.js` files, not the TypeScript source.

A TypeScript compiler or migration build-configuration change could therefore change compiled output without a migration source change. This limitation is documented in the production deployment gotchas.

## Full drift audit

Before any exceptional reconciliation, collect all differences:

```bash
psql "$LOCAL_PRIVILEGED_URL" \
  -At -F'|' \
  -c "
    SELECT name, checksum
    FROM migration_checksums
    ORDER BY name
  " \
  > /tmp/prod-checksums.txt

npm run build -w packages/backend-core
SKIP_DEPS=1 npm run build -w apps/backend

cd apps/backend/dist/migrations

shasum -a 256 *.js \
| awk '{print $2\"|\"$1}' \
| sort \
> /tmp/local-checksums.txt

join -t'|' \
  /tmp/prod-checksums.txt \
  /tmp/local-checksums.txt \
| awk -F'|' '$2 != $3 {
    print $1, "production=" $2, "local=" $3
  }'
```

Manual checksum reconciliation is an exceptional operation requiring:

1. Proof that the migration’s schema effect already exists in production.
2. Proof that the source change is a genuine no-op for migrated databases.
3. Complete drift enumeration.
4. Explicit engineering approval.
5. Recorded before-and-after checksums.

A forward migration remains the preferred correction.

---

# 17. Failure mode: migration execution fails

## Do not immediately rerun

First inspect migration state.

Open the database proxy:

```bash
fly proxy 5434:5432 \
  --app synchroflow-db
```

Construct a local version of the privileged URL using:

```text
host = 127.0.0.1
port = 5434
```

Then inspect:

```sql
SELECT
  id,
  name,
  batch,
  migration_time
FROM knex_migrations
ORDER BY id DESC
LIMIT 20;
```

Inspect checksums:

```sql
SELECT name, checksum
FROM migration_checksums
ORDER BY name DESC
LIMIT 20;
```

Inspect the actual schema object modified by the failed migration.

Determine whether:

```text
The migration never started
The migration failed and rolled back
The migration partially applied
The migration completed but logging/checksum work failed
```

Do not delete rows from `knex_migrations` as a routine recovery technique.

---

# 18. Failure mode: post-migration RLS gate fails

This is one of the most important cases.

## What it means

The new migration may already have been applied and recorded.

The runner applies pending migrations before executing the final production RLS boundary check.

## Mandatory response

1. Do not deploy the application.
2. Do not edit the applied migration.
3. Do not remove its `knex_migrations` row.
4. Do not remove its checksum row.
5. Identify the exact RLS finding.
6. Create a new forward corrective migration.
7. Run the pipeline again.
8. Require the RLS gate to pass.

The `0138` → `0139` sequence is the established recovery pattern.

The repository’s existing production gotchas document the same applied-but-release-gated state.

---

# 19. Failure mode: privileged credential found on runtime

## Symptom

```text
DATABASE_URL is still installed on the runtime app;
deployment blocked.
```

## Response

Do not weaken or remove the guard.

Inspect:

```bash
fly secrets list --app synchroflow
```

Remove the privileged runtime secret:

```bash
fly secrets unset DATABASE_URL \
  --app synchroflow
```

Verify that:

```text
APP_DATABASE_URL
```

still exists.

The restricted runtime URL must not be deleted while removing the privileged URL.

After secret changes, the Fly Machine may restart. Verify production health before rerunning the workflow.

---

# 20. Failure mode: runtime deployment fails after migrations

At this stage:

```text
The database has already advanced.
```

Do not rerun migrations blindly.

## Required response

1. Check whether the new Fly image was built.
2. Check whether the Machine was updated.
3. Check the current Machine image.
4. Check `/health`.
5. Inspect runtime logs.
6. Confirm the currently running application version is compatible with the migrated schema.
7. Correct the runtime fault or deploy a forward runtime fix.

Commands:

```bash
fly status --app synchroflow

fly machine status <MACHINE_ID> \
  --app synchroflow

fly logs \
  --app synchroflow \
  --no-tail \
| tail -200
```

---

# 21. Failure mode: health-check timeout

A timeout is a symptom, not necessarily the cause.

Inspect whether the application:

```text
Never started
Exited with code 1
Connected to the database
Passed SchemaGuard
Connected to Redis
Connected to RabbitMQ
Declared topology
Bound port 8080
Started workers
```

The current HTTP startup order is:

```text
assertRuntimeDatabaseIdentity
initRedisClient
initSpecterStore
runSchemaGuard
initQueue
declareTopology
app.listen
background worker startup
```

Background workers now start after the HTTP listener exists.

Search logs:

```bash
fly logs \
  --app synchroflow \
  --no-tail \
| grep -E \
    'DB_RUNTIME_IDENTITY_VERIFIED|SchemaGuard|Connected to RabbitMQ|Server is listening|Failed to start|Background worker startup failed'
```

Do not dismiss:

```text
The app is not listening on the expected address
```

as automatically harmless.

It was once a transient warning, but it was also the decisive signal during the production startup incident that caused repeated exits and HTTP `502`.

The current `docs/playbooks/production_deploy_gotchas.md` section declaring this warning always false is stale and should be corrected. Its documented startup order predates `RUNTIME-BOOT-01`.

---

# 22. Production database inspection

## 22.1 Start a proxy

Foreground:

```bash
fly proxy 5434:5432 \
  --app synchroflow-db
```

Keep the terminal open.

## 22.2 Construct a local privileged URL

Do not use the remote hostname directly.

Replace it with:

```text
127.0.0.1:5434
```

## 22.3 Connect

```bash
psql "$LOCAL_MIGRATION_DATABASE_URL"
```

## 22.4 Verify runtime role

```sql
SELECT
  rolname,
  rolsuper,
  rolbypassrls,
  rolcanlogin
FROM pg_roles
WHERE rolname = 'sf_app';
```

Expected:

```text
rolsuper = false
rolbypassrls = false
rolcanlogin = true
```

## 22.5 Verify latest migrations

```sql
SELECT
  id,
  name,
  batch,
  migration_time
FROM knex_migrations
ORDER BY id DESC
LIMIT 20;
```

## 22.6 Verify checksum coverage

```sql
SELECT
  COUNT(*) AS applied_migrations
FROM knex_migrations;

SELECT
  COUNT(*) AS checksum_rows
FROM migration_checksums;
```

Investigate when the counts differ.

---

# 23. Rollback policy

## 23.1 Do not use automatic rollback in production

Although the backend package contains a `migrate:rollback` script, it is not the standard production recovery mechanism.

Many security migrations are intentionally forward-only.

A production rollback can:

* Reopen tenant-isolation vulnerabilities.
* Remove columns required by the current runtime.
* Fail because a migration’s `down()` is deliberately unsupported.
* Leave migration checksums inconsistent.
* Reintroduce old policy behavior.

## 23.2 Preferred recovery

Use a new forward corrective migration.

## 23.3 Database restore

A database restore is an incident-level action, not a normal migration rollback.

It requires:

* Confirmed data-loss or unrecoverable schema corruption.
* Maintenance coordination.
* Recovery-point selection.
* Runtime shutdown or write isolation.
* Post-restore migration reconciliation.
* Full RLS and health verification.

---

# 24. Recommended workflow hardening

The existing workflow succeeded, but the following changes should be considered in a dedicated workflow-improvement issue.

## 24.1 Enable strict shell behavior

At the start of migration and deployment script blocks:

```bash
set -Eeuo pipefail
```

## 24.2 Print proxy logs on readiness failure

```bash
if ! wait_for_proxy; then
  cat /tmp/fly-proxy.log >&2 || true
  exit 1
fi
```

## 24.3 Add explicit post-deploy health verification

After `flyctl deploy --remote-only`:

```bash
for ATTEMPT in $(seq 1 30); do
  HTTP=$(
    curl \
      --silent \
      --show-error \
      --location \
      --output /tmp/health.json \
      --write-out '%{http_code}' \
      https://app.lasyncro.com/health \
      || true
  )

  if [ "$HTTP" = '200' ]; then
    cat /tmp/health.json
    exit 0
  fi

  sleep 3
done

fly status --app synchroflow || true
fly logs --app synchroflow --no-tail \
| tail -160 \
|| true

exit 1
```

## 24.4 Verify deployed runtime identity

After health becomes `200`, inspect recent logs for:

```text
DB_RUNTIME_IDENTITY_VERIFIED
Server is listening
```

## 24.5 Add migration summary output

Print:

```sql
SELECT name, batch, migration_time
FROM knex_migrations
ORDER BY id DESC
LIMIT 10;
```

without exposing database credentials.

## 24.6 Upload diagnostic logs on failure

Potential diagnostic artifacts:

```text
/tmp/fly-proxy.log
migration output
Fly status
recent runtime logs
```

Secrets and full database URLs must be redacted.

## 24.7 Pin the Fly setup action

The current workflow uses:

```yaml
superfly/flyctl-actions/setup-flyctl@master
```

Consider pinning to a reviewed immutable version or commit so workflow behavior does not change unexpectedly.

---

# 25. Documentation corrections required

Two existing documents contain stale startup information.

## `docs/playbooks/production_deploy_gotchas.md`

It currently states that:

```text
App is not listening on the expected address
```

is always a false alarm.

That is no longer accurate.

The warning must now be evaluated using:

```text
Machine exit events
Server listener log
Health endpoint
Fly health-check state
First application startup error
```

## `docs/playbooks/fly_playbook.md`

Its documented boot sequence does not exactly match the current server implementation.

The current authoritative order is:

```text
assertRuntimeDatabaseIdentity
initRedisClient
initSpecterStore
runSchemaGuard
initQueue
declareTopology
app.listen
startWorkers asynchronously
```

The code in `apps/backend/src/server.ts` is the source of truth.

---

# 26. Engineer release checklist

## Before merging

```text
[ ] New forward migration created
[ ] No historical migration changed
[ ] Migration filename follows timestamp convention
[ ] Backend-core build passes
[ ] Backend and migration build passes
[ ] Runtime-boundary tests pass
[ ] Migration succeeds on local/disposable DB
[ ] Actual schema result verified
[ ] Old production runtime remains compatible
[ ] RLS policy reviewed where relevant
[ ] No privileged connection added to runtime code
```

## Secret preflight

```text
[ ] FLY_API_TOKEN exists
[ ] Token can access synchroflow
[ ] Token can proxy synchroflow-db
[ ] FLY_POSTGRES_APP = synchroflow-db
[ ] MIGRATION_DATABASE_URL exists
[ ] APP_DATABASE_URL exists on runtime
[ ] DATABASE_URL absent from runtime
```

## During deployment

```text
[ ] Build migration runner passes
[ ] Fly database proxy opens
[ ] Preliminary RLS check passes
[ ] Checksum validation passes
[ ] Pending migrations apply
[ ] Checksum sync completes
[ ] RLS release gate passes
[ ] Runtime credential guard passes
[ ] Fly runtime deployment succeeds
```

## After deployment

```text
[ ] /health returns HTTP 200
[ ] Fly Machine state is started
[ ] Fly health check is passing
[ ] Runtime identity is sf_app
[ ] rolsuper is false
[ ] rolbypassrls is false
[ ] Expected migration appears in knex_migrations
[ ] Expected checksum appears in migration_checksums
[ ] Expected schema behavior verified
[ ] No new startup or worker errors in Fly logs
```

---

# 27. Golden rules

```text
1. Never deploy migrations through the runtime database role.
2. Never install the privileged migration URL on the runtime app.
3. Never modify an applied migration.
4. Never assume a failed workflow means no migration was applied.
5. Never deploy the runtime when the RLS release gate fails.
6. Never use rollback as the default production recovery.
7. Always use a forward corrective migration.
8. Always keep migrations compatible with the previous runtime.
9. Always verify HTTP health after deployment.
10. Always verify the runtime database identity after credential changes.
11. Always diagnose the first real error, not the final timeout.
12. Always verify that the Fly token can access both Fly applications.
```

---

# 28. Successful release definition

A migration release is complete only when all of the following are true:

```text
Migration recorded in knex_migrations
Checksum recorded in migration_checksums
RLS release gate passed
Runtime contains no DATABASE_URL
Runtime deployed successfully
Production /health returns 200
Fly Machine health check passes
Runtime identity is sf_app
sf_app is NOSUPERUSER
sf_app is NOBYPASSRLS
```

Anything less is an incomplete or release-gated deployment.
