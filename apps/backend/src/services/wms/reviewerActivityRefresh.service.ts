import db from '@lasyncro/backend-core/db.js';

const REVIEWER_ACTIVITY_MARKER = 'SEED:REVIEWER_ACTIVITY';
const REVIEWER_OPERATOR_EMAILS = [
  'elin.vargas@lasyncro.internal',
  'marcus.boateng@lasyncro.internal',
];

export type ReviewerActivityRefreshResult = {
  shopId: number;
  pickingBatchesRefreshed: number;
  packingBatchesRefreshed: number;
  reason: 'refreshed' | 'marker_missing' | 'reviewer_operators_missing';
};

/**
 * OV-153: keep the static Shopify-review tenant visually active without
 * weakening real-tenant idle detection. The explicit shop id is not enough:
 * the seed-owned supplier marker and both canonical reviewer operators must
 * also exist before any active batch clock can move.
 */
export async function refreshReviewerActivity(
  shopId: number
): Promise<ReviewerActivityRefreshResult> {
  if (!Number.isInteger(shopId) || shopId <= 0) {
    throw new Error(
      'Reviewer activity refresh requires a positive integer shop id'
    );
  }

  return db.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [
      String(shopId),
    ]);

    const marker = await trx('suppliers')
      .where({ shop_id: shopId })
      .whereLike('notes', `${REVIEWER_ACTIVITY_MARKER}%`)
      .first('id');

    if (!marker) {
      return {
        shopId,
        pickingBatchesRefreshed: 0,
        packingBatchesRefreshed: 0,
        reason: 'marker_missing',
      };
    }

    const reviewerOperatorIds = await trx('users')
      .where({ shop_id: shopId })
      .whereIn('email', REVIEWER_OPERATOR_EMAILS)
      .pluck('id');

    if (reviewerOperatorIds.length !== REVIEWER_OPERATOR_EMAILS.length) {
      return {
        shopId,
        pickingBatchesRefreshed: 0,
        packingBatchesRefreshed: 0,
        reason: 'reviewer_operators_missing',
      };
    }

    const refreshedAt = trx.fn.now();

    const pickingBatches = await trx('pick_batches')
      .where({ shop_id: shopId, status: 'picking' })
      .whereIn('picked_by', reviewerOperatorIds)
      .update({ pick_last_activity_at: refreshedAt })
      .returning('pick_batch_id');

    const packingBatches = await trx('pick_batches')
      .where({ shop_id: shopId, status: 'packing' })
      .where((builder) => {
        builder
          .whereIn('packed_by', reviewerOperatorIds)
          .orWhereIn('assigned_packer_id', reviewerOperatorIds);
      })
      .update({ pack_last_activity_at: refreshedAt })
      .returning('pick_batch_id');

    return {
      shopId,
      pickingBatchesRefreshed: pickingBatches.length,
      packingBatchesRefreshed: packingBatches.length,
      reason: 'refreshed',
    };
  });
}