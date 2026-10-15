import { lockReceiveJob } from './receiveWorkflowLock.service.js';
import { Knex } from 'knex';
import crypto from 'crypto';
import { refreshReadinessForUnits } from './receiveBarcodeReadiness.service.js';

/**
 * INVENTORY UNIT SERVICE (WM-46)
 * --------------------------------
 * Manages per-unit LSU- barcode lifecycle.
 *
 * LSU- ID issuance (GH-1255 LSU-IDENTITY-01):
 *   New units: 'LSU-' + 10 zero-padded digits from the single global,
 *   noncycling sequence public.inventory_unit_lsu_seq (migration 0212).
 *   Identity is persisted, never derived: a committed retry for the same
 *   (shop, source line, receive_sequence) returns the stored LSU. A rolled-back
 *   transaction may leave a gap; gaps are valid.
 *   Legacy units keep 'LSU-' + SHA256(shop:anchor:sequence)[0:8]
 *   (generateLsuId), which is retained only to verify those stored rows.
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
 * Legacy deterministic LSU- identifier ('LSU-' + 8 hex). No longer used to
 * mint units (GH-1255); retained so previously issued rows can be verified.
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

const LSU_SEQUENCE = 'public.inventory_unit_lsu_seq';
const SEQUENCE_LSU = /^LSU-\d{10}$/;
const LEGACY_LSU = /^LSU-[0-9a-f]{8}$/;

/**
 * A known Receive issuance conflict: the line's persisted units disagree with
 * this request. Carries the shared statusCode/errorCode convention so the
 * caller answers 409 with a stable code; unexpected errors stay plain.
 */
function issuanceConflict(errorCode: string, message: string): Error {
  return Object.assign(new Error(`[${errorCode}] ${message}`), { statusCode: 409, errorCode });
}

function assertIssuanceQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`[INVENTORY_UNIT_QUANTITY_INVALID] Unit issuance requires a positive integer quantity, got ${quantity}`);
  }
}

/**
 * Allocates `count` new LSU identities from the global sequence, ascending.
 * Exhaustion is refused: the sequence never cycles, so no identity is reissued.
 */
async function allocateLsuIds(trx: Knex.Transaction, count: number): Promise<string[]> {
  let values: string[];
  try {
    const result = await trx.raw(
      `SELECT nextval('${LSU_SEQUENCE}')::text AS value FROM generate_series(1, ?::int)`,
      [count]
    );
    values = result.rows.map((row: { value: string }) => row.value);
  } catch (err: any) {
    if (err?.code === '2200H') {
      throw Object.assign(
        new Error('[INVENTORY_UNIT_LSU_SEQUENCE_EXHAUSTED] No new LSU identity can be issued'),
        { code: '2200H', cause: err }
      );
    }
    throw err;
  }

  return values.map((value) => {
    const id = `LSU-${value.padStart(10, '0')}`;
    if (!SEQUENCE_LSU.test(id)) {
      throw new Error(`[INVENTORY_UNIT_LSU_SEQUENCE_INVALID] Sequence value ${value} is not a 10-digit LSU identity`);
    }
    return id;
  });
}

/**
 * Batch-confirms a receive job line — creates one inventory_units row per unit
 * and marks all labels as pending print.
 *
 * Sequences are assigned 1–N in bulk (batch-confirm model). The source line is
 * locked and must belong to this shop and variant, so concurrent issuers for
 * the same line serialize here. A committed retry returns the persisted units
 * (legacy or sequence-issued) instead of minting new ones; a retry whose
 * quantity or lineage disagrees with them fails closed. New identities come
 * from the global sequence, and the insert has no conflict clause: a global
 * identity collision or an unexpected lineage conflict aborts the caller.
 *
 * Returns the line's unit rows (lasyncro_unit_id + receive_sequence) for label printing.
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

  assertIssuanceQuantity(quantity);

  const line = await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_line_id: receiveJobLineId })
    .forUpdate()
    .first('receive_job_line_id', 'lasyncro_variant_id');

  if (!line) {
    throw new Error(
      `[INVENTORY_UNIT_RECEIVE_LINE_NOT_FOUND] Receive line ${receiveJobLineId} was not found for shop ${shopId}`
    );
  }

  if (String(line.lasyncro_variant_id) !== lasyncroVariantId) {
    throw new Error(
      `[INVENTORY_UNIT_RECEIVE_VARIANT_MISMATCH] Receive line ${receiveJobLineId} belongs to variant ${line.lasyncro_variant_id}, not ${lasyncroVariantId}`
    );
  }

  const existing = await trx('inventory_units')
    .where({ shop_id: shopId, receive_job_line_id: receiveJobLineId })
    .orderBy('receive_sequence', 'asc')
    .select('id', 'lasyncro_unit_id', 'receive_sequence', 'lasyncro_variant_id', 'recount_line_id', 'source');

  if (existing.length > 0) {
    if (existing.length !== quantity) {
      throw issuanceConflict(
        'INVENTORY_UNIT_RECEIVE_ISSUANCE_MISMATCH',
        `Expected ${quantity} units for receive line ${receiveJobLineId}, found ${existing.length}`
      );
    }
    existing.forEach((row: any, i: number) => {
      // A legacy-shaped identity is deterministic, so it must be the derivation
      // of this exact lineage. Sequence-issued and other historical identities
      // (e.g. reviewer-seed 'LSU-<RUN>-<n>') are persisted facts, returned as is.
      const misderivedLegacy =
        LEGACY_LSU.test(row.lasyncro_unit_id) &&
        row.lasyncro_unit_id !== generateLsuId(shopId, receiveJobLineId, i + 1);
      if (
        misderivedLegacy ||
        row.receive_sequence !== i + 1 ||
        row.lasyncro_variant_id !== lasyncroVariantId ||
        row.recount_line_id !== null ||
        row.source !== 'lasyncro_receive'
      ) {
        throw issuanceConflict(
          'INVENTORY_UNIT_RECEIVE_ISSUANCE_INVARIANT',
          `Canonical LSU lineage mismatch for receive line ${receiveJobLineId}`
        );
      }
    });
    return existing.map((row: any) => ({
      id: row.id,
      lasyncro_unit_id: row.lasyncro_unit_id,
      receive_sequence: row.receive_sequence,
    }));
  }

  const ids = await allocateLsuIds(trx, quantity);
  const rows = ids.map((lasyncroUnitId, i) => ({
    lasyncro_unit_id: lasyncroUnitId,
    shop_id: shopId,
    lasyncro_variant_id: lasyncroVariantId,
    receive_job_line_id: receiveJobLineId,
    receive_sequence: i + 1,
    ean: ean ?? null,
    upc: upc ?? null,
    shopify_barcode: shopifyBarcode ?? null,
    source: 'lasyncro_receive',
    status: 'received',
    reprint_count: 0,
    received_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }));

  const created = await trx('inventory_units')
    .insert(rows)
    .returning(['id', 'lasyncro_unit_id', 'receive_sequence']);

  console.info('[INVENTORY_UNIT] batch_confirm', {
    shopId,
    receiveJobLineId,
    quantity,
    created: created.length,
  });

  return created.sort((a: InventoryUnitRow, b: InventoryUnitRow) => a.receive_sequence - b.receive_sequence);
}

export interface HeldUnitIssuanceInput {
  shopId: number;
  heldCaptureId: string;
  lasyncroVariantId: string;
  quantity: number;
  shopifyBarcode?: string | null;
}

/**
 * GH-1254 S4-B: issues one held LSU per recoverable physical unit of a held
 * capture (migration 0213). Held units hang off the capture — never the
 * Receive line — so accepted-line replay, readiness, labels and Stow never see
 * them. They are born 'held' with no location and the database keeps them
 * there until S4-E. Identity comes from the same global sequence as every new
 * unit; a committed retry for the capture returns the stored units.
 */
