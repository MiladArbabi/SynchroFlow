You can’t enforce plans, pricing, and limits if “who gets what” lives in 17 places. This spec makes the Entitlements Engine the **single authority** on what each shop is allowed to do, per module, per plan, right now.

Below is the **LaSyncro Entitlements Engine Contract – v1 (Locked & Sealed)**.

---

# 🔒 0. Scope & Non-Negotiables

This blueprint **locks**:

1. **Entitlements data model** (what we return to UIs and modules)
2. **Inputs:** Core (ModuleRegistration), Billing (subscriptions), Pricing JSON, Usage counters
3. **Entitlements API** (internal HTTP + library)
4. **Limit semantics** (how quotas work)
5. **Feature IDs & limit IDs conventions**
6. **DB schema for usage counters**

Any change to types or behavior marked **LOCKED** requires `entitlements-contract v2` + migration plan.

Entitlements is **read-only** from the outside:
it computes answers; it doesn’t mutate Core or Billing.

---

# 1. Purpose & Responsibility

### 1.1 Mission

> Given a `shopId`, Entitlements v1 computes a **deterministic, cached** view of:
>
> * Which modules are available
> * Which plan each module is on
> * Which features are enabled/disabled
> * Which limits apply and whether they are exceeded

It is the **only** place that knows:

* “Can this shop do X right now?”
* “What plan/limit is blocking this action?”

### 1.2 Owns vs Does Not Own

**Entitlements OWNS:**

* Entitlement calculation logic
* Feature + limit registry (IDs, semantics)
* Usage counters schema & aggregation
* Cached entitlements snapshots

**Entitlements DOES NOT OWN:**

* Shop / user / module records → Core
* Subscriptions, plan billing state → Billing
* Pricing numbers (stored as config but **owned** by Pricing/RevOps)
* Business events / usage emission → Modules

---

# 2. Inputs – What Entitlements Depends On

## 2.1 From Core – Shop & Module Registration (LOCKED)

From Master Data:

```ts
// Core API: GET /api/core/v1/shops/:shopId/modules
export interface ModuleRegistration {
  shopId: ShopId;
  moduleKey: ModuleKey;
  status: 'locked' | 'installed' | 'active' | 'suspended';
  planId: PlanId;              // 'FREE' | 'PRO' | ... | 'NONE'
  billingSource: BillingSource;// 'shopify' | 'direct'
  external: {
    shopifyAppInstallationId?: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

Entitlements treats `ModuleRegistration` as **structural** truth:

* If `status='locked'` → module is not usable, regardless of Billing.
* If `status='active'` + planId=FREE → module is usable within FREE limits.

## 2.2 From Billing – Subscriptions (LOCKED)

From Billing snapshot:

```ts
// Billing API: GET /api/billing/v1/shops/:shopId/snapshot
export interface BillingSnapshotForShop {
  shopId: ShopId;
  subscriptions: ModuleSubscription[];
}
```

We already locked `ModuleSubscription` earlier.

Entitlements uses:

* `planId`
* `status` (`trialing`, `active`, `past_due`, `canceled`, etc.)
* `billingSource`
* `trialEndsAt`, `currentPeriodEnd`

## 2.3 From Pricing Config – Plan Limits & Flags (LOCKED)

We define a **central config document**:

```ts
// entitlements-config/v1/module-plans.json (logical shape)

export interface ModulePlanLimits {
  [moduleKey: string]: {
    [planId in PlanId]?: {
      features: {
        [featureId: string]: boolean; // enabled/disabled
      };
      limits: {
        [limitKey: string]: number | null; // null = unlimited
      };
    };
  };
}
```

Examples of `featureId` and `limitKey` are fully namespaced strings:

* Feature IDs: `"returnNexus.autoApproval"`, `"skuOs.reorderPlaybooks"`.
* Limit keys: `"returnNexus.maxReturnsPerMonth"`, `"wmsLite.maxPicksPerMonth"`.

This JSON is **owned by Pricing/RevOps**, but its structure is locked here.

## 2.4 From Usage – Counters & Periods (LOCKED)

Entitlements needs to know “how much has been used” to compare against limits.

Logical interface:

```ts
export type UsagePeriod = 'month' | 'day' | 'lifetime';

