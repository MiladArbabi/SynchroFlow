# 🚀 Entitlements Onboarding Guide – v2 (Developer Playbook)

This guide teaches you **exactly how to introduce new entitlements** — modules, flags, routes, widgets — into SynchroFlow.

It reflects the final, stable architecture delivered in:

* #878 — OAuth + FT0 module grant
* #818 — Entitlement service
* #883 — Route/nav gating
* Final widget gating pipeline

---

# 1. Mental Model: One Source of Truth

All access control flows from one structure:

```ts
EntitlementSnapshot = {
  modules: string[],
  flags: string[],
}
```

The **backend** grants entitlements.
The **frontend** consumes entitlements to:

* Show/hide navigation
* Allow/deny routes
* Show/hide widgets
* Unlock premium UX

**You never enforce entitlements inside individual components.**
They declare their requirements; the entitlement engine does the rest.

---

# 2. Adding a New MODULE (Backend → Frontend)

A **module** unlocks major capabilities such as analytics, finances, SKU intelligence, etc.

### Step 1 — Add the module to backend constants

Location:

```
apps/backend/src/services/entitlements.service.ts
```

Modify:

```ts
export const DEFAULT_FREE_TIER_MODULES = [...];

export type KnownModules =
  | "core-dashboard"
  | "core-orders"
  | "core-products"
  | "core-customers"
  | "analytics"
  | "finances"
  | "sku-os"
  | "echo-hub"
  | "advanced-analytics"; // <-- Add here
```

### Step 2 — Add upgrade logic (optional)

If module is purchased programmatically:

```ts
await EntitlementsService.grantModule(shopId, "advanced-analytics");
```

### Step 3 — Add module-row insertion on upgrade

In future billing hooks:

```
INSERT INTO shop_module_entitlements (shop_id, module_id)
```

### Step 4 — Add the module to frontend routing (optional)

In `routes.tsx`:

```ts
{
  key: "analytics",
  route: "/analytics",
  component: <AnalyticsPage />,
  requiredModuleId: "analytics",
}
```

### Step 5 — Add module gating to widgets (if applicable)

In widget registry:

```ts
{
  id: "advanced-analytics",
  component: AdvancedAnalyticsWidget,
  requiredModuleId: "advanced-analytics"
}
```

### Step 6 — Add tests

Backend:

```
tests/unit/services/entitlements.service.test.ts
```

Frontend:

```
tests/unit/ui/components/ProtectedRoute.entitlements.test.tsx
tests/unit/ui/layout/MenuList.entitlements.test.tsx
tests/unit/ui/components/widget-registry.test.tsx
```

---

# 3. Adding a New FLAG (Feature-level Rollout)

Flags control smaller feature rollouts (beta features, experiments).

### Step 1 — Add flag identifier

No backend enum required — flags are strings.

Just document them:

```
advanced-returns
beta-reorder-predictions
marketing-experiments
```

### Step 2 — Add flag gating to component/route/widget

Example widget:

```ts
{
  id: "reorder-predictions",
  requiredFlagId: "beta-reorder-predictions"
}
```

Example route:

```ts
{
  route: "/inventory/forecast",
  requiredFlagId: "beta-reorder-predictions"
}
```

### Step 3 — Grant the flag to a shop (backend)

```
INSERT INTO entitlement_flags (shop_id, flag_id)
VALUES (123, 'beta-reorder-predictions');
```

### Step 4 — Tests

Ensure gating works as expected:

```
widget-registry.test.tsx
ProtectedRoute.entitlements.test.tsx
```

---

# 4. Adding a New GATED ROUTE

Routes live in:

```
apps/frontend/src/routes.tsx
```

### Step 1 — Add metadata:

```ts
{
  key: "finances",
  route: "/finances",
  component: <FinancesPage />,
  requiredModuleId: "finances",
}
```

### Step 2 — Navigation automatically respects this

`SidenavContent → MenuList` filters routes using:

```
filterRoutesByEntitlements()
```

### Step 3 — Route protection automatically enforced

Because `ProtectedRoute` checks:

```
isRouteEnabled(route, entitlements)
```

No extra code required.

---

# 5. Adding a New GATED WIDGET

All widgets are declared in:

```
apps/frontend/src/components/widgets/widget-registry.tsx
```

### Step 1 — Add the widget entry:

```ts
{
  id: "profit-forecast",
  title: "Profit Forecasting",
  component: ProfitForecastWidget,
  intelligenceLevel: "L2",
  priority: "high",
  currentValue: 0,
  format: "currency",
  isLoading: false,
  isEmpty: false,
  businessContext: {...},
  metricConfig: {...},

  requiresPaidPlan: true,
  requiredModuleId: "finances",     // Module-based gating
  requiredFlagId: "beta-profits"    // Optional fine-grain gating
}
```

### Step 2 — Nothing else required

Widget gating happens automatically in:

```
useWidgetRegistry()
```

### Step 3 — Add tests

```
widget-registry.test.tsx
```

---

# 6. Updating FT0 Entitlements

FT0 grants are defined in:

`EntitlementsService.grantDefaultFreeTierForShop()`

To change what a free store gets:

Modify:

```ts
DEFAULT_FREE_TIER_MODULES
```

### Common adjustments:

* Add support for SKU OS (future)
* Remove modules from free tier
* Add promotional temporary flags

All UI will update automatically.

---

# 7. Debugging Entitlements

Run:

```
GET /api/v1/entitlements/me
```

Verify:

* Correct modules
* Correct flags
* Correct shopId

In the frontend, log output:

```ts
console.log(useEntitlements());
```

If gating is incorrect:

* Route not appearing → check `requiredModuleId`
* Widget not appearing → check widget registry entry
* Navigation missing item → check `allowedRoutes`

Most errors stem from:

* Typos in module/flag identifiers
* Module granted to wrong shopId
* Route key not matching route path

---

# 8. Common Patterns

### Pattern: Soft-launch a feature via flag

```ts
requiredFlagId: "beta-new-feature"
```

Allows per-shop rollout without affecting paid plans.

---

### Pattern: Multi-level gating

A feature that requires both a paid plan AND a module:

```ts
requiresPaidPlan: true
requiredModuleId: "finances"
```

---

### Pattern: Mode-specific widget availability

Handled in registry by grouping widgets under:

```
survival / growth / architect
```

Widgets outside the detected mode are automatically excluded.

---

# 9. Full Capability Pipeline (Updated Diagram)

```
         ┌───────────────────────┐
         │ shop_module_entitlements
         │ entitlement_flags
         └────────────┬──────────┘
                      ▼
         ┌──────────────────────────┐
         │ EntitlementsService      │
         │ getForUser()             │
         └────────────┬─────────────┘
                      ▼
         ┌──────────────────────────┐
         │ /api/v1/entitlements/me │
         └────────────┬─────────────┘
                      ▼
         ┌──────────────────────────┐
         │ EntitlementsProvider     │
         │ {modules, flags}         │
         └──────┬────────┬─────────┘
                │        │
                ▼        ▼
      ┌────────────┐   ┌──────────────────┐
      │ Protected   │   │ useWidgetRegistry│
      │ Route       │   │ widget gating    │
      └────────────┘   └──────────────────┘
                │
                ▼
        ┌──────────────────┐
        │ Sidenav/MenuList │
        │ route filtering  │
        └──────────────────┘
```

---

# 10. Summary

Adding new capabilities is now:

* Simple
* Declarative
* Consistent across UI layers
* Backed by tests
* Safe for FT0 and premium users
* Future-proof for new modules and flags

The entitlement framework is complete, stable, and ready for long-term evolution.

---
