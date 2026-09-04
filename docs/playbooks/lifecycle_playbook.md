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
| `FT_MINUS_ONE` | Registered, no Shopify connection | **Implicit** — no row exists yet in `user_lifecycle_snapshot`. Never explicitly persisted; see §2a. |
| `FT0` | Shopify connected, sync running or done | First `orders/create` processed (populated store, §2) — **or**, for a store that authoritatively synced with zero orders, `integration/sync_completed` (§2b) |
| `FT1` | Trust gate passed — data confirmed | `ft0.completed` processed (§2) — **or** the shared FT0/FT1 materializer running inline from `integration/sync_completed` (§2b); the zero-order path reaches FT1 without emitting `ft0.completed` |
| `FT2` | Full platform access | User clicks "Unlock Insights" → `lifecycle/ft2_confirmed` emitted |

**Source of truth:** `user_lifecycle_snapshot.phase` per shop.  
**Lifecycle identity:** the snapshot is shop-scoped (`shop_id` is the uniqueness boundary) and its `user_id` is permanently anchored to that shop's founding owner. Different shops therefore progress independently even when the same platform contains many users/tenants.
**Audit trail:** `lifecycle_events` table — every transition is logged.

---

## 2. The Canonical Event Chain

This is the exact sequence a merchant **with at least one order** follows to reach FT2. Every step is mandatory and sequential. A store that authoritatively completes sync with **zero orders** still executes steps 2–3 (OAuth callback / integration row, then Shopify sync) normally, but never emits `orders/create` — so from there it takes the zero-order path in §2b in place of the populated-store lifecycle steps 4–6; steps 7–10 (explicit FT2 confirmation) are then identical.

```
1. User registers → shop created → phase = FT_MINUS_ONE (implicit — no row
   is written yet; see §2a)

2. OAuth CALLBACK → integration row inserted (sync_status = PENDING)
   └─ Written at the callback (`handleOAuthCallback`, `integration.controller.ts`),
      AFTER the token exchange with Shopify — not when OAuth is initiated. A
      tenant that has only started OAuth, or that arrived via
      handleShopifyInstall (which seeds integration_oauth_states and 302s to
      Shopify), has NO integration row yet. The callback 502s on
      ACCESS_TOKEN_MISSING, so it cannot be driven offline.
   └─ **Persistence drift (found 2026-08-27):** the same callback now also
      writes `shopify_app_installations` — added since this section was
      first written, commented "SINGLE SOURCE OF TRUTH FOR SHOPIFY TOKEN" in
      source, and what `execution.guard.ts`'s `proceed_fulfillment` check,
      Shopify-provider overage billing, packing-slip URL, and order-invoice
      endpoints all actually read. `FT0CompletionService` and
      `FT2EvaluatorService`'s SYNC GUARD read `integrations` only — §8's
      offline `integrations`-only fixture remains sufficient for lifecycle
      progression and deterministic fresh-install/release tests, but it is
      **not** a complete simulation of a real Shopify installation; anything
      reading `shopify_app_installations` will not find a row.
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

> ⚠️ **FT2 evaluator is bypassed under test.** `ft2-evaluator.service.ts:93`
> (verified current as of 2026-08-27) returns `eligible: true` with all blockers skipped whenever
> `NODE_ENV === 'test'`. Jest sets that by default, so a lifecycle test will
> pass step 8 without exercising any data-coverage check. The SYNC GUARD at
> line 70 runs *above* the bypass and is unconditional in every environment —
> no `integrations` row with `sync_status = 'COMPLETED'` means blocked,
> test or not. See `tests/integration/fresh-install-release-path.test.ts`.
```

### 2a. FT_MINUS_ONE is implicit, not a persisted row (verified 2026-08-27, RECOUNT-FRESH-NOBINS-40)

