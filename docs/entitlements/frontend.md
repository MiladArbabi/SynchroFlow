# Frontend Entitlements – v1 (FT0)

This document explains how the frontend loads, stores, and uses entitlements to enforce Free-Tier behavior across widgets and the dashboard.

---

## 1. EntitlementsProvider

`EntitlementsProvider` wraps the entire app (in `App.tsx`) so **all frontend code has access** to entitlement data:

```tsx
<EntitlementsProvider>
  <ThemeCustomization>
    <Routes>...</Routes>
  </ThemeCustomization>
</EntitlementsProvider>
What it does
Automatically fetches:

bash
Copy code
GET /api/v1/entitlements/me
Stores:

ts
Copy code
modules: string[];
flags: string[];
Exposes helpers:

ts
Copy code
const { hasModule, hasFlag } = useEntitlements();
When it updates
Automatically after Shopify connect (connect=success)

Automatically when IntegrationProvider detects sync state

Whenever any component calls:

ts
Copy code
refresh();
2. Widget Entitlements
Widgets can declare entitlement requirements:

ts
Copy code
requiredModuleId?: string;
requiredFlagId?: string;
Examples:

ts
Copy code
{
  id: 'advanced-analytics',
  requiresPaidPlan: true,
  requiredModuleId: 'advanced-analytics'
}
If the shop does not have these entitlements, the widget will not be displayed.

3. Gating Logic in useWidgetRegistry
useWidgetRegistry() applies three layers of filtering:

Mode (survival/growth/architect)

Plan (requiresPaidPlan)

Entitlements (requiredModuleId, requiredFlagId)

It calls:

ts
Copy code
getWidgetsForUser(userConfig, {
  hasModule,
  hasFlag
})
which removes any widgets the shop is not allowed to see.

4. UI Effects (FT0)
Free Tier Users See:
Cash Flow

Inventory Alerts

Order Metrics

Top Products

Sales By Traffic Source

Free Tier Users DO NOT See:
Advanced Analytics

Any widget requiring:

a premium module

an entitlement flag not included in FT0

heavy data processing workflows

5. Tests
Entitlement behavior is tested in:

tests/unit/ui/entitlements/EntitlementsContext.test.tsx

tests/unit/ui/components/widget-registry.test.tsx

The tests validate:

entitlement loading

entitlement-driven widget hiding

entitlement-driven widget display when allowed

Summary
Frontend entitlements are now:

globally available

predictable

reactively updated

tested

directly tied to widget visibility and premium feature gating

This completes the FT0 entitlement enforcement on the frontend.