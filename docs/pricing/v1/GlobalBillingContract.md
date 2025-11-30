You can’t sell a CNS without a billing CNS. Let’s wire it up properly.

Below is the **Global Billing Contract v1** — locked and aligned with the Master Data + Pricing contracts you already have.

Any team that “just wires billing” without following this is building something incompatible with LaSyncro.

---

# 🔒 LaSyncro Global Billing Contract – v1 (Locked)

## 0. Scope & Non-Negotiables

This document **locks**:

1. **Billing entities & states** (subscriptions, plans, charges)
2. **Module-level vs global billing model**
3. **Shopify vs Direct billing semantics**
4. **DB schema** for billing core tables
5. **Public Billing API** (internal service)
6. **Webhook contracts** (Shopify + Stripe-like provider)
7. **How billing controls ModuleRegistration + planId**

Any change to locked types, enums, or tables requires:

* `billing-contract v2` and
* A migration & rollback plan.

---

## 1. Billing Model Overview

### 1.1 What We Bill On (v1)

* **Unit of billing:**
  `Subscription` on `(shopId, moduleKey)` for a `planId`.

* **We do NOT bill:**

  * per-user seats (v1)
  * usage-based overage (v1)
  * global “suite” bundles (reserved for v2)

Every paid relationship is:

> “Shop S pays for module M on plan P (via Shopify OR Direct).”

### 1.2 Billing Source Rules (v1)

We already locked:

```ts
export type BillingSource = 'shopify' | 'direct' | 'hybrid';
```

For **v1**:

* `Shop.billingSource`:

  * `'shopify'` → all paid modules for that shop must be billed via Shopify.
  * `'direct'` → all paid modules via direct billing.
  * `'hybrid'` → **reserved**, not used in v1; any use requires v2.

* `ModuleRegistration.billingSource`:

  * Must match `Shop.billingSource` (`shopify` or `direct`) in v1.
  * `hybrid` not allowed at module level in v1.

If anybody tries to mix direct + Shopify on the same shop in v1: **reject**.

---

## 2. Core Billing Domain Types

### 2.1 Billing Plan Mapping (Between Pricing & Providers)

Logical type:

```ts
export interface BillingPlanMapping {
  moduleKey: ModuleKey;     // 'returnNexus', ...
  planId: PlanId;           // 'FREE' | 'PRO' | 'PRO_PLUS' | 'ELITE' | 'ENTERPRISE'

  billingSource: BillingSource; // 'shopify' | 'direct'

  shopify?: {
    appHandle: string;           // Shopify app name/handle for this module
    recurringPlanHandle: string; // Shopify RecurringApplicationCharge / App Subscription handle
    trialDays: number;           // 0 if none
  };

  direct?: {
    provider: 'stripe';          // v1: assume Stripe
    priceId: string;             // Stripe price_id
    trialDays: number;           // 0 if none
  };

  // Whether this plan can be self-served; ENTERPRISE often false
  selfService: boolean;
}
```

* All mappings are stored centrally (e.g. `/config/billing/v1/plan_mappings.json`).
* FREE plans may have no external billing entity (`priceId` etc).

### 2.2 Subscription State

```ts
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid';

export interface ModuleSubscription {
  subscriptionId: string;   // UUID
  shopId: ShopId;
  moduleKey: ModuleKey;
  planId: PlanId;

  billingSource: BillingSource; // 'shopify' | 'direct'

  status: SubscriptionStatus;

  startedAt: string;        // ISO
  currentPeriodStart: string; // ISO
  currentPeriodEnd: string;   // ISO

  trialEndsAt?: string;     // ISO or undefined
  canceledAt?: string;      // ISO or undefined

  // Provider-specific linkage
  external: {
    shopifySubscriptionId?: string; // if Shopify App subscription
    stripeSubscriptionId?: string;  // if Stripe
  };

  createdAt: string;
  updatedAt: string;
}
```

**Rules:**

* Every **paid** plan (`PRO`, `PRO_PLUS`, `ELITE`) must have a `ModuleSubscription`.
* FREE can either:

  * skip subscription row entirely, or
  * have an internal subscription with `planId='FREE'`, `billingSource` same as Shop, `status='active'`.
    **v1 decision:** create internal subscription for FREE as well — simplifies logic.

---

## 3. Billing DB Schema (LOCKED)

### 3.1 `billing_module_subscriptions`

```sql
CREATE TABLE billing_module_subscriptions (
  subscription_id UUID PRIMARY KEY,

  shop_id UUID NOT NULL REFERENCES core_shops(shop_id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,  -- ModuleKey
  plan_id TEXT NOT NULL,     -- PlanId

  billing_source TEXT NOT NULL CHECK (billing_source IN ('shopify', 'direct')),

  status TEXT NOT NULL CHECK (status IN (
    'trialing',
    'active',
    'past_due',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid'
  )),

  started_at TIMESTAMPTZ NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,

  trial_ends_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,

  external_shopify_subscription_id TEXT,
  external_stripe_subscription_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_billing_subscriptions_shop_module_active
  ON billing_module_subscriptions (shop_id, module_key)
  WHERE status IN ('trialing', 'active', 'past_due', 'unpaid');
```

