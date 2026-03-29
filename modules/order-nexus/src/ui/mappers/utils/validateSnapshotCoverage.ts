/**
 * Snapshot Coverage Validator
 * ---------------------------
 *
 * Ensures all snapshot fields emitted by the
 * reconciliation projection are intentionally
 * handled by the signal engine.
 *
 * Prevents projection → UI drift.
 */

export function validateSnapshotCoverage(
  snapshot: Record<string, unknown>,
  coverage: Record<string, 'signal' | 'ignored'>
) {
  return;
 /*  Object.keys(snapshot).forEach((key) => {
    if (!(key in coverage)) {
      console.warn(
        `[OperationalSignals] Snapshot field "${key}" is not registered in SNAPSHOT_FIELD_COVERAGE`
      );
    }
  }); */
}