# SynchroFlow Lifecycle Architecture Playbook

**Audience:** Incoming engineers  
**Purpose:** Complete reference for the lifecycle progression system — from OAuth to FT2. Read this before touching any auth, lifecycle, entitlements, or frontend routing code.

---

## 1. The Four Phases

```
FT_MINUS_ONE → FT0 → FT1 → FT2
```

| Phase | Meaning | Entry Condition |
|---|---|---|
| `FT_MINUS_ONE` | Registered, no Shopify connection | Default on registration |
| `FT0` | Shopify connected, sync in progress | First `orders/create` domain event processed |
| `FT1` | Trust gate passed — data confirmed | `ft0.completed` domain event processed |
| `FT2` | Full platform access | User clicks "Unlock Insights" → `lifecycle/ft2_confirmed` emitted |

**Source of truth:** `user_lifecycle_snapshot.phase` per shop.  
**Audit trail:** `lifecycle_events` table — every transition is logged.

---

## 2. The Canonical Event Chain

This is the exact sequence that must complete for a new merchant to reach FT2. Every step is mandatory and sequential.

```
1. User registers → shop created → phase = FT_MINUS_ONE

2. OAuth CALLBACK → integration row inserted (sync_status = PENDING)
   └─ Written at the callback (integration.controller.ts:406,418), AFTER the
      token exchange with Shopify — not when OAuth is initiated. A tenant that
      has only started OAuth, or that arrived via handleShopifyInstall (which
      seeds integration_oauth_states and 302s to Shopify), has NO integration
      row yet. The callback 502s on ACCESS_TOKEN_MISSING, so it cannot be
      driven offline.
   └─ domain event: integration/sync_requested → outbox → projection worker

3. Shopify sync runs (shopify.service.ts)
   ├─ Products synced → domain events: products/*
   ├─ Orders synced → domain events: orders/create, orders/fulfilled, etc.
   └─ sync_status → COMPLETED

4. Projection processes orders/create
   └─ POST-COMMIT: FirstInsightService.computeAndPersist(shopId)
      ├─ Queries orders (needs tenant context — see §6)
      ├─ Emits domain event: lifecycle/first_insight_delivered
      └─ Trigger: auto_create_domain_event_outbox fires

5. Projection processes lifecycle/first_insight_delivered
   └─ Calls FT0CompletionService.evaluateAndComplete(shopId)
      ├─ Checks: integration exists
      ├─ Checks: orders count > 0 (needs tenant context — see §6)
      ├─ Checks: lifecycle/first_insight_delivered event exists
      └─ Emits domain event: ft0.completed

6. Projection processes ft0.completed (lifecycle.ft0_completed.ts handler)
   ├─ Writes ft0_state (COMPLETED)
   ├─ Writes system_readiness_state (presence = FT2 unlockable)
   ├─ Writes activation_audit_events
   ├─ Transitions phase: FT_MINUS_ONE → FT0 (if applicable)
   ├─ Transitions phase: FT0 → FT1
   └─ Sends sync completed email

7. Frontend polls /api/v1/lifecycle/ft2/readiness
   └─ Returns ready: true when system_readiness_state row exists

8. User lands on AhaMomentPage → clicks "Unlock Insights"
   └─ POST /api/v1/lifecycle/ft2/confirm
      ├─ Reads user_lifecycle_snapshot (needs tenant context — see §6)
      ├─ Checks phase === 'FT1'
      ├─ FT2EvaluatorService.evaluate(shopId) — full eligibility check
      └─ Emits domain event: lifecycle/ft2_confirmed

9. Projection processes lifecycle/ft2_confirmed
   ├─ Writes ft2_state
   ├─ Writes expansion_eligibility_state
   └─ Transitions phase: FT1 → FT2

10. Frontend lifecycle polling detects FT2 → routes to main app

> ⚠️ **FT2 evaluator is bypassed under test.** `ft2-evaluator.service.ts:92`
> returns `eligible: true` with all blockers skipped whenever
> `NODE_ENV === 'test'`. Jest sets that by default, so a lifecycle test will
> pass step 8 without exercising any data-coverage check. The SYNC GUARD at
> line 70 runs *above* the bypass and is unconditional in every environment —
> no `integrations` row with `sync_status = 'COMPLETED'` means blocked,
> test or not. See `tests/integration/fresh-install-release-path.test.ts`.
```

---

## 3. Key Files

