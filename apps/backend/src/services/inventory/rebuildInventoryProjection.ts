import db from '../../db';

interface LedgerRow {
  lasyncro_variant_id: string;
  on_hand: string | number;
}

export async function rebuildInventoryProjection(): Promise<void> {
  await db.transaction(async (trx) => {

    // 1️⃣ Clear projection
    await trx('inventory_truth').del();

    // 2️⃣ Aggregate ledger deterministically
    const rows = await trx('inventory_movements')
      .select('lasyncro_variant_id')
      .sum({ on_hand: 'quantity_delta' })
      .groupBy('lasyncro_variant_id') as LedgerRow[];

    if (rows.length === 0) return;

    const now = new Date();

    await trx('inventory_truth').insert(
      rows.map(r => {
        const onHand = Number(r.on_hand);

        return {
          lasyncro_variant_id: r.lasyncro_variant_id,
          on_hand_quantity: onHand,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity: onHand,
          sellable_quantity: onHand,
          last_evaluated_at: now,
        };
      })
    );
  });
}
