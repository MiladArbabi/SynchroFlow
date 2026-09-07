# LaSyncro — Monetization, Billing & Currency Playbook

> **Audience:** Engineers onboarding to LaSyncro, or picking up billing/monetization work.
> **Last updated:** August 21, 2026
> **Status:** Stripe billing, Shopify Managed Pricing reconciliation, Shopify App Events Shop GID capture, and Starter WMS shipped-order enforcement verified end-to-end.

---

## 1. Tier Architecture

Canonical source of truth: **`@lasyncro/commercial-policy`** (`packages/commercial-policy/`)
— tier identity/rank, plan limits, module & feature registries, capability
requirements, and `evaluateAccess()`. As of P0-A1 (2026-09-04)
`packages/backend-core/src/config/tiers.ts` is a **compatibility re-export layer**
over that package, not an independent owner (see §32). Values below are unchanged.

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
- Growth+: cash flow, demand forecasting, customer LTV, Specter, returns analysis (supplier correlation), problem center analytics, floor planning, warehouse analytics, unlimited order history
- Scale+: unlimited everything (same cumulative Growth capability set, no capacity caps)

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

> **Consolidation in progress — `COMMERCIAL-ACCESS-ARCH-01` (§32).** The canonical
> owner of tier/module/feature/capability policy is now `@lasyncro/commercial-policy`
> (`packages/commercial-policy/`); `backend-core` re-exports it (P0-A1, 2026-09-04).
> `require-entitlement.middleware.ts` **is** converted (P0-A2A, 2026-09-04): it
> exports `requireCapability(capabilityId)` driven by `evaluateAccess()` and its
> private `TIER_ORDER` map is gone. The three frontend descriptions above —
> `usePlanEntitlement.ts` `PLAN_FEATURES`, `PlanGate`, `resolveNavVisibility` —
> are **not yet converted**; that is P0-A2B.

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

> **Being retired by `COMMERCIAL-ACCESS-ARCH-01` (§32).** The three-layer split
> here is the problem statement for that umbrella: all three layers, the route
> gate, and backend enforcement will consume one shared `evaluateAccess()` from
> `@lasyncro/commercial-policy`. P0-A1 (2026-09-04) shipped that pure engine +
> the 17-capability requirement registry; P0-A2A (2026-09-04) converted **backend
> enforcement** (`requireCapability` + first route migration). The three
> **frontend** layers are still unconverted (P0-A2B), so the ALL-THREE-layers
> rule still applies to them until then.

### 13.2 The real enforcement is the backend route, not the frontend

The frontend layers above are UX — they hide/show/badge things. Security
enforcement must remain backend-owned. Route-level access is enforced through
`requireCapability(capabilityId)` (the P0-A2A canonical gate — evaluates
`CAPABILITY_REQUIREMENTS` via `evaluateAccess()`; used by the migrated
suppliers / WMS / floor-planning / demand families) and `requireAction()`, with
legacy `requireTier()` still present on the not-yet-migrated routes; narrower
capabilities may require field- or operation-level checks inside
controllers/services.

Canonical feature checks should derive from backend tier configuration rather
than duplicate hardcoded tier comparisons. For example, `exports.column_selection`
is a Growth+ capability in `packages/commercial-policy` (feature
`exports.column_selection`), and export controllers enforce custom column
selection with `enforceCapability(req, res, 'exports.column_selection')`.
*(Superseded 2026-09-04 by P0-A3-1 — see §32 "### P0-A3-1"; the earlier
`tierHasFlag()` mechanism this example originally described is retired.)*

**A frontend-only gate with no corresponding backend enforcement is not a
security gate — it's a suggestion.** Every confirmed bug this session was a case of
exactly that.

### 13.3 Confirmed live defects found and fixed (2026-07-14)

| Defect | File(s) | Impact | Status |
|---|---|---|---|
| Floor Planning routes had zero `requireTier` | `floor-planning.routes.ts` (11 routes) | Starter shops could read/write full warehouse layout, zones, barcodes | ✅ Fixed 2026-07-14 — `requireTier('scale')` added to all 11 *(later lowered to `requireTier('starter')` by FP-GATE1; **current state: `requireCapability('warehouse.floor_planning')` = Growth+, P0-A2A** — see §32 "### P0-A2A")* |
| Products routes had zero `requireTier` (and `/` had zero `requireFt2` too) | `products.routes.ts` (`/`, `/operator-summary`) | Starter shops could pull real margin/warehouse intelligence data | ✅ Fixed — `requireTier('core')` added to both |
| `ModuleTabBar.isLocked()` ignored `requiredTier` | `ModuleTabBar.tsx` | Floor Planning / Problem Center tabs unconditionally unlocked in-page regardless of plan, even though sidebar correctly blocked the same route | ✅ Fixed — now checks `requiredTier` against user's tier |
| Problem Center tagged `requiredTier: 'scale'` on frontend vs backend `requireTier('core')` | `FloorPlanningPage.tsx`, `ProblemCenterPage.tsx`, `warehouseModuleTabs.ts` | Once tab-bar enforcement was restored, Core customers would have been wrongly blocked from a feature they already pay for | ✅ Fixed — corrected to `'core'` in all 3 sites |
| Sidenav upgrade modal hardcoded `requiredTier="growth"` | `SidenavContent.tsx` | Clicking any locked sidebar item — regardless of actual required tier — told the user to upgrade to Growth specifically, risking wrong-plan purchase | ✅ Fixed — tier now tracked from the clicked item/child |
| Alert Rules routes had zero `requireTier` | `alerts.routes.ts` (`/rules` × 3) | Starter/Core shops could read/write alert rules (Growth feature) directly via API | ✅ Fixed — `requireTier('growth')` added to all 3 |

### 13.4 Known drift between frontend `PLAN_FEATURES` and backend `TIER_CONFIG`

`PLAN_FEATURES` in `usePlanEntitlement.ts` is maintained by hand and has no
automated check against `packages/backend-core/src/config/tiers.ts`. Cross-checked
2026-07-14:

> The automated parity check this section calls for is `C13` / `C19` under
> `COMMERCIAL-ACCESS-ARCH-01` (§32), delivered in P0-A1 once the canonical
> registry moves into `@lasyncro/commercial-policy`.

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

### 14.5 Decision Engine treatment & automation positioning — approved 2026-09-06

**PRODUCT POSITIONING ONLY — NOT YET IMPLEMENTED AS COMMERCIAL ENTITLEMENTS.**

Current commercial-policy remains authoritative. This decision changed **no**
runtime gate: no capability key, no route gate, no frontend gate, no billing
entitlement, and no tier membership was added or moved. The table below is
planned positioning, not shipped behaviour.

#### Ratified commercial principles

1. **Correctness and safety are universal and must never be paywalled.** In
   every tier, without exception:
   - canonical constraint detection;
   - truthful blocker state;
   - safe manual resolution;
   - server-confirmed resolution;
   - SLA priority correctness;
   - no invented addresses;
   - no unsafe auto-release;
   - no silent customer or inventory intent changes.

2. **Monetize increasing operational assistance, intelligence and automation —
   never correctness.**

#### Planned positioning

| Tier | Decision Engine positioning |
| --- | --- |
| Starter | Detect + explain + safe action |
| Core | Evidence gathering + assisted resolution + confirm-and-execute workflows |
| Growth | Ranked treatments + proactive prevention + orchestration + configurable automation + advanced outcome reporting |
| Scale | Same cumulative Growth Decision Engine capability with unlimited commercial capacity; no Scale-exclusive Decision Engine feature wall |

#### Clarifying examples

**Starter**

- canonical blockers;
- SLA priority;
- reason / problem explanation;
- safe manual treatment paths.

**Core**

- connected evidence gathering;
- suggested treatments;
- assisted resolution;
- prepared confirm-and-execute workflows.

**Growth**

- ranked treatment recommendations;
- proactive risk/prevention where evidence supports it;
- orchestration and escalation;
- merchant-configurable automation policies;
- advanced attributable outcome/value reporting.

**Scale**

- the same Growth treatment/intelligence capability;
- unlimited capacity according to the canonical Scale commercial model;
- do **not** invent Scale-only Decision Engine modules merely to differentiate
  the tier.

#### Maturity framing

- **Starter** — "What is going wrong?"
- **Core** — "Help me fix it."
- **Growth** — "Stop making me manage this manually."
- **Scale** — "Run this across my operation without limits."

#### Implementation rule

Future implementation must use `@lasyncro/commercial-policy` and follow §14.4.
This documentation does not itself create a capability key, route gate,
frontend gate, billing entitlement, or any runtime behaviour.

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

> **P0-A2A update (2026-09-04):** `EntitlementsService.getForUser` now derives a
> **tier floor** — `modulesForTier(currentTier)` / `flagsForTier(currentTier)` —
> and unions the persisted rows on top, so a shop with a valid tier row but zero
> entitlement rows still resolves the full standard module/flag set. Persisted
> rows remain additive; expired rows are still excluded temporally. Seeding is
> unchanged and still valid (the seeded rows are simply additive over the floor).
> See §32 "### P0-A2A".

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

> **`ENT-REVOCATION-RLS-01` — this revocation was RLS-blind (P0, closed by
> P0-A2A, 2026-09-04).** `EntitlementRevocationService.revokeEntitlements` ran its
> `UPDATE` in a **bare pooled `db.transaction`** with no tenant context. After
> migration `0135` (2026-07-29) tightened the `shop_module_entitlements` write
> policy to `USING / WITH CHECK (shop_id = current_setting('app.current_tenant',
> true)::int)` under `FORCE ROW LEVEL SECURITY`, that `UPDATE` **silently matched
> zero rows** whenever `app.current_tenant` was unset — every downgrade revocation
> through this service (and `trial-expiry.service.ts`) became a no-op, so
> Growth-only rows kept `valid_until = NULL` and `getForUser` kept unioning them.
> The 2026-07-15 live verification above predates policy `0135`. **Fix:** the
> write now runs through the canonical `withTenant(shopId, …)` helper
> (`SET LOCAL app.current_tenant = shopId`). `FORCE RLS` stays on; no privileged
> role; no RLS bypass; `UPDATE`-only temporal `valid_until` semantics and single
> transaction atomicity preserved. Proven on real disposable Postgres
> (`effective-tier-floor.test.ts` C5: Growth→Core downgrade through the real
> revocation path excludes the revoked module). See §32 "### P0-A2A".

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

---

## 30. Entitlement Enforcement Placement — `ENT-PATTERN-AUDIT-147` / `ENT-FT2-TIER-CLASS-118` (verified 2026-08-26)

### The pattern, as audited

Two enforcement mechanisms exist. They do not share a vocabulary.

| | `requireTier` | `tierHasFlag` |
|---|---|---|
| Defined | `require-entitlement.middleware.ts:66` | `tiers.ts:196` |
| Sites | 133, route middleware | 4, inside `exports.controller.ts` |
| Gates on | tier ordinal via `TIER_ORDER` | flag string |
| Denial | `403 TIER_INSUFFICIENT` + `required`/`current` | `403 COLUMN_SELECTION_REQUIRES_GROWTH` |

> **Historical audit snapshot (2026-08-26).** The right-hand `tierHasFlag` /
> `COLUMN_SELECTION_REQUIRES_GROWTH` column above describes the mechanism as
> it stood at audit time. **Superseded 2026-09-04 by P0-A3-1** (§32
> "### P0-A3-1"): `exports.controller.ts`'s 4 custom-column call sites now
> use `enforceCapability(req, res, 'exports.column_selection')` — the same
> canonical `resolveCapabilityDecision` / `COMMERCIAL_ACCESS_DENIED` path
> `requireCapability` uses — and no longer emit
> `COLUMN_SELECTION_REQUIRES_GROWTH`. `tierHasFlag()` remains defined
> (`tiers.ts:196`) for other legacy callers outside this slice's scope; it is
> no longer used by the export column-selection decision. `ENT-COLSELECT-BYPASS-96`
> below is likewise superseded — the mount-invariance property it recommended
> closing now holds via the canonical mechanism instead.

Entitlement truth is sound: `resolveTierForShop` -> signed JWT claim ->
`resolveTier`. The weakness is **placement**, not the source of truth.
Route-level gating is per-mount, so a second mount of the same handler is
unprotected by construction. Controller-level gating is mount-invariant.

### Ratified contracts

```text
ENT-CONTRACT-01  Entitlement truth is the server-issued JWT tier claim from
                 resolveTierForShop. Frontend PLAN_FEATURES is presentation
                 only and is never security authority.

ENT-CONTRACT-02  A handler reachable at more than one mount is gated inside
                 the controller, not at the route.

ENT-CONTRACT-03  Every entitlement denial emits 403 plus a machine-readable
                 error code the client can distinguish from generic failure.
```

### `ENT-FACT-01` — the dual mount table is deliberate

`/api/v1/<domain>` and `/api/v1/modules/<domain>` are both intentional mounts
(`bootstrap/express.ts:104-114`). This is ratified product architecture, not a
defect. **Do not collapse it.** It is the reason `ENT-CONTRACT-02` exists.

### `ENT-FT2-TIER-CLASS-118` — the defect it caught

`getProductsOperatorSummaryHandler` was mounted twice: `products.routes.ts:28`
with `requireTier('core')`, and `products.ft2.routes.ts:24` with no gate. Any
authenticated Starter merchant could read Core-gated operator-summary data via
`/api/v1/modules/products/operator-summary`.

Fixed per `ENT-CONTRACT-02`: the gate moved into the controller using the
existing `meetsTier(req, 'core')` predicate, and `requireTier('core')` was
removed from the route so both mounts carry identical chains.

Two constraints the fix must preserve:

1. **The denial emits `TIER_INSUFFICIENT`**, matching
   `require-entitlement.middleware.ts:65-70` exactly. `axiosConfig.ts:269`
   refreshes the access token only on that error code; a bespoke code would
   break stale-claim recovery on this route.
2. **The gate runs before query parsing.** Sited after the `shopId` 401 check
   and before preset/period resolution. An intermediate implementation placed
   it after parsing, and an unentitled caller sending malformed date params
   received `500` instead of `403` — caught by regression test before commit.

### Regression protection

```text
CONTRACT-ENT-MOUNT-01  tests/integration/entitlement-mounts.test.ts
                       Starter denied and Core allowed at BOTH mounts,
                       plus the malformed-param ordering case.

CONTRACT-ENT-MOUNT-02  tests/contract/entitlementMounts.contract.test.ts
                       Static scan: no handler symbol is registered at two
                       mounts with divergent entitlement middleware chains.
                       Parser proven against the known -118 pair before use.
```

Repo-wide, four handler symbols are dual-mounted; only `-118` had divergent
chains. The scan's blast radius is small and it is safe to keep repo-wide.

Runtime verified: 2026-08-26. Automated regression verified: 2026-08-26.

### Deliberately not done

- **`PLAN_FEATURES` was not converged with the backend flag vocabulary.**
  21 frontend keys have no backend flag, but the two vocabularies model
  different things (module/feature presentation vs tier ordinal). Four of the
  six growth-tier orphans are correctly `requireTier`-gated at route level;
  two have no backend route at all. The divergence is benign.
- **The other 132 `requireTier` sites were not migrated.** Repo-wide inward
  migration is an explicit non-goal — no forcing event, enormous regression
  surface.
- **`products/catalog` and `products/wms-readiness` were not gated.** Both are
  single-mount, and `wms-readiness.controller.ts:6` documents all-tier
  visibility as intended policy. Gating them would invent product policy from
  a defect report.
- **Paused surfaces untouched**: `customers.ft2`, `finances`, `specter`,
  `analytics` are planned for removal and out of scope unless they block.

### Deferred with IDs

```text
ENT-403-SILENT-117            Med  CLOSED 2026-08-26 — see §31. Rescoped from
                                    High after audit: ColumnPicker:179 disables
                                    selection, so the 403 is drift-only, not
                                    frontend handler; axiosConfig branches only
                                    on TIER_INSUFFICIENT; MembersPage:228
                                    suppresses generic 403. Denial is invisible.
ENT-OPERATORS-TEAM-UNGATED-122 Med  operators.routes.ts:25,31 expose team roster
                                    and availability behind authenticateToken
                                    alone, unlike every members.routes.ts twin.
ENT-TIER-DOWNGRADE-STALE-150   Med  Refresh fires only on TIER_INSUFFICIENT, a
                                    stale-LOW claim. A downgrade leaves a
                                    stale-HIGH claim that emits no 403 and never
                                    refreshes. Window: 15m (token.service.ts:209).
ENT-COLSELECT-BYPASS-96         --  Gated inside the controller at all 4 sites,
                                    therefore mount-invariant. No residual bypass
                                    found. CLOSURE RECOMMENDED, NOT TAKEN.
```

Not assessed: 23 further `*.routes.ts` carry zero `requireTier`. Most are
legitimately ungated (auth, system, currency, notifications, user-state,
waitlist, shopify). `orders.routes.ts` and `finances.routes.ts` were not
individually reviewed. No coverage claim is made for them.

There was no pre-existing `products` backend-integration suite;
`CONTRACT-ENT-MOUNT-01` is this handler's first integration coverage.

---

