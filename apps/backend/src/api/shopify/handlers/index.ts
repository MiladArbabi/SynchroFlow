// apps/backend/src/api/shopify/handlers/index.ts
//
// Shopify Webhook Handlers Index
//
// RESPONSIBILITIES:
// - Centralize handler exports
// - Provide explicit mapping surface for router
//
// MUST NOT:
// - Contain routing logic
// - Contain side effects

export { onShopifyAppUninstalled } from './appUninstalled.handler';

export * from './handleAppUninstalled';
export * from './handleOrderFulfillment';
export * from './handleRefundCreated'
export * from './handleOrderCreated'

