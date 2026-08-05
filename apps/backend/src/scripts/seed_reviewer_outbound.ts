// apps/backend/src/scripts/seed_reviewer_outbound.ts
//
// REVIEWER OUTBOUND SEED (OV-158)
// --------------------------------
// Seeds the completed end of the pipeline: orders packed-and-staged, and
// orders shipped today. Together they fill the Overview map's outbound apron
// (OV-157) — main stack from shipped_at, urgent sub-stack from packed rows
// with a null shipped_at.
//
// WHY THIS IS NOT PART OF seed_reviewer_activity.ts
// That script bails whole on its supplier marker, and every phase below the
// guard assumes a fresh tenant — suppliers_shop_name_unique fires on re-entry.
// On production its batch block was skipped entirely (unbatched came up short
// of requiredOrderCount, the WARNING fired) while the marker was written
// anyway, so four batches exist there with eleven orders and zero
// order_warehouse_status rows. Making that script re-runnable meant wrapping
// ~120 lines of working code. This follows the existing pattern instead —
// seed_reviewer_operators.ts and repair_reviewer_pick_scans.ts are both
// purpose-built scripts rather than flags on the main seeder.
//
// SCHEMA FACTS VERIFIED AGAINST THE DATABASE (not inferred):
//   pick_batch_status        = pending|picking|pick_complete|packing|
//                              pack_complete|cancelled — NO 'shipped'.
//                              Correct: a batch is done when its orders are
//                              packed. Shipping is an order-level fact,
//                              because orders leave the building individually
//                              across several carrier pickups. Both specs
//                              therefore ride pack_complete batches.
//   scan_status              = confirmed|undone
//   order_warehouse_status_type = awaiting_pick|picking|picked|packing|packed|
//                              shipped|partially_shipped|cancelled — and it
//                              types order_line_item_warehouse_status.status
//                              too.
//   order_warehouse_status   has NO shop_id column; PK is lasyncro_order_id.
//                            Tenancy joins through orders.
//   pick_batches             has NO notes column — hence no text marker here.
//   pick_batch_orders        UNIQUE(lasyncro_order_id): an order belongs to
//                            exactly one batch, ever.
//   pick_batches NOT NULL without default: shop_id, release_trigger,
//                            max_line_items, total_line_items, total_units,
//                            released_at.
//
// IDEMPOTENCY WITHOUT A MARKER
// The guard is the data this script creates: if any order on this shop already
// carries a shipped_at, it has run. Backed by pick_batch_orders_order_unique,
// which makes a double-claim fail loudly rather than duplicate silently.
//
// NOT MAP-VISIBLE AS OPERATORS — the live map reads only picking/packing
// batches, so these add nothing to the operator markers. They exist for the
// outbound counts alone.
//
// Run: SEED_SHOP_ID=1 npx tsx apps/backend/src/scripts/seed_reviewer_outbound.ts

import db from '@lasyncro/backend-core/db.js';

const SHOP_ID = Number(process.env.SEED_SHOP_ID ?? 1);
const OPERATOR_EMAILS = [
  'elin.vargas@lasyncro.internal',
  'marcus.boateng@lasyncro.internal',
];

const log = (m: string) => console.log(`[OUTBOUND_SEED] ${m}`);

type OutboundSpec = {
  /** Outbound state to seed. The batch itself is always pack_complete. */
  outcome: 'staged' | 'shipped';
  orders: number;
};