Registration (`registerUser`, `auth.controller.ts`) does **not** insert a
`user_lifecycle_snapshot` row. `LifecycleProjectionService.projectForMembership`
(called at both registration and Shopify install) computes `shopLevel` from
`system_readiness_state`/`ft2_state`; for a brand-new shop this resolves to
`FT_MINUS_ONE`, at which point it explicitly returns without writing
anything (`[LIFECYCLE_PROJECTION][NO_ACTION]`) — its own header rule is
"Must NOT write snapshot directly." `LifecycleService.resolveForUser` (the
single read authority behind `GET /api/v1/lifecycle`) queries
`user_lifecycle_snapshot` by `shop_id`; when no row exists it returns the
hardcoded literal `'FT_MINUS_ONE'` — no write occurs on read either. This is
by design, stated directly in `lifecycle.service.ts`'s own header comment:
"Absence of snapshot == FT_MINUS_ONE."

**The first persisted snapshot row is written at `FT0`, not `FT_MINUS_ONE`.**
The only INSERT site for `user_lifecycle_snapshot` in the codebase is
`LifecycleTransitionService.auditIfTransitioned`, gated to
`AUDITABLE_TRANSITIONS = {'FT_MINUS_ONE->FT0', 'FT0->FT1', 'FT1->FT2'}` — no
transition ever targets `'FT_MINUS_ONE'` itself. In practice this first
write happens inside the `orders.create` projection handler's
"INGESTION-DRIVEN" block on the FIRST `orders/create` event — before
`lifecycle/first_insight_delivered` or `ft0.completed` even fire — and
resolves the founding owner from `shop_memberships` (`role='owner'`,
earliest `created_at`/`id`), the same mechanism the Founding-owner
invariant section below describes. By the time
`lifecycle.ft0_completed.ts` runs its own FT0-transition attempt, the
snapshot is usually already at `FT0`, so its idempotency guard skips with
`[FT0_TRANSITION_SKIP_ALREADY_PAST]` and proceeds straight to FT0→FT1 —
this is why step 6 above hedges "(if applicable)".

**A missing `user_lifecycle_snapshot` row for a freshly registered or
freshly Shopify-installed tenant with zero orders synced is expected
design, not a defect.** Do not treat it as a precondition failure, and do
not block §8 Step 2 (inserting the offline `integrations` row) on a
snapshot existing first — nothing in the lifecycle write-authority contract
requires one to. **This holds only until the shop's first `orders/create`
or an authoritative zero-order `integration/sync_completed` (§2b):** an
empty store is no longer left indefinitely snapshot-less once its sync
authoritatively completes — §2b then writes the first snapshot straight
through to `FT1`.

### 2b. The authoritative zero-order completion path (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, verified end to end 2026-08-27)

Steps 2–3 (OAuth callback / integration row, then Shopify sync) still happen
normally for an empty store. But `orders/create` never fires for a store that
synced successfully with no orders, so the populated-store lifecycle branch
that begins at step 4 (`orders.create` → first insight → `ft0.completed`) can
never advance it — such a tenant used to stay implicitly at `FT_MINUS_ONE`
forever. There is now a second, parallel FT0-entry path for exactly that case.
**Zero orders is a valid authoritative Shopify state.**

**Populated-store path (unchanged, §2):**
`orders/create` → first insight → `ft0.completed` → FT0 completion → FT1.

**Zero-order path (new):**
authoritative sync `COMPLETED` + `error` null → `integration/sync_completed`
→ shared zero-order lifecycle materializer → FT0 completion / readiness → FT1.

**Trigger — authoritative sync completion only.** The sole emitter of
`integration/sync_completed` is
`shopifyIntegrationStatus.service.ts::updateIntegrationStatus`, and only when
called with `status: 'COMPLETED'` and `error: null`. In the **same
transaction** as the `integrations.sync_status` write it inserts one
`integration/sync_completed` domain event; the existing
`auto_create_domain_event_outbox` trigger creates the outbox row. There is no
producer-side dedup key — a shop may legitimately complete sync many times
(reinstall, resync); duplicates are absorbed by the handler's own state guard.

**The PCD-restricted fallback is NOT authoritative.**
`shopify-fallback.service.ts` writes `sync_status` directly and never calls
`updateIntegrationStatus`, so it structurally cannot emit
`integration/sync_completed`. A PCD-limited completion must never be described
or treated as an authoritative sync.

