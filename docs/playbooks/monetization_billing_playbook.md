# LaSyncro — Monetization, Billing & Currency Playbook

> **Audience:** Engineers onboarding to LaSyncro, or picking up billing/monetization work.
> **Last updated:** July 15, 2026
> **Status:** Stripe subscription activation, flexible-billing periods, monthly usage rotation, and development-seed tier parity verified end-to-end.

---

## 1. Tier Architecture

Single source of truth: `packages/backend-core/src/config/tiers.ts`

| Tier | Price (USD/mo) | Seats | Order cap/mo | Shipped order cap/mo |
|---|---|---|---|---|
| Starter | Free | 1 seat (owner only) | 50 | 0 (no WMS) |
| Core | $79 | 3 non-owner seats | 2,000 | 200 |
| Growth | $179 | 5 non-owner seats | 10,000 | 1,000 |
| Scale | $349 | Unlimited | Unlimited | Unlimited |

- Seat count excludes the shop owner — limits apply to operators/admins only
- Annual billing = 20% discount (varies slightly per currency — see Stripe actuals)
- Extra seats purchasable above base limit: Core $15/seat/mo, Growth $12/seat/mo
- Shipped order overage: $0.08/unit (Core + Growth only), billed via Stripe Meter

**Module access by tier:**

- Starter: overview, orders (view only, 90-day window), fulfillment queue (view only — WMS actions locked), alerts, Shopify integration
- Core+: WMS (pick/pack/stow/receive, LSU/LSO labels), barcodes, returns processing, products, problem center (operational exceptions), 12-month order history
- Growth+: cash flow, demand forecasting, customer LTV, Specter, returns analysis (supplier correlation), problem center analytics, unlimited order history
- Scale+: floor planning, unlimited everything

**Order history data window:**

- Enforced at query layer in `orders.service.ts`, exports, and the FT2 snapshot clamp via `tierDataWindowSince()` utility
- Starter: 60 days · Core: 180 days · Growth+: unlimited
- Source: `packages/backend-core/src/utils/tierDataWindow.ts`

**Rule:** Never hardcode tier logic anywhere. Always import from `tiers.ts`.

---

## 2. Pricing Config

Single source of truth for display prices and Stripe Price IDs:
`packages/backend-core/src/config/pricing.config.ts`

### Supported billing currencies

| Currency | Symbol | Default for |
|---|---|---|
| USD | $ | Default (no locale match) |
| GBP | £ | `en-gb`, `en-ie` |
| EUR | € | EU locales (de, fr, nl, es, it, pt, pl, sv, da, fi, nb, cs, hu, ro, el, sk, sl, hr, bg, et, lv, lt, mt) |

### Display prices (minor units)

| Tier | USD mo | USD yr | GBP mo | GBP yr | EUR mo | EUR yr |
|---|---|---|---|---|---|---|
| Core | 7900 | 79000 | 5966 | 59660 | 6999 | 69999 |
| Growth | 17900 | 171840 | 13399 | 133990 | 15499 | 154900 |
| Scale | 34900 | 335040 | 28990 | 289900 | 32850 | 328499 |

### Key exports

```typescript
getStripePriceId(tier, currency, interval) // → Stripe Price ID from env
detectBillingCurrency(acceptLanguage)       // → BillingCurrency (called once at registration)
formatDisplayPrice(amountMinor, currency)   // → '$79', '£59', '€69'
PEGGED_DISPLAY_PRICES                       // → full price table
```

---

## 3. Stripe Products

All products live in Stripe dashboard (LaSyncro account).

### Subscription prices (18 total — 3 tiers × 3 currencies × 2 intervals)

Env var convention: `STRIPE_PRICE_{TIER}_{INTERVAL}_{CURRENCY}`

| | USD monthly | USD annual | GBP monthly | GBP annual | EUR monthly | EUR annual |
|---|---|---|---|---|---|---|
| Core | `price_1TLli7...` | `price_1TLliw...` | `price_1TiASC...` | `price_1TiATA...` | `price_1ThvEV...` | `price_1ThvDd...` |
| Growth | `price_1TLljT...` | `price_1TLlk2...` | `price_1TiAO4...` | `price_1TiAPK...` | `price_1ThvGJ...` | `price_1ThvFj...` |
| Scale | `price_1TLlkR...` | `price_1TLll7...` | `price_1TiAM8...` | `price_1TiAMy...` | `price_1ThvIF...` | `price_1ThvHj...` |

Starter: `price_1TLlhD...` (USD, $0, used as free plan anchor)

### Add-on prices

| Product | USD | GBP | EUR |
|---|---|---|---|
| Core extra seat/mo | `price_1TiAbb...` ($15) | `price_1TiAco...` (£12) | `price_1TiAcQ...` (€13) |
| Growth extra seat/mo | `price_1TiAdW...` ($12) | `price_1TiAe4...` (£10) | `price_1TiAdo...` (€11) |
| Shipped order overage (metered) | `price_1TiAvu...` ($0.08) | `price_1TiAhM...` (£0.06) | `price_1TiAh5...` (€0.07) |

Stripe Meter ID (overage): `mtr_61UrYp20kD4rNHkAv41755hv1pAEDVOC`
Event name: `overage`

**Rule:** Never reuse a Stripe Price ID for a different amount. Create new Price, keep old var until all subscriptions migrated.

---

## 4. Database

### `shop_subscriptions` (migration 0090)

One row per shop. Billing source of truth.

| Column | Type | Notes |
|---|---|---|
| `tier` | varchar | `starter\|core\|growth\|scale` |
| `billing_currency` | varchar(3) | `GBP\|USD\|EUR` — set once at registration, never updated |
| `billing_interval` | varchar | `monthly\|annual` |
| `status` | varchar | `trialing\|active\|past_due\|canceled\|unpaid` |
| `trial_ends_at` | timestamp | 14-day Growth trial, set at registration |
| `extra_seats` | integer | Purchased add-on seats above tier base |
| `stripe_customer_id` | varchar | Null until first checkout |
| `stripe_subscription_id` | varchar | Null until first checkout |

**Rule:** Never patch `billing_currency` after registration. Changing billing currency = new Stripe customer.

### `shop_usage_metrics` (migration 0091)

Tracks order ingestion and shipped order counts per billing period. Used for order cap enforcement (MON-05) and metered overage reporting.

---

## 5. Backend Data Flow

```
Registration
  └── detectBillingCurrency(Accept-Language header)
      └── INSERT shop_subscriptions { tier: 'growth', status: 'trialing',
                                      billing_currency, trial_ends_at: +14d }

Pay-Per-Order Setup (SEG-022-B)
  └── billing.controller.ts → createSetupSession
      └── POST /api/v1/billing/setup-payment-method
      └── no tier gate — Starter is the primary caller (via
          ShippedOrderCapBanner "Enable pay-per-order" CTA)
      └── reuses stripe_customer_id if present, else creates one
      └── stripe.checkout.sessions.create({ mode: 'setup', ... })
      └── card saved, no subscription, no charge

Stripe Webhook → handleCheckoutSetupComplete
  └── fires on checkout.session.completed
  └── guard: only acts if session.mode === 'setup' AND
      session.metadata.purpose === 'pay_per_order_setup'
      (this event type also fires for ordinary subscription
      checkouts — already handled via customer.subscription.created)
  └── persists stripe_customer_id to shop_subscriptions
  └── writes inside db.transaction + SET LOCAL "app.current_tenant"
      (RLS-protected table — session-level SET is not reliable
      across pooled connections, must be transaction-scoped)
  └── once stripe_customer_id is set, reportShippedOrderOverage's
      existing early-return (`if (!sub?.stripe_customer_id) return`)
      starts firing automatically — no change needed there

JWT issuance (token.service.ts)
  └── resolveTierForShop(shopId) → reads shop_subscriptions.tier
  └── embeds tier claim in access token

Auth middleware
  └── reads tier from JWT → req.user.tier (fallback: 'starter')

requireTier(minTier) middleware
  └── compares req.user.tier against tier order
  └── returns 402 if below minimum

WMS Pack-Complete → httpPackComplete
  └── increments shop_usage_metrics.shipped_orders (inside transaction)
  └── after transaction commits → reportShippedOrderOverage(shopId, billableCount)
      └── reads shop_subscriptions.tier + stripe_customer_id
      └── reads shop_usage_metrics.shipped_orders (current period total)
      └── calculates units newly crossing above shippedOrderCap
      └── stripe.billing.meterEvents.create({ event_name: 'overage', value: overageUnits })
      └── non-fatal — billing failure never blocks fulfillment
      └── skips if no stripe_customer_id (trial/starter shops)
      └── skips if Scale tier (shippedOrderCap = Infinity)

Stripe Webhook → invoice.payment_succeeded → handleInvoicePaid
  └── resolves shopId from envelope + reads current tier from shop_subscriptions
  └── idempotent: skips if open period already starts at invoice.period_start
  └── closes current open period (period_ends_at = period_start)
  └── inserts new open period (zeroed counters, tier snapshot, period_starts_at)
```

