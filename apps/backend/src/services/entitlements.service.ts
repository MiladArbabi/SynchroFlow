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

// ─────────────────────────────────────────────
// Commercial Grant Contract (SEALED v1.0)
// ─────────────────────────────────────────────

export interface CommercialGrantEvent {
  shopId: number;

  source: 'billing' | 'admin' | 'migration';

  grants: {
    modules?: string[];
    flags?: string[];
  };

  metadata?: {
    externalRef?: string;
    issuedAt?: string;
  };
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
      .andWhere('valid_from', '<=', db.fn.now())
      .andWhere((qb) =>
        qb.whereNull('valid_until').orWhere('valid_until', '>', db.fn.now())
      )
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

    /**
   * Grant the FT2-Free baseline entitlements for a given shop.
   *
   * FT2-Free rules:
   * - Observability-only access
   * - No paid / premium flags
   * - Idempotent and additive
   *
   * IMPORTANT:
   * - Must NOT revoke existing entitlements
   * - Must NOT infer lifecycle
   * - Must NOT grant pricing flags
   */
  static async grantFt2FreeBaselineForShop(shopId: number): Promise<void> {
    const rows: Array<{
      shop_id: number;
      module_key: string;
      flag_key: string | null;
      source: string;
    }> = [
      { shop_id: shopId, module_key: 'order-nexus', flag_key: null, source: 'ft2_free_baseline' },
      { shop_id: shopId, module_key: 'products', flag_key: null, source: 'ft2_free_baseline' },
      { shop_id: shopId, module_key: 'customers', flag_key: null, source: 'ft2_free_baseline' },
      { shop_id: shopId, module_key: 'analytics', flag_key: null, source: 'ft2_free_baseline' },
      { shop_id: shopId, module_key: 'finances', flag_key: null, source: 'ft2_free_baseline' },
    ];

    await db('shop_module_entitlements')
      .insert(rows)
      .onConflict(['shop_id', 'module_key', 'flag_key'])
      .ignore();
  };

    /**
     * Apply entitlement rows (LOW-LEVEL).
     *
     * HARD RULES:
     * - No validation
     * - No business logic
     * - No lifecycle awareness
     * - No audit
     *
     * This is a mechanical persistence helper only.
     */
    static async applyEntitlementRows(
      trx: any,
      rows: Array<{
        shop_id: number;
        module_key: string;
        flag_key: string | null;
        source: string;
        valid_from?: Date;
        valid_until?: Date | null;
      }>
    ): Promise<void> {

        if (!rows || rows.length === 0) return;

        await trx('shop_module_entitlements')
          .insert(
            rows.map((r) => ({
              ...r,
              valid_from: r.valid_from ?? trx.fn.now(),
              valid_until: r.valid_until ?? null,
            }))
          )
          .onConflict(['shop_id', 'module_key', 'flag_key'])
          .ignore();
      }
    }
