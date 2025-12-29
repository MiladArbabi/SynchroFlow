# Specter: Current Implementation State (FT0)

## Overview

FT0 of Specter implements a production-ready foundation for stateful observability with a focus on reliability, testability, and incremental enhancement.

---

## Implemented Components (Validated & Green Tests)

### 1. Session Store Infrastructure

| Component | Location | Status | Purpose |
|-----------|----------|--------|---------|
| **InMemorySessionStore** | `modules/specter/src/store/session-store.ts` | ✅ Complete | Test-friendly fallback store |
| **RedisSessionStore** | `modules/specter/src/store/session-store-redis.ts` | ✅ Complete | Production Redis-backed store |
| **Store Factory** | Same file | ✅ Complete | Dynamic store selection based on env |
| **Store Helpers** | Same file | ✅ Complete | `recordShopSession()`, `appendEvent()`, etc. |

**Key Methods Implemented:**
- `init()`, `close()` - Lifecycle management
- `saveSession()`, `getRecentEvents()` - Core CRUD
- `getShopConfig()`, `updateShopConfig()` - Config management
- `warmCache()`, `reset()` - Cache and cleanup operations

### 2. Bootstrap & Runtime Integration

| Component | Location | Status | Purpose |
|-----------|----------|--------|---------|
| **Specter Store Bootstrap** | `apps/backend/src/bootstrap/specter-store.ts` | ✅ Complete | Store initialization and cleanup |
| **Worker Bootstrap** | `apps/backend/src/bootstrap/workers.ts` | ✅ Complete | Starts/stops specter ingestion worker |

**Runtime Features:**
- Redis connectivity with local Docker support
- Graceful shutdown hooks
- Environment-based store selection (`SPECTER_SESSION_STORE=redis|memory`)

### 3. Worker Integration Points

| Integration Point | Location | Status | Events Tracked |
|------------------|----------|--------|----------------|
| **Canonical Ingestion** | `apps/backend/src/services/order-nexus-canonical-ingestion.service.ts` | ✅ Complete | `canonical.ingested` |
| **Sync Orchestrator** | `apps/backend/src/services/shopify-sync-orchestrator.service.ts` | ✅ Complete | `sync.complete`, `sync.error` + session data |

**Integration Pattern:**
```typescript
// Best-effort, non-blocking pattern used throughout
appendEvent(shopId, { type: 'canonical.ingested', payload: { ... } });
recordShopSession(shopId, sessionDelta); // Lightweight session tracking
```

### 4. API Layer

| Component | Location | Status | Endpoints |
|-----------|----------|--------|-----------|
| **Specter Controller** | `apps/backend/src/api/specter/specter.controller.ts` | ✅ Complete | State, config management |
| **Specter Routes** | `apps/backend/src/api/specter/specter.routes.ts` | ✅ Complete | Route wiring and auth |

**API Features:**
- Robust CJS/ESM and src/dist path resolution
- Bearer token authentication (same as other routes)
- Dynamic store helper resolution

### 5. Ingestion Worker

| Component | Location | Status | Function |
|-----------|----------|--------|----------|
| **Specter Ingestion Worker** | `apps/backend/src/workers/specter-ingestion.worker.ts` | ✅ Complete | Queue consumption and persistence |

**Worker Characteristics:**
- Consumes `specter_events` queue messages
- Best-effort writes (ack immediately, write async)
- Handles both events and session deltas
- Testable with `DISABLE_QUEUE=1` environment variable

---

## Current API Surface

### Available Endpoints

#### `GET /api/v1/specter/:shopId/state`
**Response (200):**
```json
{
  "shopId": 42,
  "session": { "sessionId": "s-1", "shopId": 42, "createdAt": "...", ... } | null,
  "config": { ... } | null,
  "events": [ 
    { "type": "sync.complete", "timestamp": 123, "payload": {} }, 
    ...
  ],
  "meta": { 
    "sessionCount": 1, 
    "lastSync": 123, 
    "lastIngestion": 122 
  }
}
```

#### `GET /api/v1/specter/config`
Returns shop config from DB (and/or store cache)

#### `PUT /api/v1/specter/config`
**Body:** `{ "config": { ... } }`

Upsert semantics by shop_id

### Worker Message Format

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

## Testing Coverage

### Unit Tests (Fast & Deterministic)

