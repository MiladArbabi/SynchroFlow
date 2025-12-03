"use strict";
// apps/backend/src/services/entitlements.service.ts
/* EntitlementsService
 *
 * Thin service around shop_module_entitlements to:
 *  - read a normalized snapshot of modules + flags for a user
 *  - grant a default FT0 bundle for a given shop
 *
 * NOTE: This is intentionally simple; real "plans" / SKUs can layer on top later.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntitlementsService = void 0;
const db_1 = __importDefault(require("../db"));
class EntitlementsService {
    /**
     * Resolve entitlements for a given user ID.
     *  - Look up user's shop_id
     *  - Load all rows from shop_module_entitlements for that shop
     *  - Return a normalized snapshot (unique modules + flags)
     */
    static async getForUser(userId) {
        // 1) Find the user and their shop
        const user = await (0, db_1.default)('users')
            .where({ id: userId })
            .first();
        if (!user || !user.shop_id) {
            return null;
        }
        const shopId = user.shop_id;
        // 2) Load all entitlements for this shop
        const rows = await (0, db_1.default)('shop_module_entitlements')
            .where({ shop_id: shopId })
            .select('module_key', 'flag_key');
        if (!rows || rows.length === 0) {
            return {
                shopId,
                modules: [],
                flags: [],
            };
        }
        // 3) Normalize into unique module list + unique flag list (non-null)
        const moduleSet = new Set();
        const flagSet = new Set();
        for (const row of rows) {
            if (row.module_key) {
                moduleSet.add(row.module_key);
            }
            if (row.flag_key) {
                flagSet.add(row.flag_key);
            }
        }
        return {
            shopId,
            modules: Array.from(moduleSet),
            flags: Array.from(flagSet),
        };
    }
    /**
     * Grant the default FT0 entitlements for a given shop.
     *
     * - Inserts a small, opinionated bundle of module/flag rows.
     * - Uses ON CONFLICT(shop_id, module_key, flag_key) DO NOTHING
     *   so that re-running is idempotent.
     */
    static async grantDefaultFreeTierForShop(shopId) {
        // Core FT0 bundle – kept small and explicit on purpose.
        const baseRows = [
            // Core dashboard
            {
                shop_id: shopId,
                module_key: 'core_dashboard',
                flag_key: null,
                source: 'free_tier_default',
            },
            {
                shop_id: shopId,
                module_key: 'core_dashboard',
                flag_key: 'view_basic_sales',
                source: 'free_tier_default',
            },
            {
                shop_id: shopId,
                module_key: 'core_dashboard',
                flag_key: 'view_recent_orders_widget',
                source: 'free_tier_default',
            },
            // Shopify integration (sync only, no advanced analytics)
            {
                shop_id: shopId,
                module_key: 'shopify_integration',
                flag_key: null,
                source: 'free_tier_default',
            },
            {
                shop_id: shopId,
                module_key: 'shopify_integration',
                flag_key: 'use_shopify_sync',
                source: 'free_tier_default',
            },
            // Specter SDK – free tier embed
            {
                shop_id: shopId,
                module_key: 'specter_sdk_free',
                flag_key: null,
                source: 'free_tier_default',
            },
        ];
        await (0, db_1.default)('shop_module_entitlements')
            .insert(baseRows)
            .onConflict(['shop_id', 'module_key', 'flag_key'])
            .ignore();
    }
}
exports.EntitlementsService = EntitlementsService;
//# sourceMappingURL=entitlements.service.js.map