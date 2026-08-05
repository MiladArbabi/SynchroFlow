# Fly.io Production Playbook

**Last updated:** August 5, 2026

---

## App Overview

| App | Purpose | Region |
|---|---|---|
| `synchroflow` | Backend API + workers | `arn` (Stockholm) |
| `synchroflow-db` | PostgreSQL 16 | `arn` |

Frontend is on Vercel (`www.lasyncro.com`, `app.lasyncro.com`).

---

## Required Secrets

All must be set and in sync with local `.env`:

```bash
fly secrets list --app synchroflow
```

| Secret | Notes |
|---|---|
| `APP_DATABASE_URL` | Restricted Fly Postgres URL using `sf_app`; API and worker runtime only |
| `ENCRYPTION_KEY` | Min 32 chars. Must match `.env` exactly — use `wc -c` to verify |
| `SHOPIFY_API_KEY` | Public app client ID |
| `SHOPIFY_API_SECRET` | Public app client secret |
| `SHOPIFY_API_SECRET_KEY` | Same value as `SHOPIFY_API_SECRET` |
| `SHOPIFY_WEBHOOK_SECRET` | For HMAC verification |
| `RABBITMQ_URL` | CloudAMQP `amqps://` URL |
| `FRONTEND_URL` | `https://app.lasyncro.com` |
| `API_URL` | `https://app.lasyncro.com` |
| `APP_BASE_URL` | `https://app.lasyncro.com` |
| `JWT_SECRET` | Min 32 chars |
| `JWT_REFRESH_SECRET` | Min 32 chars |

`DATABASE_URL` must not appear in `fly secrets list --app synchroflow`.
Privileged migration access is stored as the GitHub Actions secret
`MIGRATION_DATABASE_URL`; `FLY_POSTGRES_APP` identifies the database app used by
the temporary `flyctl proxy` tunnel.

### Verifying Secret Sync

```bash
# Compare ENCRYPTION_KEY length between Fly and local
fly ssh console --app synchroflow -C "printenv ENCRYPTION_KEY" | wc -c
grep "ENCRYPTION_KEY" .env | awk -F= '{print $2}' | wc -c
# Must be equal
```

### Updating a Secret

```bash
fly secrets set KEY=value --app synchroflow
# Machine restarts automatically
```

---

## Deployment

### Standard Deploy
```bash
gh workflow run fly-deploy.yml --repo MiladArbabi/SynchroFlow
```

The workflow opens a temporary Fly proxy, runs checksum-guarded migrations from
the GitHub runner, verifies that the runtime Fly app has no `DATABASE_URL`
secret, and only then deploys the runtime. API and worker startup abort unless
the runtime identity is exactly `sf_app`, `NOSUPERUSER`, and `NOBYPASSRLS`, and
also abort if a privileged `DATABASE_URL` is present in the process environment.

### Force Fresh Build (bypass cache)
```bash
fly deploy --app synchroflow --no-cache
```

### Migration Job
`fly.toml` intentionally has no `release_command`: Fly release Machines inherit
the app's secrets, which would place the privileged credential on every runtime
Machine. `.github/workflows/fly-deploy.yml` runs the migration runner externally
through `flyctl proxy` before calling `flyctl deploy`.

> **Checksum drift guard (added 2026-07-28, CHECKSUM-GUARD-01):** this runner hashes every migration file and compares it against `migration_checksums`. If a file was amended after it ran, the release phase fails with `[MIGRATION_DRIFT_DETECTED]` instead of silently skipping the change (see PROD-ZONE1 for what happens without this guard). Previously `release_command` ran a bare `migrate-prod.mjs` with no drift detection — that file has been deleted.
>
> `migration_checksums` was empty in prod before this change. The **first** deploy after this switch establishes baselines for all ~127 existing migrations as-is — it does **not** retroactively detect drift that happened before this guard existed. A handful of other migrations are still suspected (not confirmed) to have drifted the same way `0048`/`0049` did; this guard only protects going forward from here.

After migrations, the runner executes the non-bypassable RLS release gate.
It fails the release if `sf_app` is privileged, any RLS table is not forced,
any public `shop_id` table lacks RLS, any RLS table lacks a policy, or an
invalid/zero/missing-tenant probe can see rows as `sf_app`, or a policy still
contains a known tenant-zero/open-write predicate.

If Knex reports migrations as applied but the post-migration RLS release
gate fails, treat the database as migrated but release-gated. Do not edit
or roll back the applied migration, and do not delete its Knex or checksum
records.

