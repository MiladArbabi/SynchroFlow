# FT0 Entitlements & Free-Tier Gating

Status: Draft → Implemented in #818  
Owner: Backend + Frontend  
Scope: FT0 (Free tier) only

---

## 1. Why This Exists

Right now, once a Shopify store is connected and synced, the dashboard behaves as if the user has access to everything:

- All widgets try to load.
- No clear separation between **Free**, **Growth**, **Pro**.
- No explicit model of “what this shop is allowed to do”.

This is dangerous because:

1. **We can’t safely ship a free tier** to Shopify App Store if there’s no enforceable contract of what’s included.
2. **We can’t scale pricing later** (modules, add-ons, paywalls) without a central entitlements layer.
3. **Frontends are guessing** instead of asking the backend “what is allowed?”.

This doc defines a **minimal but extensible** entitlement model that:

- Works for FT0 now.
- Doesn’t block Growth/Pro design later.
- Can be computed quickly at runtime for each request.

Analogy:  
Think of **entitlements** as the “circuit breaker panel” of the app.  
Right now all switches are just hardwired ON.  
We’re adding:

- Labeled switches (modules / capabilities).
- A panel per shop.
- A single API to read the panel so the UI doesn’t guess.

---

## 2. Core Concepts

We care about three levels:

1. **Module** – high-level product surface: `core_dashboard`, `order_nexus`, `insight_core`, `specter_sdk`, etc.
2. **Capability** – finer-grained flags inside a module: `view_basic_sales`, `view_advanced_analytics`, `export_orders`, etc.
3. **Shop Entitlements** – which modules/capabilities are enabled for a given shop.

For FT0:

- We keep the model **simple**, but design it so we can expand:
  - FT0: 1 entitlement bundle (e.g. `free_tier_core`).
  - Later: Growth, Pro, per-add-on capabilities.

---

## 3. Data Model (Minimal Viable Schema)

> NOTE: Names are indicative; align with existing naming patterns in your DB.

### 3.1 Tables

#### `modules`

Represents high-level product modules.

```sql
-- PSEUDO-SCHEMA (reference only)
modules (
  id              serial primary key,
  module_key      text unique not null,  -- e.g. 'core_dashboard', 'order_nexus'
  display_name    text not null,         -- e.g. 'Core Dashboard'
  description     text,
  is_core         boolean default false, -- true if part of default FT0 bundle
  created_at      timestamptz default now()
)
````

Seed examples for FT0:

- `core_dashboard` – basic KPIs, pulse, inventory health.
- `shopify_integration` – keeping the store linked & syncing.
- `specter_sdk_free` – free SDK for basic tracking.

#### `entitlement_flags`

Represents fine-grained capabilities within modules.

```sql
entitlement_flags (
  id                serial primary key,
  flag_key          text unique not null, -- e.g. 'view_basic_sales', 'view_advanced_analytics'
  module_key        text not null references modules(module_key) on delete cascade,
  description       text,
  created_at        timestamptz default now()
)
```

FT0 example flags:

- `view_basic_sales` (module: `core_dashboard`)
- `view_recent_orders_widget` (module: `core_dashboard`)
- `view_inventory_health_widget` (module: `core_dashboard`)
- `use_shopify_sync` (module: `shopify_integration`)

#### `shop_module_entitlements`

This is the per-shop map of “which modules/flags are enabled”.

```sql
shop_module_entitlements (
  id                serial primary key,
  shop_id           integer not null,        -- existing shops table FK
  module_key        text not null references modules(module_key),
  flag_key          text references entitlement_flags(flag_key),
  source            text not null,           -- 'free_tier_default', 'manual', 'upgrade'
  created_at        timestamptz default now(),
  unique (shop_id, module_key, flag_key)
)
```

For FT0 we will:

- Automatically grant a **default bundle** when Shopify install completes and sync is queued:

  - `shopify_integration` + `use_shopify_sync`
  - `core_dashboard` + `view_basic_sales`, `view_recent_orders_widget`, `view_inventory_health_widget`
  - `specter_sdk_free` (if applicable)

---

## 4. Backend: Entitlements Service

Goal: centralize entitlement logic.

### 4.1 Service Responsibilities

`EntitlementsService` (backend):

- Map from `userId` → `shop_id` (via `users` table).
- Query `shop_module_entitlements` for that shop.
- Optionally join to `modules` & `entitlement_flags` for richer metadata.
- Provide:

```ts
type EntitlementFlag = {
  moduleKey: string;
  flagKey: string | null; // null means module-level entitlement
};

