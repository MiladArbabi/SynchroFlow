# SPECTER — Blueprint (FT0 → FT1)

*Comprehensive, actionable, and ready for execution by an engineer picking up the handoff.*

---

## Executive summary (one-paragraph)

Specter is the stateful subsystem that tracks shop sessions, an event ledger, and shop configuration to make ingestion/sync flows observable and eventually intelligent. FT0 implemented a production-ready Redis-backed store (with in-memory fallback), a safe test-friendly bootstrap, a small HTTP metrics surface, and a lightweight ingestion worker that accepts events and writes them to Specter. FT1 will add a state machine, insights/alerting engine, config enforcement, and command/control capabilities. Below is a technical blueprint covering current state, completed work, remaining FT0 items, FT1 roadmap, architecture, APIs, keyspace, tests, deployment/ops, security, risks, and prioritized next steps with exact TDD-style workflow.

---

# 1. Goals & success criteria

**Primary goal (FT0):** make Specter stateful and observable — sessions + event ledger + config caching — with deterministic tests and a minimal UI to prove the loop.

**FT0 success criteria (launch-ready):**

* Redis-backed session/event/config store initialized and used in runtime.
* `GET /api/v1/specter/:shopId/state` returns `session`, `events` (newest-first), `config`, and `meta{lastSync,lastIngestion,sessionCount}`.
* Canonical ingestion and sync workers call `appendEvent()` and `recordShopSession()` (best-effort, non-blocking).
* A Specter ingestion worker consumes messages (or can be invoked directly) to persist events/sessionDelta.
* Full unit & integration test coverage for store, controller, and worker.
* Minimal single-file UI that calls metrics endpoint for manual verification.

---

# 2. Current reality (what's implemented & validated)

Short list — everything below exists in the repo and tests are green where indicated:

* **Modules & files**

  * `modules/specter/src/store/session-store.ts` — InMemorySessionStore, factory, FT0 helpers (recordShopSession, appendEvent, etc).
  * `modules/specter/src/store/session-store-redis.ts` — RedisSessionStore with `init()`, `close()`, `saveSession`, `appendEvent`, `getRecentEvents`, `getShopConfig`, `updateShopConfig`, `warmCache`, `reset`.
  * `apps/backend/src/bootstrap/specter-store.ts` — wrapper that calls `initRedisSessionStore()`/`closeRedisSessionStore()`.
  * `apps/backend/src/services/order-nexus-canonical-ingestion.service.ts` — appended calls to `appendEvent()` after enqueueing canonical order.
  * `apps/backend/src/services/shopify-sync-orchestrator.service.ts` — calls `appendEvent()` on sync.complete/fallback and records lightweight session via `recordShopSession()` for fallback path.
  * `apps/backend/src/api/specter/specter.controller.ts` — `getSpecterState`, `getSpecterConfig`, `upsertSpecterConfig` with robust dynamic resolution of the specter store helpers (handles CJS/ESM and src/dist paths).
  * `apps/backend/src/api/specter/specter.routes.ts` — routes wired and protected.
  * `apps/backend/src/workers/specter-ingestion.worker.ts` — worker that reads queue messages, calls `appendEvent()` and `recordShopSession()` best-effort and acks messages.
  * `apps/backend/src/bootstrap/workers.ts` — now starts/stops specter ingestion worker alongside other workers.
  * Tests (unit/integration) for memory store, redis store (disconnected), controller, worker, and a lightweight worker↔route integration test.

* **Runtime & infra**

  * `node-start` bootstrap properly registers tsconfig-paths and starts workers on dev.
  * Redis connectivity tested locally (docker run redis).
  * Queue isolation for tests (`DISABLE_QUEUE=1`) so Jest is deterministic.

---

# 3. What FT0 intentionally **does not** include (scope boundary)

* No insight engine / state machine / automated corrective commands.
* No UI beyond the minimal single-file page (still to produce).
* No heavy analytics/aggregation — Specter only stores session objects and event ledger.
* No complex config validation/enforcement yet.

---