### Backend — Core lifecycle services

| File | Role |
|---|---|
| `apps/backend/src/services/first-insight.service.ts` | Emits `lifecycle/first_insight_delivered`. Called post-commit from `orders.create` handler. |
| `apps/backend/src/services/ft0-completion.service.ts` | Evaluates FT0 preconditions and emits `ft0.completed`. Called from `first_insight_delivered` projection handler. |
| `apps/backend/src/services/ft2-evaluator.service.ts` | Full FT2 eligibility evaluation (orders, products, customers coverage checks). Called from `confirmFt2` endpoint. |
| `apps/backend/src/services/lifecycle-transition.service.ts` | Writes `user_lifecycle_snapshot` phase transitions. Called from projection handlers. |
| `apps/backend/src/services/lifecycle-history.service.ts` | Read-only lifecycle history for debugging. |

### Backend — Projection handlers

| File | Triggered by |
|---|---|
| `apps/backend/src/projection/handlers/orders.create.ts` | `orders/create` — triggers `FirstInsightService` post-commit |
| `apps/backend/src/projection/handlers/lifecycle.first_insight_delivered.ts` | `lifecycle/first_insight_delivered` — calls `FT0CompletionService` |
| `apps/backend/src/projection/handlers/lifecycle.ft0_completed.ts` | `ft0.completed` — writes `ft0_state`, `system_readiness_state`, transitions to FT1. Registered under the key `ft0/completed`: `projection.engine.ts:237` rewrites dots to slashes before the registry lookup, so emitted and registered spellings differ by design. Do not "fix" one to match the other. |
| `apps/backend/src/projection/handlers/lifecycle.ft2_confirmed.ts` | `lifecycle/ft2_confirmed` — writes `ft2_state`, transitions to FT2 |

### Backend — API

| File | Role |
|---|---|
| `apps/backend/src/api/lifecycle/lifecycle.controller.ts` | `GET /ft2/readiness`, `POST /ft2/confirm`, `GET /lifecycle` |
| `apps/backend/src/api/lifecycle/lifecycle.routes.ts` | Route definitions |

### Frontend

| File | Role |
|---|---|
| `apps/frontend/src/lifecycle/LifecycleProvider.tsx` | Central lifecycle state — polls `/api/v1/lifecycle`, drives routing |
| `apps/frontend/src/activation/SyncAnimationPage.tsx` | FT0 sync animation screen (shown during OAuth flow) |
| `apps/frontend/src/activation/hooks/useSyncStatus.ts` | Polls `/api/v1/integrations/sync-status` every 2s during sync |
| `apps/frontend/src/pages/ft1-pages/AhaMomentPage.tsx` | FT1 screen — shows first insight, "Unlock Insights" CTA |
| `apps/frontend/src/lifecycle/Ft1Outlet.tsx` | Route guard for FT1 phase |

### DB tables

| Table | Role |
|---|---|
| `user_lifecycle_snapshot` | Current phase per shop — source of truth for routing |
| `lifecycle_events` | Audit trail of all phase transitions |
| `ft0_state` | FT0 completion record |
| `system_readiness_state` | Presence = FT2 unlockable. Written by `ft0_completed` handler. |
| `ft2_state` | FT2 completion record |
| `activation_audit_events` | Activation funnel audit log |

---

## 4. RLS Critical Rules

**Every lifecycle service that queries DB tables must set tenant context.** This is the single most common source of lifecycle bugs. RLS silently returns 0 rows — no error is thrown — causing guards to fail as if data doesn't exist.

### The pattern

```typescript
// ✅ CORRECT — use withTenant() from backend-core
import { withTenant } from '@lasyncro/backend-core/db.js';

const result = await withTenant(shopId, async (trx) => {
  return trx('orders').where({ shop_id: shopId }).count('* as count').first();
});

// ⚠️ INSUFFICIENT — sets the GUC but never enters AsyncLocalStorage
const result = await db.transaction(async trx => {
  await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
  return trx('orders').where({ shop_id: shopId }).count('* as count').first();
});
// Queries on `trx` succeed. But any callee reaching for the global `db` throws
// TENANT_CONTEXT_MISSING — backend-core's guarded proxy reads the shop ID from
// AsyncLocalStorage, which this pattern never populates. That is the
// SEC-RLS-P0-b class behind the 2026-08-06 production outage.
// This doc previously marked it "ALSO CORRECT". It is not. Prefer withTenant().
// Live sites still on it: lifecycle.controller.ts:288,
// ft2-evaluator.service.ts:63 and :126 (LIFECYCLE-ALS-01).

// ❌ WRONG — bare db() call on strict RLS table
const result = await db('orders').where({ shop_id: shopId }).count('* as count').first();
// Returns 0 silently if current_tenant = '0'
```

