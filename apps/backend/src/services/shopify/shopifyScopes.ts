export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_fulfillments',
  'write_fulfillments',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
] as const;

export const SHOPIFY_REQUIRED_SCOPE_STRING =
  SHOPIFY_REQUIRED_SCOPES.join(',');

export function normalizeAndValidateShopifyGrantedScopes(
  rawScope: unknown
): string {
  if (typeof rawScope !== 'string' || !rawScope.trim()) {
    throw new Error('SHOPIFY_GRANTED_SCOPES_MISSING');
  }

  const grantedScopeSet = new Set(
  rawScope
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
);

// Shopify write grants imply their corresponding read capability.
// Persist the effective grant set so local scope state matches
// currentAppInstallation.accessScopes rather than only the compact
// token-response representation.
if (grantedScopeSet.has('write_inventory')) {
  grantedScopeSet.add('read_inventory');
}

if (grantedScopeSet.has('write_fulfillments')) {
  grantedScopeSet.add('read_fulfillments');
}

if (
  grantedScopeSet.has(
    'write_merchant_managed_fulfillment_orders'
  )
) {
  grantedScopeSet.add(
    'read_merchant_managed_fulfillment_orders'
  );
}

const grantedScopes =
  Array.from(grantedScopeSet).sort();

const missingScopes =
  SHOPIFY_REQUIRED_SCOPES.filter(
    (scope) => !grantedScopeSet.has(scope)
  );

  if (missingScopes.length > 0) {
    throw new Error(
      `SHOPIFY_REQUIRED_SCOPES_MISSING:${missingScopes.join(',')}`
    );
  }

  return grantedScopes.join(',');
}