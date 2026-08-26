# LaSyncro — Monetization, Billing & Currency Playbook

> **Audience:** Engineers onboarding to LaSyncro, or picking up billing/monetization work.
> **Last updated:** August 21, 2026
> **Status:** Stripe billing, Shopify Managed Pricing reconciliation, Shopify App Events Shop GID capture, and Starter WMS shipped-order enforcement verified end-to-end.

---

## 1. Tier Architecture

Single source of truth: `packages/backend-core/src/config/tiers.ts`

| Tier | Price (USD/mo) | Seats | Order cap/mo | Shipped order cap/mo |
|---|---|---|---|---|
| Starter | Free | Owner only (0 non-owner seats) | 50 | 50 |
| Core | $79 | 2 non-owner seats | 2,000 | 500 |
| Growth | $179 | 5 non-owner seats | 10,000 | 2,500 |
| Scale | $349 | Unlimited | Unlimited | Unlimited |

- Seat count excludes the shop owner — limits apply to operators/admins only
- Core includes 2 non-owner seats; Growth includes 5. Purchased extra seats are additive to those base limits
- Ordinary member invitation and role-change flows cannot create or promote another `owner`; ownership transfer requires a separate explicit flow
- Annual billing = 20% discount (varies slightly per currency — see Stripe actuals)
- Extra seats purchasable above base limit: Core $15/seat/mo, Growth $12/seat/mo
- Shipped order overage: $0.08/unit for finite-cap Stripe-billed tiers. Starter includes 50 WMS-completed orders/month. Stripe/direct Starter shops with a saved PPO payment method may continue above 50 and meter overage; Shopify-billed Starter shops must upgrade through Shopify once the allowance is exhausted.

**Module access by tier:**

- Starter: overview, orders, fulfillment queue, alerts, Shopify integration, and the full Receive→Stow→Pick→Pack→Ship WMS loop including barcodes; commercial usage is gated by the 50-order shipped allowance rather than a module wall
- Core+: everything in Starter plus returns processing, products, problem center (operational exceptions), and expanded commercial allowances
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

Tracks order ingestion and shipped order counts per billing period. `ingested_orders` is usage telemetry only and must never block Shopify ingestion. `shipped_orders` is the downstream commercial/WMS allowance meter used for overage reporting.

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
      early-return (`if (!sub?.stripe_customer_id) return`) no longer applies
  └── PPO does not change tier or ingestion behavior; Shopify order truth
      is always ingested regardless of commercial allowance

JWT issuance (token.service.ts)
  └── resolveTierForShop(shopId) → reads shop_subscriptions.tier
  └── embeds tier claim in access token

Auth middleware
  └── reads tier from JWT → req.user.tier (fallback: 'starter')

requireTier(minTier) middleware
  └── compares req.user.tier against tier order
  └── returns 402 if below minimum

WMS Pack-Complete → httpCompletePack
  └── validates batch state + packer ownership
  └── counts non-cancelled billable orders before mutating fulfillment state
  └── getOrRotateOpenUsagePeriod() serializes the shop usage period
  └── locks the exact open shop_usage_metrics row FOR UPDATE
  └── Starter execution guard:
      ├── projected shipped_orders <= 50 → continue
      ├── projected shipped_orders > 50 + Stripe billing + saved Stripe customer → PPO continues
      └── projected shipped_orders > 50 without Stripe PPO capability → HTTP 403 SHIPPED_ORDER_CAP_REACHED
  └── Shopify billing never uses a stray stripe_customer_id as PPO bypass
  └── rejected batches remain packing; usage and ready-to-ship alert state are unchanged
  └── accepted batch → status pack_complete + increment shop_usage_metrics.shipped_orders
  └── after transaction commits → reportShippedOrderOverage(shopId, billableCount)
      └── reads shop_subscriptions.tier + stripe_customer_id
      └── reads shop_usage_metrics.shipped_orders (current period total)
      └── calculates units newly crossing above shippedOrderCap
      └── stripe.billing.meterEvents.create({ event_name: 'overage', value: overageUnits })
      └── non-fatal — billing failure never blocks fulfillment
      └── skips if no stripe_customer_id
      └── Stripe/direct Starter with a saved PPO payment method can report
          shipped units above its shippedOrderCap
      └── Shopify-billed Starter is blocked at pack-complete above the cap
          and must use the Shopify upgrade path
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
- Counts active non-owner `shop_memberships` rows (`owner` is excluded)
- Starter base limit = 0 non-owner seats; Core = 2; Growth = 5; Scale = unlimited
- For Core/Growth, effective limit = `seatLimit + extra_seats` from `shop_subscriptions`
- Returns `403 SEAT_LIMIT_REACHED` with `{ current, limit, base_limit, extra_seats, tier }` if at cap
- Ordinary member creation accepts only `admin` or `operator`; `owner` returns `400 INVALID_ROLE`
- Ordinary role changes likewise cannot promote a member to `owner`
- Ownership transfer must be implemented as a separate explicit lifecycle operation

---

## 9. Order Usage Tracking (MON-05 / MON-PPO-02)

`apps/backend/src/api/shopify/handlers/handleOrderCreated.ts`

- Shopify order truth is always ingested; commercial plan limits must never discard a valid order webhook
- `monthlyOrderCap` is an allowance/telemetry threshold, not an ingestion boundary
- The handler reads the current open `shop_usage_metrics` period via `getOrRotateOpenUsagePeriod()`
- Warns from 80% of the allowance via `[ORDER_CAP_APPROACHING]`
- At or above the allowance, ingestion continues and emits `[ORDER_CAP_EXCEEDED_INGEST_CONTINUES]`
- `ingested_orders` increments only after a successful `domain_events` insert
- Falls back to the Starter tier configuration if no subscription row exists
- Scale has `monthlyOrderCap = Infinity`, so finite-cap warning telemetry is skipped
- WMS execution and pay-per-order billing enforcement belong downstream of ingestion and must not be moved back into the Shopify ingestion boundary
- Starter shipped-order enforcement is implemented atomically at WMS `pack-complete`; see MON-PPO-03 below

