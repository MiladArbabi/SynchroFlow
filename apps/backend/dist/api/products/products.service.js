"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProducts = void 0;
// apps/backend/src/api/products/products.service.ts
const db_1 = __importDefault(require("../../db"));
const getProducts = async (page = 1, limit = 20, search) => {
    const shopId = 1; // TODO: Get from authenticated user/session
    // Build query with search
    let query = (0, db_1.default)('shopify_products')
        .where('shop_id', shopId);
    // Add search functionality
    if (search) {
        query = query.andWhere(function () {
            this.where('title', 'ilike', `%${search}%`)
                .orWhere('vendor', 'ilike', `%${search}%`)
                .orWhere('product_type', 'ilike', `%${search}%`);
        });
    }
    // Get total count for pagination
    const totalResult = await query.clone().count('* as count').first();
    const total = parseInt(totalResult?.count) || 0;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    // Get paginated results
    const products = await query
        .select('*')
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
    return {
        products,
        pagination: {
            page,
            limit,
            total,
            totalPages
        }
    };
};
exports.getProducts = getProducts;
//# sourceMappingURL=products.service.js.map