### Tables that REQUIRE tenant context (strict ALL-command RLS)

`orders`, `products`, `variants`, `customers`, `order_revenue_units`, `order_fulfillment_status`, `system_readiness_state`, `user_lifecycle_snapshot`, `ft0_state`, `ft2_state`, `inventory_truth`, and all other data/projection tables.

### There is no "open SELECT" class

Verified 2026-08-07 against the live schema: all twelve tables previously listed here as open have `relrowsecurity = true` AND `relforcerowsecurity = true`, as do the data and projection tables. Migrations 0137/0138 made enforcement universal.

The real distinction is which command a policy covers, not whether one exists. Explicit SELECT-command policy: `domain_events`, `integrations`, `integration_oauth_states`, `shopify_app_installations`. ALL-command policy only: `shops`, `users`, `shop_memberships`, `refresh_tokens`, `user_sessions`, `user_lifecycle_snapshot`, `shop_subscriptions`, `shop_module_entitlements`.

Both groups enforce. A pre-tenant read of `users` or `shop_memberships` returns zero rows — which is why 0138 introduced the SECURITY DEFINER resolver `public.resolve_auth_user_by_email` for the auth path. `systemQuery` waives the application-layer guard only; PostgreSQL RLS still applies.

### domain_events INSERT rule

Every transaction that inserts into `domain_events` **must** set `SET LOCAL app.current_tenant = '${shopId}'` first. The `auto_create_domain_event_outbox` trigger fires on INSERT and writes to `domain_event_outbox` — which has a tenant-scoped INSERT policy that requires tenant context.

```typescript
// ✅ CORRECT for this narrow case — a self-contained insert with no callees.
// If anything downstream reaches for the global `db`, use withTenant() instead;
// see the AsyncLocalStorage warning above.
await db.transaction(async trx => {
  await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
  await trx('domain_events').insert({ shop_id: shopId, event_type: '...', ... });
});
```

---

## 5. The Projection Engine Contract

The lifecycle system is **event-sourced**. All state transitions happen inside the projection engine — never directly from controllers or services.

### Rules

1. **Controllers emit domain events only** — never write lifecycle tables directly
2. **Projection handlers own all lifecycle writes** — `ft0_state`, `system_readiness_state`, `user_lifecycle_snapshot`
3. **Events are immutable** — `domain_events` has a trigger that prevents UPDATE/DELETE
4. **FT0 is edge-triggered** — `lifecycle/first_insight_delivered` fires it once. If it fails, there is no automatic retry. The event is idempotency-guarded by `domain_events_shop_first_insight_unique` constraint.
5. **Projection tables are trigger-guarded** — `order_fulfillment_status` and others require `SET LOCAL "synchroflow.projection" = 'true'` before writes. Only the projection engine sets this.

### What triggers each lifecycle event

| Domain Event | Emitted by | Processed by |
|---|---|---|
| `orders/create` | Shopify sync / webhook | `orders.create` handler |
| `lifecycle/first_insight_delivered` | `FirstInsightService` (post-commit after first order) | `lifecycle.first_insight_delivered` handler |
| `ft0.completed` | `FT0CompletionService` | `lifecycle.ft0_completed` handler |
| `lifecycle/ft2_confirmed` | `lifecycle.controller.ts confirmFt2` | `lifecycle.ft2_confirmed` handler |

---

## 6. Known Race Conditions and Their Fixes

### FT0 race condition (FIXED)

**Problem:** `lifecycle/first_insight_delivered` fires during projection processing of order events — before `sync_status` is set to `COMPLETED`. FT0 check used to require `sync_status = COMPLETED`, which always failed.  
**Fix:** Removed `sync_status = COMPLETED` guard from `FT0CompletionService`. Orders existing is the authoritative signal.

### Outbox RLS race (FIXED)