---

## 6. Shopify App Store Billing Path (MON-09)

`apps/backend/src/api/shopify/shopify.billing.controller.ts`

- Always bills in USD (Shopify App Store is USD-only)
- Uses `PEGGED_DISPLAY_PRICES[tier]['USD']` from `pricing.config.ts`
- Creates `RecurringApplicationCharge` via Shopify Admin API
- On callback activation: upserts `shop_subscriptions` + re-seeds entitlements
- Does NOT use Stripe

---

## 7. Entitlement Engine

### Backend

- `require-entitlement.middleware.ts` → `requireTier(minTier)` — gates API routes
- `shop_module_entitlements` table — seeded from `TIER_CONFIG[tier].modules` on subscription events
- `EntitlementsService.applyFromCommercialGrant()` — idempotent re-seeding

### Frontend

- `EntitlementsContext` — fetches tier + displayCurrency + billingCurrency from entitlements snapshot
- `usePlanEntitlement()` hook → `can(feature)`, `mustUpgradeTo(feature)`
- `PlanGate` component → `mode: 'locked' | 'teased'`
- `PLAN_FEATURES` registry in `usePlanEntitlement.ts` — maps feature keys to minimum tier

**Rule:** Never gate inline with raw tier strings in components. Always add to `PLAN_FEATURES` and use `PlanGate`.

---

## 8. Seat Limit Enforcement (MON-04)

`apps/backend/src/api/members/members.controller.ts` → `createMember`

- Reads `req.user.tier` from JWT
- Calls `getTierConfig(tier).seatLimit`
- Counts active `shop_memberships` rows
- Returns `403 SEAT_LIMIT_REACHED` with `{ current, limit, tier }` if at cap
- Effective limit = `seatLimit + extra_seats` (add-on seats from `shop_subscriptions`)

---

## 9. Order Cap Enforcement (MON-05)

`apps/backend/src/api/shopify/handlers/handleOrderCreated.ts`

- Open billing period created at shop registration in `shop_usage_metrics`
- Cap check reads `shop_usage_metrics.ingested_orders` from open period row
- Hard block at cap: ingestion returns early, order dropped
- Warn at 80% of cap via `[ORDER_CAP_APPROACHING]` console signal
- `ingested_orders` incremented after successful `domain_events` insert
- Falls back to `starter` cap (50) if no subscription row exists
- Scale tier: `monthlyOrderCap = Infinity` — cap check skipped entirely

---

## 10. Currency — Frontend (complete)

### Distinction

- `displayCurrency` — currency for showing merchant data (revenue, order values). User-configurable in settings.
- `billingCurrency` — currency the subscription is billed in. Set at registration, not user-configurable.

### What's done

- `shop_memberships.display_currency` + `locale` columns
- `PATCH /api/v1/members/me/currency` endpoint
- `EntitlementsContext` exposes `displayCurrency`
- `LocalizationSettings.tsx` — user can change display currency

### What's pending

- `billingCurrency` added to `EntitlementsContext`
- Backend entitlements snapshot to include `billing_currency` from `shop_subscriptions`
- Pricing page reads `billingCurrency` → replaces hardcoded `£` with `formatDisplayPrice(amount, billingCurrency)`

---

## 11. MON Issue Register — Final Status

| Issue | Description | Status |
|---|---|---|
| MON-01 | Tier constants (`tiers.ts`) | ✅ Done |
| MON-02 | `shop_subscriptions` table | ✅ Done |
| MON-03 | JWT tier claim + entitlements engine | ✅ Done |
| MON-04 | Seat limit enforcement | ✅ Done |
| MON-05 | Order cap enforcement | ✅ Done |
| MON-06 | Module gating (backend + frontend) | ⚠️ Partial — see §13 for confirmed gaps and fixes (2026-07-14) |
| MON-07 | 14-day Growth trial on registration | ✅ Done |
| MON-08 | Annual billing | ✅ Stripe prices exist, UI TBC |
| MON-09 | Shopify Billing API | ✅ Done |
| MON-10 | Upgrade prompt system | ✅ Done (PlanGate, PaywallSurface) |
| MON-currency | Multi-currency pricing | ✅ Backend done · 🔄 Frontend in progress |
| SEG-022-B | Pay-per-order Stripe Customer flow (lazy setup, no card at signup) | ✅ Done (2026-07-14) |

---

## 12. Adding a New Tier or Currency

### New currency

1. Create Stripe Price objects for all tiers × intervals in that currency
2. Add env vars: `STRIPE_PRICE_{TIER}_{INTERVAL}_{NEWCURRENCY}`
3. Add to `BillingCurrency` union in `pricing.config.ts`
4. Add to `CURRENCY_SYMBOLS`, `CURRENCY_LOCALES`, `PEGGED_DISPLAY_PRICES`, `PRICE_ID_ENV_KEYS`
5. Add to `detectBillingCurrency` locale detection
6. Update DB check constraint in migration 0090
7. Push new Fly secrets

### New tier

1. Add to `TIERS` array and `TIER_CONFIG` in `tiers.ts`
2. Create Stripe Price objects (3 currencies × 2 intervals = 6 prices)
3. Add to `PEGGED_DISPLAY_PRICES` and `PRICE_ID_ENV_KEYS` in `pricing.config.ts`
4. Add env vars + Fly secrets
5. Update DB check constraint in migration 0090
6. Add module set constant in `tiers.ts`
7. Update `requireTier` calls on routes as needed
8. Update `PLAN_FEATURES` in frontend `usePlanEntitlement.ts`

---

## 13. Gating Architecture Audit — Findings & Guardrails (2026-07-14)

> Full audit + implementation session. Confirmed multiple live tier-enforcement
> gaps despite MON-06 being marked "Done." This section documents the actual
> architecture as verified against live code and the database, the bugs found
> and fixed, and rules to stop this class of bug recurring.

### 13.1 There are THREE independent gating layers, not one

Contrary to §7's simplified description, tier gating is enforced in three
separate places that do not share logic and can silently disagree:

1. **Sidebar nav** — `resolveNavigation.ts` → `resolveNavVisibility.ts`.
   Correctly tier-aware. Not implicated in any bug found this session.
2. **In-page tab bar** — `components/ModuleTabBar.tsx`. Used by Warehouse,
   Orders, Finances, Returns, etc. Historically checked only the `feature`
   prop and silently ignored `requiredTier` — meaning any tab gated by
   `requiredTier` alone was unconditionally unlocked regardless of plan.
   **Fixed 2026-07-14** — `isLocked()` now checks both.
3. **Component-level** — `PlanGate` / `usePlanEntitlement()` /
   `PLAN_FEATURES`. Correct by design, but `PLAN_FEATURES` is a hand-maintained
   frontend map that can drift from backend `TIER_CONFIG` with nothing to
   catch it (see 13.4).

**Rule going forward:** any new tab/route must be checked against ALL THREE
layers if it appears in more than one — do not assume fixing the sidebar
also fixes the tab bar, or vice versa.

### 13.2 The real enforcement is the backend route, not the frontend