## 31. Reactive Entitlement Denial — `ENT-403-SILENT-117` (verified 2026-08-26)

### What the audit actually found

The issue was carried as High on the belief that merchants were hitting
silent entitlement denials in normal use. **They were not.** `ColumnPicker:179`
disables the checkboxes for non-Growth merchants, so
`COLUMN_SELECTION_REQUIRES_GROWTH` is not reachable through the UI.
**Downgraded to Med** and rescoped as a drift backstop. *(Historical audit
snapshot, 2026-08-26 — superseded 2026-09-04 by P0-A3-1, §32
"### P0-A3-1": `ColumnPicker` no longer consumes `usePlanEntitlement`, and
`COLUMN_SELECTION_REQUIRES_GROWTH` is retired — the canonical
`COMMERCIAL_ACCESS_DENIED` response now applies. The structural finding below
remains valid independent of that mechanism change.)*

The structural finding stands, and it is the reason the issue was worth doing:

```text
Denial UI renders only where the frontend PREDICTED the denial.
No denial UI is reachable from a caught API error, anywhere.
```

`UpgradePrompt` is reached from 13+ surfaces, every one of them driven by
`usePlanEntitlement` / `PLAN_FEATURES` before any request is made. Per
`ENT-CONTRACT-01`, `PLAN_FEATURES` is presentation-only and is *permitted* to
drift from backend truth — so the reactive path is not a redundant net. It is
the only thing covering the case the pre-emptive layer is explicitly not
authoritative for.

### New contracts

```text
ENT-CONTRACT-04  A backend entitlement denial is identified by its error code,
                 never by bare 403 status. The client reads the code through
                 one shared helper.

ENT-CONTRACT-05  Where the client can distinguish an entitlement denial, it
                 must not tell the merchant to retry. Retry can never succeed
                 against an entitlement gate.
```

`-05` is the one that mattered in practice. "Export failed — please try again"
is worse than silence: it instructs the merchant to do something futile.

### The 403 vocabulary — 26 distinct values, four categories

The backend emits far more than the two codes the issue named. A two-code
predicate would have been wrong on arrival.

| Category | Upgrade resolves it? | Codes |
|---|---|---|
| **Entitlement** | Yes — helper matches these | `TIER_INSUFFICIENT`, `TIER_INSUFFICIENT_FIELD`, `COLUMN_SELECTION_REQUIRES_GROWTH`, `SEAT_LIMIT_REACHED`, `SHIPPED_ORDER_CAP_REACHED` |
| **Role/permission** | No | `ACTION_FORBIDDEN`, `NO_ROLE_ASSIGNED`, `FORBIDDEN`, `CANNOT_REVOKE_OWNER` |
| **Ownership (WMS)** | No | prose values — "Batch not owned by this operator", etc. |
| **Session/context/OAuth** | No | `SESSION_COMPROMISED`, `NO_ACTIVE_SHOP_MEMBERSHIP`, `SHOP_CONTEXT_REQUIRED` |

Two deliberate exclusions, both commented in the helper:

- **`OVERAGE_DISABLED`** is tier-adjacent but resolves by toggling the
  merchant's `allow_overage` preference (§29), not by upgrading. Telling that
  merchant to upgrade would be wrong.
- **Role denials** are tracked as `ENT-MEMBERS-403-BLANK-151`, not here.

**Several 403s use human prose as the error value.** Prose is not a code.
`isEntitlementDenial` matches by exact equality against a frozen allowlist and
must never use substring or regex matching.

### Implementation

`apps/frontend/src/api/entitlementDenial.ts` — framework-free, exports
`ENTITLEMENT_DENIAL_CODES` (frozen) and `isEntitlementDenial(error: unknown)`.
Applied at `ExportDrawer.tsx:55` and `ShopSettingsReportsPage.tsx:64`.

`axiosConfig.ts:269` was **not** touched. The interceptor still refreshes on
`TIER_INSUFFICIENT` and runs before any caller catch, so the helper cannot
intercept a refreshable stale claim.

### Regression protection, and one honest limitation

```text
CONTRACT-ENT-DENIAL-01  tests/contract/entitlementDenial.contract.test.ts
                        17 assertions: 5 allowlisted codes true; 12 false
                        (OVERAGE_DISABLED, role codes, prose values, bare
                        403, 401+TIER_INSUFFICIENT, 500, null, {}, network).
                        Strong — this proves classification.

CONTRACT-ENT-DENIAL-02  Static scan: no export catch sets a retry-suggesting
                        string without importing the helper.
```

**`-02` is weaker than it looks, and this is deliberate to record.** During
implementation a ternary catch body was written; the scan went red purely
because it could not *see* the generic string, and the source was reformatted
to if/else to satisfy it. A ternary and an if/else are behaviourally
identical. So `-02` is partly a formatting rule wearing a contract's name.

What it genuinely protects: a third export path setting a generic string
**without importing the helper**. That invariant is real and is why it was
kept. What it does not protect: correct classification — `-01` does that.

**If you hit a red `-02` after writing a ternary, the test is the problem, not
your code.** Improve the scan or narrow it to the import check. Do not
reformat working code to appease it.

Runtime verified: 2026-08-26. Automated regression verified: 2026-08-26.

### Deliberately not done

- **The other ~11 hand-rolled catches.** No forcing event; repo-wide catch
  migration was an explicit non-goal.
- **No modal or hook infrastructure.** `UpgradePrompt mode="modal"` would be a
  better experience, but this path fires only on drift and there is no evidence
  drift has ever occurred. Inline copy is the proportionate fix; the modal is a
  small step from here if drift proves real.
- **Live browser verification skipped.** Reaching the new copy requires forcing
  synthetic drift, so there is no genuine user-facing flow to approve.
  Verification replacement: `CONTRACT-ENT-DENIAL-01` proves classification.

### Spun off

```text
ENT-MEMBERS-403-BLANK-151  MembersPage:65,228 — a role 403 suppresses the
                           error alert and the table, rendering nothing.
                           Suppressing "please refresh" is arguably correct
                           (refresh cannot help); rendering nothing is not.
                           Permissions UX, not entitlement.
EXP-DRAWER-DUPLICATE-152   ExportDrawer:44-45 and ShopSettingsReportsPage:49-50
                           duplicate the export body construction wholesale.
                           Same dual-maintenance shape as -118's dual mount.
```

---

## 32. Canonical Commercial Policy — `COMMERCIAL-ACCESS-ARCH-01` / `COMMERCIAL-ACCESS-COVERAGE-01`

Slice status: **P0-A0** package + wiring — done (verified 2026-09-04). **P0-A1**
pure policy engine + canonical catalog — done (verified 2026-09-04). **P0-A2A**
backend/runtime commercial convergence — `EntitlementsService` effective-entitlement
union, `requireCapability` middleware + first backend route migration,
`COMMERCIAL_ACCESS_DENIED` contract, canonical tier comparator, and the
`ENT-REVOCATION-RLS-01` fix — done (verified 2026-09-04; see "### P0-A2A").
**P0-A2B** frontend surface/route conversion + sidenav↔tab↔route↔backend parity
— **implemented + verified (2026-09-04); pending commit/push/deploy** (see
"### P0-A2B"). **P0-A3-1** export/report commercial-access convergence
(`exportReports.ts` capability migration, `ExportDrawer` /
`ShopSettingsReportsPage` / `ColumnPicker` canonical decision, backend
`exports.routes.ts` + `exports.controller.ts` canonical enforcement) —
**CLOSED / VERIFIED (2026-09-04); pending commit/push/deploy** (see
"### P0-A3-1"). **P0-A3-2** Overview Live Map commercial-access convergence
(`OverviewFT2Page` canonical `overview.live_map` decision, premium-data
acquisition gating via `useFloorPlanning(enabled)`, backend
`requireCapability('overview.live_map')` on `GET /api/v1/wms/live-activity`)
— **CLOSED / VERIFIED / DEPLOYED on 2026-09-05 at
`8e72888136011fc0298499b32664257f2bdf064e`** (see "### P0-A3-2"). **P0-A3-3**
Returns commercial-access convergence (canonical `returns.intake` /
`returns.core` / `returns.analysis` ladder, all 12 `returns.routes.ts` routes on
`requireCapability`, nav + sub-tab `capabilityId`, `CommercialGate` on the
Returns route subtree, and `useReturnsCorrelation(enabled)` acquisition gating)
— **IMPLEMENTED + VERIFIED and DEPLOYED; PRODUCTION CERTIFICATION BLOCKED /
PENDING on `RETURNS-SCHEMA-DRIFT-01`** — a separate pre-existing production
schema drift on `refund_execution_line_items` whose forward repair (`0165`) is
both since shipped and PRODUCTION-CERTIFIED (`0165`, and `0166` for
`RETURNS-SCHEMA-DRIFT-02` at commit `ecaef445`). The schema/capability Returns
slice is production-certified, and the final cosmetic visual-polish closure
(`RETURNS-OVERVIEW-UI-01`) shipped at commit `15ba7a11` and was production
re-checked — P0-A3-3 Returns is now fully CLOSED / PRODUCTION-CERTIFIED
(see "### P0-A3-3"). Remaining
**P0-A3** scope — the
other unmigrated backend route families, bespoke-grant backend enforcement,
the sole remaining deferred private frontend `TIER_ORDER` residual
(`usePlanEntitlement.ts`), and system-wide C14–C24 closure — **the P0-A3
umbrella remains OPEN.** **P0-B** commercial-state integrity
(`BILL-ENTITLEMENT-01` Fact B) — SEPARATE, OPEN.

### Why this exists

§13.1 records that tier gating runs in **three independent layers that do not
share logic and can silently disagree** (sidebar nav, in-page `ModuleTabBar`,
component `PlanGate`), and §13.4 records that `PLAN_FEATURES` (frontend) has
**no automated parity check** against `TIER_CONFIG` (`packages/backend-core`).
A production audit (`NAV-ENTITLEMENT-PARITY-01`) then found the same shop on
the highest tier (Scale) blocked from **Warehouse / Purchasing / Sourcing** in
the sidebar while `ModuleTabBar`, the direct route, and the backend API all
allowed it — the divergence §13.1 warned about, shipped.

`COMMERCIAL-ACCESS-ARCH-01` retires the three-layer split. All navigation
surfaces, the frontend route gate, and backend enforcement will consume **one**
pure `evaluateAccess()` from **one physical package**. **P0-A0 is only the
package + toolchain wiring** — it changes no commercial behavior and fixes no
gate. The production defect remains RED until P0-A1/P0-A2.

### P0-A0 — package + toolchain wiring (verified 2026-09-04)

> Two rows below are **superseded by P0-A1** — see the "### P0-A1" section that follows.

#### What P0-A0 delivered (verified facts)

| Fact | Detail |
|---|---|
| Package dir | `packages/commercial-policy/` |
| npm name / version | `@lasyncro/commercial-policy` @ `0.1.0` (`private: false`) |
| Nature | pure / isomorphic — zero runtime deps; no React / Express / Knex / DB / browser globals / `import.meta.env` / `process.env` behaviour; browser-safe **and** Node-safe |
| Current exports | *(P0-A0)* wiring sentinel only (`COMMERCIAL_POLICY_PACKAGE`, `COMMERCIAL_POLICY_WIRING_OK`). **Superseded by P0-A1** — the full engine (`Tier`, `TIER_ORDER`, `tierAtLeast`, `ModuleId`, `FeatureKey`, `CapabilityId`, `AccessRequirement`, `AccessContext`, `AccessDecision`, `evaluateAccess`, `CAPABILITY_REQUIREMENTS`, catalog, limits) now ships |
| Built dist (committed, per `packages/*` convention) | `packages/commercial-policy/dist/index.js`, `dist/index.d.ts` — reproducible from `tsc -b tsconfig.build.json` |
| Production build | root `package.json` `build:deps` builds it. *(P0-A0 inserted it after `packages/backend-core`; **P0-A1 moved it BEFORE `packages/backend-core`** since backend-core now consumes it.)* |
| App dependency wiring | declared in **both** `apps/backend/package.json` and `apps/frontend/package.json` `dependencies` (`0.1.0`, same convention as `@lasyncro/backend-core`) |
| Frontend source resolution | Vite alias + `apps/frontend/tsconfig.json` path + `jest.config.js` mapping (node + frontend projects) — all point at `packages/commercial-policy/src/index.ts` |
| Backend compiled-runtime resolution | workspace dependency → package `exports` → built `dist/index.js` (proven with a compiled-`node` `import()`, not tsx / source aliasing) |
| Dockerfile | **not modified** — its existing sequence `rm -rf modules/*/dist packages/*/dist` → `npm run build:deps` rebuilds the package; a full `build:deps` run confirmed the package survives that wipe-and-rebuild |
| `apps/backend/tsconfig.json` | **not modified** — `node16` resolution + workspace symlink + built `dist` + `exports.types` is sufficient (same as `@lasyncro/shared`) |

### Architectural decision (ratified)

> There MUST be exactly **one physical** commercial-policy implementation.
> Duplicated frontend/backend tier maps, or an equivalence test between two
> copies, are **not** an acceptable substitute. Every future commercial-access
> decision converges on `packages/commercial-policy/` — not on
> `usePlanEntitlement.ts` `PLAN_FEATURES`, not on a private `TIER_ORDER` in
> `resolveNavVisibility` / `ModuleTabBar` / `exportReports` /
> `require-entitlement.middleware`, not on `backend-core` alone.

A permanent wiring contract (`tests/contract/commercial-policy-package-wiring.contract.test.ts`,
7/7 green) asserts the single-package invariant and that every alias/mapping/path
resolves to the same source.

### System-wide scope (not a Warehouse/Purchasing/Sourcing patch)

Warehouse, Purchasing, and Sourcing are the currently-observed regression
examples. The target architecture applies to the **entire** laSyncro commercial
surface: every module and screen, every nav parent and child, every
`ModuleTabBar` tab, every direct and nested route, every merchant-facing backend
API, every module descriptor, every commercial limit, and all upgrade/locked UX.

### Mandatory future coverage — carried forward, **not** implemented in P0-A0

These are acceptance requirements for subsequent P0-A slices (P0-A1 policy +
P0-A2 enforcement). None are done.

| ID | Contract |
|---|---|
| C14 | COMPLETE SURFACE COVERAGE — every commercial surface maps to a `CapabilityId` |
| C15 | NO LEGACY COMMERCIAL POLICY — no surface computes tier/module gating outside the shared package |
| C16 | ALL-MODULE CROSS-SURFACE PARITY — sidenav == `ModuleTabBar` == route gate == backend, every module, every tier |
| C17 | ROUTE COVERAGE — every commercial route subtree carries a `CommercialGate` bound to the registry |
| C18 | BACKEND COVERAGE — every commercial API route carries `requireCapability` + `requireAction` |
| C19 | MODULE-ID INTEGRITY — every referenced `ModuleId` is canonical and emittable by tier/grant policy |
| C20 | CAPABILITY POLICY INTEGRITY — every `CapabilityId` resolves to exactly one non-contradictory requirement |
| C21 | SCALE GLOBAL INVARIANT — Scale satisfies every non-bespoke capability across the whole surface |
| C22 | FULL TIER MATRIX — starter/core/growth/scale × every capability → expected decision table |
| C23 | DENIAL SEMANTICS — each denial reason renders its designated UI; no fabricated tier steps anywhere |
| C24 | COMMERCIAL POLICY COVERAGE SNAPSHOT — a checked-in `{surface → capability → requirement}` inventory that CI diffs |

### P0-A0 verification evidence (durable summary)

- package `tsc -b` build PASS; dist reproducible from clean
- wiring contract 7/7 PASS
- frontend Vite resolution PASS (→ `packages/commercial-policy/src/index.ts`)
- frontend TypeScript package resolution PASS
- frontend Jest package resolution PASS
- backend TypeScript package resolution PASS
- backend compiled-`node` runtime resolution PASS (`exports` → `dist/index.js`)
- contract-project Jest resolution PASS
- full root `npm run build:deps` PASS end-to-end; deploy wipe-and-rebuild path proven
- backend TSC error count = 0; commercial-policy target TSC errors = 0
- frontend TSC = 19 pre-existing baseline errors, all in unrelated files, none attributable to this slice (Docker already skips frontend `tsc -b`)
- Jest project ownership: `UNOWNED = 0`, `MULTI_OWNED = 0`
- lockfile delta = the four `@lasyncro/commercial-policy` entries plus one incidental reconciliation of `modules/wms/package.json`'s already-declared `@lasyncro/shared` dep; no version upgrades, no `npm audit fix`

### Remaining RED state after P0-A0 (expected)

> *P0-A1 update:* the pure-engine assertions in this list are now GREEN; **24**
> deliberate P0-A2 REDs remain — see the "### P0-A1" section for the current list.
> The snapshot below is the P0-A0-era state.

**25 deliberate commercial-access assertions remain RED** — 21 policy/route
contracts (`tests/contract/commercial-access-policy.contract.test.ts`,
`tests/contract/commercial-route-enforcement.contract.test.ts`) + 4 frontend
parity contracts (`tests/unit/ui/commercial-access/nav-surface-parity.test.tsx`).
They encode known P0-A1/P0-A2 gaps:

