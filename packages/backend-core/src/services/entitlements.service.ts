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

import { withTenant } from '../db.js';
import { requireShopIdForUser } from './shop-resolution.service.js';
import { resolveEffectiveAccessForShop } from './effective-access.service.js';

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
   * Resolve the EFFECTIVE entitlements for a given user ID.
   *
   *   effective modules = modulesForTier(currentTier) ∪ effective persisted module rows
   *   effective flags   = flagsForTier(currentTier)   ∪ effective persisted flag rows
   *
   * COMMERCIAL-ACCESS-ARCH-01 P0-A2A: the snapshot now derives a canonical
   * tier floor from @lasyncro/commercial-policy. Zero persisted rows still
   * returns the tier's standard grants; persisted rows are additive only when
   * they represent an effective explicit grant or required internal plumbing;
   * expired rows are excluded by the existing temporal query; downgrade
   * continues to rely on the current tier plus temporal revocation. No
   * destructive mutation, no schema change, no backfill.
   */
  static async getForUser(userId: number): Promise<EntitlementsSnapshot | null> {
    // 1) Authoritative shop resolution
    let shopId: number;
    try {
      shopId = await requireShopIdForUser(userId);
    } catch {
      return null;
    }

    const effective = await resolveEffectiveAccessForShop(shopId);

    return {
      shopId,
      modules: Array.from(effective.modules),
      flags: Array.from(effective.flags),
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

    ];

    await withTenant(shopId, (trx) =>
      EntitlementsService.applyEntitlementRows(trx, baseRows)
    );
  }

  /**
   * Historical compatibility entry point for FT2-Free baseline entitlements.
   *
   * Standard plan access is owned by the canonical tier floor. This writer must
   * not materialize standard modules into persisted rows, because historical
   * rows are no longer allowed to widen effective access.
   */
  static async grantFt2FreeBaselineForShop(shopId: number): Promise<void> {
    const rows: Array<{
      shop_id: number;
      module_key: string;
      flag_key: string | null;
      source: string;
    }> = [];

    await withTenant(shopId, (trx) =>
      EntitlementsService.applyEntitlementRows(trx, rows)
    );
  }

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
  static async applyFromCommercialGrant(
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
    private static async applyEntitlementRows(
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
            .map(
              (r) =>
                `(${trx.raw('?', [r.shop_id])}, ${trx.raw('?', [r.module_key])}, NULL, ${trx.raw('?', [r.source])}, ${trx.raw('?', [r.valid_from])}, ${trx.raw('?', [r.valid_until])})`
            )
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
