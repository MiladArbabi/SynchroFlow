// apps/backend/src/services/wms/receiveBarcodeReadiness.service.ts
import { Knex } from 'knex';

/**
 * RECEIVE BARCODE READINESS (GH-1085 / BARCODE-LIFECYCLE-01, Slice B)
 * -------------------------------------------------------------------
 * The single authority on whether accepted stock on a receive job can
 * physically be scanned, and therefore whether it may move to Stow.
 *
 * WHY THIS EXISTS
 * ---------------
 * Shopify paused App Store review (ref 102766) over barcodes that never
 * generated. Minting identity fixed half of it; the other half is that a
 * minted identity is worthless until it is physically ON the box. Stock that
 * reaches a bin unscannable cannot be picked, and no later stage can recover
 * it — so the gate belongs at receive close.
 *
 * AUTHORITATIVE RULE — an inspected accepted line is ready when:
 *     quantity_accepted <= 0
 *   OR trim(variants.barcode) is non-empty        (merchant's own EAN/UPC/GTIN)
 *   OR every accepted inventory_unit for the line has label_printed_at NOT NULL
 *
 * WHAT DELIBERATELY DOES NOT COUNT
 * --------------------------------
 *   variants.lasyncro_barcode (LSP-)  catalog identity, one value shared by
 *                                     every unit of the SKU — it cannot tell
 *                                     two physical units apart on a shelf.
 *   existence of LSU- rows            a database row is not a sticker.
 *   a generated / downloaded PDF      producing a label proves nothing about
 *                                     the box. label_printed_at is the
 *                                     operator's acknowledgement that the
 *                                     label was printed AND attached.
 *
 * FAIL CLOSED: if the number of inventory_units for an accepted line does not
 * match quantity_accepted, the evidence disagrees with itself and the line is
 * NOT ready. Guessing in either direction risks unscannable stock on a shelf.
 *
 * DEPENDENCY-NEUTRAL BY DESIGN: this module imports nothing from
 * receiveJob.service or inventoryUnit.service, so both can import it without a
 * cycle. It never closes a job and never creates a Stow task — it only decides
 * readiness and reflects that decision in receive_jobs.status.
 *
 * Caller must supply a transaction with app.current_tenant set; every query
 * here is additionally shop-scoped.
 */

export type LineReadinessReason =
  | 'not_inspected'
  | 'no_accepted_units'
  | 'external_barcode'
  | 'labels_acknowledged'
  | 'labels_outstanding'
  | 'unit_evidence_mismatch';

export interface ReceiveLineReadiness {
  receiveJobLineId: string;
  lasyncroVariantId: string | null;
  inspectionComplete: boolean;
  quantityAccepted: number;
  hasExternalBarcode: boolean;
  acceptedUnitCount: number;
  labelledUnitCount: number;
  ready: boolean;
  reason: LineReadinessReason;
}

export interface ReceiveJobReadiness {
  receiveJobId: string;
  /** Every line has been inspected — readiness is only meaningful after this. */
  allInspected: boolean;
  /** allInspected AND every line ready. */
  ready: boolean;
  /** The status this job should hold, or null while inspection is outstanding. */
  status: 'stow_ready' | 'barcode_assignment' | null;
  lines: ReceiveLineReadiness[];
  /** Inspected lines that are holding the job back. */
  blockingLines: ReceiveLineReadiness[];
}

/** Thrown by assertReceiveJobBarcodeReady. */
export const RECEIVE_BARCODE_READINESS_REQUIRED = 'RECEIVE_BARCODE_READINESS_REQUIRED';

/**
 * Statuses whose meaning this service owns. 'closed' and 'cancelled' are
 * terminal and must never be reopened by a readiness recomputation.
 */
const MUTABLE_STATUSES = [
  'pending',
  'in_progress',
  'inspection',
  'barcode_assignment',
  'stow_ready',
];