- canonical `Tier` / `ModuleId` / `CapabilityId` policy; consolidation of the five private `TIER_ORDER` maps
- invalid `wms-lite` nav module id → canonical `wms`
- `suppliers-portal` as a real canonical, tier-emittable module (Purchasing = Starter+ *at P0-A1; **superseded 2026-09-06** — Purchasing is now Core+, see §33*)
- shared `evaluateAccess()` + shared requirement registry
- removal of the `import.meta.env.DEV` module-gate bypass in `resolveNavVisibility`
- removal of the fabricated `requiredTier ?? 'growth'` fallback in `SidenavContent` / `ModuleTabBar` / `UpgradePrompt`
- frontend `CommercialGate` + route/backend parity; backend `requireCapability`
- Warehouse Analytics contradictory tab config (`requiredTier: 'growth'` **and** `feature: 'wms.pick_batches'` which is a Starter feature)

Three previously-RED **package-existence** proxy assertions correctly flipped
GREEN when P0-A0 created the physical package — that is P0-A0's deliverable, not
a fix to the production defect. **P0-A0 does not fix the entitlement defect.**

Commercial-policy decisions ratified for P0-A1 — **now encoded in the pure engine's
`CAPABILITY_REQUIREMENTS`** (verified 2026-09-04), **not yet enforced on any runtime
surface** (that is P0-A2):

- **Purchasing (hub / Open POs / Suppliers / Sourcing) = Starter+**, canonical module `suppliers-portal`, no Growth tier wall.
- **Warehouse:** `warehouse.operations` = Starter · `warehouse.problem_center` = Core · `warehouse.floor_planning` = Growth · `warehouse.analytics` = Growth (feature `wms.analytics`, not `wms.pick_batches`).

### P0-A1 — canonical policy engine (implemented + verified 2026-09-04)

`@lasyncro/commercial-policy` is now the **canonical owner** of commercial-access
truth. It is still a pure, zero-runtime-dependency, isomorphic package (no React /
Express / Knex / DB client / `import.meta.env` / `process.env`; browser-safe and
Node-safe). `packages/backend-core/src/config/tiers.ts` is a **thin compatibility
re-export** — every established public symbol (`Tier`, `TIERS`, `TierConfig`,
`TIER_CONFIG`, `getTierConfig`, `tierHasFlag`, `isValidTier`) is preserved with
unchanged values, zero backend callers migrated.

**Dependency direction (ratified + enforced):** `commercial-policy` → canonical
truth; `backend-core` → compatibility consumer/re-export. `commercial-policy` MUST
NOT import `backend-core` (contract A1-C11 GREEN GUARD). Root `build:deps` builds
`commercial-policy` **before** `backend-core`.

**Tier model.** `TIER_ORDER = { starter: 0, core: 1, growth: 2, scale: 3 }`;
`tierAtLeast(actual, required)` — higher tiers satisfy every lower minimum.
**Scale invariant (holds by construction):** every active standard capability is
ALLOWED under `standardContextForTier('scale')` (17/17); every Scale standard
limit is `Infinity`.

**Canonical plan limits** (verified, unchanged):

| Tier | seatLimit | monthlyOrderCap | shippedOrderCap | specterSessionCap | price (¢) |
|---|---|---|---|---|---|
| starter | 0 | 50 | 50 | 500 | 0 |
| core | 2 | 2000 | 500 | 5000 | 7900 |
| growth | 5 | 10000 | 2500 | 25000 | 17900 |
| scale | ∞ | ∞ | ∞ | ∞ | 34900 |

> The frontend legacy display constants in `apps/frontend/src/config/tiers.ts`
> (`TIER_SHIPPED_ORDER_CAP` core 200 / growth 1000; `TIER_SEAT_LIMIT` starter 1 /
> core 3) **still drift** from these and are **not migrated in P0-A1** — tracked
> compatibility debt for P0-A2/A3.

**Module registry.** Typed `ModuleId` + `MODULE_CLASSIFICATION`
(`standard` / `grant_only` / `internal` / `legacy`). `wms` is canonical;
`wms-lite` is **not** in the registry (invalid legacy nav reference).
`suppliers-portal` is a canonical **Starter-standard** module, inherited by
core/growth/scale via `modulesForTier()`.

> **Deliberate transitional divergence (P0-A1 only):** canonical
> `modulesForTier('starter')` **includes** `suppliers-portal`; the frozen legacy
> `backend-core` `TIER_CONFIG.modules` (the `shop_module_entitlements` seed shape)
> **still omits it**. Kept divergent so seeding/runtime behaviour is byte-identical
> until P0-A2 wires the effective-module resolver. This is **not** final architecture.

> **SUPERSEDED 2026-09-06 by `COMMERCIAL-REMODEL-ALIGN-01` (§33).**
> `suppliers-portal` is now a **Core+** canonical standard module — Starter has no
> Purchasing surface at all. The paragraph above is the P0-A1-era record, kept for
> history. `LEGACY_MODULES_BY_TIER` deliberately remains frozen compatibility data
> and was NOT changed.

**Feature registry.** Six canonical `FeatureKey`s, all Growth: `wms.analytics`,
`demand.forecasting`, `alerts.rules`, `returns.analysis`,
`exports.column_selection`, `specter.full_capture`.

> **Updated 2026-09-06 by `COMMERCIAL-REMODEL-ALIGN-01` (§33):** now **five** —
> `specter.full_capture` was removed from canonical active feature truth because
> Specter is DEPRECATED. The legacy compatibility flag list in `legacy.ts` still
> carries it. **Warehouse Analytics uses
`wms.analytics`, never `wms.pick_batches`.** The legacy 27-entry frontend
`PLAN_FEATURES` map is **not** copied and remains runtime debt for P0-A2/A3.

**Active capability catalog — 17 capabilities, no open product decision:**

> **Updated 2026-09-05 by P0-A3-3** (see "### P0-A3-3"): the registry now holds
> **18** capabilities — `returns.intake` was added, listed in the table below.
> The "17" above is the P0-A1-era count, left as the historical record.
>
> **Updated 2026-09-06 by `COMMERCIAL-REMODEL-ALIGN-01`** (§33): the registry holds
> **18** capabilities — `purchasing.sourcing` was added and `specter.full_capture`
> was retired. `purchasing.core` moved from Starter+ to Core+.

| CapabilityId | policy |
|---|---|
| overview.core | Starter+ · module `overview` |
| overview.live_map | Growth+ · module `overview` |
| orders.core | Starter+ · module `order-nexus` |
| inventory.core | Core+ · module `products` |
| demand.forecasting | Growth+ · module `demand` · feature `demand.forecasting` |
| alerts.inbox | Starter+ · module `alerts` |
| alerts.rules | Growth+ · module `alerts` · feature `alerts.rules` |
| returns.intake | Starter+ · module **`wms`** *(added by P0-A3-3 — intake is warehouse execution, deliberately NOT module `returns`)* |
| returns.core | Core+ · module `returns` |
| returns.analysis | Growth+ · module `returns` · feature `returns.analysis` |
| warehouse.operations | Starter+ · module `wms` |
| warehouse.analytics | Growth+ · module `wms` · feature `wms.analytics` |
| warehouse.floor_planning | Growth+ · module `floor-planning` |
| warehouse.problem_center | Core+ · module `problem-center` |
| purchasing.core | **Core+** · module `suppliers-portal` *(was Starter+; changed by COMMERCIAL-REMODEL-ALIGN-01)* |
| purchasing.sourcing | **Growth+** · module `suppliers-portal` *(ADVANCED SOURCING — added by COMMERCIAL-REMODEL-ALIGN-01)* |
| exports.core | Core+ (tier-only, no module) |
| exports.column_selection | Growth+ · feature `exports.column_selection` |
| ~~specter.full_capture~~ | **RETIRED** by COMMERCIAL-REMODEL-ALIGN-01 — Specter is DEPRECATED and carries no active capability |

**Legacy / disabled** (in `CAPABILITY_CATALOG`, **not** in
`CAPABILITY_REQUIREMENTS`, never evaluated as a live gate): `finances.core`,
`finances.cashflow`, `cashflow.revenue_buckets` — status `legacy`;
`customers.ltv` — status `disabled`. Legacy compatibility code and (commented-out)
routes are **not** removed by P0-A1.

> **SUPERSEDED 2026-09-06 by `COMMERCIAL-REMODEL-ALIGN-01` (§33).** The single
> `legacy` bucket is split, because "withdrawn" and "gone for good" are different
> facts: `CapabilityStatus` is now
> `active | paused | deprecated | legacy | disabled` (`legacy` retained as a
> compatibility alias). Finances entries are **paused** — withdrawn from sale but
> **may return in a future release**. `customers.ltv`/`customers.segmentation` and
> `specter.full_capture` are **deprecated** — not expected to return. Physical code
> for all three is deliberately NOT deleted; cleanup is a separate,
> regression-protected future program.

**Access decision model.** `AccessRequirement { moduleId?, minimumTier?, feature?,
action? }` · `AccessContext { tier, modules, flags, roles?, allowedActions? }` ·
`AccessDecision { allowed, reason, requiredTier?/Module?/Feature?/Action? }`.
Denial vocabulary: `ALLOWED` · `TIER_TOO_LOW` · `MODULE_NOT_INCLUDED` ·
`FEATURE_NOT_INCLUDED` · `ROLE_FORBIDDEN`. Evaluation order — **tier → module →
feature → action; first failure wins**; a nullish requirement ⇒ ALLOWED; no
environment branch. **A Scale account missing a module returns
`MODULE_NOT_INCLUDED`, never `TIER_TOO_LOW`.** The role/action layer is not owned
here — the caller supplies the resolved `allowedActions`; a role/action denial
returns `ROLE_FORBIDDEN` and must never surface as a billing-upgrade reason.

**Verification evidence (durable):** commercial-policy build PASS + dist
reproducible from clean; backend-core build PASS + compatibility runtime PASS;
package remains zero-runtime-dependency; 68/68 ratified tier matrix; 17/17 Scale
supremacy; engine contract 144/144; ownership contract 13/13; P0-A0 wiring
contract 7/7; backend TSC 0, commercial-policy TSC 0, target TSC errors 0;
frontend TSC unchanged at its pre-existing 19-error unrelated baseline; Jest
ownership `UNOWNED=0` / `MULTI_OWNED=0`; sourcing regressions
(Worklist 29 / Targeted-mode 10 / Targeted-actions 19 / Orders-entry 3) all GREEN.

**P0-A1 does NOT fix production merchant access.** Still OPEN for **P0-A2**
(24 deliberate REDs remain across
`tests/contract/commercial-access-policy.contract.test.ts`,
`tests/contract/commercial-route-enforcement.contract.test.ts`,
`tests/unit/ui/commercial-access/nav-surface-parity.test.tsx`):

- `EntitlementsService.getForUser` effective modules = `modulesForTier(currentTier) ∪ still-valid explicit grants`
- Sidenav (`resolveNavVisibility` / `navBootstrap`) → consume `capabilityId` + `evaluateAccess`
- `ModuleTabBar` → same; `ModuleTab` gains a capability reference
- reusable frontend `CommercialGate` on every module route subtree
- backend `requireCapability(capabilityId)` middleware + route migration
- `wms-lite` → `wms` runtime nav correction; `suppliers-portal` made emittable in the effective set
- remove the `import.meta.env.DEV` module-gate bypass in `resolveNavVisibility`
- remove the fabricated `requiredTier ?? 'growth'` fallback (`SidenavContent`, `ModuleTabBar`, `UpgradePrompt`)
- fix the contradictory `warehouseModuleTabs.ts` Analytics entry (`requiredTier: 'growth'` + `feature: 'wms.pick_batches'`)
- sidenav ↔ tab ↔ route ↔ backend parity
- denial-`reason`-driven `UpgradePrompt` rendering

**C14–C24.** P0-A1 now provides real foundations for **C19** (module-id
integrity), **C20** (capability policy integrity — one non-contradictory
requirement per capability), **C21** (Scale global invariant), and **C22** (full
tier matrix). The full system-wide closure of C14–C24 (complete surface coverage,
no legacy policy, all-module cross-surface parity, route + backend coverage,
denial semantics, the checked-in coverage snapshot) is **P0-A3** and is **not
complete**.

> **P0-A2A (2026-09-04) delivered the backend half of this list:**
> `EntitlementsService.getForUser` effective union, `requireCapability(capabilityId)`
> middleware + the first backend route migration, the `COMMERCIAL_ACCESS_DENIED`
> response contract, and `requireTier`/`meetsTier` canonicalised onto
> `tierAtLeast()` (the private backend `TIER_ORDER` map is gone). Everything else
> in the list above — Sidenav / `ModuleTabBar` / `CommercialGate` / `navBootstrap`
> `capabilityId` conversion, `wms-lite` runtime removal, the `import.meta.env.DEV`
> bypass, the `?? 'growth'` fallback, the `warehouseModuleTabs.ts` Analytics
> contradiction, sidenav↔tab↔route↔backend parity, `UpgradePrompt` reason
> rendering — is **P0-A2B** and still RED. See "### P0-A2A" below.

### P0-A2A — effective entitlements + backend capability enforcement (implemented + verified 2026-09-04)

**P0-A2A is the backend / runtime commercial-convergence foundation.** It makes
the *backend* consume the canonical engine and derive a tier floor; it does
**not** touch any frontend surface. The visible production defect (Scale shop
blocked in the sidebar while the route/API allow it) is **not fixed by P0-A2A** —
that is P0-A2B.

Delivered:

1. Effective entitlement resolution in `EntitlementsService.getForUser`
2. `requireCapability(capabilityId)` backend middleware
3. `requireTier` / `meetsTier` re-based on the canonical comparator
4. First backend route migration (suppliers · WMS base · WMS analytics · WMS
   problem-center · floor-planning · demand)
5. The normalized `COMMERCIAL_ACCESS_DENIED` denial response contract
6. Fix of a newly discovered RLS defect in downgrade revocation
   (`ENT-REVOCATION-RLS-01`)

#### 1. Effective entitlement model

`EntitlementsService.getForUser(userId)` no longer returns a rows-only snapshot.
It now derives a **tier floor** from `@lasyncro/commercial-policy` and unions the
persisted rows on top:

```
currentTier      = resolveTierForShop(shopId)   // canonical path; fails closed to 'starter'
effectiveModules = modulesForTier(currentTier)  ∪  temporally-valid persisted module rows
effectiveFlags   = flagsForTier(currentTier)    ∪  temporally-valid persisted flag rows
```

- **Zero persisted rows still yields the full tier floor** (previously it returned
  `{ modules: [], flags: [] }`).
- Valid persisted rows are **purely additive** over the floor.
- **Expired rows are excluded** by the unchanged temporal query
  (`valid_from <= now AND (valid_until IS NULL OR valid_until > now)`).
- **No deny/exclusion row model**, no schema change, no migration, no backfill.
  Downgrade continues to rely on the current tier plus temporal revocation
  (see §4 below).
