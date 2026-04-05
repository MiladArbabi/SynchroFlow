import db from '@lasyncro/backend-core/db.js';

import { validateProjectionContracts } from '../projections/contracts/projectionContractRegistry.js';
import {
  validateProjectionDependencyGraph,
  validateExecutionOrder
} from '../projections/contracts/projectionDependencyValidator.js';

import { projectionExecutionOrder } from '../projections/contracts/projectionExecutionOrder.js';

import fs from 'fs';
import path from 'path';

/**
 * PROJECTION PIPELINE ORDER GUARD
 * -------------------------------
 * Ensures the runtime reconciliation pipeline still matches
 * the canonical projection execution registry.
 *
 * If a projection is added to the runtime pipeline but not
 * registered in projectionExecutionOrder, the system fails fast.
 *
 * This prevents silent divergence between:
 *
 * - runtime reconciliation pipeline
 * - rebuild pipeline
 * - projection registry
 */
export function assertProjectionRegistered(name: string) {
  if (!projectionExecutionOrder.includes(name)) {
    fail(
      `[SchemaGuard] projection used in runtime pipeline but missing from projectionExecutionOrder: ${name}`
    );
  }
}

/**
 * SCHEMA GUARD
 * ============
 *
 * Purpose
 * -------
 * Detect projection/schema drift BEFORE workers start.
 *
 * Guarantees
 * ----------
 * • required columns exist
 * • snapshot invariants hold
 * • primary keys match projection conflict keys
 * • projection tables remain deterministic-rebuild compatible
 *
 * Behaviour
 * ---------
 * development → throws
 * production  → logs loudly but continues
 */

type TableContract = {
  table: string;
  required: string[];
  primaryKey?: string[];
};

function fail(message: string) {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(message);
  }
  console.error(message);
}

/**
 * PROJECTION COVERAGE GUARD
 * -------------------------
 * Ensures every projection implementation file
 * is registered in the projection safety system.
 *
 * Prevents silent projection drift.
 */
function assertProjectionCoverage() {

  const projectionDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../projections'
  );

  const files = fs
    .readdirSync(projectionDir)
    .filter(f => f.endsWith('Projection.ts'));

  const registered = new Set(projectionExecutionOrder);

  for (const file of files) {

    const name = file.replace('.ts', '');

    if (!registered.has(name)) {
      fail(
        `[SchemaGuard] projection not registered in execution order: ${name}`
      );
    }
  }

  console.debug('[SchemaGuard] Projection coverage verified');
}

/**
 * Fetch column metadata
 */
async function getColumns(table: string): Promise<Set<string>> {
  const info = await db(table).columnInfo();
  return new Set(Object.keys(info));
}

/**
 * Fetch primary key columns
 */
async function getPrimaryKey(table: string): Promise<string[]> {
  const rows = await db.raw(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = ?
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `, [table]);

  return rows.rows.map((r: any) => r.column_name);
}

/**
 * Validate a table contract
 */
async function validateTable(contract: TableContract) {
  const columns = await getColumns(contract.table);

  const missing = contract.required.filter(c => !columns.has(c));

  if (missing.length > 0) {
    fail(
      `[SchemaGuard] ${contract.table} missing columns: ${missing.join(', ')}`
    );
  }

  if (contract.primaryKey) {
    const actualPk = await getPrimaryKey(contract.table);

    const expected = contract.primaryKey.join(',');
    const actual = actualPk.join(',');

    if (expected !== actual) {
      fail(
        `[SchemaGuard] ${contract.table} PK mismatch (expected ${expected}, got ${actual})`
      );
    }
  }

  console.debug(`[SchemaGuard] ${contract.table} verified`);
}

/**
 * Decision Layer Schema Guard
 */
export async function assertDecisionSchema() {
  await validateTable({
    table: 'order_risk_snapshot',
    primaryKey: ['lasyncro_order_id', 'aggregate_version'],
    required: [
      'lasyncro_order_id',
      'aggregate_version',
      'shop_id',
      'is_inventory_blocked',
      'is_customer_blocked',
      'is_operational_blocked',
      'is_at_risk',
      'fraud_score',
      'return_probability',
      'order_health_score',
      'evaluated_at'
    ]
  });
}

/**
 * Control Snapshot Guard
 */
export async function assertControlSnapshotSchema() {
  await validateTable({
    table: 'orders_operational_control_snapshot',
    primaryKey: ['shop_id','snapshot_date'],
    required: [
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
      'evaluated_at'
    ]
  });
}

/**
 * Snapshot Invariant Guard
 *
 * Ensures all snapshot tables contain deterministic rebuild fields.
 */
async function assertSnapshotInvariants() {
  const snapshots = [
    'order_margin_snapshot',
    'order_age_snapshot',
    'order_risk_snapshot'
  ];

  const baseColumns = [
    'lasyncro_order_id',
    'aggregate_version'
  ];

  for (const table of snapshots) {
    const cols = await getColumns(table);

    const missing = baseColumns.filter(c => !cols.has(c));

    if (missing.length > 0) {
      fail(`[SchemaGuard] ${table} violates snapshot invariant`);
    }
  }

  console.debug('[SchemaGuard] Snapshot invariants verified');
}

/**
 * Projection Table Audit
 *
 * Ensures deterministic rebuild projections remain valid.
 */
async function assertProjectionTables() {
  await validateTable({
    table: 'revenue_projection_daily',
    primaryKey: ['shop_id','revenue_date'],
    required: [
      'shop_id',
      'revenue_date',
      'gross_revenue',
      'order_count',
      'at_risk_revenue',
      'evaluated_at'
    ]
  });

  await validateTable({
    table: 'daily_operational_brief_snapshot',
    primaryKey: ['shop_id','brief_date'],
    required: [
      'shop_id',
      'brief_date',
      'critical_orders_count',
      'negative_margin_orders_count',
      'sla_breached_count',
      'inventory_blocked_revenue',
      'cash_realized_today',
      'refund_exposure',
      'top_10_priority_order_ids',
      'evaluated_at'
    ]
  });
}

/**
 * Full Schema Audit
 *
 * Called during worker boot.
 */
export async function runSchemaGuard() {

  const start = Date.now();

  console.debug('[SchemaGuard] Starting schema audit');

  /**
   * LAYER 1
   * CORE DOMAIN TABLES
   */
  console.debug('[SchemaGuard] Verifying domain schemas');

  await assertDecisionSchema();
  await assertControlSnapshotSchema();


  /**
   * LAYER 2
   * PROJECTION TABLE STRUCTURE
   */
  console.debug('[SchemaGuard] Verifying projection tables');

  await assertProjectionTables();


  /**
   * LAYER 3
   * PROJECTION CONTRACTS
   */
  console.debug('[SchemaGuard] Verifying projection contracts');

  await validateProjectionContracts();


  /**
   * LAYER 4
   * PROJECTION DEPENDENCY GRAPH
   */
  console.debug('[SchemaGuard] Verifying projection dependency graph');

  validateProjectionDependencyGraph();
  validateExecutionOrder(projectionExecutionOrder);
  assertProjectionCoverage();

  /**
   * LAYER 5
   * SNAPSHOT INVARIANTS
   */
  console.debug('[SchemaGuard] Verifying snapshot invariants');

  await assertSnapshotInvariants();


  console.debug(
    '[SchemaGuard] Schema verification completed',
    { duration_ms: Date.now() - start }
  );

}