**Handler — `integration.sync_completed.ts` (registry key `integration/sync_completed`).**
The ambient projection worker runs the shared FT0/FT1 materializer
(`ft0-completion-materializer.service.ts`, extracted from
`lifecycle.ft0_completed.ts` — one code path, two entry points). The handler
**self-excludes** (no-ops) when either:

- a `user_lifecycle_snapshot` row already exists for the shop (some other path —
  normally `orders.create` — already anchored it), or
- the shop's live `orders` count is `> 0` (the §2 INGESTION-DRIVEN block owns
  FT0 entry for populated stores).

Otherwise it resolves the shop's founding owner via
`founding-owner.service.ts` (`shop_memberships`, `role='owner'`, earliest
`created_at`/`id`) — the **same** resolution the §2 path and the
Founding-owner invariant below use — and materializes:
`ft0_state` = `COMPLETED` with `completion_reason`
`{"orders":0,"source":"integration/sync_completed"}`,
`system_readiness_state` created, `user_lifecycle_snapshot` transitioned
straight through to `FT1`. No `ft0.completed` domain event is emitted on this
path.

**FirstInsight is decoupled.** `FirstInsightService` / `FT0CompletionService`
are never called and no `lifecycle/first_insight_delivered` event is emitted —
"first insight" has no meaning for a store with no orders, and zero-order
lifecycle completion does not require it.

**FT2 is still explicit.** This path stops at FT1 / readiness. The merchant
still has to click "Unlock Insights" (§2 steps 8–10); the zero-order path
never silently promotes to FT2.

**Aha signal.** Through the real authenticated controller path
(`GET /api/v1/aha/signal`), an authoritatively-synced zero-order store returns
priority `0`:
headline `You're connected — no orders yet.`
detail `Your Shopify sync finished successfully. You can set up your warehouse
now — insights will start populating when your first orders arrive.`

**OAuth boundary unchanged (see §2 step 2 and §8).** The signed App Store
install route only creates the tenant + OAuth state and 302s to Shopify; the
`integrations` row still appears at the real OAuth callback after token
exchange. For deterministic offline certification the canonical fixture from
`tests/integration/lifecycle/zero-order-sync-completion.test.ts` is reused —
`integrations(shop_id, platform='shopify', platform_shop_name=<fresh domain>,
access_token_encrypted='offline-test-token-no-network-call',
sync_status='SYNCING_ORDERS')`, no `shopify_app_installations` row. That is
lifecycle certification only, **not** a complete Shopify provider installation.

**Final runtime verification (2026-08-27).** A fresh tenant created through the
real signed App Store install route (one owner, one warehouse + one
warehouse-root location, zero bins, zero orders, no snapshot, zero tenant
domain events, no `integrations` row, Growth trial / Shopify billing, WMS
settings) had the offline fixture row added, then the production
`updateIntegrationStatus({ status: 'COMPLETED', error: null })` was invoked. It
emitted exactly one `integration/sync_completed`; the already-running ambient
projection worker consumed it naturally (cursor advanced 1 → 2, no manual
cursor write), the zero-order materializer ran, `user_lifecycle_snapshot`
reached `FT1`, `ft0_state` = `COMPLETED`, `system_readiness_state` was created,
no fake/test order existed, no `lifecycle/first_insight_delivered` event, no
projection failure/quarantine, the worker stayed alive, and
`GET /api/v1/aha/signal` returned priority 0. Focused suites: backend
integration 3/3 suites (24 tests), `AhaMomentPage` frontend unit 1/1 (11
tests), backend `tsc` 0 errors; the disposable test DB was dropped with no
orphan and `synchroflow_db` preserved.

