// apps/backend/src/scripts/backfill-pick-sale-corrections.ts
//
// INV-SALE-BACKFILL-01 — compensate pre-0147 pick `sale` rows
// ------------------------------------------------------------
// Before migration 0147, pickScan.service.ts wrote movement_type='sale' for
// units revenue-units.writer.ts had ALREADY debited at order ingestion. Both
// are summed into on_hand by every ledger computation, so a replay
// double-subtracts every historical pick.
//
// 0147 fixed new writes (they are 'pick_removal', which no on-hand CASE sums).
// Rows written before it cannot be corrected in place: inventory_movements
// carries BEFORE UPDATE and BEFORE DELETE triggers that RAISE unconditionally
// — no GUC escape. Compensating movements are the only mechanism.
//
// This writes one reconciliation_correction of +abs(delta) per offending row.
// It does NOT touch inventory_truth: truth is already correct (shop 2 reads a
// true 116). The backfill only makes a future REPLAY land on 116, not 107.
//
// SELECTOR: movement_type='sale' AND triggered_by='pick_scan'.
// reference_type is NOT usable — the INV-SALE-REFTYPE-01 fix applied to new
// writes only, so these rows still read 'order_revenue_unit'.
//
// IDEMPOTENT: device_event_id is uuidv5(sourceMovementId, NS), so re-running
// conflicts and does nothing.
//
// USAGE:
//   node dist/src/scripts/backfill-pick-sale-corrections.js --shop 2
//   node dist/src/scripts/backfill-pick-sale-corrections.js --shop 2 --apply
// Dry run unless --apply is passed.

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { v5 as uuidv5 } from 'uuid';

/**
 * ENV BOOTSTRAP — same contract as src/cli/rebuild-from-events.ts.
 * Static ESM imports are hoisted and evaluated before the module body runs,
 * so importing system-db.js statically constructs its pool with undefined
 * PG* vars and fails with "client password must be a string". dotenv.config()
 * must run first, and the DB import must therefore be dynamic.
 *
 * Path: src/scripts/ → src/ → apps/backend/ → apps/ → repo root
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const { systemDb } = await import('@lasyncro/backend-core/system-db.js');

const NS = '6f4a1f8e-6c2b-4f5a-9d3e-1b7c8a2e5d40';

const ON_HAND_TYPES = [
  'inbound_purchase', 'refund_return', 'manual_adjustment',
  'reconciliation_correction', 'opening_balance', 'location_transfer',
  'sale', 'damage', 'shrinkage',
];

async function ledgerVsTruth(shopId: number) {
  const led = await systemDb('inventory_movements')
    .where({ shop_id: shopId })
    .whereIn('movement_type', ON_HAND_TYPES)
    .sum({ v: 'quantity_delta' })
    .first();
  const tru = await systemDb('inventory_truth')
    .where({ shop_id: shopId })
    .sum({ v: 'on_hand_quantity' })
    .first();
  return { ledger: Number(led?.v ?? 0), truth: Number(tru?.v ?? 0) };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const shopIdx = argv.indexOf('--shop');
  const shopId = shopIdx >= 0 ? Number(argv[shopIdx + 1]) : NaN;
  const apply = argv.includes('--apply');

  if (!Number.isInteger(shopId) || shopId <= 0) {
    console.error('Usage: backfill-pick-sale-corrections.js --shop <id> [--apply]');
    process.exit(1);
  }

  const before = await ledgerVsTruth(shopId);
  console.info('[PICK_SALE_BACKFILL] before', { shopId, ...before, drift: before.truth - before.ledger });

  const offenders = await systemDb('inventory_movements')
    .where({ shop_id: shopId, movement_type: 'sale', triggered_by: 'pick_scan' })
    .select(
      'lasyncro_inventory_movement_id',
      'lasyncro_variant_id',
      'location_code',
      'quantity_delta',
      'occurred_at'
    );

  console.info('[PICK_SALE_BACKFILL] offending rows', {
    count: offenders.length,
    units: offenders.reduce((s: number, r: any) => s + Number(r.quantity_delta), 0),
  });

  if (offenders.length === 0) {
    console.info('[PICK_SALE_BACKFILL] nothing to do');
    process.exit(0);
  }

  if (!apply) {
    for (const r of offenders) {
      console.info('[PICK_SALE_BACKFILL][DRY_RUN] would write', {
        offsets: r.lasyncro_inventory_movement_id,
        variant: r.lasyncro_variant_id,
        location: r.location_code,
        correction: Math.abs(Number(r.quantity_delta)),
      });
    }
    console.info('[PICK_SALE_BACKFILL] DRY RUN — re-run with --apply to write');
    process.exit(0);
  }

  let written = 0;
  for (const r of offenders) {
    const sourceId = r.lasyncro_inventory_movement_id as string;
    const inserted = await systemDb('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: uuidv5(`${sourceId}:correction`, NS),
        lasyncro_variant_id: r.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: 'reconciliation_correction',
        quantity_delta: Math.abs(Number(r.quantity_delta)),
        location_code: r.location_code,
        // Self-referential: the correction points at the row it offsets, so
        // every compensating row is traceable to its cause. Both columns are
        // NOT NULL and no prior reconciliation_correction existed to copy.
        reference_type: 'inventory_movement',
        reference_id: sourceId,
        device_event_id: uuidv5(`${sourceId}:correction:device`, NS),
        platform: null,
        occurred_at: new Date(),
        operator_id: null,
        triggered_by: 'inv_sale_backfill_01',
      })
      .onConflict(['device_event_id'])
      .ignore()
      .returning('lasyncro_inventory_movement_id');

    if (inserted.length === 1) written += 1;
  }

  const after = await ledgerVsTruth(shopId);
  console.info('[PICK_SALE_BACKFILL] after', {
    shopId, written, skipped: offenders.length - written,
    ...after, drift: after.truth - after.ledger,
  });

  if (after.truth !== after.ledger) {
    console.error('[PICK_SALE_BACKFILL] DRIFT REMAINS — investigate before rebuilding');
    process.exit(1);
  }
  console.info('[PICK_SALE_BACKFILL] ledger now reconciles with truth');
  process.exit(0);
}

main().catch((err) => {
  console.error('[PICK_SALE_BACKFILL_FAILED]', err);
  process.exit(1);
});
