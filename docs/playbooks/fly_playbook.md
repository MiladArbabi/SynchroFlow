# LaSyncro — Fly.io Deployment Playbook

**Last updated:** June 2026  
**Status:** Production live at `https://app.lasyncro.com`  
**Owner:** Engineering  
**Location in repo:** `docs/playbooks/fly_playbook.md`

---

## 1. Architecture Overview

```
www.lasyncro.com        → Vercel (static marketing landing page)
app.lasyncro.com        → Fly.io (Express API + React SPA served together)
synchroflow-db          → Fly.io Managed Postgres (unmanaged cluster, region: arn)
Redis                   → Upstash (external, connected via REDIS_URL secret)
RabbitMQ                → CloudAMQP (external, connected via RABBITMQ_URL secret)
```

### Key architectural decision
`app.lasyncro.com` serves **both** the backend API and the React frontend SPA from the same Express process. API routes are registered first under `/api/v1/...`. Everything else falls through to `apps/frontend/dist/index.html` via the SPA fallback in `apps/backend/src/bootstrap/express.ts`.

This means deep links like `/login`, `/register`, `/overview` all return the React SPA HTML — React Router handles client-side routing from there.

**Never** serve the frontend from a separate Vercel/CDN deployment at `app.lasyncro.com` — the SPA and API must co-exist on the same origin to avoid CORS issues with HttpOnly refresh token cookies.

---

## 2. Fly Apps

| App | Purpose | Region |
|---|---|---|
| `synchroflow` | Main app (API + SPA) | `arn` (Stockholm) |
| `synchroflow-db` | Postgres cluster | `arn` (Stockholm) |

### Current machine config (`synchroflow`)
- VM: `shared-cpu-1x`, 1GB RAM
- Image size: ~258MB (includes frontend bundle)
- `auto_stop_machines = 'off'` — machine must never stop (see pitfalls)
- `min_machines_running = 1`
- Health check: `GET /health` every 30s, 5s timeout, 10s grace

---

## 3. Required Fly Secrets

All secrets set via `fly secrets set KEY=VALUE --app synchroflow`.

| Secret | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Primary DB connection (used by Knex) | `postgresql://synchroflow:<pw>@synchroflow-db.flycast:5432/synchroflow` |
| `PGUSER` | Used by projection-db-worker directly | Must be `synchroflow` (not `sf_app`) |
| `PGPASSWORD` | Used by projection-db-worker directly | Same password as in `DATABASE_URL` |
| `PGDATABASE` | Used by projection-db-worker directly | `synchroflow` |
| `PGHOST` | Used by projection-db-worker directly | `synchroflow-db.flycast` |
| `PGPORT` | Used by projection-db-worker directly | `5432` |
| `JWT_SECRET` | Access token signing | Rotate if compromised |
| `JWT_REFRESH_SECRET` | Refresh token signing | Must differ from `JWT_SECRET` |
| `SHOPIFY_API_KEY` | Shopify OAuth + API | From Shopify Partner Dashboard |
| `SHOPIFY_API_SECRET` | Shopify OAuth + API | From Shopify Partner Dashboard |
| `SHOPIFY_API_SECRET_KEY` | Alias set alongside `SHOPIFY_API_SECRET` | Keep in sync |
| `SHOPIFY_API_VERSION` | Shopify API version | e.g. `2024-01` |
| `SHOPIFY_WEBHOOK_SECRET` | Webhook HMAC verification | From Shopify Partner Dashboard |
| `RESEND_API_KEY` | Transactional email delivery | From Resend dashboard |
| `REDIS_URL` | Upstash Redis connection | From Upstash dashboard |
| `HOST` | Bind address | Must be `0.0.0.0` |

### Critical: PGUSER + PGPASSWORD are not redundant
`DATABASE_URL` alone is not enough. The `projection-db-worker` connects using individual `PG*` env vars, not `DATABASE_URL`. If `PGPASSWORD` is missing, the worker crashes with `password authentication failed for user "synchroflow"` 2 seconds after boot — causing the process to exit, Fly to restart it, and after 10 restarts the machine stops entirely. This was the root cause of the machine-keeps-stopping issue in June 2026.

---

## 4. Deployment

### Standard deploy
```bash
git add . && git commit -m "your message" && git push && fly deploy --app synchroflow --wait-timeout 300
```