**Real Shopify provider confirmation (2026-08-28, SHOP-REVIEW-ZERO-PRODUCT-SYNC-06).**
The 2026-08-27 run above used the offline fixture row. On 2026-08-28 the same
zero-order path was exercised end to end against a **real** Shopify installation
— development store `third-lasyncro-dev-store.myshopify.com`, `shop_id = 5`,
`integration_id = 2`, real OAuth token with all 10 scopes persisted — via one
live recovery of a sync that had previously failed. `updateIntegrationStatus`
emitted exactly one `integration/sync_completed` (event id `4`, payload
`{"integration_id":2}`) with its single owned outbox row published
(`retry_count = 0`, `last_error` NULL); the ambient worker advanced the
`orders_projection` cursor `3 → 4` with `cursor_caught_up = true` and zero
projection failures; the zero-order materializer took `user_lifecycle_snapshot`
to `FT1` with `ft0_state = COMPLETED`
(`completion_reason {"orders":0,"source":"integration/sync_completed"}`) and a
`system_readiness_state` row; no products, variants, orders, customers,
`external_product_identity_map`, `inventory_movements` or `inventory_truth` rows
were created; the browser resolved `FT1` and `/overview` rendered. The two
Shopify-sync engine fixes that made a genuinely empty store reach this point
(zero-product opening-balance seeder, empty terminal pagination) are recorded in
`docs/playbooks/shopify_submission_playbook.md` → "Zero-product / zero-order
initial sync is engine-safe".

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
| `apps/backend/src/projection/handlers/integration.sync_completed.ts` | `integration/sync_completed` — zero-order FT0/FT1 entry (§2b). No-ops if a `user_lifecycle_snapshot` exists or `orders` count > 0. Shares `ft0-completion-materializer.service.ts` with the `ft0.completed` handler. |
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
// Live sites still on it: lifecycle.controller.ts's confirmFt2 (line drifted
// to :292 as of 2026-08-27 — verify against source rather than trusting this
// number), ft2-evaluator.service.ts:63 and :126 (both confirmed current as
// of 2026-08-27) (LIFECYCLE-ALS-01).

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
4. **FT0 is edge-triggered** — for a populated store `lifecycle/first_insight_delivered` drives it (idempotency-guarded by the `domain_events_shop_first_insight_unique` constraint); for a zero-order store `integration/sync_completed` drives it via §2b. There is no automatic retry on either path. `integration/sync_completed` may legitimately recur on later authoritative resync/reinstall completions — the zero-order FT0/FT1 materialization is nonetheless one-time, because the handler no-ops once a `user_lifecycle_snapshot` row exists (also no-ops when `orders` count > 0).
5. **Projection tables are trigger-guarded** — `order_fulfillment_status` and others require `SET LOCAL "synchroflow.projection" = 'true'` before writes. Only the projection engine sets this.

### What triggers each lifecycle event

| Domain Event | Emitted by | Processed by |
|---|---|---|
| `orders/create` | Shopify sync / webhook | `orders.create` handler |
| `integration/sync_completed` | `updateIntegrationStatus(COMPLETED, error:null)` — authoritative sync only; the PCD fallback bypasses this emitter | `integration.sync_completed` handler — zero-order FT0/FT1 entry (§2b) |
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
| ~~`[FT2_READINESS_CHECK] ready: true/false`~~ | **Dead as of 2026-08-27** — the `console.info` call in `lifecycle.controller.ts`'s readiness handler is commented out. The underlying behavior (`ready: !!readiness` in the JSON response) is unchanged; only the log line is gone. Read the HTTP response body instead of grepping for this signal. |
| `[FIRST_INSIGHT_POST_COMMIT_FAILED]` | `FirstInsightService` failed — check RLS tenant context |

### If FT0 is stuck

FT0 is edge-triggered and non-retrying. If it fails:

1. Check logs for `[FT0][BLOCKED][*]` reason
2. Fix the root cause (usually RLS missing tenant context)
3. In dev only: full reset (`npm run dev:full-reset`) then re-run OAuth

> ⚠️ **Production recovery:** A manual recovery endpoint or admin CLI will be needed for production incidents where FT0 fails after the `first_insight_delivered` event is already consumed. This is a known gap — logged as a Phase 2 item.

---

## 8. Bootstrapping a Test Tenant Offline (FT_MINUS_ONE → FT2)