The frontend layers above are UX — they hide/show/badge things. The only
thing that actually stops a request is `requireTier()` in the Express route
chain (`authenticateToken → requireFt2 → requireTier → requireAction`).
**A frontend-only gate with no backend `requireTier` counterpart is not a
gate — it's a suggestion.** Every confirmed bug this session was a case of
exactly that.

### 13.3 Confirmed live defects found and fixed (2026-07-14)

| Defect | File(s) | Impact | Status |
|---|---|---|---|
| Floor Planning routes had zero `requireTier` | `floor-planning.routes.ts` (11 routes) | Starter shops could read/write full warehouse layout, zones, barcodes | ✅ Fixed — `requireTier('scale')` added to all 11 |
| Products routes had zero `requireTier` (and `/` had zero `requireFt2` too) | `products.routes.ts` (`/`, `/operator-summary`) | Starter shops could pull real margin/warehouse intelligence data | ✅ Fixed — `requireTier('core')` added to both |
| `ModuleTabBar.isLocked()` ignored `requiredTier` | `ModuleTabBar.tsx` | Floor Planning / Problem Center tabs unconditionally unlocked in-page regardless of plan, even though sidebar correctly blocked the same route | ✅ Fixed — now checks `requiredTier` against user's tier |
| Problem Center tagged `requiredTier: 'scale'` on frontend vs backend `requireTier('core')` | `FloorPlanningPage.tsx`, `ProblemCenterPage.tsx`, `warehouseModuleTabs.ts` | Once tab-bar enforcement was restored, Core customers would have been wrongly blocked from a feature they already pay for | ✅ Fixed — corrected to `'core'` in all 3 sites |
| Sidenav upgrade modal hardcoded `requiredTier="growth"` | `SidenavContent.tsx` | Clicking any locked sidebar item — regardless of actual required tier — told the user to upgrade to Growth specifically, risking wrong-plan purchase | ✅ Fixed — tier now tracked from the clicked item/child |
| Alert Rules routes had zero `requireTier` | `alerts.routes.ts` (`/rules` × 3) | Starter/Core shops could read/write alert rules (Growth feature) directly via API | ✅ Fixed — `requireTier('growth')` added to all 3 |

### 13.4 Known drift between frontend `PLAN_FEATURES` and backend `TIER_CONFIG`

`PLAN_FEATURES` in `usePlanEntitlement.ts` is maintained by hand and has no
automated check against `packages/backend-core/src/config/tiers.ts`. Cross-checked
2026-07-14:

- `alerts.inbox: 'core'` — backend has `alerts` in `STARTER_MODULES` (free).
  Mismatch confirmed, but **dead code** — not referenced by any live `PlanGate`
  call, so no user-facing risk today. Left as-is; clean up if the feature is
  ever wired up.
- `orders.sla_bands`, `orders.aging_orders`, `orders.quick_actions`,
  `orders.bulk_review`, `orders.pick_list` — no backend enforcement exists
  for any of these keys, and **none are referenced by any live `PlanGate`
  call**. Dead registry entries. Same treatment — leave until wired up, then
  verify against backend before shipping.
- Everything else in `PLAN_FEATURES` was spot-checked or verified live this
  session and matches backend (`wms.*`, `products.*`, `demand.forecasting`,
  
---

## 14. PLG Tier Restructure — 2026-07-14

> Product decision, not a defect fix: the original tier architecture gated
> the entire WMS pipeline behind Core, meaning free (Starter) users could
> see problems (SLA breaches, stockouts) on Overview/Orders but had no way
> to actually act on them — no pick, pack, stow, ship. This is the worst
> place to put a paywall in a freemium product: before any value is
> delivered. Restructured to a volume-gated model instead.

### 14.1 Rationale

Freemium products that convert well (Notion, Zapier, Mailchimp) let the
free tier **fully use the core loop at small scale**, then gate by volume.
Feature-gating the core loop itself converts nobody — users leave before
ever experiencing the product's value. The fix: open the full
Receive→Stow→Pick→Pack→Ship pipeline (including LSU/LSO barcode
generation) to every tier, gated purely by `shippedOrderCap` (volume),
not by module access.

### 14.2 Changes made

**Module list** (`packages/backend-core/src/config/tiers.ts`):
- `wms` + `barcodes` moved from `CORE_MODULES` → `STARTER_MODULES`.
- `floor-planning` moved from `SCALE_MODULES` → `GROWTH_MODULES` — fixes
  a circular dependency: Overview's live operations map is Growth-tier
  and renders the zones/bins Floor Planning creates; Floor Planning
  itself required Scale, so Growth shops saw a live map with nothing to
  visualize. Both now live at the same tier.
- `SCALE_MODULES` is now an explicit empty spread of `GROWTH_MODULES` —
  Scale's differentiation is seat/order caps only (`Infinity` across the
  board), no module-list-exclusive features remain by design.

**Route enforcement** — module grants and route-level `requireTier()` are
independent checks; moving a module in `tiers.ts` does **not** change any
hardcoded `requireTier()` literal in route files. Both had to be updated:
- `floor-planning.routes.ts` — 11× `requireTier('scale')` → `'growth'`.
- `wms.routes.ts` — ~30× `requireTier('core')` → `'starter'` across the
  full pick/pack/stow/ship/receive/scan/settings/printer/carrier-settings
  surface. **Intentionally left at `'core'`:** `/problem-center*` routes
  (6) and `/sender-addresses*` routes (4) — these remain genuine Core-tier
  product decisions, not part of the open core-loop pipeline.
- Frontend `requiredTier` badges corrected in 3 sites to match
  (`FloorPlanningPage.tsx`, `warehouseModuleTabs.ts`, `ProblemCenterPage.tsx`).

**Caps** (§1 table superseded — see below): Starter's `shippedOrderCap`
raised `0 → 50`. Core `seatLimit` raised `2 → 3`.

### 14.3 Updated §1 module table

Supersedes the module-access bullets in §1 — read this section as current:

- **Starter:** overview, orders (full pipeline access — no longer view-only),
  fulfillment queue, alerts, Shopify integration, **WMS pick/pack/stow/receive
  + LSU/LSO barcodes, gated by 50 shipped orders/period, not by module access**
- **Core+:** adds returns processing, products/catalog, problem center
  (supervisor exception queue), sender-address management, 12-month order
  history
- **Growth+:** adds cash flow, demand forecasting, customer LTV, Specter,
  returns analysis, problem center analytics, **floor planning + live
  operations map (moved from Scale)**, unlimited order history
- **Scale+:** unlimited seats, unlimited orders ingested/shipped — no
  additional module grants; differentiation is capacity only

### 14.4 Rule going forward

When moving a module between tiers in `tiers.ts`, always grep the
corresponding route file(s) for hardcoded `requireTier()` literals before
considering the change complete. The module list and route-level checks
do not share a single source of truth — verify both with live curl tests
at the old and new tier boundaries, the same discipline used throughout
§13.

---

## 15. Stripe Webhook Trust Boundary and Tenant Scope (verified 2026-07-15)

Stripe subscription activation follows one verified path:

1. Express captures the raw request bytes before JSON parsing.
2. `verifyStripeSignature` uses Stripe's official
   `webhooks.constructEvent()` implementation to validate
   `timestamp.rawBody`, signature selection, and timestamp tolerance.
3. The verified Stripe event replaces `req.body`; downstream code never
   receives an unverified event object.
4. `StripeWebhookAdapter` unwraps `event.data.object` and resolves
   `shopId` from subscription metadata.
5. `WebhookRouter` opens one transaction, applies
   `SET LOCAL app.current_tenant`, records the webhook ledger entry, and
   passes that same transaction to the handler.
6. `handleSubscriptionUpsert` upserts `shop_subscriptions` and seeds
   entitlements from the canonical tier configuration.

Handlers MUST use the transaction supplied by `WebhookRouter`. They must
not open an independent transaction or use the bare database singleton
for RLS-protected writes.

### Failure behavior

- Missing or invalid Stripe signatures return `400` before ledger or
  domain processing.
