# Shopify App Store Submission Playbook

**Sprint:** LaSyncro Shopify App Store Listing
**Date:** June 15–16, 2026
**Last updated:** August 13, 2026
**Status:** ✅ Submission-ready

---

## Overview

This playbook documents the full process of getting LaSyncro listed on the Shopify App Store, including all automated checks, infrastructure fixes, and production debugging performed during this sprint.

---

## Architecture Context

LaSyncro is a monorepo with three distinct production surfaces:

| Surface | URL | Platform |
| --- | --- | --- |
| Marketing / landing | `www.lasyncro.com` | Vercel |
| App (frontend + API) | `app.lasyncro.com` | Fly.io (`synchroflow`) |
| Database | Internal Fly network | Fly Postgres (`synchroflow-db`) |
| Queue | CloudAMQP (LavinMQ) | `kebnekaise.lmq.cloudamqp.com` |

---

## Shopify Partner Dashboard Configuration

### App URLs (dev dashboard → Versions)

- **App URL:** `https://app.lasyncro.com`
- **Redirect URLs:** `https://app.lasyncro.com/api/v1/integrations/oauth/callback/shopify`

> ⚠️ Never leave these pointing at `localhost` or ngrok URLs. The automated checks will fail with "host is invalid."

### Compliance Webhooks

Registered via `shopify.app.toml` (CLI-managed):

```toml
[webhooks]
api_version = "2026-01"

  [[webhooks.subscriptions]]
  compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
  uri = "https://app.lasyncro.com/api/v1/shopify/webhooks"
```

Deploy config changes with: `shopify app deploy --config shopify.app.toml`

---

## Automated Checks — Resolution Log

### ✅ Immediately authenticates after install

No changes required. Passed from the start once URLs were corrected.

### ✅ Immediately redirects to app UI after authentication

**Root cause:** App URL was set to `http://localhost:3000` in the dev dashboard.
**Fix:** Updated App URL to `https://app.lasyncro.com`.

### ✅ Uses a valid TLS certificate

**Root cause:** `lasyncro.com` returned a 308 redirect to `www.lasyncro.com`. Shopify's checker saw no valid host.
**Fix:** App URL changed to `https://app.lasyncro.com` (backend on Fly, not Vercel).

### ✅ Provides mandatory compliance webhooks

**Root cause:** No `shopify.app.toml` existed; webhooks were never registered.
**Fix:** Created `shopify.app.toml` with compliance topics; deployed via Shopify CLI.

### ✅ Verifies webhooks with HMAC signatures

**Root causes (two bugs):**

1. `verifyShopifySignature` returned HTTP `400` on bad HMAC — Shopify requires `401`.
2. Compliance webhook handler fell through to `default` case returning `200 ignored`.

**Fixes:**

- `apps/backend/src/api/shopify/shopify.verify.middleware.ts` — changed status from `400` to `401`
- `apps/backend/src/api/shopify/shopify.webhook.router.ts` — added `customers/data_request`, `customers/redact`, `shop/redact` cases

---

## Infrastructure Fixes

### Fly.io Secrets Corrected

During the sprint, several production secrets were found mismatched or stale:

| Secret | Issue | Fix |
| --- | --- | --- |
| `SHOPIFY_API_KEY` | Pointed to old/wrong app key | Updated to `990bd1711ae1152021d12901d45a7951` |
| `SHOPIFY_API_SECRET` / `SHOPIFY_API_SECRET_KEY` | Mismatched from local `.env` | Synced from `.env` |
| `ENCRYPTION_KEY` | Different length/value from local | Synced from `.env` (`wc -c` comparison) |
| `RABBITMQ_URL` | Pointed to deleted CloudAMQP instance (`finwxtrb`) | Updated to new instance (`tbvhyzdu`) |
| `APP_BASE_URL` | Not set | Set to `https://app.lasyncro.com` |

### RabbitMQ / Queue Bootstrap (Critical Fixes)

Several bugs prevented the sync worker from ever running in production:

**I-01: `declareTopology()` missing from `server.ts`**
`server.ts` called `initQueue()` and `startWorkers()` but never `declareTopology()`. The `sync_jobs` queue was never asserted on the broker, so messages published to it were silently dropped.
Fix: Added `await declareTopology()` between `initQueue()` and `startWorkers()` in `server.ts`.

**I-02: `decryptToken()` couldn't handle AES-256-GCM tokens**
OAuth saves tokens using AES-256-GCM (`encryption.service.ts`), but `ShopifyAppService.decryptToken()` only knew CryptoJS legacy format. Webhook registration silently failed.
Fix: Updated `decryptToken()` in `packages/backend-core/src/services/shopify-app.service.ts` to try GCM first, fall back to CryptoJS.

**I-03: `require('crypto')` in ESM module**
The GCM decrypt path used `require('crypto')` inside an ESM module — throws `ReferenceError` at runtime.
Fix: Replaced with top-level `import crypto from 'crypto'`.

**I-04: `waitForConnect()` blocking boot**
`declareTopology()` used `channel.addSetup()` which only runs if a channel is already connected. Since RabbitMQ connects asynchronously, topology was never declared. Added `await channel.waitForConnect()` before `addSetup()`, but this blocked the HTTP server from starting before Fly's health check grace period expired.
Final fix: `initQueue()` now awaits the actual `connect` event (25s timeout) before returning. `app.listen()` moved to run immediately after `initQueue()` while `declareTopology().then(() => startWorkers())` runs async.

**I-05: RabbitMQ `PRECONDITION_FAILED` — queue argument conflicts**
The `events` queue was declared by `queue.topology.ts` with different `x-dead-letter-routing-key` and missing `x-single-active-consumer` vs what `worker.ts` expected. Same issue for `execution.jobs.v1` — topology used `execution.jobs.v1.dlx` as the DLX name but `execution.queue.ts` used `execution.dlx`.

Fixes:

- `apps/backend/src/queue.topology.ts` — aligned `events` queue args with `worker.ts` (added `x-single-active-consumer: true`, fixed routing key to `'dead'`)
- `apps/backend/src/queue.topology.ts` — aligned `execution.jobs.v1` to use `execution.dlx`, correct DLQ args matching `execution.queue.ts`

> **Note:** After changing queue arguments, existing queues on CloudAMQP must be manually deleted via LavinMQ Manager before redeploying, otherwise the broker rejects with `PRECONDITION_FAILED`.

---

## Shopify Billing — Managed Pricing Sync

### Background

The original `/api/v1/shopify-billing/change-plan` endpoint (using `appSubscriptionCreate` directly) was retired June 2026 — Shopify rejects direct Billing API charge creation for apps on Managed Pricing ("Managed Pricing Apps cannot use the Billing API to create charges"). Plan selection now happens entirely on Shopify's hosted pricing page (`https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans`). The retirement left a gap: nothing synced the resulting plan state back into `shop_subscriptions`. Closed this session (SHB-01, SHB-07, SHB-13, SHB-16).

### Current architecture (MON-REM-01B-4, verified 2026-09-14)

- `apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts`
  fetches authoritative Shopify App Pricing state from the Shopify Partner API
  `activeSubscription(appId, shopId)` query, version `2026-07`.
- Required runtime config:
  - `SHOPIFY_PARTNER_ORG_ID`;
  - `SHOPIFY_PARTNER_API_ACCESS_TOKEN`;
  - `SHOPIFY_APP_GID`.
- Merchant identity comes from `shopify_app_installations.shop_gid`
  (`gid://shopify/Shop/...`). The reconciliation path fails closed if that
  value is missing or invalid.
- `applyShopifyBillingState()` remains the one application boundary for
  `shop_subscriptions` and commercial-policy entitlement updates, routing
  through `transitionShopSubscription()`.
- `app_subscriptions/update` may remain registered as legacy/secondary
  infrastructure, but it is not the canonical App Pricing authority.

### Commercial handle mapping

Partner API `activeSubscription.items[]` carries the canonical item handles.
Only recognized commercial handles determine tier:

| Partner item handle | Canonical tier |
|---|---|
| `starter` | starter |
| `early-access` | starter (legacy compatibility) |
| `core` | core |
| `growth` | growth |
| `scale` | scale |

`shipped-order` is a usage item handle only. It must never determine tier.
Unknown or unrecognized commercial state fails closed.

Pricing fields returned by Partner API are provider facts for provenance and
cross-checking. They are not tier authority.

### Billing-return reconciliation

Shopify hosted App Pricing returns merchants to
`/settings/billing?plan_handle=<handle>`. That URL value is expected /
diagnostic state only and must never grant entitlement.

Canonical return flow:

```text
plan_handle return
  -> POST /api/v1/billing/shopify/reconcile
  -> Partner API activeSubscription
  -> applyShopifyBillingState()
  -> shop_subscriptions + entitlements
  -> EntitlementsContext.refresh()
  -> refetch subscription
  -> remove plan_handle from URL
```

Partner API truth wins on mismatch. A Shopify-managed billing trial represented
by Partner `trialEndsAt` is provider billing state and is not copied into local
`shop_subscriptions.trial_ends_at`; a live Partner subscription produces local
`status = active` at the canonical tier.

### Reconciliation durability

The scheduled fallback remains:

```text
runShopifyBillingReconciliationCycle()
  -> applyShopifyBillingState()
```

This is the durability path for Shopify-billed shops if redirect or webhook
activity is missed.

### SHB-16: webhook router shop-resolution bug (systemic, not billing-specific)

`WebhookRouter.dispatch` resolved `shopId` from `shopDomain` into a local variable but never wrote it back onto `envelope.shopId`. Latent since no prior Shopify handler read `envelope.shopId` directly; surfaced by `handleAppSubscriptionUpdate`. Fixed at the router (single point, mirrors ISS-B06 precedent) — `envelope.shopId = resolvedShopId` added immediately after resolution.

### Redirect URLs (Partner Dashboard, per plan)