export interface UsageCounterKey {
  shopId: ShopId;
  moduleKey: ModuleKey;
  limitKey: string;        // must match config limits keys
  period: UsagePeriod;     // e.g. 'month'
  periodStart: string;     // ISO, e.g. first day of month UTC
}

export interface UsageCounter {
  key: UsageCounterKey;
  value: number;           // usage count
  updatedAt: string;       // ISO
}
```

A separate **Usage Service** (lightweight) aggregates events (orders processed, returns, picks, etc.) and maintains these counters.

Entitlements calls:

```http
GET /api/usage/v1/shops/:shopId/counters
  ?moduleKey=<optional>
Authorization: Bearer <internal>
```

Response:

```ts
export interface UsageSnapshotForShop {
  shopId: ShopId;
  counters: UsageCounter[];
}
```

---

# 3. Entitlement Data Model (Output)

This is what all UIs and backend feature gates must use.

```ts
export type PlanRuntimeStatus =
  | 'none'         // no active subscription, planId='NONE'
  | 'free'
  | 'trial'
  | 'paid_active'
  | 'paid_past_due'
  | 'canceled';

export interface LimitStatus {
  limitKey: string;          // same as config
  value: number | null;      // allowed; null = unlimited
  used: number;              // from UsageCounter or 0
  period: UsagePeriod;       // e.g. 'month'
  periodStart: string;       // ISO
  isExceeded: boolean;       // used >= value AND value != null
}

export interface ModuleEntitlement {
  moduleKey: ModuleKey;

  // From Core + Billing + Pricing
  planId: PlanId;
  planRuntimeStatus: PlanRuntimeStatus;
  status: ModuleStatus;         // from ModuleRegistration.status

  // Whether feature-level gating should treat module as usable at all
  moduleAvailable: boolean;     // derived; see rules

  features: {
    [featureId: string]: boolean; // computed on top of plan + runtime
  };

  limits: {
    [limitKey: string]: LimitStatus;
  };

  // Optional human-readable flags for UI
  meta: {
    billingSource: BillingSource;
    trialEndsAt?: string;
    currentPeriodEnd?: string;
    lockReason?: string;         // e.g. 'billing_unpaid', 'module_locked'
  };
}

