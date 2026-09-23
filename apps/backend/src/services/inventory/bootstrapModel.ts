import type { Knex } from 'knex';

/**
 * SHOP BOOTSTRAP MODEL (GH-1145-A1)
 * ---------------------------------
 * shop_wms_settings.bootstrap_model (migration 0193) is the sole, immutable
 * classification of how a tenant's opening inventory was established:
 *
 *   legacy_opening_balance_v1        — tenants existing at migration time;
 *                                       Shopify opening_balance keeps its
 *                                       current physical semantics until A2.
 *   reconcile_opening_expectation_v2 — tenants provisioned afterwards;
 *                                       Shopify inventoryQuantity is an
 *                                       expectation only, never capacity.
 *
 * Never inferred from inventory rows, expectations or sync status.
 */
export const LEGACY_OPENING_BALANCE_V1 = 'legacy_opening_balance_v1' as const;
export const RECONCILE_OPENING_EXPECTATION_V2 =
  'reconcile_opening_expectation_v2' as const;

export type BootstrapModel =
  | typeof LEGACY_OPENING_BALANCE_V1
  | typeof RECONCILE_OPENING_EXPECTATION_V2;

export class UnresolvedBootstrapModelError extends Error {
  public readonly code = 'UNRESOLVED_BOOTSTRAP_MODEL' as const;
  public readonly shopId: number;

  constructor(shopId: number, received: unknown) {
    super(
      `[BOOTSTRAP_MODEL] Unresolved bootstrap_model for shop_id=${shopId} (got: ${JSON.stringify(
        received ?? null
      )}). Refusing to act on opening inventory without an explicit classification.`
    );
    this.name = 'UnresolvedBootstrapModelError';
    this.shopId = shopId;
    Object.setPrototypeOf(this, UnresolvedBootstrapModelError.prototype);
  }
}

/** Reads the shop's bootstrap model. Missing row or unknown value FAILS CLOSED. */
export async function resolveBootstrapModel(
  trx: Knex | Knex.Transaction,
  shopId: number
): Promise<BootstrapModel> {
  const row = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .first('bootstrap_model');

  const model = row?.bootstrap_model;

  if (
    model === LEGACY_OPENING_BALANCE_V1 ||
    model === RECONCILE_OPENING_EXPECTATION_V2
  ) {
    return model;
  }

  throw new UnresolvedBootstrapModelError(shopId, model);
}
