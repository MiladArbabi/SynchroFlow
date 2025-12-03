# Widget Gating – v1 (FT0)

This document describes how the Free-Tier (FT0) entitlements and plan tiers govern the visibility of dashboard widgets.

---

## 1. What a Widget Can Declare

Each widget in the registry may specify:

```ts
requiresPaidPlan: boolean;
requiredModuleId?: string;
requiredFlagId?: string;
priority: 'critical' | 'high' | 'medium' | 'low';
Meaning:
Property	Behavior
requiresPaidPlan	Widget hidden for Free Tier regardless of entitlements
requiredModuleId	Widget shown only if shop has this module entitlement
requiredFlagId	Widget shown only if shop has this flag entitlement
priority	Used to sort widgets for Survival Mode dashboards

2. How Filtering Works (The Pipeline)
When the dashboard requests widgets, the following steps occur:

Step 1 — Determine user config
From DashboardStateContext and AuthContext:

ts
Copy code
{
  detected_mode: 'survival',
  plan: 'free' | 'premium' | ...
}
Step 2 — Fetch entitlements
From useEntitlements():

ts
Copy code
modules: ['core_dashboard', ...]
flags: ['view_basic_sales', ...]
Step 3 — Apply filtering
useWidgetRegistry() calls:

ts
Copy code
getWidgetsForUser(userConfig, { hasModule, hasFlag });
Which performs:

A) Plan filtering
ts
Copy code
if (requiresPaidPlan && plan === 'free') → hide widget
B) Entitlement filtering
ts
Copy code
if (requiredModuleId && !hasModule(requiredModuleId)) → hide widget
if (requiredFlagId && !hasFlag(requiredFlagId)) → hide widget
C) Priority sorting (survival mode only)
Critical → High → Medium → Low

Only the filtered & sorted widgets reach the UI.

3. Free Tier vs Premium Behavior
Free Tier
Visible:

Cash Flow

Inventory Alerts

Order Metrics

Top Products

Sales By Traffic Source

Hidden:

Advanced Analytics

Any future widget requiring:

premium modules

premium flags

heavy compute access

Premium Tier
Receives everything Free Tier does, plus:

Advanced Analytics (because it requires a module)

Any widget gated behind premium flags

4. Adding A New Widget (Checklist)
Add widget entry to WIDGET_REGISTRY.

Add:

ts
Copy code
requiresPaidPlan: boolean
requiredModuleId?: string
requiredFlagId?: string
If it’s premium-only:

Add to module entitlement list

Add to plan gating logic (optional)

Write a test in:

swift
Copy code
tests/unit/ui/components/widget-registry.test.tsx
for:

free → hidden

premium + entitlement → visible

5. Tests Covering Gating Logic
Located in:

swift
Copy code
tests/unit/ui/components/widget-registry.test.tsx
They verify:

Free Tier hides paid widgets

Premium shows them

Entitlement-based requiredModuleId works

Entitlement-based requiredFlagId works

Mode priority sorting remains correct

Summary
Widget gating is now deterministic and handled entirely by:

EntitlementsProvider

useEntitlements

useWidgetRegistry

WIDGET_REGISTRY metadata

This ensures your dashboard always reflects what a shop is actually entitled to, not what the UI “hopes” the plan is.