- Missing webhook configuration returns `500`.
- Handler failures are recorded in the ledger and return `500`, allowing
  Stripe to retry.
- Successful duplicate events stop at the ledger idempotency guard.

### Sandbox verification

A genuine LaSyncro sandbox subscription update was delivered through
Stripe CLI and verified end-to-end:

- HTTP response: `200`
- Ledger: `customer.subscription.updated`, `processed`, `verified=true`
- Subscription: Core, active, real Stripe customer/subscription IDs
- Entitlements: canonical Core grants seeded successfully

Stripe Test mode and named sandboxes are separate account namespaces even
though both use `sk_test_…` keys. The API key, Price IDs, Stripe CLI
login, and webhook listener must all target the same sandbox account.

### Flexible-billing period derivation

Stripe flexible-billing subscriptions expose current-period boundaries
on subscription items rather than the former top-level subscription
fields. `handleSubscriptionUpsert` therefore reads
`current_period_start` and `current_period_end` from the base tier item,
with top-level fallbacks for legacy payloads.

Verified against a genuine sandbox subscription update:

- Webhook response: `200`
- Ledger: `processed`, `verified=true`
- Database and billing API: matching non-null monthly period boundaries

---

## 16. Usage-Period Lifecycle (verified 2026-07-15)

Starter caps reset on UTC calendar-month boundaries through lazy rotation;
there is no cron dependency.

`getOrRotateOpenUsagePeriod()` runs inside the caller's tenant-scoped
transaction and is used by:

- Shopify order ingestion before cap evaluation and increment
- WMS pack-complete before shipped-order increment
- `GET /api/v1/billing/usage` before returning current usage

For Starter shops, the helper:

1. Acquires a transaction-scoped, per-shop advisory lock.
2. Returns the existing period when it belongs to the current UTC month.
3. Closes a stale period at the first instant of the current UTC month.
4. Opens a zeroed period using the shop's current tier snapshot.
5. Creates a missing open period instead of silently losing usage.

The partial unique index
`idx_shop_usage_metrics_one_open_period` remains the database backstop
against multiple open periods.

Paid tiers remain invoice-driven through `handleInvoicePaid`; lazy
calendar rotation does not replace their Stripe billing-cycle boundary.

### Verification

A rollback-only database test simulated June Starter usage and a July
read/write:

- June period closed at `2026-07-01T00:00:00.000Z`
- July period opened with zero ingested and shipped counts
- Original database state was fully preserved after rollback

A fresh-database live API test also confirmed that
`GET /api/v1/billing/usage` creates a missing open period and returns its
tier snapshot and zeroed counters.

---

## 17. Development Seed Tier Parity (verified 2026-07-15)

The development seed must never set `shop_subscriptions.tier` without
also deriving the corresponding module and flag grants from canonical
`TIER_CONFIG`.

`dev_seed.ts` seeds Growth by:

1. Reading `getTierConfig('growth')`.
2. Mapping its cumulative modules and flags into entitlement rows.
3. Applying them through
   `EntitlementsService.applyFromCommercialGrant()`.
4. Stamping the rows with source `dev_seed:growth`.

This mirrors production registration and Stripe subscription handlers.
A tier row alone is not sufficient: `/entitlements/me` reads module and
flag rows independently from the subscription tier.

Knex executes `dist/seeds/dev_seed.js`, so the backend build must run
after editing `seeds/dev_seed.ts` and before executing the seed.

Live verification confirmed that a freshly seeded Growth shop returns
the canonical Growth module and flag set through
`GET /api/v1/entitlements/me`.
---

## 18. Downgrade Revocation, Entitlement Deduplication, and Overage Billing Fixes (verified 2026-07-15)

### Downgrade entitlement revocation (ISS-C19)

`handleSubscriptionUpsert.ts` previously re-seeded the new tier's
entitlements on every webhook but never revoked modules/flags granted
by a shop's *previous* tier. A real Stripe downgrade (e.g. Growth to
Core) left the shop holding Growth-exclusive modules (`floor-planning`,
`customers`, `finances`, `demand`, `specter`) indefinitely, since
`EntitlementsService.applyFromCommercialGrant` is deliberately
additive-only by design.

Fixed by capturing the shop's prior tier before the subscription
upsert, then — only when the tier has actually decreased — diffing the
prior tier's modules/flags against the new tier's and calling
`EntitlementRevocationService.revokeEntitlements()`, mirroring the
existing pattern in `trial-expiry.service.ts` (previously the only
caller of that service).

Live-verified via two real Stripe subscription updates against a
sandbox subscription: a same-tier re-fire (Core to Core) produced zero
revocations, confirming no over-triggering; a real downgrade (Core to
Starter) correctly revoked exactly `returns`, `products`,
`problem-center` — precisely `CORE_MODULES minus STARTER_MODULES`. A
subsequent real Stripe upgrade webhook (Growth to Core) was also
observed correctly revoking all five Growth-exclusive modules/flags in
production code, not just in the downgrade direction.

Pre-existing entitlement rows granted outside the webhook path (e.g.
`dev_seed:growth` rows) are not retroactively cleaned up by this fix —
it only prevents *future* leaks going through
`handleSubscriptionUpsert.ts`. Other grant paths
(`auth.controller.ts`, `shopify.billing.controller.ts`,
`integration.controller.ts`, `commercial-grant.service.ts`) still call
`applyFromCommercialGrant` with no revocation step and remain an open
gap for a future pass.

### Entitlement row deduplication (ISS-C26)

The unique index on `shop_module_entitlements(shop_id, module_key,
flag_key)` never caught a conflict when `flag_key IS NULL` — the
common case for module-level grants — because Postgres treats `NULL`
as distinct from `NULL` for uniqueness. Every re-seed (every webhook,
checkout, or seat change) silently inserted a duplicate row instead of
being caught by `.onConflict().ignore()`. Shops observed with up to 6
duplicate rows for a single module during this session's testing.

Fixed at the base migration (`0022_shop_module_entitlements.ts`) by
adding a partial unique index:

```sql
CREATE UNIQUE INDEX shop_module_entitlements_open_module_unique
ON shop_module_entitlements (shop_id, module_key)
WHERE flag_key IS NULL AND valid_until IS NULL;
```

Scoped to open (`valid_until IS NULL`) rows only, so revoked history is
preserved and a shop can be re-granted a module after a prior
revocation without collision.

`EntitlementsService.applyEntitlementRows` (sealed, production-frozen)
was updated to split incoming rows: flagged rows keep the original
`.onConflict(['shop_id','module_key','flag_key'])` path; module-level
rows (`flag_key: null`) use a raw parameterized insert whose `ON
CONFLICT (shop_id, module_key) WHERE flag_key IS NULL AND valid_until
IS NULL DO NOTHING` clause matches the new partial index, since Knex's
`.onConflict(columns)` builder cannot express a partial-index conflict
target.

Verified via a dedicated regression test
(`tests/unit/backend/entitlements/entitlements.deduplication.test.ts`)
confirmed failing pre-fix (2 rows after 2 identical grants) and passing
post-fix (1 row), satisfying the sealed file's change policy
requirement of a failing test proving a broken invariant before
modification.

### Stripe metered overage billing — critical RLS fix (ISS-C34)

`stripe.meter.service.ts`'s `reportShippedOrderOverage` read
`shop_usage_metrics` via a bare, untenanted `db()` query.
`shop_usage_metrics_tenant_isolation_policy` has no open/system bypass
clause (unlike `shop_subscriptions` and `shop_module_entitlements`,
both of which permit reads when `app.current_tenant` is unset, `''`,
or `'0'`). Because the database session default for
`app.current_tenant` is `'0'`, the untenanted read did not error — it
silently matched zero rows on every call, for every shop, causing
`totalShipped` to always compute as `0` and the function to exit
before ever reporting to Stripe.

**Impact: overage billing had very likely never fired a single real
event in production** — any Core or Growth shop shipping past their
`shippedOrderCap` was never billed for the overage, a direct and
ongoing revenue leak since this service was written.

