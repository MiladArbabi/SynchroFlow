# LaSyncro Multi-App Linking – v1 Locked Blueprint

> **Mission:** Be the **single source of truth** for:
>
> * merchant identity,
> * Shopify shops & app installations,
> * module activation state,
>   across all LaSyncro Shopify apps.
>
> It guarantees that:
>
> * one brand = one LaSyncro merchant identity (even with multiple apps / shops)
> * each Shopify app unlocks exactly one module
> * all modules see a consistent `merchantId` / `shopId` / `moduleStates`.

Any change to locked types / tables / API contracts below requires:

* a versioned contract (`v2`) and
* a migration plan.

No ad-hoc edits.

---

## 0. Role & Boundaries

### 0.1 Multi-App Linking OWNS

* Merchant identity and tenant ID for LaSyncro CNS.
* Mapping:

  * Shopify shop ↔ LaSyncro `Shop`
  * Shopify app install ↔ LaSyncro `AppInstallation`
  * Shopify app ↔ LaSyncro `ModuleKey`
* Module activation flags:

  * which modules are `active` / `locked` per merchant per shop.
* OAuth + installation handshake:

  * creating/attaching merchants and shops.
* Shared webhook routing for all LaSyncro Shopify apps.

### 0.2 Multi-App Linking DOES NOT OWN

* Domain logic of modules (returns, WMS, SKU OS, etc.).
* Billing logic **inside modules** (pricing tiers, usage limits).
* Core CNS contracts:

  * OrderNexus, ReturnNexus, SKU OS, WMS-Lite, etc.
* Analytics schemas (InsightCore).
* UI decisions inside each app (only provides module state).

> **Boundary Statement:**
> Multi-App Linking decides **who this merchant is**, **which shops they have**, and **which modules are unlocked**.
> Individual modules decide **what to do** with that access.

---

## 1. Core Concepts & IDs (Locked)

### 1.1 IDs

```ts
export type MerchantId = string;        // UUID
export type ShopId = string;            // UUID (LaSyncro internal)
export type ShopifyDomain = string;     // '{name}.myshopify.com'
export type ShopifyAppKey =
  | 'lasyncro-returns'
  | 'lasyncro-inventory-health'
  | 'lasyncro-warehouse-lite'
  | 'lasyncro-quality'
  | 'lasyncro-profitability';

export type ModuleKey =
  | 'returnNexus'
  | 'skuOs'
  | 'wmsLite'
  | 'problemSolve'
  | 'orderNexus'
  | 'marginCore'
  | 'insightCore';
```

### 1.2 Module Activation State

```ts
export type ModuleActivationState = 'active' | 'locked';

export interface ModuleStates {
  returnNexus: ModuleActivationState;
  skuOs: ModuleActivationState;
  wmsLite: ModuleActivationState;
  problemSolve: ModuleActivationState;
  orderNexus: ModuleActivationState;
  marginCore: ModuleActivationState;
  insightCore: ModuleActivationState;
}
```

---

## 2. Data Model (Locked DB Schema)

### 2.1 Merchants