- Persisted duplicate tier-derived rows may remain in the table temporarily and
  are harmless (set-union). These persisted rows are **legacy / additive
  entitlement rows — they are not all semantically bespoke commercial grants**;
  true bespoke row-based backend enforcement is P0-A3 (see "bespoke-grant
  limitation" below).
- Snapshot shape `{ shopId, modules: string[], flags: string[] }` is unchanged.

#### 2. `requireCapability(capabilityId)`

New backend middleware in
`apps/backend/src/middleware/require-entitlement.middleware.ts` (a dedicated
`require-capability.middleware.ts` filename is an accepted alternative; the
architecture, not the path, is contractual). It consumes **only** the shared
engine — `CAPABILITY_REQUIREMENTS`, `evaluateAccess`, `modulesForTier`,
`flagsForTier` (and `tierAtLeast`) from `@lasyncro/commercial-policy`; no local
capability registry, no private `TIER_ORDER`.

**Backend A2A AccessContext:**

```
tier    = resolveTier(req)          // == req.user.tier (JWT claim)
modules = modulesForTier(tier)      // STANDARD tier grants only
flags   = flagsForTier(tier)
```

**JWT tier freshness is unchanged from existing `requireTier` behaviour** — the
decision follows the access-token `tier` claim, with no `shop_subscriptions` /
DB round-trip in the middleware. Immediate post-upgrade / post-downgrade
freshness is **P0-B**, not P0-A2A.

#### Bespoke-grant limitation (P0-A2A is not the final backend architecture)

`requireCapability` in P0-A2A **does not load per-shop persisted
`shop_module_entitlements` rows.** This is safe for the migrated A2A route set
because **every migrated capability is a standard-plan capability** — its policy
is fully expressible from `modulesForTier(tier)` / `flagsForTier(tier)`. Full
backend parity for bespoke (row-granted, non-standard) capabilities — the
middleware consulting the effective persisted set — remains **P0-A3**. Do not
present P0-A2A as the final backend entitlement architecture.

#### 3. Canonical tier comparator

The private `const TIER_ORDER` map in `require-entitlement.middleware.ts` is
**removed**. `requireTier` and `meetsTier` keep their existing public behaviour
(`requireTier` still returns `403 { error: 'TIER_INSUFFICIENT', required, current }`)
but delegate the rank comparison to `tierAtLeast()` from
`@lasyncro/commercial-policy`. Not every legacy `requireTier` route is migrated —
only the named A2A set (see §4). The four **frontend** private tier-rank maps
(`usePlanEntitlement.ts`, `resolveNavVisibility.ts`, `ModuleTabBar.tsx`,
`exportReports.ts`) still exist — P0-A2B / P0-A3.

#### 4. First backend route migration

| Route family | Was | Now (`requireCapability`) | Canonical policy |
|---|---|---|---|
| suppliers / PO / sourcing (`suppliers.routes.ts`) | `authenticateToken → requireFt2 → requireAction` | `purchasing.core` | Starter+ (module `suppliers-portal`, no tier wall) |
| WMS base ops (`wms.routes.ts`) | `requireTier('starter')` | `warehouse.operations` | Starter+ (module `wms`) |
| WMS analytics (`wms.routes.ts` `/analytics*`) | `requireTier('growth')` | `warehouse.analytics` | Growth+ (module `wms` · feature `wms.analytics`) |
| WMS problem center (`wms.routes.ts` `/problem-center/pick-exceptions`, `POST /problem-center`, `…/:taskId/replacement`) | `requireTier('core')` | `warehouse.problem_center` | Core+ (module `problem-center`) |
| floor planning (`floor-planning.routes.ts`) | `requireTier('starter')` | `warehouse.floor_planning` | **Growth+** (module `floor-planning`) — see leak fix below |
| demand (`demand.routes.ts`) | `requireTier('growth')` | `demand.forecasting` | Growth+ (module `demand` · feature `demand.forecasting`) |

> **Purchasing supersession note — 2026-09-07:** §32 is historical implementation
> evidence. Any Purchasing statement in this section that describes
> `suppliers-portal` as Starter+, assigns Sourcing to `purchasing.core`, gives
> `/suppliers-portal/*` only one Core gate, or shows Starter allowed on
> `purchasing.core` is superseded by the canonical remodel in §33 and the
> completed runtime wiring in §35 (`P0-A3-5`).

**Middleware ordering on every migrated chain:**
`authenticateToken → requireFt2 → requireCapability → requireAction → handler`
(commercial eligibility first, RBAC second; `requireAction` is never folded into
commercial policy).

**Not migrated in P0-A2A — deliberately left on `requireTier('core')`:**

- `/api/v1/wms/recount*` — no `warehouse.recount` capability exists yet; folding
  it into `warehouse.operations` would wrongly widen it.
- `/api/v1/wms/sender-addresses*` — outside the A2A capability families.

Both are **P0-A3** scope.

#### Floor Planning policy leak — closed by P0-A2A

This is an **intentional commercial behaviour correction**, not a refactor.

| Tier | Before P0-A2A (`requireTier('starter')`) | After P0-A2A (`requireCapability('warehouse.floor_planning')`) |
|---|---|---|
| Starter | ALLOW | **DENY** |
| Core | ALLOW | **DENY** |
| Growth | ALLOW | ALLOW |
| Scale | ALLOW | ALLOW |

The backend floor-planning routes previously admitted every tier
(`requireTier('starter')` after the FP-GATE1 change); the ratified canonical
policy is **Growth+**. P0-A2A brings the backend gate into line with the ratified
policy and closes the leak. (The field-level Growth guard already present in the
floor-planning controller is now redundant but harmless.)

#### 5. Denial response contract

On a commercial denial `requireCapability` returns:

```
403
{
  error: 'COMMERCIAL_ACCESS_DENIED',
  reason,                 // TIER_TOO_LOW | MODULE_NOT_INCLUDED | FEATURE_NOT_INCLUDED
  capabilityId,
  currentTier,
  requiredTier?,          // present only when the AccessDecision carries it
  requiredModule?,
  requiredFeature?
}
```

- **No fabricated Growth** — `reason` / `requiredTier` come straight from
  `evaluateAccess`.
- **RBAC stays separate.** `requireCapability` performs no role check and never
  emits a role-denial reason; role/action denial remains `requireAction`'s
  `ACTION_FORBIDDEN` (and the existing permission responses). A role/action
  denial is **not** a billing-upgrade denial.

#### 6. `ENT-REVOCATION-RLS-01` — downgrade revocation was RLS-blind (P0, closed by P0-A2A)

**Root cause.** `EntitlementRevocationService.revokeEntitlements` executed its
`UPDATE` inside a **bare pooled `db.transaction`** with no tenant context.
`shop_module_entitlements` has `FORCE ROW LEVEL SECURITY`, and migration
`0135` (2026-07-29) tightened the write policy to
`USING / WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int)`.
With `app.current_tenant` unset the predicate is `NULL`, so a downgrade
revocation `UPDATE` **silently matched zero rows** — the Growth-only rows kept
`valid_until = NULL` and `getForUser` kept unioning them. (This regressed the
2026-07-15 §18 fix once policy `0135` landed.)

**Fix.** The write now runs through the canonical
`withTenant(shopId, async (trx) => { … })` helper (`SET LOCAL
app.current_tenant = shopId`) already used across the domain layer for
RLS-scoped writes.

**Invariants preserved:** `FORCE ROW LEVEL SECURITY` stays enabled; no privileged
/ `BYPASSRLS` role; no RLS bypass; `UPDATE`-only temporal revocation via
`valid_until`; a single atomic transaction. **This defect is CLOSED by P0-A2A.**

#### P0-A2A verification evidence (durable)

- `commercial-backend-enforcement.contract.test.ts` — **22 / 22 GREEN**
- `require-capability.test.ts` (per-tier decision matrix, denial body, Scale
  invariant, RBAC separation) — **34 / 34 GREEN**
- `effective-tier-floor.test.ts` (real disposable Postgres: module floor · flag
  floor · additive rows · expired-row exclusion · Growth→Core downgrade through
  the real revocation path) — **5 / 5 GREEN**
- representative real-route integration (`createApp()` + disposable Postgres;
  one real endpoint per capability family + Scale invariant + real-route RBAC
  separation) — **18 / 18 GREEN**
- `commercial-route-enforcement.contract.test.ts` — **5 PASS / 3 deliberate
  A2B RED** (frontend route/nav/page gates)
- `entitlementMounts` + `entitlementDenial` contract — **3 / 3 GREEN**;
  `entitlement-mounts` integration — **5 / 5 GREEN**
- sourcing regression set (Worklist · Targeted-mode · Targeted-actions ·
  Order-detail inventory-sourcing) — **61 / 61 GREEN**
- `packages/backend-core` build **PASS**; `apps/backend` `tsc --noEmit`
  **error count 0**, target errors **0**
- Jest ownership `UNOWNED=0` / `MULTI_OWNED=0`
- disposable-DB runtime role: `sf_app`, `rolsuper=false`, `rolbypassrls=false`;
  `TEST_DB_CREATED/MIGRATED/RUNTIME_OK/DROPPED` markers emitted
- no migration, no RLS-policy change, no `package`/config change, no frontend
  change, no persistent DB mutation

#### Still OPEN after P0-A2A

**P0-A2B (the visible frontend/parity defect) — now IMPLEMENTED + VERIFIED,
see "### P0-A2B" below. Left as-written for the historical scope-at-handoff
record:**

- frontend `commercialContext` adapter
- Sidenav (`resolveNavVisibility` / `navBootstrap`) capability migration
- `ModuleTabBar` capability migration; `navBootstrap` `capabilityId` conversion
- `wms-lite` runtime nav removal (→ `wms`)
- reusable frontend `CommercialGate` + direct-route parity
- `UpgradePrompt` denial-`reason`-driven rendering
- remove the fabricated `requiredTier ?? 'growth'` fallback
- remove the `import.meta.env.DEV` module-gate bypass in `resolveNavVisibility`
- fix the contradictory `warehouseModuleTabs.ts` Analytics entry
  (`requiredTier: 'growth'` + `feature: 'wms.pick_batches'`)
- full frontend ↔ backend surface parity
- deliberate RED profile that remained at P0-A2A handoff: `commercial-route-enforcement`
  3 frontend RED · `commercial-access-policy` 14 frontend / multi-surface RED ·
  `nav-surface-parity.test.tsx` pending A2B — **all closed by P0-A2B; see
  "### P0-A2B" § "P0-A2B verification evidence" for the current 78/78 + 41/41
  GREEN result**

**P0-A3 carry-forward:**

- the remaining backend route families
- bespoke persisted-grant enforcement inside `requireCapability`
- the `/recount*` commercial-capability decision
- `/sender-addresses*` classification
- the four remaining private frontend `TIER_ORDER` copies
- full system-wide C14–C24 coverage / the checked-in coverage snapshot

**P0-B carry-forward (unchanged, still separate):** `BILL-ENTITLEMENT-01`
Fact B (reviewer expected Growth, production reported Scale) is **not** resolved
by P0-A2A — provider SKU/price mapping, `shop_subscriptions` writer / plan
transition integrity, webhook ordering / idempotency, current-state ↔ JWT
freshness, and the commercial-state transition audit trail all remain P0-B.

### P0-A2B — frontend commercial-access convergence (implemented + verified 2026-09-04; pending commit/push/deploy)

**P0-A2B is the frontend half of `COMMERCIAL-ACCESS-ARCH-01`.** It retires the
three-layer split §13.1 warned about and P0-A2A already retired on the
backend: Sidenav, `ModuleTabBar`, and the direct frontend route gate now
converge on **one** shared adapter over the canonical
`@lasyncro/commercial-policy` engine — the same engine P0-A1 shipped and
P0-A2A wired into the backend. This closes the production defect the
`NAV-ENTITLEMENT-PARITY-01` audit found (a Scale shop blocked in the sidebar
while the tab/route/API all allowed it).

**Status is IMPLEMENTED and VERIFIED. It is NOT yet DEPLOYED** — the changes
exist in the worktree, uncommitted, pending Milad's review and
commit/push/deploy through the normal path.

#### 1. Shared frontend adapter

New file: `apps/frontend/src/runtime/commercialContext.ts` — the single
frontend entry point onto `evaluateAccess()`. No duplicated frontend
tier/module/feature policy.

```
buildCommercialContext({ tier, snapshot }) =
  {
    tier,
    modules: modulesForTier(tier) ∪ snapshot.modules,
    flags:   flagsForTier(tier)   ∪ snapshot.flags,
  }

decideCapability(capabilityId, context) =
  isCapabilityId(capabilityId)
    ? evaluateAccess(CAPABILITY_REQUIREMENTS[capabilityId], context)
    : { allowed: false, reason: 'MODULE_NOT_INCLUDED' }   // fail closed, never a Growth fallback

useCommercialAccess() =
  { context, isResolved, decide }   // sources tier + the shop's LIVE entitlement
                                      // snapshot from EntitlementsContext
```

Every canonical decision flows through `@lasyncro/commercial-policy`'s
`CAPABILITY_REQUIREMENTS` + `evaluateAccess` — mirrors the exact same
`tier-floor ∪ persisted-rows` shape P0-A2A's `EntitlementsService` already
uses on the backend (§32 "1. Effective entitlement model").

#### 2. Sidenav / navigation

`navBootstrap.ts` migrated to `capabilityId` for the Warehouse and
Purchasing families and the Demand child:

| Nav item | Canonical `capabilityId` |
|---|---|
| Warehouse parent + Operations | `warehouse.operations` |
| Floor Planning | `warehouse.floor_planning` |
| Warehouse Analytics | `warehouse.analytics` |
| Problem Center | `warehouse.problem_center` |
| Purchasing parent + Open POs + Suppliers + Sourcing | `purchasing.core` |
| Demand | `demand.forecasting` |

Also closed:

- the invalid `wms-lite` `requiredModuleId` — **zero live runtime references**
  remain across the frontend commercial surfaces (only historical/explanatory
  comments mention the string)
- the `import.meta.env.DEV` module-gate bypass in `resolveNavVisibility.ts`
  — dev and production now resolve the identical decision from the identical
  inputs
- the fabricated `requiredTier ?? 'growth'` fallback in `SidenavContent.tsx`
  / `ModuleTabBar.tsx` / `UpgradePrompt.tsx` — migrated denial paths now
  render the *decision's own* `requiredTier` (or none, for
  `MODULE_NOT_INCLUDED` / `ROLE_FORBIDDEN`), never a hardcoded tier
- compact-mode Sidenav: a denied submodule no longer navigates directly on
  click — it now shares the exact same `renderChild()` denial-handling path
  expanded mode already used, closing a click-through the compact popover
  previously had

Migrated items no longer carry an independent `requiredModuleId` /
`requiredTier` — their commercial decision is `capabilityId`-only.
Non-migrated nav items (Returns, Inventory parent, unmigrated children) keep
their legacy fields unchanged — this is a scoped migration, not a rewrite of
every nav item.

#### 3. `ModuleTabBar`

- `ModuleTab` gained `capabilityId?: CapabilityId`
- capabilityId tabs decide via `useCommercialAccess()` — the SAME hook
  `CommercialGate` consumes — so `ModuleTabBar`'s AccessContext is tier floor
  **∪ the shop's live entitlement snapshot**, not a hardcoded empty one
- `capabilityId` takes precedence over `requiredTier` / `feature` in
  `isLocked()` — the legacy fields are checked only when no `capabilityId` is
  present on the tab
- the private `TIER_ORDER` map is removed; the residual legacy
  `requiredTier` comparison now delegates to canonical `tierAtLeast()`
- **legacy `requiredTier` / `feature` (`usePlanEntitlement`) support is kept
  intentionally** for callers not yet migrated — this is deferred P0-A3 scope,
  not an oversight. **At P0-A2B handoff (2026-09-04)** the two private
  frontend `TIER_ORDER` copies that remained anywhere in the frontend were
  confirmed to exist ONLY in the two files P0-A3 owned at that time:

  ```
  apps/frontend/src/hooks/usePlanEntitlement.ts
  apps/frontend/src/config/exportReports.ts
  ```

  **Superseded 2026-09-04 by P0-A3-1** (§32 "### P0-A3-1"):
  `exportReports.ts` was migrated and no longer owns a private `TIER_ORDER`.
  `usePlanEntitlement.ts` is now the sole remaining frontend residual.

#### 4. Direct routes

Every module route subtree now carries its own `CommercialGate`, bound to
the same `capabilityId` the nav/tab surfaces use for that destination — a
direct URL can no longer bypass commercial policy:

| Route | `CommercialGate capabilityId` |
|---|---|
| `/wms/*` | `warehouse.operations` |
| `/wms/analytics` | `warehouse.analytics` — its own **independent** Growth+ gate, nested inside the Starter+ `/wms/*` gate, not inherited from it |
| `/suppliers-portal/*` | `purchasing.core` |
| `/floor-planning/*` | `warehouse.floor_planning` |
| `/problem-center/*` | `warehouse.problem_center` |
| `/demand/*` | `demand.forecasting` (replaces the legacy `PlanGate feature="demand.forecasting"` — same Growth+ behaviour, canonical mechanism) |

**Public, token-based `/wms/analytics/display` is unaffected** — it is a
separate top-level route (`App.tsx`) rendering `WmsDisplayPage`, which never
passes through `WmsAnalyticsPage`/`CommercialGate`. It stays outside
authenticated commercial gating, as designed.

`CommercialGate` (new: `apps/frontend/src/components/CommercialGate.tsx`) is
the reusable mechanism: ALLOW renders children; DENY renders a
decision-driven `UpgradePrompt` in their place; an unresolved entitlement
snapshot renders nothing (never flashes protected content).

#### 5. `UpgradePrompt` denial semantics

`UpgradePrompt` gained an optional `decision?: AccessDecision` prop.
When present it is **authoritative** — the sole source of the required tier /
denial reason:

| `AccessDecision.reason` | Rendering |
|---|---|
| `TIER_TOO_LOW` | upgrade CTA to the **exact** `decision.requiredTier` |
| `MODULE_NOT_INCLUDED` | no fabricated tier step (no `decision.requiredTier` to show) |
| `FEATURE_NOT_INCLUDED` | same as `MODULE_NOT_INCLUDED` — no fabricated tier unless the decision itself carries one |
| `ROLE_FORBIDDEN` | no billing / upgrade CTA at all — a permission denial is never a billing prompt |

The legacy `requiredTier` string prop remains supported for non-migrated
P0-A3 callers (`PlanGate`, `MembersPage`, `WmsOperationsPage`) — untouched by
this slice.

#### 6. Warehouse Analytics correction

`warehouseModuleTabs.ts`'s Analytics tab previously declared a contradictory
pair — `requiredTier: 'growth'` **and** `feature: 'wms.pick_batches'`
(`wms.pick_batches` is a *Starter* feature, so the `feature` check was a
no-op that could never actually gate anything). It now declares only
`capabilityId: 'warehouse.analytics'`, whose canonical requirement
(`moduleId: 'wms'`, `minimumTier: 'growth'`, `feature: 'wms.analytics'`) is
owned entirely by `packages/commercial-policy` — matching the backend gate
P0-A2A already migrated (§32 "4. First backend route migration").

#### 7. Jest infrastructure correction (verification-support only)

