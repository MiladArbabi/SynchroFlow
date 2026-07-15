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

- Enforced at query layer in `orders.service.ts` via `tierDataWindowSince()` utility
- Starter: 90 days · Core: 365 days · Growth+: unlimited
- Source: `packages/backend-core/src/utils/tierDataWindow.ts`
- FT2 snapshot layer (pre-computed) — data window enforcement pending (separate ticket)

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
