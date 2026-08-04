// apps/backend/src/scripts/seed_reviewer_activity.ts
//
// REVIEWER ACTIVITY SEED (OV-102)
// --------------------------------
// Populates operational activity for the Shopify reviewer tenant so every
// module renders real content instead of an empty state.
//
// TARGETS SHOP 1 by default — contact@lasyncro.com lives on shop_id 1
// ("Shopify's Shop"), NOT on the shop_id 8 tenant that seed_reviewer.ts
// creates (that one has 0 users and is unreachable). See
// docs/playbooks/shopify_submission_playbook.md.
//
// ADDITIVE AND IDEMPOTENT — never resets, never drops. Every row it owns is
// tagged with MARKER in a notes field so re-runs are detectable.
//
// DATA-DRIVEN — bin codes and variants differ between local and prod, so
// nothing is hardcoded; the script discovers them at runtime.
//
// FK CHAIN (unavoidable ordering):
//   suppliers -> purchase_orders -> purchase_order_line_items
//             -> receive_jobs -> receive_job_lines -> inventory_units
// receive_jobs.po_id and inventory_units.receive_job_line_id are both
// NOT NULL, so there is no shortcut to seeding stock.
//
// Run: SEED_SHOP_ID=1 npx tsx apps/backend/src/scripts/seed_reviewer_activity.ts

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

const SHOP_ID = Number(process.env.SEED_SHOP_ID ?? 1);
const MARKER = 'SEED:REVIEWER_ACTIVITY';
const RUN = crypto.randomBytes(3).toString('hex').toUpperCase();
const OPERATOR_EMAILS = [
  'elin.vargas@lasyncro.internal',
  'marcus.boateng@lasyncro.internal',
];

const log = (m: string) => console.log(`[ACTIVITY_SEED] ${m}`);