### What happens on deploy
1. Depot builds the Docker image (build stage: `NODE_ENV=development`, runtime: `NODE_ENV=production`)
2. Frontend is built via `npm --workspace ./apps/frontend exec -- vite build` (note: NOT `npm run build -w apps/frontend` — that runs `tsc -b` which fails on pre-existing type errors)
3. Backend is built via `SKIP_DEPS=1 npm --workspace ./apps/backend run build`
4. Release command runs: `node /app/apps/backend/migrate-prod.mjs` — applies pending migrations
5. Rolling deploy updates existing machines

### If deploy times out on migrations
Use extended timeout:
```bash
fly deploy --app synchroflow --wait-timeout 600
```

### If release command fails with migration lock
```bash
fly proxy 15432:5432 --app synchroflow-db &
sleep 3
PGPASSWORD=<db-password> psql "postgresql://synchroflow@localhost:15432/synchroflow?sslmode=disable" \
  -c "UPDATE knex_migrations_lock SET is_locked = 0 WHERE is_locked = 1;"
kill %1
fly deploy --app synchroflow --wait-timeout 300
```

---

## 5. Dockerfile

### Build strategy
```dockerfile
FROM base AS build
ENV NODE_ENV=development       # ← CRITICAL: dev deps must be available for build tools

RUN npm install                # installs all deps including devDependencies
RUN npm run build:deps         # builds shared packages (modules/*)
RUN npm --workspace ./apps/frontend exec -- vite build   # builds React SPA
RUN SKIP_DEPS=1 npm --workspace ./apps/backend run build # builds Express API

FROM base AS runtime
ENV NODE_ENV=production        # ← runtime is production
COPY --from=build /app /app
```

### Why `vite build` directly instead of `npm run build -w apps/frontend`
The frontend build script runs `tsc -b` before Vite. There are pre-existing TypeScript errors in third-party UI components (MUI SimpleBar, Palette.dark) that are non-blocking for runtime but fail `tsc`. Running Vite directly skips the typecheck and produces a working bundle. This is intentional and documented — it is not a permanent solution.

### .dockerignore critical inclusions
`apps/frontend` **must NOT** be in `.dockerignore` — it is required in the Docker image so Express can serve `apps/frontend/dist/index.html` in production.

`apps/backend/src` **must NOT** be in `.dockerignore` — TypeScript source is needed during the Docker build stage.

What IS ignored: `apps/marketing`, `apps/mobile`, `apps/integration-service`, all `node_modules`, `.env*`.

---

## 6. Database

### Connection
- Internal Fly hostname: `synchroflow-db.flycast:5432`
- External (via proxy): `localhost:15432` when using `fly proxy`
- DB name: `synchroflow` (not `synchroflow_db` — that was the local dev DB name)
- Runtime user: `synchroflow` (has RLS enforced via `sf_app` role internally)

### Connecting directly for DB admin
```bash
fly proxy 15432:5432 --app synchroflow-db &
sleep 3
PGPASSWORD=<db-password> psql "postgresql://synchroflow@localhost:15432/synchroflow?sslmode=disable"
kill %1
```

### Getting the DB password
The password is embedded in `DATABASE_URL`. Retrieve it by SSHing into the running app:
```bash
fly machine start <machine-id> --app synchroflow
sleep 5
fly ssh console --app synchroflow -C "printenv DATABASE_URL"
```

### Migration runner (`migrate-prod.mjs`)
Runs on every deploy as the Fly release command. Does:
1. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` — **only on first deploy or manual reset**. Standard deploys use `db.migrate.latest()` which is idempotent.
2. `db.migrate.latest()` — applies all pending migrations

### Migration 0105 — database name
Migration `0105_create_app_role_and_grants` uses `SELECT current_database()` to get the DB name dynamically. Never hardcode `synchroflow` or `synchroflow_db` in migrations — the DB name differs between local (`synchroflow_db`) and production (`synchroflow`).

### Checking what's applied in production
```bash
fly proxy 15432:5432 --app synchroflow-db &
sleep 3
PGPASSWORD=<pw> psql "postgresql://synchroflow@localhost:15432/synchroflow?sslmode=disable" \
  -c "SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 10;"