| Test Target | Coverage | Key Assertions |
|-------------|----------|----------------|
| InMemory Store | ✅ Complete | CRUD operations, list trimming, ordering |
| Redis Store (Disconnected) | ✅ Complete | Fallback behavior, error handling |
| Controller | ✅ Complete | Route responses, error cases |
| Worker | ✅ Complete | Message processing, error resilience |

### Integration Tests

| Test Type | Coverage | Purpose |
|-----------|----------|---------|
| Worker → Route Integration | ✅ Complete | End-to-end flow validation |
| Route + DB Integration | ✅ Complete | Config persistence testing |

### Test Infrastructure
- **Queue Isolation:** `DISABLE_QUEUE=1` environment variable
- **Deterministic Execution:** No external dependencies in unit tests
- **Path Resolution:** Handles both source and compiled code paths

---

## Environment Configuration

### Required Variables

```bash
# Redis Configuration
SPECTER_SESSION_STORE=redis|memory  # Default: memory
SPECTER_REDIS_URL=redis://127.0.0.1:6379  # Optional, falls back to REDIS_URL

# Data Limits
SPECTER_EVENT_LIST_MAX=50           # Default: 50 events per shop
SPECTER_SESSION_STORE_LIST_MAX=1000 # Default: 1000 sessions per shop

# Testing
DISABLE_QUEUE=1                     # Disable real queue in tests
```

### Redis Keyspace (Current Implementation)

| Key Pattern | Type | Description |
|-------------|------|-------------|
| `specter:shop:{id}:sessions` | LIST | AnonymousSession objects, newest-first (LPUSH) |
| `specter:shop:{id}:events` | LIST | Event ledger, newest-first (LPUSH) |
| `specter:shop:{id}:config` | STRING | JSON-serialized config (optional TTL) |

**List Management:**
- Automatic trimming via LTRIM to configured maximum lengths
- Newest-first via LPUSH for O(1) writes and recent reads via LRANGE

---

## Remaining FT0 Tasks

### Task A: Redis Store End-to-End Validation
**Why:** Ensure RedisSessionStore is actually used in production flow

**Acceptance Criteria:**
- Confirm `SPECTER_SESSION_STORE=redis` triggers Redis initialization
- Smoke test with real Redis: `appendEvent()` writes visible via Redis CLI
- Integration test with ephemeral Redis (testcontainers or dockerized)

### Task E: Shop Config Loader + Caching
**Why:** Complete the config management lifecycle

**APIs to Verify:**
- `getShopConfig(shopId)` - returns DB row or cached value
- `updateShopConfig(shopId, patch)` - updates DB and warms cache
- `warmCache(shopId, config)` - cache warming utility

**Acceptance Criteria:**
- `GET /api/v1/specter/config` returns current config
- `PUT /api/v1/specter/config` updates DB and cache
- Unit tests for RedisSessionStore config methods
- Integration test hitting `upsertSpecterConfig`

### Task G: Enhanced Test Suite
**Why:** Ensure comprehensive coverage and reliability

**Checklist:**
- Add tests for `reset()` clearing Redis keys
- Validate list trimming behavior at boundaries
- Test store factory behavior with different env configurations

---

## Developer Experience

### Files to Inspect First
1. `modules/specter/src/store/session-store.ts` - Core store interface and memory implementation
2. `modules/specter/src/store/session-store-redis.ts` - Redis implementation
3. `apps/backend/src/api/specter/specter.controller.ts` - API layer
4. `apps/backend/src/workers/specter-ingestion.worker.ts` - Ingestion worker
5. `apps/backend/src/bootstrap/specter-store.ts` - Bootstrap logic

### Local Development Setup

```bash
# Start Redis
docker run -p 6379:6379 --name local-redis redis:7

# Run backend with Redis enabled
export SPECTER_SESSION_STORE=redis
export REDIS_URL=redis://127.0.0.1:6379
cd apps/backend && npm run dev

# Generate dev token for API testing
curl http://localhost:3000/api/v1/auth/dev-token
```

### Testing Commands

```bash
# Run all tests (unit + integration)
npm run test

# Run with specific configuration
DISABLE_QUEUE=1 NODE_ENV=test npm run test
```

---

## Next Steps

With FT0 foundation complete, the path to FT1 includes:

1. **State Machine Implementation** - Shop state transitions driven by events
2. **Insight Engine** - Rules-based analysis of event streams
3. **Config Enforcement** - Runtime validation of shop configurations
4. **Enhanced UI** - Health timelines and actionable insights

*See Roadmap for detailed phase planning.*