Verified end to end against the Shopify-reviewer path: one warehouse root,
**zero bins**, stock at `WH-{shopId}-ROOT`. Use this instead of `dev_seed`,
which builds preconfigured bins and does not represent a fresh install.

### FRESH-INSTALL-04 release regression ladder

| Stage | Required invariant |
| --- | --- |
| Post-OAuth, synced, zero bins | Orders remain releasable from warehouse root |
| One empty pick bin created | Orders remain releasable from warehouse root |
| Partial stow | Binned stock is preferred; remaining root stock stays releasable |
| Fully stowed | Pick-bin stock is preferred; root remains valid if stock exists there |

`tests/integration/fresh-install-release-path.test.ts` protects the critical
zero-bin → one-empty-bin transition through the real batch-release endpoint.
Creating an empty bin must never make root inventory unavailable. Floor Planning
itself is not the subject of FRESH-INSTALL-04; the empty bin is fixture state.

#### FRESH-INSTALL-COMMERCIAL-01 fixture correction (2026-09-04)

P0-A2A correctly closed the Starter/Core Floor Planning leak by replacing the
Starter route gate with the canonical Growth+ capability
`warehouse.floor_planning`. That change exposed stale fixture construction in
`tests/integration/fresh-install-release-path.test.ts`, which had used
`POST /api/v1/floor-planning/zones` with a Starter-equivalent token merely to
create the one-empty-bin state.

The permanent regression invariant remains:

```
zero bins
→ Starter batch release reserves from WH-{shopId}-ROOT
→ one empty pick bin exists
→ second Starter batch release still reserves from WH-{shopId}-ROOT
```

The empty-bin setup now resolves the existing warehouse root and inserts the
tenant-scoped `warehouse_locations` fixture through `withTenant(...)`, without
adding inventory to the bin. No Growth token was introduced. Commercial
semantics remain unchanged: `warehouse.operations` is Starter+ and
`warehouse.floor_planning` is Growth+.

Verification: `fresh-install-release-path` is 1/1 suite GREEN and 1/1 test
GREEN through the disposable integration harness, with the database created,
migrated, runtime-verified, and dropped. FRESH-INSTALL-COMMERCIAL-01 is
classified as **TEST FIXTURE DRIFT**, not a production regression; the local
release blocker is resolved pending CI rerun.

#### CI trigger ownership — CI-SEC-PATH-01 (2026-09-04)

`CI / RLS Security Boundary` owns the FRESH-INSTALL-04 regression, but its path
filters did not previously trigger when the test or its direct test
infrastructure changed. CI-SEC-PATH-01 adds these paths to both `pull_request`
and `push` without changing the existing trigger paths:

- `tests/integration/fresh-install-release-path.test.ts`
- `tests/unit/helpers/auth.ts`
- `scripts/with-test-db.js`

The workflow also supports explicit manual recertification through
`workflow_dispatch`. Trigger scope remains intentionally narrow: do not replace
these paths with `tests/**` or `tests/integration/**`.

The certification invariant is that changes to the fresh-install regression,
its auth fixture, disposable-DB harness, `apps/backend/**`,
`packages/backend-core/**`, `scripts/check-conflict-usage.sh`, the workflow
file, or `fly.toml` trigger `CI / RLS Security Boundary`. Static verification
passed for YAML syntax, `workflow_dispatch`, both trigger sets, absence of broad
test globs, authorized tracked scope, and staged count zero.

CI-SEC-PATH-01 is classified as a **CI trigger coverage defect**. Runtime and
product behavior are unchanged.

> ⚠️ **Step order is load-bearing.** The `integrations` row must exist BEFORE
> the seeder runs. FT0 is edge-triggered and non-retrying (§5 rule 4): if
> `first_insight_delivered` is consumed while no integration row exists,
> `FT0CompletionService` logs `[FT0][BLOCKED][NO_INTEGRATION]` and the tenant is
> **permanently stuck at FT0**. Only a full reset recovers it. Observed on a
> throwaway tenant during REV-HARD verification.

### Step 1 — FT_MINUS_ONE: HMAC install