async function main(): Promise<void> {
  log(`Starting — shop_id=${SHOP_ID}`);

  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${SHOP_ID}'`);

    const shop = await trx('shops').where({ id: SHOP_ID }).first();
    if (!shop) throw new Error(`Shop ${SHOP_ID} not found`);
    log(`Shop: ${shop.name}`);

    const alreadyShipped = await trx('order_warehouse_status as ows')
      .join('orders as o', 'o.lasyncro_order_id', 'ows.lasyncro_order_id')
      .where('o.shop_id', SHOP_ID)
      .whereNotNull('ows.shipped_at')
      .first('ows.lasyncro_order_id');
    if (alreadyShipped) {
      log('Already seeded (shipped orders exist on this shop). Nothing to do.');
      return;
    }

    const owner = await trx('users')
      .where({ shop_id: SHOP_ID })
      .orderBy('id')
      .first();

    const operators = await trx('users')
      .where({ shop_id: SHOP_ID })
      .whereIn('email', OPERATOR_EMAILS);
    const picker = operators.find((u) => u.email === OPERATOR_EMAILS[0]);
    const packer = operators.find((u) => u.email === OPERATOR_EMAILS[1]);
    if (!picker || !packer) {
      throw new Error(
        'Reviewer operators missing — run seed_reviewer_operators.ts first'
      );
    }

    const bins = await trx('warehouse_locations')
      .where({ shop_id: SHOP_ID, type: 'bin', active: true })
      .orderBy('location_code')
      .select('location_code', 'zone_type');
    const pickBins = bins
      .filter((b) => b.zone_type === 'pick')
      .map((b) => b.location_code);
    if (pickBins.length === 0) throw new Error('No active pick bins found');

    /**
     * One order per outcome. Both apron stacks render, both code paths are
     * exercised, and the total stays within what a constrained tenant can
     * supply — local had 8 pending orders but only 2 unclaimed, since
     * pick_batch_orders_order_unique means an order belongs to exactly one
     * batch forever and the activity seed had taken six.
     *
     * Deliberately not tuned upward for visual weight: a larger count would
     * be a number chosen for a screenshot, and it would make this script
     * unrunnable on any tenant with a shallow order pool.
     */
    const specs: OutboundSpec[] = [
      // Packed, carrier has not collected. The apron's urgent stack.
      { outcome: 'staged', orders: 1 },
      // Shipped today. The apron's main stack, and the only completion
      // signal anywhere on the Overview.
      { outcome: 'shipped', orders: 1 },
    ];
    const required = specs.reduce((t, s) => t + s.orders, 0);

    // Same eligibility predicate as httpGetOrderPool plus the warehouse-status
    // exclusion — one definition of "releasable", never a second.
    const available = await trx('orders as o')
      .join(
        'order_fulfillment_status as ofs',
        'ofs.lasyncro_order_id',
        'o.lasyncro_order_id'
      )
      .where('o.shop_id', SHOP_ID)
      .whereIn('ofs.status', ['pending', 'processing'])
      .whereNotExists(function () {
        this.select(1)
          .from('pick_batch_orders as pbo')
          .whereRaw('pbo.lasyncro_order_id = o.lasyncro_order_id');
      })
      .whereNotExists(function () {
        this.select(1)
          .from('order_constraints as oc')
          .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
          .where('oc.is_active', true);
      })
      .whereNotExists(function () {
        this.select(1)
          .from('order_warehouse_status as ows')
          .whereRaw('ows.lasyncro_order_id = o.lasyncro_order_id');
      })
      .whereExists(function () {
        this.select(1)
          .from('order_line_items as oli')
          .whereRaw('oli.lasyncro_order_id = o.lasyncro_order_id');
      })
      .orderBy('o.order_created_at', 'desc')
      .limit(required)
      .select('o.lasyncro_order_id');

    // Hard failure, not a warning. The activity seed's silent skip on this
    // exact condition is why production has no outbound rows at all.
    if (available.length < required) {
      throw new Error(
        `Need ${required} eligible orders, found ${available.length}`
      );
    }
    log(`Claimed ${available.length} eligible orders`);

    let cursor = 0;

    for (const spec of specs) {
      const slice = available.slice(cursor, cursor + spec.orders);
      cursor += spec.orders;
      const orderIds = slice.map((o) => o.lasyncro_order_id);

      const lineItems = await trx('order_line_items')
        .whereIn('lasyncro_order_id', orderIds)
        .orderBy('lasyncro_order_id')
        .orderBy('lasyncro_line_item_id')
        .select(
          'lasyncro_line_item_id',
          'lasyncro_order_id',
          'lasyncro_variant_id',
          'quantity'
        );

      const totalUnits = lineItems.reduce(
        (sum, li) => sum + Number(li.quantity),
        0
      );

      const [batch] = await trx('pick_batches')
        .insert({
          shop_id: SHOP_ID,
          status: 'pack_complete',
          release_trigger: 'auto',
          max_line_items: 20,
          total_line_items: lineItems.length,
          total_units: totalUnits,
          units_picked: totalUnits,
          units_packed: totalUnits,
          picked_by: picker.id,
          packed_by: packer.id,
          assigned_operator_id: picker.id,
          assigned_packer_id: packer.id,
          pick_completed_at: trx.raw(`NOW() - INTERVAL '3 hours'`),
          pack_completed_at: trx.raw(`NOW() - INTERVAL '2 hours'`),
          released_by: owner?.id ?? null,
          released_at: trx.raw(`NOW() - INTERVAL '4 hours'`),
        })
        .returning('pick_batch_id');

      await trx('pick_batch_orders').insert(
        slice.map((order) => ({
          pick_batch_id: batch.pick_batch_id,
          lasyncro_order_id: order.lasyncro_order_id,
          shop_id: SHOP_ID,
        }))
      );

      const isShipped = spec.outcome === 'shipped';

      await trx('order_warehouse_status').insert(
        slice.map((order) => ({
          lasyncro_order_id: order.lasyncro_order_id,
          status: isShipped ? 'shipped' : 'packed',
          pick_batch_id: batch.pick_batch_id,
          status_updated_at: trx.raw(`NOW() - INTERVAL '30 minutes'`),
          picked_at: trx.raw(`NOW() - INTERVAL '3 hours'`),
          packed_at: trx.raw(`NOW() - INTERVAL '2 hours'`),
          // shippedToday counts shipped_at::date = CURRENT_DATE. 30 minutes
          // keeps it inside today for any timezone this tenant runs in.
          shipped_at: isShipped
            ? trx.raw(`NOW() - INTERVAL '30 minutes'`)
            : null,
          created_at: trx.raw(`NOW() - INTERVAL '5 hours'`),
          updated_at: trx.raw(`NOW() - INTERVAL '30 minutes'`),
        }))
      );

      await trx('order_line_item_warehouse_status').insert(
        lineItems.map((li) => ({
          lasyncro_line_item_id: li.lasyncro_line_item_id,
          lasyncro_order_id: li.lasyncro_order_id,
          shop_id: SHOP_ID,
          status: isShipped ? 'shipped' : 'packed',
          status_updated_at: trx.raw(`NOW() - INTERVAL '30 minutes'`),
          created_at: trx.raw(`NOW() - INTERVAL '5 hours'`),
          updated_at: trx.raw(`NOW() - INTERVAL '30 minutes'`),
        }))
      );

      // Append-only, so attribution must be right on the first write.
      for (let i = 0; i < lineItems.length; i++) {
        await trx('pick_scan_log').insert({
          shop_id: SHOP_ID,
          pick_batch_id: batch.pick_batch_id,
          lasyncro_line_item_id: lineItems[i].lasyncro_line_item_id,
          lasyncro_variant_id: lineItems[i].lasyncro_variant_id,
          location_code: pickBins[i % pickBins.length],
          quantity_confirmed: Number(lineItems[i].quantity),
          status: 'confirmed',
          scanned_by: picker.id,
          scanned_at: trx.raw(`NOW() - INTERVAL '${180 + i} minutes'`),
        });

        await trx('pack_scan_log').insert({
          shop_id: SHOP_ID,
          pick_batch_id: batch.pick_batch_id,
          lasyncro_order_id: lineItems[i].lasyncro_order_id,
          lasyncro_line_item_id: lineItems[i].lasyncro_line_item_id,
          lasyncro_variant_id: lineItems[i].lasyncro_variant_id,
          lasyncro_unit_id: null,
          quantity_confirmed: Number(lineItems[i].quantity),
          status: 'confirmed',
          scanned_by: packer.id,
          scanned_at: trx.raw(`NOW() - INTERVAL '${120 + i} minutes'`),
        });
      }

      log(
        `${spec.outcome}: batch ${String(batch.pick_batch_id).slice(0, 8)} — ` +
          `${slice.length} orders, ${lineItems.length} lines, ${totalUnits} units`
      );
    }
  });

  log('✅ Complete');
  await db.destroy();
}

main().catch((err) => {
  console.error('[OUTBOUND_SEED] ❌ Failed:', err.message ?? err);
  process.exit(1);
});