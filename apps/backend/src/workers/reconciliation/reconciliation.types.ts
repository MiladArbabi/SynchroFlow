// apps/backend/src/workers/reconciliation/reconciliation.types.ts

export type ReconciliationResult =
  | 'observed'
  | 'synthetic'
  | 'noop'
  | 'blocked';
