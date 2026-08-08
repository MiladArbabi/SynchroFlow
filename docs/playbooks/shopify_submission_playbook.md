# Shopify App Store Submission Playbook

**Sprint:** LaSyncro Shopify App Store Listing
**Date:** June 15–16, 2026
**Last updated:** August 8, 2026
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

```bash
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

```bash
https://app.lasyncro.com/api/v1/integrations/oauth/callback/shopify
http://localhost:3000/api/v1/integrations/oauth/callback/shopify
```

---

## Remaining Known Issues (Non-blocking)

- Webhook "address already taken" errors on re-install — non-fatal, webhooks already registered
- `[SHOPIFY_WEBHOOK_REGISTRATION_FATAL] APP_BASE_URL missing` — resolved by setting `APP_BASE_URL` secret
- `[INGESTION_STALLED]` watchdog fires after sync on stores with stable order counts — false positive, harmless
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

at a warehouse location where:

    warehouse_locations.active = true
    AND warehouse_locations.type IN ('bin', 'warehouse')

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

Worked for 1m 39s

Documentation audit is complete. The correct existing record is docs/playbooks/shopify_submission_playbook.md: it already contains SHOPIFY-CANON-REST-01, but that section still says deployment/remediation were pending, and the file currently ends immediately after that issue.

Only this documentation file needs updating for SHOPIFY-CANON-REST-02.

DOCUMENTATION Change 1 — update playbook date

File:

docs/playbooks/shopify_submission_playbook.md

BEFORE

**Last updated:** August 7, 2026

AFTER

**Last updated:** August 8, 2026
DOCUMENTATION Change 2 — close REST-01 implementation status

Find:

BEFORE

**Status:** Implementation verified locally; production deployment/remediation pending

Replace with:

AFTER

**Status:** CLOSED — mapper fix deployed and production-verified; historical remediation tracked separately in SHOPIFY-CANON-REST-02
DOCUMENTATION Change 3 — replace the existing REST-01 remediation tail and append REST-02

At the bottom of the file, replace this entire existing block.

BEFORE

### Production remediation status

At documentation time:

- the mapper fix has NOT been deployed to production;
- production event `546` has NOT been replayed;
- order `#1192` has NOT been manually repaired;
- its `incomplete_address` constraint has NOT been manually resolved;
- no production Release CTA mutation has been performed for `#1192`.

Production remediation must remain a separate verified step after deployment. Do not manually edit the projected order, line items, constraints, inventory, or batch state to simulate success.

AFTER

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
