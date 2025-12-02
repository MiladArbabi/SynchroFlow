"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProductCost = exports.upsertProductCost = exports.getProductCost = void 0;
//packages/api/src/api/product-costs/product-costs.service.ts
const db_1 = __importDefault(require("../../db"));
const getProductCost = async (platformProductId) => {
    const cost = await (0, db_1.default)('product_costs')
        .where({ platform_product_id: platformProductId })
        .first();
    if (cost) {
        // Parse decimal fields to numbers
        return {
            ...cost,
            purchase_price: cost.purchase_price ? parseFloat(cost.purchase_price) : null,
            landed_cost_per_unit: cost.landed_cost_per_unit ? parseFloat(cost.landed_cost_per_unit) : null,
            shipping_cost: cost.shipping_cost ? parseFloat(cost.shipping_cost) : null,
            customs_duties: cost.customs_duties ? parseFloat(cost.customs_duties) : null,
            packaging_cost: cost.packaging_cost ? parseFloat(cost.packaging_cost) : null,
            selling_price: cost.selling_price ? parseFloat(cost.selling_price) : null,
        };
    }
    return null;
};
exports.getProductCost = getProductCost;
const upsertProductCost = async (platformProductId, purchasePrice, landedCostPerUnit) => {
    const now = new Date().toISOString();
    const [cost] = await (0, db_1.default)('product_costs')
        .insert({
        platform_product_id: platformProductId,
        purchase_price: purchasePrice,
        landed_cost_per_unit: landedCostPerUnit,
        created_at: now,
        updated_at: now
    })
        .onConflict('platform_product_id')
        .merge({
        purchase_price: purchasePrice,
        landed_cost_per_unit: landedCostPerUnit,
        updated_at: now
    })
        .returning('*');
    return cost;
};
exports.upsertProductCost = upsertProductCost;
const deleteProductCost = async (platformProductId) => {
    const result = await (0, db_1.default)('product_costs')
        .where('platform_product_id', platformProductId)
        .delete();
    return result > 0;
};
exports.deleteProductCost = deleteProductCost;
//# sourceMappingURL=product-costs.service.js.map