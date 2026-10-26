import { withTenant } from '../db.js';
import {
  flagsForTier,
  isEffectivePersistedGrant,
  isFeatureKey,
  isModuleId,
  isValidTier,
  modulesForTier,
} from '@lasyncro/commercial-policy';
import type { AccessContext, Tier } from '@lasyncro/commercial-policy';

const INDEPENDENT_AUTHORITY_KINDS = new Set(['admin', 'migration', 'internal']);
const LIVE_INTERNAL_FLAGS = new Set(['use_shopify_sync']);

export interface EffectiveAccessResolution {
  shopId: number;
  tier: Tier;
  modules: ReadonlySet<string>;
  flags: ReadonlySet<string>;
  context: AccessContext;
}

interface EffectiveTarget {
  target_kind: 'module' | 'flag';
  target_key: string;
}

/**
 * Canonical read-side commercial access resolution for one verified tenant.
 *
 * A REPEATABLE READ tenant transaction makes the subscription tier, durable
 * authorizations, and temporary legacy fallback one consistent snapshot. The
 * resolver is deliberately read-only and never reconstructs authority from a
 * legacy source string.
 */
export async function resolveEffectiveAccessForShop(
  shopId: number,
): Promise<EffectiveAccessResolution> {
  return withTenant(shopId, async (trx) => {
    const shop = await trx('shops').where({ id: shopId }).first('id');
    if (!shop) throw new Error('SHOP_CONTEXT_REQUIRED: effective access shop not found');

    const subscription = await trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier');
    const tier: Tier = isValidTier(subscription?.tier) ? subscription.tier : 'starter';

    const authorizations: EffectiveTarget[] = await trx('shop_authorizations')
      .where({ shop_id: shopId })
      .whereIn('authority_kind', Array.from(INDEPENDENT_AUTHORITY_KINDS))
      .whereNull('revoked_at')
      .andWhere('valid_from', '<=', trx.fn.now())
      .andWhere((qb) => qb.whereNull('valid_until').orWhere('valid_until', '>', trx.fn.now()))
      .select('target_kind', 'target_key');

    const legacyRows = await trx('shop_module_entitlements')
      .where({ shop_id: shopId })
      .andWhere('valid_from', '<=', trx.fn.now())
      .andWhere((qb) => qb.whereNull('valid_until').orWhere('valid_until', '>', trx.fn.now()))
      .select('module_key', 'flag_key', 'source');

    const modules = new Set<string>(modulesForTier(tier));
    const flags = new Set<string>(flagsForTier(tier));

    for (const authorization of authorizations) {
      if (authorization.target_kind === 'module' && isModuleId(authorization.target_key)) {
        modules.add(authorization.target_key);
      } else if (authorization.target_kind === 'flag' && isFeatureKey(authorization.target_key)) {
        flags.add(authorization.target_key);
      }
    }

    for (const row of legacyRows) {
      if (!isEffectivePersistedGrant({
        moduleKey: row.module_key,
        flagKey: row.flag_key,
        source: row.source,
      })) continue;
      if (row.module_key && isModuleId(row.module_key)) modules.add(row.module_key);
      if (row.flag_key && (isFeatureKey(row.flag_key) || LIVE_INTERNAL_FLAGS.has(row.flag_key))) {
        flags.add(row.flag_key);
      }
    }

    const context: AccessContext = { tier, modules, flags };
    return { shopId, tier, modules, flags, context };
  }, { isolationLevel: 'repeatable read', readOnly: true });
}
