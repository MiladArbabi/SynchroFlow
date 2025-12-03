"use strict";
// apps/backend/src/workers/product-worker.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processProductMessage = processProductMessage;
const db_1 = __importDefault(require("../db"));
const product_normalization_service_1 = require("../services/product-normalization.service");
const normalizer = new product_normalization_service_1.ProductNormalizationService();
async function processProductMessage(msg) {
    const { shopId, platform, rawProduct } = msg;
    if (platform !== 'shopify') {
        // FT0 only supports Shopify; silently ignore others for now
        return;
    }
    const canonicalInput = normalizer.normalizeShopifyProduct(rawProduct, shopId);
    // Upsert into canonical_products using identity (shop, platform, product, variant)
    await (0, db_1.default)('canonical_products')
        .insert({
        shop_id: canonicalInput.shopId,
        platform: canonicalInput.platform,
        platform_product_id: canonicalInput.platformProductId,
        platform_variant_id: canonicalInput.platformVariantId ?? null,
        sku: canonicalInput.sku ?? null,
        title: canonicalInput.title,
        status: canonicalInput.status ?? 'active',
        created_at: canonicalInput.createdAt,
        updated_at: canonicalInput.updatedAt,
    })
        .onConflict(['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'])
        .merge({
        sku: canonicalInput.sku ?? null,
        title: canonicalInput.title,
        status: canonicalInput.status ?? 'active',
        updated_at: canonicalInput.updatedAt,
    });
}
//# sourceMappingURL=product-worker.js.map