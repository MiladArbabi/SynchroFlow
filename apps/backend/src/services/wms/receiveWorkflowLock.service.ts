import type { Knex } from 'knex';

export const ACTIVE_RECEIVE_STATUSES = ['pending', 'in_progress', 'inspection', 'barcode_assignment', 'stow_ready'];

export function receiveError(message: string, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

/** GH-1245: every Receive writer takes PO -> job -> line -> units.
 * The initial job lookup takes no lock; po_id is immutable in this workflow.
 * Re-read status under the job lock before permitting any write.
 */
export async function lockReceiveJob(trx: Knex.Transaction, shopId: number, jobId: string) {
  const anchor = await trx('receive_jobs').where({ shop_id: shopId, receive_job_id: jobId }).first('po_id');
  if (!anchor) throw receiveError('Receive job not found', 404);
  const po = await trx('purchase_orders').where({ shop_id: shopId, id: anchor.po_id }).forUpdate().first();
  if (!po) throw receiveError('Purchase order not found', 404);
  const job = await trx('receive_jobs').where({ shop_id: shopId, receive_job_id: jobId }).forUpdate().first();
  if (!job || job.po_id !== po.id) throw receiveError('Receive job not found', 404);
  return { po, job };
}

export function assertReceiveMutable(job: any) {
  if (!ACTIVE_RECEIVE_STATUSES.includes(job.status)) throw receiveError('Receive job is terminal');
}

/** GH-1241 S3-B: line ids of the job's immutable grouped finalization, or null when it has none. */
export async function groupedFinalizedLineIds(
  trx: Knex.Transaction, shopId: number, jobId: string
): Promise<Set<string> | null> {
  const finalization = await trx('receive_reconciliation_finalizations')
    .where({ shop_id: shopId, receive_job_id: jobId }).first('reconciliation_id');
  if (!finalization) return null;
  const rows = await trx('receive_reconciliation_finalization_lines')
    .where({ shop_id: shopId, reconciliation_id: finalization.reconciliation_id }).select('receive_job_line_id');
  return new Set(rows.map((r: any) => r.receive_job_line_id as string));
}

/**
 * GH-1241 S3-B: a grouped finalization is immutable. Per-line accounting
 * writers refuse once it exists; corrections belong to a compensating workflow.
 * Call under the job lock.
 */
export async function assertReceiveNotGroupFinalized(trx: Knex.Transaction, shopId: number, jobId: string) {
  if (await groupedFinalizedLineIds(trx, shopId, jobId)) {
    throw Object.assign(
      receiveError('RECEIVE_RECONCILIATION_FINALIZED: this Receive was finalized as a group; its accounting cannot change'),
      { errorCode: 'RECEIVE_RECONCILIATION_FINALIZED' },
    );
  }
}
