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

/**
 * Control Snapshot Schema Guard
 * ------------------------------
 * Ensures Control-Tower compression layer
 * remains structurally compatible with API surface.
 */
export async function assertControlSnapshotSchema() {
  const columns = await db('orders_operational_control_snapshot')
    .columnInfo();

  const required = [
    'shop_id',
    'snapshot_date',
    'realized_revenue',
    'at_risk_revenue',
    'blocked_revenue',
    'revenue_leakage',
    'avg_contribution_margin_pct',
    'orders_at_sla_risk',
    'aging_24h',
    'aging_48h',
    'aging_72h_plus',
    'pending_fulfillment',
    'pending_payment',
    'exception_orders',
    'constrained_orders',
    'revenue_blocked_inventory',
    'revenue_blocked_customer',
    'revenue_blocked_operational',
    'queue_manual_review',
    'queue_awaiting_inventory',
    'queue_ready_to_ship',
    'queue_awaiting_customer',
    'evaluated_at',
  ];

  const missing = required.filter((c) => !columns[c]);

  if (missing.length > 0) {
    console.error('[SchemaGuard][ControlSnapshot] Missing columns', missing);

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `Control snapshot schema mismatch: ${missing.join(', ')}`
      );
    }
  }

  console.debug('[SchemaGuard][ControlSnapshot] Schema verified');
}