interface ReadinessRow {
  receive_job_line_id: string;
  lasyncro_variant_id: string | null;
  quantity_accepted: string | number;
  inspection_complete: boolean;
  external_barcode: string | null;
  unit_count: string | number;
  labelled_count: string | number;
}

function classifyLine(row: ReadinessRow): ReceiveLineReadiness {
  const quantityAccepted = Number(row.quantity_accepted ?? 0);
  const acceptedUnitCount = Number(row.unit_count ?? 0);
  const labelledUnitCount = Number(row.labelled_count ?? 0);
  const hasExternalBarcode = !!row.external_barcode;

  const base = {
    receiveJobLineId: row.receive_job_line_id,
    lasyncroVariantId: row.lasyncro_variant_id,
    inspectionComplete: !!row.inspection_complete,
    quantityAccepted,
    hasExternalBarcode,
    acceptedUnitCount,
    labelledUnitCount,
  };

  // Readiness is a statement about INSPECTED stock. An uninspected line has
  // not yet said what arrived, so it cannot be ready.
  if (!base.inspectionComplete) {
    return { ...base, ready: false, reason: 'not_inspected' };
  }

  // Nothing was accepted — there is no physical unit to identify.
  if (quantityAccepted <= 0) {
    return { ...base, ready: true, reason: 'no_accepted_units' };
  }

  // The merchant already ships scannable stock. Forcing LSU- relabelling here
  // would be busywork they never asked for.
  if (hasExternalBarcode) {
    return { ...base, ready: true, reason: 'external_barcode' };
  }

  // Fail closed on contradictory evidence rather than guessing.
  if (acceptedUnitCount !== quantityAccepted) {
    return { ...base, ready: false, reason: 'unit_evidence_mismatch' };
  }

  if (labelledUnitCount === quantityAccepted) {
    return { ...base, ready: true, reason: 'labels_acknowledged' };
  }

  return { ...base, ready: false, reason: 'labels_outstanding' };
}

/**
 * Read-only readiness computation. Derives everything from canonical state —
 * never from receive_jobs.status, which is a cached reflection of this answer.
 */
export async function evaluateReceiveJobBarcodeReadiness(
  trx: Knex.Transaction,
  shopId: number,
  receiveJobId: string
): Promise<ReceiveJobReadiness> {
  const result = await trx.raw(
    `
    SELECT
      rjl.receive_job_line_id,
      rjl.lasyncro_variant_id,
      rjl.quantity_accepted,
      rjl.inspection_complete,
      NULLIF(BTRIM(COALESCE(v.barcode, '')), '') AS external_barcode,
      COALESCE(u.unit_count, 0)     AS unit_count,
      COALESCE(u.labelled_count, 0) AS labelled_count
    FROM receive_job_lines rjl
    LEFT JOIN variants v
      ON v.lasyncro_variant_id = rjl.lasyncro_variant_id
     AND v.shop_id = rjl.shop_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS unit_count,
        COUNT(*) FILTER (WHERE iu.label_printed_at IS NOT NULL)::int AS labelled_count
      FROM inventory_units iu
      WHERE iu.shop_id = rjl.shop_id
        AND iu.receive_job_line_id = rjl.receive_job_line_id
    ) u ON TRUE
    WHERE rjl.shop_id = ?
      AND rjl.receive_job_id = ?
      -- GH-1241 S3-B: only a grouped-finalized job excludes its expected-zero
      -- lines that the finalization left out; nothing else is ever excluded.
      AND NOT (
        rjl.quantity_expected = 0
        AND EXISTS (
          SELECT 1 FROM receive_reconciliation_finalizations f
           WHERE f.shop_id = rjl.shop_id AND f.receive_job_id = rjl.receive_job_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM receive_reconciliation_finalization_lines fl
           WHERE fl.shop_id = rjl.shop_id AND fl.receive_job_line_id = rjl.receive_job_line_id
        )
      )
    ORDER BY rjl.receive_job_line_id
    `,
    [shopId, receiveJobId]
  );

  const lines = (result.rows as ReadinessRow[]).map(classifyLine);
  const allInspected = lines.length > 0 && lines.every((l) => l.inspectionComplete);
  const ready = allInspected && lines.every((l) => l.ready);

  return {
    receiveJobId,
    allInspected,
    ready,
    status: allInspected ? (ready ? 'stow_ready' : 'barcode_assignment') : null,
    lines,
    blockingLines: lines.filter((l) => l.inspectionComplete && !l.ready),
  };
}

