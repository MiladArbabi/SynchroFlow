import db from '@lasyncro/backend-core/db.js';

/**
 * Decision Layer Schema Guard
 * ----------------------------
 * Prevent silent API drift if base migrations change.
 *
 * Fails fast in development.
 * Logs loudly in production.
 */
export async function assertDecisionSchema() {
  const columns = await db('order_risk_snapshot')
    .columnInfo();

  const required = [
    'lasyncro_order_id',
    'shop_id',
    'order_health_score',
    'is_inventory_blocked',
    'is_customer_blocked',
    'is_operational_blocked',
    'is_at_risk',
    'fraud_score',
    'return_probability',
    'evaluated_at',
  ];

  const missing = required.filter((c) => !columns[c]);

  if (missing.length > 0) {
    console.error('[SchemaGuard][Decision] Missing columns', missing);

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `Decision schema mismatch: ${missing.join(', ')}`
      );
    }
  }

  console.debug('[SchemaGuard][Decision] Schema verified');
}