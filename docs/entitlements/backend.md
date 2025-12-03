# 🛠 Backend Entitlements – v2 (Modules, Flags, & Integration Path)

This document explains how backend entitlements work, how they are stored, produced, and consumed by the frontend, and how new modules or flags should be added.

It reflects all updates delivered in:

* Canonical ingestion (#884)
* OAuth + integrations (#878)
* Entitlement enforcement across app (#883)

---

**1. What Are Backend Entitlements?**

Entitlements are **shop-level capabilities**:
they determine *what a shop is allowed to access* across routes, widgets, and features.

Backend entitlements consist of:

```ts
modules: string[]  // Ex: ["analytics", "finances"]
flags: string[]    // Ex: ["beta-top-products"]
```

These correspond 1:1 to frontend-routing and widget metadata.

---

# 2. Persistence Model

### 2.1 Tables

**shop_module_entitlements**

| column     | type     | description                                |
| ---------- | -------- | ------------------------------------------ |
| shop_id    | integer  | The tenant/shop this applies to            |
| module_id  | text     | The module/capability ID, e.g. "analytics" |
| created_at | datetime | Audit                                      |

Composite PK: `(shop_id, module_id)`

**entitlement_flags**

| column  | type    | description                         |
| ------- | ------- | ----------------------------------- |
| shop_id | integer | The tenant/shop                     |
| flag_id | text    | Feature flag, e.g. "beta-charts-v2" |

Composite PK: `(shop_id, flag_id)`

---

# 3. EntitlementsService

Backend source of truth:

```ts
EntitlementsService.getForUser(userId)
EntitlementsService.grantDefaultFreeTierForShop(shopId)
```

## 3.1 getForUser()

* Looks up the user → shop_id
* Returns entitlements for the shop:

```ts
{
  shopId: number | null,
  modules: string[],
  flags: string[]
}
```

If user or shop is missing → returns:

```ts
{ shopId: null, modules: [], flags: [] }
```

## 3.2 grantDefaultFreeTierForShop()

Executed:

* On first-time Shopify installation (OAuth callback)
* When a new shop is created in SynchroFlow (self-signup)

Default FT0 modules:

```
core-dashboard
core-orders
core-products
core-customers
```

Flags are empty by default.

---

# 4. Entitlements API Contract

### Endpoint

```
GET /api/v1/entitlements/me
```

### Response

```ts
{
  shopId: 123,
  modules: ["core-dashboard", "core-orders", ...],
  flags: [],
}
```

Used by the frontend to determine route and widget access.

---

# 5. Shopify OAuth Integration (Where Entitlements Connect)

Inside `handleOAuthCallback`:

1. Exchange code → token
2. Store encrypted token
3. Queue initial sync job
4. Call:

```ts
EntitlementsService.grantDefaultFreeTierForShop(shopId)
```

This ensures every newly connected Shopify store receives the FT0 entitlement baseline.

Later upgrades simply insert new rows into:

* `shop_module_entitlements`
* `entitlement_flags`

The frontend reacts automatically.

---

# 6. How Entitlements Drive the Product

Backend → Frontend mapping is direct:

| Backend Module       | Meaning                       | Unlocks in UI                    |
| -------------------- | ----------------------------- | -------------------------------- |
| `analytics`          | Shop has Analytics capability | `/analytics`, analytics widgets  |
| `finances`           | Shop has Finances capability  | `/finances`, margin/COGS widgets |
| `advanced-analytics` | Paid L4 widgets               | Advanced Analytics widget        |
| `echo-hub` (future)  | Workflow automations          | Echo Inbox module gating         |

Backend does **not** decide *how* these modules appear in the UI.
It only decides *whether the shop has the module*.
The UI decides:

* Which widgets to show
* Which routes to show
* What pages to hide or redirect

---

# 7. Adding a New Premium Feature (Backend Steps)

To introduce a new premium feature:

### Step 1 — Define a module ID

Example:

```
"returns-analytics"
```

### Step 2 — Add to entitlement tables as needed

```sql
INSERT INTO shop_module_entitlements (shop_id, module_id)
VALUES (123, 'returns-analytics');
```

### Step 3 — Update `/entitlements/me` response automatically

No code needed — the service already returns all rows.

### Step 4 — Frontend team tags the route or widget

```ts
requiredModuleId: "returns-analytics"
```

Everything else becomes automatic.

---

# 8. Tests

Backend entitlements are covered in:

* `tests/unit/services/entitlements.service.test.ts`
* `tests/unit/api/entitlements.controller.test.ts`
* `tests/unit/api/integration.controller.test.ts` (FT0 grants)

These validate:

* Default FT0 entitlements granted on install
* Entitlements correctly loaded per user
* API returns expected shape
* No entitlements → empty arrays, not null

---

# 9. Summary

Backend entitlements v2:

* Are **simple, stable, explicit**
* Grant capabilities via **modules** and **flags**
* Power route gating, widget gating, and navigation gating
* Integrate directly with Shopify OAuth & FT0 flows
* Require only DB inserts to unlock new features
* Are 100% reactive on the frontend

This establishes a clean, scalable model for FT1, FT2, and enterprise plan features.

---