### MON-PPO-02 runtime proof — 2026-08-21

The pre-fix behavior was reproduced with Starter at 50/50 ingested orders and a saved Stripe PPO customer:

- Shopify `orders/create` webhook returned HTTP 200
- webhook ledger was marked `processed`
- no canonical `orders/create` domain event was created
- `ingested_orders` remained 50

After the fix:

- the same order #51 webhook returned HTTP 200
- webhook ledger was marked `processed`
- canonical `orders/create` domain event was persisted
- `ingested_orders` advanced from 50 to 51

`domain_events` is intentionally append-only, so the implementation-test event remains in the local canonical log. Mutable test subscription, usage, and Shopify-installation state was restored afterward.

### MON-PPO-03 — Starter WMS execution enforcement (historical; superseded by MON-ALLOW-04)

> **Superseded commercial behavior:** this section records the earlier Starter PPO design and its 2026-08-21 verification. The current contract is defined by MON-ALLOW-04 in §29: Starter always hard-stops above its included 50 fulfilled orders; configurable overage applies only to Core and Growth.

`apps/backend/src/api/wms/wms.controller.ts` → `httpCompletePack`

Commercial invariant:

> Shopify order truth is always ingested. Starter's commercial allowance restricts WMS execution at pack-complete, never canonical order capture.

Starter behavior:

| State | `pack-complete` behavior |
|---|---|
| Entire billable batch remains within 50 shipped orders | Allow |
| Would exceed 50, Stripe/direct billing, saved `stripe_customer_id` | Allow entire batch and report newly over-cap units to Stripe after commit |
| Would exceed 50, Stripe/direct billing, no saved PPO customer | `403 SHIPPED_ORDER_CAP_REACHED` |
| Would exceed 50, Shopify billing | `403 SHIPPED_ORDER_CAP_REACHED`; upgrade through Shopify |
| Scale | Unlimited; no shipped-order enforcement or overage |

The batch is evaluated atomically. If a batch would cross the remaining Starter allowance without PPO, the **entire batch is rejected** rather than partially completing orders.

Concurrency contract:

- `getOrRotateOpenUsagePeriod()` takes the transaction-scoped shop advisory lock
- the exact open `shop_usage_metrics` row is then read `FOR UPDATE`
- cap evaluation, `pack_complete`, usage increment, and ready-to-ship alert all occur inside the same transaction
- a rejected cap check therefore leaves batch status, usage, and alert state unchanged
- Core/Growth are intentionally not hard-enforced by MON-PPO-03 pending separate reconciliation of their final commercial allowances

Provider contract:

- Shopify App Store installs/reconnects are stamped `billing_provider='shopify'`
- Shopify-billed merchants cannot use Stripe checkout, setup-payment-method, seats, or portal flows
- Stripe webhooks must not overwrite an existing Shopify provider stamp
- Stripe/direct billing remains a separate supported/legacy path
- `stripe_customer_id` counts as Starter PPO capability only when `billing_provider='stripe'`

### MON-PPO-03 runtime proof — 2026-08-21

All approved cases were verified against the real WMS endpoint:

1. Starter `49 + 1`, no PPO → HTTP 200, usage `49 → 50`, batch `pack_complete`, ready-to-ship alert created.
2. Starter `50 + 1`, no PPO → HTTP 403 `SHIPPED_ORDER_CAP_REACHED`, usage remains 50, batch remains `packing`, no alert.
3. Stripe/direct Starter `50 + 1` with PPO capability → HTTP 200, usage `50 → 51`, batch `pack_complete`, alert created. Verification used an isolated local API with Stripe meter emission disabled; the post-commit reporter was reached and logged `STRIPE_METER_ID_OVERAGE not set`.
4. Shopify-billed Starter `50 + 1`, even with a stray Stripe customer ID → HTTP 403, `ppo_available:false`, usage remains 50, batch remains `packing`, no alert.

Mutable subscription, usage, batch, and alert fixtures were restored after each verification.

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
| MON-PPO-02 | Preserve Shopify ingestion beyond commercial allowance | ✅ Done (2026-08-21) |
| MON-PPO-03 | Starter WMS shipped-cap + PPO enforcement | ✅ Done (2026-08-21) |
| MON-ALLOW-04 | Fulfilled-order allowances + merchant overage preference + regression protection | ✅ Done (2026-08-26) |

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

The frontend layers above are UX — they hide/show/badge things. Security
enforcement must remain backend-owned. Route-level access is commonly enforced
through `requireTier()` / `requireAction()`, while narrower capabilities may
require field- or operation-level checks inside controllers/services.

Canonical feature checks should derive from backend tier configuration rather
than duplicate hardcoded tier comparisons. For example,
`exports.column_selection` is a Growth flag in `TIER_CONFIG`, and export
controllers enforce custom column selection with `tierHasFlag()`.

**A frontend-only gate with no corresponding backend enforcement is not a
security gate — it's a suggestion.** Every confirmed bug this session was a case of
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

### Transaction-abort recovery invariant (verified 2026-08-13)

`WebhookRouter` is shared webhook infrastructure, so a PostgreSQL error inside
a handler must not poison the transaction that still needs to finalize the
webhook ledger.

Registered handler execution is therefore isolated behind a router-level
savepoint. If the handler throws, or returns while leaving PostgreSQL in an
aborted transaction state, the router rolls back to that savepoint before
writing the `failed` ledger state. The outer transaction can then commit the
failure record before the captured error is rethrown.

A handler that intentionally catches a PostgreSQL error and wants to continue
or return successfully MUST protect that tolerated operation with its own
local savepoint. The required sequence is:

1. `SAVEPOINT` before the potentially failing database operation.
2. On success, `RELEASE SAVEPOINT`.
3. On a tolerated error, `ROLLBACK TO SAVEPOINT` and then
   `RELEASE SAVEPOINT` before `return` or `continue`.
4. Any non-tolerated error is rethrown after transaction state has been
   restored.

Catching a database error without local savepoint recovery is not sufficient:
PostgreSQL keeps the transaction aborted. The router-level savepoint is the
final backstop and will convert that unsafe swallowed error into a failed
webhook rather than falsely marking it processed.

Unsupported-event optional `domain_events` persistence follows the same
isolation rule so an optional persistence error cannot roll back an already
recorded `ignored` ledger state.

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
Core's then-current `shippedOrderCap: 200` (historical; current cap is `500`), called the function with
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
## 25. Shopify Uninstall Handling — Grace-Period-Aware Downgrade (SHB-08, SHB-08a, SHB-09, verified 2026-07-18, live test deferred)

`app/uninstalled` was an empty stub (`// domain logic`, no body) prior to this session — uninstalling the app left `shop_subscriptions` and entitlements completely untouched, so a merchant who uninstalled kept full paid access indefinitely. Closed this session, with one explicit product requirement driving the design: **a merchant on a paid plan who uninstalls must keep access until the end of the period they already paid for** — not be cut off immediately.

### SHB-09 — uninstalled_at lives on the correct table, actively consumed