# 4. FT0 — Remaining work (precise, ordered, TDD-ready)

Below are the explicit remaining FT0 tasks (ordered, with acceptance criteria and suggested tests). Each item should be handled as one small task per your workflow: explain why, create & switch branch, scan, request TDD confirmation, implement red tests, implement code until green, update docs, ship.

### FT0 Task A — Confirm Redis store usage end-to-end (done mostly, but checklist)

* **Why:** ensure RedisSessionStore is actually used in production flow when env signals `redis`.
* **Actions:**

  * Ensure `SPECTER_SESSION_STORE=redis` or `SPECTER_REDIS_URL` results in `createSessionStore()` returning `RedisSessionStore` and `initSpecterStore()` calls `.init()`.
  * Acceptance: start server with Redis and confirm `appendEvent()` writes to Redis keys (manual smoke or integration test).
* **Tests:** integration test that starts store, calls appendEvent, then inspects Redis via client (or worker endpoint reads back using getRecentEvents).

### FT0 Task B — Finalize Specter event ledger API (complete API signatures)

* **Why:** consistent contracts used across workers and services.
* **APIs (already implemented):**

  * `appendEvent(shopId, { type, payload?, timestamp? })`
  * `getRecentEvents(shopId, limit = 50)`
* **Acceptance:** unit tests asserting newest-first ordering, trimming to configured max length.

### FT0 Task C — Session model CRUD helpers & usage (done)

* `recordShopSession(shopId, data)` and `getShopSession(shopId)` exist.
* **Acceptance:** integration test where ingestion worker records a sessionDelta and route shows session.

### FT0 Task D — Hooks integration (canonical ingestion & sync workers) (mostly done)

* **Where:** `order-nexus-canonical-ingestion.service.ts`, `shopify-sync-orchestrator.service.ts`, `sync.worker.ts`, others.
* **Acceptance:** ingestion -> appendEvent('canonical.ingested'), sync -> appendEvent('sync.complete' or 'sync.error') and session patch when appropriate. Tests present.

### FT0 Task E — Shop config loader + caching (Redis-backed)

* **APIs to implement / verify:**

  * `getShopConfig(shopId)`
  * `updateShopConfig(shopId, patch)`
  * `warmCache(shopId, config)` (already exists)
* **Acceptance:**

  * `GET /api/v1/specter/config` returns DB row or store value.
  * `PUT /api/v1/specter/config` updates DB and warms Redis snapshot; tests to cover both DB-only and store path.
* **TDD tests:** unit tests for RedisSessionStore `updateShopConfig` & `getShopConfig`, integration test hitting `upsertSpecterConfig`.

### FT0 Task F — Expose `GET /api/v1/specter/:shopId/state` (done)

* **Acceptance:** route wired, robustly resolves store helpers, tests green.

### FT0 Task G — Automated testing suite (already added many tests)

* **Checklist:**

  * Unit tests for InMemory store, Redis store (disconnected), controller, worker.
  * Lightweight integration tests for route and worker.
  * Add tests that ensure `reset()` actually clears Redis keys (if test infra can talk to Redis).
* **Acceptance:** all tests green in CI (jest run) and deterministic (no open handles).

---

# 5. FT1 Roadmap (what Specter becomes)

**High-level objective:** Specter becomes an orchestrator/insight engine with rules and actions.

Key FT1 features (each will be its own epic):

1. **State Machine** per shop (idle → ingesting → syncing → healthy → warning → error).

   * Drive transitions from events, timeouts, webhooks.
   * Persist state in Redis key `specter:shop:{id}:state` and as events.

2. **Insight Engine**

   * Periodic tasks or rules run on event stream to produce insights (stale ingestion, excessive retries, missing data).
   * Store insights: `specter:shop:{id}:insights` (list/newest-first)

3. **Config enforcement**

   * `specter_shop_configs` defines rules: sync frequency, retry policy, allowed platforms.
   * Workers must consult config before performing actions.

