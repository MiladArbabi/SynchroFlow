// apps/frontend/src/lib/appStoreUrl.ts
//
// COMPLIANCE (Shopify 2.3.1): single source of truth for the App Store
// listing URL. Undefined until the listing is approved and published —
// callers must render a non-functional notice instead of a link when this
// is undefined. Set VITE_SHOPIFY_APP_STORE_URL post-approval to go live.
export const SHOPIFY_APP_STORE_URL: string | undefined =
  import.meta.env.VITE_SHOPIFY_APP_STORE_URL || undefined;