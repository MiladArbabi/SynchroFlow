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

export { onShopifyAppUninstalled } from './appUninstalled.handler.js';

export * from './handleAppUninstalled.js';
export * from './handleOrderFulfillment.js';
export * from './handleRefundCreated.js'
export * from './handleOrderCreated.js'
export * from './handleOrderPaid.js'
export * from './handleProductCreated.js'
export * from './handleProductUpdated.js'