export interface ShopEntitlements {
  shopId: ShopId;
  modules: ModuleEntitlement[];
}
```

**This is the locked structure** the frontend and backend feature gates must consume. No module is allowed to invent its own entitlement format.

---

# 4. Entitlements Engine – Derivation Rules

## 4.1 PlanRuntimeStatus Derivation (LOCKED)

Given:

* `moduleReg: ModuleRegistration | null`
* `subscription: ModuleSubscription | null`

Compute:

```ts
function derivePlanRuntimeStatus(
  moduleReg: ModuleRegistration | null,
  subscription: ModuleSubscription | null
): PlanRuntimeStatus {
  if (!moduleReg || moduleReg.planId === 'NONE') return 'none';

  if (!subscription) {
    // Free module with no subscription row
    if (moduleReg.planId === 'FREE') return 'free';
    // paid plan without subscription = inconsistent → treat as canceled
    return 'canceled';
  }

  const { planId, status } = subscription;

  if (planId === 'FREE') return 'free';

  switch (status) {
    case 'trialing':
      return 'trial';
    case 'active':
      return 'paid_active';
    case 'past_due':
    case 'unpaid':
      return 'paid_past_due';
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'canceled';
  }
}
```

> Any change to this mapping = **v2**.

## 4.2 Module Availability

```ts
function deriveModuleAvailable(
  moduleReg: ModuleRegistration | null,
  planRuntimeStatus: PlanRuntimeStatus
): { available: boolean; lockReason?: string } {
  if (!moduleReg) {
    return { available: false, lockReason: 'module_not_registered' };
  }

  if (moduleReg.status === 'locked' || moduleReg.planId === 'NONE') {
    return { available: false, lockReason: 'module_locked' };
  }

  if (moduleReg.status === 'suspended') {
    return { available: false, lockReason: 'module_suspended' };
  }

  // For now, allow paid_past_due but let individual features/limits use it to add friction.
  if (planRuntimeStatus === 'canceled') {
    // If core kept planId FREE, you won't get here with paid plan; but if misaligned, be strict.
    return { available: moduleReg.planId === 'FREE', lockReason: 'billing_canceled' };
  }

  return { available: true };
}
```

**Semantics:**

* If `moduleReg.status='active'` + planId != 'NONE' → generally available.
* `paid_past_due` doesn’t hard-lock module; it is signaled to UI via meta.

---

# 5. Features & Limits Evaluation

## 5.1 Feature Flags

Given:

* `configPlan = config[moduleKey][planId]` (or fallback to FREE if missing)
* `planRuntimeStatus`
* `moduleAvailable`

We compute:

```ts
function computeFeatures(
  moduleKey: ModuleKey,
  planId: PlanId,
  planRuntimeStatus: PlanRuntimeStatus,
  moduleAvailable: boolean,
  planConfig: { features: Record<string, boolean> } | null
): Record<string, boolean> {
  const result: Record<string, boolean> = {};

  if (!planConfig) return result;

  for (const [featureId, enabled] of Object.entries(planConfig.features)) {
    // baseline: plan says yes/no
    let value = enabled;

    // hard overrides:
    if (!moduleAvailable) {
      value = false;
    } else if (planRuntimeStatus === 'canceled') {
      value = false;
    }

    // In v1, trial & past_due behave same as active here; any stricter
    // behavior must be implemented as limit gating or higher-level UX.

    result[featureId] = value;
  }

  return result;
}
```

**Rule:**
Entitlements itself does not add “bonus features” beyond config; it can only **turn OFF** features due to module/billing constraints.

## 5.2 Limits & Usage

### 5.2.1 Limit Keys (LOCKED Convention)

* All limit keys are **namespaced**:
  `"returnNexus.maxReturnsPerMonth"`,
  `"skuOs.maxActiveProducts"`,
  `"wmsLite.maxPicksPerMonth"`.

* Limit keys in config must match those used by modules + Usage Service.

### 5.2.2 DB Schema for Usage Counters

In a dedicated `usage` schema:

```sql
CREATE TABLE usage_module_counters (
  shop_id UUID NOT NULL,
  module_key TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  period TEXT NOT NULL,         -- 'month' | 'day' | 'lifetime'
  period_start DATE NOT NULL,   -- e.g. first day of month (UTC)
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, module_key, limit_key, period, period_start)
);

CREATE INDEX idx_usage_counters_shop_module
  ON usage_module_counters (shop_id, module_key);
```

Modules emit usage increments to Usage Service (out of scope here), which maintains this table.

### 5.2.3 Limit Evaluation

Given:

* `planLimitValue = configPlan.limits[limitKey]` (number | null)
* `usageCounter.value` for current period (or 0 if missing)

We compute:

```ts
function computeLimitStatus(
  moduleKey: ModuleKey,
  limitKey: string,
  planLimitValue: number | null,
  usageCounter: UsageCounter | null
): LimitStatus {
  const used = usageCounter?.value ?? 0;
  const period = usageCounter?.key.period ?? 'month';
  const periodStart = usageCounter?.key.periodStart ?? currentPeriodStart(period);

  const isExceeded =
    planLimitValue !== null ? used >= planLimitValue : false;

  return {
    limitKey,
    value: planLimitValue,
    used,
    period,
    periodStart,
    isExceeded
  };
}
```

**Rules:**

* If `value === null` → unlimited, `isExceeded=false`.
* If no usageCounter present → `used=0`.

Entitlements does **not** decide what happens when `isExceeded=true`; it only reports. Enforcement is done via:

* Backend checks (hard block).
* Frontend `LimitBanner` UX (from the previous UX spec).

---

# 6. Entitlements Service – Public APIs

## 6.1 HTTP API (Backend & Frontend)

### 6.1.1 Get Shop Entitlements

```http
GET /api/entitlements/v1/shops/:shopId
Authorization: Bearer <JWT>
```

**Response:**

```ts
export interface GetShopEntitlementsResponse {
  entitlements: ShopEntitlements;
}
```

Internally, Entitlements will:

1. Fetch `ModuleRegistrations` from Core.
2. Fetch `BillingSnapshotForShop` from Billing.
3. Fetch `UsageSnapshotForShop` from Usage.
4. Apply pricing config (`ModulePlanLimits`).
5. Compute `ShopEntitlements`.

### 6.1.2 Get Module Entitlement Only

```http
GET /api/entitlements/v1/shops/:shopId/modules/:moduleKey
Authorization: Bearer <JWT>
```

Response:

```ts
export interface GetModuleEntitlementResponse {
  entitlement: ModuleEntitlement | null;
}
```

Used by individual module backends for quick gating.

---

## 6.2 Library API (For In-Process Use)

In languages where Entitlements runs as a shared service:

```ts
export interface EntitlementsService {
  getShopEntitlements(shopId: ShopId): Promise<ShopEntitlements>;
  getModuleEntitlement(shopId: ShopId, moduleKey: ModuleKey): Promise<ModuleEntitlement | null>;
  checkFeatureAllowed(input: {
    shopId: ShopId;
    moduleKey: ModuleKey;
    featureId: string;
  }): Promise<FeatureCheckResult>;
  checkLimitAllowed(input: {
    shopId: ShopId;
    moduleKey: ModuleKey;
    limitKey: string;
    amount?: number; // default 1
  }): Promise<LimitCheckResult>;
}

