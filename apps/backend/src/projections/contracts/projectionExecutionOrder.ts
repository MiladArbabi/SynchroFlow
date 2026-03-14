/**
 * PROJECTION EXECUTION ORDER
 * ==========================
 *
 * Canonical deterministic execution order for all projections.
 *
 * CRITICAL INVARIANT
 * ------------------
 * This order MUST match the reconciliation execution order in:
 *
 * workers/reconciliation/reconciliation.handlers.ts
 *
 * If the order diverges, SchemaGuard will detect dependency violations.
 *
 * Any projection added must also be updated in:
 *
 * - projectionContracts.ts
 * - projectionDependencies.ts
 * - reconciliation.handlers.ts
 *
 * This prevents silent projection drift.
 */
export const projectionExecutionOrder = [
  'orderFulfillmentProjection',
  'orderInventoryConstraintProjection',
  'orderConstraintProjection',
  'orderMarginProjection',
  'orderRiskProjection',
  'orderAgeProjection',
  'orderRevenueDailyProjection',
  'dailyOperationalBriefProjection'
];