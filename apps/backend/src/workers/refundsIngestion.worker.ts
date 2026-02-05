/**
 * refundsIngestion.worker.ts
 * -------------------------
 * DEPRECATED.
 *
 * Refunds are now written directly to refund_executions
 * at webhook ingress time.
 *
 * This worker is intentionally inert to prevent:
 * - canonical_returns writes
 * - SKU-based revenue mutation
 * - refund drops due to ordering
 */
export function startRefundsIngestionWorker() {
  console.warn('[refundsIngestion.worker] DEPRECATED — no-op');
}