Confirmed via a controlled comparison — an identical query run bare
versus wrapped in `withTenant()` against the same row returned
`undefined` and the real row respectively.

Fixed by wrapping both reads (`shop_subscriptions`,
`shop_usage_metrics`) inside `withTenant(shopId, ...)`. Live-verified
end-to-end post-fix: seeded a shop at `shipped_orders: 210` against
Core's `shippedOrderCap: 200`, called the function with
`newlyShipped: 10`, and confirmed a correct `[stripe.meter] overage
reported` log with accurate math (`overageUnits: 10`) and a successful
Stripe Meter Event API call.

**Known minor issue, not yet fixed:** `STRIPE_METER_ID_OVERAGE` in
`.env` currently holds a Stripe Price ID rather than a Meter ID. This
is functionally harmless — the code only uses the variable as an
existence guard and hardcodes `event_name: 'overage'` directly in the
`meterEvents.create()` call — but the variable name and value should
be reconciled in a future pass to avoid confusion.

### Extra-seat add-on (AUD-C16) — full end-to-end verification closed

Previously built but never verified against a real Stripe subscription
across two prior sessions. Verified this session end-to-end against a
live sandbox subscription: `POST /api/v1/billing/add-seats` correctly
created a Stripe subscription item, the resulting
`customer.subscription.updated` webhook was received and processed
(`200`), and `shop_subscriptions.extra_seats` persisted correctly with
a matching timestamp. `AddSeatsModal`'s frontend behavior (pricing
display, stepper, secondary upgrade CTA) was previously confirmed
visually; this closes the remaining backend verification gap.
---

## 19. Growth/Scale Gate Audit (verified 2026-07-16)

Systematic cross-check of backend `requireTier()` route literals against
frontend `PlanGate`/`PLAN_FEATURES` gating and live endpoint behavior,
across all non-frozen modules. Two real defects found and fixed;
finances, cashflow, margin, and specter were excluded as frozen/
deprecated and not audited further.

### Frontend WMS pipeline incorrectly locked at Core (ISS-G1)

`PLAN_FEATURES` in `usePlanEntitlement.ts` gated `wms.pick_batches`,
`wms.pack`, `wms.stow`, `wms.problem_center`, and `wms.receive` all at
`'core'`, directly contradicting the backend's `requireTier('starter')`
on the same pipeline routes and the PLG decision (§14, 2026-07-14) that
the full Receive to Stow to Pick to Pack to Ship loop is free on
Starter, gated only by the shipment volume cap.

Impact: Starter shops saw the entire WMS module hidden behind an
"Upgrade to Core" wall in the live app, despite the backend correctly
allowing them through. This directly blocked the core PLG loop the
tier structure was designed to protect.

Fixed by correcting all five flags to `'starter'`. Live-verified
before and after: pre-fix screenshot showed the full-module lock
screen for a Starter shop; post-fix screenshot showed Operations
loading normally, with Floor Planning correctly tagged "Growth" and
Analytics/Problem Center correctly tagged "Core" in the tab bar —
confirming the intelligence layers above the free pipeline remain
properly gated.

### Backend customers routes had no tier gate (ISS-G2)

`customers.routes.ts` base routes (`GET /`, `GET /:id`) had no
`requireTier()` call at all — only `requireAction('customers:read')`,
which is pure RBAC (owner/admin/operator) with no plan awareness. No
global module-gating middleware exists in `bootstrap/express.ts`,
which mounts each router directly. `customers` is a Growth-exclusive
module (present only in `GROWTH_MODULES`, absent from
`CORE_MODULES`), so any authenticated Starter or Core shop could call
these endpoints directly and receive real customer data — a backend
paywall bypass, not caught by the frontend `PlanGate`, which only
hides the UI.

Fixed by adding `requireTier('growth')` to both routes, matching the
existing correct pattern on the sibling `customers.ltv` route. Live-
verified via a direct API call as a Core-tier shop, confirming `403`
post-fix (previously `200`).

Real-world severity note: `customers` is presently a frozen/hidden
module (same as finances/cashflow/specter), so no live user traffic
was exposed to this gap in practice — but any direct API call
(outside the UI) would have succeeded regardless, so the fix stands on
its own merits independent of the module's current frozen status.

### Modules confirmed clean, no drift

- **Products** — `requireTier('core')` on `/operator-summary` and `/`
  matches `PLAN_FEATURES` (`products.operator_summary`,
  `products.problem_center` both `'core'`).
- **Demand** — `requireTier('growth')` on the single route matches
  `PLAN_FEATURES['demand.forecasting']: 'growth'`.
- **Returns** — base routes `requireTier('core')`, `/correlation`
  `requireTier('growth')`, matches `returns` module tier and
  `PLAN_FEATURES['returns.analysis']: 'growth'` exactly.
- **Orders** — no backend tier gate on any route, and none needed.
  `orders.quick_actions`, `orders.bulk_review`, `orders.pick_list`,
  `orders.advanced_filters` are UI interaction affordances layered on
  the same order data every tier already receives via `GET /orders`
  and `GET /orders/:id` — there is no distinct dataset for a route
  gate to protect, unlike `customers`. Assessed as correct by design,
  not a gap.

### WMS analytics/carrier-infra gating confirmed correct

The 18 `requireTier('growth')` gates in `wms.routes.ts` were checked
individually against their route paths: all are analytics/
intelligence endpoints (`/analytics`, `/analytics/live`,
`/analytics/operators`, `/analytics/pipeline`, etc.) or carrier-
webhook-token management — layered features on top of the free core
pipeline, not the pipeline itself. No contradiction with the Starter
PLG decision.

### Scale-tier exclusive gates

Zero `requireTier('scale')` literals exist anywhere in the backend.
Confirmed intentional, not a gap: `SCALE_MODULES = [...GROWTH_MODULES]`
with no additions — Scale differentiates purely on capacity (unlimited
seats, ingested orders, shipped orders), matching the handover's
documented positioning. No module-level gate is needed because Scale
has no exclusive modules.
---

## 20. Development Navigation Bypass Fix (verified 2026-07-16)

`resolveNavVisibility.ts` previously contained an unconditional
`if (import.meta.env.DEV) return 'enabled';` at the top of the
function, bypassing both tier gating and module-entitlement gating for
every nav item in any local development environment. This made
upgrade-badge rendering completely untestable locally — a developer
browsing the sidebar in dev would never see the `↑ Growth`/`↑ Core`
badges or the locked-page teaser modal that a real user on an
insufficient tier would see, since everything always resolved as
`'enabled'`.

Practical risk: a tier-gating regression at the nav layer (distinct
from the `PlanGate`/backend-route bugs found in §19) could ship
undetected, since the most natural manual-testing path — browsing the
app locally — would never surface it.

Cross-checked every `requiredTier` nav entry in
`runtime/navBootstrap.ts` (Demand, Floor Planning, Supplier Ratings,
Returns) against its destination page for a second-layer safety net
(`PlanGate` and/or backend `requireTier()`). All four were confirmed
independently protected — the DEV bypass's impact was testability
only, not a live security gap.

Fixed by scoping the bypass to module-entitlement checks only,
preserving local dev convenience for shops whose seed data may
legitimately lack certain module grants, while allowing tier gating
(badges, teaser modals) to run and be testable even in DEV:

```ts
// Tier gate now runs unconditionally, including in DEV.
if (requiredTier) { /* ... */ }

// Module-entitlement bypass preserved for DEV convenience.
if (import.meta.env.DEV) return 'enabled';
if (!requiredModuleId) return 'enabled';
```