4. **Commands & Control**

   * REST RPCs or queue commands (resync, clearSession, pause ingestion) issued by Specter to workers.
   * Ensure idempotency and auth.

5. **Insights UI & Alerting**

   * UI components showing shop health, state timelines, insights and recommended actions.

6. **Data retention & retention policy**

   * Event TTLs and archival.

---

# 6. Architecture (textual diagram + modules)

```
[Platform Integrations / Workers]  ->  [Queue (e.g., RabbitMQ)]  ->  [Specter Ingestion Worker]  ->  [Specter Store (Redis)] 
                                                      ↘
                                                       -> [Postgres] (specter_shop_configs)
                                                       -> [OrderNexus / other modules] (consume events via queue)

[API Server] exposes:
 - GET /api/v1/specter/:shopId/state  -> reads from Specter store (fast; Redis snapshot)
 - PUT /api/v1/specter/config         -> update DB & warm Redis snapshot
```

**Key processes**

* **Canonical ingestion**: DB canonical ingestion writes DB rows + enqueues message to OrderNexus and calls `appendEvent(canonical.ingested)`.
* **Sync**: Sync orchestrator calls `appendEvent(sync.complete|sync.error)` and may `recordShopSession` (lightweight).
* **Worker**: `specter-ingestion.worker` consumes queue messages, writes to Redis via `appendEvent` and `recordShopSession`. Message ack is immediate after scheduling best-effort writes.

---

# 7. Redis keyspace — canonical and recommended

Use canonical, human-readable keys and limit lengths.

| Key pattern                  |        Type | Description                                                                                                                          |
| ---------------------------- | ----------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `specter:shop:{id}:sessions` |        LIST | Sessions (newest-first via LPUSH). Each item = JSON of `AnonymousSession`. Trim to `SPECTER_SESSION_STORE_LIST_MAX`.                 |
| `specter:shop:{id}:events`   |        LIST | Event ledger (newest-first via LPUSH). Items = JSON event `{type,timestamp,payload}`. Trim to `SPECTER_EVENT_LIST_MAX` (default 50). |
| `specter:shop:{id}:config`   |      STRING | JSON-serialized config. Optional TTL (no default).                                                                                   |
| `specter:shop:{id}:state`    | HASH / JSON | Current derived state (idle/ingesting/syncing/healthy/error). FT1.                                                                   |
| `specter:shop:{id}:insights` |        LIST | FT1 insights newest-first.                                                                                                           |
| `specter:global:shops`       |         SET | (optional) shops with active Specter state.                                                                                          |

**Notes**

* Events and sessions are newest-first lists for cheap LPUSH/LTRIM and reads via LRANGE (0,N).
* Use `UNLINK` for mass deletions in reset tooling; fall back to `DEL` per Redis client capabilities (already implemented).
* Keep list max lengths configurable via env.

---

# 8. API contracts (minimal FT0)

### `GET /api/v1/specter/:shopId/state`

* **Auth:** Bearer token (same as other routes).
* **Response (200):**

```json
{
  "shopId": 42,
  "session": { "sessionId": "s-1", "shopId": 42, "createdAt": "...", ... } | null,
  "config": { ... } | null,
  "events": [ { "type": "sync.complete", "timestamp": 123, "payload": {} }, ... ],
  "meta": { "sessionCount": 1, "lastSync": 123, "lastIngestion": 122 }
}
```

### `GET /api/v1/specter/config`

* Returns shop config fetched from DB (and/or from store cache).

### `PUT /api/v1/specter/config`

* Body: `{ "config": { ... } }`
* Upsert semantics by `shop_id`.

**Worker message format (specter_events queue):**

```json
{
  "shopId": 42,
  "type": "sync.complete" | "canonical.ingested" | "sync.error" | "...",
  "payload": {...},
  "sessionDelta": { /* partial AnonymousSession to upsert/record */ },
  "timestamp": 1765448...
}
```

---

# 9. Data model (minimal)

**AnonymousSession**

```ts
{
  sessionId: string,
  shopId: number,
  landingPage?: string,
  pagesViewed?: string[],
  exitIntent: boolean,
  createdAt: string,
  ...any
}
```