The frontend Jest project's `moduleNameMapper` was missing the generic
relative-`.js`-extension-stripping rule the `contract` / `backend-legacy` /
`backend-integration` projects already had. `@lasyncro/commercial-policy`'s
own source uses explicit `.js` extensions on its internal relative imports
(standard TS-ESM style); without the mapper rule, Jest's frontend project
could not resolve the package at all, crashing any test that imported it.
The fix reuses the **exact same, already-established generic rule** —
`'^(\.{1,2}/.*?)(?<!\.c)\.js$': '$1'` — copied verbatim into the frontend
project's `moduleNameMapper`. This is a repository-wide Jest/TypeScript
resolution pattern, **not** a commercial-policy-specific hack, and changes no
test assertions or application behaviour.

#### Verified product matrix

| Capability | Starter | Core | Growth | Scale |
|---|---|---|---|---|
| `warehouse.operations` | ALLOW | ALLOW | ALLOW | ALLOW |
| `warehouse.analytics` | DENY (Growth) | DENY (Growth) | ALLOW | ALLOW |
| `warehouse.floor_planning` | DENY (Growth) | DENY (Growth) | ALLOW | ALLOW |
| `warehouse.problem_center` | DENY (Core) | ALLOW | ALLOW | ALLOW |
| `purchasing.core` | ALLOW | ALLOW | ALLOW | ALLOW |
| `demand.forecasting` | DENY (Growth) | DENY (Growth) | ALLOW | ALLOW |

**Invariant, explicitly proven:** Scale can never receive an upgrade path —
no `TIER_TOO_LOW`, no `MODULE_NOT_INCLUDED`, no `FEATURE_NOT_INCLUDED` — for
any of these six capabilities, on any of the three migrated surfaces.

#### P0-A2B verification evidence (durable)

- `commercial-access-policy.contract.test.ts` +
  `commercial-route-enforcement.contract.test.ts` — **78 / 78 GREEN**
  (0 deliberate RED remaining; the 24 P0-A1-era RED count referenced earlier
  in this document is now fully closed by A2A + A2B)
- targeted frontend commercial suite — **41 / 41 GREEN**:
  `commercial-context.test.ts` 7/7 · `commercial-gate.test.tsx` 3/3 ·
  `nav-surface-parity.test.tsx` 25/25 (includes the source-coupled contract
  proving `ModuleTabBar.tsx` calls `useCommercialAccess()` and contains no
  hardcoded empty entitlement snapshot — a permanent, self-checking
  regression guard, not a one-time assertion) · `upgrade-prompt-decision.test.tsx`
  6/6
- full frontend Jest project — **79 suites PASS / 55 FAIL, 636 tests PASS /
  75 FAIL (711 total)**. Zero failures trace to any P0-A2B-touched file
  (verified by grepping every failing suite's require/stack trace for the
  eighteen A2B source files — no match). All 55 failing suites were already
  failing before P0-A2B for unrelated, pre-existing reasons; 9 of those
  suites (including all three commercial-access suites) were newly fixed as
  a side effect of the Jest `.js`-resolution correction, which also restored
  several unrelated suites (order-nexus, products, specter) that shared the
  identical pre-existing infra gap
- `apps/frontend` `tsc --noEmit` — **19 baseline errors, 0 target errors**;
  every baseline error confirmed pre-existing and unrelated to any A2B file
  (MUI theme typing, `virtual:lasyncro-modules`, `Ft1ChecklistShell`
  `UiEventName` typing, `CashFlowPage`, `SimpleBar` — none touch commercial
  access)
- Jest ownership: `backend-legacy=134 · backend-integration=38 · contract=18
  · frontend=134`, `UNOWNED=0 · MULTI_OWNED=0`
- no migration, no persistent-DB mutation, no package/lockfile change

#### Coverage gaps / carried forward (not blockers)

- **Compact-mode Sidenav denial parity** is protected structurally (both
  modes share the one `renderChild()` code path) but has no dedicated
  rendered/click (RTL) test yet — the contract-layer static check is GREEN,
  a behavioral click-simulation test is not yet written.
- **`FEATURE_NOT_INCLUDED`** shares `UpgradePrompt`'s module-denial rendering
  path with `MODULE_NOT_INCLUDED` (same code, same behaviour) but has no
  standalone test distinguishing the two reasons.
- **Additive-entitlement cross-surface parity** is enforced at the
  *architecture* level — `ModuleTabBar` is required to consume
  `useCommercialAccess()` and forbidden from hardcoding an empty snapshot,
  permanently guarded by the source-coupled test above — rather than proven
  by a live three-surface decision-value test. The current
  `CAPABILITY_REQUIREMENTS` registry cannot naturally produce a rendered
  floor-deny/additive-grant-allow case for any of the six migrated
  capabilities: every `moduleId`-only capability's module is already
  standard at every tier, and `evaluateAccess`'s `minimumTier` check
  (FIRST-FAILURE-WINS) blocks any tier-too-low shop before an additive grant
  could matter. This is intrinsic to the current registry shape, not a gap
  P0-A2B introduced or left incomplete.
- **P0-A3** still owns (updated 2026-09-04 — export convergence closed by
  P0-A3-1, see "### P0-A3-1"): the sole remaining deferred private
  `TIER_ORDER` copy (`usePlanEntitlement.ts`), bespoke persisted-grant
  backend enforcement, the remaining unmigrated backend route families
  (`/recount*`, `/sender-addresses*`), and full system-wide C14–C24 coverage.

##### `### P0-A2A` "Still OPEN after P0-A2A" list — status update

The P0-A2B bullet list under "#### Still OPEN after P0-A2A" above described
what this slice needed to deliver; every item in it is now **done** per this
section. That list is left in place as the historical record of P0-A2B's
scope-at-handoff; treat **this** "### P0-A2B" section as the current source
of truth for what actually shipped.

### P0-A3-1 — export/report commercial-access convergence (implemented + verified 2026-09-04; pending commit/push/deploy)

**P0-A3-1 is a bounded first slice of P0-A3.** It converges the export/report
download and custom-column-selection surfaces (frontend + backend) onto the
same `@lasyncro/commercial-policy` engine P0-A1/A2A/A2B already shipped. It
does **not** close all of P0-A3 — see "Still OPEN after P0-A3-1" below.

#### Ratified policy

| Surface | Capability | Minimum tier |
|---|---|---|
| Standard export/report download | `exports.core` | Core+ |
| Advanced/custom column selection | `exports.column_selection` | Growth+ |

No active report in the `QUICK_REPORTS` registry carries its own tier
authority — every active entry is a standard `exports.core` export.

#### 1. `exportReports.ts` (report registry)

- private `TIER_ORDER` map — **removed**
- `isTierSufficient()` — **removed**
- per-report `tier` field — **removed**
- every active `QuickReport` entry now carries `capabilityId: 'exports.core'`

#### 2. `ExportDrawer` / `ShopSettingsReportsPage`

Both consume the identical pattern:

```ts
const { decide } = useCommercialAccess();
const decision = decide(report.capabilityId);
const eligible = decision.allowed;
```

- `userTier`-based eligibility — **removed** (prop dropped from
  `ExportDrawerProps`; `ShopSettingsReportsPage` no longer reads
  `useEntitlements().tier`)
- the canonical decision is fail-closed: `eligible` is `false` unless
  `decision.allowed` is explicitly `true`
- the required-tier badge renders `${decision.requiredTier}+` only when the
  `AccessDecision` itself supplies `requiredTier` — never a fabricated
  fallback; falls back to neutral `'Locked'` wording otherwise

#### 3. `ColumnPicker`

- `usePlanEntitlement()` — **removed**
- decides `exports.column_selection` through the same
  `useCommercialAccess()` adapter
- no `?? 'growth'` (or equivalent) fabricated fallback

#### 4. Backend routes — `exports.routes.ts`

All 5 active export routes now chain:

```
authenticateToken → requireCapability('exports.core') → requireAction('exports:read') → handler
```

| Route |
|---|
| `GET /columns` |
| `POST /orders` |
| `POST /returns` |
| `POST /finances` |
| `POST /products` |

`requireTier('core')` — **removed** from all 5. `requireAction('exports:read')`
RBAC is unchanged and unweakened; commercial eligibility is checked first,
role/action second (the same ordering §32 "### P0-A2A" §4 established for the
first backend route migration).

#### 5. Backend controller — `exports.controller.ts` (custom column selection)

- the bespoke `tierHasFlag(tier, 'exports.column_selection')` decision —
  **removed**
- the legacy `COLUMN_SELECTION_REQUIRES_GROWTH` denial code — **removed**
- all 4 custom-column call sites now use
  `enforceCapability(req, res, 'exports.column_selection')` — the SAME
  `resolveCapabilityDecision` / `sendCapabilityDenied` primitives
  `requireCapability` uses (see next section); a denial now returns the
  normalized `COMMERCIAL_ACCESS_DENIED` body, not a bespoke code

**Retained, deliberately out of scope:** `resolvedTier` /
`tierDataWindowSince()` (export data-window clamping, §17/§18) are a
**separate, non-commercial-authority concern** — they bound how much
historical data a tier's export can query, not whether the export/column
capability is allowed at all. P0-A3-1 does not touch them.

#### 6. Shared backend authority — `require-entitlement.middleware.ts`

