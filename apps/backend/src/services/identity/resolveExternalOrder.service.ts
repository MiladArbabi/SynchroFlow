import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

export async function resolveExternalOrderId(
  shopId: number,
  platform: string,
  externalOrderId: string,
  trx?: Knex.Transaction
): Promise<string | null> {

  const connection = trx ?? db;

  const identity = await connection('external_order_identity_map')
    .select('lasyncro_order_id')
    .where({
      shop_id: shopId,
      platform,
      external_order_id: externalOrderId,
    })
    .first();

  return identity?.lasyncro_order_id ?? null;
}