**Problem:** Services calling `db.transaction()` to insert `domain_events` without tenant context caused `auto_create_domain_event_outbox` trigger to fail — the trigger ran as `sf_app` with `current_tenant = '0'`, blocked by outbox policy.  
**Fix:** Split `domain_event_outbox` RLS policy — SELECT is tenant-scoped, INSERT is open (trigger is the only writer). Additionally, all `domain_events` INSERT transactions now set `SET LOCAL app.current_tenant`.

### Sync worker connection pool isolation (FIXED)

**Problem:** `sync.worker.ts` set `SET app.current_tenant` on its own connection, then `shopify.service.ts` opened new transactions via the pool — different connections, no tenant context.  
**Fix:** Each transaction inside `shopify.service.ts` sets `SET LOCAL app.current_tenant` at the start.

---

## 7. Debugging the Lifecycle

### Check current state

```sql
-- Run as sf_user (bypasses RLS)
SELECT phase FROM user_lifecycle_snapshot WHERE shop_id = 1;
SELECT * FROM system_readiness_state WHERE shop_id = 1;
SELECT * FROM ft0_state WHERE shop_id = 1;
SELECT event_type, event_time FROM domain_events 
  WHERE shop_id = 1 AND event_type LIKE 'lifecycle%' OR event_type LIKE 'ft0%'
  ORDER BY id;
```

### Key log signals to watch

| Log | Meaning |
|---|---|
| `[FT0Completion] evaluateAndComplete called` | FT0 evaluation triggered |
| `[FT0Completion] Preconditions passed` | FT0 will complete ✅ |
| `[FT0][BLOCKED][NO_ORDERS]` | Orders query returned 0 — likely RLS missing tenant context |
| `[FT0][BLOCKED][INSIGHT_EVENT_NOT_FOUND]` | `lifecycle/first_insight_delivered` event not in DB |
| `[FT0_TRANSITION_SKIP_ALREADY_PAST]` | Phase already at or past FT0 — idempotency guard |
| `[FT2_READINESS_CHECK] ready: true` | `system_readiness_state` row exists ✅ |
| `[FT2_READINESS_CHECK] ready: false` | Row missing — FT0 completion likely failed |
| `[FIRST_INSIGHT_POST_COMMIT_FAILED]` | `FirstInsightService` failed — check RLS tenant context |

### If FT0 is stuck

FT0 is edge-triggered and non-retrying. If it fails:

1. Check logs for `[FT0][BLOCKED][*]` reason
2. Fix the root cause (usually RLS missing tenant context)
3. In dev only: full reset (`npm run dev:full-reset`) then re-run OAuth

> ⚠️ **Production recovery:** A manual recovery endpoint or admin CLI will be needed for production incidents where FT0 fails after the `first_insight_delivered` event is already consumed. This is a known gap — logged as a Phase 2 item.

---

## 8. Frontend Lifecycle Routing

`LifecycleProvider` polls `/api/v1/lifecycle` and drives all routing decisions:

```
FT_MINUS_ONE → /connect (Shopify OAuth screen)
FT0           → /sync (SyncAnimationPage)
FT1           → /aha (AhaMomentPage)
FT2           → main app (FT2 modules)
```

The `SyncAnimationPage` polls `/api/v1/integrations/sync-status` every 2 seconds. It unmounts when `LifecycleProvider` detects phase > FT0 — it does **not** navigate itself.

`LifecycleProvider` stops polling `ft2/readiness` once FT2 is confirmed (terminal state).

---

## 9. Entitlements and Plan Gating

Lifecycle phase controls **access** to the platform. Plan tier controls **feature gating** within the platform. These are independent systems.

- Phase gating: `LifecycleProvider` + route guards
- Feature gating: `usePlanEntitlement()` hook + `PlanGate` component
- WMS receive flow: `wms.receive` → `core` tier minimum
- Returns lot attribution (Phase 2): `returns.lot_attribution` → `growth` tier

See `apps/frontend/src/hooks/usePlanEntitlement.ts` for the full feature registry.

---

## 10. Do Not Violate

1. **Never write lifecycle tables from controllers** — emit domain events only
2. **Never skip tenant context on lifecycle service DB queries** — RLS silently returns 0 rows
3. **Never write to `domain_events` without `SET LOCAL app.current_tenant`** — outbox trigger will fail
4. **Never add a retry loop to FT0** — it is intentionally edge-triggered for determinism
5. **Never write to projection tables outside the projection engine** — trigger guards will throw
6. **Never add `sync_status = COMPLETED` as a lifecycle precondition** — race condition with projection processing
