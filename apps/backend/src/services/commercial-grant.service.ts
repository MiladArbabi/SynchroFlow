// apps/backend/src/services/commercial-grant.service.ts
//
// CommercialGrantService
// ----------------------
// Owns application of CommercialGrantEvent.
// Translates business intent → entitlement mutations.
//
// HARD RULES:
// - Additive only
// - Idempotent
// - Lifecycle-blind
// - Billing-agnostic
// - Audited
// - NO entitlement reads

import db from '../db';
import { EntitlementsService, CommercialGrantEvent } from './entitlements.service';
import {
  FT2_PAID_MODULES,
  FT2_PAID_FLAGS,
} from '../contracts/ft2-paid.contract';

export class CommercialGrantService {
  static async apply(event: CommercialGrantEvent): Promise<void> {
    const { shopId, source, grants, metadata } = event;

    if (!shopId) {
      throw new Error('[CommercialGrant] shopId is required');
    }

    if (
      (!grants.modules || grants.modules.length === 0) &&
      (!grants.flags || grants.flags.length === 0)
    ) {
      throw new Error('[CommercialGrant] empty grant payload');
    }

    type EntitlementInsertRow = {
      shop_id: number;
      module_key: string;
      flag_key: string | null;
      source: string;
      valid_from: Date;
      valid_until: Date | null;
    };

    const rows: EntitlementInsertRow[] = [];

    if (grants.modules) {
      for (const moduleKey of grants.modules) {
        rows.push({
          shop_id: shopId,
          module_key: moduleKey,
          flag_key: null,
          source,
          valid_from: metadata?.issuedAt
            ? new Date(metadata.issuedAt)
            : new Date(),
          valid_until: null,
        });
      }
    }

    if (grants.flags) {
      for (const flagKey of grants.flags) {
        rows.push({
          shop_id: shopId,
          module_key: flagKey.split('.')[0],
          flag_key: flagKey,
          source,
          valid_from: metadata?.issuedAt
            ? new Date(metadata.issuedAt)
            : new Date(),
          valid_until: null,
        });
      }
    }

    if (rows.length === 0) return;

    await db.transaction(async (trx) => {
      await trx('commercial_grant_events').insert({
        shop_id: shopId,
        source,
        grant_payload: grants,
        external_ref: metadata?.externalRef ?? null,
        metadata: metadata ?? null,
      });

      await EntitlementsService.applyEntitlementRows(trx, rows);
    });
  }

    /**
   * Apply FT2-Paid upgrade for a shop.
   *
   * HARD RULES:
   * - Additive only
   * - Idempotent
   * - Billing-agnostic
   * - Uses sealed FT2-Paid contract
   * - Emits exactly one CommercialGrantEvent
   */
  static async applyFt2PaidUpgrade(params: {
    shopId: number;
    source: 'billing' | 'admin' | 'migration';
    metadata?: {
      externalRef?: string;
      issuedAt?: string;
    };
  }): Promise<void> {
    const { shopId, source, metadata } = params;

    if (!shopId) {
      throw new Error('[FT2PaidUpgrade] shopId is required');
    }

    await CommercialGrantService.apply({
      shopId,
      source,
      grants: {
        modules: [...FT2_PAID_MODULES],
        flags: [...FT2_PAID_FLAGS],
      },
      metadata,
    });
  }
}