- Core, Growth, Scale: `/settings/billing` (relative)
- Early-access: `https://app.lasyncro.com` (absolute, saved before the pattern was standardized — locked, cannot be changed retroactively per Shopify's own field constraint)
Both formats confirmed accepted by Shopify. Inconsistency is cosmetic only; billing settings page reconciles live state on load regardless of entry point.

### Live verification (2026-07-18)

A full subscription cycle was tested against dev store `development-store-15820042357` through the real hosted pricing page: Core → Early-access → Core. The `shop_subscriptions` row and `[shopify][app_subscription_update] complete` logs confirmed each transition, including revocation of 8 modules and 5 flags during downgrade. Shopify can deliver a transition as two events with different `eventId` values; the idempotent subscription upsert handles both safely.

### Shopify App Events usage billing — SHB-05-C/D/E/F

> **HISTORICAL / SUPERSEDED by MON-REM-01B.** This subsection records the
> Shopify App Events commercial state verified on 2026-07-18. Its old allowance
> values, Scale-unlimited treatment, hard-cap conclusions, and open-item list
> are retained as evidence and are not current commercial truth.

- `shopify_app_installations.shop_gid` stores Shopify’s canonical merchant GID.
- OAuth captures and validates `gid://shopify/Shop/…` while preserving any previously stored GID when the optional identity lookup fails.
- A real OAuth cycle persisted `gid://shopify/Shop/94567203186`.
- The published billing event handle is `shipped-order`.
- At that verification point, Early-access, Core, and Growth charged `$0.08` for each locally calculated shipped-order overage unit.
- Local included allowances verified at that time were 50, 200, and 1,000 respectively.
- Scale was treated as unlimited and had no shipped-order usage meter at that time.
- Core, Growth, and Scale use a 14-day trial; free Early-access has no trial.
- `shopify.events.service.ts` implements app-level authentication, token caching, tenant-scoped billing context, deterministic idempotency, one authentication retry, explicit operator logs, and non-fatal reporting.
- Client-credentials authentication returned HTTP `200`; unauthenticated event submission returned HTTP `401`.
- Runtime verification against the current Stripe-billed shop correctly skipped reporting with `billing_provider_is_not_shopify`.
- No billable App Event has yet been submitted; HTTP `202` acceptance and the asynchronous billing result remain unverified.

### Historical open items at verification time (superseded)

- **SHB-05-A/B:** connect provider dispatch while preserving the existing Stripe reporter.
- **SHB-05-G:** guarantee an open usage period before Shopify reporting is activated.
- **SHB-05-F deployment:** configure App Events credentials and `shipped-order` in every deployed runtime.
- **SHB-02:** dormant `handleShopifyCallback` still omits `billing_provider`; the retired charge-creation path remains unreachable.
- **AUD-C16:** Shopify extra-seat billing remains a separate unresolved product decision.

At that verification point, Shopify-billed shipped-order enforcement remained hard-cap-only until provider dispatch, open-period handling, deployed secrets, and one controlled billing event were live-verified.

A real OAuth cycle against the development store persisted `gid://shopify/Shop/94567203186`, while the integration completed normally. At that verification point this was foundation only: App Events authentication, event submission, provider dispatch, and environment configuration remained pending under SHB-05-E/A/B/F. Shopify-billed shipped-order enforcement therefore remained hard-cap-only at that stage.

---

## Fly.io Deployment Notes

### Health Check Grace Period

Increased from `10s` to `30s` in `fly.toml` to accommodate RabbitMQ connection time.

### Topology Must Be Idempotent

`declareTopology()` is safe to call on reconnect — all queue/exchange assertions use passive-compatible options. On a fresh CloudAMQP instance, all queues are created automatically on first boot.

### Checking Secrets Match

```bash
fly ssh console --app synchroflow -C "printenv ENCRYPTION_KEY" | wc -c
grep "ENCRYPTION_KEY" .env | awk -F= '{print $2}' | wc -c
# These must match
```

### Verifying RabbitMQ Connection

```bash
fly logs --app synchroflow | grep "Connected to RabbitMQ\|TOPOLOGY\|All queues"
```

### Full Boot Sequence (healthy)

```
[api/queue.ts] Connected to RabbitMQ
[TOPOLOGY] Exchange declared: events.dlx
[TOPOLOGY] Queue declared: events
[TOPOLOGY] Queue declared: sync_jobs
[sync.worker] Sync worker started. Waiting for jobs...
[TOPOLOGY] All queues and exchanges declared
Server is listening on http://0.0.0.0:8080
Health check passing
```

---

## Install Flow Verification

To verify end-to-end install works, watch for this sequence in `fly logs`:

```bash
🔵 Starting OAuth callback for platform: shopify
[SYNC_JOB_ENQUEUED]
[sync.worker] Received sync job for integration ID: N
[SHOPIFY_SYNC_COMPLETED]
[FT0_COMPLETED_EVENT_EMITTED]
[FT2_READINESS_CHECK] { ready: true }
```

### Zero-order install is still a valid install (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, verified 2026-08-27)

The sequence above assumes the store has at least one order (`orders/create` →
first insight → `[FT0_COMPLETED_EVENT_EMITTED]`). A genuinely empty store that
authoritatively completes sync emits no `orders/create` and no
`lifecycle/first_insight_delivered`; instead `updateIntegrationStatus(COMPLETED,
error:null)` emits one `integration/sync_completed`, the ambient projection
worker runs the zero-order lifecycle materializer, and the tenant reaches
**FT1 / readiness** with `ft0_state = COMPLETED`
(`completion_reason {"orders":0,"source":"integration/sync_completed"}`) and a
`system_readiness_state` row — no fake order required, `GET /api/v1/aha/signal`
returns priority 0 ("You're connected — no orders yet."). Explicit FT2
confirmation is still required. Do not read an empty reviewer/dev store that
reached FT1 this way as a broken install. The PCD-restricted fallback path does
**not** emit `integration/sync_completed` and is not an authoritative
completion. Full model: `docs/playbooks/lifecycle_playbook.md` §2b.

### Zero-product / zero-order initial sync is engine-safe (SHOP-REVIEW-ZERO-PRODUCT-SYNC-06, live-verified 2026-08-28)

**Authoritative contract.** A fresh Shopify store may legitimately contain
`products = 0`, `variants = 0`, `orders = 0`, `customers = 0`. That is a valid
authoritative Shopify state. The canonical initial sync
(`apps/backend/src/services/shopify.service.ts::performInitialSync`) must still
walk `PENDING` or `FAILED` → `SYNCING_PRODUCTS` → `SYNCING_ORDERS` →
`COMPLETED`, finishing with `sync_last_error = NULL` and progress `0/0`, and
must emit exactly one `integration/sync_completed`. Zero entities must **not**
cause fake product creation, fake order creation, fake inventory creation, PCD
fallback, a pagination fatal, or an opening-balance crash.

**Defect A — zero-product opening-balance crash.**
`apps/backend/src/services/inventory/seedShopifyOpeningBalances.ts` carried
debug-only diagnostics that dereferenced `response.data.products.edges[0].node`.
On a valid store with zero products `products.edges = []`, so this threw
`Cannot read properties of undefined (reading 'node')` and aborted the sync.
Fix: debug diagnostics removed; the opening-balance seeder is zero-product safe;
an optional Shopify client injection seam was added for deterministic testing.

**Defect B — empty terminal pagination false fatal.**
`apps/backend/src/services/shopify/shopifyPagination.service.ts` treated
`lastCursor = null`, `endCursor = null`, `hasNextPage = false` on the first
empty orders page as a repeated/stuck cursor and raised a fatal. Fix:
stuck-cursor detection now applies only when `lastCursor !== null`; a valid
empty terminal page (`hasNextPage = false`, `endCursor = null`) is accepted.

**Automated verification (complete).** zero-product opening-balance unit
coverage PASS; product-with-`variants.edges = []` defensive coverage PASS;
empty terminal pagination coverage PASS; repeated non-null cursor fatal
regression coverage PASS; disposable-DB zero-product/zero-order initial sync
PASS; disposable-DB retry from `FAILED` through the canonical state machine
PASS; zero-order / lifecycle neighbour regressions PASS; source contract
forbidding numeric first-edge indexing PASS; backend TypeScript PASS; test
ownership `UNOWNED=0` / `MULTI_OWNED=0`.

**Real live provider proof (2026-08-28).** Development store
`third-lasyncro-dev-store.myshopify.com` (`shop_id = 5`, `integration_id = 2`).
Real Shopify OAuth / token exchange had already succeeded with all 10 required
scopes persisted; the original initial sync failed on the zero-product debug
dereference above. After the fix and the canonical recovery-path correction, the
same persisted Shopify installation/token drove one live recovery. Final state —
integration: `sync_status = COMPLETED`, `sync_progress_current = 0`,
`sync_progress_total = 0`, `sync_last_error = NULL`. Entity counts:
`customers = 0`, `external_product_identity_map = 0`, `inventory_movements = 0`,
`inventory_truth = 0`, `orders = 0`, `products = 0`, `variants = 0`. Domain
events: `integration/sync_requested = 1`, `integration/sync_completed = 1`; the
completion event is id `4` with payload `{"integration_id":2}`. Outbox: exactly
one owned completion row, `published_at` populated, `retry_count = 0`,
`last_error` NULL. Projection: `orders_projection` cursor advanced `3 → 4`,
`cursor_caught_up = true`, projection failures `0`. Lifecycle:
`user_lifecycle_snapshot` phase `FT1`, `ft0_state.status = COMPLETED`,
`ft0` `completion_reason {"orders":0,"source":"integration/sync_completed"}`,
`system_readiness_state` materialized. Browser: lifecycle resolved `FT1` and
`/overview` rendered. Lifecycle model: `docs/playbooks/lifecycle_playbook.md`
§2b.

**Separate blocker resolved during live verification.** The first live retry
exposed a distinct wiring defect — `manualSync.controller.ts` imported a
duplicate `backend-core` Shopify sync stub that attempted `FAILED → COMPLETED`
directly. That defect is resolved and live-verified in
`SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07` (next subsection), which is what
allowed this live -06 recovery to exercise the canonical `apps/backend`
`performInitialSync` path.

### Manual Shopify initial-sync recovery is canonically owned (SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07, live-verified 2026-08-28)

**Canonical owner.**
`apps/backend/src/services/shopify.service.ts::performInitialSync` is the single
owner of Shopify initial sync, including manual recovery. `packages/backend-core`
does **not** own Shopify sync and must never be described as owning it.

**Proven defect.** The route itself was correct —
`router.post('/manual-initial-sync', authenticateToken, triggerManualInitialSync)`
— but `apps/backend/src/api/integrations/manualSync.controller.ts` imported
`@lasyncro/backend-core/services/shopify.service.js`, resolving to
`packages/backend-core/src/services/shopify.service.ts`, a separate 71-line
compile-placeholder. That stub queried only Shopify `shop { id }` and then wrote
`sync_status = 'COMPLETED'` / `sync_last_error = NULL` directly. It did **not**
run product sync, order pagination, or opening-balance seeding; did **not**
follow the canonical status progression; did **not** call
`updateIntegrationStatus()`; and did **not** emit `integration/sync_completed`.
On a retry from `FAILED` the DB transition guard correctly rejected the write
with `Illegal sync_status transition: FAILED → COMPLETED`.

**Fix.** `manualSync.controller.ts` now imports `../../services/shopify.service.js`
(the canonical owner). The duplicate
`packages/backend-core/src/services/shopify.service.ts` and its stale committed
build artifacts (`packages/backend-core/dist/services/shopify.service.js`,
`.../shopify.service.d.ts`) were deleted; a backend-core build was run and
confirmed the deleted artifacts are not recreated. Zero source importers of
`@lasyncro/backend-core/services/shopify.service` remain.

**Retry contract unchanged.** The DB transition guard was not weakened. Manual
recovery from `FAILED` walks `FAILED → SYNCING_PRODUCTS → SYNCING_ORDERS →
COMPLETED`. No `FAILED → COMPLETED` edge and no shop-specific bypass was added.

**Completion event contract unchanged.** Terminal state is written by
`updateIntegrationStatus({ status: 'COMPLETED', error: null })`, which atomically
sets the integration terminal state and emits exactly one
`integration/sync_completed`. The controller does not create that event itself.

**Automated verification.** canonical-owner source contract PASS; backend-core
duplicate source absent PASS; backend-core duplicate dist artifacts absent PASS;
backend-core build PASS with deleted artifacts not recreated; no remaining
source importer of the backend-core stub; disposable-DB retry from `FAILED` PASS
with a legal `FAILED → SYNCING_PRODUCTS → SYNCING_ORDERS → COMPLETED`
progression, exactly one `integration/sync_completed`, exactly one owned
completion outbox row, and zero fake product/order/inventory/customer entities;
zero-product initial-sync neighbour PASS; zero-order completion neighbour PASS;
directly-owned `shopify-sync-orchestrator` unit suite PASS; backend TypeScript
PASS; test ownership `UNOWNED=0` / `MULTI_OWNED=0`; route semantics unchanged.

**Live verification (2026-08-28).** Same store as -06 —
`third-lasyncro-dev-store.myshopify.com`, `shop_id = 5`, `integration_id = 2`.
After the first broken manual retry the integration sat at `sync_status =
FAILED`, progress `0/0`, `sync_last_error` containing `Illegal sync_status
transition: FAILED → COMPLETED`, all entity counts zero,
`integration/sync_requested = 1`, `integration/sync_completed = 0`,
`orders_projection` cursor `3`, no lifecycle snapshot / `ft0_state` /
`system_readiness_state`. Runtime wiring before the corrected retry: compiled
`apps/backend/dist/api/integrations/manualSync.controller.js` contained
`../../services/shopify.service.js`; API listening on `:3000` with `/health`
`200`; UI on `:5173`; worker `dist/worker-entry.js` alive. Exactly one corrected
`POST /api/v1/integrations/manual-initial-sync` (`shopId = 5`,
`integrationId = 2`) returned `HTTP 200`
`{"status":"initial_sync_triggered","shopId":5,"integrationId":2}`; the
immediate authenticated status was `sync_status = COMPLETED`, progress `0/0`,
`lastError = null`, all counts zero. Final DB proof: integration `COMPLETED`
with `sync_progress_current = 0`, `sync_progress_total = 0`, `sync_last_error =
NULL`; customers / `external_product_identity_map` / `inventory_movements` /
`inventory_truth` / orders / products / variants all zero;
`integration/sync_requested = 1`, `integration/sync_completed = 1` (completion
event id `4`, payload `{"integration_id":2}`); exactly one completion outbox row
with `published_at` populated, `retry_count = 0`, `last_error` NULL;
`orders_projection` cursor `3 → 4`, `cursor_caught_up = true`, projection
failures `0`; `user_lifecycle_snapshot` phase `FT1`, `ft0_state.status =
COMPLETED`, `completion_reason {"orders":0,"source":"integration/sync_completed"}`,
`system_readiness_state` materialized, browser resolved `FT1` and rendered
`/overview`. This is the same completion event (`id 4`) recorded in the -06 live
proof above — one authoritative recovery, verified from both the empty-store
engine angle and the recovery-path ownership angle.

### Fresh-install Shopify App Store certification passed end-to-end (SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03, 2026-08-28)

**Result: PASS / closed candidate.** The full canonical fresh-install chain is
certified — pristine Shopify dev store → signed App Store install entry →
tenant / bootstrap → real Shopify consent → OAuth callback / token exchange →
effective-scope validation → provider persistence → `sync_requested` → canonical
real-provider initial sync → authoritative zero-product / zero-order completion →
`sync_completed` → FT0 completion / readiness → reviewer-visible Aha state →
explicit confirmation → FT2 / AppLayout. No implementation change was required
during the run. -06 and -07 repaired defects found while certifying earlier
stores; -03 is the final fresh-store proof that the complete path now succeeds
with no recovery.

**Fresh store.** `4th-lasyncro-dev-store.myshopify.com` — Shopify Basic dev
store, test-data generation off, feature preview off, no products or orders
added. Resulting tenant `shop_id = 6` / `user_id = 6`; integration
`integration_id = 3`.

**P0 — pristine baseline.** Before the install entry the target domain had
`shopify_app_installations = 0`, `integrations = 0`,
`integration_oauth_states = 0` — no reused laSyncro provider association.

**P1 — signed install entry.** One signed
`GET /api/v1/integrations/shopify/install` returned `HTTP 302` to
`4th-lasyncro-dev-store.myshopify.com/admin/oauth/authorize` with `client_id`
present, OAuth state length 32, redirect URI
`http://localhost:3000/api/v1/integrations/oauth/callback/shopify`, and exactly
the 10 required scopes (`read_products`, `read_orders`, `read_customers`,
`read_inventory`, `write_inventory`, `read_locations`, `read_fulfillments`,
`write_fulfillments`, `read_merchant_managed_fulfillment_orders`,
`write_merchant_managed_fulfillment_orders`) — scope match true. No redirect was
followed for this shape check.

**P1 bootstrap.** Ghost owner (`role = owner`,
`entry_channel = shopify_app_store`, password-login disabled); exactly one OAuth
state (`platform = shopify`, `install_source = app_store`, length 32, unexpired);
one Main warehouse (`root_location_code = WH-6-ROOT`, one `warehouse_locations`
row, `type = warehouse`, no bins); one `shop_wms_settings` row; subscription
`tier = growth` / `billing_interval = monthly` / `billing_currency = USD` /
`billing_provider = shopify` / `status = trialing`. Before callback:
`oauth_states = 1`, `installations = 0`, `integrations = 0`, `orders = 0`.

**P2 — real consent / callback.** The P1 OAuth state was reused; the install
entry was not re-invoked. The real Shopify "Install app" consent screen showed
the LaSyncro identity, the unreviewed/development-app warning, and the requested
data-access sections. The user clicked Install once; the callback / token
exchange completed and the browser reached the empty-store Aha state.

**P3 — provider persistence.** OAuth state after callback: 0 rows (consumed).
`shopify_app_installations`: exactly 1 — `id = 2`, `shop_id = 6`,
`domain = 4th-lasyncro-dev-store.myshopify.com`,
`shop_gid = gid://shopify/Shop/101756666170`, token persisted encrypted.
Effective persisted scope count 10, matching the 10 required scopes including
`read_locations` — proof the active app version and callback grant contract
include `read_locations`. Integration: `id = 3`, `shop_id = 6`,
`platform = shopify`,
`platform_shop_name = 4th-lasyncro-dev-store.myshopify.com`, encrypted provider
token persisted.

**P4–P6 — real provider initial sync.** Not a synthetic fixture and not manual
recovery — the fresh OAuth callback enqueued the normal initial-sync path. Final
integration: `sync_status = COMPLETED`, `sync_progress_current = 0`,
`sync_progress_total = 0`, `sync_last_error = NULL`. Entity counts all zero
(`customers`, `external_product_identity_map`, `inventory_movements`,
`inventory_truth`, `orders`, `products`, `variants`) — authoritative zero-entity
provider truth; no fake entities created. Domain events for shop 6: event 5
`integration/sync_requested` (`integration_id = 3`), event 6
`integration/sync_completed` (`integration_id = 3`), event 7
`lifecycle/ft2_confirmed` (`user_id = 6`,
`evaluator_version = ft2-evaluator@v1`) — counts `sync_requested = 1`,
`sync_completed = 1`, `ft2_confirmed = 1`. Outbox: one row per event, all
`published_at` populated, `retry_count = 0`, `last_error` NULL. Projection: the
single global `orders_projection` cursor advanced through event 7, event 6 was
caught up, shop-6 projection failures 0. There is no separate
`lifecycle_projection` cursor — the production worker uses the one global
`orders_projection` cursor for these events, and durable FT2 state proves event
7 projected.

**P7 — authoritative zero-order / zero-product.** `ft0_state.status = COMPLETED`,
`completion_reason {"orders":0,"source":"integration/sync_completed"}`,
`system_readiness_state` materialized. Independently confirms the contracts fixed
in SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 (`d4dc236b`) and
SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 (`5087e6bf`): -06 and -07 repaired
defects found while certifying earlier stores, -03 proves the complete canonical
path now succeeds on a fresh store without recovery.

**P8 — reviewer-visible browser path.** Shopify "Install app" → OAuth / callback
→ laSyncro Aha state → explicit CTA → AppLayout. The Aha screen showed
"Connected", "You're connected — no orders yet.", sync status Complete, Products
synced 0, Orders synced 0, and the Unlock Insights CTA. The user clicked the CTA
explicitly; `lifecycle/ft2_confirmed` was then emitted. Final durable lifecycle:
`user_lifecycle_snapshot.phase = FT2`, `ft2_state` present,
`evaluator_version = ft2-evaluator@v1`,
`expansion_eligibility_state.eligible = true`, system readiness present; the
frontend then rendered the normal AppLayout / Overview. FT2 promotion is by
explicit FT1 → FT2 confirmation, never automatic.

**Certification decision.** SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03: **PASS / closed
candidate.** Certified chain: pristine Shopify dev store → signed App Store
install entry → tenant / bootstrap → real Shopify consent → OAuth callback /
token exchange → effective-scope validation → provider persistence →
`sync_requested` → canonical real-provider initial sync → authoritative
zero-product / zero-order completion → `sync_completed` → FT0 completion /
readiness → reviewer-visible Aha state → explicit confirmation → FT2 / AppLayout.

### SHOP-REVIEW-FRESH-INSTALL-GATE-01 — umbrella CLOSED (2026-08-28)

**Final decision: PASS / CLOSED.**

The original A1–A20 fresh-install App Store review matrix has been reconciled
against current HEAD (`8e488b20`), existing automated coverage, the authoritative
playbooks, and the final real Shopify fresh-store certification
(SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03, shop 6). All twenty items are PASS.

| # | Gate | Result |
| --- | --- | --- |
| A1 | Signed/HMAC Shopify install entry | PASS |
| A2 | Tenant + owner bootstrap | PASS |
| A3 | Root warehouse bootstrap | PASS |
| A4 | Zero-bin fresh-install continuity | PASS |
| A5 | Shopify billing/trial bootstrap | PASS |
| A6 | OAuth state creation | PASS |
| A7 | OAuth redirect shape | PASS |
| A8 | OAuth callback / token exchange | PASS |
| A9 | `integrations` persistence | PASS |
| A10 | `shopify_app_installations` persistence | PASS |
| A11 | Required/effective Shopify scopes | PASS |
| A12 | Initial authoritative Shopify sync | PASS |
| A13 | Zero-order / zero-product authoritative completion | PASS |
| A14 | Lifecycle transition from authoritative completion | PASS |
| A15 | Reviewer-visible Aha state | PASS |
| A16 | Explicit FT2 confirmation | PASS |
| A17 | Post-FT2 AppLayout / application access | PASS |
| A18 | Root-only / no-bin WMS usability | PASS |
| A19 | Reviewer path independent of dev seed / synthetic data | PASS |
| A20 | Reinstall / reconnect safety and separation | PASS — one parked non-blocking callback-failure recovery edge |

**Certified reviewer-critical chain.** fresh Shopify Dev store → signed App Store
install entry → tenant / owner / warehouse / trial bootstrap → real Shopify
consent → OAuth callback / token exchange → all 10 required scopes persisted,
including `read_locations` → `integrations` + `shopify_app_installations`
persisted → `integration/sync_requested` → canonical real-provider initial sync →
authoritative zero-product / zero-order completion → `integration/sync_completed`
→ FT0 completion / system readiness → reviewer-visible Aha → explicit Unlock
Insights confirmation → `lifecycle/ft2_confirmed` → FT2 → normal AppLayout /
Overview. This exact chain was executed successfully on
`4th-lasyncro-dev-store.myshopify.com` (`shop_id = 6`, `user_id = 6`,
`integration_id = 3`); full P0–P8 evidence is recorded above under "Fresh-install
Shopify App Store certification passed end-to-end
(SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03, 2026-08-28)".

**Work that collectively closes the umbrella:**

- **SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02** (`1e36879a`) — established authoritative
  zero-order lifecycle semantics.
- **SHOPIFY-SCOPE-ACTIVE-VERSION-04** (`516b6356`) — deployed the correct active
  Shopify scope version, including `read_locations`.
- **SHOP-REVIEW-ZERO-PRODUCT-SYNC-06** (`d4dc236b`) — fixed the empty-store /
  zero-product initial-sync defects (opening-balance crash, empty terminal
  pagination false fatal).
- **SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07** (`5087e6bf`) — restored the
  canonical manual-sync owner/path and removed the duplicate backend-core stub.
- **SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03** (`8e488b20`) — provided the final
  genuinely fresh real-provider end-to-end certification.

**A20 residual edge — SHOP-REVIEW-OAUTH-RETRY-03b (parked, non-blocking).** A20 is
PASS for the umbrella's required safe-separation / reinstall baseline: the
fresh-install (`handleShopifyInstall`, HMAC) and authenticated reconnect
(`initiateOAuth`) paths are distinct and guarded, and a normal reinstall reuses
existing Shopify installation ownership. Residual edge: if a fresh install creates
its local tenant but the OAuth callback never completes, there is no
`shopify_app_installations` row yet, so a later install attempt for that same
domain may not resolve as a reinstall and could create another tenant. Callback-
failure recovery edge only; not exercised by the successful normal reviewer path;
does not block umbrella closure; not fixed here.

**Other parked non-blockers (unchanged — see "Remaining Known Issues
(Non-blocking)"):**

- **FE-SYNC-STATUS-STALE-09** — frontend React Query freshness; the top-right pill
  can transiently show `Syncing` until refetch. Backend and the authenticated
  `GET /api/v1/integrations/sync-status` both report `COMPLETED`; no provider
  failure. Non-blocking.
- **SHOPIFY-SYNC-LAST-SYNCED-AT-08** — `integrations.updated_at` not refreshed at
  completion, so `lastSyncedAt` reads stale while `sync_status = COMPLETED`. Sync
  status remains correct. Non-blocking.
- **SHOP-REVIEW-OAUTH-RETRY-03b** — callback-failure retry edge, described above.
  Non-blocking.
- **SHOP-REVIEW-NONPCD-SYNC-DEADEND-04 remains unopened** — the final fresh-store
  certification completed through the canonical `performInitialSync` and never
  entered the PCD fallback / `DISABLED_ARCHITECTURE_GUARD` path.

**SHOP-REVIEW-FRESH-INSTALL-GATE-01: PASS / CLOSED.** No current OPEN item can
prevent a brand-new Shopify reviewer store from completing Install → OAuth →
provider sync → authoritative zero-product / zero-order completion → Aha →
explicit confirmation → normal app access.

---

## Shopify App Capabilities

LaSyncro selected **"My app doesn't have any of these capabilities"** — it is a pure admin/operations tool with no checkout, embedded, blockchain, or storefront components.

---

## OAuth Redirect URL Whitelist

Both production and local dev URLs must be in the Shopify Partner Dashboard redirect list:

```bash
https://app.lasyncro.com/api/v1/integrations/oauth/callback/shopify
http://localhost:3000/api/v1/integrations/oauth/callback/shopify
```

---

## Shopify OAuth Scope Contract — verified 2026-08-13

The Shopify permission contract is centralized in:

```text
apps/backend/src/services/shopify/shopifyScopes.ts

SHOPIFY_REQUIRED_SCOPES currently requires:

read_products
read_orders
read_customers
read_inventory
write_inventory
read_locations
read_fulfillments
write_fulfillments
read_merchant_managed_fulfillment_orders
write_merchant_managed_fulfillment_orders

Both the authenticated reconnect path and App Store install path use
SHOPIFY_REQUIRED_SCOPE_STRING; do not maintain independent scope arrays in
either controller path.

shopify.app.toml [access_scopes] must represent the same required contract.

The OAuth callback persists Shopify's granted capabilities rather than a
hard-coded approximation. Shopify's token-response scope may be a compact
representation of effective permissions, so LaSyncro normalizes implied read
capabilities before validation and persistence.

Required invariant after OAuth:

shopify_app_installations.scopes
    =
currentAppInstallation.accessScopes

Runtime verification on 2026-08-13 proved (via a Shopify CLI development preview
plus an authenticated RECONNECT OAuth cycle — not the active app-version config
for a fresh merchant install):

persisted scope count = 10
runtime scope count   = 10
persisted == runtime  = yes
read_locations        = yes
write_inventory       = yes

2026-08-28 — SHOPIFY-SCOPE-ACTIVE-VERSION-04:
A real fresh-provider OAuth on a new empty dev store failed closed in the
callback with SHOPIFY_REQUIRED_SCOPES_MISSING:read_locations (no partial
provider state written) — the then-active app version lasyncro-16 still
carried only 9 required scopes. The canonical shopify.app.toml (unchanged)
was deployed as a new version scope-read-locations-1e36879a
(gid://shopify/Version/1106942001153), inspected pre-release, then released.
scope-read-locations-1e36879a is now active; lasyncro-16 is inactive; the
active app configuration contains all 10 required scopes including
read_locations. normalizeAndValidateShopifyGrantedScopes was not weakened.
A successful fresh-provider OAuth was proven on 2026-08-28 by
SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03, run from P0 against a brand-new empty dev
store (`4th-lasyncro-dev-store.myshopify.com`, `shop_id = 6`,
`integration_id = 3`): the real callback persisted all 10 required scopes
including `read_locations` on the new active version. See "Fresh-install Shopify
App Store certification passed end-to-end (SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03,
2026-08-28)" under Install Flow Verification, and
docs/playbooks/oauth_scopes_location_scope_2026_08_13.md section "Active
app-version deployment — 2026-08-28".

read_locations is required for human-readable Shopify Location metadata.
The development-store proof successfully resolved:

gid://shopify/Location/110070792562 -> My Custom Location
gid://shopify/Location/110070759794 -> Shop location

This originally unblocked the permission prerequisite for
SHOPIFY-LOCATION-MAP-01.

**2026-08-21 — INV-SHOPIFY-LOCATION-10 completed and verified against this
development store.**

Warehouse-to-Shopify-Location mapping is now explicit, merchant-controlled,
persisted on `warehouses.external_location_id`, and resolved by internal
warehouse locations through `warehouse_id`.

End-to-end verification mapped `Main warehouse` to
`gid://shopify/Location/110070792562`, read the persisted mapping back through
the API, then cleared it and verified the restored null state.

---

## Remaining Known Issues (Non-blocking)

- Webhook "address already taken" errors on re-install — non-fatal, webhooks already registered
- `[SHOPIFY_WEBHOOK_REGISTRATION_FATAL] APP_BASE_URL missing` — resolved by setting `APP_BASE_URL` secret
- `[INGESTION_STALLED]` watchdog fires after sync on stores with stable order counts — false positive, harmless
- **SHOPIFY-SYNC-LAST-SYNCED-AT-08** — after a successful authoritative completion, `integrations.updated_at` stayed at the original OAuth/sync timestamp, so `GET /integrations/sync-status` reported a stale `lastSyncedAt` even though `sync_status = COMPLETED`. Observed during SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 live verification; separate issue, not addressed here. Backend field-freshness — distinct from the frontend-cache issue FE-SYNC-STATUS-STALE-09 below.
- **FE-SYNC-STATUS-STALE-09 — sync status pill can retain pre-completion React Query state until refetch.** Observed repeatedly in local development: after backend sync had reached `COMPLETED` and authenticated `GET /api/v1/integrations/sync-status` returned `HTTP 200` with `status = COMPLETED`, `integrationId = 3`, progress `0/0`, `percentage = 100`, all counts zero, `lastError = null`, the top-right pill could still show `Syncing` on first entry to AppLayout, flipping to `Live` only after a normal page reload or tab-focus/refetch. Source-level: `IntegrationProvider` queries `integration-status` with no polling/refetch interval; `isSyncComplete` reflects the last React Query result and `TopnavbarContent` renders `Live` only when `isSyncComplete === true`, otherwise `Syncing`; a direct native `fetch` does not update the React Query cache. Non-blocking frontend cache/query-freshness issue — not a backend/provider sync failure, reproduced in development, not proven as a production fresh-install defect (a production screenshot shows the pill/popover can show `Live` correctly, but that is not equivalent fresh-install evidence). Not addressed here.
**SHOP-REV-01f — pack stage unreachable without wms_barcode.**
orders.wms_barcode was written in exactly one place: a closure inside
releasePickBatch (pickBatch.service.ts). Any order reaching pack by another
route — seeded fixtures, or orders predating the WMS rollout — had none, and
GET /wms/orders/:orderId/invoice returned 409 "batch not yet released". Since
the LSO- scan is what advances packing -> packed, those orders could never be
packed at all.

Confirmed on the reviewer tenant 2026-08-03: of 4 batches on shop 1, only the
2 orders in pick_complete carried barcodes. The packing batch's 3 orders had
none, so the reviewer could not complete a pack.

Fixed by extracting the generator to wmsOrderBarcode.service.ts and having the
invoice endpoint mint on demand. The 409 now fires only for genuinely unbatched
orders, where it is correct.

Local verification requires a shopify_app_installations row — see below.

## Reviewer Test Account Setup

App Store reviews don't require a published listing — reviewers install via OAuth directly. But because Scenario B was gated for 2.3.1 compliance (no manual store-domain entry; see below), the manual connect UI is removed. The reviewer therefore needs a **pre-connected account**, not a self-serve flow.

### Account

- **Email:** `contact@lasyncro.com` (inbox-accessible for email verification)
- Registered via normal UI signup → email verified.
- Login is NOT gated on `email_verified_at` (verified in auth.controller.ts).

### Connecting the store (manual, dev-side)

The frontend connect UI is gated, but the backend endpoint `GET /api/v1/integrations/oauth/initiate` is live. With a logged-in bearer token:
\`\`\`bash
curl -G "<https://app.lasyncro.com/api/v1/integrations/oauth/initiate>" \
  --data-urlencode "platform=shopify" \
  --data-urlencode "shop=development-store-15820042357" \
  -H "Authorization: Bearer <TOKEN>"
\`\`\`
Open the returned `authorizationUrl`, approve consent. This is developer-side provisioning, not the merchant-facing manual-entry pattern 2.3.1 prohibits.

### Upgrading to Scale tier (for full-feature review)

App Store installs hardcode `growth` tier. To grant Scale, update subscription + seed entitlements (mirrors handleShopifyCallback):
\`\`\`sql
UPDATE shop_subscriptions SET tier='scale', status='active', trial_ends_at=NULL, updated_at=NOW() WHERE shop_id=<id>;
-- + INSERT scale modules/flags into shop_module_entitlements (see tiers.ts SCALE_MODULES/SCALE_FLAGS)
\`\`\`
Then log out/in to refresh the JWT `tier` claim.
> Entitlements lack a unique constraint — produces source-duplicated rows. Harmless. GitHub issue #1016.

### Partner Dashboard "App testing information"

- Test account: `contact@lasyncro.com` + password
- Testing instructions: log in → lands directly on connected FT2 dashboard (no store-connect step, by design)

### ROUTE-01 closed (verified 2026-07-23)

Shopify sends real App Store install requests as GET to the exact App URL configured in the Partner Dashboard (this app's is the bare root, <https://app.lasyncro.com>) with shop, hmac, and timestamp query params appended, per Shopify's own OAuth documentation. The backend's handleShopifyInstall handler existed and was correctly implemented (HMAC validation, ghost-shop creation, billing_provider stamped at birth per SHB-01/03/04), but was only mounted at /api/v1/integrations/shopify/install. Nothing routed root-path traffic there, so a real install request would have silently fallen through to the SPA and served the login page instead, with the install parameters discarded entirely.

First fix attempt placed the install-detection check inside the app.get(*) catch-all, positioned after app.use(express.static(...)). Deployed cleanly but did not fix the issue — verified via response headers (etag, last-modified) showing express.static intercepts and serves index.html for bare / before any handler registered after it ever runs. Corrected by moving the check to its own app.get('/') handler registered before express.static, calling next() to fall through to normal SPA serving for any request that isn't install-shaped.

Live-verified against production: a request to / with shop and hmac params now reaches handleShopifyInstall and correctly returns 401 for an invalid signature (previously returned 200 with the SPA HTML). Confirmed no regression on /overview, /login, and plain / with no query params, which all still return 200 and serve the SPA correctly.

This closes the last known gap in the real App Store install path — the ghost-shop-creation and billing_provider stamping logic (SHB-01/03/04/18) is now actually reachable by a genuine Shopify-initiated install, not just correct in isolation.

### FE-CHUNK-LOAD-01 — stale hashed asset handling

Production serves the React app through `express.static()` followed by the SPA
`app.get('*')` fallback. A browser tab can retain an older hashed dynamic-import
URL across a deployment. If that old `/assets/*` file no longer exists, it must
not fall through to the SPA fallback and receive `index.html`.

Verified failure shape:
- stale hashed chunk returned `200 text/html`
- current hashed chunk returned `200 application/javascript`
- refreshing the browser fixed the page because the refreshed HTML referenced the current chunk

The SPA fallback therefore explicitly excludes `/assets/*` as well as `/api/*`.
Missing assets now continue to Express's normal `404` handling, while real SPA
deep links such as `/overview` still return `200` with `index.html`.

### Reviewer account — actual state (verified 2026-08-02)

`contact@lasyncro.com` lives on **shop_id 1 ("Shopify's Shop")** — the general
dev tenant — on **Scale** tier. This is the account Shopify reviewers log into.

`apps/backend/src/scripts/seed_reviewer.ts` creates a *different* tenant,
shop_id 8 ("LaSyncro Demo Store"), which has **0 users and is unreachable**.
The script's existing-user check is `SELECT * FROM users WHERE email = ?` with
no `shop_id` filter, so it matched the shop-1 user, skipped the insert, and
left shop 8 with a floor plan and entitlements but nobody who can log in.
The script also provisions Growth, not Scale.

### Activity seed applied to production (2026-08-03)

`seed_reviewer_activity.ts` ran against prod shop 1. Additive, idempotent
(marker `SEED:REVIEWER_ACTIVITY` on `suppliers.notes`), all phases in one
transaction. Result: 3 suppliers, 4 POs, 2 receive jobs, 20 inventory units,
8 stow tasks, 3 pick batches, revenue $4,820 today / $3,960 yesterday.
Prod discovery found 12 variants and 6 pick bins; all five zone types
(pick 6, pack 3, receive 1, ship 1, returns 1) present.

**Deployment status — 2026-08-03.** The local Overview screenshot contains the
committed OV-128/OV-129/OV-131 live-map presentation: the warehouse name is
moved to the slab edge, stow work is shown per bin, receive work is shown at
the dock, and the marker key explains both signals. These commits have not yet
been deployed to Fly.io. Production therefore still shows the older warehouse
label placement and has no stow badges, receive badge, or marker key. This is
an expected deployment gap, not a new production regression.

**Running it against prod.** `database.config.ts` selects its connection by
`NODE_ENV`. The `development` branch reads discrete `PGHOST`/`PGPORT`/`PGUSER`/
`PGPASSWORD`/`PGDATABASE` and **ignores `DATABASE_URL` entirely** — only the
`production` branch uses it. Exporting `DATABASE_URL` therefore does nothing;
export the `PG*` vars instead (dotenv does not overwrite existing env vars):

```bash
    export PGHOST=localhost PGPORT=5434 PGUSER=synchroflow PGDATABASE=synchroflow
    export PGPASSWORD=$(printf '%s' "$PGURL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
    SEED_SHOP_ID=1 npx --yes tsx@4.19.2 apps/backend/src/scripts/seed_reviewer_activity.ts
```

**Two guard lines before trusting the run.** `[DB_IDENTITY]` must show
`database: 'synchroflow'` (local is `synchroflow_db`), and `[ACTIVITY_SEED]
Shop:` must read **Shopify's Shop** (local is "Default Dev Shop"). Ignore the
host/port in `DB_IDENTITY` — `inet_server_addr()` reports Postgres's own 6PN
address (`fdaa:…:5433`), not the proxy endpoint.

**Why the tenant guard is not enough on its own.** The Proxy in
`packages/backend-core/src/db.ts` only asserts that `app.current_tenant` is
*set*, never that it *matches* the shop being written, and auto-bypasses every
single-string raw query. A wrong `SEED_SHOP_ID` passes it. Real isolation comes
from RLS — verified here: seeded rows landed on shop 1 only.

**Data staleness.** `pickerPositions` only includes `pick_scan_log` rows from
the preceding four hours, while idle detection uses the shop's shorter idle
threshold. That divergence is resolved: markers and idle alerts now read the
same source. Presence comes from pick_batches; freshness is graded against
shop_wms_settings.idle_alert_threshold_minutes, the value the idle alert uses.
OV-132 is closed in source.

Do not use `seed_reviewer_activity.ts` as a morning-of-review refresh command.
Its supplier marker makes subsequent runs exit without changing timestamps.
`npm run rebuild` also overwrites the seeded `revenue_projection_daily` rows,
and the marker prevents the seeder from restoring them. A dedicated,
non-destructive reviewer refresh is now a plain UPDATE on pick_batches
(pick_last_activity_at, pack_last_activity_at). Scan logs are append-only —
tgtype 19 triggers reject UPDATE on every column — so no freshness procedure
touching those rows is possible. This constrains the mechanism, not the goal:
OV-153 advances the mutable pick_batches activity clocks instead, which carry
no such trigger. Immutable scan logs are never written by the worker.
may touch them. Two nullable timestamps, no immutable history, no counter drift.

### Canonical outbound reviewer seed — OV-135

**Verified locally on 2026-08-04; pending commit, deployment and production-data reconciliation.**

The reviewer activity seed now selects only constraint-free `pending` or
`processing` orders that are still eligible for the Order Pool. It derives
`total_line_items` and `total_units` from the selected orders instead of
fabricating fixed per-order totals.

A fresh seed creates four mutually exclusive batches:

- `picking`: two orders with partial pick progress
- `pick_complete`: one picked order awaiting packing
- `packing`: one order with partial pack progress
- `pack_complete`: two packed orders awaiting shipment

Every batched order receives a matching `order_warehouse_status` row. Line-item
warehouse states, confirmed pick scans and confirmed pack scans reconcile with
the batch counters. Local verification produced six batched orders, two orders
remaining in the Order Pool, two live operator positions, one unit awaiting
packing and two packed-not-shipped orders.

Production still contains the earlier three-batch seed shape. Deploying the
updated source will not rewrite that data because the supplier marker makes
subsequent runs exit. Production requires a separate, controlled reconciliation;
the activity seeder must not be forced or made destructive.

**Resolved and committed, pending deployment: OV-125 (P1).**
Permanent fix: `4a3ce9eb`.

Production contained 42 orders, of which the six newest unbatched orders had no
`order_line_items`. The committed selector claimed those six orders, but
`pick_scan_log` requires a real `lasyncro_line_item_id`, so the picking and
packing batches produced no usable scan activity.

The permanent fix adds a `whereExists` requirement for `order_line_items`
before an order can be claimed. Local verification produced three batches,
zero invalid claims, three scans for picking, and three scans for packing.
`GET /api/v1/wms/live-activity` returned one picker position and two active
batches; unauthenticated access remained `401`.

Production data was repaired once: both active batches now have three valid
claims and three scan rows. The one-off repair script was not retained in the
repository because its deletion scope was unsafe for reuse. The permanent
seeder fix is the only OV-125 source change.

### Reviewer operator attribution — OV-125a

**Resolved locally, pending commit and deployment.** A single reviewer account
made `GET /api/v1/wms/live-activity` structurally capable of returning only one
picker position because the endpoint selects the latest scan per
`pick_scan_log.scanned_by`.

`seed_reviewer_operators.ts` now creates and reconciles two non-login operator
identities and their active shop memberships. It deliberately does not update
batches or scans: `pick_scan_log` is append-only, and changing historical
operator attribution after insertion is prohibited.

For a fresh reviewer seed, operators must be created before operational
activity:

```ts
    SEED_SHOP_ID=1 \
    EXPECTED_DATABASE_NAME=synchroflow_db \
    EXPECTED_SHOP_NAME='Default Dev Shop' \
    npx --yes tsx@4.19.2 apps/backend/src/scripts/seed_reviewer_operators.ts

    SEED_SHOP_ID=1 \
    npx --yes tsx@4.19.2 apps/backend/src/scripts/seed_reviewer_activity.ts
```

`seed_reviewer_activity.ts` refuses to create activity when either reviewer
operator is missing. It assigns the picking batch to Elin Vargas and the
packing batch to Marcus Boateng when the immutable scan rows are first
inserted. The live-activity query additionally requires
`pick_scan_log.scanned_by = pick_batches.picked_by`, preventing historical
scans belonging to a former picker from remaining visible after reassignment.

Local verification produced two active batches, six correctly attributed scan
rows, zero attribution mismatches, and zero duplicate confirmed batch/line
pairs. The authenticated live-activity endpoint returned two picker positions;
unauthenticated access remained `401`. Because both latest scans were at
`A-1`, the map correctly rendered its co-location badge with a count of `2`.

Do not rerun either script as a freshness mechanism. Both are sequentially
idempotent, and the activity marker intentionally prevents timestamp refresh.
Freshness is no longer a morning-of-review procedure. OV-153 closed it with a
guarded worker; see "Reviewer freshness worker — OV-153" below.

Before deploying the live-activity ownership filter, verify production’s
immutable `scanned_by` values match each active batch’s `picked_by`. Production
database access must use newly rotated credentials; do not reuse previously
exposed credentials.

### Live-map operator clarity — OV-136

**Verified locally on 2026-08-04; pending commit, deployment and production verification.**

The Overview live map now renders active operators as semantic pills rather than ambiguous numeric circles. Each marker shows a person glyph, operator count, and separate blue picking or orange packing indicators. The marker key reports the floor-wide operator total and phase breakdown.

Picking operators remain at their latest confirmed physical pick-scan location. Packing operators anchor to the first active pack zone ordered by `location_code`; `pack_scan_log` is no longer joined (OV-132) since it records no station and identity lives on the batch. Exact attribution across multiple pack stations remains a data-model requirement — prod has three (PACK-01/02/03), so every packer stacks on PACK-01 there (OV-146).

### Reviewer freshness worker — OV-153 (verified in production 2026-08-05, v260)

Seeded reviewer data is static by construction. A one-shot `UPDATE` was observed
decaying past the 20-minute threshold within ~103 minutes, so a reviewer landing
at an unknown hour saw an idle floor. `apps/backend/src/workers/reviewer-activity-refresh.worker.ts`
runs every 600s in-process (`server.ts:34` → `bootstrap/workers.ts:311`), advancing
`pick_last_activity_at` on `picking` and `pack_last_activity_at` on `packing`
batches only. It fires once immediately on boot, so a restart clears amber markers
within seconds rather than ten minutes.

**The code shipping is not the feature working.** `.env` is gitignored, so the
worker is inert unless the two variables exist on Fly. Set both in one invocation
— `ENABLED` alone hits the invalid-shop-id branch and the worker logs an error
and does nothing:

```zsh
flyctl secrets set REVIEWER_ACTIVITY_REFRESH_ENABLED=true REVIEWER_ACTIVITY_REFRESH_SHOP_ID=1 -a synchroflow
```

Three guards must all hold on the target tenant or the worker returns zero:
a `suppliers.notes LIKE 'SEED:REVIEWER_ACTIVITY%'` marker, both canonical
operators (`elin.vargas@lasyncro.internal`, `marcus.boateng@lasyncro.internal`),
and active batches attributing those ids via `picked_by` / `packed_by` /
`assigned_packer_id`. Verified on prod shop 1: 3 markers, users 11 and 12,
batches `8bea7259` (picking, picked_by 11) and `8f404c77` (packing, 12/12).

Verify from a separate connection — an in-transaction SELECT proves nothing:

```zsh
PGOPTIONS="-c app.current_tenant=1" psql "$PGURL" -c "SELECT pick_batch_id, status, EXTRACT(EPOCH FROM (NOW() - COALESCE(pack_last_activity_at, pick_last_activity_at)))::int AS age_s FROM pick_batches WHERE shop_id=1 ORDER BY status"
```

Active batches under ~600s; `pick_complete` / `pack_complete` rows must be
unchanged. Never enable this against a real merchant tenant — it would falsify
genuine operator inactivity.

### Reviewer outbound lane — OV-158 (verified in production 2026-08-05)

`seed_reviewer_activity.ts` writes `order_warehouse_status`, but on production
its batch block never ran: `unbatched` came up short of `requiredOrderCount`,
the WARNING fired, every batch and every `ows` insert was skipped — and the
supplier marker was written anyway, so re-running is a no-op. Four batches
exist there with eleven orders and zero `ows` rows. The two rows that do exist
came from earlier repair scripts, not from that seeder.

Do not try to make that script re-runnable. Every phase below its marker guard
assumes a fresh tenant and `suppliers_shop_name_unique` fires on re-entry.
`seed_reviewer_outbound.ts` is a separate additive script, following the same
pattern as `seed_reviewer_operators.ts` and `repair_reviewer_pick_scans.ts`.

Run it with a proxy open and identity confirmed first:

```zsh
PGOPTIONS="-c app.current_tenant=1" psql "$PGURL" -c "SELECT current_database(), (SELECT name FROM shops WHERE id=1) AS shop"
SEED_SHOP_ID=1 npx --yes tsx@4.19.2 apps/backend/src/scripts/seed_reviewer_outbound.ts
```

It seeds one packed-not-shipped order and one shipped-today order, each on its
own `pack_complete` batch. It is idempotent without a marker — `pick_batches`
has no `notes` column, so the guard is the data itself: it bails if any order
on the shop already carries `shipped_at`. `pick_batch_orders` is UNIQUE on
`lasyncro_order_id`, so a double-claim fails loudly rather than duplicating.

Insufficient order supply is a hard failure, not a warning. That distinction is
the whole point: the silent skip on that exact condition is what left
production with no outbound rows for weeks.

**`pick_batch_status` has no `shipped` value, and that is correct.** A batch is
done when its orders are packed; shipping is an order-level fact on
`order_warehouse_status.shipped_at`, because orders leave the building
individually across several carrier pickups.

Note that this seed permanently consumes eligible orders — `pick_batch_orders`
UNIQUE means an order belongs to exactly one batch forever. On production it
took the Order Pool apron from 2 to 0 (OV-160).

### Gotchas that cost time

**Seed scripts ignore exported `PG*` vars.** `seed_reviewer_outbound.ts`
reported `[DB_IDENTITY] { database: 'synchroflow', host: 'fdaa:…', port: 5433 }`
— it resolved `DATABASE_URL` and connected over Fly's private network, not the
proxy. Right database, wrong assumption about the control. Always read the
`[DB_IDENTITY]` line before trusting which database a seed reached.

**`docker exec` without `-i` silently discards a heredoc.** No output, no
error. Use `docker exec -i synchroflow_db psql …`.

**`tsc` cannot see the database.** Two runtime failures in one session passed
type-checking cleanly: a `varchar = uuid` comparison with no Postgres operator,
and an insert naming a `pick_batches.notes` column that does not exist. Read
`information_schema.columns` and `pg_enum` before writing an insert.

Local verification returned the picker at `A-1` and the packer at `PACK-1`. `GET /api/v1/wms/live-activity` returned `200`, `GET /api/v1/wms/order-pool` remained `200` with two ready orders, and unauthenticated live-activity access remained `401`.

## REV-HARD-05 — Fresh-install order eligibility / inventory constraint hardening

Status: CLOSED — IMPLEMENTATION VERIFIED
Commit status: NOT YET COMMITTED
Deployment status: NOT YET DEPLOYED

### Reviewer-facing risk

A fresh-install tenant could expose orders as releasable even when no pickable
inventory existed.

Before remediation:

- the Order Pool could contain orders with no usable stock;
- `POST /api/v1/wms/batch/release` could reach the reservation layer;
- batch reservation would then throw an insufficient-inventory error;
- the primary reviewer-facing Release Orders workflow could therefore fail.

The intended architecture is:

constraint evaluation
→ order_constraints projection
→ blocked orders excluded from Order Pool
→ only eligible orders reach batch reservation.

Batch reservation remains the race-condition/backstop layer and must not be the
first place ordinary inventory shortages are discovered.

### Root cause 1 — pending fulfillment updates consumed all demand

`orders/fulfilled` and `orders/fulfillment_updated` both route through the
orders fulfillment projection handler.

The handler correctly distinguishes a genuinely fulfilled state with
`isFulfilled`, but it previously updated every order revenue unit to:

    fulfilled_quantity = quantity

for every fulfillment update, including `pending`, `processing`, and partial
states.

This reduced remaining demand to zero and caused the inventory constraint
evaluator to resolve the inventory shortage incorrectly.

### Fix 1

File:

    apps/backend/src/projection/handlers/orders.fulfilled.ts

Revenue units are now marked fully fulfilled only when the normalized
fulfillment state is genuinely `fulfilled`.

Pending/processing/partial updates preserve remaining demand.

This preserves:

    remaining_quantity = quantity - fulfilled_quantity

for orders that have not actually been fulfilled.

### Root cause 2 — development QA orders bypassed the canonical event pipeline

The original three QA orders were inserted directly into projection tables by
`dev_seed.ts`.

`dev:full-seed` subsequently runs rebuild-from-events, which reconstructs
projection state from `domain_events`.

The direct seed therefore did not represent a real Shopify ingestion path and
could leave orders without canonical revenue-unit / constraint state after a
rebuild.

### Fix 2

File:

    apps/backend/seeds/dev_seed.ts

QA orders 800001, 800002, and 800003 are now seeded through canonical domain
events:

- orders/paid
- orders/sync
- orders/fulfillment_updated

The QA product and variant identity rows now use full Shopify GIDs.

Each QA order has:

- quantity = 1
- pending fulfillment
- zero pickable inventory
- complete shipping address
- no unrelated customer-address blocker

The complete address intentionally isolates the scenario to the inventory
constraint.

### Root cause 3 — reconciliation checkpoint conflicted with stale-decision reuse

Reconciliation intentionally reuses equivalent pending decisions from an older
aggregate version when the active constraint-action set has not changed.

However, `writeReconciliationCheckpoint()` previously required a decision
whose `aggregate_version` exactly matched the version being checkpointed.

Example observed failure:

- order aggregate version: 4
- existing equivalent pending decisions: version 1
- reconciliation correctly reused those pending decisions
- checkpoint searched only for a version-4 decision
- worker crashed with:

    [CHECKPOINT_BLOCKED] Missing decision ...

This created a contradiction between two existing invariants:

1. suppress duplicate equivalent pending decisions;
2. require decision evidence before advancing the reconciliation checkpoint.

### Fix 3

Files:

    apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
    apps/backend/src/workers/reconciliation/reconciliationCheckpointWriter.ts

The reconciliation handler now passes the exact decision IDs it has already
validated/reused to the checkpoint writer.

The checkpoint writer still prefers an exact-version decision.

When no exact-version decision exists, it accepts only the explicitly supplied
reused decision IDs after verifying that:

- they belong to the same order;
- they still exist;
- they are still pending;
- every supplied ID is present.

The checkpoint therefore cannot advance without decision evidence, while
equivalent pending decisions do not need to be duplicated solely because the
order aggregate version advanced.

### Final verification

Fresh full-seed: PASS
Development runtime startup: PASS
Projection worker crash: NOT REPRODUCED after fix

QA orders 800001–800003:

- fulfillment status: pending
- quantity: 1
- fulfilled_quantity: 0
- remaining_quantity: 1
- complete shipping address: PASS
- active customer constraint: none
- active inventory constraint: inventory / oversell
- pickable_available: 0

Order Pool before release:

- HTTP: 200
- ready_for_release_count: 8
- blocked_count: 3
- QA 800001–800003 absent from ready orders

Batch release:

- HTTP: 201
- released order_count: 8
- skipped_orders: []
- total_line_items: 8
- total_units: 12

Order Pool after release:

- HTTP: 200
- ready_for_release_count: 0
- in_batch_order_count: 8
- active_batch_count: 1
- blocked_count: 3
- empty_reason: ALL_ELIGIBLE_ORDERS_ALREADY_BATCHED

Reconciliation recovery verification:

- all three QA orders entered stale-decision reuse
- inventory constraint remained active
- checkpoint committed aggregate version 4
- no CHECKPOINT_BLOCKED
- no projection-db-worker FATAL crash

### Architectural invariant after REV-HARD-05

A normal inventory shortage must be detected by the constraint system before
the order reaches batch release.

The eligibility and reservation definitions of pickable inventory must remain
aligned:

    inventory_truth.available_quantity > 0

at an active warehouse location where:

    (warehouse_locations.zone_type = 'pick'
     AND warehouse_locations.type = 'bin')
    OR warehouse_locations.type = 'warehouse'

### INV-BLOCK-19 amendment (2026-08-10)

The original rule read `type IN ('bin', 'warehouse')` and ignored
`zone_type` entirely. Every staging and exception zone — receive, returns,
pack, ship, kitting, problem, quarantine — is `type = 'bin'`, so all of
them counted as sellable stock. Pickable stock is real sellable stock held either in an active pick bin
or at the warehouse root. Staging and exception zones remain excluded.
`type = 'bin'` is required alongside `zone_type = 'pick'` because pick
LANES are frame geometry, not storage.

FRESH-INSTALL / STOW INVARIANT (Shopify ref 102766):
a tenant may begin with all synced stock at its warehouse root and zero
bins. Warehouse-root stock remains pickable after the first empty pick bin
is created and during partial stow. Stowed bin stock is preferred during
reservation, but root stock remains valid availability until physically
moved. Unstowed root stock should also surface as stow work in the UI;
stow-task visibility must never create fake inventory unavailability.

The constraint evaluator, release-time availability pre-check, and batch
reservation all call the shared helper in
apps/backend/src/services/inventory/pickableLocation.ts. Do not re-inline
the predicate. The shared predicate keeps the definition aligned; release-time
re-evaluation keeps eligibility and reservation aligned in time.

Verified 2026-08-10 on both branches:
  shop 1 (12 pick bins) — 3 blocked / 8 eligible, unchanged from baseline
  shop 2 (0 pick bins, 125 units at WH-2-ROOT, 9 units real demand)
    — 0 active inventory constraints, 5 eligible

Batch reservation remains a transactional/race-condition backstop.

### Deployment prerequisites

Root cause 1 was diagnosed and verified against a rebuilt local seed only. Two
things must happen before this ships, not after:

1. Confirm the defect in production. Query shop 1 for orders in pending/
   processing whose revenue units already claim full fulfilment. If no such
   rows exist, the production failure has a different cause and this issue's
   scope must be reassessed before deploying.

2. Decide on backfill. The handler fix changes future writes only. Orders
   already carrying fulfilled_quantity = quantity will remain wrong after
   deploy and will continue to bypass the inventory constraint. Either
   `npm run rebuild` or a targeted backfill is required; establish which
   before the deploy window.

### Explicitly outside REV-HARD-05

The following observations were not folded into this issue:

- duplicate Blocked Orders cards in the UI;
- repeated EXECUTION_DISPATCH_SKIPPED_MANUAL logs;
- repeated SNAPSHOT_WORKER_DISABLED logs;
- repeated projection diagnostic logs;
- development Redis permission-cache fallback warnings;
- REV-HARD-03c reservation race/backstop work;
- printer/QZ fresh-install behavior.

These require separate audits before implementation.

## REV-HARD-06

Worker log spam / repeated stable-state polling
Status: OPEN
Phase: AUDIT NOT STARTED

## REV-HARD-07 — Partial fulfilment quantity derivation

Status: OPEN — AUDIT NOT STARTED

REV-HARD-05 stopped pending/processing updates from consuming all demand. It
did not derive line-level quantities for genuine partial fulfilments, which now
report remaining_quantity equal to full quantity. Reviewer-safe, since it
blocks rather than over-releases, but operationally wrong: units already
shipped can be re-released. Needs its own audit.

---

## SHOPIFY-CANON-REST-01 — REST order webhook canonicalization

**Date:** August 7, 2026
**Status:** CLOSED — mapper fix deployed and production-verified; historical remediation tracked separately in SHOPIFY-CANON-REST-02
**Severity:** P1

### Context

This issue was discovered during post-recovery production verification of Shopify order `#1192` (`17041162174834`).

The operational Shopify webhook subscriptions had already been restored, and both relevant webhook deliveries succeeded:

- `orders/paid` — processed
- `orders/create` — processed

This issue is therefore distinct from webhook-registration drift. Shopify successfully delivered the order data to LaSyncro.

### Production evidence

For Shopify order `#1192`:

- `integration_webhook_events` retained the full Shopify payload.
- `domain_events` `orders/create` event `546` retained:
  - a populated REST `shipping_address`;
  - one REST `line_items` entry;
  - SKU `sku-managed-1`;
  - quantity `3`;
  - Shopify variant `60837615501682`.
- The projected `orders` row had all `shipping_*` fields set to `NULL`.
- No `order_line_items` rows were materialized.
- `orderConstraintProjection` consequently created an active:
  - `constraint_type = customer`
  - `block_type = incomplete_address`
- The order was correctly excluded from the Order Pool because an active constraint existed.

The Release CTA was not defective in this scenario. The order was legitimately excluded based on the incorrectly projected state.

### Root cause

`projection.engine.ts` canonicalizes full `orders/create` events through:

`apps/backend/src/services/mappers/shopify-to-canonical-order.ts`

The mapper supported GraphQL order structures:

- `shippingAddress`
- `lineItems.edges`

but did not normalize the equivalent REST webhook structures:

- `shipping_address`
- `line_items`

Shopify `orders/create` webhooks use the REST-shaped fields, so the mapper converted valid incoming data into:

- `shippingAddress = null`
- `lineItems = []`

The downstream `orders.create` projection then operated on that incomplete canonical payload.

### Implementation

`shopify-to-canonical-order.ts` now normalizes both Shopify payload shapes before constructing the canonical order.

Shipping address accepts:

- GraphQL `shippingAddress`
- REST `shipping_address`

Line items accept:

- GraphQL `lineItems.edges`
- GraphQL-style line-item arrays where present
- REST `line_items`

REST line-item identity and pricing fields are mapped without fabricating values:

- `product_id` / GraphQL product identity
- `variant_id` / GraphQL variant identity
- `price` / GraphQL unit-price sets
- reported line totals when present

The existing canonical contract remains unchanged.

### Regression coverage

Added:

`apps/backend/scripts/shopify-canonical-rest.test.mjs`

Added package script:

`test:shopify-canonical-rest`

Focused verification:

```text
tests 2
pass 2
fail 0
```

Coverage proves:

1. REST `orders/create` payloads preserve shipping address and line items.
2. Existing GraphQL order mapping remains functional.

The final backend build also passed after the mapper correction.

### Production deployment and verification

The mapper correction was committed as:

`5c967eebdd22fd48d9a6a39ca2b470761c35df4a`
`fix: preserve Shopify REST order fields in canonical mapping`

The commit was pushed to `main` and deployed through Fly Deploy `#1043`.
The deployment completed successfully and the production machine returned healthy.

A fresh post-fix Shopify order subsequently confirmed that current REST-shaped
order ingestion materializes line-item demand correctly. The fresh order used
for lifecycle verification was Shopify order `17042035933554`, internal order
`6eb76b1c-afb9-ecdc-9dff-b36d9b311a12`.

That order:

- materialized one canonical line item;
- retained quantity `1`;
- moved through the supported shipping-address correction lifecycle;
- resolved its `incomplete_address` constraint through a normal domain event;
- entered the Order Pool as Ready;
- remained unbatched during canonical-remediation work.

The historical order `#1192` was intentionally NOT repaired as part of
SHOPIFY-CANON-REST-01.

Deploying the mapper fixes future canonicalization but does not reconstruct
line items already lost by older projections. Historical remediation therefore
became a separate issue: SHOPIFY-CANON-REST-02.

No manual projected-order edit, constraint edit, inventory edit, batch edit, or
Release CTA mutation was used to simulate success.

---

## SHOPIFY-CANON-REST-02 — Historical REST canonical drift repair

**Date:** August 8, 2026
**Status:** IMPLEMENTATION COMPLETE — LOCAL VERIFICATION PASS
**Deployment status:** NOT YET DEPLOYED
**Production repair status:** NOT RUN
**Severity:** P1

### Purpose

SHOPIFY-CANON-REST-01 corrected future REST order canonicalization.

SHOPIFY-CANON-REST-02 addresses orders that were successfully received from
Shopify before that fix but were already persisted with incomplete canonical
state.

The repair must restore retained Shopify source truth without:

- fabricating address data;
- duplicating line-item demand;
- overwriting later operator corrections;
- changing today's physical inventory merely because an old sale is being
  reconstructed;
- releasing or batching an order as a side effect of the repair;
- manually resolving constraints outside the normal projection pipeline.

### Historical blast-radius audit

A production read-only comparison was run between retained Shopify
`orders/create` domain-event payloads and current projected order state.

Result:

```json
{
  "total_mismatched_orders": 7,
  "shipping_address_loss": 1,
  "line_item_loss_or_mismatch": 7,
  "both_shipping_and_line_items": 1
}

Affected source events:

domain event	Shopify order	source address	source demand	persisted demand
191	16942725759346	incomplete	1 line / qty 1	0 lines
202	16942964539762	missing	1 line / qty 1	0 lines
205	16942808629618	incomplete	1 line / qty 1	0 lines
213	16942811840882	incomplete	2 lines / qty 2	0 lines
221	16953881428338	missing	2 lines / qty 2	0 lines
228	16954223722866	missing	2 lines / qty 2	0 lines
546	17041162174834 (#1192)	complete	1 line / qty 3	0 lines

Six affected orders therefore have genuine source-side address deficiencies.
Those address constraints must remain valid after canonical repair.

Only event 546 / order #1192 lost a complete source shipping address in
addition to losing its line-item demand.

All seven orders have missing canonical demand and therefore require repair
before any address-only correction can safely make them eligible for normal
order flow.

Why normal event replay is insufficient

The existing orders/create projection path handles an already-existing order
differently from a new order.

For an existing order it can update shipping fields, but line-item insertion is
performed only during new-order materialization.

orders/sync routes through the same handler.

Therefore:

replay old orders/create
    → shipping may change
    → missing order_line_items remain missing

A normal Shopify order sync has the same limitation.

A full derived-state rebuild is also not the appropriate repair mechanism
because the canonical orders / historical order identity already exists and
the existing-order projection path still does not recreate absent line items.

Directly replaying historical events or manually clearing constraints would
therefore leave incomplete demand state and is prohibited for this repair.

Repair architecture

Added:

apps/backend/src/services/shopify/historicalCanonicalRepair.service.ts
apps/backend/src/scripts/repair-shopify-rest-canonical-drift.ts
apps/backend/src/projection/handlers/orders.canonical_data_repaired.ts
apps/backend/scripts/shopify-canonical-rest-repair.test.mjs
apps/backend/scripts/shopify-canonical-rest-repair-writer.verify.mjs

Updated:

apps/backend/src/projection/projection.registry.ts
apps/backend/src/projection/projection.engine.ts
apps/backend/package.json

The implementation separates planning from mutation.

Dry-run planning:

retained orders/create event
    → current mapper
    → source canonical state
    → persisted canonical state
    → repair candidate
    → safety blockers / repairable result

Apply:

re-plan inside tenant transaction
    → validate exact requested source events
    → restore missing canonical lines
    → restore source shipping only where safe
    → materialize revenue units
    → preserve current physical inventory
    → verify ledger/truth invariant
    → increment aggregate version
    → append orders/canonical_data_repaired
    → COMMIT

The repair does not invoke projection directly.

After commit, the authoritative DB projection worker consumes
orders/canonical_data_repaired in normal global domain-event order and runs
the standard order orchestration:

age
→ constraint evaluation
→ constraint projection
→ risk projection
→ margin / revenue projections
→ snapshot scheduling

The CLI must not call processDomainEvent() directly because the DB-driven
projection worker owns cursor ordering.

Fail-closed planning invariants

A candidate is blocked instead of guessed when any required invariant cannot
be proven.

Current guards include:

MISSING_ORDER_IDENTITY
MISSING_ORDER
PARTIAL_LINE_ITEM_STATE
EXISTING_REVENUE_UNITS
ORDER_ALREADY_BATCHED
DIVERGENT_STORED_SHIPPING_STATE
DUPLICATE_SOURCE_VARIANT:<variant>
INVENTORY_TRUTH_LEDGER_MISMATCH:<variant>
missing Shopify variant identity
missing sovereign variant
invalid quantity
invalid unit price

DIVERGENT_STORED_SHIPPING_STATE is especially important: retained historical
Shopify source must never overwrite a different non-empty shipping address,
because that address may have been corrected later by an operator.

Multiple source lines resolving to one sovereign variant also fail closed.
The current revenue-unit model aggregates identity by (order, variant), so
silently collapsing ambiguous line-level history would be unsafe.

Shipping-address rule

Shipping fields are restored only from retained source data.

The repair does not synthesize missing address fields.

Therefore:

event 546 / #1192 can have its retained complete source address restored;
genuinely partial historical addresses remain partial;
source orders with no address remain without an address;
later non-empty divergent persisted addresses are never overwritten.

Constraint evaluation happens only after canonical demand is complete.

Historical demand and inventory neutrality

Restoring missing order_line_items causes the standard revenue-unit writer to
materialize the economic sale that should have existed historically.

That writer also creates the corresponding historical inventory sale
movement.

However, Shopify inventory reconciliation had already established later
physical inventory state. Simply inserting an old sale now would subtract the
historical quantity from today's stock a second time.

The repair therefore writes an equal and opposite, explicitly auditable
reconciliation_correction at the same root location and historical movement
time:

historical sale                  -Q
canonical repair correction      +Q
                                ---
physical inventory net            0

This preserves economic attribution while preventing historical reconstruction
from silently changing current physical stock.

Before repair, the planner requires current root inventory_truth to agree
with the append-only movement ledger for every affected variant.

After the sale + correction pair is inserted, that invariant is checked again.

If ledger and truth disagree either before or after repair, the transaction
fails.

inventory_truth is not rebuilt by this repair.

Idempotency and atomicity

Canonical line-item IDs are generated with the same deterministic identity
formula used by normal orders/create ingestion.

Revenue-unit and inventory movement identities are deterministic.

The repair domain event uses the deterministic external event identity:

canonical_data_repair:<source_domain_event_id>

The entire repair executes inside one tenant-scoped transaction.

Any failure rolls back:

order line inserts
order shipping update
aggregate-version increment
revenue-unit materialization
sale movements
neutrality corrections
repair domain event

Once an order is canonical, a second invocation reports it as already clean
instead of writing duplicate state.

Apply-mode operator gates

Dry-run remains the default:

npm run repair:shopify-canonical-drift \
  -w apps/backend \
  -- \
  --shop-id=<shop_id>

Mutation requires all three explicit inputs:

--apply
--domain-event-ids=<exact audited source event ids>
--confirm=SHOPIFY-CANON-REST-02

There is intentionally no "repair all candidates" apply mode.

--apply without explicit event IDs fails with:

[SHOPIFY_CANONICAL_REPAIR_APPLY_REQUIRES_DOMAIN_EVENT_IDS]

Providing event IDs without the issue-specific confirmation token fails with:

[SHOPIFY_CANONICAL_REPAIR_APPLY_CONFIRMATION_REQUIRED]

The actual apply command shape is:

npm run repair:shopify-canonical-drift \
  -w apps/backend \
  -- \
  --shop-id=<shop_id> \
  --apply \
  --domain-event-ids=<ids from the immediately preceding production dry-run> \
  --confirm=SHOPIFY-CANON-REST-02

Never copy historical event IDs from this document directly into an apply
command.

A fresh production dry-run must establish the current candidate set immediately
before any approved production mutation.

Regression verification

Focused planner regression suite:

tests 12
pass 12
fail 0

Covered behavior:

complete source address restoration
partial source address preservation
missing line-item demand detection
already-canonical no-op
partial persisted line state fail-closed
existing revenue units fail-closed
existing batch membership fail-closed
unresolved variant identity fail-closed
natural planner idempotency
divergent stored shipping fail-closed
duplicate source variant fail-closed
inventory truth / ledger mismatch fail-closed
Real PostgreSQL writer verification

The writer was also exercised against the real local PostgreSQL schema using
synthetic product, variant, Shopify identity and order fixtures.

All fixture state ran inside rollback-only transactions.

Final result:

WRITER_SUCCESS_PATH=PASS
SUCCESS_FIXTURE_ROLLBACK=PASS
WRITER_ATOMIC_ROLLBACK=PASS
FAILURE_FIXTURE_ROLLBACK=PASS
SYNTHETIC_CATALOG_ROLLBACK=PASS
SHOPIFY_CANONICAL_REPAIR_WRITER_VERIFY=PASS

The success-path verification proved:

canonical line restored
shipping restored
revenue unit created
sale movement created
equal repair correction created
inventory truth unchanged
ledger net unchanged
repair event created
second apply becomes alreadyClean

The atomic-failure verification deliberately pre-created the final repair
event's unique external identity so the repair failed with PostgreSQL 23505
at the last write.

That proved all earlier canonical, revenue and inventory writes roll back
together rather than leaving a partially repaired order.

The outer synthetic product and variant were then rolled back and independently
verified absent.

Current production state

At documentation time:

SHOPIFY-CANON-REST-02 implementation: COMPLETE
planner regression: PASS 12/12
real PostgreSQL writer verification: PASS
apply fail-closed gates: PASS
production deployment: NOT RUN
production repair dry-run of this implementation: NOT RUN
production apply: NOT RUN

The historical production records have therefore not yet been changed by this
implementation.

Order #1192 remains a historical-remediation target until the repair is
deployed, dry-run against current production state, explicitly approved for
mutation, applied, and independently verified.

The six orders with genuinely missing or incomplete Shopify source addresses
must remain address-blocked after canonical line-item repair.

#1192 must not be assumed Ready after repair. Its managed variant inventory
must be evaluated from current state by the normal constraint pipeline.

Production remediation procedure

After this implementation is committed and deployed:

1. Run the repair CLI in dry-run mode against production.
2. Compare the complete candidate set and blockers with the audited historical
   evidence.
3. Stop if the candidate set, source event IDs, shipping classification,
   inventory-neutrality checks, or batch/revenue state differs.
4. Obtain explicit approval for the production mutation.
5. Run apply using only the event IDs returned by the fresh dry-run and the
   SHOPIFY-CANON-REST-02 confirmation token.
6. Allow the DB projection worker to consume the appended repair events.
7. Verify canonical lines, shipping fields, revenue units, sale/correction
   pairs, aggregate versions, constraints, risk state and projection cursor.
8. Verify current physical inventory did not change as a consequence of the
   historical reconstruction.
9. Rerun dry-run; repaired events must no longer appear as candidates.
10. Only after canonical remediation is accepted should reviewer Release CTA
    verification continue on an appropriate unbatched Ready order.

Do not manually:

replay event 546
edit order_line_items
clear incomplete_address constraints
edit inventory_truth
rewrite inventory_movements
alter pick_batch_orders
release #1192 to prove the repair

Those actions bypass or distort the canonical repair invariants.

Detailed contract and runtime proof:

docs/playbooks/oauth_scopes_location_scope_2026_08_13.md
## INV-SALE-DOUBLE-02 — inventory_truth double-debit residue (CLOSED 2026-08-17)

**Defect.** Before `94043427` (`fix(shopify): make inventory webhooks observation-only`,
2026-08-13), `inventory_levels/update` wrote a `reconciliation_correction` movement that
mirrored the `sale` movement Shopify had just reported. Incremental writers then debited
`on_hand_quantity` for BOTH. `rebuildInventoryProjection` counts only one — economic `sale`
is excluded from physical reconstruction unless `triggered_by='pick_scan'`. Result:
`inventory_truth` drifted below the canonical ledger.

**Scope.** Shop 1 only, 8 of 33 rows, every diff positive (truth undercounting).
17 `reference_type='inventory_levels_update'` movement rows, last written
2026-08-13 10:01:22 UTC — approx 3.4h before the fix deployed. No other tenant affected.

**Repair.** Targeted UPDATE of `inventory_truth` using the exact CASE expression from
`rebuildInventoryProjection.ts`. `inventory_movements` NOT touched — the ledger was correct.
`reserved_quantity` NOT touched — dry-run proved zero reservation drift.
`available_quantity = GREATEST(0, on_hand - reserved)` per PROJ-004.
`sellable_quantity` never written (generated column).
Backup: `inventory_truth_backup_inv_sale_double_02` (33 rows).

**Why not `npm run rebuild`.** Its `projectionTables` registry TRUNCATEs `order_constraints`
for ALL tenants. Shops 14/15 constraint state is a separate open issue and would have been
destroyed. Rebuild does NOT truncate `inventory_truth` (it upserts), but the constraint
truncation alone disqualifies it as a scoped repair.

**A NEGATIVE `on_hand_quantity` IS NOT AUTOMATICALLY A DEFECT.** PROJ-004: on_hand stores the
TRUE value; negative means sold without recorded receiving ("phantom stock") and is a signal
downstream surfaces flag. `available`/`sellable` clamp at 0. Two shop-1 variants
(`b5b6c80b`, `fa4d3a26`) remain at -1 legitimately and MUST NOT be "repaired" to zero.
The test for drift is truth vs. the canonical CASE, never `on_hand < 0`.

**Constraint follow-up.** 6 orders re-evaluated via
`reevaluate-order-constraints.js --shop-id=1 --order-ids=... --apply --confirm=BL-01A`.
The CLI appends `orders/constraints_reevaluated` only; the projection worker decides outcomes.
Oversells resolved 10 -> 4 active. Address blocks correctly unchanged.

**Shop 1 before -> after:** 26 pending; stock-blocked 10 -> 3; address-blocked 9 -> 9;
eligible-and-unbatched 4 -> 6. No `WMS_BATCH_RELEASE_FAILED` after repair.

**Query-scoping trap.** `order_constraints` has NO `shop_id` column. Any per-tenant constraint
query MUST join `orders`. Filtering only via `order_fulfillment_status` silently counts all
tenants (produced a false "71 address-blocked" during this session).

## CONSTRAINT-FULFILLED-CUSTOMER-01 — shipped orders stay blocked (2026-08-17)

**Defect.** `orderConstraintProjection` short-circuited on `cancelled` only, assuming
`fulfilled` resolves via normal evaluation. True for inventory (remaining demand → 0),
false for customer: the evaluator asks "is the address complete?", and a shipped order
whose address was never corrected answers no forever, re-asserting `is_active` every pass.

**Evidence.** 6 orders (shop 14: 2, shop 15: 4), all fulfilled, all with `oversell`
resolved and `incomplete_address` still active. Shop 1 has 23 fulfilled orders with
constraints, all resolved — its addresses were corrected before shipping, so it never
hit the gap. `order_fulfillment_history`: 0 fulfilled→lower transitions, so `fulfilled`
is terminal in practice.

**Impact.** Not release-blocking — blocked orders never enter the pool, and these already
shipped. But `orders.constrained.controller.ts` and `constraint.metrics.ts` filter on
`is_active` with NO fulfillment-status predicate, so shipped orders appear in the
constrained list and inflate blocked-order metrics.

**Fix.** Terminal short-circuit extended to `cancelled | fulfilled`;
`write_source` records which (`orderConstraintProjection:${ofs.status}`).

**NOT verified locally** — local DB is empty (0 orders) and no projection test exists.
Committed on audit evidence. Post-deploy, confirm via:
`SELECT write_source, COUNT(*) FROM order_constraints WHERE write_source LIKE '%fulfilled' GROUP BY 1;`
If that returns 0 rows after the 6 orders receive an event, the branch is not firing.

**Existing 6 rows** repair via `reevaluate-order-constraints.js --shop-id=14/15 --apply`,
not manual UPDATE — the projection must do the write.

---

## SHOP-REVIEW-RELEASE-SYSTEM-08 — release readiness & intake boundary (CLOSED 2026-08-30)

**Final decision: PASS / CLOSED.** Closes SHOP-REVIEW-RELEASE-SYSTEM-08,
SHOP-REVIEW-ORDER-POOL-READINESS-09, and SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10.

### Reviewer-facing defect

A Shopify order with source line items but **no usable mapped WMS line** could
persist as an order with zero usable `order_line_items`, pass constraint
evaluation vacuously, appear **READY** in the Order Pool, and then make
`POST /api/v1/wms/batch/release` fail at the final PickBatch empty-order guard.
The reviewer saw repeated release failures on an order the UI called ready.

**The final guard was correct.** `"Refusing to release an empty order"` is a
legitimate last-line defense-in-depth check. The defect was upstream: malformed
and intake-exception orders were allowed to reach READY / release at all. The
fix is to classify and exclude those orders before they are ever presented as
releasable — not to change the guard.

### Ratified release-readiness contract

An order is **structurally releasable only when it has at least one usable WMS
line**: an `order_line_items` row with `quantity > 0` **and**
`lasyncro_variant_id IS NOT NULL`.

The identical usable-line predicate is applied at all three authoritative gates,
from one shared definition so they cannot drift:

1. Order Pool rows (`GET /api/v1/wms/order-pool`)
2. `ready_for_release_count`
3. PickBatch release eligibility (server-side Release All / greedy fill / explicit selection)

**SKU is deliberately NOT part of this invariant.** An order whose only line has
`sku = NULL` but a valid mapped `lasyncro_variant_id` and positive quantity
remains releasable.

The final PickBatch guard `"Refusing to release an empty order"` remains in
place and must not be weakened. After this work it is simply unreachable through
legitimate pool / Release API input.

### Intake classification contract

The intake boundary sits upstream of Blocked and the Order Pool:

```
Shopify / source → intake classification → valid WMS order evaluation
  → Blocked  OR  Order Pool → Release
```

Orders that cannot become a warehouse-executable order are recorded in
`order_intake_exceptions` and excluded from the Order Pool and from release
while unresolved. They are **not** operational Blocked orders.

| Kind | Meaning | Behaviour |
| --- | --- | --- |
| `SOURCE_NON_WMS` / `NO_USABLE_WMS_LINES` | Source order has no usable WMS-mapped lines (custom line, deleted variant → `variant: null`) | No variant or line data fabricated; intake-exception row written; absent from Order Pool; **not** operational Blocked |
| `PARTIALLY_MAPPED` | At least one usable mapped WMS line **and** at least one source line that cannot safely map | Mapped line persists; order **fails closed** from release until the intake exception is resolved; absent from Order Pool; **not** operational Blocked |

- **Missing SKU alone is not an intake exception** when canonical variant
  identity is valid.
- **A present source variant identity that should resolve but cannot** stays a
  fatal ingestion-integrity error (throw + full projection rollback, diagnostics
  only). It is **not** silently downgraded to `SOURCE_NON_WMS`, and no order,
  line, or intake-exception row is persisted for it.

### Blocked vs Intake vs Concurrency — three distinct concepts

| | Concept | Store / signal | Notes |
| --- | --- | --- | --- |
| A | **Operational Blocked** | `order_constraints` (existing semantics) | A valid WMS order with an actionable warehouse constraint (oversell, incomplete address, …). May legitimately create an `order_constraints` row. |
| B | **Intake exception** | `order_intake_exceptions` | Source mapping is incomplete / non-WMS. Does **not** become operational Blocked merely because intake failed. |
| C | **Concurrent inventory conflict** | `INVENTORY_CHANGED_DURING_RELEASE` → HTTP 409 | Release was initially valid, but authoritative locked inventory changed while competing with another release. Creates **no** intake exception and **no** `order_constraints` row from the race; does **not** silently retry; is **not** a generic HTTP 500. The operator refreshes / re-evaluates / retries against current state. |

These three models are kept separate and must not be conflated.

### R9 (known shortage) vs R14 (concurrent change) — intentional distinction

- **R9 — insufficient inventory known at the release-time pre-check.** The
  non-locking availability pre-check already sees the shortfall. Existing
  behaviour is preserved: HTTP `201`; `order_count = 0` when no other order
  releases; `pick_batch_id = null` when no batch is created; the order is
  reported through `newly_blocked_orders` on the existing oversell / operational
  constraint path; **zero partial release state**.
- **R14 — inventory changed during an overlapping release.** The pre-check was
  satisfiable; a competing transaction commits first; the reservation-time
  re-check under `SELECT … FOR UPDATE` sees the changed state. The whole release
  transaction rolls back; the API returns HTTP `409` with code
  `INVENTORY_CHANGED_DURING_RELEASE` and a controlled "refresh and try again"
  message; **no new Blocked or intake state is created solely because of the
  race**.

These paths are not collapsed into one condition.

### Transaction / concurrency contract

Release is **atomic**. All consequential release work runs inside the outer
release transaction. A failed downstream release leaves:

- no partial `pick_batches` row
- no partial `pick_batch_orders` membership
- no partial `reservation_hold` `inventory_movements` row
- no partial `pick_reservation_allocations`
- no `inventory_truth` reservation delta

Concurrency protection:

- release may perform an earlier, non-locking availability pre-check;
- authoritative reservation-time inventory is locked with `SELECT … FOR UPDATE`;
- availability is revalidated **after** the lock is held;
- if the locked availability is below required demand, release raises
  `InventoryChangedDuringReleaseError` (typed, carries `variantId`,
  `requiredQuantity`, `availableQuantity`) → full rollback → HTTP `409`
  (`INVENTORY_CHANGED_DURING_RELEASE`). The generic error path is otherwise
  unchanged (still HTTP `500` for genuinely unexpected failures).

### Release API — server-authoritative revalidation

Direct `POST /api/v1/wms/batch/release` requests are **authoritative
server-side requests**, not trust in stale browser Order Pool state. The backend
revalidates every submitted order against current DB state and returns controlled
skip reasons:

| Stale / invalid submission | Skip reason |
| --- | --- |
| Zero usable WMS line | `no_releasable_lines` |
| Usable line + unresolved intake exception | `intake_exception` |
| Genuine active operational constraint | `blocked` |
| Fulfilled / cancelled / other non-pending status | `status_changed` |
| Already released / in a batch | `already_batched` |
| Foreign / cross-tenant / unknown order id | `not_in_pool` |

This revalidation is backend logic, not a frontend responsibility.

### Batch / inventory safety invariants (verified)

- Multiple healthy orders may release into one wave (one batch, exact membership,
  reservations match aggregate demand).
- Release All includes only currently eligible healthy orders.
- A duplicate release request does not create a second batch membership or a
  second reservation.
- An already-batched order cannot enter another batch.
- A cross-tenant order id can never be released.
- `max_batch_line_items` is authoritative; orders beyond the cap remain eligible
  for a later wave, not corrupted or lost.
- Competing releases cannot over-reserve stock; committed reservation never
  exceeds opening availability.
- `available_quantity` never goes negative from release; `reserved_quantity`
  never goes negative.
- Reservation does not change `on_hand_quantity`.
- A fresh root-only warehouse (no bins) remains fully supported for release.
- Adding a configured empty pick bin does not invalidate root-stock release.

### Automated acceptance evidence — formal verification 2026-08-30

| Suite / check | Result |
| --- | --- |
| Canonical R1–R20 release matrix | **all PASS** |
| `release-regression-completion` | 13 / 13 PASS |
| `release-readiness` (Slice A) | 7 / 7 PASS |
| `order-intake-classification` (Slice B) | 9 / 9 PASS |
| `order-intake-classification` + `projection-worker-canonical-quarantine`, one disposable DB | 15 / 15 PASS (intake 9 / 9, quarantine 6 / 6) |
| `fresh-install-release-path` | 1 / 1 PASS |
| `batch-reservation-allocations` (unit) | 4 / 4 PASS |
| Backend TypeScript (`apps/backend/tsconfig.json`) | PASS |
| Migration TypeScript (`apps/backend/tsconfig.migrations.json`) | PASS |
| Migration `0164` apply + RLS in disposable harness | PASS |
| Tenant isolation | PASS |
| Test-seam containment (no disposable-DB residue) | PASS |

All DB-backed verification ran on disposable `synchroflow_test_*` databases,
created / migrated / runtime-verified / dropped per run, with zero orphans and
`synchroflow_db` untouched. `sf_app` confirmed non-superuser and non-`BYPASSRLS`.

**Verification caveat (not a release-system issue).** `tsc -p tests/tsconfig.json`
still reports one pre-existing unrelated error,
`tests/integration/auth/register-no-auth-side-effects.test.ts(39,4) TS1005: '}' expected`.
It does not implicate any release-system file and was not repaired here.

### R1–R20 matrix

| # | Scenario | Result |
| --- | --- | --- |
| R1 | Healthy single release | PASS |
| R2 | Multiple healthy orders, one wave | PASS |
| R3 | Release All (greedy fill, no explicit selection) | PASS |
| R4 | Zero-line order excluded from READY / Order Pool | PASS |
| R5 | Zero-line direct release is a safe no-op | PASS |
| R6 | Mixed valid + malformed selection — valid releases, invalid skipped | PASS |
| R7 | Missing SKU with a valid mapped variant stays releasable | PASS |
| R8 | Null / custom / deleted source line — intake-safe, never a false READY, never crashes release | PASS |
| R9 | Known insufficient inventory at pre-check → controlled `newly_blocked` (HTTP 201) | PASS |
| R10 | Duplicate release request — no double batch / reservation | PASS |
| R11 | Already-batched order cannot enter another batch | PASS |
| R12 | Fresh root-only warehouse release | PASS |
| R13 | Configured empty pick-bin transition — root-stock release unaffected | PASS |
| R14 | Competing / concurrent stock — no over-reservation; loser → HTTP 409 `INVENTORY_CHANGED_DURING_RELEASE` | PASS |
| R15 | Cross-tenant order selection rejected / skipped | PASS |
| R16 | Forced downstream failure after release writes begin → complete rollback | PASS |
| R17 | `max_batch_line_items` cap enforced; overflow orders retained for a later wave | PASS |
| R18 | Stale Order Pool state (blocked / fulfilled / already-batched) — backend revalidation catches it | PASS |
| R19 | Cancelled / fulfilled order submitted directly → rejected | PASS |
| R20 | Reviewer-shaped populated pool — every READY order satisfies the release-readiness invariant | PASS |

(Historical audit statuses such as `MISSING_COVERAGE`,
`EXISTING_INCOMPLETE_COVERAGE`, and `BLOCKED_BY_TEST_SEAM` — R16 was the last of
these — are superseded by this record. R14 concurrency counts only because the
genuine overlapping-transaction proof passes.)

### Migration `20260827120000_0164_create_order_intake_exceptions.ts`

Purpose: persist unresolved intake classification **separately** from operational
Blocked (`order_constraints`).

- Tenant-scoped via `shop_id`.
- Row Level Security **enabled** and **forced**.
- Tenant-isolation policy present (`shop_id = current_setting('app.current_tenant')`).
- `sf_app` remains non-superuser and non-`BYPASSRLS`.
- Schema-only: `CREATE TABLE` + a non-negative-counts `CHECK` + RLS + policy. No
  historical backfill.

### Historical safety / reconciliation

`HISTORICAL_EXCEPTION_BACKFILL_REQUIRES_RECONCILIATION` remains in force.
Migration `0164` does **not** backfill historical malformed orders. Historical
zero-usable-line orders are nevertheless prevented from becoming READY by the
structural release predicate (`quantity > 0 AND lasyncro_variant_id IS NOT NULL`)
at all three gates. If typed intake-exception records are ever wanted for
existing historical orders, that requires an explicit reconciliation / replay
workflow — it does not exist and was not added here.

### Test-only seams (proof provenance)

- **R16** — a deterministic disposable-DB trigger forces a downstream
  reservation-write failure to prove the outer release transaction rolls back
  every prior write.
- **R14 concurrency** — disposable-DB advisory-lock coordination proves two
  release transactions genuinely overlap (distinct backends, both open at once,
  confirmed from `pg_locks` / `pg_blocking_pids`) before the barrier is lifted.

Both are **test-only**, confined to disposable `synchroflow_test_*` databases,
installed and dropped within the test. There is **no runtime fault-injection
mechanism**, no production trigger or function, and no development-DB residue.

### Issue closures

| Issue | Status |
| --- | --- |
| SHOP-REVIEW-RELEASE-SYSTEM-08 | **CLOSED** |
| SHOP-REVIEW-ORDER-POOL-READINESS-09 | **CLOSED** |
| SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10 | **CLOSED** |

Rationale: the READY invariant is established at all three authoritative gates;
malformed / non-WMS source lines are classified before normal WMS operation;
direct release revalidates current server state; transaction rollback is proven
behaviourally; the concurrent inventory race maps to a controlled HTTP 409; the
full R1–R20 regression matrix is green; and the fresh-install / reviewer release
path remains green.

---

## SHOP-REVIEW-BARCODE-PRINT-05 — reviewer-safe barcode printing

**Status (2026-08-30): ENGINEERING VERIFIED / PRODUCTION RECERTIFICATION PENDING.**
The browser/QZ printing-safety contract below is engineering-verified **and
deployed**. Two subsequent thermal-label defects were found during production
certification and each corrected under this same issue:

1. **Clipping** — Zebra 4×6 / Dymo 1×2.125 batch labels clipped at the physical
   page edge. *Corrected and deployed* (see *Production thermal-geometry
   correction — 2026-08-30*).
2. **Caption composition** — after the clipping fix deployed, the location-code
   caption was still left-aligned and pinned near the page bottom, leaving a
   large blank band between barcode and text. *Corrected and engineering-verified;
   not yet deployed* (see *Thermal caption-composition correction — 2026-08-30*).

`ENGINEERING_VERIFICATION = PASS` · `PRODUCTION_CERTIFICATION = PENDING` (caption
correction awaiting commit → CI → deploy → production Zebra + Dymo re-smoke). Not
final CLOSED — see "Production status" below.

### Historical context

The original Shopify reviewer barcode rejection (ref 102766) had barcode
*assignment / generation / empty-preview* symptoms — products with no scannable
identity, misleading counts, a consequently empty preview. That core
barcode-generation path was repaired and reviewer-certified earlier
(SHOP-REV-01g minted the LSP- identity endpoint, 01i/01m the product-label
print + preview panel). **BARCODE-PRINT-05 does not touch barcode generation.**
It closes the remaining *print-experience* risk observed during certification:

- QZ Tray dependency behaviour;
- browser-fallback reliability;
- popup blocking;
- silent / console-only UI states;
- multi-sheet printing;
- the no-printer reviewer path.

### Root cause

Floor Planning → Barcodes opened the fallback PDF with `window.open` **only
after an asynchronous chain**: the label-generation API call, then a QZ / default
-printer discovery step (a ~1 s `localhost:8182` websocket attempt + a printer
lookup), then a delayed `window.open`. A normal browser treats that `window.open`
as non-user-initiated and can block it. When blocked, the reviewer had **no
durable Open/Download recovery**, and several success/error branches were
`console.warn`/`console.error` only — so Print appeared unresponsive.

Also found:

- **Batch print sent only the first sheet's IDs** (`items.slice(0,
  labelsPerSheet)`) while the panel advertised "N labels · M sheets".
- **Empty selection** left the "Print sheet" button enabled; the handler
  silently early-returned.
- **`product_label`** existed in the `printer_role` Postgres enum (migration
  0136) but was missing from the backend `VALID_PRINTER_ROLES` allow-list, so an
  owner could never register a product-label printer and the QZ product path was
  permanently unreachable.

### Final product contract

**QZ Tray is OPTIONAL.** Floor Planning → Barcodes has exactly two outcomes.

**Direct printer path** — a configured default printer for the role **and** QZ
Tray reachable **and** the dispatch succeeds → the UI reports **"Sent to
&lt;printer&gt;"**. This is a *dispatch* claim only; it is not proof the printer
physically produced the label.

**Browser path** — no default printer **or** QZ unavailable **or** QZ dispatch
failure → the generated PDF stays available through persistent **"Open printable
PDF"** and **"Download PDF"** controls. Browser printing does **not** depend on
popup permissions (the controls are the reviewer's own click).

A Shopify reviewer can complete barcode printing without: installing QZ Tray,
configuring a warehouse printer, or allow-listing popups. A concise on-surface
hint states *"Printer app optional — labels can also be opened as a PDF and
printed from your browser."*

### Implementation summary

| Area | Behaviour |
| --- | --- |
| **A. `qzPrint` result model** | `PrintDispatchResult` = `{ status: 'dispatched'; printerName }` \| `{ status: 'fallback'; reason: 'no_default_printer' \| 'qz_unavailable' \| 'qz_failed' }`. The **default-printer lookup runs before the QZ websocket connection**; with no configured printer it returns `fallback/no_default_printer` immediately and never touches `localhost:8182`. No QZ certificate/signature work, no forced disconnect-after-print, no new retries. |
| **B. Browser fallback** | The PDF `Blob` is retained in UI state; persistent Open/Download controls render from it. A best-effort automatic open may occur but is never required for success. Object URLs are revoked on replacement and on unmount, and are **not** revoked on an arbitrary timer while the controls are still shown. |
| **C. Print states** | `idle` → `preparing` (visible progress, Print disabled) → `browser_ready` (Open/Download) \| `qz_dispatched` ("Sent to &lt;printer&gt;") \| `error` (safe visible message, retry available). No reviewer-facing branch is console-only. |
| **D. Batch selection** | Every selected ID is submitted; the backend PDF generator paginates. The visual panel may show the first sheet while truthfully reporting "N labels · M sheets · sheet 1 of M". |
| **E. Empty selection** | The "Print sheet" button is disabled; the handler keeps a defensive early return. The batch endpoints independently return a controlled `400` for empty arrays. |
| **F. Product-label printer role** | `product_label` added to `VALID_PRINTER_ROLES`. **No migration** — the DB enum already contained it. Unknown roles still `400`. |

### Files / ownership

Production source:

- `apps/frontend/src/utils/qzPrint.ts`
- `apps/frontend/src/pages/ft2-pages/FloorPlanningPage.tsx`
- `apps/frontend/src/pages/floor-planning/useZoneManagement.ts`
- `apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx` *(mechanical adaptation to the structured `printViaQz` result only)*
- `apps/backend/src/api/wms/printers.controller.ts`
- `modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx`
- `modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx`
- `modules/floor-planning/src/ui/index.ts`

Tests:

- `tests/unit/frontend/qzPrint.test.ts`
- `tests/unit/ui/floor-planning/PrintPreviewPanel.test.tsx`
- `tests/unit/ui/floor-planning/ProductBarcodesTable.lifecycle.test.tsx`
- `tests/integration/floor-planning/barcode-print.test.ts`

`modules/floor-planning/dist/*` was regenerated because the host app consumes the
module's built public API (`PrintSubmitResult` / the changed callback prop
types); the dist churn is restricted to the 11 changed floor-planning artifacts.

### Automated evidence (final formal verification)

| Suite / check | Result |
| --- | --- |
| `qzPrint` utility (`tests/unit/frontend/qzPrint.test.ts`) | 5 / 5 PASS |
| `PrintPreviewPanel` (`tests/unit/ui/floor-planning/PrintPreviewPanel.test.tsx`) | 14 / 14 PASS |
| Per-row `ProductBarcodesTable` object-URL lifecycle | 3 / 3 PASS |
| Adjacent WMS regression (`WmsOperationsPage.floorPlanningNav.test.tsx`) | 1 / 1 PASS |
| Backend `barcode-print` integration (disposable DB) | 11 / 11 PASS |
| Disposable DB harness | PASS (created / migrated / runtime-ok / dropped; 0 orphans) |
| `tsc -p apps/backend/tsconfig.json` / `…/tsconfig.migrations.json` | EXIT 0 / EXIT 0 |
| `tsc -p apps/frontend/tsconfig.json` | 19 known unrelated baseline errors only; zero issue-file errors |
| `tsc -p tests/tsconfig.json` | sole known baseline `tests/integration/auth/register-no-auth-side-effects.test.ts(39,4) TS1005`; zero issue-test errors |

### Multi-sheet PDF proof (maintained integration suite)

Both from `tests/integration/floor-planning/barcode-print.test.ts`, asserted on
the real HTTP response with `PDFDocument.load(response).getPageCount()`:

| Fixture | Format | Sheet capacity | Expected pages | Actual pages |
| --- | --- | --- | --- | --- |
| BE2b — 30 tenant-owned active locations | `avery-5160` | 24 / sheet | 2 | 2 |
| BE4b — 30 tenant-owned pre-barcoded product variants | `avery-5160` | 24 / sheet | 2 | 2 |

The earlier `dist/pdfprobe.mjs` was a throwaway verification probe and is **not**
the acceptance evidence.

### Acceptance matrix

| BP | Scenario | Result |
| --- | --- | --- |
| BP1 | Existing location/product barcode → preview renders | PASS |
| BP2 | Full selection → full multi-page printable PDF | PASS |
| BP3 | No QZ installed → browser fallback | PASS |
| BP4 | QZ unavailable → fallback | PASS |
| BP5 | No default printer → QZ connection skipped + fallback | PASS |
| BP6 | QZ print failure → fallback | PASS |
| BP7 | Popup blocked → Open/Download recovery remains | PASS |
| BP8 | Empty selection → Print disabled | PASS |
| BP9 | QZ dispatch success → truthful "Sent to &lt;printer&gt;" | PASS |
| BP10 | Browser fallback never claims physical print | PASS |
| BP11 | Repeated print works | PASS |
| BP12 | No tenant / secret leakage | PASS |
| BP13 | 400 / 404 / 500 → reviewer-visible error | PASS |
| BP14 | Honest multi-sheet preview / count | PASS |
| BP15 | `product_label` configurable as a valid printer role | PASS |
| BP16 | Object-URL lifecycle — **batch and per-row product**, both behaviourally covered | PASS |
| BP17 | Adjacent WMS QZ callers preserved | PASS |

No `PASS*`, `STATIC_ONLY`, or `INCOMPLETE` markers remain.

### Reviewer without QZ Tray

**`REVIEWER_WITHOUT_QZ = YES`** — a critical App Store-review statement.
Evidence: a missing default printer skips the QZ connection entirely; the server
PDF is still generated; the `browser_ready` state is shown; "Open printable PDF"
and "Download PDF" are both available; a blocked popup cannot strand the
reviewer (the controls persist); no QZ onboarding or install is required; and no
branch produces a dead button.

### Shared infrastructure

`apps/frontend/src/utils/qzPrint.ts` is shared. The adjacent WMS callers — receive
**unit labels** and **invoices** on `WmsOperationsPage` — were mechanically
adapted to the structured dispatch result (`dispatch.status === 'dispatched'` →
done; otherwise the existing `openBlobInTab` + QZ onboarding prompt). Their UX
was **not** redesigned. The carrier **shipping-label** flow was not changed.

### Deferred (tracked, not blockers)

- **BP-D6** — `warehouse_locations.last_printed_at` records generation/request
  timing, not proven physical print completion. DEFER.
- **BP-D10** — `dymo-1x2` client/server `paperSize` string mismatch (equivalent
  geometry). DEFER.
- **BP-D11** — duplicated client/server label-geometry definitions ("synced by
  comment only"). DEFER.
- **BP-D14** — product preview cannot show a barcode that is minted on print.
  DEFER.
- **BP-D16** — adjacent Canvas single-location / shipping-label popup UX beyond
  the mechanical shared-`qzPrint` adaptation. DEFER.

Any prior barcode table/summary inconsistency remains a separate item.

### Out of scope / unchanged

No change to: barcode value generation, the LSP- barcode format, Shopify
identity, inventory, product/location assignment semantics, mint-on-print
semantics, PDF barcode encoding, migrations, Shopify OAuth, or the WMS release
system. No QZ certificate/signature architecture was introduced. Reviewers are
not required to install QZ.

### Production thermal-geometry correction — 2026-08-30

**Discovery.** Production certification of the deployed browser/QZ hardening
confirmed the reviewer-facing contract works: the Barcodes page renders, format
selection works, the browser fallback works **without QZ**, "Open printable PDF"
and "Download PDF" work, generated PDFs open normally, there are no visible
runtime errors, and Avery output looks correct. Certification nonetheless
remained **FAIL** because the actual opened **Zebra 4×6** batch *location-label*
PDF visibly **clipped the barcode at the physical page boundary**. A source
audit then proved **Dymo 1×2.125** has the identical clipping mechanism and is
reviewer-selectable, so it was corrected in the same issue rather than waiting
for a second production failure. (The tall in-app preview scrollbar is **not**
the defect — see *Preview note* below.)

**Root cause.** `generateWarehouseLabelSheetPdf()` applied one A4-style layout
rule to **every** format: an 8 mm outer sheet margin, a 2 mm inter-label gap,
and a top-anchored grid. That is correct for tiled A4 sheet stock but invalid
for one-label-per-physical-page media, where the page **is** a single label.
Subtracting an A4 outer margin + row gap from a page whose size already equals
the label pushed the label off the page:

| Format | Page (pt) | Old barcode right edge | Old caption `y` |
| --- | --- | --- | --- |
| Zebra 4×6 | 288 × 432 | ≈ 304.971 (> 288 → clipped right) | ≈ −21.205 (off the bottom) |
| Dymo 1×2.125 | 72 × 153 | ≈ 89.542 (> 72 → clipped right) | ≈ −22.414 (off the bottom) |

**Corrected geometry contract.** The layout model is now split by format shape:

- **A4 tiled** (`avery-5160`, `avery-5163`) — unchanged: A4 MediaBox, 8 mm sheet
  margin, 2 mm inter-label gap, column × row grid tiling.
- **Non-A4 one-label-per-page** (`zebra-4x6`, `dymo-1x2`) — the physical media
  page is the full label canvas: frame origin `(0, 0)`, **no** A4 outer margin,
  **no** A4 row gap, exactly **one label per page**, and a **4 pt** internal
  barcode inset (plus the barcode raster's own quiet-zone padding).

**Physical page authority.** The serialized PDF MediaBox is the **advertised
media size**, not the nominal label-millimetre box:

| Format | MediaBox (pt) | *not* |
| --- | --- | --- |
| Zebra 4×6 | **288 × 432** | 101 × 152 mm |
| Dymo 1×2.125 | **72 × 153** | 25 × 54 mm |

**Single geometry authority.** `computeWarehouseLabelSheetLayout(formatId, count)`
is now the one source of truth for sheet geometry. It is consumed **both** by
production PDF rendering — `generateWarehouseLabelSheetPdf` reads its `page`,
`pageCount`, and per-slot `pageIndex`, `barcode {x, y, width, height}` and the
caption spec directly — **and** by the automated geometry assertions. This
closes the former test gap where pagination was covered but per-element bounds
were not. *(The caption shape was later refined from a flat `{x, y, fontSize}`
to a discriminated `fixed | thermal-centered` layout — see* Thermal
caption-composition correction — 2026-08-30 *below.)*

**Corrected bounds (verified).**

| Format | Page | Barcode `x, y, w, h` | Barcode right | Caption `x, y` (this correction) | Overflow |
| --- | --- | --- | --- | --- | --- |
| Zebra 4×6 | 288 × 432 | 4, 168.8, 280, 259.2 | 284 (≤ 288) | 4, 6 | **0** |
| Dymo 1×2.125 | 72 × 153 | 4, 57.2, 64, 91.8 | 68 (≤ 72) | 4, 6 | **0** |

Both keep a **≥ 4 pt hard horizontal inset** on each side, in addition to the
existing bwip-js barcode raster padding. The **barcode rectangles above are
final** and unchanged by the later caption work; the `Caption x, y` column
reflects this clipping correction only — caption placement was subsequently
recentred and pulled up to the barcode (see *Thermal caption-composition
correction — 2026-08-30* below).

**Files.**

- `apps/backend/src/services/wms/warehouseLabelPdf.service.ts` — `computeWarehouseLabelSheetLayout` helper + the split renderer.
- `tests/integration/floor-planning/barcode-print.test.ts` — BE2c, BE2d added.
- `tests/unit/backend/wms/warehouseLabelPdf.geometry.test.ts` — **new** pure geometry suite.

No frontend or `modules/floor-planning/dist` change; no rebuild required.

**Formal verification (AUTOMATED VERIFY = PASS).**

| Check | Result |
| --- | --- |
| Pure geometry suite (`warehouseLabelPdf.geometry.test.ts`) | 12 / 12 PASS |
| `barcode-print` integration (disposable DB) | 13 / 13 PASS |
| BE2c — 3 Zebra location labels | 3 pages, every page **288 × 432** |
| BE2d — 3 Dymo location labels | 3 pages, every page **72 × 153** |
| `tsc -p apps/backend/tsconfig.json` / `…/tsconfig.migrations.json` | EXIT 0 / EXIT 0 |
| `tsc -p tests/tsconfig.json` | only the known unrelated `register-no-auth-side-effects.test.ts(39,4) TS1005` baseline |
| Disposable DB harness | PASS (created / migrated / runtime-ok / dropped; 0 orphan test DBs) |

The `barcode-print` suite grew from 11 to 13 cases (BE2c, BE2d added); the
"11 / 11" row in *Automated evidence* above was the count at the browser/QZ
verification. Serialized-PDF proof: BE2c/BE2d load the real HTTP response with
`PDFDocument.load(res.body)` and assert every page's `getSize()`, closing the
gap between the computed layout and the serialized MediaBox. *(The pure geometry
suite later grew from 12 to 25 cases with the caption-composition correction
below; the "12 / 12" figure here is the count at this clipping verification.)*

**Correction matrix.**

| ID | Check | Result |
| --- | --- | --- |
| TG1 | Zebra MediaBox 288 × 432 | PASS |
| TG2 | Zebra frame / barcode / caption fully in bounds | PASS |
| TG3 | Zebra ≥ 4 pt barcode quiet-zone inset | PASS |
| TG4 | Zebra caption on-page, no barcode overlap | PASS |
| TG5 | Dymo MediaBox 72 × 153 | PASS |
| TG6 | Dymo frame / barcode / caption fully in bounds | PASS |
| TG7 | Avery 5160 geometry + pagination preserved | PASS |
| TG8 | Avery 5163 preserved within accepted pre-existing ≤ 2 pt tolerance | PASS |
| TG9 | Avery multi-page pagination regression | PASS |
| TG10 | Barcode value / generator semantics unchanged | PASS |
| TV1 | Renderer and tests share one geometry authority | PASS |
| TV2 | Serialized Zebra HTTP PDF correct | PASS |
| TV3 | Serialized Dymo HTTP PDF correct | PASS |
| TV4 | Zero thermal overflow | PASS |
| TV5 | Frontend correction scope: none | PASS |
| TV6 | Product thermal renderer untouched | PASS |
| TV7 | Single-zone warehouse print untouched | PASS |
| TV8 | Zero new type errors | PASS |

**Avery 5163 — DEFER / PRE_EXISTING.** The second-column barcode image can
extend ≈ **1.655 pt (≈ 0.58 mm)** past the nominal A4 right edge. This is
pre-existing, was **not** worsened by the thermal correction, does not visibly
fail in production, and is bounded by an explicit `≤ 2 pt` regression assertion
that is **local to the Avery-5163 test** — Zebra/Dymo still require **zero**
overflow. Not fixed here; not a BARCODE-PRINT-05 closure blocker.

**Unchanged boundaries.** No change to `barcodeGenerator.ts`, CODE128, bwip-js
options, `zone.barcode ?? zone.location_code`, merchant barcode-override
semantics, `productLabelPdf.service.ts`, single-zone warehouse label generation
(`generateWarehouseLabelPdf` / `generateBinLabel` / `generateLanePlacard`), the
frontend Barcodes UI, the `qzPrint` / browser-fallback contract, printer roles,
Shopify, inventory, OAuth, or migrations. No frontend / dist rebuild.

**Preview note (cosmetic / non-blocking).** The tall Zebra label preview can
require vertical scrolling because the in-app preview container has a height
cap. The audit confirmed the logical preview content is fully present and the
barcode does not overflow its preview box — this is **not** the PDF clipping
defect and is not marked fixed.

**Flake note.** One first full integration run had **BE6** ("nothing printable →
404", the untouched product-batch path) fail once; it then passed in isolation
and on two full re-runs. No production or test code was changed to obtain the
pass — this is not a thermal regression.

`THERMAL_GEOMETRY_ENGINEERING_VERIFICATION = PASS` ·
`PRODUCTION_RECERTIFICATION = PENDING`. *(The clipping correction has since been
deployed; production re-certification then exposed the caption-composition defect
below.)*

### Thermal caption-composition correction — 2026-08-30

**Production discovery.** After the thermal *clipping* fix deployed, production
re-certification confirmed the Zebra 4×6 PDF opened with the barcode fully inside
the page, the caption fully inside the page, and the left/right quiet zones
restored — the clipping defect was fixed. Re-certification still could not pass,
because the location-code caption was **left-aligned** and **pinned near the
physical bottom edge**: Zebra showed roughly **155 pt** of empty vertical space
between the barcode and the caption, and Dymo about **44 pt** by the same rule.
This is a composition defect, not clipping.

**Root cause.** The thermal *structural* geometry had been corrected, but the
caption was still emitted as `x = 4, y = 6` — independent of the barcode centre,
the barcode bottom, the text width, and the real font ascent. So the caption was
never centred and its vertical position bore no relation to the barcode.

**Final thermal caption contract** (applies only to `zebra-4x6` and `dymo-1x2`):

- caption **centred horizontally on the barcode rectangle**;
- caption **directly below the barcode**, with an **exact 6 pt visual gap**
  measured from the caption glyph ascent-top to the barcode bottom (not
  baseline-to-barcode);
- **HelveticaBold, max 10 pt**, **shrink-to-fit** when the code is wider than the
  barcode, **min 5 pt**;
- the **complete `location_code` is always retained** — no ellipsis, no
  truncation, no wrapping, no overflow;
- if a string cannot fit even at 5 pt the internal fit result is an explicit
  `fits: false` and the renderer **refuses to draw** (throws) rather than clip
  silently — a defensive invariant, not reachable for supported codes.

Avery tiled captions are unchanged.

**Caption layout architecture.** `WarehouseLabelCaptionLayout` is now
discriminated:

- `{ mode: 'fixed'; x; y; fontSize }` — A4 tiled cells (values unchanged);
- `{ mode: 'thermal-centered'; centerX; barcodeBottom; maxWidth; gapPt;
  maxFontSize; minFontSize }` — Zebra / Dymo.

`computeWarehouseLabelSheetLayout()` still owns only structural geometry
(`centerX`, `barcodeBottom`, `maxWidth`, `gapPt`, font-size limits) and remains
**pure / deterministic / tenant-data-free** — `location_code` never enters the
layout object. The renderer resolves only the font-dependent final placement.

**Font-fit model.** `fitThermalCaptionFontSize({ text, maxSize, minSize,
maxWidth, measure })` — uses at 10 pt when it fits; otherwise takes the
proportional estimate and verifies, nudging down in fixed 0.05 pt steps
(bounded — no open loop); never below 5 pt; returns
`{ fits: false, minFontSize, textWidthAtMin, maxWidth }` when impossible. No
truncation / wrapping / ellipsis. `computeCenteredCaptionX(centerX, textWidth)`
and `computeThermalCaptionBaselineY(barcodeBottom, gapPt, ascent)` are the other
two production-consumed / test-exercised helpers.

**Renderer order of operations** (thermal branch): (1) determine the final font
size via `fitThermalCaptionFontSize`; (2) measure the text width at the **final**
size; (3) measure the HelveticaBold ascent at the **final** size
(`font.heightAtSize(size, { descender: false })`); (4) centre x with the final
width; (5) `y = barcodeBottom − 6 pt − final ascent`; (6) draw the complete
`location_code`. No stale 10 pt width or ascent survives a shrink.

**Zebra verified result.** Barcode rectangle unchanged —
`x 4, y 168.8, w 280, h 259.2`; `centerX = 144`. `PICK-0A-02` → 10 pt, x ≈
116.78, baseline ≈ 155.62, visual gap **6.000 pt**, midpoint 144. `WH-12345-ROOT`
and `WH-123456-ROOT` also fit Zebra at 10 pt (280 pt usable width). The barcode
is **not** moved to consume the 4×6 page; whitespace beneath the caption is
expected and is not the defect.

**Dymo verified result.** Barcode rectangle unchanged —
`x 4, y 57.2, w 64, h 91.8`; `centerX = 36`.

| Code | final size | width | x | baseline y | visual gap | midpoint |
| --- | --- | --- | --- | --- | --- | --- |
| WH-1-ROOT | 10.00 | 57.17 | 7.41 | 44.02 | 6.000 | 36 |
| WH-999-ROOT | ≈ 9.37 | 64.00 | 4.00 | 44.47 | 6.000 | 36 |
| WH-12345-ROOT | ≈ 8.06 | 64.00 | 4.00 | 45.41 | 6.000 | 36 |
| WH-123456-ROOT | ≈ 7.53 | 64.00 | 4.00 | 45.79 | 6.000 | 36 |

Every ordinary fixture (`A`, `B`, `PACK-01`, `PICK-0A-02`, `WH-1-ROOT`,
`WH-999-ROOT`, `WH-12345-ROOT`, `WH-123456-ROOT`) on Dymo: complete string,
centred (midpoint 36), width ≤ 64, x ≥ 4, right ≤ 68, font ≥ 5 pt, exact 6 pt
visual gap, on-page. Baselines differ across the shrunk sizes — no stale-ascent
bug. Slightly different float representations from the deterministic shrink are
acceptable.

**Defensive no-fit.** A synthetic oversized string that cannot fit at 5 pt
returns `fits: false` (`textWidthAtMin > maxWidth`); the renderer throws rather
than overflow / truncate / wrap / shrink below the floor. Not expected for any
supported ordinary location code (a 6-digit-shopId root resolves to ≈ 7.5 pt).

**Formal verification (AUTOMATED VERIFY = PASS).**

| Check | Result |
| --- | --- |
| Pure geometry suite (`warehouseLabelPdf.geometry.test.ts`) | 25 / 25 PASS |
| `barcode-print` integration (disposable DB) | 13 / 13 PASS (no BE6 flake this run) |
| `tsc -p apps/backend/tsconfig.json` / `…/tsconfig.migrations.json` | EXIT 0 / EXIT 0 |
| `tsc -p tests/tsconfig.json` | only the known unrelated `register-no-auth-side-effects.test.ts(39,4) TS1005` baseline |
| Disposable DB harness | PASS (created / migrated / runtime-ok / dropped; 0 orphan test DBs) |

No production / Shopify / QZ / printer mutation during verification. The font-fit
helpers are exercised against the real embedded `StandardFonts.HelveticaBold`
(and a synthetic linear measure) — no PDF parsing, no OCR.

**Acceptance matrix.**

| ID | Check | Result |
| --- | --- | --- |
| CC1 | Zebra caption centred | PASS |
| CC2 | Zebra exact 6 pt visual gap | PASS |
| CC3 | Dymo caption centred | PASS |
| CC4 | Dymo exact 6 pt visual gap (incl. shrunk) | PASS |
| CC5 | ordinary Dymo codes shrink-to-fit without data loss | PASS |
| CC6 | ordinary Dymo codes remain ≥ 5 pt | PASS |
| CC7 | thermal captions fully on-page | PASS |
| CC8 | thermal barcode rectangles unchanged | PASS |
| CC9 | Zebra/Dymo MediaBox unchanged | PASS |
| CC10 | Avery geometry / captions unchanged | PASS |
| CC11 | barcode value / generator semantics unchanged | PASS |
| CC12 | explicit no-fit, never overflow | PASS |
| CC13 | integration 13 / 13 green | PASS |
| CV1 | renderer uses the final font width | PASS |
| CV2 | renderer uses the final font ascent | PASS |
| CV3 | resolved midpoint equals barcode centre | PASS |
| CV4 | resolved visual gap = 6 pt | PASS |
| CV5 | no stale 10 pt baseline after shrink | PASS |
| CV6 | no frontend / dist scope | PASS |

**Files.**

- `apps/backend/src/services/wms/warehouseLabelPdf.service.ts` — caption union,
  `fitThermalCaptionFontSize` / `computeCenteredCaptionX` /
  `computeThermalCaptionBaselineY`, thermal caption constants
  (`THERMAL_CAPTION_GAP_PT = 6`, `THERMAL_CAPTION_MAX_FONT_PT = 10`,
  `THERMAL_CAPTION_MIN_FONT_PT = 5`), renderer thermal branch.
- `tests/unit/backend/wms/warehouseLabelPdf.geometry.test.ts` — CC/CV coverage
  (TC1–TC13 + pure-helper units); geometry suite 12 → 25.

`tests/integration/floor-planning/barcode-print.test.ts` unchanged (0 diff);
its 13 cases re-run green as the HTTP regression guard.

**Unchanged boundaries.** No change to: the thermal barcode rectangles, the
Zebra/Dymo MediaBox, page count, `barcodeGenerator.ts`, CODE128, bwip-js options,
`zone.barcode ?? zone.location_code`, merchant barcode overrides, Avery geometry
and captions, `productLabelPdf.service.ts`, `generateWarehouseLabelPdf` /
`generateBinLabel` / `generateLanePlacard`, the frontend, the floor-planning
module and its `dist`, `qzPrint`, printer roles, Shopify, inventory, OAuth, or
migrations. No frontend / dist rebuild.

`THERMAL_CAPTION_ENGINEERING_VERIFICATION = PASS` ·
`PRODUCTION_RECERTIFICATION = PENDING`.

### Production status

The browser/QZ printing-safety contract is engineering-verified **and deployed**;
its reviewer-path behaviour (including `REVIEWER_WITHOUT_QZ = YES`) passed
production observation and was **not** reopened. The thermal **clipping**
correction (*Production thermal-geometry correction — 2026-08-30*) is also
deployed. Production re-certification of that deployment then exposed the
**caption-composition** defect (*Thermal caption-composition correction —
2026-08-30*): the caption correction is engineering-verified but has **not** yet
gone through commit/push → CI → deploy → production re-smoke of **both** Zebra and
Dymo location-label PDFs. Until that pipeline completes, do not assume the live
production Barcodes surface produces centred, tightly-spaced thermal captions.

**`PRODUCTION_CERTIFICATION = PENDING` (caption-composition recertification).**

**SHOP-REVIEW-BARCODE-PRINT-05 = ENGINEERING VERIFIED / PRODUCTION
RECERTIFICATION PENDING.** Not final CLOSED. Other Shopify App Review risks
remain tracked separately; the overall App Review project is not closed by this
section.

<!-- BEGIN SHOP-REVIEW-SYNC-ANIMATION-THEME-07 -->

## SHOP-REVIEW-SYNC-ANIMATION-THEME-07 — post-OAuth first-activation experience

**Status:** certified locally 2026-09-01.

### Reviewer-facing contract

The post-OAuth screen is adaptive onboarding buffered by real Shopify sync progress, not a decorative loading screen.

Three independent clocks are preserved:

1. **real sync** — backend authority;
2. **workflow story** — frontend seven-scene film;
3. **experience buffer** — minimum first-run dwell and bounded post-sync resolve.

The story never controls lifecycle.

Final workflow story:

1. PLAN — create the PO;
2. RECEIVE — receive against the PO;
3. BARCODE — give products a LaSyncro barcode;
4. PUT AWAY — place barcoded products in the correct bin;
5. PICK — release orders and pick to pack;
6. PACK — verify, pack, and create shipping labels;
7. SHIP — move packed orders to shipping, load, and dispatch.

Canonical timing:

- `MIN_FIRST_RUN_DWELL_MS = 9000`;
- `MAX_POST_SYNC_RESOLVE_MS = 1800`;
- `COMPLETION_TRANSITION_MS = 900`;
- `VERY_LONG_THRESHOLD_MS = 45000`.

### Progress contract

The visible progress bar is a monotonic experience projection.

Targets are approximately:

`8 → 30 → 60 → 82 → 88 → 91 → 93 → 95`

across initial state and Scenes 1–7.

It remains at or below 95% until completion eligibility.

A fast backend sync therefore cannot make the first post-OAuth frame misleadingly display 100%.

Once real sync is complete and first-run eligibility is satisfied, progress may smoothly resolve to 100%.

Display progress does not write backend state and is not lifecycle authority.

### Completion contract

The old centered blocking **Sync complete** overlay and full-screen dimming were removed.

Completion now uses a small lower-right non-blocking chip:

- `Sync complete`
- `Enter workspace`

The workflow film stays visible.

Clicking **Enter workspace** accelerates only the remaining presentation resolve and enters the same canonical completion path. It cannot fabricate sync completion or lifecycle state.

Without a click, the experience still resolves automatically within the existing post-sync timing contract.

### Long sync, failure, and accessibility

- Long sync proceeds through Scene 7 then ambient state.
- Scene 1 must never restart during one activation run.
- Failure interrupts immediately and never exposes a misleading completion CTA.
- Reduced-motion mode preserves state/timing authority and uses settled/stepped presentation.
- `1024×820` reviewer viewport remains scroll-free.

### Automated certification

Final local regression evidence:

- focused activation Jest: **70/70 PASS**;
- canonical M1–M34 user-state matrix: **34/34 PASS**;
- matrix includes fast sync, normal sync, long/very-long sync, failure, reduced motion, visibility pause/resume, completion during multiple scenes, ambient/no-restart, resolve ceiling, completion-transition duration, `1024×820`, and reviewer-shaped first-run E2E;
- touched activation files: zero TypeScript errors under both checked frontend configurations.

### Real Shopify OAuth certification — 2026-09-01

Development store:

`development-store-15820042357.myshopify.com`

The live certification deliberately used the existing guarded reconnect OAuth path rather than fabricating Shopify callbacks.

Preparation:

1. reset the local development DB with `npm run dev:setup`;
2. safe seed created shop 1 + `owner@test.com` without a membership;
3. add only an owner membership and one encrypted placeholder `shopify_app_installations` row for the target development-store domain;
4. assert `user_lifecycle_snapshot = 0`;
5. assert `ft0_state = 0`.

Do **not** use `DEV_SEED_MODE=full_identity` or `DEV_SEED_MODE=full_data` for this first-activation certification: both seed FT2 lifecycle state and therefore invalidate the first-run condition.

OAuth initiation:

- authenticate the local dev owner;
- call:

`GET /api/v1/integrations/oauth/initiate?platform=shopify&shop=development-store-15820042357.myshopify.com`

- require the returned Shopify authorization URL to target the exact development-store domain;
- require:

`redirect_uri=http://localhost:3000/api/v1/integrations/oauth/callback/shopify`

- open the returned authorization URL in an already authenticated Shopify browser session;
- Shopify performs the real approval/authorization-code flow;
- do not fabricate HMAC, callback code, provider token, or sync completion.

Observed real-provider result:

- Shopify approval screen rendered successfully;
- callback returned to local LaSyncro;
- first-activation experience ran automatically;
- real sync completed;
- progress no longer started at 100%;
- progress increased through the story;
- completion used the non-blocking lower-right chip;
- normal application/aha flow followed.

Post-provider DB proof:

- target Shopify shop GID persisted;
- 10 canonical scopes persisted;
- `read_locations` present;
- `write_inventory` present;
- `integrations.sync_status = COMPLETED`;
- lifecycle advanced to FT2;
- `remaining_oauth_state_count = 0`;
- FT0 completion state persisted as expected.

Persistence / replay proof:

- hard refresh of `/overview` stayed in the normal application;
- first activation did not replay;
- fresh local/incognito entry resolved to the normal FT2 application;
- first activation did not replay.

### Certification boundary

This proof covers:

**real Shopify reconnect OAuth → authorization-code exchange → real scopes → real sync → first activation → lifecycle completion → persistence/re-entry**

It does **not** substitute for a separate genuine signed App-Store fresh-install test of the `/shopify/install` HMAC/timestamp entry point.

<!-- END SHOP-REVIEW-SYNC-ANIMATION-THEME-07 -->
