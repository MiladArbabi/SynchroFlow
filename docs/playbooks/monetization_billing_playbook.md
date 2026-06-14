# LaSyncro — Monetization, Billing & Currency Playbook

> **Audience:** Engineers onboarding to LaSyncro, or picking up billing/monetization work.
> **Last updated:** June 2026
> **Status:** Backend complete. Frontend `billingCurrency` wiring in progress.

---

## 1. Tier Architecture

Single source of truth: `packages/backend-core/src/config/tiers.ts`

| Tier | Price (USD/mo) | Seats | Order cap/mo | Shipped order cap/mo |
|---|---|---|---|---|
| Starter | Free | 1 | 50 | 0 (no WMS) |
| Core | $79 | 2 | 2,000 | 200 |
| Growth | $179 | 5 | 10,000 | 1,000 |
| Scale | $349 | Unlimited | Unlimited | Unlimited |

- Annual billing = 20% discount (varies slightly per currency — see Stripe actuals)
- Extra seats purchasable above base limit: Core $15/seat/mo, Growth $12/seat/mo
- Shipped order overage: $0.08/unit (Core + Growth only), billed via Stripe Meter

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

Stripe Checkout
  └── billing.controller.ts
      └── reads billing_currency from shop_subscriptions
      └── getStripePriceId(tier, billing_currency, interval)
      └── stripe.checkout.sessions.create({ price: priceId })

Stripe Webhook → handleSubscriptionUpsert
  └── merges: tier, billing_interval, stripe_customer_id,
              stripe_subscription_id, status, trial_ends_at,
              current_period_start, current_period_end
  └── does NOT touch billing_currency (set once, never overwritten)
  └── re-seeds shop_module_entitlements from tier constants

JWT issuance (token.service.ts)
  └── resolveTierForShop(shopId) → reads shop_subscriptions.tier
  └── embeds tier claim in access token

Auth middleware
  └── reads tier from JWT → req.user.tier (fallback: 'starter')

requireTier(minTier) middleware
  └── compares req.user.tier against tier order
  └── returns 402 if below minimum
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

## 9. Currency — Frontend (in progress)

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

## 10. MON Issue Register — Final Status

| Issue | Description | Status |
|---|---|---|
| MON-01 | Tier constants (`tiers.ts`) | ✅ Done |
| MON-02 | `shop_subscriptions` table | ✅ Done |
| MON-03 | JWT tier claim + entitlements engine | ✅ Done |
| MON-04 | Seat limit enforcement | ✅ Done |
| MON-05 | Order cap enforcement | ⚠️ Table exists, enforcement logic TBC |
| MON-06 | Module gating (backend + frontend) | ✅ Done |
| MON-07 | 14-day Growth trial on registration | ✅ Done |
| MON-08 | Annual billing | ✅ Stripe prices exist, UI TBC |
| MON-09 | Shopify Billing API | ✅ Done |
| MON-10 | Upgrade prompt system | ✅ Done (PlanGate, PaywallSurface) |
| MON-currency | Multi-currency pricing | ✅ Backend done · 🔄 Frontend in progress |

---

## 11. Adding a New Tier or Currency

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