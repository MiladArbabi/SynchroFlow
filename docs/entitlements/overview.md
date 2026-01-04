# **Entitlements Overview – As-Is Contract (Scan-Verified)**

This document describes the **current, implemented entitlements system exactly as it exists today**.

Scope (As-Is only):

* Backend entitlement persistence and APIs
* Frontend entitlement consumption and gating
* Default FT0 entitlement grants

Non-scope (explicitly excluded):

* Lifecycle authority
* Billing, plans, or payment proof
* FT2 or future capability design
* Upgrade / downgrade systems

This document is a **factual baseline**, not a forward-looking architecture.

---

# 1. Purpose of the Entitlements System

Entitlements define **what a shop is allowed to access** across the entire application.

They provide a **single access-projection mechanism** across:

* Routes
* Navigation
* Widgets
* Module-based capabilities
* Feature flags

Everything uses **one shared entitlement model**:

ts
interface EntitlementSnapshot {
  modules: string[];
  flags: string[];
}

---

# 2. Core Design Principles

### 2.1 ✨ Declarative, Not Procedural

Features declare requirements:

ts
requiredModuleId?: string;
requiredFlagId?: string;
requiresPaidPlan?: boolean;

Frontend helpers enforce these declarations at runtime.
The backend does not evaluate feature-level logic.

---

### 2.2 Authority Split (As-Is)

* Backend is authoritative for **which entitlements exist**
* Frontend is authoritative for **how access is expressed in the UI**

Backend does **not**:

* Gate routes
* Render UI
* Interpret plans or tiers

---

### 2.3 ✨ No Dead UI

If a user cannot access something:

* The route disappears from the sidenav
* The widget is excluded from the dashboard
* Attempts to access it redirect cleanly
* No broken pages, no hidden 403s

---

### 2.4 ✨ Automatic UX on Entitlement Changes

When backend entitlements change:

* Navigation updates automatically
* Routes unlock automatically
* Widgets appear/disappear automatically

No code changes required.

---

# 3. Backend Architecture

### 3.1 DB Schema

Single entitlement table (as implemented):

* shop_module_entitlements
* shop_id
* module_key
* flag_key

There is **no separate entitlement_flags table** in the current system.

### 3.2 EntitlementsService

Responsible for:

* Loading entitlements for a shop
* Granting default FT0 entitlements upon installation
* Potentially adding new modules/flags upon upgrade

Key methods:

ts
getForUser(userId)
grantDefaultFreeTierForShop(shopId)

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

GET /api/v1/entitlements/me

Stores:

* `modules`
* `flags`
* `shopId`

Exposes:

ts
hasModule(moduleId)
hasFlag(flagId)
refresh()

Runs automatically after:

* Login
* Shopify connect
* Manual refresh

---

### 4.2 Route Gating (ProtectedRoute)

Each route in `routes.tsx` may declare:

ts
requiredModuleId
requiredFlagId

`ProtectedRoute` enforces:

* Allowed → render
* Not allowed → redirect to `/dashboard`

Test coverage ensures expected behavior.

---

### 4.3 Navigation Gating (MenuList / SidenavContent)

The sidenav receives a filtered list of routes:

ts
filterRoutesByEntitlements(routes, snapshot)

Only allowed routes appear as menu items.

This prevents:

* Clicking into locked screens
* Seeing items that cause redirects
* Inconsistent navigation between free and paid users

---

### 4.4 Widget Gating (useWidgetRegistry)

Widgets are filtered by:

1. Mode (UI-only)
2. Entitlements (`requiredModuleId`, `requiredFlagId`)
3. A **frontend-only heuristic** (`requiresPaidPlan`)

⚠️ `requiresPaidPlan` is **not backed by backend billing or entitlements**.
It is a frontend UX heuristic only and must not be interpreted as payment proof.

ts
requiredModuleId
requiredFlagId

This is fully automatic.

---

# 5. Default Free-Tier Entitlements (FT0 Grant Only)

On initial installation, the backend grants a **default free-tier entitlement bundle**.
This grant is **not a lifecycle latch** and does not determine readiness.

modules = [

* core_dashboard
* shopify_integration
* specter_sdk_free
* order-nexus
]

flags = []

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

sql
INSERT INTO shop_module_entitlements (shop_id, module_id)
VALUES (123, "analytics");

Frontend automatically unlocks:

* `/analytics` route
* Analytics nav item
* Analytics widgets

No code modifications required.

---

# 7. Testing Strategy

The entitlement system is now tested across layers:

### Backend

* EntitlementsService tests
* Controller tests
* OAuth callback FT0 grants

### Frontend

* EntitlementsContext tests
* Widget gating tests
* ProtectedRoute entitlement tests
* Navigation filtering tests

Everything is deterministic and well-isolated.

---

# 8. Summary

The entitlement system is now:

* **Stable**
* **Unified**
* **Extensible**
* **Predictable**
* **Fully test-covered**
* **Easy to extend**

It is the **current access-projection mechanism** for the application UI.

It does **not**:

* Define lifecycle truth
* Prove payment
* Represent plans or tiers
* Predict future capability systems

---

## 🔒 As-Is Contract Seal

This document reflects **only scan-verified, implemented behavior**.

Any change requires:

1. Code scans
2. Explicit diffs
3. Contract amendment

Forward-looking intent is intentionally excluded.
