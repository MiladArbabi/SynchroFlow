# Fly.io Production Playbook

**Last updated:** June 16, 2026

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
| `DATABASE_URL` | Fly internal Postgres URL |
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
fly deploy --app synchroflow
```

### Force Fresh Build (bypass cache)
```bash
fly deploy --app synchroflow --no-cache
```

### Release Migration
The `fly.toml` `release_command` runs DB migrations before the new machine starts:
```toml
[deploy]
  release_command = "node /app/apps/backend/migrate-prod.mjs"
```

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

# Get password
fly ssh console --app synchroflow -C "printenv DATABASE_URL"
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