kill %1
```

---

## 7. SPA Serving

Express serves the React frontend in production via `apps/backend/src/bootstrap/express.ts`:

```typescript
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.resolve(process.cwd(), 'apps/frontend/dist');
  const frontendIndexPath = path.join(frontendDistPath, 'index.html');

  if (fs.existsSync(frontendIndexPath)) {
    app.use(express.static(frontendDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(frontendIndexPath);
    });
  }
}
```

**Rule:** API routes must be registered BEFORE this block. The SPA catch-all `app.get('*', ...)` must be last.

**Supported deep links (all return 200):**
- `app.lasyncro.com/` → React SPA
- `app.lasyncro.com/login` → React SPA
- `app.lasyncro.com/register` → React SPA
- `app.lasyncro.com/overview` → React SPA (protected by `ProtectedRoute`)
- `app.lasyncro.com/health` → Express JSON `{ status: 'ok' }`

---

## 8. Machine Health and Uptime

### Why `auto_stop_machines` must be `off`
With `auto_stop_machines = 'stop'` or `'suspend'`, Fly stops machines during traffic lulls. When the next request arrives, the machine cold-starts (3–6 seconds). For `app.lasyncro.com` this means `/login` and `/register` feel broken to first-time users. Set to `off` to keep the machine always running.

### Health check
`GET /health` returns `{ status: 'ok' }` with HTTP 200. Configured in `fly.toml`:
```toml
[[http_service.checks]]
  grace_period = '10s'
  interval = '30s'
  method = 'GET'
  path = '/health'
  port = 8080
  timeout = '5s'
```

### If machine keeps stopping
Root causes observed (in order of likelihood):
1. **Missing `PGPASSWORD` secret** — projection-db-worker crashes immediately after boot, Fly restarts 10 times, then stops machine permanently. Fix: `fly secrets set PGPASSWORD=<pw> PGUSER=synchroflow --app synchroflow`
2. **Migration lock** — prior failed deploy left `knex_migrations_lock.is_locked = 1`. Fix: see Section 4.
3. **`auto_stop_machines` not `off`** — check `fly.toml` and reapply per-machine: `fly machine update <id> --autostop=off -a synchroflow -y`
4. **Max restart count hit** — machine shows "reached max restart count of 10". Start it manually: `fly machine start <id> -a synchroflow`. Underlying crash must be fixed first.

### Force-starting the machine
```bash
fly machine start d8944d5f2459e8 --app synchroflow
```

### Checking logs for crash cause
```bash
fly logs --app synchroflow | tail -50
```

---

## 9. tsconfig.json — Expo dependency removed

The root `tsconfig.json` previously extended `expo/tsconfig.base`. This caused Vite to fail during Docker build because Expo is not installed in the Fly image. The `extends` was removed from root `tsconfig.json` in June 2026. It remains in `apps/mobile/tsconfig.json` only.

**Never re-add** `"extends": "expo/tsconfig.base"` to the root `tsconfig.json`.

---

## 10. Known Non-Blocking Issues

| Issue | Impact | Resolution |
|---|---|---|
| `JWT_REFRESH_SECRET: false` logged at boot | Falls back to `JWT_SECRET` — functionally works but security risk | Set `fly secrets set JWT_REFRESH_SECRET=<unique-value> --app synchroflow` |
| Frontend `tsc -b` errors (MUI SimpleBar, Palette.dark) | No runtime impact — only blocks `npm run build -w apps/frontend` | Fix underlying type errors in `ui-component/` — tracked separately |
| 2.2MB main JS bundle | Slow initial page load on first visit | Vite code-splitting config needed in `apps/frontend/vite.config.ts` |
| `SHOPIFY_WEBHOOK_SECRET` not in Fly secrets | Webhook HMAC verification fails | Add: `fly secrets set SHOPIFY_WEBHOOK_SECRET=<value> --app synchroflow` |

---

## 11. Security Notes

### Credentials never committed
- `.env` and `.env.*` are in `.dockerignore` and `.gitignore`
- Production DB password lives only in `DATABASE_URL` and `PGPASSWORD` Fly secrets
- Never paste production credentials into handover documents, chat logs, or PRs

### Credential rotation
The production DB password (`synchroflow` user) was exposed in a chat session in June 2026. **Rotate before any public traffic:**
```bash
fly postgres rotate-credentials --app synchroflow-db
# Then update DATABASE_URL and PGPASSWORD secrets on the app
fly secrets set DATABASE_URL="postgresql://synchroflow:<new-pw>@synchroflow-db.flycast:5432/synchroflow" \
  PGPASSWORD=<new-pw> --app synchroflow
