# **Entitlements Overview – v2 (Final Architecture)**

This document provides a *complete architectural overview* of the SynchroFlow Entitlements System as implemented across:

* Backend (EntitlementsService, OAuth, DB)
* Frontend (EntitlementsProvider, routes, widgets, nav)
* Cross-module FT0 behavior
* Upgrade path
* Design principles for future modules/flags

It reflects the final implementation delivered in issues #878, #883, and FT0 stabilization work.

---

# 1. Purpose of the Entitlements System

Entitlements define **what a shop is allowed to access** across the entire application.

They unify access control across:

* Routes
* Navigation
* Widgets
* Intelligence levels
* Module-based capabilities
* Feature flags

Everything uses **one shared entitlement model**:

```ts
interface EntitlementSnapshot {
  modules: string[];
  flags: string[];
}
```

---

# 2. Core Design Principles

### 2.1 ✨ Declarative, Not Procedural

Features declare requirements:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
requiresPaidPlan?: boolean;
```

The entitlement engine enforces them.
Features don’t embed entitlement logic internally.

---

### 2.2 ✨ Pure Frontend Enforcement

Backend only determines **what entitlements the shop has**.
Frontend determines **how the experience changes**.

No backend branching on plan/tier.

---

### 2.3 ✨ No Dead UI

If a user cannot access something:

* The route disappears from the sidenav
* The widget is excluded from the dashboard
* Attempts to access it redirect cleanly
* No broken pages, no hidden 403s

---

### 2.4 ✨ Automatic UX on Upgrade/Downgrade

When backend entitlements change:

* Navigation updates automatically
* Routes unlock automatically
* Widgets appear/disappear automatically

No code changes required.

---

# 3. Backend Architecture

### 3.1 DB Schema

Two store-level tables:

```
shop_module_entitlements (shop_id, module_id)
entitlement_flags        (shop_id, flag_id)
```

### 3.2 EntitlementsService

Responsible for:

* Loading entitlements for a shop
* Granting default FT0 entitlements upon installation
* Potentially adding new modules/flags upon upgrade

Key methods:

```ts
getForUser(userId)
grantDefaultFreeTierForShop(shopId)
```

### 3.3 OAuth Integration

During Shopify OAuth callback:

1. Token retrieved
2. Integration saved
3. **FT0 modules granted**

This creates immediate eligibility for:

* Dashboard
* Sync flow
* Basic widgets

---

# 4. Frontend Architecture

### 4.1 EntitlementsProvider

Fetches:

```
GET /api/v1/entitlements/me
```

Stores:

* `modules`
* `flags`
* `shopId`

Exposes:

```ts
hasModule(moduleId)
hasFlag(flagId)
refresh()
```

Runs automatically after:

* Login
* Shopify connect
* Manual refresh

---

### 4.2 Route Gating (ProtectedRoute)

Each route in `routes.tsx` may declare:

```ts
requiredModuleId
requiredFlagId
```

`ProtectedRoute` enforces:

* Allowed → render
* Not allowed → redirect to `/dashboard`

Test coverage ensures expected behavior.

---

### 4.3 Navigation Gating (MenuList / SidenavContent)

The sidenav receives a filtered list of routes:

```ts
filterRoutesByEntitlements(routes, snapshot)
```

Only allowed routes appear as menu items.

This prevents:

* Clicking into locked screens
* Seeing items that cause redirects
* Inconsistent navigation between free and paid users

---

### 4.4 Widget Gating (useWidgetRegistry)

Widgets have three gating layers:

1. Mode (survival/growth/architect)
2. Plan (`requiresPaidPlan`)
3. Entitlement requirements:

```ts
requiredModuleId
requiredFlagId
```

This is fully automatic.

---

# 5. FT0 Entitlements (Default Free-Tier)

FT0 shops receive:

```
modules = [
  "core-dashboard",
  "core-orders",
  "core-products",
  "core-customers"
]

flags = []
```

They have access to:

* Dashboard
* Orders / Customers / Products
* FT0 widget pack

They **do not** have:

* Analytics
* Finances
* Advanced intelligence modules
* Premium widgets

See `ft0-entitlements.md` for full spec.

---

# 6. Premium & Enterprise Paths

Upgrades simply insert new module rows:

```sql
INSERT INTO shop_module_entitlements (shop_id, module_id)
VALUES (123, "analytics");
```

Frontend automatically unlocks:

* `/analytics` route
* Analytics nav item
* Analytics widgets

No code modifications required.

---

# 7. Testing Strategy

The entitlement system is now tested across layers:

### Backend:

* EntitlementsService tests
* Controller tests
* OAuth callback FT0 grants

### Frontend:

* EntitlementsContext tests
* Widget gating tests
* ProtectedRoute entitlement tests
* Navigation filtering tests

Everything is deterministic and well-isolated.

---

# 8. Future Extensions (v3+)

### a) Usage-based gating

Limit access based on historical consumption.

### b) Plan-tier hierarchies

Auto-generate entitlement bundles per plan.

### c) Feature-flag rollouts

Gradual rollout for new widgets or intelligence engines.

### d) Dynamic entitlements from InsightCore

Enable feature unlocks driven by analytics thresholds (gamified progressive unlock).

---

# 9. Summary

The entitlement system is now:

* **Stable**
* **Unified**
* **Extensible**
* **Predictable**
* **Fully test-covered**
* **Easy to extend**

It is the long-term access-control foundation for:

* FT0 onboarding
* Premium upgrades
* Advanced analytics bundles
* Future product modules

---
