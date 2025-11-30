"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performSmartSync = void 0;
// packages/api/src/services/shopify-sync-orchestrator.service.ts
const shopify_service_1 = require("./shopify.service");
const shopify_fallback_service_1 = require("./shopify-fallback.service");
const performSmartSync = async (accessToken, platformShopName, shopId, integrationId) => {
    try {
        console.log(`[ShopifySyncOrchestrator] Attempting full sync for shopId: ${shopId}`);
        await (0, shopify_service_1.performInitialSync)(accessToken, platformShopName, shopId, integrationId);
    }
    catch (error) {
        if (error.message.includes('not approved to access the Order object') ||
            error.message.includes('Protected Customer Data')) {
            console.log(`[ShopifySyncOrchestrator] PCD access denied, falling back to non-PCD sync for shopId: ${shopId}`);
            await (0, shopify_fallback_service_1.performNonPCDSync)(accessToken, platformShopName, shopId, integrationId);
        }
        else {
            throw error;
        }
    }
};
exports.performSmartSync = performSmartSync;
