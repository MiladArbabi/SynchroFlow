import { Knex } from 'knex';

export async function enqueueShopSnapshotJob(
  trx: Knex | Knex.Transaction,
  shopId: number
): Promise<void> {
  await trx('shop_snapshot_jobs')
    .insert({
      shop_id: shopId,
      scheduled_at: trx.fn.now(),
    })
    .onConflict(['shop_id'])
    .merge({
      scheduled_at: trx.fn.now(),
    });
}
