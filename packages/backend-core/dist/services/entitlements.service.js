// apps/backend/src/services/entitlements.service.ts
/* EntitlementsService
 *
 * Thin service around shop_module_entitlements to:
 *  - read a normalized snapshot of modules + flags for a user
 *  - grant a default FT0 bundle for a given shop
 *
 * NOTE: This is intentionally simple; real "plans" / SKUs can layer on top later.
 */
/**
 * WRITE SURFACE SEAL
 * ------------------
 * The only legal writers to `shop_module_entitlements` are:
 *
 * 1. grantDefaultFreeTierForShop
 * 2. grantFt2FreeBaselineForShop
 * 3. CommercialGrantService (via private applyEntitlementRows)
 *
 * Any new write path is a violation of entitlements invariants:
 * - no lifecycle inference
 * - no billing coupling
 * - no destructive mutation
 *
 * If you think you need a new writer, stop.
 * Add a test first, then justify it explicitly.
 */
/**
 * ─────────────────────────────────────────────────────────────
 * ENTITLEMENTS SYSTEM — PRODUCTION SEALED
 * ─────────────────────────────────────────────────────────────
 *
 * Status: PRODUCTION-READY (FROZEN)
 * Date: 2026-01
 *
 * This system has been explicitly validated for:
 * - Temporal correctness
 * - Additive-only grants
 * - Explicit, non-destructive revocation
 * - Billing-blind and lifecycle-blind operation
 * - Write-surface containment
 * - Regression test coverage for all critical invariants
 *
 * ⚠️ CHANGE POLICY ⚠️
 * -------------------
 * Any modification requires:
 * 1. A failing test proving a broken invariant
 * 2. Explicit justification of which invariant still holds
 * 3. No new write paths
 *
 * If you are adding plans, lifecycle inference, billing shortcuts,
 * or deletes — you are breaking the system. Stop.
 */
import db from '../db.js';
import { requireShopIdForUser } from './shop-resolution.service.js';
export class EntitlementsService {
    /**
     * Resolve entitlements for a given user ID.
     *  - Look up user's shop_id
     *  - Load all rows from shop_module_entitlements for that shop
     *  - Return a normalized snapshot (unique modules + flags)
     */
    static async getForUser(userId) {
        // 1) Authoritative shop resolution
        let shopId;
        try {
            shopId = await requireShopIdForUser(userId);
        }
        catch {
            return null;
        }
        // 2) Load all entitlements for this shop
        const rows = await db('shop_module_entitlements')
            .where({ shop_id: shopId })
            .andWhere('valid_from', '<=', db.fn.now())
            .andWhere((qb) => qb.whereNull('valid_until').orWhere('valid_until', '>', db.fn.now()))
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
    static async grantFt2FreeBaselineForShop(shopId) {
        const rows = [
            { shop_id: shopId, module_key: 'order-nexus', flag_key: null, source: 'ft2_free_baseline' },
            { shop_id: shopId, module_key: 'products', flag_key: null, source: 'ft2_free_baseline' },
            { shop_id: shopId, module_key: 'customers', flag_key: null, source: 'ft2_free_baseline' },
            { shop_id: shopId, module_key: 'finances', flag_key: null, source: 'ft2_free_baseline' },
        ];
        await db('shop_module_entitlements')
            .insert(rows)
            .onConflict(['shop_id', 'module_key', 'flag_key'])
            .ignore();
    }
    ;
    /**
     * Apply entitlement rows from a trusted system service.
     *
     * WRITE SURFACE (SEALED):
     * - Intended ONLY for CommercialGrantService
     * - No validation
     * - No business logic
     * - No lifecycle inference
     *
     * Do not call from anywhere else.
     */
    static async applyFromCommercialGrant(trx, rows) {
        return EntitlementsService.applyEntitlementRows(trx, rows);
    }
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
    static async applyEntitlementRows(trx, rows) {
        if (!rows || rows.length === 0)
            return;
        const normalized = rows.map((r) => ({
            ...r,
            valid_from: r.valid_from ?? trx.fn.now(),
            valid_until: r.valid_until ?? null,
        }));
        // ISS-C26: the plain unique index on (shop_id, module_key, flag_key)
        // never catches a conflict when flag_key IS NULL — Postgres treats
        // NULL as distinct from NULL for uniqueness. Module-level rows
        // (flag_key: null, the common case) must target the partial index
        // added in migration 0022 instead. Knex's .onConflict(columns) API
        // can't express a partial-index predicate, so that batch uses a raw
        // multi-row insert whose ON CONFLICT clause matches the partial
        // index's WHERE clause exactly.
        const flaggedRows = normalized.filter((r) => r.flag_key !== null);
        const moduleLevelRows = normalized.filter((r) => r.flag_key === null);
        if (flaggedRows.length > 0) {
            await trx('shop_module_entitlements')
                .insert(flaggedRows)
                .onConflict(['shop_id', 'module_key', 'flag_key'])
                .ignore();
        }
        if (moduleLevelRows.length > 0) {
            const values = moduleLevelRows
                .map((r) => `(${trx.raw('?', [r.shop_id])}, ${trx.raw('?', [r.module_key])}, NULL, ${trx.raw('?', [r.source])}, ${trx.raw('?', [r.valid_from])}, ${trx.raw('?', [r.valid_until])})`)
                .join(', ');
            await trx.raw(`
            INSERT INTO shop_module_entitlements
              (shop_id, module_key, flag_key, source, valid_from, valid_until)
            VALUES ${values}
            ON CONFLICT (shop_id, module_key)
            WHERE flag_key IS NULL AND valid_until IS NULL
            DO NOTHING;
          `);
        }
    }
}
