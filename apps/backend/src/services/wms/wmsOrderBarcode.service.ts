// apps/backend/src/services/wms/wmsOrderBarcode.service.ts
//
// WMS ORDER BARCODE (WM-34, SHOP-REV-01f)
// ----------------------------------------
// LSO-{8} is the physical order identity carried from warehouse entry to ship
// confirmation. It was previously minted only by a closure inside
// releasePickBatch, so any order reaching pack by another route — seeded data,
// or orders predating the WMS rollout — had none, and GET
// /orders/:orderId/invoice returned 409 with no way forward. Since the LSO-
// scan is what advances packing -> packed, those orders could never be packed.
//
// Alphabet excludes I, O, 0, 1 — visually ambiguous under a scanner.

import { Knex } from 'knex';

const BARCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MINT_ATTEMPTS = 5;

export function generateWmsBarcode(): string {
  let code = 'LSO-';
  for (let i = 0; i < 8; i++) {
    code += BARCODE_ALPHABET[Math.floor(Math.random() * BARCODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Returns the order's wms_barcode, minting one if absent.
 *
 * Returns null when the order does not exist, or is not claimed by any pick
 * batch — an unbatched order genuinely has no warehouse identity yet, and the
 * caller's 409 remains correct for that case.
 *
 * Each attempt runs in a nested transaction (a SAVEPOINT). This matters:
 * orders_wms_barcode_unique is a real unique index, and in Postgres a
 * constraint violation aborts the entire enclosing transaction — a bare retry
 * loop would fail on its second iteration with "current transaction is
 * aborted". The savepoint confines the rollback to the failed attempt.
 */
export async function ensureOrderWmsBarcode(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string
): Promise<string | null> {
  const order = await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
    .select('wms_barcode')
    .first();

  if (!order) return null;
  if (order.wms_barcode) return order.wms_barcode;

  const claimed = await trx('pick_batch_orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .first();

  if (!claimed) return null;

  for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt++) {
    const candidate = generateWmsBarcode();
    try {
      const minted = await trx.transaction(async (sp) => {
        const rows = await sp('orders')
          .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
          .whereNull('wms_barcode')
          .update({ wms_barcode: candidate })
          .returning('wms_barcode');
        return rows?.[0]?.wms_barcode ?? null;
      });

      if (minted) {
        console.info('[WMS_BARCODE_MINTED_ON_DEMAND]', {
          shopId,
          lasyncroOrderId,
          wms_barcode: minted,
          attempt,
        });
        return minted;
      }

      // whereNull matched nothing — a concurrent request minted first.
      const current = await trx('orders')
        .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
        .select('wms_barcode')
        .first();
      return current?.wms_barcode ?? null;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== '23505') throw err;
      console.warn('[WMS_BARCODE_COLLISION]', { shopId, lasyncroOrderId, attempt });
    }
  }

  throw new Error('WMS_BARCODE_MINT_EXHAUSTED');
}