### 3.2 `billing_events` (Audit + Debugging)

```sql
CREATE TABLE billing_events (
  id BIGSERIAL PRIMARY KEY,
  subscription_id UUID REFERENCES billing_module_subscriptions(subscription_id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES core_shops(shop_id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  source TEXT NOT NULL,              -- 'shopify_webhook' | 'stripe_webhook' | 'api' | 'system'
  type TEXT NOT NULL,                -- 'SUBSCRIPTION_CREATED', 'UPGRADED', ...
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_events_shop
  ON billing_events (shop_id, created_at);
```

**Note:**
This is separate from `core_audit_events` – this is billing-centric, potentially noisy, kept for reconciliation.

---

## 4. Billing Service Public API

All under: `/api/billing/v1/*`.
This is **internal** (called by UI or module backends), not by merchants directly.

### 4.1 Get Subscription for Module

```http
GET /api/billing/v1/shops/:shopId/modules/:moduleKey/subscription
Authorization: Bearer <JWT>
```

**Response:**

```ts
export interface GetModuleSubscriptionResponse {
  subscription: ModuleSubscription | null;
}
```

Used by UI to show current plan, trial state, etc.

---

### 4.2 Start or Upgrade Subscription (Self-Serve)

This endpoint initiates a plan change workflow (Shopify or Direct).

```http
POST /api/billing/v1/shops/:shopId/modules/:moduleKey/subscribe
Authorization: Bearer <JWT with role 'shop_owner' or 'finance_admin'>
Content-Type: application/json
```

```ts
export interface SubscribeRequest {
  targetPlanId: PlanId;          // 'FREE', 'PRO', 'PRO_PLUS', 'ELITE'
  successUrl: string;            // where to redirect after provider checkout
  cancelUrl: string;
}

export interface SubscribeResponse {
  billingSource: BillingSource;
  redirectUrl?: string;          // for hosted checkout (Shopify, Stripe)
  subscriptionPreview?: {
    currentPlanId?: PlanId;
    targetPlanId: PlanId;
    trialEndsAt?: string;
    effectiveAt: string;         // e.g. 'immediate' or next period start
  };
}
```

**Behavior (v1 rules):**

* Inspect `Shop.billingSource`.

  * If `shopify`:

    * Lookup `BillingPlanMapping` for `(moduleKey, targetPlanId, 'shopify')`.
    * Create Shopify subscription session via Shopify API.
    * Store pending state (e.g. `status='incomplete'`).
    * Return `redirectUrl` → Shopify confirmation.
  * If `direct`:

    * Lookup Stripe `priceId`.
    * Create checkout/subscription session.
    * Return `redirectUrl`.

* FREE Downgrade:

  * If `targetPlanId='FREE'`:

    * No provider checkout.
    * Immediately update internal subscription and ModuleRegistration.

---

### 4.3 Webhook Handlers (Entrypoint Spec)

These are HTTP endpoints implemented by Billing Service; the **exact paths** can vary, but contract semantics must hold.

#### 4.3.1 Shopify Webhook

```http
POST /api/billing/v1/webhooks/shopify
Content-Type: application/json
X-Shopify-Hmac-Sha256: <signature>
```

Payloads: follow Shopify’s app subscription events (not redefining them here).

**Locked Behavior:**

* On subscription **activation**:

  * Create or update `ModuleSubscription`:

    * `status = 'active'` (or `trialing` if trial).
    * Set `planId` from mapping.
    * Set `billingSource='shopify'`.
    * Update `currentPeriodStart`, `currentPeriodEnd`, `trialEndsAt`.
  * Call **Core** `/api/core/v1/shops/:shopId/modules/:moduleKey` with:

    * `status='active'`
    * `planId`
    * `billingSource='shopify'`
  * Write `billing_events` row.

* On **cancellation**:

  * Update `ModuleSubscription.status='canceled'`, `canceledAt=now`.
  * Call Core:

    * If you want to preserve data but block paid features:

      * Option 1 (recommended): set `ModuleRegistration.planId='FREE'` (if exists) and `status='active'`.
      * Option 2: `status='locked'`, `planId='NONE'`.
    * v1 decision: **downgrade to FREE where available**, else lock.

* On **billing failure** / past_due:

  * Update `status='past_due'`.
  * Optionally downgrade to FREE after grace period (implementation detail) – but **entitlements** must read this status.

#### 4.3.2 Direct (Stripe) Webhook

```http
POST /api/billing/v1/webhooks/stripe
Content-Type: application/json
Stripe-Signature: <signature>
```

**Behavior:**

* Map `customer` / `subscription` back to `(shopId, moduleKey)` via metadata.
* Mirror handling of Shopify:

  * `active` / `trialing` → update subscription + ModuleRegistration.
  * `canceled` / `unpaid` → update subscription and downgrade/lock module.

---

## 5. Relationship Between Billing & Core (ModuleRegistration)