Initial audit checked `integrations` and found no `uninstalled_at` column, flagging it as a possible dead-code reference in `manualSync.controller.ts`. Resolved: the column is real, lives on `shopify_app_installations` (a separate, purpose-built OAuth/token table — confirmed via `\d shopify_app_installations`), and is actively read as a sync gate (`manualSync.controller.ts` refuses to sync where `uninstalled_at` is not null) and consulted for reinstall detection (`integration.controller.ts`'s "Check for any existing installation" comment). It was simply never written by anything — dead on the write side, live on the read side, meaning the sync-gating and reinstall-detection logic have been silently inert since the column was created.

### Why the safety-net design changed mid-implementation

Original plan: `handleAppUninstalled` would call the same live `fetchShopifyBillingState` reconciliation used by `handleAppSubscriptionUpdate`, as a fallback in case a free-tier shop's uninstall doesn't trigger a separate billing webhook. Caught before writing code: Shopify typically revokes the shop's access token at or near uninstall time, so a live Admin API call from the uninstall handler would likely fail against an already-dead token. Redesigned to be **DB-only** — the safety net reads whatever `shop_subscriptions.current_period_end` was already captured the last time the token was valid, rather than calling out live. Documented as a known, accepted limitation: if `app_subscriptions/update` also fires around uninstall time and the token's already dead by then, that webhook's live-fetch attempt will fail and its retries will exhaust uselessly — harmless, since `uninstalled_at` is set independently by the uninstall handler and the grace-sweep worker still catches the eventual downgrade from DB state alone.

### Architecture

- **`apps/backend/src/services/shopify/forceDowngradeToStarter.service.ts`** (new) — `forceDowngradeShopToStarter(shopId, trx, reason)`. DB-only, idempotent (no-op if already Starter). Downgrades tier, sets `status: 'canceled'`, revokes the tier-diff entitlements. Extracted as a shared primitive rather than duplicated, since two call sites need identical logic (see below).
- **`apps/backend/src/api/shopify/handlers/handleAppUninstalled.ts`** (rewritten from stub) — now takes `(shopId, trx)` instead of `{ shopDomain }`. Writes `uninstalled_at`, then checks the stored `current_period_end`: if it's null or already past, calls `forceDowngradeShopToStarter` immediately; if still in the future, logs and defers — the sweep worker will catch it later purely from DB state.
- **`apps/backend/src/api/shopify/handlers/appUninstalled.handler.ts`** (wrapper) — updated to pass `envelope.shopId` (populated since the SHB-16 router fix) instead of `envelope.shopDomain`, and to call the new two-argument `handleAppUninstalled` signature.
- **`apps/backend/src/services/shopify/shopifyUninstallGrace.service.ts`** + **`apps/backend/src/workers/shopifyUninstallGrace.worker.ts`** (new) — mirrors `trial-expiry.service.ts`/`.worker.ts` exactly: 6-hour poll, per-shop error isolation, DB-only sweep for `billing_provider: 'shopify'` shops with `status IN ('canceled', 'past_due')`, non-`starter` tier, and `current_period_end` in the past. Registered in `apps/backend/src/bootstrap/workers.ts` following the identical registration pattern as the trial-expiry worker.

### Grace-period status scope (product decision, confirmed)

Only `CANCELLED` (explicit cancel or uninstall, which auto-cancels the charge) and `FROZEN` (payment failure on a previously-active subscription — same semantics as Stripe's `past_due`, conventionally given a dunning/grace window) get the paid-until-period-end treatment. `DECLINED` and `EXPIRED` mean the merchant never completed approval in the first place — no period was ever actually purchased — so those downgrade immediately via `shopifyBillingReconciliation.service.ts`'s existing logic (§24), unrelated to the uninstall-specific grace mechanics documented here.

### SHB-08a — reinstall must clear uninstalled_at

Found while designing the uninstall handler: the OAuth reinstall path's `shopify_app_installations` upsert (`integration.controller.ts`) had an `onConflict(['shop_domain']).merge(...)` that omitted `uninstalled_at`. Harmless while nothing wrote that column, but the moment SHB-08 started writing it, a merchant who uninstalled and later reinstalled would stay permanently flagged as uninstalled — silently blocking `manualSync.controller.ts`'s sync gate forever, with no error explaining why. Fixed alongside SHB-08 in the same session rather than deferred, since shipping one without the other would have introduced a new bug. Both the insert and merge clauses now explicitly set `uninstalled_at: null`.

### SHB-19 — dead duplicate handler file removed

Found mid-implementation: `apps/backend/src/api/shopify/handlers/shopifyHandlers.ts` exported an identical `onShopifyAppUninstalled` function to the live `appUninstalled.handler.ts`, but was never imported anywhere — confirmed via repo-wide grep. Nearly edited the wrong file as a result. Deleted.

### Live verification status

Code-complete, `tsc` clean across all touched files. **Live uninstall/reinstall testing deliberately deferred** — unlike the plan-change testing in §24, exercising this path safely requires an actual uninstall/reinstall cycle on the dev store, which is more disruptive to test mid-session. Decision: defer to the pre-submission full install/uninstall cycle test, where this needs to be exercised anyway. Do not submit without running it at least once by then.

### Known open items, carried forward

- **SHB-02** — dormant `handleShopifyCallback`, still low priority, unreachable code path.
- **SHB-03/SHB-04/SHB-18** — frontend has zero `billing_provider` awareness; also needs a cancel/downgrade CTA (deep-link to Shopify's hosted pricing page) and an uninstall CTA (deep-link to Shopify's app-management page, since we cannot uninstall on the merchant's behalf via any API) on the Billing/General settings screens.
- **SHB-05** — pay-per-order overage / AUD-C16 seat add-on Managed Pricing equivalent, product decision pending.
- **SHB-14** — Stripe-side equivalent of SHB-13 (force-starter on non-active status), not yet fixed.

## 25. Shopify Billing Frontend Awareness — SHB-03/04/18 (verified 2026-07-18)

§24 closed the backend sync gap but left the frontend entirely Stripe-only: `BillingSettings`, `ShippedOrderCapBanner`, and `AddSeatsModal` had zero awareness that a shop could be billed through Shopify. Shopify-billed shops hit the existing `APP_STORE_MERCHANT` 403 guards silently or saw dead-end error copy referencing a "coming soon" state that was no longer accurate post-Managed-Pricing. This session closed that gap end-to-end.

### Transport

`GET /api/v1/billing/subscription` now returns `billing_provider` and a server-composed `manage_billing_url` for Shopify-billed shops (`https://admin.shopify.com/store/{store_handle}/charges/{app_handle}/pricing_plans`), built from `shopify_app_installations.shop_domain` and a new `SHOPIFY_APP_HANDLE` env var — the frontend never constructs or guesses the app handle. `GET /api/v1/entitlements/me` gained a parallel `billingProvider` field so every component using `useEntitlements()` (banners, modals, settings pages) gets the signal without an extra fetch, refreshed on the existing 15-minute JWT cadence. `EntitlementsContext` threads `billingProvider` through state, the payload/context-value interfaces, and the last-known-good-snapshot restore path used during auth refresh churn.

Note the operational gotcha hit while wiring this: `apps/backend/.env` (loaded via `dotenv.config()` in `server.ts`, cwd-relative to `apps/backend`) is a distinct file from the repo-root `.env` — env var additions must go to the former or they're silently invisible to the running process. `apps/backend/.env` was also found to have a duplicate `SHOPIFY_API_VERSION` key (line 31 `2024-01`, line 67 `2024-10` and later with `2026-04`); dotenv keeps the first occurrence, so the app has been running on `2024-01` since whoever added the `2024-10` line believed they'd upgraded it, and later changed with `2026-04`. Tracked as **SHB-20**, deferred — fixing it changes the live Shopify API version mid-sprint, and yesterday's §24 Managed Pricing verification ran under the current config.

### Frontend branching

`BillingSettings.tsx`: `handleUpgrade` and `handlePortal` now check `sub.billing_provider` first — Shopify-billed shops open `manage_billing_url` in a new tab (preserving the app's session rather than a full-page redirect) instead of hitting Stripe checkout/portal. The Monthly/Annual interval toggle and the "Switch to annual" savings callout are hidden entirely for Shopify-billed shops, since interval selection lives on Shopify's hosted page, not in-app. A footer-placed guidance line (**SHB-18**) tells Shopify-billed merchants they can cancel via plan change on the hosted page or by uninstalling from their store's app settings (URL derived from `manage_billing_url` by replacing the `/charges/...` suffix — no new backend field needed) — placed at the bottom of the tab by design decision, so cancellation guidance doesn't compete visually with upgrade CTAs.

`ShippedOrderCapBanner.tsx` and `MembersPage.tsx`'s seat-limit modal implement the **SHB-05 interim decision**: pay-per-order overage and the AUD-C16 extra-seat add-on have no Managed Pricing equivalent (Shopify allows one recurring + one usage line item per subscription, no multi-item add-ons like Stripe's `subscriptionItems`), so both surfaces are suppressed for Shopify-billed shops in favor of a hard cap plus an upgrade-plan CTA. This is explicitly parity-minus, not parity — Growth/Scale merchants on Shopify billing have no seat-add-on path and Starter merchants on Shopify billing have no pay-per-order overage path until a real Managed Pricing usage-charge design is scoped.

### Live verification (2026-07-18)

Full round trip tested against `development-store-15820042357` through the real hosted Managed Pricing page: Manage Billing → hosted plan page → select Starter → `app_subscriptions/update` webhook → `[shopify][billing_state_applied] entitlements revoked` (Core→Starter, 3 modules) → then reverse, select Core → webhook → `[shopify][app_subscription_update] complete` re-granting Core. Both directions confirmed via backend logs; each transition delivered as two webhook `eventId`s per the known Shopify duplicate-delivery behavior (§24), absorbed safely by the existing idempotent upsert.

### Known open items, carried forward

- **SHB-05** — pay-per-order and extra-seat Managed Pricing equivalents remain undesigned; current state is intentionally hard-cap-only for Shopify-billed shops.
- **SHB-14** — Stripe-side equivalent of §24's SHB-13 fix; `handleSubscriptionUpsert` does not yet force `tier: starter` on Stripe cancellation/`past_due`. Next priority.
- **SHB-20** — duplicate `SHOPIFY_API_VERSION` in `apps/backend/.env`, deferred.
- **ShippedOrderCapBanner Shopify-billed path** — verified via code review and tsc only; not yet visually exercised in-browser (requires a shop at ≥75% of its shipped-order cap). Will be exercised naturally during the pre-submit full uninstall/reinstall cycle test (SHB-08a).

## 26. SHB-14/14b — Stripe tier-forcing on terminal statuses; env-file consolidation (verified 2026-07-18)

### SHB-14 / SHB-14b

§24 established that `resolveTierForShop()` reads `shop_subscriptions.tier` verbatim with no status check, and that Shopify-side handlers correctly force `tier: 'starter'` whenever Shopify's billing state is non-entitled (SHB-13). No Stripe-side equivalent existed: `handleSubscriptionUpsert` wrote `metadata.tier` unconditionally regardless of Stripe's subscription `status`, and `handleSubscriptionDeleted` never touched `tier` at all. A Stripe subscription reaching `canceled` or `unpaid` — the two genuinely terminal states per the `shop_subscriptions_status_valid` check constraint (`trialing, active, past_due, canceled, unpaid`) — left the shop's paid-tier entitlements intact indefinitely. `past_due` is deliberately excluded from this fix: Stripe's own dunning/retry grace period applies there by design (documented in `handlePaymentFailed.ts`), and entitlements are meant to stay live during that window.

Both handlers now force `tier: 'starter'` on `canceled`/`unpaid`, with the `tier` reassignment placed *before* `tierConfig` is computed in `handleSubscriptionUpsert` — critical ordering, since computing `tierConfig` from the stale paid tier while writing `starter` to the DB would have re-seeded entitlements for the wrong tier.

Live-verified via hand-signed synthetic Stripe webhooks (see below) against an isolated test shop: `customer.subscription.updated` with `status: 'unpaid'` correctly forced `growth → starter` and triggered the existing `ISS-C19` downgrade-revocation diff (8 modules, 5 flags revoked, logged). `customer.subscription.deleted` correctly forced `tier: 'starter'` and `status: 'canceled'`, but — this session's key discovery — **did not** trigger any entitlement revocation, because `handleSubscriptionDeleted` has never called `EntitlementRevocationService`, per its own docblock ("Does NOT revoke entitlements — handled by separate revocation flow"). That separate flow does not, in fact, cover this handler. Tracked as **SHB-14b**, open: `tier` now corrects correctly on hard-delete, but stale `shop_module_entitlements` rows can persist until some other event touches the shop. In practice this is narrowed by Stripe's typical event ordering (an `updated` event carrying `status: canceled` usually precedes `deleted`, and would hit the revocation path in `handleSubscriptionUpsert`), but is not guaranteed.

### Synthetic Stripe webhook testing method

`verifyStripeSignature` performs real HMAC verification via `stripe.webhooks.constructEvent` — no dev bypass exists. Testing required hand-constructing valid signatures: `HMAC-SHA256(STRIPE_WEBHOOK_SECRET, "{timestamp}.{raw_body}")`, sent as `Stripe-Signature: t={timestamp},v1={signature}` via `openssl dgst -sha256 -hmac`. This is now the standing method for any future Stripe webhook testing in this codebase — the Stripe CLI's `stripe trigger` was evaluated and rejected for this purpose, since its fixtures don't allow arbitrary `status`/`metadata` control.

### SHB-20/21/22/23/24 — `.env` consolidation

Testing surfaced a deeper environment-configuration problem than initially scoped. Two `.env` files existed — repo-root `.env` and `apps/backend/.env` — with divergent values for `STRIPE_WEBHOOK_SECRET`, `SHOPIFY_API_VERSION` (SHB-20), and, most seriously, `STRIPE_SECRET_KEY`: `apps/backend/.env` held a **live-mode** Stripe key while root `.env` held the test-mode key (**SHB-22**). Root cause (**SHB-21**): `apps/backend/scripts/node-start.js` explicitly loads root `.env` before the compiled `server.js` (which calls bare `dotenv.config()`) is even imported; since dotenv never overwrites an already-set key, root `.env` silently won for any key present in both files, while `apps/backend/.env` only won for keys unique to it (e.g. `SHOPIFY_APP_HANDLE`, added earlier this session and initially placed in the wrong file for exactly this reason). `apps/backend/.env` also carried an unsuffixed, currency-incomplete set of Stripe price IDs (**SHB-24**) that would have silently broken GBP/EUR pricing had precedence ever flipped, and root `.env` had a corrupted line (**SHB-23**) where `STRIPE_METER_ID_OVERAGE`'s value was fused with a no-newline `SHOPIFY_APP_HANDLE=lasyncro` append from earlier in this session.

Both files were confirmed gitignored with no git history (`git log --all -- .env apps/backend/.env` empty) — the live key was never committed, limiting SHB-22's actual exposure. Resolution: root `.env` established as the single source of truth; the corrupted line fixed; `SHOPIFY_API_VERSION`/`SHOPIFY_APP_HANDLE` merged in; `apps/backend/.env` deleted entirely. `server.ts`'s bare `dotenv.config()` was left unchanged (harmless redundant re-load of the same now-single file) rather than risk touching the loader itself. Post-consolidation, `GET /billing/subscription`'s `manage_billing_url` was re-verified to confirm no regression.

### Known open items, carried forward

- **SHB-14b** — `handleSubscriptionDeleted` still doesn't revoke entitlements; needs either a direct `EntitlementRevocationService` call mirroring `handleSubscriptionUpsert`'s diff logic, or confirmation via live Stripe test-mode testing that event ordering makes this unreachable in practice.
- **SHB-05** — App Events persistence, reporter, and local environment contract are complete; provider dispatch and controlled live billing validation remain open.
- **SHB-08a** — full uninstall→reinstall live cycle, last gate before submission.

### SHB-14b closed (verified 2026-07-18, same session)

`handleSubscriptionDeleted` now captures the prior tier before overwrite and calls `EntitlementRevocationService.revokeEntitlements` directly — no re-seed needed, since starter-tier entitlements are already granted additively at signup and untouched by upgrade/downgrade flows, so only the paid-tier diff needs revoking. Live-verified via the same hand-signed webhook method against an isolated test shop, hard-delete-only (no preceding `updated` event): `growth → starter`, 8 modules + 5 flags correctly revoked, matching the diff shape already proven in `handleSubscriptionUpsert`'s `ISS-C19` path.

## 27. Shopify App Events Usage Reporting — SHB-05-C/D/E/F (verified 2026-07-18)

Shopify App Events usage reporting requires the merchant’s canonical GraphQL Shop GID, app-level client credentials, a published meter handle, and deterministic event submission. The persistence and isolated reporting layers are implemented. Durable provider dispatch is now implemented through the billing outbox path documented in §28. Controlled worker/state-machine acceptance is complete; one controlled live provider billing validation remains separate.

### Database and OAuth persistence

- Base migration `20260213094649_0014_shopify_app_installations.ts` defines nullable `shop_gid varchar(255)`.
- The column remains nullable so existing installations stay valid until their next OAuth connection.
- `integration.controller.ts` selects `shop.id` through the existing Admin GraphQL identity request; no additional Shopify API round trip was introduced.
- Only values matching `gid://shopify/Shop/…` are accepted.
- Missing or invalid GIDs produce an explicit warning but never block OAuth.
- Reinstall upserts preserve an existing GID with `COALESCE(EXCLUDED.shop_gid, shopify_app_installations.shop_gid)`.

### Published usage pricing

- The billing event handle is `shipped-order`.
- Early-access, Core, and Growth charge `$0.08` per reported unit.
- Current canonical allowances are Starter/Early-access `50`, Core `500`, and Growth `2,500` fulfilled orders per billing period.
- Scale remains unlimited and has no shipped-order usage meter.
- Core, Growth, and Scale use a 14-day trial; the free Early-access plan does not require a trial.

### Reporter behaviour

`apps/backend/src/api/billing/shopify.events.service.ts` now:

- obtains app-level bearer tokens from `POST https://api.shopify.com/auth/access_token`;
- caches tokens with a five-minute refresh buffer and uses Shopify’s documented 60-minute TTL when `expires_in` is omitted;
- reads subscription provider, tier, active Shop GID, and open usage-period state inside a tenant-scoped transaction;
- skips non-Shopify subscriptions and the unlimited Scale tier;
- submits positive overage units to `POST https://api.shopify.com/app/unstable/events`;
- uses deterministic idempotency keys derived from shop, usage period, and cumulative shipped total;
- retries one HTTP `401` with a fresh token;
- logs every skip, acceptance, and failure without blocking fulfillment;
- records HTTP `202` only as accepted for asynchronous processing, never as confirmed billed.

### Environment contract

The sanitized `.env.example` now documents:

- `SHOPIFY_APP_EVENTS_CLIENT_ID`;
- `SHOPIFY_APP_EVENTS_CLIENT_SECRET`;
- `SHOPIFY_APP_EVENTS_METER_HANDLE=shipped-order`.

App Events uses the same Dev Dashboard client ID and secret as the Shopify app. Runtime environments must contain literal secret values rather than dotenv variable references.

### Verification

- A real OAuth cycle against `development-store-15820042357.myshopify.com` persisted `gid://shopify/Shop/94567203186`.
- Shopify client-credentials authentication returned HTTP `200`.
- The App Events endpoint returned HTTP `401` without authentication, confirming the live route and auth boundary.
- Backend TypeScript compilation completed cleanly.
- Direct runtime invocation against the current Stripe-billed Growth shop emitted `billing_provider_is_not_shopify` and sent no billing event.
- `GET /api/v1/billing/subscription` remained HTTP `200`.
- No billable App Event was submitted during this task; Shopify’s asynchronous billing result therefore remains unverified.

### Remaining SHB-05 scope

- **SHB-05-A/B:** durable provider dispatch by `billing_provider` is implemented through the billing outbox worker. Controlled worker acceptance passed without external provider calls; live provider billing validation remains separate.
- **SHB-05-G:** ensure an open usage period exists before provider reporting is activated.
- **SHB-05-F deployment:** configure the three App Events variables in each deployed runtime.
- **AUD-C16:** Shopify extra-seat billing remains a separate unresolved product decision.

Durable provider dispatch is no longer the infrastructure blocker. Shopify usage activation still depends on the required open-period state, deployed provider secrets, and one controlled live billable-event validation.
### SHB-08a closed + SHB-DRIFT-03 discovered and closed (verified 2026-07-23)

SHB-08a (live uninstall/reinstall cycle, deferred since Sprint 2 as "the final pre-submission gate") was finally executed live against production. It surfaced a real, independent bug: migration 0022's `if (tableExists) return` guard caused shop_module_entitlements_open_module_unique (the partial unique index backing the OAuth callback's entitlement-seeding ON CONFLICT clause) to be silently skipped on prod, where the table had an undocumented pre-existing origin. Knex recorded 0022 as applied with no error. Result: every new Shopify install failed at the finalize-integration step with Postgres 42P10.

Root-caused via a full evidence chain: route manifest -> webhook registration source (registerShopifyWebhooks, live GraphQL registration at OAuth-install time, not TOML-declared) -> APP_BASE_URL confirmed correct on Fly -> prod DB directly queried via fly proxy -> migration file read -> guard clause identified. Fix required two migrations: 0125 (index-only, abandoned after prod revealed 22 pre-existing duplicate open entitlement rows across 2 shops, itself a downstream symptom of the same missing index since app-level entitlement grants were relying on the broken ON CONFLICT clause instead of closing prior grants) and 0126 (window-function dedup closing every duplicate at the exact timestamp it was superseded, preserving full grant history, then creating the index). Dedup logic verified locally against a reconstructed copy of the real prod duplicate (shop 1 specter: trial:growth superseded by manual:scale_upgrade) before deployment.

Live-verified end-to-end against app.lasyncro.com and development-store-15820042357: fresh OAuth install completed cleanly (previously failed with "Failed to finalize integration"), webhookSubscriptions query confirmed exactly one APP_UNINSTALLED subscription pointing at the correct prod callback URL, uninstall correctly fired the webhook and set uninstalled_at (Stripe-billed shop correctly skipped the Shopify-tier downgrade branch, tier remained scale as expected), and reinstall correctly cleared uninstalled_at and re-registered the webhook subscription.

SHB-08a is now closed. SHB-DRIFT-03 is closed. No further pre-submission blockers remain in this series.

## 28. Durable Billing Overage Outbox — `DEPLOY-MIGRATION-0157` / `MON-ALLOW-04` (worker/state-machine verified 2026-08-25)

### Atomic production unit

The durable billing path is one coupled infrastructure unit:

- `apps/backend/migrations/20260821193000_0157_make_billing_outbox_durable.ts`
- `apps/backend/src/workers/domain-event-outbox.dispatcher.ts`
- `apps/backend/src/api/billing/stripe.meter.service.ts`
- `apps/backend/src/api/billing/shopify.events.service.ts`

`0157` must not be treated as an isolated schema migration. It changes the generic outbox contract so `billing/overage` events are excluded from `dispatch_domain_event_outbox_batch(integer)` and instead handled by the durable billing dispatcher.

The migration adds:

- `first_attempt_at`
- `last_attempt_at`
- `processing_at`
- partial index `idx_domain_event_outbox_processing_at`
- `claim_billing_overage_outbox()`
- `mark_billing_overage_outbox_published(bigint)`
- `record_billing_overage_outbox_failure(bigint, text)`

The three billing functions are executable by the restricted `sf_app` runtime role.

### Dispatcher contract

`domain-event-outbox.dispatcher.ts` routes from immutable `event_payload.billing_provider`:

- `stripe` → `deliverStripeOverageEvent()`
- `shopify` → `deliverShopifyOverageEvent()`

Successful provider delivery explicitly marks the outbox row published. Failure records durable retry metadata and releases the processing claim according to the SQL state machine introduced by `0157`.

For controlled verification, the worker exposes `dispatchBillingOverageOnce()` with injectable Stripe/Shopify delivery dependencies. Production behavior is unchanged: the normal dispatcher loop calls the same one-pass function with the real provider implementations as defaults.

### Migration verification

`0157` passed:

- migration-only TypeScript compilation;
- full production-mode `fresh_scratch` rehearsal;
- full production-mode `prod_scratch` rehearsal;
- restricted-runtime `sf_app` EXECUTE privilege verification;
- direct proof that generic dispatch excludes `billing/overage`;
- isolated bounded `0157` DOWN/UP immediately after `0156`.

The bounded rollback proved that DOWN leaves `0156` intact, removes only the `0157` attempt/claim objects, and restores the pre-0157 generic dispatcher behavior. Re-applying `0157` restored the durable contract.

### Controlled worker acceptance

Worker acceptance ran against an isolated scratch database as restricted `sf_app`, with injected providers so no real Stripe or Shopify billing request could occur.

Verified:

- Stripe success: exactly one provider call; row marked published; attempt timestamps populated; no error remains.
- Published-row replay: a second dispatcher pass does not redeliver.
- Shopify controlled failure: exactly one provider call; row remains unpublished; `retry_count` increments; `last_error` persists; processing claim clears.
- Immediate retry: backoff prevents immediate redelivery.
- Concurrent two-pass claim: exactly one provider call; atomic claiming prevents duplicate delivery.

This acceptance proves the durable worker/DB state machine and routing contract. It does **not** claim successful external Stripe or Shopify billing API acceptance. One controlled live provider billing validation remains a separate provider-E2E gate.

The broader `MON-ALLOW-04` WMS five-case commercial runtime matrix also remains separate from this durable-outbox infrastructure slice.

## 29. MON-ALLOW-04 — Fulfilled-Order Allowances and Merchant Overage Preference

- **Runtime verified:** 2026-08-25
- **Automated regression verified:** 2026-08-26

### Current commercial contract

Canonical fulfilled-order allowances are:

| Tier | Included fulfilled orders / period | Beyond allowance |
|---|---:|---|
| Starter | 50 | Hard stop |
| Core | 500 | Merchant may enable or disable overage |
| Growth | 2,500 | Merchant may enable or disable overage |
| Scale | Unlimited | No cap enforcement |

Starter does not participate in configurable paid overage. `allow_overage` is relevant only to Core and Growth.

At `pack-complete`, the projected usage is evaluated atomically inside the same transaction that updates the batch, usage counter, ready-to-ship alert, and any `billing/overage` event.

Current behavior:

- Starter within 50 → allow completion.
- Starter above 50 → `403 SHIPPED_ORDER_CAP_REACHED`.
- Core/Growth within the included allowance → allow completion regardless of `allow_overage`.
- Core/Growth above the allowance with `allow_overage=false` → `403 OVERAGE_DISABLED`.
- Core/Growth above the allowance with `allow_overage=true` → allow completion when the required provider facts are available and persist a durable `billing/overage` event for only the newly over-cap units.
- Scale → unlimited; no finite shipped-order-cap branch.

Rejected cap/overage checks occur before pack completion side effects, so the batch remains `packing`, usage does not increment, no ready-to-ship alert is created, and no billing event is persisted.

### Merchant preference API

Migration `0156_add_allow_overage_to_shop_subscriptions` persists the merchant preference on `shop_subscriptions.allow_overage`.

`GET /api/v1/billing/subscription` exposes `allow_overage`.

`PATCH /api/v1/billing/overage`:

- requires authenticated `billing:write`;
- accepts only a boolean `allow_overage`;
- returns `400 INVALID_ALLOW_OVERAGE` for non-boolean input;
- permits configuration only for Core and Growth;
- returns `409 OVERAGE_NOT_CONFIGURABLE` for Starter and Scale;
- updates only the persisted preference; WMS remains the enforcement boundary.

The preference API was independently runtime-verified: Core/Growth toggles persisted correctly, invalid input returned 400, Starter/Scale returned 409, GET reflected the stored value, and the verification baseline was restored.

### Five-case WMS runtime acceptance matrix

The final matrix was executed against disposable migrated scratch databases through the real API-only WMS endpoint:

`POST /api/v1/wms/batch/:batchId/pack-complete`

The durable outbox worker was intentionally absent so no real Stripe or Shopify provider call could occur.

| Case | State | Result | Post-state |
|---|---|---|---|
| 1 | Starter, `49 + 1` | HTTP 200 | usage `50`, batch `pack_complete`, one ready-to-ship alert, no billing event |
| 2 | Starter, `50 + 1` | HTTP 403 `SHIPPED_ORDER_CAP_REACHED` | usage remains `50`, batch remains `packing`, no alert/event |
| 3 | Core, `499 + 1`, `allow_overage=false` | HTTP 200 | usage `500`, batch `pack_complete`, one alert, no billing event |
| 4 | Growth, `2500 + 1`, `allow_overage=false` | HTTP 403 `OVERAGE_DISABLED` | usage remains `2500`, batch remains `packing`, no alert/event |
| 5 | Growth, `2500 + 1`, `allow_overage=true`, Stripe provider facts present | HTTP 200 | usage `2501`, batch `pack_complete`, one alert, exactly one `billing/overage` event and one outbox row |

Case 5 persisted the following event payload facts:

- `billing_provider = stripe`
- `overage_units = 1`
- `tier = growth`
- `included_allowance = 2500`
- `current_before = 2500`
- `projected_after = 2501`
- `usage_period_id` captured from the open usage period
- `batch_id` captured from the completed batch
- deterministic `idempotency_key` present
- `stripe_customer_id` preserved from the subscription state captured inside the transaction

For automated regression purposes, only provider-delivery fields consumed by
the durable dispatcher are treated as contractual:

- `billing_provider`
- `overage_units`
- `idempotency_key`
- `stripe_customer_id` on the Stripe path
- `shop_gid` on the Shopify path

The remaining persisted fields (`tier`, `included_allowance`,
`current_before`, `projected_after`, `usage_period_id`, `batch_id`) are useful
business/debugging context, but are not asserted by the commercial regression
suite merely to freeze payload shape.

The trigger-created outbox row remained:

- `published_at = NULL`
- `processing_at = NULL`
- `retry_count = 0`
- `first_attempt_at = NULL`
- `last_attempt_at = NULL`

That proves pack-complete persists the durable delivery fact without performing provider I/O itself. Provider claim/delivery/retry behavior is separately verified in §28.

All five scratch databases, fixtures, API-only processes, and temporary verification artifacts were removed after acceptance. No primary database state was changed.

### Automated regression protection

Permanent regression protection now exists on the disposable
`synchroflow_test_*` integration-test infrastructure.

#### Merchant preference API

File:

`tests/integration/billing/allow-overage-preference.test.ts`

Targeted execution:

```sh
npm run test:integration -- --testPathPatterns allow-overage-preference
```

Verified 2026-08-26:

- 1 suite passed;
- 11 tests passed;
- Core and Growth persist explicit `allow_overage=true/false`;
- Starter and Scale reject configuration without mutating persistence;
- non-boolean input returns `INVALID_ALLOW_OVERAGE` without mutation;
- missing subscription state resolves to `allow_overage=true` on GET without
  creating a subscription row;
- changing the preference creates no billing domain event/outbox record and
  does not change shipped-order usage.

Protected contracts:

- `OVERAGE-PREF-01`
- `OVERAGE-PREF-02`
- `OVERAGE-PREF-03`
- `OVERAGE-PREF-04`
- `OVERAGE-PREF-05`

#### WMS commercial enforcement

File:

`tests/integration/wms/shipped-order-commercial-enforcement.test.ts`

Targeted execution:

```sh
npm run test:integration -- --testPathPatterns shipped-order-commercial-enforcement
```

Verified 2026-08-26:

- 1 suite passed;
- 5 tests passed;
- Starter `49 + 1` succeeds and increments usage exactly once;
- Starter `50 + 1` rejects with `SHIPPED_ORDER_CAP_REACHED`;
- Core `499 + 1` succeeds with `allow_overage=false` and remains non-billable;
- Growth `2500 + 1` with `allow_overage=false` rejects with
  `OVERAGE_DISABLED`;
- Growth `2500 + 1` with `allow_overage=true` succeeds and persists exactly
  one `billing/overage` domain event plus exactly one related outbox row;
- both rejection paths preserve batch state, usage, billing-event state, and
  outbox state atomically.

Protected contracts:

- `COMMERCIAL-01`
- `COMMERCIAL-02`
- `COMMERCIAL-03`
- `COMMERCIAL-04`
- `COMMERCIAL-05`
- `ATOMICITY-01`

These regression suites deliberately protect business decisions, persistence,
atomicity, and durable billing intent. They do not assert human-readable copy,
UI structure, commercial alert wording, or incidental payload metadata.

Both suites run through `createApp()` and the real restricted-runtime Postgres
path. They do not start the billing outbox worker and make no real Stripe or
Shopify provider call.

The generic `wms_batch_ready_to_ship` alert remains an operational
pack-complete side effect; it is not treated as a commercial allowance alert
or as part of these commercial regression contracts.

### Remaining provider-E2E boundary

The commercial WMS matrix and durable worker/state-machine acceptance are complete.

They do not claim a live external Stripe or Shopify billing acceptance for the newly persisted event. That remains the separate provider-E2E gate already documented in §28.
