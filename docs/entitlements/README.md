# 🧩 SynchroFlow Entitlements System – README (v2)

This directory contains the **complete documentation for the SynchroFlow Entitlements System**, which controls access to:

* Routes
* Navigation
* Widgets
* Premium features
* Feature flags
* Module-based capabilities

Entitlements unify **backend capability grants** with **frontend gating rules** into a single consistent model.

---

# 1. What Are Entitlements?

Entitlements define **what a shop is allowed to do**.

A shop may have:

```ts
modules: string[];  // capabilities (analytics, finances, etc.)
flags: string[];    // feature rollouts (beta flags, experiments)
```

Example:

```json
{
  "shopId": 123,
  "modules": ["analytics", "advanced-analytics"],
  "flags": ["beta-top-products"]
}
```

These values control:

* Which pages the merchant can access
* Which nav items appear
* Which widgets are visible
* What premium features unlock automatically

---

# 2. Where Entitlements Come From

Backend generates entitlements in:

* `EntitlementsService.getForUser()`
* `shop_module_entitlements` table
* `entitlement_flags` table

Entitlements are fetched by the frontend using:

```
GET /api/v1/entitlements/me
```

They are automatically updated:

* After successful Shopify OAuth
* After module upgrades
* After admin actions (future)

---

# 3. How the Frontend Uses Entitlements

Entitlements flow through three major areas:

### **3.1. Routing**

In `routes.tsx`, each route can declare:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
```

Gating is enforced in:

* `<ProtectedRoute />`
* `filterRoutesByEntitlements()`

Locked routes → redirect to `/dashboard`.

---

### **3.2. Navigation (Sidenav)**

`SidenavContent → MenuList` receives a filtered route list:
only allowed routes appear in the navigation.

This ensures:

* No ghost items
* No broken links
* No accidental exposure of premium pages

---

### **3.3. Widgets**

Each widget in `widget-registry.tsx` may declare:

```ts
requiresPaidPlan: boolean;
requiredModuleId?: string;
requiredFlagId?: string;
```

Filtered by:

`useWidgetRegistry()`
→ Only entitlements-approved widgets are displayed.

This powers the FT0 vs premium dashboard experience.

---

# 4. FT0 Default Entitlements

When a shop connects via Shopify OAuth:

```ts
modules = [
  "core-dashboard",
  "core-orders",
  "core-products",
  "core-customers"
];

flags = [];
```

These correspond to:

* Free dashboard
* Core widgets
* Orders / Products / Customers views
* No premium intelligence pages

See `ft0-entitlements.md` for the complete FT0 spec.

---

# 5. Premium Upgrades

Adding a module is as simple as one DB insert:

```sql
INSERT INTO shop_module_entitlements (shop_id, module_id)
VALUES (123, 'analytics');
```

Frontend instantly unlocks:

* `/analytics`
* Analytics widgets
* Nav item

No further code required.

---

# 6. Developer Reference

Each doc in this directory provides deeper details.

| File                    | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| **overview.md**         | High-level architecture + entitlement flow   |
| **backend.md**          | DB schema, service logic, API behavior       |
| **frontend.md**         | Provider, routing, UI behavior               |
| **widget-gating.md**    | Registry rules + widget capability filtering |
| **ft0-entitlements.md** | Free-tier specification                      |
| **diagram.md**          | Visual architecture diagram                  |
| **onboarding.md**       | How to add a new module/flag end-to-end      |
| **README.md**           | This index                                   |

---

# 7. Visual Flow Summary

```
Backend DB → EntitlementsService → /entitlements/me
                                           │
                                           ▼
Frontend EntitlementsProvider
     │            │               │
     ▼            ▼               ▼
ProtectedRoute   Sidenav        useWidgetRegistry
 Route gating    Nav gating     Widget gating
```

One entitlement model → 3 enforcement layers → consistent product behavior.

---

# 8. Status

Entitlement v2 is:

* Fully implemented
* Tested across backend & frontend
* Modular & extensible
* Ready for FT1 / Premium plans
* Ready for App Store submission

---