Create a new forward-only corrective migration, apply it, and rerun the
release gate. Application deployment must remain blocked until the gate
passes. Migrations `0138` and `0139` document this recovery sequence.

---

## Health Check Configuration

```toml
[[http_service.checks]]
  grace_period = '30s'   # Increased from 10s to accommodate RabbitMQ connect time
  interval = '30s'
  method = 'GET'
  path = '/health'
  port = 8080
  timeout = '5s'
```

> ⚠️ The grace period must exceed RabbitMQ connection time. CloudAMQP TLS handshake can take 3–10s. 30s is safe.

---

## Boot Sequence

The correct boot order in `server.ts`:

```
assertRuntimeDatabaseIdentity()
initRedisClient()
initSpecterStore()
runSchemaGuard()
initQueue()           ← waits for RabbitMQ connect event (25s timeout)
app.listen()          ← HTTP server starts immediately after queue connects
declareTopology()     ← async, runs after listen
startWorkers()        ← chained after topology
```

**Healthy boot logs:**
```
[api/queue.ts] Connected to RabbitMQ
[bootstrap/queue] Queue init attempted
[TOPOLOGY] Exchange declared: events.dlx
[TOPOLOGY] Queue declared: events
[TOPOLOGY] Queue declared: sync_jobs
[TOPOLOGY] All queues and exchanges declared
[sync.worker] Sync worker started. Waiting for jobs...
Server is listening on http://0.0.0.0:8080
Health check 'servicecheck-00-http-8080' on port 8080 is now passing.
```

---

## RabbitMQ / Queue Management

### CloudAMQP Instance
- Provider: CloudAMQP (LavinMQ)
- Plan: Loyal Lemming (free tier, 40 connections max)
- Host: `kebnekaise.lmq.cloudamqp.com`
- Dashboard: `api.cloudamqp.com`

### Queue Topology

All queues are declared in `apps/backend/src/queue.topology.ts`. This is the single source of truth for queue arguments.

| Queue | DLX | Notes |
|---|---|---|
| `events` | `events.dlx` | `x-single-active-consumer: true`, routing key `dead` |
| `events.dead` | — | Dead letters from `events` |
| `sync_jobs` | — | Shopify sync jobs |
| `webhook.dispatch.v1` | — | Webhook fanout |
| `product_ingestion` | — | Product sync pipeline |
| `execution.jobs.v1` | `execution.dlx` | Fulfillment execution, routing key `execution.jobs.v1.dlq` |
| `execution.jobs.v1.dlq` | — | 5s TTL retry buffer |

### ⚠️ PRECONDITION_FAILED

If you see `PRECONDITION_FAILED - Existing queue 'X' declared with other arguments`:

1. Log into CloudAMQP → LavinMQ Manager → Queues
2. Delete the conflicting queue (and its exchange if needed)
3. Redeploy — the app will recreate with correct args

This happens when queue arguments in `queue.topology.ts` diverge from what a worker's `assertQueue()` call expects. Always keep them in sync.

### Verifying Queue Health

```bash
fly logs --app synchroflow | grep -E "TOPOLOGY|PRECONDITION|Connected to RabbitMQ"
```

---

## Database Access

```bash
# Open proxy tunnel
fly proxy 5434:5432 --app synchroflow-db &

# Connect
psql "postgresql://synchroflow:<password>@localhost:5434/synchroflow"

# Inspect the runtime identity only; privileged credentials must be absent.
fly ssh console --app synchroflow -C "node -e \"console.log('DATABASE_URL', process.env.DATABASE_URL ? 'PRESENT' : 'ABSENT'); const u = new URL(process.env.APP_DATABASE_URL); console.log('APP_DATABASE_URL', u.username, u.hostname, u.pathname);\""
```

> Note: `domain_events` is immutable — DELETE will fail. Work around by deleting dependent tables first.

---

## SSH / Debugging

```bash
# Open SSH shell
fly ssh console --app synchroflow

# Run a single command
fly ssh console --app synchroflow -C "printenv API_URL"

# Stream logs
fly logs --app synchroflow

# Historical logs (no tail)
fly logs --app synchroflow --no-tail
```

---

## Machine Management

```bash
# List machines
fly machine list --app synchroflow

# Restart
fly machine restart <machine-id> --app synchroflow

# Force destroy (last resort)
fly machine destroy <machine-id> --app synchroflow --force

# Deploy fresh
fly deploy --app synchroflow
```

---

## Common Failure Modes