**SpecterEvent**

```ts
{
  type: string,
  timestamp: number,
  payload?: Record<string, any>
}
```

**specter_shop_configs (DB)**

* `shop_id` (PK)
* `config_json` (JSONB)
* created_at, updated_at

---

# 10. Testing & QA strategy (TDD + integration)

**Unit tests (fast)**:

* InMemory store (CRUD, getSessionsLastNDays, event ledger ordering).
* Redis store behavior when disconnected (snapshot fallback).
* Controller unit tests mocking `modules-specter` store (CJS or ESM mocking as used).
* Worker unit tests mocking queue and store (already added).

**Integration tests (lightweight)**:

* Worker -> route integration: call `processSpecterMessage()` then `GET /specter/:id/state` (we added this).
* Route integration with DB seed (already present).

**End-to-end**:

* Optional: run worker with real queue, post a message into RabbitMQ, and assert Redis state — useful for staging smoke tests only.

**Test rules to follow**

* One action per exchange (as you requested).
* Prefer unit tests; integration should be short and deterministic (avoid external systems when possible).
* For tests that rely on Redis, run a disposable docker Redis with cleanup or use embedded/testcontainers pattern.

---

# 11. Observability & logging

* Keep debug logs under `debug('...')` for workers and controllers.
* Important production logs (WARN/ERROR) use console wrappers — plan to switch to `pino` or `winston`.
* Metrics to capture:

  * AppendEvent successes/failures (counts)
  * Worker messages processed per minute
  * Redis latency / error rates
  * Events per shop (distribution)
* Suggest adding basic Prometheus metrics endpoints in FT1.

---

# 12. Security & operational concerns

* **Auth/Authorization**: endpoints are protected by existing token middleware. Consider role-based checks for cross-shop access (admins).
* **Data protection**: event payloads may contain PII — sanitize before storing, or store only non-sensitive metadata in Specter. (Already noted PCD fallback in orchestrator.)
* **Rate-limits**: protect metrics endpoint if abused.
* **Config write path**: `PUT /config` must be audited; use DB constraints and validations in FT1.

---

# 13. Scaling & performance considerations

* Redis is the primary hot store; use sharding or key partitioning if shops scale massively.
* Lists trimmed to bounded length to avoid unbounded memory.
* Use lazy snapshots in RedisSessionStore to avoid heavy prefetching.
* For extremely high event volume, consider batching writes to Redis and/or a stream-based ingestion (Redis Streams) in FT1.

---

# 14. Backups, retention & data lifecycle

* Define retention of event ledger (e.g., keep last 50 events for real-time ops; archive to S3 if long-term required).
* Session snapshots can be short-lived; consider TTLs per shop config.

---

# 15. Risks & mitigations

* **Risk:** Specter write failures blocking ingestion/sync flows.

  * *Mitigation:* best-effort writes, non-blocking calls, worker acks immediately (already implemented).
* **Risk:** Event payloads contain PII/PCD.

  * *Mitigation:* sanitize before appendEvent; store only hashed identifiers for sensitive fields.
* **Risk:** Tests flake because of real Redis or RabbitMQ.

  * *Mitigation:* use in-memory store for unit tests, `DISABLE_QUEUE=1` for queue in tests, and use lightweight integration tests that call worker directly.

---

# 16. Deployment & ops checklist (what to run in staging)

* Start Redis (env `SPECTER_REDIS_URL` set).
* Start server normally — `initSpecterStore()` should log initialized.
* Seed test data for a shop.
* Send a test ingestion event via worker `processSpecterMessage()` (or enqueue and ensure worker consumes).
* GET `/api/v1/specter/:shopId/state` — expect session, events, config or nulls.
* Monitor logs for errors and warnings.
* In CI: run `npm run test` (all unit + integration) under `NODE_ENV=test`.

---

# 17. Developer handoff notes (practical pointers)

