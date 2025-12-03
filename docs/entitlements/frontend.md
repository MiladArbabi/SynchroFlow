Here is the **updated, complete, clean, v2 Frontend Entitlements Documentation**
— incorporating everything we added in #883:

* **Route-level gating**
* **Navigation-level gating (Sidenav → MenuList)**
* Existing widget gating
* Updated architecture picture

This version replaces your existing doc.

---

# 🌟 Frontend Entitlements – v2 (FT0 / FT1 Foundation)

This document describes how the SynchroFlow frontend loads, stores, and enforces **entitlements** across:

* **Routes**
* **Navigation (Sidenav + MenuList)**
* **Widgets**
* **General app behavior**

It now includes all work delivered in Issues #878 and #883.

---

# 1. EntitlementsProvider (Global Source of Truth)

The entire frontend tree is wrapped with:

```tsx
<EntitlementsProvider>
  <App />
</EntitlementsProvider>
```

This gives every component access to:

```ts
shopId: number | null;
modules: string[];
flags: string[];
isLoading: boolean;
error: string | null;

hasModule(moduleId: string): boolean;
hasFlag(flagId: string): boolean;

refresh(): void;
```

### 1.1 How data loads

`EntitlementsProvider` automatically calls:

```
GET /api/v1/entitlements/me
```

using the JWT from `AuthContext`.

### 1.2 When entitlements are refreshed

* After Shopify OAuth completes (`connect=success`)
* After IntegrationProvider detects initial sync
* Any time `.refresh()` is manually invoked

---

# 2. Route-Level Entitlement Gating (NEW — #883)

Routes live in `routes.tsx` and now support declarative entitlement metadata:

```ts
interface RouteConfig {
  ...
  requiredModuleId?: string;
  requiredFlagId?: string;
}
```

### Example (gated route):

```ts
{
  key: "analytics",
  route: "/analytics",
  component: <AnalyticsPage />,
  requiredModuleId: "analytics"
}
```

### 2.1 Runtime checks

Two helpers implement all gating logic:

```ts
isRouteEnabled(route, entitlements)
filterRoutesByEntitlements(allRoutes, entitlements)
```

Rules:

* If a route has **no entitlement metadata** → always enabled.
* If a route requires a module → `modules.includes(requiredModuleId)`.
* If a route requires a flag → `flags.includes(requiredFlagId)`.
* If both are specified → **both must match**.
* If entitlements are `null` → **conservative default: gated routes hidden**.

### 2.2 ProtectedRoute integration

`ProtectedRoute` now checks both authentication *and* entitlements.

If a user tries to access a gated route they don’t have permission for:

```tsx
return <Navigate to="/dashboard" replace />;
```

(Preventing deep-link access.)

### 2.3 Tests

`tests/unit/ui/components/ProtectedRoute.entitlements.test.tsx` verifies:

* Public routes accessible normally
* Unauthenticated users redirected to login
* Unauthorized users redirected to dashboard
* Entitled users allowed through

---

# 3. Navigation-Level Gating (MenuList + Sidenav)

The left navigation is dynamically filtered based on entitlements.

### 3.1 In SidenavContent

```ts
const allowedRoutes = filterRoutesByEntitlements(routes, { modules, flags });

<MenuList allowedRoutes={allowedRoutes} />
```

### 3.2 In MenuList

`allowedRoutes` contains a list of route URLs the user is allowed to access.

MenuList then:

* Removes nav items whose `url` is not allowed
* Removes entire groups whose children were filtered out
* Falls back to showing all items when `allowedRoutes` is undefined

### 3.3 Tests

`tests/unit/ui/layout/MenuList.entitlements.test.tsx` verifies:

* Items not allowed are hidden
* Ungated mode shows full menu
* Router context is properly mocked

---

# 4. Widget-Level Gating (UseWidgetRegistry)

Widgets can declare:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
requiresPaidPlan?: boolean;
```

### 4.1 Registry filtering

`useWidgetRegistry()` applies **all three layers**:

1. **Mode**     → survival / growth / architect
2. **Plan**     → free / premium / enterprise
3. **Entitlements** → has required module/flag

Final output → a clean list of allowed widgets.

### 4.2 Hidden widgets

If a widget requires:

* a module the shop does not have
* a flag not granted
* a paid plan beyond FT0

…it will not render.

### 4.3 Tests

`tests/unit/ui/components/widget-registry.test.tsx` validates:

* Free-plan hides premium widgets
* Premium-plan shows everything
* Priorities sort correctly
* Unsupported modes return empty arrays

---

# 5. Practical FT0 Behavior (User Experience)

### A Free-Tier user will see:

* Dashboard
* Orders
* Customers
* Products
* Basic widgets (cash flow, inventory, order metrics…)
* Echo Inbox (if left ungated)
* Account Settings

### They will **not** see (in FT0):

* Analytics
* Finances
* Any premium-only widgets
* Any route or nav item requiring modules not granted

Any attempt to access a gated URL → redirect to `/dashboard`.

---

# 6. Architecture Summary (NEW)

```
                ┌──────────────────────┐
                │   AuthProvider       │
                │  (JWT, login state)  │
                └──────────┬───────────┘
                           │
            calls /entitlements/me on login
                           │
                ┌──────────▼──────────┐
                │ EntitlementsProvider│
                │  modules[], flags[] │
                │  hasModule(), ...   │
                └──────────┬───────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
┌────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ ProtectedRoute │  │ SidenavContent   │  │ useWidgetRegistry     │
│ isRouteEnabled │  │ MenuList filters │  │ filter widgets        │
│ redirects if    │  │ by allowedRoutes│  │ by entitlements       │
│ gated/unauthz'd│  └──────────────────┘  └──────────────────────┘
└────────────────┘
```

Everything converges on **one single model**:

```
EntitlementSnapshot = { modules: string[], flags: string[] }
```

---

# 7. Completed Functionality

* Global entitlement loading + refresh
* Route metadata (`requiredModuleId`, `requiredFlagId`)
* Pure entitlement helpers
* ProtectedRoute gating
* Navigation gating (MenuList & Sidenav)
* Widget gating (registry + registry tests)
* All units tested & green

This completes **#883 – Entitlement Gating Across App**.

---