### App won't start — exits with code 1
Check logs for root cause:
```bash
fly logs --app synchroflow | grep "Failed to start\|error\|Error"
```

Common causes:
- `ACCESS_REFUSED` from RabbitMQ → wrong `RABBITMQ_URL` credentials
- `PRECONDITION_FAILED` → queue argument conflict (delete queue from CloudAMQP)
- `Connection terminated unexpectedly` → DB connection blip (usually self-recovers)
- `ENCRYPTION_KEY too short` → key < 32 chars

### Sync worker never receives jobs
```bash
# Check connection and topology
fly logs --app synchroflow | grep "Connected to RabbitMQ\|sync\.worker\|TOPOLOGY\|SYNC_JOB"
```

If `Connected to RabbitMQ` appears but `Received sync job` never does → queue not declared, check for `PRECONDITION_FAILED`.

If `Connected to RabbitMQ` never appears → wrong credentials or network issue.

### Health check failing
Grace period is 30s. If boot takes longer:
1. Check if RabbitMQ connection is slow (`fly logs | grep "Connected to RabbitMQ"`)
2. Check if SchemaGuard is slow (`fly logs | grep "Schema verification completed"`)
3. Consider increasing `grace_period` in `fly.toml`

---

## Fly.io Outage Handling

Fly.io experienced a Macaroon auth outage on June 15, 2026 (15:03–16:xx UTC) affecting:
- `fly deploy`
- `fly logs`
- `fly ssh`
- Dashboard logins

Running apps remained healthy during the outage. If auth fails, check `status.flyio.net` before debugging further.

### DB OOM → cascade crash (June 18, 2026 incident)

**Symptom:** App machine crash-loops on `Knex: Timeout acquiring a connection. The pool is probably full`, hits `max restart count of 10`. Proxy floods `could not find a good candidate within 40 attempts at load balancing`.

**Root cause:** `synchroflow-db` was provisioned at 256MB. Under sync load (OAuth + projection writes), Postgres gets OOM-killed (`Out of memory: Killed process ... (postgres)` / `terminated by signal 9`), enters recovery, drops connections. Each crash rolls back in-flight transactions, burning `domain_events` sequence IDs → creates projection gaps (see below) that then FATAL-halt the app worker on next boot.

**Fix:** Bump DB memory:
\`\`\`bash
fly machine update <db-machine-id> --vm-memory 1024 --app synchroflow-db
\`\`\`
256MB is insufficient for production. 1GB minimum.

**Diagnosing OOM:**
\`\`\`bash
fly logs --app synchroflow-db --no-tail | grep -iE "out of memory|signal 9|recovery mode"
\`\`\`

### Projection gap FATAL halt (recovery procedure)

**Symptom:** App boots, then exits code 1 with `[PROJECTION_GAP_FATAL] missing events X..Y`. Health check never passes.

**Root cause:** `projection.db.worker.ts` HALTS on multi-ID gaps in `domain_events`. Gaps form when transactions roll back (Postgres SERIAL sequences don't roll back — IDs are burned permanently). Common after a DB crash/OOM.

**Recovery:** Advance the cursor past the gap. The FATAL log prints the exact recovery SQL. Set cursor to (next_real_event_id − 1):
\`\`\`bash
# Inspect the gap
PGPASSWORD=<pw> psql -h localhost -p 5433 -U synchroflow -d synchroflow -c \
  "SELECT last_processed_event_id FROM projection_cursors WHERE projection_name='orders_projection'; SELECT min(id),max(id),count(*) FROM domain_events;"

# Advance cursor to skip the gap (worker auto-resumes, no restart needed)
PGPASSWORD=<pw> psql -h localhost -p 5433 -U synchroflow -d synchroflow -c \
  "UPDATE projection_cursors SET last_processed_event_id = <last_burned_id> WHERE projection_name='orders_projection';"
\`\`\`
> Tracked for permanent fix (auto-skip bounded gaps): GitHub issue #1015.

### DB proxy / port note
postgres-flex runs PG on **5433** internally (haproxy fronts 5432). `[DB_IDENTITY] port: 5433` in app logs is NORMAL, not a misconfiguration. To connect locally: `fly proxy 5433:5432 --app synchroflow-db` then psql to `localhost:5433`.

### Rate-limit deadlock on machine restart
If the app machine is `stopped` and the proxy auto-restart loop floods `machines API returned an error: "rate limit exceeded"`, it won't self-recover. Break it manually:
\`\`\`bash
fly machine start <app-machine-id> --app synchroflow
\`\`\`
