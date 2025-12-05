# 🆓 FT0 Entitlements – Free-Tier Capability Specification (v2)

This document defines the **authoritative entitlement contract** for Free-Tier (FT0) merchants in SynchroFlow.
It describes:

* What modules a free shop receives
* What modules and flags it does NOT receive
* What pages/routes are accessible
* What widgets are visible
* What the user experience is before & after Shopify connection
* How the upgrade path works

It reflects implementation across:

* Backend: `EntitlementsService`
* Frontend: `EntitlementsProvider`, route gating, sidenav gating, widget gating
* Shopify OAuth (#878)
* Dashboard routing (#883)

---

# 1. FT0 Modules (Capabilities Granted)

Upon initial signup or Shopify installation, the backend assigns:

```ts
modules = [
  "core-dashboard",
  "core-orders",
  "core-products",
  "core-customers"
]

flags = []
```

Meaning FT0 shops can:

* Access the dashboard
* View and navigate orders
* View and navigate customers
* View and navigate products
* Use basic intelligence widgets
* Use ingestion and syncing features

They **do not receive** any premium modules.

---

# 2. FT0 Restricted Modules (Not Granted)

These modules remain **locked** unless a shop upgrades:

| Module ID            | Unlocks                                      |
| -------------------- | -------------------------------------------- |
| `analytics`          | Analytics dashboard, advanced charts         |
| `finances`           | Finances page, profitability deep-dive tools |
| `advanced-analytics` | Premium widget bundle (L4 intelligence)      |
| `sku-os`             | Advanced SKU intelligence (future gating)    |
| `echo-hub`           | Workflow orchestration (future)              |

A shop that does NOT have these modules will:

* Not see corresponding routes in navigation
* Be redirected if trying to open `/analytics` or `/finances`
* Not see widgets requiring these modules

---

# 3. FT0 Allowed Routes

FT0 merchants can access:

| Route               | Purpose                                |
| ------------------- | -------------------------------------- |
| `/dashboard`        | Core dashboard with FT0 widgets        |
| `/orders`           | Order list                             |
| `/orders/:id`       | Order 360 view                         |
| `/products`         | Product list                           |
| `/products/:id`     | Product 360 view                       |
| `/customers`        | Customer list                          |
| `/customers/:id`    | Customer 360 view                      |
| `/echo-hub`         | Basic workflow inbox (ungated for now) |
| `/account/settings` | Access account details                 |

All these routes appear in the sidenav automatically.

---

# 4. FT0 Blocked Routes

| Route                   | Reason                       |
| ----------------------- | ---------------------------- |
| `/analytics`            | Requires `analytics` module  |
| `/finances`             | Requires `finances` module   |
| `/product-intelligence` | Legacy — no longer shown     |
| `/data-mapper`          | Deprecated — no longer shown |

Attempting to navigate to a locked route triggers:

→ **ProtectedRoute redirect → `/dashboard`**

---

# 5. FT0 Widget Availability

FT0 merchants see the following widgets:

### ✔ Available

| Widget ID                 | Notes                    |
| ------------------------- | ------------------------ |
| `cash-flow`               | L3 cash-flow stabilizer  |
| `inventory-alerts`        | L2 stock/velocity basics |
| `order-metrics`           | L1 order analytics       |
| `top-products`            | L1 product performance   |
| `sales-by-traffic-source` | L1 traffic attribution   |

These reflect **light** or **medium** computation cost and do not require paid entitlements.

---

### ❌ Hidden in FT0

| Widget ID            | Required                    |
| -------------------- | --------------------------- |
| `advanced-analytics` | `advanced-analytics` module |

Any widget in the registry that declares:

```ts
requiresPaidPlan: true
requiredModuleId: "advanced-analytics"
```

is removed by `useWidgetRegistry()` for FT0 shops.

---

# 6. FT0 User Experience

### Before Shopify Connect

User sees:

* Connect Store banner
* Minimal dashboard layout
* No data-driven widgets until the first sync completes.
* Only skeleton placeholders may be rendered during initial sync.

### After Successful Shopify Connect

Flow:

1. OAuth redirect with `connect=success`
2. Entitlements load (`FT0 default`)
3. Initial sync begins (DataSyncingModal → completion)
4. Dashboard populated with FT0 widgets
5. No Analytics / Finances menu entries

### If Shopify Connect Fails

User sees:

* ConnectionErrorModal with friendly message
* Ability to retry

---

# 7. FT0 → Upgrade Path

When a shop upgrades:

1. Backend inserts module rows, e.g.:

```
INSERT INTO shop_module_entitlements (shop_id, module_id)
VALUES (123, 'analytics');
```

2. `/entitlements/me` automatically returns:

```
modules: ["core-dashboard", ..., "analytics"]
```

3. Frontend immediately unlocks:

* `/analytics` route
* Analytics nav item
* Analytics widgets

No additional code changes needed.

---

# 8. Tests Validating FT0 Behavior

Unit & integration tests cover:

| Area                | Test File                              |
| ------------------- | -------------------------------------- |
| Entitlement loading | `EntitlementsContext.test.tsx`         |
| Widget gating       | `widget-registry.test.tsx`             |
| Route gating        | `ProtectedRoute.entitlements.test.tsx` |
| Navigation gating   | `MenuList.entitlements.test.tsx`       |
| OAuth → FT0 grant   | `integration.controller.test.ts`       |

These ensure deterministic FT0 behavior.

---

# 9. Summary

FT0 entitlements are:

* Minimal
* Stable
* Safe for App Store approval
* Reactive across the stack
* Enough to deliver the full free trial experience

Upgrades expand functionality by **adding modules**, not by modifying code.

---
