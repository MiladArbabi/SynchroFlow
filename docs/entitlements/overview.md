# LaSyncro Entitlements – Overview (v1, FT0-ready)

This document defines the v1 entitlements model used for Free Tier (FT0) gating.

## 1. Purpose

Entitlements ensure that:
- Free-tier Shopify installs receive the correct default permissions.
- The dashboard shows only widgets and features the shop is entitled to.
- Paid plans and future modules can be unlocked via entitlements instead of scattered logic.

Entitlements are granted at the **shop level**, not the user level.

---

## 2. Core Concepts

### Modules
Atomic capability bundles unlockable for a shop.

Example FT0 modules:
- `core_dashboard`
- `shopify_integration`
- `specter_sdk_free`

### Flags
Fine-grained feature toggles for specific UI elements.

Example FT0 flags:
- `view_basic_sales`
- `view_recent_orders_widget`
- `use_shopify_sync`

### Entitlements Snapshot
Returned to frontend via:

GET /api/v1/entitlements/me

yaml
Copy code

Shape:

```ts
{
  shopId: number | null;
  modules: string[];
  flags: string[];
}
3. Where Entitlements Are Used
Backend:
Granted automatically during Shopify OAuth callback.

Stored in shop_module_entitlements.

Fully covered by integration.controller.test.ts.

Frontend:
Loaded via EntitlementsProvider.

Exposed via useEntitlements() hook.

Used by useWidgetRegistry() to allow/deny widgets.

4. Current Free Tier Bundle (FT0)
Automatically granted on Shopify connect:

Modules:

core_dashboard

shopify_integration

specter_sdk_free

Flags:

view_basic_sales

view_recent_orders_widget

use_shopify_sync