### 5.1 Source of Truth

* **Billing Service** is source of truth for:

  * Subscription state (`planId`, `status`, periods, trial).
* **Core Service** is source of truth for:

  * Whether module is “installed / active / locked” from a *product perspective*.
  * But `planId` in `ModuleRegistration` is **mirrored** from Billing.

### 5.2 Synchronization Rules (LOCKED)

* On any subscription state change to `trialing` or `active` for `planId != 'FREE'`:

  * Billing MUST call:

    ```http
    PUT /api/core/v1/shops/:shopId/modules/:moduleKey
    Body: {
      "status": "active",
      "planId": "<planId>",
      "billingSource": "<shopify|direct>"
    }
    ```

* On downgrade to FREE:

  * Billing MUST call:

    ```http
    PUT /api/core/v1/shops/:shopId/modules/:moduleKey
    Body: {
      "status": "active",
      "planId": "FREE",
      "billingSource": "<shopify|direct>"
    }
    ```

* On cancellation without FREE fallback:

  * Billing MUST call:

    ```http
    PUT /api/core/v1/shops/:shopId/modules/:moduleKey
    Body: {
      "status": "locked",
      "planId": "NONE"
    }
    ```

* Core MUST NOT independently change `planId` for paid modules except:

  * Upgrades/downgrades initiated through Billing API (Core calls Billing, not the other way around).

---

## 6. Upgrade / Downgrade Semantics (Business Rules)

### 6.1 Upgrades

* **Within same billingSource**:

  * Shopify → Shopify, Direct → Direct.
  * Effective **immediately** (proration handled by provider).
  * Subscription status remains `active` or `trialing`.

* **From FREE → Paid**:

  * Create a new provider subscription or update existing FREE pseudo-subscription.
  * Core module becomes `status='active', planId=<paid>`.

### 6.2 Downgrades

* Paid → FREE:

  * Effective at end of current period or immediately (v1: choose **immediate** for simplicity).
  * On downgrade:

    * Subscription `planId='FREE'`, `status='active'` or a separate FREE subscription row.
    * Core module updated accordingly.
    * Entitlements will enforce feature/limit changes.

* Paid → Cheaper Paid (e.g. `ELITE` → `PRO_PLUS`):

  * v1: disallow via self-serve, require support / manual handling → `selfService=false` in `BillingPlanMapping`.
  * Or allow only if provider supports clean proration and you implement it correctly.

---

## 7. Trials & Grace Periods

### 7.1 Trials

* Trial metadata is entirely in Billing (`trialEndsAt`, `status='trialing'`).
* Entitlements engine treats `trialing` as **fully active** for that plan.
* On trial end:

  * If payment method attached / subscription continues: `status='active'`.
  * If not: either:

    * Downgrade to FREE (default v1), or
    * Set `status='incomplete_expired'` and lock module.

### 7.2 Past Due / Unpaid

* `status='past_due'`:

  * Entitlements may still allow read access but block heavy write/automation.
* `status='unpaid'`:

  * Entitlements behave like `locked` or `FREE` depending on policy.

Policy is enforced in **Entitlements** spec (next doc), but Billing must expose these states correctly.

---

## 8. Billing → Entitlements Contract (Read Model)

Entitlements Service (next spec) will need:

```ts
export interface BillingSnapshotForShop {
  shopId: ShopId;
  subscriptions: ModuleSubscription[];
}
```

* Billing must expose:

```http
GET /api/billing/v1/shops/:shopId/snapshot
Authorization: Bearer <JWT>
```

Response: `BillingSnapshotForShop`.

* Entitlements uses:

  * `{ moduleKey, planId, status, trialEndsAt, currentPeriodEnd }`
  * Combined with Pricing limits JSON to build `ModuleEntitlement`.

---

## 9. Observability & Metrics (Billing)

The Billing Service must emit at least:

```ts
const BILLING_METRICS = {
  subscriptions: {
    active_subscriptions_gauge: 'Gauge',            // by moduleKey, planId
    trialing_subscriptions_gauge: 'Gauge',
    churned_subscriptions_total: 'Counter'
  },
  revenue: {
    mrr_usd_estimate_gauge: 'Gauge',                // sum of plan MRR derived from mapping
    upgrades_total: 'Counter',
    downgrades_total: 'Counter'
  },
  integrations: {
    shopify_webhooks_received_total: 'Counter',
    shopify_webhooks_failed_total: 'Counter',
    stripe_webhooks_received_total: 'Counter',
    stripe_webhooks_failed_total: 'Counter'
  }
};
```

These are the backbone for sanity-checking MRR vs actual provider reports.

---

## 10. Versioning & Forbidden Shortcuts

**Forbidden in v1:**

* A module changing `planId` locally (must go via Billing → Core).
* Direct DB writes to `billing_module_subscriptions` from other services.
* Mixing `shopify` and `direct` for modules in the same shop.
* Creating “hidden” trial plans outside of `BillingPlanMapping`.

Any of that = **billing data corruption** and must be treated as violation.