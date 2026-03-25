/**
 * PROJECTION HANDLER — reconciliation/intent_captured
 * ---------------------------------------------------
 * This event is a control-plane signal used to trigger
 * reconciliation workflows.
 *
 * It MUST NOT mutate read models.
 * It exists purely for:
 * - auditability
 * - deterministic replay trace
 *
 * Therefore:
 * → NO-OP handler (explicitly intentional)
 */
export async function handleReconciliationIntentCaptured() {
  console.debug('[PROJECTION_NOOP_RECONCILIATION_INTENT_CAPTURED]');
}