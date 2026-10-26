// apps/backend/src/services/entitlement-revocation.service.ts
//
// EntitlementRevocationService
// ----------------------------
// Explicitly revokes entitlements by closing their validity window.
//
// HARD RULES:
// - No deletes
// - No inserts
// - No lifecycle inference
// - No billing logic
// - UPDATE-only via valid_until

// STATUS: Production-sealed.
// Covered by temporal, idempotency, and non-destructive tests.
// Do not extend without adding failing tests first.
//
// ENT-REVOCATION-RLS-01: shop_module_entitlements has FORCE ROW LEVEL SECURITY
// and its write policy requires `shop_id = current_setting('app.current_tenant',
// true)::int`. A bare pooled `db.transaction` carries no tenant context, so the
// revoking UPDATE matched zero rows and downgrade revocation silently no-oped.
// The write now runs through the canonical `withTenant(shopId, …)` helper
// (SET LOCAL app.current_tenant = shopId), which the rest of the domain layer
// already uses for RLS-scoped writes. No RLS/policy/role change; still a single
// atomic transaction; still UPDATE-only via valid_until.

// apps/backend/src/services/entitlement-revocation.service.ts

import { withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

// Exact identities emitted by the existing tier/Shopify/trial writers.
// In particular, bare 'billing' is unresolved legacy authorization, not plan ownership.
const PLAN_MATERIALIZATION_SOURCES = [
  'tier:starter', 'tier:core', 'tier:growth', 'tier:scale',
  'shopify_billing:starter', 'shopify_billing:core', 'shopify_billing:growth', 'shopify_billing:scale',
  'trial_expiry:downgrade_to_starter',
];

export class EntitlementRevocationService {
  static async revokeEntitlements(params: {
    shopId: number;
    scope: {
      modules?: string[];
      flags?: string[];
    };
    revokedAt?: Date;
    reason?: string;
    /** Exact historical writer identities, supplied only by plan transitions. */
    planOnly?: boolean;
  }, trx?: Knex): Promise<void> {
    const { shopId, scope, revokedAt } = params;
    const { modules, flags } = scope;

    if (!shopId) {
      throw new Error('[EntitlementRevocation] shopId is required');
    }

    if (
      (!modules || modules.length === 0) &&
      (!flags || flags.length === 0)
    ) {
      throw new Error('[EntitlementRevocation] nothing to revoke');
    }

    const effectiveRevokedAt = revokedAt ?? new Date();

    const revoke = async (trx: Knex) => {
      const targets = () => {
        const query = trx('shop_module_entitlements').where({ shop_id: shopId });
        if (params.planOnly) {
          // Do not infer plan ownership from a prefix or close future grants.
          query.whereIn('source', PLAN_MATERIALIZATION_SOURCES).where('valid_from', '<=', effectiveRevokedAt)
            .andWhere(qb => qb.whereNull('valid_until').orWhere('valid_until', '>', effectiveRevokedAt));
        } else query.whereNull('valid_until');
        return query;
      };
      if (modules && modules.length > 0) {
        await targets()
          .whereIn('module_key', modules)
          .update({ valid_until: effectiveRevokedAt });
      }

      if (flags && flags.length > 0) {
        await targets()
          .whereIn('flag_key', flags)
          .update({ valid_until: effectiveRevokedAt });
      }
    };
    if (trx) await revoke(trx);
    else await withTenant(shopId, revoke);
  }
}