P0-A3-1 introduces no new shared primitive; it is the second consumer (after
P0-A2A's route migration) of the ONE `resolveCapabilityDecision` /
`sendCapabilityDenied` pair `requireCapability` already used:

```
requireCapability(capabilityId)   → resolveCapabilityDecision(req, capabilityId) → resolveTier(req) → req.user.tier
enforceCapability(req, res, capabilityId) → resolveCapabilityDecision(req, capabilityId) → resolveTier(req) → req.user.tier
```

Both share: the same `CAPABILITY_REQUIREMENTS` / `evaluateAccess` evaluation,
the same request/JWT tier resolution (no DB round-trip), the same normalized
`COMMERCIAL_ACCESS_DENIED` response body, and the same `paywall_hit`
analytics semantics. No DB tier fetch was added by this slice. Persisted
bespoke backend grant loading (`shop_module_entitlements` consulted by
`requireCapability`/`enforceCapability`) remains outside this slice — see
§32 "### P0-A2A" "Bespoke-grant limitation" — that is later P0-A3 scope.

#### New regression contracts

- `tests/contract/export-commercial-access.contract.test.ts` — registry owns
  `exports.core`; `ExportDrawer`/`ShopSettingsReportsPage` consume
  `report.capabilityId` through the canonical adapter (not the literal
  `exports.core` string — the registry, not the consumer, owns that
  literal); `ColumnPicker` consumes `exports.column_selection`; backend
  routes use `requireCapability('exports.core')`; the controller uses the
  canonical `exports.column_selection` authority
- `tests/unit/ui/commercial-access/export-commercial-access.test.tsx` —
  behavioral proof the canonical decision wins over any legacy
  tier-assumption a regression might reintroduce

#### Maintenance corrections completed alongside P0-A3-1

1. `commercial-access-policy.contract.test.ts` (B16/B17) — updated:
   `exportReports.ts` moved from the P0-A3 residual set into the migrated
   set (`MIGRATED_FRONTEND_TIER_RANK_OWNERS`, explicitly asserted to own no
   private `TIER_ORDER`); `usePlanEntitlement.ts` is now asserted as the
   EXACT sole remaining deferred P0-A3 residual.
2. `commercial-backend-enforcement.contract.test.ts` (A2A-C18) — corrected
   from a stale literal-textual requirement (`resolveTier(req)` had to
   appear inside `requireCapability` itself) to protect the real delegation
   invariant: `requireCapability` → `resolveCapabilityDecision(req, ...)` →
   `resolveTier(req)`/`req.user.tier`, with no DB subscription-tier lookup
   in either function's own source slice.

#### P0-A3-1 verification evidence (durable)

- combined targeted commercial contract set (`commercial-access-policy` +
  `commercial-route-enforcement` + `commercial-backend-enforcement` +
  `commercial-policy-engine` + `commercial-policy-ownership` +
  `entitlementDenial` + `export-commercial-access`) — **277 / 277 GREEN**
- targeted frontend commercial suite (`export-commercial-access` +
  `commercial-context` + `commercial-gate` + `upgrade-prompt-decision`) —
  **46 / 46 GREEN**
- backend integration,
  `tests/integration/entitlements/representative-route-commercial-gate.test.ts`
  — **18 / 18 GREEN**, real Express app + disposable PostgreSQL, cleanup
  proven
- `apps/backend` `tsc --noEmit` — **19 baseline errors (pre-existing,
  unrelated), 0 target-file errors**
- static: `exports.core` executable route gates = 5;
  `exports.column_selection` controller gates = 4; legacy export
  commercial-authority references (`tierHasFlag`/`isTierSufficient`/
  `COLUMN_SELECTION_REQUIRES_GROWTH` on the export surfaces) = 0
- frontend private `TIER_ORDER`: `usePlanEntitlement.ts` only
- disposable test-DB leftovers: 0
- `git diff --check`: PASS
- 23 ambient `modules/ui-ft2/dist/**/*.d.ts` files unchanged by this slice
  (pre-existing worktree modification count held steady at 23 across every
  verification pass; `git diff --stat` scoped to the directory: 23 files
  changed, 23/23 insertions/deletions, matching the pre-existing state)
- no migration, no persistent-DB mutation, no package/lockfile change

#### Still OPEN after P0-A3-1 (remaining P0-A3 scope)

- Overview Live Map, Returns, Inventory/Products, and the remaining WMS
  commercial surfaces not yet migrated
  > **Partially superseded 2026-09-05 by P0-A3-2** (see "### P0-A3-2"):
  > **Overview Live Map is migrated** — frontend and the single backend route
  > `GET /api/v1/wms/live-activity`. Returns, Inventory/Products and every
  > other WMS commercial surface remain unmigrated and still belong to this
  > bullet.
  >
  > **Further superseded 2026-09-05 by P0-A3-3** (see "### P0-A3-3"):
  > **Returns is migrated** — all 12 `returns.routes.ts` routes, nav, sub-tabs,
  > the route subtree, and premium acquisition. Inventory/Products and the
  > remaining WMS commercial surfaces still belong to this bullet.
- active `usePlanEntitlement` consumers outside the export surfaces, and the
  final private-`TIER_ORDER` cleanup (`usePlanEntitlement.ts` itself)
- bespoke persisted-grant backend enforcement (see §32 "### P0-A2A"
  "Bespoke-grant limitation")
- the remaining unmigrated backend route families (`/recount*`,
  `/sender-addresses*`)
- paused/deprecated commercial-surface retirement, scoped separately
- full system-wide C14–C24 coverage

**P0-A3-1 is CLOSED / VERIFIED. The remainder of P0-A3 is NOT closed by this
slice.**

### P0-A3-2 — Overview Live Map commercial-access convergence (CLOSED / VERIFIED / DEPLOYED 2026-09-05 at `8e72888136011fc0298499b32664257f2bdf064e`)

**P0-A3-2 is the second bounded slice of P0-A3.** It converges the Overview
Live Map surface — frontend authority *and* the one backend route that serves
it — onto the same `@lasyncro/commercial-policy` engine P0-A1/A2A/A2B/A3-1
already shipped. It does **not** close P0-A3; the umbrella stays OPEN.

#### Ratified product state

All tiers share the **same Overview information architecture**:

    Pulse + Decisions to make
    Live Map slot

| Tier | Pulse + Decisions | Live Map slot | Premium data fetched |
| --- | --- | --- | --- |
| Starter / Core | full experience, unchanged | synthetic premium teaser | **none** — no floor geometry, no live activity |
| Growth / Scale | full experience, unchanged | the real live operational map | real floor geometry + live activity |

Locked rules:

- The Live Map **slot** exists for every tier; only its contents differ. There
  is no separate "Core layout" and "Growth layout".
- The teaser is built from static sample geometry and is unmistakably
  preview/upgrade UX. It is **never** blurred, degraded, or partially masked
  real merchant data.
- A denied tenant does not *fetch* premium data at all — hiding a rendered
  surface is not a commercial gate.
- **Scale inherits Growth.** There is deliberately no Growth-vs-Scale
  distinction for this capability.

#### Canonical policy

    overview.live_map
      moduleId:    overview
      minimumTier: growth

Declared once in `@lasyncro/commercial-policy`; frontend and backend both read
it and nothing else.

#### 1. `OverviewFT2Page.tsx` — frontend authority

| | Before | After |
| --- | --- | --- |
| Commercial authority | private expression `entitlementsResolved && (tier === 'scale' \|\| tier === 'growth')` | `useCommercialAccess()` → `liveMapDecision = decide('overview.live_map')` |
| Access boolean | `hasMapTier` (legacy name) | `hasMapAccess = isResolved && liveMapDecision.allowed` |
| Resolution signal | `hasResolved` read separately from `EntitlementsContext` | `isResolved` from the adapter — the canonical signal, itself backed by `EntitlementsContext.hasResolved` internally |
| Teaser required tier | hardcoded `requiredTier: 'growth'` | derived from `liveMapDecision.requiredTier`, neutral wording when absent |
| Floor geometry | `useFloorPlanning()` fetched **regardless of entitlement** | `useFloorPlanning(hasMapAccess)` |

The **same** canonical boolean now gates every live-map consumer:
`useFloorPlanning`, `useWarehouseGridOccupancy`, `useIdleAlerts`,
`useProblemCenter` map enrichment, `useWmsLiveActivity`, the operational-map
warning state (`operationalMapEnabled` / `operationalWarningsUnresolved`), the
synthetic apron stations, the Location Pulse payloads, and the real-map vs
teaser render branch.

No raw Growth/Scale eligibility is reconstructed anywhere on the page.
`useEntitlements()` remains imported **only** for the unrelated
`displayCurrency`. Because the decision (not a tier compare) is the authority,
a persisted bespoke grant can allow the capability below Growth with no page
change — subject to the backend bespoke-grant limitation in §32 "### P0-A2A".

`OV-ENTRY-001` is preserved by the `isResolved &&` conjunct: access is false
until the commercial snapshot resolves, so a Growth tenant never flashes the
triage layout while entitlements are in flight.

#### 2. `useFloorPlanning.ts` — acquisition seam

`export function useFloorPlanning()` → `export function useFloorPlanning(enabled = true)`,
with `enabled` forwarded into the React Query options and nothing else touched:
query key `['floor-planning','layout']`, endpoint
`/api/v1/floor-planning/layout`, 9s timeout, `staleTime` 60s, `retry: 1`,
`retryDelay`, `placeholderData`, and the returned
`{ data, isLoading, isError, refetch }` shape are all unchanged. The default
`true` keeps every existing argument-less caller (`FloorPlanningPage`) on its
previous behaviour; Overview is the only caller passing the gate.

This is a **testability/commercial seam, not test-only behaviour** — production
defaults are unchanged and no environment bypass was added.

#### 3. `wms.routes.ts` — backend parity

`GET /api/v1/wms/live-activity`:

    Before:  authenticateToken → requireFt2 → requireAction('wms:read') → httpGetLiveActivity
    After:   authenticateToken → requireFt2 → requireCapability('overview.live_map')
                               → requireAction('wms:read') → httpGetLiveActivity

The route previously had **no commercial gate at all** — the frontend hid the
map while the endpoint would still serve live floor activity to any Starter or
Core caller holding `wms:read`. Commercial entitlement and RBAC remain two
separate, both-required checks in that order; `requireAction('wms:read')` is
preserved verbatim and the controller is unchanged. Denials use the existing
`COMMERCIAL_ACCESS_DENIED` contract (§32 "### P0-A2A" §5). **No other WMS route
is migrated by this slice.**

#### New regression contracts

Added:

- `tests/contract/overview-live-map-commercial-access.contract.test.ts`
- `tests/unit/ui/commercial-access/overview-live-map-commercial-access.test.tsx`

Extended:

- `tests/integration/entitlements/representative-route-commercial-gate.test.ts`

Permanent behaviour now protected:

- the canonical decision **wins over a contradictory legacy tier** in both
  directions (the frontend suite deliberately constructs tier↔decision
  disagreement; it asserts authority, never a claim about what any tier should
  actually be granted)
- Starter/Core denial renders the teaser **and disables the real acquisitions**
- Growth/Scale allowance renders the live map **and enables them**
- Pulse + "Decisions to make" survive a commercial denial (continuity control)
- teaser `requiredTier` derives from the `AccessDecision`
- floor geometry and live activity read the **same** canonical gate — the
  contract locates that gate by the call site it governs, not by variable name,
  so the legacy `hasMapTier` identifier is no longer frozen into any assertion
- backend `/live-activity` requires `overview.live_map`, and
  `requireAction('wms:read')` is not weakened (green control)
- Starter/Core receive a real-route commercial 403; Growth/Scale clear the gate

#### RED evidence (durable)

Initial slice RED: **13 intentional RED failures** converged to GREEN, with
**4 initial GREEN controls** holding throughout.

Correction-pass RED (the implementation-correction round that added the
acquisition gate): contract **2 failed / 6 passed**, frontend **4 failed /
2 passed**, against pre-correction production source. Those failures
specifically exposed (a) unconditional floor-planning acquisition on a denied
tenant and (b) redundant resolution authority read from `EntitlementsContext`
rather than the canonical adapter. Both are closed above.

#### P0-A3-2 verification evidence (durable)

- commercial contract regression — **8 suites PASS, 285 / 285 GREEN**
- frontend commercial regression — **6 suites PASS, 52 / 52 GREEN**
- backend real-route integration,
  `tests/integration/entitlements/representative-route-commercial-gate.test.ts`
  — **1 suite PASS, 22 / 22 GREEN**, real Express app + disposable PostgreSQL
- static authority checks — **PASS**
- frontend `tsc --noEmit` — **19 pre-existing baseline errors, 0 A3-2
  target-file errors**
- disposable test-DB leftovers — **0**
- `git diff --check` — **PASS**
- no migration, no persistent-DB mutation, no package/lockfile change, no
  generated `dist` regenerated

Non-doc scope of the slice, exactly six paths:

1. `apps/backend/src/api/wms/wms.routes.ts`
2. `apps/frontend/src/pages/floor-planning/useFloorPlanning.ts`
3. `apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx`
4. `tests/contract/overview-live-map-commercial-access.contract.test.ts`
5. `tests/integration/entitlements/representative-route-commercial-gate.test.ts`
6. `tests/unit/ui/commercial-access/overview-live-map-commercial-access.test.tsx`

#### Known pre-existing baseline — NOT an A3-2 regression

`tests/unit/ui/overview/OverviewFT2Page.refresh-boundary.test.tsx` cannot
resolve `analytics/useUiEvents`. This was reproduced against the pristine
slice anchor `ae59ae90` and is **pre-existing**. It is not caused by P0-A3-2
and was deliberately not repaired here.

#### Deliberately not touched by P0-A3-2

- the other WMS commercial routes
- recount commercial architecture, `/sender-addresses*`
- persisted bespoke-grant backend enforcement
- Returns, Inventory/Products
- paused/deprecated commercial surfaces
- `BILL-ENTITLEMENT-01` Fact B, P0-B commercial-transition architecture,
  P0-C broader coverage

#### Deployment certification (2026-09-05)

Production SHA: **`8e72888136011fc0298499b32664257f2bdf064e`**

Independent deployment evidence confirmed for that exact SHA:

| Check | Result |
| --- | --- |
| CI — UI modules | PASS |
| CI / RLS Security Boundary | PASS |
| Fly Deploy | PASS |
| Vercel `lasyncro-web` | PASS |
| Vercel marketing | PASS |

The RED evidence and the pre-deployment verification evidence recorded above
are the historical record of how this slice was proven **before** it shipped.
They are unchanged; this note certifies that it then shipped.

**P0-A3-2 Overview Live Map commercial-access convergence — CLOSED / VERIFIED /
DEPLOYED on 2026-09-05 at `8e72888136011fc0298499b32664257f2bdf064e`. The P0-A3
umbrella remains OPEN — the remaining P0-A3 slices listed in the §32 status
header and under "#### Still OPEN after P0-A3-1" are not closed by this slice.**

### P0-A3-3 — Returns commercial-access convergence (implementation + automated verify COMPLETE / PASS; commit/push/CI/deploy PENDING)

**P0-A3-3 is the third bounded slice of P0-A3.** It converges the Returns
surface — capability registry, all 12 backend routes, navigation, sub-tabs, the
route subtree, and premium data acquisition — onto the same
`@lasyncro/commercial-policy` engine P0-A1/A2A/A2B/A3-1/A3-2 already shipped. It
does **not** close P0-A3; the umbrella stays OPEN.

#### Ratified capability ladder

Returns is governed by **three** canonical capabilities, not one:

| CapabilityId | policy | owns |
|---|---|---|
| `returns.intake` | Starter+ · module **`wms`** · `minimumTier: 'starter'` | physical return receiving/intake workflow |
| `returns.core` | Core+ · module `returns` · `minimumTier: 'core'` | Returns control/resolution workflow — Overview, Items, settings, decisions |
| `returns.analysis` | Growth+ · module `returns` · feature `returns.analysis` | supplier/batch return analytics |

> **`returns.intake` deliberately belongs to the `wms` module, NOT to `returns`.**
> This is the load-bearing decision of the slice, not an inconsistency. Physical
> return receiving is warehouse **execution**, and Starter already holds `wms`.
> Binding intake to the `returns` module would have been unsatisfiable at Starter
> (`returns` is a Core+ grant — `modules.ts` `STANDARD_CORE`), and granting
> `returns` at Starter would have leaked the whole Returns management module to a
> tier that must not have it. Keeping intake on `wms` lets a Starter merchant
> physically receive/process a returned order through warehouse operations while
> the Returns management module stays Core+.

#### Standard-plan matrix

| | Starter | Core | Growth | Scale |
|---|---|---|---|---|
| `returns.intake` | ALLOW | ALLOW | ALLOW | ALLOW |
| `returns.core` | DENY | ALLOW | ALLOW | ALLOW |
| `returns.analysis` | DENY | DENY | ALLOW | ALLOW |

Product reading of that matrix:

- **Starter** — physical return intake/processing through WMS. **No** Returns
  management module or pages.
- **Core** — intake, plus Returns Overview, Items, and the resolution/control
  workflows.
- **Growth** — everything in Core, plus supplier/correlation analytical Returns.
- **Scale** — all Returns capabilities (inherits Growth).

#### Commercial principle — no separate return-processing charge at launch

Handling a return for an order the merchant has **already processed** does not
introduce a normal second billable "processed order" charge. The launch
monetization principle is unchanged: monetize operational volume and capability
depth, with merchant-facing usage centred on order ingestion, order processing
and seats. Returns activity may be metered internally for analytics/operations,
but at launch it does **not** become a separate return-processing overage. No
pricing amount and no new billing behaviour is introduced by this slice.

#### 1. Backend route authority — `apps/backend/src/api/returns/returns.routes.ts`

All **12** active Returns routes now use canonical `requireCapability()`. Raw
`requireTier` authority is removed from this route file entirely — the import is
gone.

`returns.intake` — Starter+ (6 routes)

    GET   /jobs
    POST  /jobs
    GET   /jobs/:id
    POST  /jobs/:id/lines
    PATCH /jobs/:id/lines/:lineId
    POST  /jobs/:id/complete

`returns.core` — Core+ (5 routes)

    GET   /
    GET   /settings
    PATCH /settings
    GET   /items
    PATCH /items/:id/decision

`returns.analysis` — Growth+ (1 route)

    GET   /correlation

**Commercial capability access and role/action authorization are separate axes,
and capability checks do NOT replace `requireAction`.** Every route keeps its own
`requireAction('returns:*')` exactly as before, ordered after the commercial gate:

    authenticateToken → requireFt2 → requireCapability(...) → requireAction(...) → handler

`requireCapability` answers "is this tenant entitled to the capability";
`requireAction` answers "is this user permitted the action". Neither weakens the
other; the controllers are unchanged.

#### 2. Frontend surface authority

Canonical navigation and sub-tab mapping — `navBootstrap.ts` and
`returnsSubTabs.tsx` both declare `capabilityId`, with no raw `requiredTier`:

| Surface | capabilityId |
|---|---|
| Returns parent (nav) | `returns.core` |
| Overview | `returns.core` |
| Items | `returns.core` |
| Supplier Ratings | `returns.analysis` |

**Direct-route authority.** `ReturnsFT2Page` wraps the Returns management subtree
in `<CommercialGate capabilityId="returns.core">`, so `/returns`,
`/returns/items` and `/returns/suppliers` entered by URL resolve the **same**
AccessDecision as the nav/tab click. Nav presentation is not a security boundary:
before this slice the page mounted `ModuleTabBar` + `<Routes>` with no gate at
all, so a direct URL bypassed the commercial decision entirely and the child
pages began acquiring protected data on mount. `returns.intake` is deliberately
**not** gated here — it stays reachable through the WMS flow.

**Legacy Returns commercial authority retired** (Returns surfaces only):

- no `PlanGate feature="returns.analysis"` in `ReturnsOverviewPage`
- no `PlanGate feature="returns.analysis"` in `ReturnsSuppliersPage`
- no raw `requiredTier` in the Returns nav item or in `returnsSubTabs.tsx`
- no `requireTier` in `returns.routes.ts`
- no page-private duplicate correlation hook in `ReturnsSuppliersPage`

> This is **Returns-specific retirement only.** `PlanGate` and
> `usePlanEntitlement` remain in legitimate use by other, unmigrated modules
> (8 frontend files still reference `PlanGate`). Do **not** read this as a claim
> that the legacy commercial primitives are globally removed — later P0-A3 slices
> own the rest.

#### 3. Premium acquisition seam

`useReturnsCorrelation()` → `useReturnsCorrelation(enabled = true)`, with
`enabled` forwarded into the React Query configuration. The query key, endpoint
(`/api/v1/modules/returns/correlation`), refetch interval, placeholder behaviour
and response shape are unchanged, and any caller omitting the argument keeps its
previous behaviour.

`ReturnsOverviewPage` and `ReturnsSuppliersPage` both derive access from the
canonical decision:

```ts
const { decide, isResolved } = useCommercialAccess();
const analysisDecision = decide('returns.analysis');
const hasAnalysisAccess = isResolved && analysisDecision.allowed;
useReturnsCorrelation(hasAnalysisAccess);
```

Denied **or unresolved** analysis access does not acquire the premium
correlation data at all; allowed canonical access enables acquisition. The
canonical decision wins over legacy tier inference in both directions. Core
Returns content stays visible to Core users — a `returns.analysis` denial never
blanks the page a Core merchant paid for. **Premium data is not fetched and then
blurred.**

`ReturnsSuppliersPage` previously declared its own private copy of the
correlation hook, which shadowed the shared one; that duplicate is deleted and
the page now consumes the shared hook, so the `enabled` seam actually reaches it.

#### P0-A3-3 verification evidence (durable)

Focused suites:

- `tests/contract/returns-commercial-access.contract.test.ts` — **90 / 90 GREEN**
- `tests/unit/ui/commercial-access/returns-commercial-access.test.tsx` — **18 / 18 GREEN**
- `tests/integration/entitlements/representative-route-commercial-gate.test.ts` — **35 / 35 GREEN**

Integration database: disposable test DB created, runtime verification passed,
DB dropped, with independent global cleanup proof **ORPHAN_COUNT=0**. The
development database was not used or mutated by the integration run.

Commercial regression:

- contract regression — **334 / 334 GREEN**
- frontend commercial regression — **70 / 70 GREEN**, across seven suites run in
  isolated Jest processes: `nav-surface-parity` 25/25,
  `export-commercial-access` 5/5, `overview-live-map-commercial-access` 6/6,
  `commercial-context` 7/7, `commercial-gate` 3/3,
  `upgrade-prompt-decision` 6/6, `returns-commercial-access` 18/18.

> **Verification honesty note — read this before quoting the frontend number.** A
> single *combined* Jest invocation of those seven suites produced **68 / 70**,
> not 70/70. `commercial-gate.test.tsx` bound the real
> `EntitlementsContext`-backed `useCommercialAccess` after cross-suite mock
> contamination; the same file passes **3 / 3 standalone**. This was classified as
> a **test-process isolation artifact, not a Returns product regression**. The
> 70/70 figure is the SUM OF ISOLATED RUNS — no single command printed 70/70, and
> claiming one did would be false.

TypeScript:

- backend — **0 errors**
- frontend — **19 total pre-existing baseline, 0 target errors**
- test project — **1 total pre-existing baseline**
  (`tests/integration/auth/register-no-auth-side-effects.test.ts(39,4): TS1005`),
  **0 target errors**

Static / safety at certification:

- the exact Returns capability mapping verified — intake 6 / core 5 / analysis 1
- no raw `requireTier` remains in `returns.routes.ts`
- the direct-route Returns `CommercialGate` verified present
- the generated `commercial-policy` dist includes `returns.intake`
- `git diff --check` PASS
- staged paths **0**
- changed tracked implementation/test/generated-artifact paths before DOC: **13**

#### Generated package surface

`packages/commercial-policy` is a **built** package whose committed `dist` is part
of its package surface, so P0-A3-3 necessarily includes generated changes to
`packages/commercial-policy/dist/capabilities.d.ts` and
`packages/commercial-policy/dist/capabilities.js` alongside the `src` change.

> *Local verification environment only — not a product fact, and not shipped
> files:* the A3-3 worktree initially inherited `node_modules` resolution from
> sibling worktrees, so TypeScript first consumed a **stale** commercial-policy
> declaration through a sibling `backend-core` dependency. That was an
> environment resolution artifact, **not** a production-source defect.
> Verification was corrected locally with ignored worktree-only dependency
> shadows so `backend-core` and `commercial-policy` resolved to the A3-3
> worktree; after correct resolution, `BACKEND_TSC_ERROR_COUNT=0`.

#### Status

**P0-A3-3 Returns commercial-access convergence — IMPLEMENTATION + AUTOMATED
VERIFY: COMPLETE / PASS. The commercial Returns implementation is now DEPLOYED.
PRODUCTION CERTIFICATION: BLOCKED / PENDING.** The paragraph below was written at
the pre-commit A3-3 state (anchor `58210ed4a064c1f4c393993ffea598175e1ebc00`) and
is kept as the record of that moment.

> **Updated 2026-09-05 — certification blocked by `RETURNS-SCHEMA-DRIFT-01`.**
> The commercial convergence itself shipped, but production certification of the
> Returns surface was blocked by a SEPARATE, pre-existing production schema drift
> on `refund_execution_line_items` — five line-level decision columns missing in
> prod because historical migration `0008` was amended after prod had already
> applied it. `listItemsAwaitingDecision()` cannot execute against that shape, so
> the Returns items surface is down in production regardless of commercial
> access. This is a SCHEMA defect, not a commercial-access defect: it changes no
> tier, capability, route classification or gating decision recorded in this
> section.
>
> A forward repair migration
> (`20260828120000_0165_repair_refund_execution_line_item_decision_columns`,
> marker `RETURNS-SCHEMA-DRIFT-01`) was implemented and verified — 11/11 targeted
> and 21/21 combined integration PASS, disposable DB
> created → migrated → runtime OK → dropped with `ORPHAN_COUNT=0`.
>
> **Updated 2026-09-06.** `0165` has since shipped: its backend production repair
> and certification stand, and the five decision columns are present in
> production. Certification is nonetheless still **BLOCKED / PENDING**, now on a
> SECOND drift on the same table.
>
> **`RETURNS-SCHEMA-DRIFT-02`** — same `0008`-amended-after-prod root cause,
> different columns: production had `lasyncro_refund_execution_id` and
> `refunded_amount` as NOT NULL (canonical: nullable), `created_at` nullable with
> no default (canonical: NOT NULL DEFAULT now()), and `source` **absent**
> (canonical: `varchar(50) NOT NULL DEFAULT 'refund_webhook'`). This is the
> scan-intake shape, so `createManualReturnLine()` cannot insert at all against
> it. It surfaced when `seed_returns_test_data.sql` failed on the missing `source`
> column; that seed transaction aborted and its `COMMIT` resolved to `ROLLBACK`,
> so **no seed data persisted and production was not mutated**.
>
> Its forward repair
> (`20260906120000_0166_repair_refund_execution_line_item_scan_intake_columns`,
> marker `RETURNS-SCHEMA-DRIFT-02`) was implemented and verified — the combined
> targeted Returns suite is 3 suites / 31 tests / 0 failures, disposable DB
> created → migrated → runtime OK → dropped, `ORPHAN_COUNT=0`.
>
> Neither drift changes any tier, capability, route classification or gating
> decision recorded in this section — both are SCHEMA defects, not
> commercial-access defects.
>
> **PRODUCTION CERTIFIED 2026-09-06 — this blocker is CLEARED.** `0166` shipped
> in commit `ecaef445eced63b4044ac23bc455765332ad0661` and applied in production
> (`knex_migrations` id **165**, batch **40**, migration_time
> **2026-09-06 10:48:13.527+00**). The production shape is certified canonical on
> all four properties, with 5 indexes, 3 FKs, RLS enabled + forced and the tenant
> policy (cmd ALL) all preserved. The reviewer seed then succeeded and persisted
> (`seed_refunds` = 9, seeded lines = 9, 2 browser-verification fixtures;
> `RETURNS_PROD_REVIEWER_SEED=PASS`), and the authenticated Returns triad —
> Overview, Items, Supplier Ratings — was visually certified against it with no
> NaN, undefined or broken layout.
>
> `RETURNS-SCHEMA-DRIFT-02` — PRODUCTION BACKEND CERTIFICATION **CLOSED / PASS**,
> REVIEWER SEED **CLOSED / PASS**, RETURNS VISUAL FUNCTIONAL CERTIFICATION
> **CLOSED / PASS**. `RETURNS-SCHEMA-DRIFT-01`'s backend certification remains
> valid and its visual blocker is **CLEARED**.
>
> **P0-A3-3 — the Returns slice is FULLY CLOSED / PRODUCTION-CERTIFIED.** The
> commercial-access convergence and the schema it depends on are both live and
> certified in production.
>
> The last outstanding item, **`RETURNS-OVERVIEW-UI-01`** — a cosmetic stray
> literal `...` in the Returns Pulse card — **shipped 2026-09-06** at commit
> `15ba7a1168f4bcac0789a3e5e3f17f68260df77f` (*fix(returns): remove pulse
> placeholder*), deployed via lasyncro-web SUCCESS and Fly Deploy #1385 SUCCESS,
> and was production re-checked at <https://app.lasyncro.com/returns>: the
> literal is gone, the surrounding recovery summary and PulseStat rows are
> intact, and no regression was introduced. See `ReturnsResolutionModule.md` §14.
>
> Nothing in the Returns schema/capability slice remains pending.
>
> Full record: `docs/blueprints/ReturnsResolutionModule.md` §12, §13 and §14, and
> `docs/playbooks/migration_drift_playbook.md` (2026-09-05 and 2026-09-06 entries).
**The P0-A3 umbrella remains OPEN** — Inventory/Products, the remaining WMS
commercial surfaces, `/recount*`, `/sender-addresses*`, bespoke persisted-grant
backend enforcement, the `usePlanEntitlement.ts` `TIER_ORDER` residual, and
system-wide C14–C24 closure are not closed by this slice.

### Non-goals / open P0 work (not addressed by P0-A0, P0-A1, or the P0-A architecture)

- **`BILL-ENTITLEMENT-01` Fact B** — the Shopify Reviewer shop was seeded/expected **Growth** but production `/entitlements/me` reports **Scale**; the DB `shop_subscriptions.tier` transition cause is unresolved. P0-A1 answers *"given a commercial state, what access should it produce?"* — it does **not** answer *"why did production acquire the wrong commercial state?"*. Belongs to Commercial State Integrity (**P0-B**).
- Provider SKU/price mapping, subscription transition ordering/idempotency, any `shop_subscriptions` writer, webhook idempotency/order, commercial-state audit trail, billing reconciliation, and JWT / current-state freshness (see §13.2 / §26 / SHB-14) — **all P0-B, out of scope**.
- **Sourcing production certification remains blocked** until the commercial-access P0 (A1 + A2) is resolved.

---

## 33. Commercial Remodel Alignment — `COMMERCIAL-REMODEL-ALIGN-01` (ratified + implemented 2026-09-06)

**This section is the CURRENT canonical commercial truth.** Where §32 and earlier
sections disagree, they are the historical record and this supersedes them. §32's
architecture — one policy package, capability-based access, `evaluateAccess()` —
is unchanged; what changed is *what is sold at which tier*, and the lifecycle
vocabulary for surfaces that are no longer sold.

Tier order is unchanged: `starter < core < growth < scale`.

### 33.1 Ratified tier matrix

**STARTER**
- Overview · Orders · Alerts inbox · Shopify integration + internal plumbing
- `warehouse.operations`, return intake, barcode/internal WMS plumbing
- the **full Receive → Stow → Pick → Pack → Ship** WMS execution loop
- **NO Purchasing**
- **0** included non-owner seats
- **50** fulfilled / WMS-completed orders included — **hard stop** after the allowance
- **60-day** order history

**CORE adds**
- Inventory / Products · Returns management · Problem Center
- Purchasing core: Purchase Orders, Suppliers, basic supplier workflows
- standard exports
- **2** included non-owner seats; purchased extra seats are **additive**
- **500** fulfilled orders included; **configurable overage**
- **180-day** history

**GROWTH adds**
- Demand Forecasting · Warehouse Analytics · Floor Planning
- Returns supplier analysis · Alert Rules · advanced/custom export columns
- **Advanced Sourcing**
- **5** included non-owner seats; purchased extra seats are **additive**
- **2500** fulfilled orders included; **configurable overage**
- **unlimited** history

**SCALE**
- inherits every **ACTIVE** Growth capability — no Scale-only module wall
- unlimited seats · unlimited fulfilled orders · unlimited history
- **no overage** (nothing finite left to exceed)

### 33.2 Product lifecycle — paused is not deprecated

| Area | Status | Meaning |
|---|---|---|
| Finances | **PAUSED** | withdrawn from sale, **may return in a future release** |
| Customers | **DEPRECATED** | not expected to return |
| Specter | **DEPRECATED** | not expected to return |

The distinction is load-bearing: it decides whether cleanup should ever be
scheduled. **Finances must never be described as permanently deprecated.**

`CapabilityStatus` is now `active | paused | deprecated | legacy | disabled`
(`legacy` kept as a compatibility alias). Paused and deprecated entries carry **no
`AccessRequirement`**, are absent from `ACTIVE_CAPABILITY_IDS`, and are **not
standard tier grants at any tier**. Physical code for all three areas is
deliberately retained — deletion is a separate, regression-protected future
program, not part of this slice.

### 33.3 Purchasing

- `suppliers-portal` is a **Core+** canonical standard module (moved from Starter)
- `purchasing.core` = **Core+** — Purchase Orders, Suppliers, basic supplier workflows
- `purchasing.sourcing` = **Growth+** — **Advanced Sourcing**: sourcing
  recommendations, sourcing worklist, supplier-product preference intelligence,
  and reorder/MOQ accumulation intelligence

> **Superseded 2026-09-07 by `P0-A3-5` (§35).** `COMMERCIAL-REMODEL-ALIGN-01`
> established the canonical Purchasing policy; the dedicated follow-up has now
> implemented backend route enforcement, navigation/tab parity, direct-URL gating,
> and Core-vs-Growth frontend data isolation.

### 33.4 Order meter — two different numbers

- `ingested_orders` is **internal telemetry ONLY**. Shopify ingestion must **never**
  be commercially blocked: dropping order truth at a plan limit creates an
  unrecoverable operational-history gap while the webhook still reports success.
- **fulfilled / WMS-completed orders** are the merchant-facing commercial
  allowance and the enforcement meter: Starter hard stop, Core/Growth configurable
  overage, Scale unlimited.

Never describe `ingested_orders` as the merchant-facing hard cap.

### 33.5 Seats

`0 / 2 / 5 / Infinity` are **INCLUDED non-owner seats**, not hard maximums.
Effective capacity on a finite paid tier = **included seats + purchased extra
seats**; Scale is unlimited. No Starter extra-seat SKU or price is invented here.

### 33.6 What the implementation changed

- `finances`, `customers`, `specter` removed from standard tier grants at **every** tier
- Specter removed from active capability and active feature truth
  (`specter.full_capture` retired; `features.ts` now holds five canonical keys)
- catalog lifecycle vocabulary extended with `paused` and `deprecated`
- `suppliers-portal` moved Starter → Core
- `purchasing.core` now Core+; `purchasing.sourcing` added at Growth+
- `grantFt2FreeBaselineForShop` reduced to **`order-nexus` only**. It previously
  granted `products` (a Core+ paid surface), `customers` (deprecated) and
  `finances` (paused); because `getForUser` unions persisted grants **additively**,
  that dormant function could resurrect paid or withdrawn surfaces regardless of
  tier. The function is retained, idempotent and additive as before.
- **`LEGACY_MODULES_BY_TIER` deliberately remains frozen compatibility data** and
  was not touched.

### 33.7 Verification evidence

- remodel contract suite — **38 / 38 PASS**
- `commercial-policy-engine` — **144 / 144 PASS**
- `commercial-access-policy` — **53 / 53 PASS**
- the three named suites together — **234 / 234 PASS**
- relevant regression run **before** environment correction — **554 / 557**, where
  the only 3 failures were frontend build-environment dependency resolution, not
  commercial-model defects
- an isolated `npm ci` corrected workspace resolution; `frontend-production-build-env`
  then passed **4 / 4**
- `commercial-policy` TSC **0** · backend TSC **0**
- `git diff --check` PASS
- all **20** intended REDs became GREEN; all **11** superseded pre-remodel
  assertions corrected (fixtures rewritten, never weakened)
- generated `packages/commercial-policy/dist` rebuilt **only** through the
  package's declared build script

One correction worth carrying forward: the engine suite's matrix helper passed a
possibly-absent requirement straight into `evaluateAccess()`, and
`evaluateAccess(undefined, ctx)` returns **ALLOWED** by design. Retiring a
capability therefore made its DENY rows silently pass. A fail-loud
`requirementOrFail()` guard now sits in front of every dynamic capability lookup.
**Any future capability retirement must keep that guard**, or the matrix goes
vacuous instead of red.

### 33.8 Known follow-ups and coverage gaps

- **C6** — included seats + `extra_seats` has no dedicated DB/Stripe regression
  contract; the canonical included values are covered, the additive purchased-seat
  behaviour is not
- Advanced Sourcing is protected as **one** capability, not per sub-feature
- 60 / 180 / unlimited **history windows** have no canonical commercial-policy field
- Purchasing runtime / frontend / direct-URL enforcement — **CLOSED by `P0-A3-5` (§35)**
- **`BILL-ENTITLEMENT-01` Fact B remains P0-B Commercial State Integrity.** This
  slice changed no subscription-transition causality and does not explain why
  reviewer production became Scale.
- Node 20.19.5 vs required 20.20.0+, and dependency audit findings, are separate
  environment/dependency debt — deliberately out of scope here.

### 33.9 Explicitly NOT done

Purchasing runtime/API/frontend gating was not part of `COMMERCIAL-REMODEL-ALIGN-01`
itself and was subsequently **CLOSED by `P0-A3-5` (§35)** · no Customers, Specter
or Finances physical deletion · no Decision/Command commercial capability · no
pricing change · no seat-billing change · no history-window architecture · no
migrations.

---

## 34. Inventory / Products Commercial Access — `P0-A3-4` (ratified + implemented 2026-09-06)

The Inventory/Products slice of P0-A3. Canonical policy needed no change — the
capability was already correct — so this is a **wiring** slice: it moves every
Inventory surface off raw module/tier gates and private controller checks onto the
one shared AccessDecision.

### 34.1 Canonical capability and tier behaviour

    inventory.core = moduleId 'products' + minimumTier 'core'

| Tier | Inventory |
|---|---|
| Starter | **DENY** |
| Core | ALLOW |
| Growth | ALLOW |
| Scale | ALLOW |

**An additive module grant does not bypass the tier wall.** A Starter shop holding
a bespoke/persisted `products` module row is still denied `inventory.core`, with
reason `TIER_TOO_LOW` — because the requirement carries `minimumTier: 'core'` and
tier is evaluated before module membership. This is precisely what the previous
raw `requiredModuleId: 'products'` nav gate got wrong: a module row satisfied it.

### 34.2 Merchant UI — one gate for the whole subtree

`/inventory`, `/inventory/catalog`, `/inventory/costs` and
`/inventory/data-quality` all resolve through a single
`<CommercialGate capabilityId="inventory.core">` on the Inventory subtree page.
`LifecycleRouteHost` mounts that component at `/inventory/*`, so a **direct URL**
resolves the same AccessDecision as a nav or tab click. Nav presentation is not a
security boundary.

### 34.3 Navigation — ownership, not duplication

- the Inventory **parent** owns `capabilityId: 'inventory.core'`
- the standard children — Intelligence, Catalog, Costs, Data Quality — declare no
  capability of their own and **inherit** the parent boundary
- **Demand** stays independently `demand.forecasting`: it is not URL-nested under
  `/inventory` and is Growth-only, so it must not inherit a Core boundary
- raw `requiredModuleId: 'products'` is **no longer commercial authority** for Inventory

Inheritance is a real mechanism, not an assumption: `resolveNavVisibility` only
decides `if (capabilityId && context)`, and `ModuleTabBar` computes
`tab.capabilityId ? decide(tab.capabilityId) : null`. A child carrying no
capability therefore contributes no gate of its own. Re-declaring
`inventory.core` on every child would be duplication that drifts the moment the
parent's capability changes.

### 34.4 Products APIs

`requireCapability('inventory.core')` now gates:

    GET   /ft2
    GET   /operator-summary
    GET   /catalog
    GET   /variants/costs
    PATCH /variants/:variantId/cost
    POST  /variants/costs/bulk

**Legacy alias parity.** Both `/api/v1/products/...` and
`/api/v1/modules/products/...` remain mounted, and both now resolve the **same**
canonical commercial policy — otherwise a caller could simply pick the cheaper
door. Alias removal is future cleanup, not this slice.

### 34.5 WMS readiness exception

`GET /wms-readiness` belongs to **`warehouse.operations`**, not `inventory.core`,
and is now positively gated on it (it previously carried no commercial gate at
all). Starter WMS access remains valid.

> **Not a contradiction, and not to be "fixed":** `/inventory/data-quality` is an
> Inventory UI route behind `inventory.core` (Core+), while the WMS-readiness API
> it consumes is `warehouse.operations` (Starter+). A Core+ shop holds both, so
> the pairing is consistent by design. Aligning them would break the Starter WMS
> exception.

### 34.6 Inventory recount

The recount route family is commercially owned by `inventory.core`. **13 recount
routes** were migrated from a raw `requireTier('core')` gate to
`requireCapability('inventory.core')`:

    POST/GET /recount-tasks · GET /recount-tasks/preview
    GET  /recount-tasks/:taskId/lines · GET/POST /recount-tasks/:taskId/findings
    POST /recount-tasks/:taskId/claim · /reassign · /close · /commit
    POST /recount-tasks/:taskId/lines/:lineId/count · /skip · /review

**Commercial capability and RBAC are separate, both-required axes.** Every
`requireAction('wms:recount:*')` check is unchanged, as is `requireFt2`.
`requireCapability` answers *"is this tenant entitled"*; `requireAction` answers
*"is this user permitted"*. Four unrelated `requireTier('core')` gates in the same
file — one `wms:read`, three `wms:batch:release` — were deliberately left alone.

### 34.7 Controller cleanup

`products.operator.controller.ts` no longer makes a private commercial decision.
Its `meetsTier`-based check and non-canonical `TIER_INSUFFICIENT` body are retired;
canonical route middleware is authoritative and denial is the shared
`COMMERCIAL_ACCESS_DENIED` contract. The controller still resolves `tier`, but
**only** as business logic for the history window — never as an access decision.

### 34.8 Stale frontend links

`missing_cogs` alert actions now route to **`/inventory/costs`** (label "Costs")
instead of the retired `/products`, consistently in both `TopnavbarContent.tsx`
and `AlertsPage.tsx`.

### 34.9 Verification evidence

- new contract `tests/contract/commercial-inventory-products-access.contract.test.ts`
  — **41 / 41 PASS**
- existing runtime contract `tests/integration/entitlement-mounts.test.ts`
  — **5 / 5 PASS**: Starter both aliases → 403, malformed-query Starter alias →
  403, Core both aliases → 200. Preserved unweakened; the denial now originates
  from the canonical middleware rather than the retired controller check.
- targeted frontend parity `tests/unit/ui/commercial-access/nav-surface-parity.test.tsx`
  — **5 / 5 targeted PASS** (20 unrelated tests skipped for bounded execution)
- backend TSC **0 errors**
- frontend TSC **19 errors, TARGET_ERROR_COUNT = 0** — pre-existing baseline,
  count unchanged by this slice; the clean anchor reproduces the same 19
- `git diff --check` PASS · legacy Inventory guards clean
- integration DB created → migrated → dropped, no orphan test DB

### 34.10 Carry-forward

- **Superseded 2026-09-07 by `P0-A3-5` (§35): Purchasing runtime/frontend
  parity is now closed.** The deferred Purchasing failures carried by this
  section were consumed by that dedicated slice.
- Legacy `/api/v1/products/...` aliases remain mounted; removal is future cleanup.
- No canonical policy matrix change, no migration, no DB schema change.

---

## 35. Purchasing / Sourcing Commercial Access — `P0-A3-5` (ratified + implemented 2026-09-07)

This slice closes the runtime/frontend coverage gap deliberately left by
`COMMERCIAL-REMODEL-ALIGN-01`. The canonical policy did not change; every
Purchasing surface now consumes that policy consistently.

### 35.1 Canonical commercial split

| Capability | Starter | Core | Growth | Scale |
|---|---|---|---|---|
| `purchasing.core` | DENY | ALLOW | ALLOW | ALLOW |
| `purchasing.sourcing` | DENY | DENY | ALLOW | ALLOW |

Both capabilities belong to module `suppliers-portal`, but their tier floors differ:

- `purchasing.core` = **Core+** — Purchase Orders, Suppliers and basic Purchasing workflows
- `purchasing.sourcing` = **Growth+** — sourcing worklist, sourcing recommendations,
  supplier-product preferences and reorder/MOQ accumulation intelligence

An additive `suppliers-portal` module grant does not bypass either minimum-tier wall.

### 35.2 Backend route ownership

`apps/backend/src/api/suppliers/suppliers.routes.ts` now has **29**
commercially gated routes:

- **18 basic Purchasing routes** remain `purchasing.core`
- **11 advanced Sourcing routes** use `purchasing.sourcing`

The 11 advanced routes are:

    GET    /sourcing-worklist
    GET    /sourcing-recommendations/never-ordered
    GET    /sourcing-recommendations/:variantId
    GET    /preferences
    POST   /preferences
    PATCH  /preferences/:id
    DELETE /preferences/:id
    POST   /reorder-requests/convert
    GET    /reorder-requests
    POST   /reorder-requests
    DELETE /reorder-requests/:id

`requireFt2`, `requireAction`, handlers and middleware ordering remain unchanged.
Commercial eligibility and RBAC remain separate decisions.

### 35.3 Navigation and tabs

The Purchasing parent, Open POs and Suppliers resolve through `purchasing.core`.

Sourcing independently resolves through `purchasing.sourcing` in both
`navBootstrap.ts` and `purchasingSubTabs.ts`.

Therefore:

- Starter sees no Purchasing surface
- Core sees Open POs and Suppliers but not Sourcing
- Growth and Scale see basic Purchasing plus Advanced Sourcing

No raw `requiredTier` or `requiredModuleId` is commercial authority for these
migrated Purchasing surfaces.

### 35.4 Direct-route protection

`/suppliers-portal/*` keeps its outer:

    CommercialGate capabilityId="purchasing.core"

`/suppliers-portal/sourcing` additionally has:

    CommercialGate capabilityId="purchasing.sourcing"

The Growth gate wraps the Sourcing route element before it mounts. Core direct
navigation therefore follows the canonical denial path and cannot mount or fetch
the protected Sourcing surface.

### 35.5 Core-shell data isolation

The shared `useSuppliersPortal` hook now fetches only Core-owned data:

- Purchase Orders
- Suppliers

The eager `/sourcing-recommendations/never-ordered` request was removed from the
shared hook entirely.

A Sourcing-only route component owns that query and mounts only behind
`purchasing.sourcing`. Endpoint, query key, response mapping and refresh
behaviour remain unchanged.

The current `SuppliersPortalData` type still requires `never_ordered` and
`never_ordered_count` on every view. Core views receive empty placeholders
(`[]` / `0`); real Growth-only values are supplied only by the Sourcing route.
Making those fields optional is separate module-surface cleanup.

### 35.6 Runtime proof

Verified runtime boundary:

- Starter → `purchasing.core`: DENY / `TIER_TOO_LOW`
- Core → `purchasing.core`: ALLOW
- Core → `purchasing.sourcing`: DENY / `TIER_TOO_LOW`
- Growth → `purchasing.sourcing`: commercial gate clears
- Scale clears both capabilities

The Sourcing domain suite now uses a coherent Growth subscription and Growth JWT.

### 35.7 Verification evidence

- full contract project — **38 / 38 suites, 624 / 624 tests PASS**
- targeted Purchasing frontend — **2 / 2 suites, 43 / 43 tests PASS**
- Purchasing/Sourcing backend integration — **2 / 2 suites, 71 / 71 tests PASS**
- `requireCapability` unit contract — **40 / 40 PASS**
- backend TypeScript — **0 errors**
- frontend TypeScript — **19 pre-existing project errors, 0 P0-A3-5 target errors**
- disposable integration DBs created → migrated → dropped; no orphan test DB
- no migration, schema, canonical-policy, pricing or billing-state change

One earlier `warehouse.floor_planning @ scale` run hit the Jest 5-second timeout.
Its isolated rerun passed, followed by the complete **40 / 40** suite. It is
classified as an unrelated transient timeout.

### 35.8 Unrelated baseline debt observed

The broader frontend commercial-access regression remains non-green for four
pre-existing failures outside this slice:

- two stale `commercial-context.test.ts` expectations for deprecated
  `customers` / `specter.full_capture`
- two `commercial-gate.test.tsx` harness cases missing the required
  `EntitlementsProvider`

Their files and direct runtime stack were unchanged from the slice anchor.
All Purchasing/Sourcing frontend contracts are green.

### 35.9 Closure

`P0-A3-5` closes the Purchasing runtime/frontend/direct-URL commercial-access gap.

The active truth is:

    Starter -> no Purchasing
    Core    -> Purchase Orders + Suppliers + basic Purchasing
    Growth  -> Core Purchasing + Advanced Sourcing
    Scale   -> all active Growth Purchasing/Sourcing capability

`BILL-ENTITLEMENT-01` Fact B remains separate P0-B Commercial State Integrity
work and is unchanged by this slice.

---

## 36. Sourcing Growth Teaser / Paywall UX — `PUR-COMM-UX-01` (implemented + automated verified 2026-09-07)

`P0-A3-5` closed the commercial-access boundary between Core Purchasing and
Growth Sourcing. Live browser certification then exposed a presentation defect:
the access decision was correct, but the Sourcing denial used a generic locked
card with non-FT2 styling and generic "full intelligence suite" copy.

`PUR-COMM-UX-01` changes presentation only. It does not change the canonical
commercial policy, backend enforcement, entitlement resolution, tier matrix,
RBAC, or Sourcing data-acquisition boundary.

### Ratified UX contract

For a Core merchant:

- Purchasing remains available.
- Open POs remains available.
- Suppliers remains available.
- Sourcing remains visible as an upgrade-discovery surface with its Growth badge.
- Clicking the locked Sourcing tab does not navigate. It opens the canonical
  commercial upgrade modal.
- The modal identifies `Sourcing`, preserves the canonical
  `purchasing.sourcing` access decision, and shows the exact required tier
  supplied by that decision.
- The Sourcing modal communicates:
  - Prioritize sourcing work from current inventory demand
  - Compare supplier recommendations by product
  - Use supplier-product preferences
  - Accumulate reorder quantities against MOQ
- Direct navigation to `/suppliers-portal/sourcing` remains a hard commercial
  gate. A denied merchant never mounts `SourcingRoute` and therefore never
  issues Growth-only Sourcing requests.
- The direct-route denial identifies `Sourcing` and uses:
  `Turn inventory demand into supplier recommendations, purchasing priorities,
  and smarter reorder decisions.`
- The locked route uses the FT2 `var(--surface)` token.
- Growth and Scale continue to navigate to and mount Sourcing normally.

### Implementation

Production files changed:

1. `apps/frontend/src/components/ModuleTabBar.tsx`
   - supports optional upgrade benefits per tab
   - preserves the canonical `AccessDecision`
   - forwards benefits to the upgrade modal
   - locked tabs do not navigate

2. `apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts`
   - keeps `purchasing.sourcing`
   - adds the four Sourcing-specific Growth benefits

3. `apps/frontend/src/components/CommercialGate.tsx`
   - adds optional `featureBlurb`
   - forwards it to `UpgradePrompt`
   - access and mounting semantics remain unchanged

4. `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx`
   - supplies `featureName="Sourcing"` and the Sourcing-specific blurb
   - keeps `SourcingRoute` physically inside the commercial gate

5. `apps/frontend/src/components/UpgradePrompt.tsx`
   - locked state uses `var(--surface)`
   - modal preserves supplied feature capitalization (`Unlock Sourcing`)
   - pricing, CTA, analytics and decision semantics remain unchanged

### Regression contracts

Added:

- `tests/unit/ui/commercial-access/purchasing-sourcing-tab-upgrade-ux.test.tsx`
- `tests/unit/ui/commercial-access/purchasing-sourcing-direct-gate-ux.test.ts`

Existing `purchasing-core-shell-sourcing-fetch.test.tsx` continues to protect
against eager Growth-only Sourcing acquisition from the Core Purchasing shell.

### Verification evidence

Targeted frontend regression:

- 6 suites PASS
- 57 / 57 tests GREEN

Frontend TypeScript:

- 19 pre-existing baseline errors
- 0 errors in the five `PUR-COMM-UX-01` production files

Broader commercial-access regression:

- 10 suites total
- 8 suites PASS
- 89 / 93 tests GREEN
- 4 failures are pre-existing baseline failures:
  - 2 stale `commercial-context.test.ts` expectations for deprecated
    `customers` / `specter.full_capture` truth
  - 2 `commercial-gate.test.tsx` harness failures from missing
    `EntitlementsProvider`
- all `PUR-COMM-UX-01` tests remain GREEN

Static:

- `git diff --check` PASS
- no backend changes
- no commercial-policy changes
- no DB/migration changes
- no package/lockfile changes
- no generated artifacts intentionally changed

### Sidenav / ModuleTabBar upgrade-presentation parity follow-up — 2026-09-07

Production certification exposed a second presentation defect: the locked
Sourcing entry in `ModuleTabBar` showed the approved feature-specific benefits,
while the same `purchasing.sourcing` denial opened from `SidenavContent` used
the generic upgrade presentation.

The correction keeps commercial access authority unchanged. Canonical
`AccessDecision` still determines denial reason and required tier. Merchant-facing
presentation metadata is now frontend-owned and resolved by `CapabilityId`.

Implementation:

- added `apps/frontend/src/commercial/capabilityPresentation.ts`
- `purchasing.sourcing` now has one canonical frontend presentation definition:
  - feature name `Sourcing`
  - Prioritize sourcing work from current inventory demand
  - Compare supplier recommendations by product
  - Use supplier-product preferences
  - Accumulate reorder quantities against MOQ
- `ModuleTabBar` resolves that shared presentation metadata
- `SidenavContent` resolves the same metadata before opening `UpgradePrompt`
- `purchasingSubTabs.ts` no longer owns duplicated Sourcing benefit copy
- capabilities without presentation metadata retain the generic upgrade prompt
- no commercial-policy, backend, entitlement, tier, billing, route, DB, migration,
  package, or lockfile behaviour changed

Regression evidence:

- RED first: Sidenav `benefits` was `undefined` for locked Sourcing
- targeted regression: 4 suites PASS, 8 / 8 tests GREEN
- frontend TypeScript: 19 pre-existing baseline errors, 0 target-file errors
- broader commercial-access regression: 12 suites total, 10 PASS;
  92 / 96 tests GREEN
- the 4 broader failures are the previously established baseline:
  - 2 commercial-context additive entitlement expectations
  - 2 CommercialGate test-harness failures
- one broader run regenerated 23 `modules/ui-ft2/dist/**` declaration artifacts;
  all were restored and excluded from this slice
- final targeted rerun: 4 suites PASS, 8 / 8 tests GREEN
- `git diff --check` PASS
- generated-artifact scope clean

Production browser certification of Sourcing parity remains pending after
commit, push, CI, and deploy.

### Certification state

`PUR-COMM-UX-01` is **IMPLEMENTED / AUTOMATED VERIFIED**.

Final browser certification of the revised modal and direct-route locked state
remains pending after commit/deploy.

### COMM-TEASER-BENEFITS-02 — standardized Growth teaser benefits — 2026-09-07

**Problem**

The shared frontend commercial-presentation registry existed, but only
`purchasing.sourcing` had feature-specific benefit copy. Other Growth-gated
module teasers therefore fell back to generic upgrade messaging, and direct
`CommercialGate` routes did not consume the shared presentation registry.

**Scope**

Standardized the five module-level Growth teaser capabilities:

- `demand.forecasting` → **Demand**
- `warehouse.floor_planning` → **Floor Planning**
- `warehouse.analytics` → **Warehouse Analytics**
- `returns.analysis` → **Supplier Ratings**
- `purchasing.sourcing` → **Sourcing**

`overview.live_map`, `exports.column_selection`, and legacy `alerts.rules`
remain outside this slice because they use different in-page/component or
legacy gating surfaces.

**Implementation**

- Expanded `apps/frontend/src/commercial/capabilityPresentation.ts` with the
  approved feature-specific benefits for Demand, Floor Planning, Warehouse
  Analytics, and Supplier Ratings.
- Preserved the existing Sourcing definition unchanged.
- `CommercialGate` now resolves presentation metadata from the same frontend
  registry used by Sidenav and ModuleTabBar.
- Explicit contextual names remain authoritative:
  - matching explicit feature name → registry benefits may be inherited;
  - differing explicit feature name → explicit context is preserved and
    registry benefits are not inherited.
- This prevents `returns.analysis` Supplier Ratings benefits from leaking into
  the separate `Returns Analysis` context.
- Canonical `AccessDecision`, tier policy, billing, pricing, entitlements,
  navigation structure, backend, DB, and UpgradePrompt visual design were not
  changed.

**Regression contracts**

- exact canonical presentation definitions for all five capabilities;
- approved benefit strings have one production owner:
  `apps/frontend/src/commercial/capabilityPresentation.ts`;
- denied Demand direct gate inherits registry name + benefits while preserving
  the canonical `AccessDecision`;
- explicit Supplier Ratings inherits registry benefits;
- explicit Returns Analysis does not inherit Supplier Ratings benefits;
- Sidenav Warehouse Analytics receives its approved rich presentation;
- a capability without presentation metadata (`warehouse.problem_center`)
  still falls back to its generic title with no stale benefits after another
  rich teaser was opened;
- existing Sourcing Sidenav / ModuleTab / direct-gate contracts remain intact.

**Evidence**

- RED before implementation: 2 targeted suites, 4 failed / 4 passed.
- First GREEN: 2 targeted suites, 8 / 8 tests passed.
- Broader regression initially exposed one stale pre-change Warehouse Analytics
  assertion; production behavior was correct and the regression contract was
  updated to the newly approved presentation while preserving a separate
  generic-fallback test.
- Final targeted commercial regression:
  **5 suites passed, 16 / 16 tests passed**.
- Frontend TypeScript baseline:
  **19 existing errors total, 0 errors in touched target files/tests**.
- `git diff --check`: pass.
- No migration, DB fixture, worker, API, provider, or generated-artifact changes.
- Live browser certification remains required after deployment.
