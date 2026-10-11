import { lockReceiveJob } from './receiveWorkflowLock.service.js';
import { Knex } from 'knex';
import crypto from 'crypto';
import { refreshReadinessForUnits } from './receiveBarcodeReadiness.service.js';

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

export interface ReconcileUnitIssuanceInput {
  shopId: number;
  recountLineId: string;
  lasyncroVariantId: string;
  quantity: number;
  currentLocationCode: string;
  canonicalizedAt: Date;
  ean?: string | null;
  upc?: string | null;
  shopifyBarcode?: string | null;
}

export interface InventoryUnitRow {
  id: string;
  lasyncro_unit_id: string;
  receive_sequence: number;
}

type RecountIssuedUnitRow = InventoryUnitRow & {
  receive_job_line_id: string | null;
  recount_line_id: string | null;
  lasyncro_variant_id: string;
  source: string;
  status: string;
  current_location_code: string | null;
  received_at: Date | string;
};

export interface CoverageResult {
  labelled_units: number;
  total_active_units: number;
  unlabelled_in_circulation: number;
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

function assertRecountIssuance(
  input: ReconcileUnitIssuanceInput,
  rows: RecountIssuedUnitRow[]
): InventoryUnitRow[] {
  if (rows.length !== input.quantity) {
    throw new Error(
      `[INVENTORY_UNIT_RECOUNT_ISSUANCE_MISMATCH] Expected ${input.quantity} units for recount line ${input.recountLineId}, found ${rows.length}`
    );
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const sequence = i + 1;
    const expectedLsu = generateLsuId(
      input.shopId,
      input.recountLineId,
      sequence
    );

    if (
      row.receive_job_line_id !== null ||
      row.recount_line_id !== input.recountLineId ||
      row.lasyncro_variant_id !== input.lasyncroVariantId ||
      row.receive_sequence !== sequence ||
      row.lasyncro_unit_id !== expectedLsu ||
      row.source !== 'opening_inventory_reconcile' ||
      row.status !== 'stowed' ||
      row.current_location_code !== input.currentLocationCode
    ) {
      throw new Error(
        `[INVENTORY_UNIT_RECOUNT_ISSUANCE_INVARIANT] Canonical LSU lineage mismatch for recount line ${input.recountLineId}`
      );
    }
  }

  return rows.map((row) => ({
    id: row.id,
    lasyncro_unit_id: row.lasyncro_unit_id,
    receive_sequence: row.receive_sequence,
  }));
}

/**
 * Creates canonical LSUs for a successfully settled opening-inventory recount.
 *
 * Reconcile stock enters directly at the physically observed bin as stowed;
 * it never masquerades as Receive/ROOT inventory.
 *
 * Retrying the same settled recount line returns the same canonical units.
 * A changed quantity/location/variant for an already-issued line fails closed
 * rather than extending or rewriting physical truth.
 */
export async function issueReconciledUnits(
  trx: Knex.Transaction,
  input: ReconcileUnitIssuanceInput
): Promise<InventoryUnitRow[]> {
  const locationCode = input.currentLocationCode.trim();

  if (!locationCode) {
    throw new Error(
      '[INVENTORY_UNIT_RECOUNT_LOCATION_REQUIRED] Reconcile LSU issuance requires an exact physical location'
    );
  }

  const normalizedInput = {
    ...input,
    currentLocationCode: locationCode,
  };

  const recountLine = await trx('inventory_recount_lines')
    .where({
      shop_id: normalizedInput.shopId,
      recount_line_id: normalizedInput.recountLineId,
    })
    .select(
      'recount_line_id',
      'lasyncro_variant_id',
      'location_code'
    )
    .forUpdate()
    .first();

  if (!recountLine) {
    throw new Error(
      `[INVENTORY_UNIT_RECOUNT_LINE_NOT_FOUND] Recount line ${normalizedInput.recountLineId} was not found for shop ${normalizedInput.shopId}`
    );
  }

  if (
    String(recountLine.lasyncro_variant_id) !==
    normalizedInput.lasyncroVariantId
  ) {
    throw new Error(
      `[INVENTORY_UNIT_RECOUNT_VARIANT_MISMATCH] Recount line ${normalizedInput.recountLineId} belongs to variant ${recountLine.lasyncro_variant_id}, not ${normalizedInput.lasyncroVariantId}`
    );
  }

  if (String(recountLine.location_code) !== locationCode) {
    throw new Error(
      `[INVENTORY_UNIT_RECOUNT_LOCATION_MISMATCH] Recount line ${normalizedInput.recountLineId} belongs to location ${recountLine.location_code}, not ${locationCode}`
    );
  }

  const readExisting = () =>
    trx('inventory_units')
      .where({
        shop_id: normalizedInput.shopId,
        recount_line_id: normalizedInput.recountLineId,
      })
      .orderBy('receive_sequence', 'asc')
      .select(
        'id',
        'lasyncro_unit_id',
        'receive_sequence',
        'receive_job_line_id',
        'recount_line_id',
        'lasyncro_variant_id',
        'source',
        'status',
        'current_location_code',
        'received_at'
      ) as Promise<RecountIssuedUnitRow[]>;

  const existing = await readExisting();

  if (existing.length > 0) {
    return assertRecountIssuance(
      normalizedInput,
      existing
    );
  }

  const rows = Array.from(
    { length: normalizedInput.quantity },
    (_, i) => {
      const sequence = i + 1;

      return {
        lasyncro_unit_id: generateLsuId(
          normalizedInput.shopId,
          normalizedInput.recountLineId,
          sequence
        ),
        shop_id: normalizedInput.shopId,
        lasyncro_variant_id:
          normalizedInput.lasyncroVariantId,
        receive_job_line_id: null,
        recount_line_id:
          normalizedInput.recountLineId,
        receive_sequence: sequence,
        ean: normalizedInput.ean ?? null,
        upc: normalizedInput.upc ?? null,
        shopify_barcode:
          normalizedInput.shopifyBarcode ?? null,
        source:
          'opening_inventory_reconcile',
        status: 'stowed',
        current_location_code:
          locationCode,
        reprint_count: 0,
        received_at:
          normalizedInput.canonicalizedAt,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }
  );

  await trx('inventory_units')
    .insert(rows)
    .onConflict([
      'shop_id',
      'recount_line_id',
      'receive_sequence',
    ])
    .ignore();

  const persisted =
    await readExisting();

  const units =
    assertRecountIssuance(
      normalizedInput,
      persisted
    );

  console.info(
    '[INVENTORY_UNIT] reconcile_issue',
    {
      shopId:
        normalizedInput.shopId,
      recountLineId:
        normalizedInput.recountLineId,
      quantity:
        normalizedInput.quantity,
      units:
        units.length,
    }
  );

  return units;
}

/**
 * Records a label print event on a set of units.
 * Called after thermal label print job is dispatched.
 *
 * GH-1085 — this is the operator's acknowledgement that the physical label was
 * printed AND attached, which is the only evidence that barcode-less stock can
 * actually be scanned. Recording it can therefore complete a receive job's
 * barcode readiness, so the affected parent job(s) are re-evaluated in the same
 * transaction. Without that, label_printed_at would be written and nothing
 * would ever move the job out of 'barcode_assignment'.
 *
 * refreshReadinessForUnits derives the jobs from the units, tolerates an empty
 * list, and handles units spanning several lines or jobs. It lives in a
 * dependency-neutral module so this service and receiveJob.service can both
 * use it without a cycle.
 */
export async function markLabelsPrinted(
  trx: Knex.Transaction,
  shopId: number,
  unitIds: string[]
): Promise<void> {
  if (unitIds.length === 0) return;

  const parents = await trx('inventory_units as iu')
    .join('receive_job_lines as l', 'l.receive_job_line_id', 'iu.receive_job_line_id')
    .join('receive_jobs as j', 'j.receive_job_id', 'l.receive_job_id')
    .where('iu.shop_id', shopId).where('l.shop_id', shopId).where('j.shop_id', shopId)
    .whereIn('iu.lasyncro_unit_id', unitIds).distinct('j.po_id', 'j.receive_job_id').orderBy('j.po_id').orderBy('j.receive_job_id');
  for (const parent of parents) await lockReceiveJob(trx, shopId, parent.receive_job_id);

  await trx('inventory_units')
    .whereIn('lasyncro_unit_id', unitIds)
    .where({ shop_id: shopId })
    .update({
      label_printed_at: new Date(),
      updated_at: new Date(),
    });

  await refreshReadinessForUnits(trx, shopId, unitIds);
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
  // Denominator: total physical stock on hand across all locations (inventory_truth
  // is the source of truth for what is physically present — staging + bins). Non-LSU
  // (legacy) stock lives here as variant-level quantities with no per-unit rows.
  const truthRow = await trx('inventory_truth')
    .where({ shop_id: shopId })
    .where('on_hand_quantity', '>', 0)
    .sum<{ sum: string }>('on_hand_quantity as sum')
    .first();
  const totalPhysical = Number(truthRow?.sum ?? 0);

  // Numerator: physical stock that is LSU-backed. Each active inventory_units row
  // (not shipped/lost) represents one physically-present labelled unit.
  const unitRow = await trx('inventory_units')
    .where({ shop_id: shopId })
    .whereNotIn('status', ['shipped', 'lost'])
    .count<{ count: string }>('* as count')
    .first();
  const labelled = Number(unitRow?.count ?? 0);

  // Guard: labelled can never exceed physical (would indicate truth/unit drift).
  const labelledClamped = Math.min(labelled, totalPhysical);
  const unlabelled = Math.max(0, totalPhysical - labelledClamped);
  const pct = totalPhysical === 0 ? 0 : Math.round((labelledClamped / totalPhysical) * 100);

  return {
    labelled_units: labelledClamped,
    total_active_units: totalPhysical,
    unlabelled_in_circulation: unlabelled,
    coverage_pct: pct,
  };
}