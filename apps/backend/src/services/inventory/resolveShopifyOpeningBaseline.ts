import type { Knex } from 'knex';
import {
  LEGACY_OPENING_BALANCE_V1,
  resolveBootstrapModel,
} from './bootstrapModel.js';

/**
 * RESOLVE SHOPIFY OPENING BASELINE (GH-1145-A1)
 * ---------------------------------------------
 * The event-time boundary before which a fulfillment is historical Shopify
 * truth and must not be replayed as a LaSyncro physical removal.
 *
 * bootstrap_model is the sole branch selector (never inferred):
 *
 *   legacy_opening_balance_v1
 *     earliest Shopify opening_balance movement for this shop + variant —
 *     the exact query previously inlined in fulfillmentPhysicalRemoval.
 *
 *   reconcile_opening_expectation_v2
 *     shopify_opening_inventory_expectations.observed_at for this exact
 *     shop + variant. No row -> null (no baseline). Never falls back to the
 *     legacy query and never borrows a sibling variant's timestamp.
 *
 *   missing / invalid
 *     throws (fail closed).
 */
export async function resolveShopifyOpeningBaselineAt(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroVariantId: string
): Promise<Date | null> {
  const bootstrapModel = await resolveBootstrapModel(trx, shopId);

  if (bootstrapModel === LEGACY_OPENING_BALANCE_V1) {
    const shopifyBaselineRow = await trx('inventory_movements')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: lasyncroVariantId,
        movement_type: 'opening_balance',
        platform: 'shopify',
      })
      .min('occurred_at as occurred_at')
      .first();

    return shopifyBaselineRow?.occurred_at
      ? new Date(shopifyBaselineRow.occurred_at)
      : null;
  }

  const expectationRow = await trx('shopify_opening_inventory_expectations')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
    })
    .first('observed_at');

  return expectationRow?.observed_at
    ? new Date(expectationRow.observed_at)
    : null;
}
