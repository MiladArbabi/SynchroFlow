# Developer Onboarding – Adding a New Entitlement (Module or Flag)

This guide walks you through the **exact steps** required to add a new entitlement to LaSyncro, from backend → frontend → UI.

This is a mandatory workflow to keep the entitlements contract consistent.

---

# 🧩 Step 1 — Add Entitlement to Backend Schema

Entitlements are stored in:

shop_module_entitlements

markdown
Copy code

Each row includes:

- `shop_id`
- `module_id`
- `flag_id`
- timestamps

To add a **new module** (recommended):

1. Pick a unique identifier:
order-insights
advanced-analytics
skuos_pro

sql
Copy code
2. Add it into:
EntitlementsService.grantDefaultFreeTierForShop

vbnet
Copy code
ONLY if it belongs to FT0.

If it's **paid-only**, DO NOT add it to FT0.

To add a **new flag**:

1. Choose a clean, namespaced identifier:
view_margins_panel
use_l4_predictions
show_skuos_cluster_heatmap

yaml
Copy code
2. Insert into entitlements for any shop that should have it.

Flags always follow the same storage path as modules.

---

# 🧠 Step 2 — Backend Entitlements Logic

If adding capabilities to Free Tier:

```ts
await db('shop_module_entitlements').insert({
shop_id,
module_id: 'advanced-analytics',
flag_id: null
});
Or flags:

ts
Copy code
await db('shop_module_entitlements').insert({
  shop_id,
  module_id: null,
  flag_id: 'view_margins_panel'
});
Do this in either:

EntitlementsService.grantDefaultFreeTierForShop
or

A plan upgrade service you create later.

🌐 Step 3 — Add to Entitlements API (Optional)
GET /api/v1/entitlements/me requires no change unless you add additional fields.
Modules and flags automatically flow through.

🖥️ Step 4 — Add Frontend Gating
Widgets or features can declare:

ts
Copy code
requiredModuleId?: string;
requiredFlagId?: string;
This ensures:

The widget or component is hidden unless the shop has the entitlement.

No ad-hoc checks scattered around the UI.

Example widget gating:

ts
Copy code
{
  id: 'advanced-analytics',
  component: AdvancedAnalyticsWidget,
  requiresPaidPlan: true,
  requiredModuleId: 'advanced-analytics'
}
Example feature gating:

ts
Copy code
if (!hasFlag('view_margins_panel')) return null;
📦 Step 5 — Add Tests
Unit test locations:

Backend:

swift
Copy code
tests/unit/api/entitlements/
Frontend:

swift
Copy code
tests/unit/ui/components/widget-registry.test.tsx
Test both:

Without entitlement → hidden
With entitlement → visible
🚀 Step 6 — Release
Update any docs in this folder.

Run full test suite.

Use ./ship.sh with the issue number.

Create a migration plan if adding a new required entitlement.

✔️ Summary
To add a new entitlement:

Add to backend entitlements data.

Add grant logic (FT0 or paid plan).

UI gating with requiredModuleId / requiredFlagId.

Write tests for both visible + hidden states.

Update documentation.

Follow these steps every time — the entitlements system is a contract, not a suggestion.