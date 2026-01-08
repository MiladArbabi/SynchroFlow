// apps/backend/src/services/entitlements.service.ts
/* EntitlementsService
 *
 * Thin service around shop_module_entitlements to:
 *  - read a normalized snapshot of modules + flags for a user
 *  - grant a default FT0 bundle for a given shop
 *
 * NOTE: This is intentionally simple; real "plans" / SKUs can layer on top later.
 */

import db from '../db';
import { requireShopIdForUser } from './shop-resolution.service';

export interface EntitlementsSnapshot {
  shopId: number;
  modules: string[];
  flags: string[];
}

export class EntitlementsService {
  /**
   * Resolve entitlements for a given user ID.
   *  - Look up user's shop_id
   *  - Load all rows from shop_module_entitlements for that shop
   *  - Return a normalized snapshot (unique modules + flags)
   */
  static async getForUser(userId: number): Promise<EntitlementsSnapshot | null> {
    // 1) Authoritative shop resolution
    let shopId: number;
    try {
      shopId = await requireShopIdForUser(userId);
    } catch {
      return null;
    }

    // 2) Load all entitlements for this shop
    const rows = await db('shop_module_entitlements')
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
    const moduleSet = new Set<string>();
    const flagSet = new Set<string>();

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
  static async grantDefaultFreeTierForShop(shopId: number): Promise<void> {
    // Core FT0 bundle – kept small and explicit on purpose.
    const baseRows: Array<{
      shop_id: number;
      module_key: string;
      flag_key: string | null;
      source: string;
    }> = [
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
      
      // Orders / Order Nexus – core operational module
      {
        shop_id: shopId,
        module_key: 'order-nexus',
        flag_key: null,
        source: 'free_tier_default',
      },
    ];

    await db('shop_module_entitlements')
      .insert(baseRows)
      .onConflict(['shop_id', 'module_key', 'flag_key'])
      .ignore();
  }
}
