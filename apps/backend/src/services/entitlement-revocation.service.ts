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

// apps/backend/src/services/entitlement-revocation.service.ts

import db from "api-src/db";

export class EntitlementRevocationService {
  static async revokeEntitlements(params: {
    shopId: number;
    scope: {
      modules?: string[];
      flags?: string[];
    };
    revokedAt?: Date;
    reason?: string;
  }): Promise<void> {
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

    await db.transaction(async (trx) => {
      if (modules && modules.length > 0) {
        await trx('shop_module_entitlements')
          .where({ shop_id: shopId })
          .whereIn('module_key', modules)
          .whereNull('valid_until')
          .update({ valid_until: effectiveRevokedAt });
      }

      if (flags && flags.length > 0) {
        await trx('shop_module_entitlements')
          .where({ shop_id: shopId })
          .whereIn('flag_key', flags)
          .whereNull('valid_until')
          .update({ valid_until: effectiveRevokedAt });
      }
    });
  }
}