async function main(): Promise<void> {
  log(`Starting — shop_id=${SHOP_ID} run=${RUN}`);

  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${SHOP_ID}'`);

    // Guard: refuse to run against a shop that does not exist.
    const shop = await trx('shops').where({ id: SHOP_ID }).first();
    if (!shop) throw new Error(`Shop ${SHOP_ID} not found`);
    log(`Shop: ${shop.name}`);

    // Idempotency check — bail early if already seeded.
    const existing = await trx('suppliers')
      .where({ shop_id: SHOP_ID })
      .whereLike('notes', `${MARKER}%`)
      .first();
    if (existing) {
      log('Already seeded (marker found on suppliers). Nothing to do.');
      return;
    }

    // ── DISCOVERY ────────────────────────────────────────────────────────────
    const variants = await trx('variants')
      .where({ shop_id: SHOP_ID })
      .orderBy('lasyncro_variant_id')
      .limit(12)
      .select('lasyncro_variant_id', 'sku', 'title');
    if (variants.length < 4) throw new Error(`Need >=4 variants, found ${variants.length}`);

    const bins = await trx('warehouse_locations')
      .where({ shop_id: SHOP_ID, type: 'bin', active: true })
      .orderBy('location_code')
      .select('location_code', 'zone_type');

    const pickBins    = bins.filter(b => b.zone_type === 'pick').map(b => b.location_code);
    const receiveBin  = bins.find(b => b.zone_type === 'receive')?.location_code ?? null;
    if (pickBins.length === 0) throw new Error('No active pick bins found');
    log(`Discovered ${variants.length} variants, ${pickBins.length} pick bins`);

        const owner = await trx('users').where({ shop_id: SHOP_ID }).orderBy('id').first();

    // OV-125a: pick_scan_log is append-only, so reviewer operators must exist
    // before batches and scans are created; attribution cannot be repaired later.
    const reviewerOperators = await trx('users')
      .where({ shop_id: SHOP_ID })
      .whereIn('email', OPERATOR_EMAILS)
      .select('id', 'email');

    const primaryPicker = reviewerOperators.find(
      operator => operator.email === OPERATOR_EMAILS[0]
    );
    const secondaryPicker = reviewerOperators.find(
      operator => operator.email === OPERATOR_EMAILS[1]
    );

    if (!primaryPicker || !secondaryPicker) {
      throw new Error(
        'Reviewer operators missing — run seed_reviewer_operators.ts first'
      );
    }

    log(`Operators: ${primaryPicker.email}, ${secondaryPicker.email}`);

    // ── PHASE A: SUPPLIERS + PURCHASE ORDERS ────────────────────────────────
    const supplierRows = [
      { name: 'Nordic Textile Works', contact_name: 'Anna Lind',    contact_email: 'orders@nordictextile.example',
        on_time_rate: 94.5, fill_rate: 98.2, defect_rate: 0.8, avg_delivery_days: 6.5, moq: 50,  lead_time_days: 7  },
      { name: 'Harbour Supply Co',    contact_name: 'Tom Reyes',    contact_email: 'purchasing@harboursupply.example',
        on_time_rate: 81.0, fill_rate: 92.4, defect_rate: 2.1, avg_delivery_days: 11.0, moq: 100, lead_time_days: 14 },
      { name: 'Meridian Components',  contact_name: 'Priya Raman',  contact_email: 'sales@meridiancomp.example',
        on_time_rate: 97.8, fill_rate: 99.1, defect_rate: 0.3, avg_delivery_days: 4.0, moq: 25,  lead_time_days: 5  },
    ].map(s => ({ ...s, shop_id: SHOP_ID, active: true, total_pos: 0, notes: `${MARKER} run=${RUN}` }));

    const suppliers = await trx('suppliers').insert(supplierRows).returning(['id', 'name']);
    log(`Phase A: ${suppliers.length} suppliers`);

    // PO statuses chosen from the real enum:
    // draft | ordered | confirmed | in_production | shipped | partially_received | received | cancelled
    const poSpecs = [
      { supplier: 0, status: 'draft',              daysOut:  21, lines: 2 },
      { supplier: 1, status: 'ordered',            daysOut:  10, lines: 3 },
      { supplier: 2, status: 'shipped',            daysOut:   2, lines: 2 },
      { supplier: 0, status: 'partially_received', daysOut:  -1, lines: 3 },
    ];

    const pos: { id: string; status: string; lineIds: { id: string; variant: string; qty: number }[] }[] = [];

    for (const spec of poSpecs) {
      const [po] = await trx('purchase_orders').insert({
        shop_id: SHOP_ID,
        supplier_id: suppliers[spec.supplier].id,
        status: spec.status,
        expected_delivery_date: trx.raw(`CURRENT_DATE + ?::int`, [spec.daysOut]),
        notes: `${MARKER} run=${RUN}`,
      }).returning('id');

    const lineIds: { id: string; variant: string; qty: number }[] = [];
      for (let i = 0; i < spec.lines; i++) {
        const v = variants[(pos.length * 3 + i) % variants.length];
        const qty = 40 + i * 20;
        const received = spec.status === 'partially_received' ? Math.floor(qty * 0.6) : 0;
        const [line] = await trx('purchase_order_line_items').insert({
          po_id: po.id,
          shop_id: SHOP_ID,
          lasyncro_variant_id: v.lasyncro_variant_id,
          description: v.title ?? v.sku ?? 'Component',
          quantity_ordered: qty,
          quantity_received: received,
          unit_cost_cents: 850 + i * 240,
        }).returning('id');
        lineIds.push({ id: line.id, variant: v.lasyncro_variant_id, qty });
      }
      pos.push({ id: po.id, status: spec.status, lineIds });
    }
    log(`Phase A: ${pos.length} purchase orders`);

    // ── PHASE B: RECEIVE JOBS + INVENTORY UNITS ─────────────────────────────
    // receive_job_status: pending | in_progress | inspection | barcode_assignment
    //                   | stow_ready | closed | cancelled
    const receiveSpecs = [
      { po: 3, status: 'in_progress', inspectRatio: 0.5 },
      { po: 2, status: 'stow_ready',  inspectRatio: 1.0 },
    ];

    let unitSeq = 0;
    for (const spec of receiveSpecs) {
      const po = pos[spec.po];
      const totalUnits = po.lineIds.reduce((s, l) => s + l.qty, 0);
      const inspected  = Math.floor(totalUnits * spec.inspectRatio);

      const [job] = await trx('receive_jobs').insert({
        shop_id: SHOP_ID,
        po_id: po.id,
        status: spec.status,
        assigned_operator_id: owner?.id ?? null,
        total_variants: po.lineIds.length,
        total_units: totalUnits,
        units_inspected: inspected,
        units_accepted: inspected,
        units_rejected: 0,
        started_at: trx.raw(`NOW() - INTERVAL '3 hours'`),
        notes: `${MARKER} run=${RUN}`,
      }).returning('receive_job_id');

      for (const line of po.lineIds) {
        const accepted = Math.floor(line.qty * spec.inspectRatio);
        const [rjl] = await trx('receive_job_lines').insert({
          shop_id: SHOP_ID,
          receive_job_id: job.receive_job_id,
          po_line_item_id: line.id,
          lasyncro_variant_id: line.variant,
          quantity_expected: line.qty,
          quantity_accepted: accepted,
          quantity_rejected: 0,
          inspection_complete: spec.inspectRatio >= 1,
          suggested_location_code: pickBins[unitSeq % pickBins.length],
        }).returning('receive_job_line_id');

        // A handful of tracked units per line — enough to demonstrate per-unit
        // LSU tracking without generating hundreds of rows.
        // lasyncro_unit_id is varchar(20) and GLOBALLY unique (not per-shop),
        // so the run id keeps re-runs and other tenants from colliding.
        const unitCount = Math.min(4, accepted);
        for (let n = 0; n < unitCount; n++) {
          unitSeq++;
          await trx('inventory_units').insert({
            lasyncro_unit_id: `LSU-${RUN}-${unitSeq}`,
            shop_id: SHOP_ID,
            lasyncro_variant_id: line.variant,
            receive_job_line_id: rjl.receive_job_line_id,
            receive_sequence: n + 1,
            source: 'lasyncro_receive',
            status: spec.status === 'stow_ready' ? 'stowed' : 'received',
            current_location_code: spec.status === 'stow_ready'
              ? pickBins[unitSeq % pickBins.length]
              : receiveBin,
            received_at: trx.raw(`NOW() - INTERVAL '3 hours'`),
          });
        }
      }
    }
    log(`Phase B: 2 receive jobs, ${unitSeq} inventory units`);

    // ── PHASE C: STOW TASKS + PICK BATCHES ──────────────────────────────────
    const stowRows = variants.slice(0, 8).map((v, i) => ({
      shop_id: SHOP_ID,
      lasyncro_variant_id: v.lasyncro_variant_id,
      quantity: 6 + i * 3,
      location_code: pickBins[i % pickBins.length],
      status: 'pending',
      trigger: 'inbound_stock',
    }));
    await trx('stow_tasks').insert(stowRows);
    log(`Phase C: ${stowRows.length} stow tasks`);

          // OV-135: seed the same mutually exclusive lifecycle that real WMS
      // writers produce. Orders must be eligible for the Order Pool, and every
      // batch total must reconcile with its actual order_line_items rows.
      const batchSpecs = [
        {
          status: 'picking',
          orders: 2,
          pickedRatio: 0.5,
          packedRatio: 0,
          pickerId: primaryPicker.id,
          packerId: null,
        },
        {
          status: 'pick_complete',
          orders: 1,
          pickedRatio: 1.0,
          packedRatio: 0,
          pickerId: primaryPicker.id,
          packerId: null,
        },
        {
          status: 'packing',
          orders: 1,
          pickedRatio: 1.0,
          packedRatio: 0.5,
          pickerId: secondaryPicker.id,
          packerId: secondaryPicker.id,
        },
        {
          status: 'pack_complete',
          orders: 2,
          pickedRatio: 1.0,
          packedRatio: 1.0,
          pickerId: primaryPicker.id,
          packerId: secondaryPicker.id,
        },
      ];

      const requiredOrderCount = batchSpecs.reduce(
        (total, spec) => total + spec.orders,
        0
      );

      const unbatched = await trx('orders as o')
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
        .limit(requiredOrderCount)
        .select('o.lasyncro_order_id');

      if (unbatched.length < requiredOrderCount) {
        log(
          `WARNING: need ${requiredOrderCount} eligible orders, found ${unbatched.length} — skipping pick batches`
        );
      } else {
        const warehouseStatusByBatchStatus = {
          picking: 'picking',
          pick_complete: 'picked',
          packing: 'packing',
          pack_complete: 'packed',
        } as const;

        let cursor = 0;

        for (const spec of batchSpecs) {
          const slice = unbatched.slice(cursor, cursor + spec.orders);
          cursor += spec.orders;

          const orderIds = slice.map(order => order.lasyncro_order_id);
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
            (total, lineItem) => total + Number(lineItem.quantity),
            0
          );

          const unitsPicked = Math.min(
            totalUnits,
            Math.max(1, Math.floor(totalUnits * spec.pickedRatio))
          );

          const unitsPacked =
            spec.packedRatio > 0
              ? Math.min(
                  unitsPicked,
                  Math.max(1, Math.floor(totalUnits * spec.packedRatio))
                )
              : 0;

          const [batch] = await trx('pick_batches')
            .insert({
              shop_id: SHOP_ID,
              status: spec.status,
              release_trigger: 'auto',
              max_line_items: 20,
              total_line_items: lineItems.length,
              total_units: totalUnits,
              units_picked: unitsPicked,
              units_packed: unitsPacked,
              picked_by: spec.pickerId,
              packed_by: unitsPacked > 0 ? spec.packerId : null,
              assigned_operator_id: spec.pickerId,
              assigned_packer_id: spec.packerId,
              pick_claimed_at: trx.raw(`NOW() - INTERVAL '90 minutes'`),
              pick_last_activity_at: trx.raw(`NOW() - INTERVAL '4 minutes'`),
              pack_last_activity_at:
                unitsPacked > 0
                  ? trx.raw(`NOW() - INTERVAL '3 minutes'`)
                  : null,
              pick_completed_at:
                spec.pickedRatio >= 1
                  ? trx.raw(`NOW() - INTERVAL '40 minutes'`)
                  : null,
              pack_completed_at:
                spec.status === 'pack_complete'
                  ? trx.raw(`NOW() - INTERVAL '10 minutes'`)
                  : null,
              released_by: owner?.id ?? null,
              released_at: trx.raw(`NOW() - INTERVAL '2 hours'`),
            })
            .returning('pick_batch_id');

          await trx('pick_batch_orders').insert(
            slice.map(order => ({
              pick_batch_id: batch.pick_batch_id,
              lasyncro_order_id: order.lasyncro_order_id,
              shop_id: SHOP_ID,
            }))
          );

          const warehouseStatus =
            warehouseStatusByBatchStatus[spec.status];

          await trx('order_warehouse_status').insert(
            slice.map(order => ({
              lasyncro_order_id: order.lasyncro_order_id,
              status: warehouseStatus,
              pick_batch_id: batch.pick_batch_id,
              status_updated_at: trx.raw(`NOW() - INTERVAL '3 minutes'`),
              picked_at:
                spec.status === 'picking'
                  ? null
                  : trx.raw(`NOW() - INTERVAL '40 minutes'`),
              packed_at:
                spec.status === 'pack_complete'
                  ? trx.raw(`NOW() - INTERVAL '10 minutes'`)
                  : null,
              created_at: trx.raw(`NOW() - INTERVAL '2 hours'`),
              updated_at: trx.raw(`NOW() - INTERVAL '3 minutes'`),
            }))
          );

          await trx('order_line_item_warehouse_status').insert(
            lineItems.map(lineItem => ({
              lasyncro_line_item_id: lineItem.lasyncro_line_item_id,
              lasyncro_order_id: lineItem.lasyncro_order_id,
              shop_id: SHOP_ID,
              status: warehouseStatus,
              status_updated_at: trx.raw(`NOW() - INTERVAL '3 minutes'`),
              created_at: trx.raw(`NOW() - INTERVAL '2 hours'`),
              updated_at: trx.raw(`NOW() - INTERVAL '3 minutes'`),
            }))
          );

          let remainingPickedUnits = unitsPicked;

          for (let i = 0; i < lineItems.length; i++) {
            if (remainingPickedUnits <= 0) break;

            const quantityConfirmed = Math.min(
              Number(lineItems[i].quantity),
              remainingPickedUnits
            );

            await trx('pick_scan_log').insert({
              shop_id: SHOP_ID,
              pick_batch_id: batch.pick_batch_id,
              lasyncro_line_item_id: lineItems[i].lasyncro_line_item_id,
              lasyncro_variant_id: lineItems[i].lasyncro_variant_id,
              location_code: pickBins[i % pickBins.length],
              quantity_confirmed: quantityConfirmed,
              status: 'confirmed',
              scanned_by: spec.pickerId,
              scanned_at: trx.raw(
                `NOW() - INTERVAL '${2 + i} minutes'`
              ),
            });

            remainingPickedUnits -= quantityConfirmed;
          }

          let remainingPackedUnits = unitsPacked;

          for (let i = 0; i < lineItems.length; i++) {
            if (remainingPackedUnits <= 0) break;

            const quantityConfirmed = Math.min(
              Number(lineItems[i].quantity),
              remainingPackedUnits
            );

            await trx('pack_scan_log').insert({
              shop_id: SHOP_ID,
              pick_batch_id: batch.pick_batch_id,
              lasyncro_order_id: lineItems[i].lasyncro_order_id,
              lasyncro_line_item_id: lineItems[i].lasyncro_line_item_id,
              lasyncro_variant_id: lineItems[i].lasyncro_variant_id,
              lasyncro_unit_id: null,
              quantity_confirmed: quantityConfirmed,
              status: 'confirmed',
              scanned_by: spec.packerId,
              scanned_at: trx.raw(
                `NOW() - INTERVAL '${1 + i} minutes'`
              ),
            });

            remainingPackedUnits -= quantityConfirmed;
          }
        }

        // Recent scan timestamps intentionally make only picking/packing batches
        // active. The marker guard prevents this script from being a freshness
        // command; review-day refresh remains a separate OV-132 responsibility.
        log(`Phase C: ${batchSpecs.length} canonical outbound batches`);
      }

    // ── PHASE E: PULSE FRESHNESS ────────────────────────────────────────────
    // NOTE: revenue_projection_daily is a PROJECTION table with no writer
    // guard. Writing it directly is safe today but `npm run rebuild` will
    // overwrite these rows from the event ledger. Acceptable for a demo
    // tenant; re-run this script after any rebuild.
    await trx('revenue_projection_daily')
      .insert([
        { shop_id: SHOP_ID, revenue_date: trx.raw('CURRENT_DATE'),
          gross_revenue: 4820, order_count: 7, at_risk_revenue: 610,
          evaluated_at: trx.raw('NOW()'), updated_at: trx.raw('NOW()') },
        { shop_id: SHOP_ID, revenue_date: trx.raw(`CURRENT_DATE - 1`),
          gross_revenue: 3960, order_count: 6, at_risk_revenue: 240,
          evaluated_at: trx.raw('NOW()'), updated_at: trx.raw('NOW()') },
      ])
      .onConflict(['shop_id', 'revenue_date'])
      .merge({ gross_revenue: trx.raw('EXCLUDED.gross_revenue'),
               order_count: trx.raw('EXCLUDED.order_count'),
               updated_at: trx.raw('NOW()') });
    log('Phase E: revenue projection refreshed for today/yesterday');
  });

  log('✅ Complete');
  await db.destroy();
}

main().catch((err) => {
  console.error('[ACTIVITY_SEED] ❌ Failed:', err.message ?? err);
  process.exit(1);
});