* **Files to inspect first**:

  * `modules/specter/src/store/session-store.ts`
  * `modules/specter/src/store/session-store-redis.ts`
  * `apps/backend/src/api/specter/specter.controller.ts`
  * `apps/backend/src/workers/specter-ingestion.worker.ts`
  * `apps/backend/src/bootstrap/specter-store.ts`
  * `apps/backend/src/bootstrap/workers.ts`
* **How to run dev**:

  * `docker run -p 6379:6379 --name local-redis redis:7` (start redis)
  * `cd apps/backend && npm run dev` (starts server and workers)
  * Use `/api/v1/auth/dev-token` to generate token for dev routes.
* **Test notes**:

  * Tests use `DISABLE_QUEUE=1` to avoid real RabbitMQ.
  * There are unit and integration tests in `tests/unit/...` and `tests/unit/integration/...`.

---

# 18. Prioritized next 10 issues (small, TDD-friendly)

1. **(FT0) Validate Redis writes in CI** — add test that runs with ephemeral Redis (testcontainers) or set of dockerized job. (Test: appendEvent -> read via Redis client).
2. **(FT0) Add getShopState endpoints for chronological paging** — small enhancement: accept `limit` param. (Test: unit + integration).
3. **(FT1) Implement state machine skeleton & state key** — simple transitions triggered by events. (Write red tests for transitions).
4. **(FT1) Add insight rule: stale ingestion detection** — red test that flags a shop if no canonical.ingested in X minutes.
5. **(FT1) Add command endpoint: POST /api/v1/specter/:shopId/commands/resync** — enqueues resync via queue service. (Tests & integration).
6. **(Ops) Add Prometheus metrics exporter for Specter events**. (Unit + smoke).
7. **(Security) Add config validation schema on PUT /config** (JSON schema). (Unit tests).
8. **(UX) Create the single-file React/Tailwind Specter metrics page** (calls metrics endpoint). (Manual QA).
9. **(FT1) Add retention policy support and cold-archive job**.
10. **(Hardening) Make worker retry/backoff for appendEvent on transient Redis failures, with circuit-breaker**.

For each item: create a branch `feature/specter-<short>`; follow TDD (red test first), implement, run `npm run test`, update docs, then `./ship.sh "msg" <issue-num>`.

---

# 19. Acceptance checklist before FT0 launch

* [x] Redis-backed store available and optional fallback (done).
* [x] Session CRUD and event ledger API implemented and tested (done).
* [x] Ingestion worker (specter-ingestion.worker) implemented & tested (done).
* [x] Hooks in canonical ingestion and sync orchestrator to append events (done).
* [x] Controller + routes wired with robust module resolution (done).
* [x] Unit + integration tests for worker↔route and controller green (done).
* [ ] Manual smoke test in staging with real Redis + queue (recommended).
* [ ] Minimal single-file UI ready (next).

---

# 20. Quick reference — useful snippets

**Sample worker message**

```js
{
  shopId: 42,
  type: 'sync.complete',
  payload: { ok: true },
  sessionDelta: { sessionId: 's-1', createdAt: '2025-12-01T00:00:00Z' },
  timestamp: Date.now()
}
```

**Sample `GET /api/v1/specter/42/state` curl**

```bash
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/dev-token | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/specter/42/state
```

**Environment variables relevant to Specter**

* `SPECTER_SESSION_STORE` = `redis` | `memory` (default = memory)
* `SPECTER_REDIS_URL` or `REDIS_URL`
* `SPECTER_EVENT_LIST_MAX` (default 50)
* `SPECTER_SESSION_STORE_LIST_MAX` (default 1000)

---

# 21. Final recommendations (practical & opinionated)

* Keep Specter small and focused for FT0 — you already did this well.
* Make event payloads intentionally minimal (store metadata rather than full PII).
* Add metrics early: counts of events accepted, failed writes, and queue consumption rate.
* Implement the state machine and insights in FT1 as small iterative features — each insight should be independently testable and reversible.
* Add a simple admin UI for rapid debugging (single-page with a shop selector and timeline) — this will save hours when onboarding new shops.

---
