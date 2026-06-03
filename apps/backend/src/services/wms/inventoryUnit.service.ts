import { Knex } from 'knex';
import crypto from 'crypto';

/**
 * INVENTORY UNIT SERVICE (WM-46)
 * --------------------------------
 * Manages per-unit LSU- barcode lifecycle.
 *
 * LSU- ID generation:
 *   SHA256(shop_id + receive_job_line_id + receive_sequence)[0:8]
 *   Deterministic — same inputs always produce the same ID.
 *   Re-printing is retrieval, not regeneration.
 *
 * Caller must:
 *   - Operate within a transaction
 *   - Have SET LOCAL "app.current_tenant" active
 */

export interface BatchConfirmInput {
  shopId: number;
  receiveJobLineId: string;
  lasyncroVariantId: string;
  quantity: number;
  ean?: string | null;
  upc?: string | null;
  shopifyBarcode?: string | null;
  createdBy: number;
}

export interface InventoryUnitRow {
  id: string;
  lasyncro_unit_id: string;
  receive_sequence: number;
}

export interface CoverageResult {
  labelled_units: number;
  total_active_units: number;
  coverage_pct: number;
}

/**
 * Generates a deterministic LSU- identifier.
 * Inputs must be stable and immutable — changing any input produces a different ID.
 */
export function generateLsuId(
  shopId: number,
  receiveJobLineId: string,
  receiveSequence: number
): string {
  const raw = `${shopId}:${receiveJobLineId}:${receiveSequence}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `LSU-${hash}`;
}

/**
 * Batch-confirms a receive job line — creates one inventory_units row per unit
 * and marks all labels as pending print.
 *
 * Sequences are assigned 1–N in bulk (batch-confirm model).
 * Idempotent within a transaction via ON CONFLICT DO NOTHING on the
 * (shop_id, receive_job_line_id, receive_sequence) unique constraint.
 *
 * Returns created unit rows (lasyncro_unit_id + receive_sequence) for label printing.
 */
export async function batchConfirmUnits(
  trx: Knex.Transaction,
  input: BatchConfirmInput
): Promise<InventoryUnitRow[]> {
  const {
    shopId,
    receiveJobLineId,
    lasyncroVariantId,
    quantity,
    ean,
    upc,
    shopifyBarcode,
  } = input;

  const rows = Array.from({ length: quantity }, (_, i) => {
    const seq = i + 1;
    return {
      lasyncro_unit_id: generateLsuId(shopId, receiveJobLineId, seq),
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      receive_job_line_id: receiveJobLineId,
      receive_sequence: seq,
      ean: ean ?? null,
      upc: upc ?? null,
      shopify_barcode: shopifyBarcode ?? null,
      source: 'lasyncro_receive',
      status: 'received',
      reprint_count: 0,
      received_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };
  });

  const created = await trx('inventory_units')
    .insert(rows)
    .onConflict(['shop_id', 'receive_job_line_id', 'receive_sequence'])
    .ignore()
    .returning(['id', 'lasyncro_unit_id', 'receive_sequence']);

  console.info('[INVENTORY_UNIT] batch_confirm', {
    shopId,
    receiveJobLineId,
    quantity,
    created: created.length,
  });

  return created;
}

/**
 * Records a label print event on a set of units.
 * Called after thermal label print job is dispatched.
 */
export async function markLabelsPrinted(
  trx: Knex.Transaction,
  shopId: number,
  unitIds: string[]
): Promise<void> {
  await trx('inventory_units')
    .whereIn('lasyncro_unit_id', unitIds)
    .where({ shop_id: shopId })
    .update({
      label_printed_at: new Date(),
      updated_at: new Date(),
    });
}

/**
 * Reprint: increments reprint_count and updates label_last_reprinted_at.
 * Never decrements reprint_count — invariant 4.
 */
export async function reprintLabel(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroUnitId: string
): Promise<InventoryUnitRow | null> {
  const unit = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
    .select('id', 'lasyncro_unit_id', 'receive_sequence')
    .first();

  if (!unit) return null;

  await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
    .update({
      reprint_count: trx.raw('reprint_count + 1'),
      label_last_reprinted_at: new Date(),
      updated_at: new Date(),
    });

  console.info('[INVENTORY_UNIT] reprint', { shopId, lasyncroUnitId });

  return unit;
}

/**
 * Resolves a scanned LSU- barcode to a unit record with full warehouse context.
 * Returns null if not found — caller decides exception handling.
 */
export async function resolveUnitBarcode(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroUnitId: string
): Promise<{
  id: string;
  lasyncro_unit_id: string;
  lasyncro_variant_id: string;
  status: string;
  current_location_code: string | null;
  ean: string | null;
  upc: string | null;
  shopify_barcode: string | null;
} | null> {
  return trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
    .select(
      'id',
      'lasyncro_unit_id',
      'lasyncro_variant_id',
      'status',
      'current_location_code',
      'ean',
      'upc',
      'shopify_barcode'
    )
    .first() ?? null;
}

/**
 * Computes unit label coverage for a shop.
 * Used by the coverage metric UI and legacy sunset auto-trigger.
 * Excludes shipped and lost units — only active inventory counts.
 */
export async function computeCoverage(
  trx: Knex | Knex.Transaction,
  shopId: number
): Promise<CoverageResult> {
  const row = await trx('inventory_units')
    .where({ shop_id: shopId })
    .whereNotIn('status', ['shipped', 'lost'])
    .select(
      trx.raw(`COUNT(*) AS total_active_units`),
      trx.raw(`
        COUNT(*) FILTER (
          WHERE source IN ('lasyncro_receive', 'legacy_stocktake')
        ) AS labelled_units
      `)
    )
    .first();

  const total = Number(row?.total_active_units ?? 0);
  const labelled = Number(row?.labelled_units ?? 0);
  const pct = total === 0 ? 0 : Math.round((labelled / total) * 100);

  return {
    labelled_units: labelled,
    total_active_units: total,
    coverage_pct: pct,
  };
}