"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/api/shopify/shopify.routes.ts
const express_1 = require("express");
const shopify_app_service_1 = require("../../services/shopify-app.service");
const router = (0, express_1.Router)();
/**
 * Shopify "app/uninstalled" webhook.
 *
 * In dev we:
 * - Trust Shopify to call this endpoint (we're behind ngrok)
 * - Use the `X-Shopify-Shop-Domain` header as the key
 * - Mark the app as uninstalled in our DB
 */
router.post('/webhooks/app-uninstalled', async (req, res) => {
    const shopDomain = req.headers['x-shopify-shop-domain'];
    if (!shopDomain) {
        console.warn('[ShopifyWebhook] app/uninstalled received with no X-Shopify-Shop-Domain header');
        // Still return 200 so Shopify doesn’t retry forever
        return res.status(200).send('ok');
    }
    console.log(`[ShopifyWebhook] app/uninstalled received for shop: ${shopDomain}`);
    try {
        await shopify_app_service_1.ShopifyAppService.markAppUninstalled(shopDomain);
        console.log(`[ShopifyWebhook] Marked app as uninstalled for ${shopDomain}`);
    }
    catch (err) {
        console.error('[ShopifyWebhook] Failed to mark app as uninstalled:', err);
        // Don’t cause infinite retries in dev
    }
    return res.status(200).send('ok');
});
exports.default = router;
