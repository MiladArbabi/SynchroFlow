# Shopify App Store Submission Playbook

**Sprint:** LaSyncro Shopify App Store Listing  
**Date:** June 15–16, 2026  
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

## Shopify Billing — Plan Change Endpoint

Added `POST /api/v1/shopify-billing/change-plan` to allow merchants to upgrade/downgrade without reinstalling. Required by Shopify App Store review requirement "Allow pricing plan changes."

Files changed:
- `apps/backend/src/api/shopify/shopify.billing.controller.ts` — added `changeShopifyPlan()`
- `apps/backend/src/api/shopify/shopify.billing.routes.ts` — wired route

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