type ShopEntitlements = {
  shopId: number;
  modules: string[];        // e.g. ['core_dashboard', 'shopify_integration']
  flags: string[];          // e.g. ['view_basic_sales', 'view_recent_orders_widget']
};
```

Public API (server-side):

```ts
class EntitlementsService {
  static async getForUser(userId: number): Promise<ShopEntitlements | null>;
  static async grantDefaultFreeTierForShop(shopId: number): Promise<void>;
}
```

### 4.2 Integration with OAuth Flow

We already do all of this when Shopify OAuth succeeds:

- Create `integrations` row.
- Set `users.shopify_connected = true`.
- Queue initial sync.
- Run `ShopifyAppService.completePostInstallation(...)`.

**Add to this flow:**

Inside `ShopifyAppService.completePostInstallation` (or immediately after successful integration creation):

- Call `EntitlementsService.grantDefaultFreeTierForShop(shopId)`.

This ensures **every Shopify install** leaves the system in a state where:

- The shop has a clear entitlement record.
- UI can gate based on entitlements without touching OAuth again.

---

## 5. Backend: Public API

Add a read-only endpoint for the UI:

`GET /api/v1/entitlements/me`

- **Auth**: Requires valid JWT (same as other `/me` endpoints).
- **Behavior**:

  - Resolve user → shop_id.

  - Call `EntitlementsService.getForUser(userId)`.

  - If no shop or no entitlements: return a safe default, e.g.:

    ```json
    {
      "modules": [],
      "flags": []
    }
    ```

  - Otherwise return:

    ```json
    {
      "shopId": 123,
      "modules": ["core_dashboard", "shopify_integration"],
      "flags": [
        "view_basic_sales",
        "view_recent_orders_widget",
        "view_inventory_health_widget",
        "use_shopify_sync"
      ]
    }
    ```

No writes from the frontend in FT0; all initial grants come from the backend after Shopify install.

---

## 6. Frontend: Using Entitlements

We **do not** want random components hitting `/entitlements/me` ad-hoc.

Instead:

1. Extend `IntegrationContext` **or** create a sibling `EntitlementsContext` (leaning toward separate context for clarity).

2. That context:

   - Fetches `/api/v1/entitlements/me` after login.
   - Exposes:

     ```ts
     interface EntitlementsContextValue {
       hasModule: (moduleKey: string) => boolean;
       hasFlag: (flagKey: string) => boolean;
       modules: string[];
       flags: string[];
       isLoading: boolean;
     }
     ```

3. Key usage examples for FT0:

   - Dashboard widgets:

     - Only render **advanced analytics widgets** if `hasFlag('view_advanced_analytics')`.
     - Always render free-tier widgets if `hasFlag('view_basic_sales')`, etc.
   - Future:

     - Menu items, settings pages, exports, etc.

---

## 7. FT0 Default Bundle

For FT0, we define a **single default bundle** granted on successful Shopify install.

### 7.1 Modules

- `core_dashboard`
- `shopify_integration`
- `specter_sdk_free` (if relevant for SDK visibility)

### 7.2 Flags by Module

- `core_dashboard`

  - `view_basic_sales`
  - `view_recent_orders_widget`
  - `view_inventory_health_widget`
- `shopify_integration`

  - `use_shopify_sync`
- `specter_sdk_free`

  - `use_specter_free_sdk` (optional, but future-proof)

All of these are granted with `source = 'free_tier_default'`.

---

## 8. Implementation Plan (TDD-First)

This is the concrete execution order for #818:

1. **Migrations**

   - Add migrations for `modules`, `entitlement_flags`, `shop_module_entitlements`.
   - Seed FT0 default modules & flags.

2. **Service**

   - Implement `EntitlementsService` with:

     - `getForUser(userId)`
     - `grantDefaultFreeTierForShop(shopId)`
   - Unit tests for:

     - “no entitlements” path.
     - FT0 default bundle grant.
     - Mapping logic from DB rows → `ShopEntitlements`.

3. **Wire into OAuth flow**

   - Update `ShopifyAppService.completePostInstallation` (or callback path) to call `grantDefaultFreeTierForShop`.
   - Add unit test(s) mocking `EntitlementsService` to ensure it’s called with `shopId`.

4. **API Endpoint**

   - Implement `GET /api/v1/entitlements/me`.
   - Unit tests:

     - No shop → `{ modules: [], flags: [] }`.
     - Shop with default FT0 entitlements → expected payload.

5. **Frontend Context**

   - Implement `EntitlementsContext` + hook `useEntitlements`.
   - Tests:

     - Calls backend with `Authorization` header.
     - `hasModule` / `hasFlag` behavior.

6. **UI Gating (Minimal FT0)**

   - Use `hasFlag` for:

     - Basic dashboard widgets.
     - Any candidate “future premium” widgets to prove gating works.

Everything should go through the usual:

- Red tests → implement → green.
- `npm test` for backend + frontend unit tests.
- `./ship.sh "feat(entitlements): FT0 free-tier gating" 818` when done.

---

This doc now gives us a **single source of truth** for entitlements.