Live-verified post-fix: Starter-tier dev shop correctly shows faded
`↑ Growth`/`↑ Core` badges on Demand, Floor Planning, Returns,
Analytics, and Problem Center in the sidebar (never hidden, matching
the documented "requiredTier shows upgrade badge, never hides the
item" convention), and clicking a gated item correctly surfaces an
accurate "Unlock [feature]" upgrade modal with correct current/
required tier and live pricing — confirming the badge/teaser system
works correctly end-to-end now that it can actually be observed
locally.
---

## 21. Scale Value Proposition Review (verified 2026-07-16)

Non-technical review of Scale's pricing page presentation
($349/mo, unlimited seats/orders/shipments, $170/mo premium over
Growth) surfaced four real defects in `BillingSettings.tsx`, all
fixed and live-verified.

### Misattributed features in Scale's feature list (ISS-SCALE1)

`PLAN_FEATURES.scale` previously listed `'Warehouse floor planning'`
and `'Specter intelligence'` as Scale differentiators. Both are
already included in Growth — `SCALE_MODULES` has zero exclusive
modules beyond `GROWTH_MODULES` — so a Growth customer would see two
features they already pay for presented as new reasons to upgrade.
Specter is additionally deprecated/frozen, so this was also selling a
dead feature.

Corrected to reflect Scale's actual differentiation, which is capacity
only: `'Everything in Growth', 'Unlimited seats', 'No order or
shipment caps', 'Priority support'`.

Product note, not a code issue: with the misattribution removed,
Scale's genuine value proposition is thin — three capacity-only
differentiators for a $170/mo premium, no exclusive feature. Worth a
separate product decision on whether Scale needs a genuine new
capability (multi-warehouse, dedicated CSM, SLA guarantee, advanced
permissions) to justify the price gap, or whether the pitch should
lean harder into "you need >5 seats / >10K orders / >1K shipments,"
a segment for which Growth's caps are a hard operational blocker
rather than a nice-to-have.

### Billing tab missing page-level padding (ISS-SCALE2)

`BillingSettings.tsx` was the only settings tab not using the shared
`SettingsPageWrapper` (`ShopSettingsShared.tsx`), so its content
rendered flush against the shell's edges while every other tab had
standard `p: 2.5` spacing. Not adopting the wrapper directly, since
its `maxWidth: 640` would break Billing's 3-column tier grid and
2-column usage panel — matched only its edge padding via a new
outer `<Box sx={{ p: 2.5 }}>` wrapping the component's existing root.

### Core seat count display was stale (ISS-SCALE3)

`PLAN_SEATS.core` read `'2 non-owner seats'`, left over from before
Core's `seatLimit` was raised 2 to 3 (Starter-tier thread). Verified
against `members.controller.ts`: seat enforcement counts active
non-owner `shop_memberships` rows directly against
`TIER_CONFIG.core.seatLimit` (3), confirming the display was
undercounting what Core customers actually get. Corrected to
`'3 non-owner seats'`.

Also noted, not fixed (out of scope): `members.controller.ts` sets
tenant context via plain `SET app.current_tenant = '${shopId}'`
(string interpolation, not `SET LOCAL`, not parameterized) — same
category of pattern as ISS-SEC1 earlier this session, though `shopId`
here originates from a trusted JWT claim rather than user input.
Worth a dedicated pass separately.

### Tier card height mismatch (ISS-SCALE4)

Direct side effect of the ISS-SCALE1 copy fix: Scale's feature list
went from 5 bullets to 4, one shorter than Core and Growth (6 each),
and the tier-card grid used `alignItems: 'start'`, letting each card
size to its own content — Scale visibly looked shorter/incomplete
next to its siblings. Fixed by changing the grid to
`alignItems: 'stretch'` rather than padding Scale's list with a filler
bullet, which would have reintroduced the same dishonest-copy problem
ISS-SCALE1 removed. `TierCard`'s existing `flexDirection: 'column'`
layout supported the stretch correctly with no further changes needed.

All four fixes live-verified on `/settings/billing`: correct spacing,
correct Scale feature list, correct Core seat count (3 non-owner
seats), and all three tier cards rendering at equal height.
---

## 22. FT2 Order-History Window Enforcement (verified 2026-07-16)

Closes the handover's item 9 ("FT2 order-history window enforcement:
query-layer enforcement recorded, precomputed FT2 snapshot enforcement
remains pending"). Grew into three related fixes during
implementation, all live-verified.

### Tier-blind FT2 date range resolution (FT2-ORDER-WINDOW-01)

`tierDataWindowSince(tier)` (Starter: 90 days, Core: 365 days,
Growth/Scale: unlimited) was already correctly enforced at the live
query layer (`orders.service.ts`, `exports.controller.ts`). The FT2
snapshot system — dashboards, timeseries, coverage — had its own,
entirely separate date-range resolver (`resolveFt2Range` in
`packages/backend-core/src/utils/ft2Period.ts`) with zero tier
awareness. A Starter or Core shop could request an explicit custom FT2
range reaching arbitrarily far back and receive real data, even though
the equivalent live-query endpoint would correctly reject or truncate
the same request.

Mapped every live caller funneling through `resolveFt2Range`
(`orderNexusFt2.timeseries.ts`, `orderNexusFt2.coverage.ts`,
`overviewModulesFt2.resolver.ts`, reached via
`resolveFt2RangeFromRequest` from the Order Nexus facts controller and
directly elsewhere) — all six confirmed to converge on this single
function, making it the correct, sole choke point for the fix. Two
callers (Customers, Specter) were excluded — both frozen/deprecated
modules.

Fixed by adding an optional `tier: Tier` parameter (default `'starter'`,
the most restrictive, fail-safe value) to `resolveFt2Range`, clamping
the resolved `from` boundary against `tierDataWindowSince(tier)` when
it's more restrictive than the requested range — reusing the
already-correct query-layer utility rather than reimplementing window
logic. `tier` is threaded from `req.user?.tier ?? 'starter'` at each
controller, mirroring the existing pattern in `orders.controller.ts`.

Live-verified: a Core-tier shop requesting a custom range from
2020-01-01 was correctly clamped to ~365 days back; an in-window
`past_30_days` request passed through completely untouched, confirming
no over-clamping regression.

### Incidental discovery: coverage/distribution controller swap (FT2-COVERAGE-SWAP-01)

While testing the tier fix against `/ft2/facts/coverage`, the response
came back in the shape of `OrdersFt2Distribution` (always-zero stub),
not `OrdersFt2Coverage`. Traced to `orderNexusFt2Facts.controller.ts`:
`orderNexusFt2DistributionController` was calling
`getOrderNexusFt2Coverage`, and `orderNexusFt2CoverageController` was
calling `getOrderNexusFt2Distribution` — swapped relative to their own
names and mounted routes. `/coverage` had always silently served the
distribution stub; `/distribution` had always served real coverage
data mislabeled. Fixed by swapping the internal service calls back to
match each controller's name/route. Confirmed live: `/coverage` now
returns the real `OrdersFt2Coverage` shape, `/distribution` now
returns the stub shape.

### Incidental discovery: coverage query referenced nonexistent columns, crashed the process (FT2-COVERAGE-CRASH-01)

Fixing the swap made `getOrderNexusFt2Coverage`'s query reachable for
apparently the first time — it crashed the entire dev server process
immediately (unhandled Postgres error, no try/catch anywhere in the
call chain). The query referenced three columns that don't exist on
`order_revenue_units`: `shop_id` and `order_created_at` (both live only
on the parent `orders` table; tenant scope is enforced via RLS through
a subquery, not a direct column) and `id` (primary key is
`lasyncro_revenue_unit_id`). This service had very likely never worked
against the real schema — it was only ever protected from detection by
the controller swap routing real traffic elsewhere.

Fixed by rewriting the query to join `order_revenue_units` to `orders`
on `lasyncro_order_id`, filtering on `orders.shop_id` and
`orders.order_created_at` (using the existing purpose-built index
`orders_shop_id_order_created_at_index`), and counting the correct
primary key column. Also added try/catch with clean `500` responses
across all three FT2 facts controllers (timeseries, distribution,
coverage) so a future query error returns an error response instead of
crashing the process again.

Live-verified: `/coverage` now returns a real, correctly-shaped,
tier-clamped response (`totalLineItems`, `presentCost`, `missingCost`,
`completenessPct`) with no crash; server process confirmed alive and
stable after repeated test calls against both endpoints.
---

## 22a. Correction to §22 — real-world impact of the FT2 facts endpoints

Follow-up investigation (2026-07-16, same day) found that of the three
FT2 facts endpoints touched in §22, only `/ft2/facts/distribution` has
a wired frontend consumer (`useOrdersFt2Distribution.ts`) — and even
that hook is never actually called from any rendered component; it
and its backend service (`getOrderNexusFt2Distribution`) are a
permanent stub returning zeros. `/ft2/facts/timeseries` is not called
by the frontend at all — `useOrdersFt2Timeseries.ts`, despite its
name, calls a different, unrelated endpoint
(`/api/v1/orders/operational-pressure`). `/ft2/facts/coverage` has no
frontend caller whatsoever.

Practical correction: `FT2-COVERAGE-SWAP-01` and `FT2-COVERAGE-CRASH-01`
were both real, worth-fixing bugs — but neither had any live user
impact, since no real request ever reached either code path outside
of direct API testing. The severity language in §22 should be read as
"correct latent bugs," not "active incidents." The one fix from §22
with confirmed real-world impact is the `resolveFt2Range` tier-window
clamp itself (`FT2-ORDER-WINDOW-01`), which protects Overview's
snapshot resolver — a genuinely live, rendered surface.

## 23. Nav-Level Tier Gating Silently Defaulted to Starter for Every Shop (NAV-TIER-01, critical, verified 2026-07-16)

Discovered while visually verifying the FT2 date-range work: a
Core-tier shop clicking "Returns" in the sidebar was shown an "Unlock
returns" upgrade modal reading `NOW: Core → REQUIRED: Core` —
internally contradictory, since a shop already on the required tier
should never see a lock.

Root cause: `useResolvedNavigation.ts` calls `resolveNavigation()`,
whose `currentTier` parameter defaults to `'starter'` when not
explicitly passed. The hook only ever forwarded `entitlements: snapshot`
to `resolveNavigation` — it never extracted or passed `tier` as
`currentTier`. This meant nav-level tier gating (the sidebar's
own pre-navigation lock, separate from page-level `PlanGate` checks)
silently treated every shop as Starter, regardless of actual
subscription, for every tier-gated nav item: Demand, Floor Planning,
Supplier Ratings, and the entire Returns section.

**Impact: every paying Core/Growth/Scale customer saw an upgrade
prompt for features they already owned, every time they clicked
directly into a tier-gated section from the sidebar** — not a display
bug, a real access-friction bug actively working against retention and
trust for paying customers. `UpgradeModal`'s own "Now" label happened
to read the real tier correctly (via `useEntitlements().tier`
directly), which is what exposed the contradiction — the gating
decision and the tier displayed came from two different, disagreeing
sources.

This is distinct from `ISS-N1` (§20) — that was a DEV-only bypass
overriding gating locally; this is a production-affecting bug in the
gating logic itself, present regardless of environment.

Fixed by having `useResolvedNavigation.ts` also destructure `tier`
from `useEntitlements()` and pass it explicitly as `currentTier` to
`resolveNavigation`. Live-verified both directions: a Core-tier shop
now reaches the real Returns page directly from the sidebar; a
Starter-tier shop correctly sees the upgrade prompt with accurate
`NOW: Starter → REQUIRED: Core` labels.

Page-level `PlanGate` checks (e.g. WMS module content) were never
affected by this bug — they read tier correctly via a separate path
(`usePlanEntitlement`) — which is why WMS content itself displayed
correctly throughout today's earlier testing even while the sidebar's
own lock state was wrong.

### Order-history window tightened; Catalog RLS + sellability bugs (2026-07-17)

Revised `tierDataWindowSince()` constants (`packages/backend-core/src/utils/tierDataWindow.ts`) from Starter 90d/Core 365d to **Starter 60d/Core 180d**. Confirmed this single utility is the sole source for the order query layer, the FT2 snapshot clamp, and the export system — no other numbers to update except two stale duplicates found during the change (below).

**Found during the same session, fixed alongside:**

- **Stale duplicate window function (exports).** `exports.controller.ts` had its own private `tierDataWindowSince()` (hardcoded 365d for Core) instead of importing the shared utility — meant Core-tier CSV/PDF exports were still running on the old window even after the canonical constant changed. Replaced with an import; all three export call sites now correctly use 60/180.

- **Catalog RLS gap (ISS-RLS5).** `products.catalog.controller.ts` queried `variants`/`products`/`inventory_truth` with zero tenant context — no `withTenant()`, no `SET LOCAL app.current_tenant`. Under RLS this silently returned an empty result set for every shop (`{"variants":[]}`), rendering Catalog's product table permanently blank ("0 products · 0 variants") regardless of real data. Same missing-tenant-context pattern as the earlier `handleSubscriptionUpsert.ts` (ISS-RLS4) and `stripe.meter.service.ts` bugs. Fixed via `withTenant()`.

- **Missing "not received" sellability category (ISS-CAT3/CAT4).** `sellability.blocked` included a `noInventory` count (SKU exists, never received into warehouse) in its total, but no UI surfaced it — Catalog health showed a contradiction (Blocked: 3, all visible reasons: 0). Threaded `noInventoryProducts` end-to-end (backend facts → provider → frontend type → UI), added a dedicated pulse row, "Needs attention" entry, and product-table Status badge (ranked above Phantom in severity) so it no longer renders as "Zero stock."

- **Orphaned route (ISS-NAV1).** `/orders/inbound` is deprecated — unregistered from `ordersModuleTabs.ts` navigation, superseded by `/wms`'s receive-session flow, but still mounted in the router and still targeted by 2 `navigate()` calls in Catalog's phantom-stock CTAs. Both redirected to `/wms`.

- **Products operator-summary had no tier-window enforcement (ISS-MON1).** Unlike `orders.service.ts`/exports, `products.operator.controller.ts` passed client-supplied `preset`/`from`/`to` straight through with no clamp — any tier could request unrestricted historical drift/dead-weight/returns data via a custom range. Fixed by applying `tierDataWindowSince(tier)` the same way as the order query layer. Live-verified: a Starter shop requesting `from=2020-01-01` was correctly clamped to 60 days back.

- **Catalog date-range control relocated.** The FT2 date-range bar only ever scoped the Catalog drift card (never the product table or sellability panels, which are correctly snapshot-scoped) but sat page-level, above everything — implying broader scope than it had. Moved into the drift card itself using the lighter `FT2PresetSelector` (5 presets, no custom/calendar — deferred pending the tier-window fix above, to avoid shipping a custom-date UI on an endpoint that didn't yet enforce it). Card is now always visible (previously hidden when drift was zero, hiding the control along with it) and relocated above the product table per usability feedback (originally landed at page-bottom, below pagination).

All items independently live-verified via direct API calls and DB queries against seeded data; no regressions found in related surfaces (WMS Analytics tier-gating, Orders export windows) during verification.

**ISS-B1 — Starter usage-period rotation — confirmed closed, no code change.** This item had been carried forward across multiple sessions as "designed but never built." Investigation found `getOrRotateOpenUsagePeriod` (`apps/backend/src/api/billing/usagePeriod.service.ts`) already fully implemented — advisory-lock-serialized, tenant-scoped, wired into all 3 relevant call sites (`billing.controller.ts`, `wms.controller.ts`, `handleOrderCreated.ts`; `stripe.meter.service.ts` correctly excluded since it's Stripe-invoice-driven, not lazy-rotation). One deviation from the original design brief (30-day rolling window) — it rotates on the UTC calendar-month boundary instead — confirmed intentional and correct given `trial-expiry.service.ts`'s existing 14-day Growth-trial-to-Starter downgrade worker, which already absorbs any partial-period edge case at signup. Secondary flagged item (`integration.controller.ts` hardcoding `tier_at_period_start: 'growth'`) confirmed correct, not a bug — the Shopify App Store install path deliberately starts every shop on a 14-day Growth trial (`shop_subscriptions.tier: 'growth'`, `status: 'trialing'`) before trial-expiry downgrades to Starter. This ISS-B1 closure was never previously documented in this file, which is why it kept resurfacing as open across sessions — recorded here going forward.

## 24. Shopify Managed Pricing Sync — SHB Audit (verified 2026-07-18)

The `/api/v1/shopify-billing/change-plan` endpoint documented in earlier sessions (§9-era work, using `appSubscriptionCreate` directly) was retired June 2026 — Shopify rejects direct Billing API charge creation for apps on Managed Pricing ("Managed Pricing Apps cannot use the Billing API to create charges"). Plan selection moved entirely to Shopify's hosted pricing page. The retirement left a real gap: nothing synced the resulting plan state back into `shop_subscriptions`, meaning a merchant approving a paid plan on Shopify's own page got no entitlements at all. This session closed that gap end-to-end and caught two independent bugs that would have shipped otherwise.

### Architecture (SHB-01, SHB-07)

New `apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts` — `fetchShopifyBillingState(shopId)`. Treats the `app_subscriptions/update` webhook as a trigger only, not a data source; fetches authoritative state via the Admin GraphQL Active Subscription API (`currentAppInstallation.activeSubscriptions`), pinned to API version `2026-07` (confirmed current stable via `publicApiVersions` — the dormant controller's hardcoded `2024-01` was roughly 10 versions stale, itself a delisting risk independent of billing). Reusable for webhook-triggered, install-time, and future cron reconciliation — same shape as `handleSubscriptionUpsert`'s Stripe pattern, deliberately kept parallel.

New handler `apps/backend/src/api/shopify/handlers/handleAppSubscriptionUpdate.ts` calls the reconciliation service, upserts `shop_subscriptions` with `billing_provider: 'shopify'` stamped explicitly (never left to default — see SHB-02 below), re-seeds entitlements from tier constants, and revokes the tier-downgrade diff exactly mirroring ISS-C19's existing Stripe downgrade logic (§18).

Topic `app_subscriptions/update` added to the registration list and `GRAPHQL_TOPIC_MAP` in `shopifyWebhooks.core.ts`, dispatched via `shopify.webhook.ts` / `shopify.webhook.router.ts`, following the identical pattern as `app/uninstalled`.

### Plan name has no stable handle (SHB-12)

`AppSubscription` was assumed to expose a `handle` field parallel to the Partner Dashboard's "Internal plan handle" — confirmed via live GraphQL introspection (`__type(name: "AppSubscription")`) that it does not. Only `name` (the invoice-facing display string) crosses the API boundary. Tier mapping keys on `name`, normalized (trim, lowercase, hyphens/underscores collapsed to single spaces) after discovering the actual saved plan name is `"Early-access"` (hyphen) where the naive map key was `"early access"` (space) — a formatting mismatch that silently broke every free-tier sync until caught live:
"Early-access" -> starter
"Core"         -> core
"Growth"       -> growth
"Scale"        -> scale

### Status vocabulary mismatch (bug caught live, not by compile)

`shop_subscriptions.status` carries a DB check constraint (`shop_subscriptions_status_valid`) written for Stripe's lowercase lifecycle vocabulary: `trialing, active, past_due, canceled, unpaid`. The reconciliation service initially wrote Shopify's raw `AppSubscriptionStatus` enum value verbatim — `ACTIVE, PENDING, DECLINED, EXPIRED, FROZEN, CANCELLED`. This violated the constraint on **every** status, including the success case, since `'ACTIVE' !== 'active'` — a pure case mismatch, not specific to the edge-case statuses. `tsc` passed clean throughout; only live webhook testing against the real dev store surfaced it (`WEBHOOK_HANDLER_ERROR ... violates check constraint`). Mapped by semantic fit, confirmed with product owner where no exact Stripe equivalent exists:
ACTIVE    -> active
PENDING   -> unpaid     (no payment collected, awaiting merchant decision)
FROZEN    -> past_due
DECLINED  -> canceled
EXPIRED   -> canceled
CANCELLED -> canceled
(no sub)  -> canceled

### SHB-13 — forced-starter on non-active status, and the Stripe-side equivalent gap (SHB-14, still open)

Confirmed via direct inspection that `resolveTierForShop` (`packages/backend-core/src/services/shop-resolution.service.ts`) — the sole source for the JWT `tier` claim, re-derived on every `issueAuthTokens` call with a 15-minute access-token expiry — reads `shop_subscriptions.tier` verbatim and never inspects `status`. `requireTier` middleware likewise gates purely on the JWT's `tier` claim. This means a subscription in any non-active state leaves the merchant fully entitled at their last-known tier indefinitely, with no separate invalidation mechanism to fight — writing the correct `tier` to the DB is sufficient, and self-propagates within one token cycle.

For the Shopify path, the reconciliation service now forces `tier: 'starter'` whenever status isn't `ACTIVE`, and the handler revokes the resulting downgrade diff — same pattern as ISS-C19.

**This same gap exists on the Stripe side and is NOT yet fixed** — `handleSubscriptionUpsert` writes `status` from Stripe webhooks but nothing forces `tier` to `starter` on `customer.subscription.deleted` or sustained `past_due`. Tracked as SHB-14, recommended as a follow-up sprint using the identical fix pattern proven here.

### SHB-16 — latent webhook router bug, not billing-specific

`WebhookRouter.dispatch` (`apps/backend/src/api/webhooks/webhookRouter.ts`) resolves `shopId` from `shopDomain` into a local `resolvedShopId` variable for `SET LOCAL app.current_tenant` and ledger writes, but never wrote it back onto `envelope.shopId`. No prior Shopify handler read `envelope.shopId` directly (all resolved shop context some other way), so this was dormant until `handleAppSubscriptionUpdate` — first symptom was `missing shopId` despite dispatch and ledger succeeding, which correctly pointed at a write-back gap rather than a resolution failure. Fixed at the single router choke point (mirrors the ISS-B06 precedent, §-earlier) rather than patched per-handler: `envelope.shopId = resolvedShopId` added immediately after resolution. Any future handler reading `envelope.shopId` is now safe by construction.

### Live verification (2026-07-18)

Full cycle tested against dev store `development-store-15820042357` through the real hosted Managed Pricing page — not synthetic webhook payloads. Sequence: Core → Early-access → Core. Each transition confirmed via both the `shop_subscriptions` row and `[shopify][app_subscription_update] complete` log lines, including correct entitlement revocation (8 modules — returns, products, problem-center, customers, finances, demand, specter, floor-planning; 5 flags) on the Core→Starter downgrade step. Final state: `tier: core, billing_provider: shopify, status: active`. Shopify delivered each transition as two distinct webhook `eventId`s in testing — consistent with normal webhook-infrastructure duplicate delivery, not a bug; the existing idempotent `onConflict('shop_id').merge(...)` upsert absorbs it safely, same final state either way.

### Known open items, carried forward

- **SHB-02** — dormant `handleShopifyCallback` (dead code from the retired direct-charge flow) still omits `billing_provider` from its upsert. Low priority, unreachable code path.
- **SHB-03/SHB-04** — frontend has zero `billing_provider` awareness. `ShippedOrderCapBanner` and `BillingSettings` are Stripe-only; correctly 403 via existing `APP_STORE_MERCHANT` guards for Shopify-billed shops, but present no fallback UI routing to Shopify's hosted pricing page.
- **SHB-05** — pay-per-order overage and the AUD-C16 extra-seat add-on have no Managed Pricing equivalent designed (Shopify allows one recurring + one usage line item per subscription, no multi-item add-ons like Stripe's `subscriptionItems`). Product decision pending.
- **SHB-08** — `app/uninstalled` handler (`handleAppUninstalled.ts`) is an empty stub. Uninstall does not downgrade `shop_subscriptions` or revoke entitlements, despite Shopify auto-cancelling the underlying charge. Next priority.
- **SHB-09** — `manualSync.controller.ts` writes `uninstalled_at` to a column that doesn't exist on `integrations` per live schema query; unresolved, needs verification against the correct table before SHB-08 work begins.
- **SHB-14** — see above; Stripe-side equivalent of SHB-13, not yet fixed.