```sql
CREATE TABLE core_merchants (
  merchant_id UUID PRIMARY KEY,
  primary_email VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.2 Shops (Shopify Stores)

```sql
CREATE TABLE core_shops (
  shop_id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES core_merchants(merchant_id) ON DELETE CASCADE,

  shopify_domain VARCHAR(255) NOT NULL, -- unique per Shopify store
  shopify_shop_id BIGINT,               -- optional numeric id from Shopify
  currency VARCHAR(8),
  timezone VARCHAR(64),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (shopify_domain)
);
```

### 2.3 Shopify App Installations

```sql
CREATE TABLE core_shopify_app_installations (
  installation_id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES core_shops(shop_id) ON DELETE CASCADE,

  shopify_app_key VARCHAR(64) NOT NULL,  -- ShopifyAppKey
  shopify_access_token TEXT NOT NULL,
  scopes TEXT NOT NULL,                   -- comma-separated scope list
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (shop_id, shopify_app_key)
);
```

> **Rule:** Each Shopify app has its **own** access token per shop.
> The linking layer stores them centrally but does not fake “one token for all apps”.

### 2.4 Module Subscriptions

```sql
CREATE TABLE core_module_subscriptions (
  subscription_id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES core_merchants(merchant_id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES core_shops(shop_id) ON DELETE CASCADE,

  module_key VARCHAR(64) NOT NULL,     -- ModuleKey
  activation_state VARCHAR(16) NOT NULL CHECK (activation_state IN ('active','locked')),
  activation_source VARCHAR(32) NOT NULL, -- 'shopify_app' | 'direct_saas' | 'internal'
  activation_details JSONB,                -- e.g. { "shopify_app_key": "...", "plan": "pro" }

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (merchant_id, shop_id, module_key)
);
```

> **Rule:**
>
> * Installing a Shopify app sets `activation_state = 'active'` for exactly **one** `module_key`.
> * Enterprise deals via LaSyncro.com can set multiple modules to `active` via `activation_source = 'direct_saas'`.

---

## 3. Canonical Mapping: Shopify App → ModuleKey (Locked)

```ts
export const SHOPIFY_APP_TO_MODULE: Record<ShopifyAppKey, ModuleKey> = {
  'lasyncro-returns': 'returnNexus',
  'lasyncro-inventory-health': 'skuOs',
  'lasyncro-warehouse-lite': 'wmsLite',
  'lasyncro-quality': 'problemSolve',
  'lasyncro-profitability': 'marginCore' // orderNexus will be activated indirectly
};
```

**Rules:**

1. Each `ShopifyAppKey` maps to **exactly one** `ModuleKey`.
2. This mapping is **locked for v1**; changing it requires v2 & data migration.
3. No app may unlock more than one module in v1.

---

## 4. Identity Resolution & Install Flow (Locked Behavior)

### 4.1 Public Install Endpoint – Per App

Each Shopify app uses the **same backend**, with an app key param:

```http
GET /shopify/oauth/install?appKey={shopifyAppKey}&shop={shopDomain}&state={nonce}
```

#### Request Query

```ts
interface ShopifyInstallRequestQuery {
  appKey: ShopifyAppKey;
  shop: ShopifyDomain;
  state: string;
}
```

If `appKey` is unknown → `400 UnknownAppKey`.

### 4.2 OAuth Callback

```http
GET /shopify/oauth/callback?appKey={shopifyAppKey}&shop={shopDomain}&code=...&state=...
```

#### Locked Handler Flow (pseudocode)

```ts
async function oauthCallbackHandler(req, res) {
  const { appKey, shop, code, state } = req.query as {
    appKey: ShopifyAppKey;
    shop: ShopifyDomain;
    code: string;
    state: string;
  };

  // 1. Validate appKey
  const moduleKey = SHOPIFY_APP_TO_MODULE[appKey];
  if (!moduleKey) return res.status(400).send('Unknown appKey');

  // 2. Verify state + HMAC (Shopify standard security validations)
  await securityValidator.assertValidShopifyOAuth(req);

  // 3. Exchange code for access token
  const { accessToken, scopes, shopifyShopId } =
    await shopifyAuthClient.exchangeCodeForToken({ appKey, shop, code });

  // 4. Resolve or create Merchant & Shop
  const { merchantId, shopId } =
    await merchantLinkingService.resolveOrCreateMerchantAndShop({
      shopifyDomain: shop,
      shopifyShopId,
      appKey
    });

  // 5. Upsert app installation
  await appInstallationService.upsertInstallation({
    shopId,
    appKey,
    accessToken,
    scopes
  });

  // 6. Activate module for this merchant + shop
  await moduleActivationService.activateModuleForShop({
    merchantId,
    shopId,
    moduleKey,
    activationSource: 'shopify_app',
    activationDetails: { shopifyAppKey: appKey }
  });

  // 7. Redirect to app UI (Shopify embedded or standalone)
  const redirectUrl = uiRouter.getPostInstallRedirectUrl({
    appKey,
    merchantId,
    shopId
  });

  return res.redirect(302, redirectUrl);
}
```

### 4.3 Merchant Resolution (Locked Contract)

```ts
export interface ResolveMerchantAndShopInput {
  shopifyDomain: ShopifyDomain;
  shopifyShopId?: number;
  appKey: ShopifyAppKey;
}

export interface ResolveMerchantAndShopResult {
  merchantId: MerchantId;
  shopId: ShopId;
}

export interface MerchantLinkingService {
  resolveOrCreateMerchantAndShop(
    input: ResolveMerchantAndShopInput
  ): Promise<ResolveMerchantAndShopResult>;
}
```

**Locked behavior:**

1. If `core_shops.shopify_domain = input.shopifyDomain` exists:

   * Reuse `shopId` & its `merchantId`.
2. Else:

   * Try to find an existing merchant by email/domain later (v2); v1: **create new merchant**:

     ```ts
     merchantId = uuid();
     shopId = uuid();
     ```
3. Insert into `core_shops` with that `merchantId`.

> v1 is **simple**: one shop = one merchant.
> v2 may introduce cross-shop linking logic; that must be versioned.

---

## 5. Module Activation Service (Locked Contract)

```ts
export interface ActivateModuleInput {
  merchantId: MerchantId;
  shopId: ShopId;
  moduleKey: ModuleKey;
  activationSource: 'shopify_app' | 'direct_saas' | 'internal';
  activationDetails?: Record<string, any>;
}

export interface ModuleActivationService {
  activateModuleForShop(input: ActivateModuleInput): Promise<void>;

  getModuleStatesForShop(shopId: ShopId): Promise<ModuleStates>;

  getModuleStatesForMerchant(merchantId: MerchantId): Promise<{
    [shopId: string]: ModuleStates;
  }>;
}
```

**Locked Rules:**

1. `activateModuleForShop`:

   * Upserts row in `core_module_subscriptions` with `activation_state = 'active'`.
2. Deactivation (e.g., uninstall) MUST **not** hard delete; it sets `activation_state = 'locked'`.
3. `getModuleStatesForShop` MUST:

   * return all `ModuleKey`s with `active/locked`;
   * default to `locked` when no subscription row exists.

---

## 6. App UI Contract – “Module Map” API (Locked)

Every Shopify app needs to show:

* its own module as **unlocked**
* other modules as **locked** (upsell targets)

### 6.1 Authenticated Context Endpoint

```http
GET /api/core/v1/context
Authorization: Bearer <JWT-from-SSO-or-session>
X-Shop-Id: {shopId}
```

#### Response

```ts
export interface CoreContextResponse {
  merchantId: MerchantId;
  shopId: ShopId;
  shopifyDomain: ShopifyDomain;

  modules: ModuleStates;

  // optional: plan/limits per module, v2+ might extend
  // plans?: Record<ModuleKey, { planId: string; label: string }>;
}
```

**Rules:**

* This contract is **locked** for v1.
* Shopify app frontends MUST use `modules` to render:

  * one module as active,
  * others as locked.

---

## 7. Shared Webhook Routing (Locked)

All Shopify webhooks from all apps terminate at:

```http
POST /shopify/webhooks
X-Shopify-Topic: ...
X-Shopify-Shop-Domain: {shopifyDomain}
X-Shopify-Api-Version: ...
X-Lasyncro-App-Key: {shopifyAppKey}   // custom header per app
```

### 7.1 Canonical Envelope

```ts
export interface ShopifyWebhookEnvelope {
  appKey: ShopifyAppKey;
  shopifyDomain: ShopifyDomain;
  topic: string;
  rawBody: string;
  headers: Record<string, string>;
}
```

### 7.2 Locked Handler Flow

```ts
async function webhookHandler(req, res) {
  const appKey = req.headers['x-lasyncro-app-key'] as ShopifyAppKey;
  const shopifyDomain = req.headers['x-shopify-shop-domain'] as ShopifyDomain;
  const topic = req.headers['x-shopify-topic'] as string;

  // 1. Validate appKey
  const moduleKey = SHOPIFY_APP_TO_MODULE[appKey];
  if (!moduleKey) return res.status(400).send('Unknown appKey');

  // 2. Verify HMAC per appKey (each has its own secret)
  await securityValidator.assertValidShopifyWebhook(req, appKey);

  // 3. Resolve shop & merchant
  const { shopId, merchantId } =
    await merchantLinkingService.requireShopByDomain(shopifyDomain);

  const envelope: ShopifyWebhookEnvelope = {
    appKey,
    shopifyDomain,
    topic,
    rawBody: req.rawBody,
    headers: req.headers as any
  };

  // 4. Dispatch to per-module webhook consumers
  await webhookDispatcher.dispatchToModule({
    moduleKey,
    merchantId,
    shopId,
    envelope
  });

  return res.status(200).send('OK');
}
```

```ts
export interface WebhookDispatcher {
  dispatchToModule(input: {
    moduleKey: ModuleKey;
    merchantId: MerchantId;
    shopId: ShopId;
    envelope: ShopifyWebhookEnvelope;
  }): Promise<void>;
}
```

**Rule:**
No module gets direct Shopify webhooks; everything is routed through this layer.

---

## 8. Uninstall Handling (Locked)

On uninstall of any LaSyncro Shopify app:

```ts
export interface AppUninstalledWebhookBody {
  // standard Shopify fields, unimportant for our contract
}
```

Locked behavior:

1. `core_shopify_app_installations.uninstalled_at` set to `now`.
2. Corresponding `core_module_subscriptions` for that moduleKey:

   * `activation_state` set to `'locked'`.
   * `activation_details` updated with `{ reason: 'shopify_uninstall', at: now }`.
3. Other modules unlocked via other sources **must not** be impacted.

---

## 9. Security & SSO Boundary (High-Level, Locked Principles)

* Every Shopify app frontend **must** authenticate against LaSyncro backend via:

  * Shopify session + signed payload, or
  * LaSyncro-issued JWT after OAuth.
* The linking layer guarantees:

  * `merchantId` + `shopId` consistency per request.
* Modules must **not** infer identity from raw `shopifyDomain` directly; they must call the linking service.

---

## 10. Observability & Metrics

```ts
const MULTI_APP_LINKING_METRICS = {
  installs: {
    shopify_installs_total: 'Counter – per appKey',
    shopify_uninstalls_total: 'Counter – per appKey'
  },
  identity: {
    merchants_created_total: 'Counter',
    shops_created_total: 'Counter'
  },
  linking: {
    module_activations_total: 'Counter – labels: moduleKey, activationSource',
    module_deactivations_total: 'Counter – labels: moduleKey, activationSource'
  },
  webhooks: {
    shopify_webhooks_received_total: 'Counter – labels: appKey, topic',
    shopify_webhook_failures_total: 'Counter – labels: appKey, topic'
  }
};
```

> **SLA suggestion (non-contractual):**
>
> * 99% of install flows complete in < 3s.
> * 99% of webhooks resolved to module handlers in < 1s.

---

## 11. Phase 1 Scope (Locked)

### Included

* Single backend for all Shopify apps.
* Identity model:

  * `core_merchants`, `core_shops`, `core_shopify_app_installations`, `core_module_subscriptions`.
* Locked mapping: `ShopifyAppKey → ModuleKey`.
* OAuth & install flow that:

  * resolves/creates merchants & shops,
  * upserts app installation,
  * activates exactly one module.
* Context API (`/api/core/v1/context`) for module map.
* Shared webhook routing layer.

### Not Included (v1)

* Cross-shop merchant unification logic (e.g., mapping multiple Shopify stores to one merchant by email/domain).
* Multi-platform identity (e.g., non-Shopify channels).
* In-depth plan/usage limits per module in this layer (modules handle their own limits).
* Any business logic specific to modules (returns, WMS, inventory, etc.).

---

## 12. Developer Contract – Final Statement

> **Multi-App Linking Developer Contract (v1)**
>
> Given:
>
> * multiple LaSyncro Shopify apps,
> * one shared LaSyncro backend,
>
> This layer guarantees:
>
> * **One canonical merchant identity** per Shopify shop.
> * **Deterministic mapping** from Shopify app install → module activation.
> * **Single source of truth** for module activation state (`active` / `locked`).
> * **Consistent `merchantId` / `shopId` context** for all module calls.
> * **Centralized OAuth & webhook handling** for all apps.
>
> Any implementation that:
>
> * bypasses this layer and talks directly to Shopify,
> * hard-codes module activation outside `core_module_subscriptions`,
> * or re-implements its own merchant/shop identity,
>
> is **not compliant with LaSyncro v1 Multi-App Linking** and must be treated as a breaking variant requiring a versioned contract (`v2`) and migration plan.

---

Next steps:
wire this into ReturnNexus specifically (shop → merchant → shopId → events → refunds), or
design the exact /api/core/v1/context responses per app, or
extend this to multi-channel identity (future non-Shopify platforms) while keeping v1 stable.