/**
 * Evaluates, then reflects the answer in receive_jobs.status.
 *
 * A job with inspection still outstanding is left exactly where it is — this
 * service never invents a lifecycle transition for work that has not happened.
 * Terminal statuses are never rewritten.
 */
export async function applyReceiveJobBarcodeReadiness(
  trx: Knex.Transaction,
  shopId: number,
  receiveJobId: string
): Promise<ReceiveJobReadiness> {
  const readiness = await evaluateReceiveJobBarcodeReadiness(trx, shopId, receiveJobId);

  if (readiness.status) {
    await trx('receive_jobs')
      .where({ receive_job_id: receiveJobId, shop_id: shopId })
      .whereIn('status', MUTABLE_STATUSES)
      .update({ status: readiness.status, updated_at: new Date() });
  }

  console.info('[RECEIVE_BARCODE_READINESS]', {
    shopId,
    receiveJobId,
    allInspected: readiness.allInspected,
    ready: readiness.ready,
    status: readiness.status,
    blocking: readiness.blockingLines.map((l) => ({
      receive_job_line_id: l.receiveJobLineId,
      reason: l.reason,
      accepted: l.quantityAccepted,
      labelled: l.labelledUnitCount,
    })),
  });

  return readiness;
}

/**
 * Gate for any operation that would let stock leave receiving.
 * Throws RECEIVE_BARCODE_READINESS_REQUIRED with the blocking detail attached.
 */
export async function assertReceiveJobBarcodeReady(
  trx: Knex.Transaction,
  shopId: number,
  receiveJobId: string
): Promise<ReceiveJobReadiness> {
  const readiness = await evaluateReceiveJobBarcodeReadiness(trx, shopId, receiveJobId);

  if (!readiness.ready) {
    const detail = readiness.blockingLines
      .map((l) => `${l.receiveJobLineId}:${l.reason}(${l.labelledUnitCount}/${l.quantityAccepted})`)
      .join(',');
    // GH-1241 S3C-M4 — an operator-state refusal, not a server failure: callers
    // that honour statusCode/errorCode answer 409 with this machine-readable code.
    throw Object.assign(
      new Error(
        `${RECEIVE_BARCODE_READINESS_REQUIRED}: accepted units on job ${receiveJobId} ` +
          `have no physical barcode label acknowledgement${detail ? ` [${detail}]` : ''}`
      ),
      { statusCode: 409, errorCode: RECEIVE_BARCODE_READINESS_REQUIRED }
    );
  }

  return readiness;
}

/**
 * Re-evaluates every receive job touched by a set of acknowledged units.
 * Used by the label-acknowledgement path, which knows units rather than jobs.
 */
export async function refreshReadinessForUnits(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroUnitIds: string[]
): Promise<void> {
  if (lasyncroUnitIds.length === 0) return;

  const jobs = await trx('inventory_units as iu')
    .join('receive_job_lines as rjl', function joinLines() {
      this.on('rjl.receive_job_line_id', 'iu.receive_job_line_id')
        .andOn('rjl.shop_id', 'iu.shop_id');
    })
    .where('iu.shop_id', shopId)
    .whereIn('iu.lasyncro_unit_id', lasyncroUnitIds)
    .distinct('rjl.receive_job_id');

  for (const row of jobs) {
    await applyReceiveJobBarcodeReadiness(trx, shopId, row.receive_job_id as string);
  }
}