export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;              // 'module_locked' | 'plan_insufficient' | 'billing_canceled'
  moduleEntitlement: ModuleEntitlement;
}

export interface LimitCheckResult {
  allowed: boolean;
  limitStatus: LimitStatus;
  reason?: string;              // 'limit_exceeded' | 'unlimited' | ...
}
```

**Locked Behavior for `checkLimitAllowed`:**

* If `limitStatus.value === null` → `allowed=true`, `reason='unlimited'`.
* Else if `limitStatus.used + amount <= value` → `allowed=true`.
* Else → `allowed=false`, `reason='limit_exceeded'`.

---

# 7. Frontend Usage – Contract with UI

Frontends must NOT roll their own plan checks. Instead they:

1. Call once at startup:
   `GET /api/entitlements/v1/shops/:shopId`.
2. Cache `ShopEntitlements` client-side.
3. Pass `ModuleEntitlement` into:

   * Sidenav renderer
   * `<FeatureGate>` component
   * `<LimitBanner>` component
   * Upgrade / quota modals

**Example in TS:**

```ts
function isFeatureEnabled(
  entitlements: ShopEntitlements,
  moduleKey: ModuleKey,
  featureId: string
): boolean {
  const mod = entitlements.modules.find((m) => m.moduleKey === moduleKey);
  if (!mod || !mod.moduleAvailable) return false;
  return !!mod.features[featureId];
}
```

---

# 8. Caching & Invalidation (v1 Rules)

Entitlements results are cacheable but must not go stale forever.

* **Default cache TTL:** 30–60 seconds.
* **Explicit invalidation triggers:**

  * Core changes `ModuleRegistration` (plan, status).
  * Billing changes subscription.
  * Usage counters cross a limit threshold (optional optimization).

Mechanism:

* Entitlements has an internal cache keyed by `shopId`.

* When Core/Billing/Usage write significant changes, they *may* hit:

  ```http
  POST /api/entitlements/v1/shops/:shopId/invalidate
  Authorization: Bearer <internal service>
  ```

* If invalidation endpoint isn’t called, TTL still protects you.

---

# 9. Observability & Metrics

At minimum, Entitlements must emit:

```ts
const ENTITLEMENTS_METRICS = {
  cache: {
    cache_hits_total: 'Counter',
    cache_misses_total: 'Counter'
  },
  checks: {
    feature_checks_total: 'Counter',  // labels: moduleKey, featureId, allowed
    limit_checks_total: 'Counter',    // labels: moduleKey, limitKey, allowed
  },
  performance: {
    entitlement_compute_latency_ms: 'Histogram'
  }
};
```

This is how you detect:

* Expensive entitlements compute paths
* Noisy modules hammering feature checks
* Features that are constantly blocked by limits (potential upsell surface)

---

# 10. Versioning & Forbidden Patterns

**Forbidden in v1:**

* Modules hardcoding plan logic (`if planId === 'PRO' then ...`) without consulting Entitlements.
* Frontends showing or hiding features purely by plan name, ignoring `moduleAvailable`, `planRuntimeStatus`, and `limits`.
* Direct reads of Billing or Core instead of going through Entitlements for feature-level decisions.
* Modules implementing their own “usage tables” not feeding into Usage Contract.

Any of these must be treated as **contract violations**.