export async function issueHeldReceiveUnits(
  trx: Knex.Transaction,
  input: HeldUnitIssuanceInput
): Promise<InventoryUnitRow[]> {
  const { shopId, heldCaptureId, lasyncroVariantId, quantity, shopifyBarcode } = input;
  assertIssuanceQuantity(quantity);

  const existing = await trx('inventory_units')
    .where({ shop_id: shopId, receive_held_capture_id: heldCaptureId })
    .orderBy('receive_sequence', 'asc')
    .select('id', 'lasyncro_unit_id', 'receive_sequence', 'lasyncro_variant_id', 'source', 'status');
  if (existing.length > 0) {
    const consistent = existing.length === quantity && existing.every((row: any, i: number) =>
      row.receive_sequence === i + 1 && row.lasyncro_variant_id === lasyncroVariantId
      && row.source === 'receive_held_recoverable' && row.status === 'held');
    if (!consistent) {
      throw issuanceConflict('INVENTORY_UNIT_HELD_ISSUANCE_INVARIANT', `Held LSU lineage mismatch for capture ${heldCaptureId}`);
    }
    return existing.map((row: any) => ({ id: row.id, lasyncro_unit_id: row.lasyncro_unit_id, receive_sequence: row.receive_sequence }));
  }

  const ids = await allocateLsuIds(trx, quantity);
  const now = new Date();
  const created = await trx('inventory_units')
    .insert(ids.map((lasyncroUnitId, i) => ({
      lasyncro_unit_id: lasyncroUnitId,
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      receive_job_line_id: null,
      receive_held_capture_id: heldCaptureId,
      receive_sequence: i + 1,
      shopify_barcode: shopifyBarcode ?? null,
      source: 'receive_held_recoverable',
      status: 'held',
      current_location_code: null,
      reprint_count: 0,
      received_at: now,
      created_at: now,
      updated_at: now,
    })))
    .returning(['id', 'lasyncro_unit_id', 'receive_sequence']);

  console.info('[INVENTORY_UNIT] held_issue', { shopId, heldCaptureId, quantity, created: created.length });
  return created.sort((a: InventoryUnitRow, b: InventoryUnitRow) => a.receive_sequence - b.receive_sequence);
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
    // A stored identity is either the legacy derivation of this exact lineage
    // or a sequence-issued LSU; it is verified, never regenerated.
    const canonicalIdentity =
      row.lasyncro_unit_id === generateLsuId(input.shopId, input.recountLineId, sequence) ||
      SEQUENCE_LSU.test(row.lasyncro_unit_id);

    if (
      row.receive_job_line_id !== null ||
      row.recount_line_id !== input.recountLineId ||
      row.lasyncro_variant_id !== input.lasyncroVariantId ||
      row.receive_sequence !== sequence ||
      !canonicalIdentity ||
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

  assertIssuanceQuantity(normalizedInput.quantity);
  const ids = await allocateLsuIds(trx, normalizedInput.quantity);

  const rows = ids.map(
    (lasyncroUnitId, i) => {
      const sequence = i + 1;

      return {
        lasyncro_unit_id: lasyncroUnitId,
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

  // The recount line is locked above, so no concurrent issuer can race this
  // insert; any uniqueness conflict (including a global LSU collision) aborts.
  await trx('inventory_units')
    .insert(rows);

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
  // (not shipped/lost) represents one physically-present labelled unit. Held
  // units (GH-1254 S4-B) are outside inventory_truth, so they never count here.
  const unitRow = await trx('inventory_units')
    .where({ shop_id: shopId })
    .whereRaw(`status::text NOT IN ('shipped', 'lost', 'held')`)
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