Creates the shop, the ghost owner user, and `WH-{shopId}-ROOT`. Sign with the
secret the *running server* holds (`.env`), not a test fallback.

```zsh
SECRET=$(grep '^SHOPIFY_API_SECRET=' .env | cut -d= -f2-)
SHOP="test-$(date +%s).myshopify.com"
TS=$(date +%s)
HMAC=$(printf '%s' "shop=$SHOP&timestamp=$TS" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -o /dev/null -w 'install %{http_code}\n' \
  "http://localhost:3000/api/v1/integrations/shopify/install?shop=$SHOP&timestamp=$TS&hmac=$HMAC"
```

Expect `302`. Read back the new `shops.id` and `users.id` — both are needed below.

### Step 1 (alternative) — `/auth/register` as the offline fixture bootstrap (verified 2026-08-27)

`POST /api/v1/auth/register` is a safer substitute for the HMAC install
above when the goal is a deterministic fresh-account fixture rather than
proving the install/HMAC path itself. `registerUser` (`auth.controller.ts`)
creates, on the same restricted transaction pattern as the HMAC install
path:

- a real, immediately login-capable owner (a real password — not the HMAC
  path's password-login-disabled ghost user);
- the shop (`createTenantShop`/`setTenantContext`);
- one warehouse (`is_default: true`) and its root `warehouse_locations` row
  (`type: 'warehouse'`, zero bins);
- `shop_wms_settings`, `shop_memberships` (`role: 'owner'`);
- a 14-day Growth-tier trial subscription and entitlements
  (`EntitlementsService.applyFromCommercialGrant`).

It does **not** insert `integration_oauth_states`, `integrations`, or
`shopify_app_installations` — Steps 2-5 below proceed unchanged from this
starting point. The resulting founding-owner identity is real and already
login-capable, which removes the need for Step 4's synthetic-JWT
workaround below — a normal `POST /api/v1/auth/login` for that user
produces an equivalent token via the same `issueAuthTokens(...)` call
shape the HMAC/ghost-user path also uses.

Prefer this over the HMAC install path whenever the test does not need to
exercise HMAC/redirect/install-specific behavior itself. Used for
`RECOUNT-FRESH-NOBINS-40`'s live verification.

### Step 2 — the integration row (must precede Step 3)

The OAuth callback writes this row after exchanging a code with Shopify, so it
cannot run offline (§2 step 2). Insert it directly, using the app's own
`encrypt()` so `ENCRYPTION_KEY` handling stays identical.

```zsh
SHOP_NAME="$SHOP" npx tsx -e "
import { withTenant } from '@lasyncro/backend-core/db.js';
import { encrypt } from './apps/backend/src/security/encryption.service.js';
(async () => {
  await withTenant(SHOP_ID, (trx) => trx('integrations').insert({
    shop_id: SHOP_ID,
    platform: 'shopify',
    platform_shop_name: process.env.SHOP_NAME,
    access_token_encrypted: encrypt('offline-test-token-no-network-call'),
    sync_status: 'COMPLETED',
    updated_at: new Date(),
  }));
  process.exit(0);
})();
"
```

Top-level await fails under tsx's CJS output — the async IIFE is required.
`sync_status: 'COMPLETED'` satisfies the unconditional SYNC GUARD at
`ft2-evaluator.service.ts:70`, which runs above the `NODE_ENV=test` bypass.

### Step 3 — FT0 → FT1: seed, then let the worker climb

```zsh
npx tsx apps/backend/src/scripts/seed_fresh_install.cli.ts SHOP_ID
```

The seeder refuses to bootstrap a tenant — it aborts with
`FRESH_INSTALL_SEED_ABORTED` if `WH-{shopId}-ROOT` is absent. Steps 1–2 are its
preconditions.

The worker then drives `orders/create` → `first_insight_delivered` →
`ft0.completed` → FT1 with no further input. Watch for
`[FT0Completion] Preconditions passed`. Confirm with:

```sql
SELECT shop_id, phase FROM user_lifecycle_snapshot;
SELECT shop_id, status FROM ft0_state;
```

> ⚠️ The seeder is idempotent on orders (`external_event_id` dedup) but **not**
> on inventory — re-running it writes a second set of `opening_balance`
> movements and inflates stock. Seed each tenant once.

### Step 4 — FT1 → FT2: confirm

Mint a token for the ghost owner (claims mirror `tests/unit/helpers/auth.ts`):

```zsh
TOKEN=$(node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({iss:'auth.lasyncro.com',aud:'api.lasyncro.com',actor_type:'shop_user',user_id:USER_ID,shop_id:SHOP_ID,shop_roles:['owner'],scopes:[],session_id:'test-session',token_version:1,auth_provider:'password'},'dev-jwt-secret',{expiresIn:'60m'}));
")

curl -s -w '\nreadiness %{http_code}\n' http://localhost:3000/api/v1/lifecycle/ft2/readiness \
  -H "Authorization: Bearer $TOKEN"

curl -s -w '\nconfirm %{http_code}\n' -X POST http://localhost:3000/api/v1/lifecycle/ft2/confirm \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

`confirm` returns `{"phase":"FT2_READY"}`. Under `dev` the FT2 evaluator is
**not** bypassed, so this exercises the real coverage checks a live merchant
faces — `409 {"error":"FT2 not eligible", blockers:[...]}` is a genuine finding,
not a harness problem.

### Founding-owner lifecycle invariant

`user_lifecycle_snapshot` contains one authoritative row per shop. Its `user_id`
must identify the founding owner of that shop throughout the lifecycle ladder.

LIFECYCLE-ID-01 (2026-08-07) found that first-order ingestion previously used
`domainEvent.user_id ?? 1`. `domain_events` has no top-level `user_id` column,
so every later shop could incorrectly create its initial FT0 snapshot under
user 1. Later FT1/FT2 transitions changed the phase but did not replace that
identity.

The fix resolves the earliest `owner` membership for the shop before the
initial FT0 transition. Migration `0141_repair_lifecycle_founder_identity`
repairs existing snapshots to the earliest owner membership. The migration is
forward-only because the previous fallback identities were corrupt data, not
valid historical state.

`tests/integration/fresh-install-release-path.test.ts` asserts the founding
owner identity at both FT1 and FT2 on a real fresh-install lifecycle path.

### Step 5 — verify the tenant is reviewer-shaped

```zsh
curl -s http://localhost:3000/api/v1/wms/order-pool -H "Authorization: Bearer $TOKEN" | jq
```

Expect `eligible_order_count: 5`, `blocked_count: 0`, and one `warehouse`-type
location with no bins. WMS routes 403 with `{"error":"FT2 access requires
confirmed FT2 lifecycle"}` until Step 4 lands — that is `requireFt2`, not a bug.

> **No batch cancel endpoint exists** (REV-HARD-13). Released orders cannot be
> returned to the pool, and `inventory_movements` is append-only by trigger.
> Budget one throwaway tenant per release test rather than planning to reset one.

### Offline fixture vs. real Shopify OAuth — do not conflate (updated 2026-09-01)

The lifecycle certification ladder has three materially different evidence levels.

**A — deterministic offline reviewer fixture**

This proves lifecycle, recount, release, failure, timing, and UI contracts without requiring a Shopify provider session.

The activation M1–M34 matrix belongs here.

It does **not** prove Shopify authorization-code exchange or real provider scopes.

**B — real Shopify provider OAuth reconnect**

Certified locally on 2026-09-01 against:

`development-store-15820042357.myshopify.com`

The local certification used a deliberately minimal reconnect bootstrap:

- fresh local database;
- one dev owner + active owner membership;
- one placeholder `shopify_app_installations` identity solely to satisfy the guarded reconnect ownership check;
- no `user_lifecycle_snapshot`;
- no completed `ft0_state`;
- authenticated `GET /api/v1/integrations/oauth/initiate`;
- real Shopify authorization/approval screen;
- real Shopify authorization-code callback;
- real token exchange;
- real initial sync;
- real lifecycle progression.

Pre-OAuth lifecycle state was therefore genuinely first-run shaped:

`FT_MINUS_ONE`

The provider flow then produced:

- 10 persisted canonical scopes;
- `read_locations = present`;
- `write_inventory = present`;
- `integrations.sync_status = COMPLETED`;
- lifecycle progression to FT2;
- `remaining_oauth_state_count = 0`;
- no first-activation replay after hard refresh;
- no first-activation replay on fresh local/incognito re-entry.

This is a real Shopify-provider OAuth and sync certification. The placeholder installation is not treated as a real Shopify credential; successful OAuth replaces it through the normal application/provider path.

**C — genuine signed Shopify fresh-install entry**

This remains distinct from B.

A genuine App-Store/reviewer fresh-install entry begins at:

`GET /api/v1/integrations/shopify/install`

and additionally proves Shopify's signed install HMAC/timestamp entry, tenant provisioning from the incoming Shopify domain, and the full fresh-install boundary.

Do not claim B proves C.

Likewise, do not present a passing offline-fixture run (A) as evidence for either B or C.

The repository's automated tests still do not perform a live Shopify provider token exchange. Provider OAuth remains a live/manual certification boundary layered on top of deterministic automated regression coverage.
---

## 9. Frontend Lifecycle Routing

`LifecycleProvider` polls `/api/v1/lifecycle` and drives all routing decisions:

```
FT_MINUS_ONE → /connect (Shopify OAuth screen)
FT0           → /sync (SyncAnimationPage)
FT1           → /aha (AhaMomentPage)
FT2           → main app (FT2 modules)
```

The activation surface polls `/api/v1/integrations/sync-status` every 2 seconds through `useSyncStatus`.

Post-OAuth activation intentionally separates three clocks:

1. backend real-sync authority;
2. frontend seven-scene story timing;
3. frontend first-run experience buffer.

The frontend story and displayed progress never write or advance lifecycle state.

Canonical first-run timing:

- minimum dwell: `9000ms`;
- post-sync resolve ceiling: `1800ms`;
- completion transition: `900ms`;
- very-long-sync threshold: `45000ms`.

Display progress is a presentation projection that starts below completion, advances monotonically with story scenes, caps at 95% while completion is not eligible, and reaches 100% only after real sync plus the first-run eligibility contract.

The completion UI is a non-blocking **Sync complete / Enter workspace** chip. The CTA only accelerates presentation timing; it does not bypass backend or lifecycle authority.

`SyncAnimationPage` unmounts when `LifecycleProvider` detects the lifecycle has advanced beyond the activation phase. It does **not** independently route around lifecycle state.

Long sync settles into ambient state after Scene 7 rather than restarting the story. Failure interrupts immediately. Reduced-motion mode preserves the same lifecycle and timing authority.

`LifecycleProvider` stops polling `ft2/readiness` once FT2 is confirmed (terminal state).

---

## 10. Entitlements and Plan Gating

Lifecycle phase controls **access** to the platform. Plan tier controls **feature gating** within the platform. These are independent systems.

- Phase gating: `LifecycleProvider` + route guards
- Feature gating: `usePlanEntitlement()` hook + `PlanGate` component
- WMS receive flow: `wms.receive` → `core` tier minimum
- Returns lot attribution (Phase 2): `returns.lot_attribution` → `growth` tier

See `apps/frontend/src/hooks/usePlanEntitlement.ts` for the full feature registry.

---

## 11. Do Not Violate

1. **Never write lifecycle tables from controllers** — emit domain events only
2. **Never skip tenant context on lifecycle service DB queries** — RLS silently returns 0 rows
3. **Never write to `domain_events` without `SET LOCAL app.current_tenant`** — outbox trigger will fail
4. **Never add a retry loop to FT0** — it is intentionally edge-triggered for determinism
5. **Never write to projection tables outside the projection engine** — trigger guards will throw
6. **Never add `sync_status = COMPLETED` as a lifecycle precondition** — race condition with projection processing
7. **Never infer or hardcode lifecycle `user_id` from an ingestion event** — resolve the shop's founding owner membership; lifecycle is shop-scoped but permanently anchored to that founder
