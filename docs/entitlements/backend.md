# Backend Entitlements – v1 (FT0)

## 1. Grant Logic

Default FT0 entitlements are granted inside Shopify OAuth callback:

```ts
await EntitlementsService.grantDefaultFreeTierForShop(shopId);
This occurs after:

integration insert

user + milestone updates

but before:

sync job queued

post-installation setup

This ensures the frontend always receives entitlements immediately on redirect to:

arduino
Copy code
/dashboard?connect=success
2. EntitlementsService Contract
getForUser(userId)
Resolves shop_id from users table.

Loads all shop_module_entitlements rows.

Returns normalized snapshot (unique modules + flags).

Used by /api/v1/entitlements/me.

grantDefaultFreeTierForShop(shopId)
Inserts FT0 modules & flags.

Idempotent via ON CONFLICT DO NOTHING.

Unit test: entitlements.service.test.ts.

3. API
GET /api/v1/entitlements/me
Returns:

ts
Copy code
{
  shopId: number | null;
  modules: string[];
  flags: string[];
}
Unauthorized users → 401.

If no entitlements exist → { shopId: null, modules: [], flags: [] }.

Unit-tested in:

entitlements.controller.test.ts