# Shopify App Store Submission Playbook

**Sprint:** LaSyncro Shopify App Store Listing  
**Date:** June 15–16, 2026  
**Last updated:** July 18, 2026  
**Status:** ✅ Submission-ready

---

## Overview

This playbook documents the full process of getting LaSyncro listed on the Shopify App Store, including all automated checks, infrastructure fixes, and production debugging performed during this sprint.

---

## Architecture Context

LaSyncro is a monorepo with three distinct production surfaces:

| Surface | URL | Platform |
|---|---|---|
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
|---|---|---|
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

## Shopify Billing — Managed Pricing Sync (verified 2026-07-18)
### Background
The original `/api/v1/shopify-billing/change-plan` endpoint (using `appSubscriptionCreate` directly) was retired June 2026 — Shopify rejects direct Billing API charge creation for apps on Managed Pricing ("Managed Pricing Apps cannot use the Billing API to create charges"). Plan selection now happens entirely on Shopify's hosted pricing page (`https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans`). The retirement left a gap: nothing synced the resulting plan state back into `shop_subscriptions`. Closed this session (SHB-01, SHB-07, SHB-13, SHB-16).

### Architecture

- `apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts` — `fetchShopifyBillingState(shopId)`. Treats the webhook as a trigger only; fetches authoritative state via the Admin GraphQL Active Subscription API (`currentAppInstallation.activeSubscriptions`), API version `2026-07`. Reusable for webhook-triggered, install-time, and future cron reconciliation.
- `apps/backend/src/api/shopify/handlers/handleAppSubscriptionUpdate.ts` — consumes the `app_subscriptions/update` webhook, calls the reconciliation service, upserts `shop_subscriptions` with `billing_provider: 'shopify'` stamped explicitly, re-seeds entitlements, and revokes the tier-downgrade diff (mirrors ISS-C19).
- Registered in `shopifyWebhooks.core.ts` (topic `app_subscriptions/update` → GraphQL enum `APP_SUBSCRIPTIONS_UPDATE`) and dispatched via `shopify.webhook.ts` / `shopify.webhook.router.ts`.

### Plan name → tier mapping
`AppSubscription` has **no `handle` field** (confirmed via GraphQL introspection) — mapping keys on the invoice-facing `name` string, normalized (trim, lowercase, hyphens/underscores collapsed to spaces) to tolerate formatting drift:
"Early-access" -> starter
"Core"         -> core
"Growth"       -> growth
"Scale"        -> scale
Partner Dashboard "Internal plan handle" values (`early-access`, `core`, `growth`, `scale`) are NOT used for mapping — they're invisible to the Admin API.

### Status mapping
`shop_subscriptions.status` has a DB check constraint written for Stripe's lowercase vocabulary (`trialing, active, past_due, canceled, unpaid`). Shopify's `AppSubscriptionStatus` enum (`ACTIVE, PENDING, DECLINED, EXPIRED, FROZEN, CANCELLED`) has no exact equivalents and is case-mismatched even for the success case — writing it raw violated the constraint on every status including `ACTIVE`. Mapped by semantic fit:
ACTIVE    -> active
PENDING   -> unpaid     (no payment collected, awaiting merchant decision)
FROZEN    -> past_due
DECLINED  -> canceled
EXPIRED   -> canceled
CANCELLED -> canceled
(no sub)  -> canceled

### SHB-13: forced-starter on non-active status
`resolveTierForShop` (used for the JWT `tier` claim on every token issuance, 15-min expiry) reads `shop_subscriptions.tier` verbatim — no code anywhere reads `status` for gating. So the reconciliation service forces `tier: 'starter'` whenever Shopify status isn't `ACTIVE`, regardless of the plan name on the (inactive) subscription, and the handler revokes the resulting downgrade diff. This is provider-agnostic risk in principle — see monetization_billing_playbook.md §24 for the equivalent open gap on the Stripe side (SHB-14, not yet fixed).

### SHB-16: webhook router shop-resolution bug (systemic, not billing-specific)
`WebhookRouter.dispatch` resolved `shopId` from `shopDomain` into a local variable but never wrote it back onto `envelope.shopId`. Latent since no prior Shopify handler read `envelope.shopId` directly; surfaced by `handleAppSubscriptionUpdate`. Fixed at the router (single point, mirrors ISS-B06 precedent) — `envelope.shopId = resolvedShopId` added immediately after resolution.

### Redirect URLs (Partner Dashboard, per plan)