```

### HttpOnly refresh token cookie
The refresh token is stored in an HttpOnly cookie set by the backend. For this to work correctly across `app.lasyncro.com`, the Express cookie config must NOT scope to `.lasyncro.com` parent domain unless cross-subdomain auth is intentional. Currently cookies are scoped to `app.lasyncro.com` only — correct.

---

## 12. Completed Issues Log

| Date | Issue | Fix | Files |
|---|---|---|---|
| Oct 2025 | Initial Fly app created, IPs assigned | — | `fly.toml` |
| May 2026 | App suspended, machines deallocated | Full redeploy from source | `fly.toml`, `Dockerfile` |
| May 2026 | `synchroflow-db` had no active leader | Started machine `3287e607f69d48` | — |
| May 2026 | Stale `knex_migrations` history | Cleared table, ran fresh migrations | `migrate-prod.mjs` |
| May 2026 | Migration timeout (100+ migrations) | `--wait-timeout 300` | — |
| May 2026 | Migration 0105 hardcoded DB name `synchroflow_db` | Used `SELECT current_database()` | `0105_create_app_role_and_grants.ts` |
| May 2026 | Projection-db-worker auth failure (`PGUSER=synchroflow`, no password) | Added `HOST=0.0.0.0` to fly.toml; fixed worker | `fly.toml` |
| May 2026 | App live at `app.lasyncro.com` (200) | — | — |
| Jun 2026 | `/login` and `/register` returning 404 | Express SPA fallback added | `express.ts`, `Dockerfile`, `.dockerignore` |
| Jun 2026 | Root `tsconfig.json` extended Expo — broke Vite in Docker | Removed Expo extends from root | `tsconfig.json` |
| Jun 2026 | Cold start latency on `/login` | `auto_stop_machines=off`, `min_machines_running=1` | `fly.toml` |
| Jun 2026 | Machine stopping after 10 restarts | Added missing `PGPASSWORD` + `PGUSER` secrets | Fly secrets |
| Jun 2026 | Migration lock from failed deploy | Unlocked via `psql` proxy | DB |
| Jun 2026 | Health check added | `GET /health` every 30s | `fly.toml` |
| Jun 2026 | `JWT_REFRESH_SECRET` missing | Set via `fly secrets set` | Fly secrets |

---

## 13. Ongoing and Future Issues

| ID | Priority | Status | Description |
|---|---|---|---|
| FLY-01 | P1 | 🔴 Open | Rotate production DB credentials — exposed in chat June 2026 |
| FLY-02 | P1 | 🔴 Open | Add `SHOPIFY_WEBHOOK_SECRET` to Fly secrets |
| FLY-03 | P2 | 🟡 Ongoing | Frontend 2.2MB bundle — implement Vite code splitting |
| FLY-04 | P2 | 🟡 Ongoing | Fix frontend `tsc -b` errors to unblock full `npm run build` |
| FLY-05 | P3 | 🔵 Future | Lazy Shopify initialization — app currently fails to boot if Shopify secrets missing |
| FLY-06 | P3 | 🔵 Future | PostHog cross-domain tracking between `www` and `app` subdomains |
| FLY-07 | P3 | 🔵 Future | Consider Fly Managed Postgres (`fly mpg`) for supported DB operations |
| FLY-08 | P3 | 🔵 Future | Add second machine for redundancy once traffic warrants it |

---

## 14. Quick Reference

```bash
# Deploy
fly deploy --app synchroflow --wait-timeout 300

# Check status
fly status --app synchroflow

# View logs
fly logs --app synchroflow

# SSH into running machine
fly ssh console --app synchroflow

# List secrets
fly secrets list --app synchroflow

# Set a secret (triggers redeploy)
fly secrets set KEY=VALUE --app synchroflow

# Connect to DB via proxy
fly proxy 15432:5432 --app synchroflow-db &
PGPASSWORD=<pw> psql "postgresql://synchroflow@localhost:15432/synchroflow?sslmode=disable"

# Start stopped machine
fly machine start <machine-id> --app synchroflow

# Disable autostop on machine
fly machine update <machine-id> --autostop=off -a synchroflow -y

# Check applied migrations
# (run inside psql connection above)
SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 10;

# Unlock stuck migration
UPDATE knex_migrations_lock SET is_locked = 0 WHERE is_locked = 1;
```

---

## 15. Environment Variables in `fly.toml`

Only non-secret, non-sensitive values go in `fly.toml [env]`:

```toml
[env]
  PORT = '8080'
  HOST = '0.0.0.0'
```

Everything else — credentials, API keys, secrets — goes in Fly secrets via `fly secrets set`. Never commit secrets to `fly.toml`.