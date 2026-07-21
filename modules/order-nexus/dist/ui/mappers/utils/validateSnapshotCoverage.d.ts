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
export declare function validateSnapshotCoverage(snapshot: Record<string, unknown>, coverage: Record<string, 'signal' | 'ignored'>): void;