- Core, Growth, Scale: `/settings/billing` (relative)
- Early-access: `https://app.lasyncro.com` (absolute, saved before the pattern was standardized — locked, cannot be changed retroactively per Shopify's own field constraint)
Both formats confirmed accepted by Shopify. Inconsistency is cosmetic only; billing settings page reconciles live state on load regardless of entry point.

### Live verification (2026-07-18)

A full subscription cycle was tested against dev store `development-store-15820042357` through the real hosted pricing page: Core → Early-access → Core. The `shop_subscriptions` row and `[shopify][app_subscription_update] complete` logs confirmed each transition, including revocation of 8 modules and 5 flags during downgrade. Shopify can deliver a transition as two events with different `eventId` values; the idempotent subscription upsert handles both safely.

### Shopify App Events usage billing — SHB-05-C/D/E/F

- `shopify_app_installations.shop_gid` stores Shopify’s canonical merchant GID.
- OAuth captures and validates `gid://shopify/Shop/…` while preserving any previously stored GID when the optional identity lookup fails.
- A real OAuth cycle persisted `gid://shopify/Shop/94567203186`.
- The published billing event handle is `shipped-order`.
- Early-access, Core, and Growth charge `$0.08` for each locally calculated shipped-order overage unit.
- Local included allowances remain 50, 200, and 1,000 respectively.
- Scale is unlimited and has no shipped-order usage meter.
- Core, Growth, and Scale use a 14-day trial; free Early-access has no trial.
- `shopify.events.service.ts` implements app-level authentication, token caching, tenant-scoped billing context, deterministic idempotency, one authentication retry, explicit operator logs, and non-fatal reporting.
- Client-credentials authentication returned HTTP `200`; unauthenticated event submission returned HTTP `401`.
- Runtime verification against the current Stripe-billed shop correctly skipped reporting with `billing_provider_is_not_shopify`.
- No billable App Event has yet been submitted; HTTP `202` acceptance and the asynchronous billing result remain unverified.

### Known open items

- **SHB-05-A/B:** connect provider dispatch while preserving the existing Stripe reporter.
- **SHB-05-G:** guarantee an open usage period before Shopify reporting is activated.
- **SHB-05-F deployment:** configure App Events credentials and `shipped-order` in every deployed runtime.
- **SHB-02:** dormant `handleShopifyCallback` still omits `billing_provider`; the retired charge-creation path remains unreachable.
- **AUD-C16:** Shopify extra-seat billing remains a separate unresolved product decision.

Shopify-billed shipped-order enforcement remains hard-cap-only until provider dispatch, open-period handling, deployed secrets, and one controlled billing event are live-verified.

A real OAuth cycle against the development store persisted `gid://shopify/Shop/94567203186`, while the integration completed normally. This is foundation only: App Events authentication, event submission, provider dispatch, and environment configuration remain pending under SHB-05-E/A/B/F. Shopify-billed shipped-order enforcement therefore remains hard-cap-only.

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

```
🔵 Starting OAuth callback for platform: shopify
[SYNC_JOB_ENQUEUED]
[sync.worker] Received sync job for integration ID: N
[SHOPIFY_SYNC_COMPLETED]
[FT0_COMPLETED_EVENT_EMITTED]
[FT2_READINESS_CHECK] { ready: true }
```

---

## Shopify App Capabilities

LaSyncro selected **"My app doesn't have any of these capabilities"** — it is a pure admin/operations tool with no checkout, embedded, blockchain, or storefront components.

---

## OAuth Redirect URL Whitelist

Both production and local dev URLs must be in the Shopify Partner Dashboard redirect list:

```
https://app.lasyncro.com/api/v1/integrations/oauth/callback/shopify
http://localhost:3000/api/v1/integrations/oauth/callback/shopify
```

---

## Remaining Known Issues (Non-blocking)

- Webhook "address already taken" errors on re-install — non-fatal, webhooks already registered
- `[SHOPIFY_WEBHOOK_REGISTRATION_FATAL] APP_BASE_URL missing` — resolved by setting `APP_BASE_URL` secret
- `[INGESTION_STALLED]` watchdog fires after sync on stores with stable order counts — false positive, harmless

## Reviewer Test Account Setup

App Store reviews don't require a published listing — reviewers install via OAuth directly. But because Scenario B was gated for 2.3.1 compliance (no manual store-domain entry; see below), the manual connect UI is removed. The reviewer therefore needs a **pre-connected account**, not a self-serve flow.

### Account

- **Email:** `contact@lasyncro.com` (inbox-accessible for email verification)
- Registered via normal UI signup → email verified.
- Login is NOT gated on `email_verified_at` (verified in auth.controller.ts).

### Connecting the store (manual, dev-side)

The frontend connect UI is gated, but the backend endpoint `GET /api/v1/integrations/oauth/initiate` is live. With a logged-in bearer token:
\`\`\`bash
curl -G "https://app.lasyncro.com/api/v1/integrations/oauth/initiate" \
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

Shopify sends real App Store install requests as GET to the exact App URL configured in the Partner Dashboard (this app's is the bare root, https://app.lasyncro.com) with shop, hmac, and timestamp query params appended, per Shopify's own OAuth documentation. The backend's handleShopifyInstall handler existed and was correctly implemented (HMAC validation, ghost-shop creation, billing_provider stamped at birth per SHB-01/03/04), but was only mounted at /api/v1/integrations/shopify/install. Nothing routed root-path traffic there, so a real install request would have silently fallen through to the SPA and served the login page instead, with the install parameters discarded entirely.

First fix attempt placed the install-detection check inside the app.get(*) catch-all, positioned after app.use(express.static(...)). Deployed cleanly but did not fix the issue — verified via response headers (etag, last-modified) showing express.static intercepts and serves index.html for bare / before any handler registered after it ever runs. Corrected by moving the check to its own app.get('/') handler registered before express.static, calling next() to fall through to normal SPA serving for any request that isn't install-shaped.

Live-verified against production: a request to / with shop and hmac params now reaches handleShopifyInstall and correctly returns 401 for an invalid signature (previously returned 200 with the SPA HTML). Confirmed no regression on /overview, /login, and plain / with no query params, which all still return 200 and serve the SPA correctly.

This closes the last known gap in the real App Store install path — the ghost-shop-creation and billing_provider stamping logic (SHB-01/03/04/18) is now actually reachable by a genuine Shopify-initiated install, not just correct in isolation.
