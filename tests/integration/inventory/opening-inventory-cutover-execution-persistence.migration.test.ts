// GH-1179 Slice E / E01 — planned MIGRATION 0203
//
// Permanent DB contract for mutable Opening Inventory cutover EXECUTION and
// verification evidence.
//
// Slice D (0201/0202) remains immutable request authority:
//   opening_inventory_cutover_generations
//   opening_inventory_cutover_generation_entries
//   opening_inventory_cutover_generation_batches
//
// Slice E (0203) owns separate mutable execution/evidence state:
//   opening_inventory_cutover_executions
//   opening_inventory_cutover_batch_executions
//   opening_inventory_cutover_batch_attempts
//   opening_inventory_cutover_verifications
//   opening_inventory_cutover_verification_lines
// plus ONE additive tenant-qualified UNIQUE (generation_id, shop_id,
// batch_index) on the immutable Slice-D batch table, without editing 0201.
//
// RED GATE
//   Every schema scenario first calls requireSliceESchema(); every scenario
//   that loads the real 0203 source first calls requireMigration0203(). While
//   0203 does not exist each gated scenario fails with the same single causal
//   message instead of a cascade of unrelated schema noise.
//
// This suite is schema/database-contract only.
// No Shopify client, executor, controller, frontend, or external I/O.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import knexLib, { Knex } from 'knex';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';

const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const VERIFICATION_LINES = 'opening_inventory_cutover_verification_lines';

const SLICE_E_TABLES = [
  EXECUTIONS,
  BATCH_EXECUTIONS,
  ATTEMPTS,
  VERIFICATIONS,
  VERIFICATION_LINES,
];

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../apps/backend/migrations'
);

const MIGRATION_0201 =
  '20261002123000_0201_create_opening_inventory_cutover_generations.ts';

// sha256 of 0201 at c0ddb3c18676af78ee7b8368ac1e0d065fb1f5f3.
const MIGRATION_0201_SHA256 =
  '68b1c9e2b47fd0e664f076a743782684bffe6964333eaaa333a3e3f2660dabe0';

type ColumnContract = {
  nullable: boolean;
  udt: string[];
};

const TEXT = ['text', 'varchar'];
const BIGINT = ['int8'];
const INTEGER = ['int4'];
const UUID = ['uuid'];
const TIMESTAMPTZ = ['timestamptz'];
const BOOL = ['bool'];
const JSONB = ['jsonb'];

const EXECUTION_COLUMNS: Record<string, ColumnContract> = {
  execution_id:        { nullable: false, udt: UUID },
  shop_id:             { nullable: false, udt: BIGINT },
  generation_id:       { nullable: false, udt: UUID },
  status:              { nullable: false, udt: TEXT },
  lease_token:         { nullable: true,  udt: UUID },
  lease_expires_at:    { nullable: true,  udt: TIMESTAMPTZ },
  lease_heartbeat_at:  { nullable: true,  udt: TIMESTAMPTZ },
  started_at:          { nullable: false, udt: TIMESTAMPTZ },
  updated_at:          { nullable: false, udt: TIMESTAMPTZ },
  blocked_at:          { nullable: true,  udt: TIMESTAMPTZ },
  blocked_reason:      { nullable: true,  udt: TEXT },
  terminal_at:         { nullable: true,  udt: TIMESTAMPTZ },
  terminal_reason:     { nullable: true,  udt: TEXT },
};

const BATCH_EXECUTION_COLUMNS: Record<string, ColumnContract> = {
  generation_id:               { nullable: false, udt: UUID },
  batch_index:                 { nullable: false, udt: INTEGER },
  shop_id:                     { nullable: false, udt: BIGINT },
  execution_id:                { nullable: false, udt: UUID },
  status:                      { nullable: false, udt: TEXT },
  attempt_count:               { nullable: false, udt: INTEGER },
  shopify_adjustment_group_id: { nullable: true,  udt: TEXT },
  succeeded_at:                { nullable: true,  udt: TIMESTAMPTZ },
  updated_at:                  { nullable: false, udt: TIMESTAMPTZ },
};

const ATTEMPT_COLUMNS: Record<string, ColumnContract> = {
  attempt_id:                  { nullable: false, udt: UUID },
  shop_id:                     { nullable: false, udt: BIGINT },
  execution_id:                { nullable: false, udt: UUID },
  generation_id:               { nullable: false, udt: UUID },
  batch_index:                 { nullable: false, udt: INTEGER },
  attempt_number:              { nullable: false, udt: INTEGER },
  dispatch_lease_token:        { nullable: false, udt: UUID },
  finalized_by_lease_token:    { nullable: true,  udt: UUID },
  request_sha256:              { nullable: false, udt: TEXT },
  requested_api_version:       { nullable: false, udt: TEXT },
  started_at:                  { nullable: false, udt: TIMESTAMPTZ },
  finalized_at:                { nullable: true,  udt: TIMESTAMPTZ },
  outcome:                     { nullable: true,  udt: TEXT },
  http_status:                 { nullable: true,  udt: INTEGER },
  x_request_id:                { nullable: true,  udt: TEXT },
  served_api_version:          { nullable: true,  udt: TEXT },
  user_errors:                 { nullable: true,  udt: JSONB },
  shopify_adjustment_group_id: { nullable: true,  udt: TEXT },
  error_class:                 { nullable: true,  udt: TEXT },
  error_detail:                { nullable: true,  udt: TEXT },
};

const VERIFICATION_COLUMNS: Record<string, ColumnContract> = {
  verification_id:          { nullable: false, udt: UUID },
  shop_id:                  { nullable: false, udt: BIGINT },
  execution_id:             { nullable: false, udt: UUID },
  generation_id:            { nullable: false, udt: UUID },
  purpose:                  { nullable: false, udt: TEXT },
  batch_index:              { nullable: true,  udt: INTEGER },
  started_by_lease_token:   { nullable: false, udt: UUID },
  finalized_by_lease_token: { nullable: true,  udt: UUID },
  status:                   { nullable: false, udt: TEXT },
  requested_api_version:    { nullable: false, udt: TEXT },
  served_api_version:       { nullable: true,  udt: TEXT },
  page_count:               { nullable: false, udt: INTEGER },
  read_started_at:          { nullable: false, udt: TIMESTAMPTZ },
  read_completed_at:        { nullable: true,  udt: TIMESTAMPTZ },
  readiness_passed:         { nullable: true,  udt: BOOL },
  target_fingerprint:       { nullable: true,  udt: TEXT },
  identity_fingerprint:     { nullable: true,  udt: TEXT },
  shop_gid:                 { nullable: false, udt: TEXT },
  location_gid:             { nullable: false, udt: TEXT },
  verdict:                  { nullable: true,  udt: TEXT },
};

const VERIFICATION_LINE_COLUMNS: Record<string, ColumnContract> = {
  verification_id:            { nullable: false, udt: UUID },
  shop_id:                    { nullable: false, udt: BIGINT },
  shopify_inventory_item_gid: { nullable: false, udt: TEXT },
  observed_on_hand:           { nullable: true,  udt: INTEGER },
  level_present:              { nullable: false, udt: BOOL },
  active:                     { nullable: true,  udt: BOOL },
  tracked:                    { nullable: true,  udt: BOOL },
  expected_target:            { nullable: true,  udt: INTEGER },
  frozen_change_from:         { nullable: true,  udt: INTEGER },
  line_verdict:               { nullable: false, udt: TEXT },
};

// ---------------------------------------------------------------------------
// RED gate
// ---------------------------------------------------------------------------

type SliceEPresence = {
  missingTables: string[];
  migration0203Files: string[];
};

let presence: SliceEPresence;

function findMigration0203Files(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /_0203_.*\.ts$/.test(file))
    .sort();
}

async function probeSliceEPresence(): Promise<SliceEPresence> {
  const { rows } = await systemTransaction((trx) =>
    trx.raw(
      `
        SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
        FROM unnest(?::text[]) AS name
      `,
      [SLICE_E_TABLES]
    )
  );

  return {
    missingTables: rows
      .filter((row: any) => row.present !== true)
      .map((row: any) => String(row.name)),
    migration0203Files: findMigration0203Files(),
  };
}

function requireSliceESchema(): void {
  if (presence.missingTables.length > 0) {
    throw new Error(
      `[E01_RED_GATE] Slice-E schema absent — migration 0203 not applied. ` +
        `Missing: ${presence.missingTables.join(', ')}. ` +
        `0203 files: ${presence.migration0203Files.join(', ') || 'none'}.`
    );
  }
}

type MigrationModule = {
  up(knex: Knex | Knex.Transaction): Promise<void>;
  down(knex: Knex | Knex.Transaction): Promise<void>;
};

function requireMigration0203(): { file: string; source: string } {
  if (presence.migration0203Files.length !== 1) {
    throw new Error(
      `[E01_RED_GATE] expected exactly ONE _0203_ migration in ` +
        `apps/backend/migrations, found ` +
        `${presence.migration0203Files.length} ` +
        `(${presence.migration0203Files.join(', ') || 'none'}).`
    );
  }

  const file = presence.migration0203Files[0];

  return {
    file,
    source: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
  };
}

function loadMigration0203(): MigrationModule {
  const { file } = requireMigration0203();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(MIGRATIONS_DIR, file)) as MigrationModule;
}

// ---------------------------------------------------------------------------
// Fixtures (real Slice-D request authority through real 0201 guards)
// ---------------------------------------------------------------------------

type Fixture = {
  shopId: number;
  warehouseId: string;
  snapshotId: string;
  variantId: string;
};

const REQUEST_SHA256 = '5'.repeat(64);

async function createFixture(prefix: string): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('shop_wms_settings')
      .insert({
        shop_id: shopId,
        bootstrap_model: 'reconcile_opening_expectation_v2',
      })
      .onConflict('shop_id')
      .ignore();

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `Execution warehouse ${unique}`,
      root_location_code: `EXE-${unique}-ROOT`,
      is_default: true,
      active: true,
      external_location_id: `8${shopId}`,
    });

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Execution product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `EXE-${unique}`,
      title: 'Execution variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('opening_inventory_shopify_snapshots').insert({
      snapshot_id: snapshotId,
      shop_id: shopId,
      warehouse_id: warehouseId,
      shopify_location_id: `gid://shopify/Location/8${shopId}`,
      attempt_number: 1,
      status: 'collecting',
      collection_token: crypto.randomUUID(),
      collection_started_at: new Date(),
      lease_expires_at: new Date(Date.now() + 5 * 60_000),
      completed_at: null,
      line_count: null,
      page_count: null,
      shopify_api_version: '2026-04',
      failure_code: null,
    });

    await trx('opening_inventory_shopify_snapshots')
      .where({ shop_id: shopId, snapshot_id: snapshotId })
      .update({
        status: 'complete',
        completed_at: new Date(),
        line_count: 0,
        page_count: 1,
      });
  });

  return { shopId, warehouseId, snapshotId, variantId };
}

/** Frozen immutable generation with exactly one write entry and batch 1. */
async function insertFrozenGeneration(
  fixture: Fixture,
  generationSequence: number,
  trxOverride?: Knex.Transaction
): Promise<string> {
  const generationId = crypto.randomUUID();
  const now = new Date();
  const idempotencyKey = crypto.randomUUID();
  const itemGid = `gid://shopify/InventoryItem/9${fixture.shopId}`;
  const locationGid = `gid://shopify/Location/8${fixture.shopId}`;
  const referenceUri =
    `gid://lasyncro/OpeningInventoryCutover/shop-${fixture.shopId}-generation-${generationId}-batch-1`;

  const body = async (trx: Knex.Transaction) => {
    await trx(GENERATIONS).insert({
      generation_id: generationId,
      shop_id: fixture.shopId,
      generation_sequence: generationSequence,

      opening_snapshot_id: fixture.snapshotId,
      warehouse_id: fixture.warehouseId,
      shopify_location_gid: locationGid,
      shopify_shop_domain: `shop-${fixture.shopId}.myshopify.com`,
      shopify_shop_gid: `gid://shopify/Shop/${fixture.shopId}`,

      requested_api_version: '2026-04',
      served_api_version: '2026-04',
      cas_mode: 'change_from_quantity',

      quantity_name: 'on_hand',
      reason: 'correction',

      approved_by_actor_type: 'user',
      approved_by_actor_id: `user-${fixture.shopId}`,
      approved_by_role: 'owner',
      approved_at: now,
      physical_truth_accepted_at: now,

      identity_fingerprint: '1'.repeat(64),
      target_fingerprint: '2'.repeat(64),
      provider_read_fingerprint: '3'.repeat(64),
      generation_fingerprint: '4'.repeat(64),

      canonicalization_version: 'v1',
      batching_version: 'v1',
      batch_size: 250,

      provider_read_started_at: new Date(now.getTime() - 1000),
      provider_read_completed_at: now,
      provider_page_count: 1,

      target_item_count: 1,
      provider_only_item_count: 0,
      write_count: 1,
      batch_count: 1,

      status: 'assembling',
      frozen_at: null,
    });

    await trx(ENTRIES).insert({
      generation_id: generationId,
      shop_id: fixture.shopId,
      ordinal: 1,
      lasyncro_variant_id: fixture.variantId,
      shopify_inventory_item_gid: itemGid,
      shopify_variant_gid: `gid://shopify/ProductVariant/7${fixture.shopId}`,
      target_quantity: 7,
      observed_on_hand_quantity: 5,
      inventory_level_present: true,
      inventory_level_active: true,
      tracked: true,
      disposition: 'write',
      batch_index: 1,
      batch_position: 1,
    });

    await trx(BATCHES).insert({
      generation_id: generationId,
      shop_id: fixture.shopId,
      batch_index: 1,
      requested_api_version: '2026-04',
      served_api_version: '2026-04',
      cas_mode: 'change_from_quantity',
      operation_name: 'OpeningInventoryCutoverSetOnHand',
      graphql_document:
        'mutation OpeningInventoryCutoverSetOnHand($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) { inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) { userErrors { code field message } } }',
      canonical_variables: JSON.stringify({
        idempotencyKey,
        input: {
          name: 'on_hand',
          reason: 'correction',
          referenceDocumentUri: referenceUri,
          quantities: [
            {
              inventoryItemId: itemGid,
              locationId: locationGid,
              quantity: 7,
              changeFromQuantity: 5,
            },
          ],
        },
      }),
      reference_document_uri: referenceUri,
      idempotency_key: idempotencyKey,
      request_sha256: REQUEST_SHA256,
      entry_count: 1,
    });

    await trx(GENERATIONS)
      .where({ shop_id: fixture.shopId, generation_id: generationId })
      .update({ status: 'frozen', frozen_at: new Date() });
  };

  if (trxOverride) {
    await body(trxOverride);
  } else {
    await withTenant(fixture.shopId, body);
  }

  return generationId;
}

function executionRow(
  fixture: Fixture,
  generationId: string,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date();

  return {
    execution_id: crypto.randomUUID(),
    shop_id: fixture.shopId,
    generation_id: generationId,
    status: 'executing',
    lease_token: crypto.randomUUID(),
    lease_expires_at: new Date(now.getTime() + 5 * 60_000),
    lease_heartbeat_at: now,
    started_at: now,
    updated_at: now,
    blocked_at: null,
    blocked_reason: null,
    terminal_at: null,
    terminal_reason: null,
    ...overrides,
  };
}

function batchExecutionRow(
  fixture: Fixture,
  generationId: string,
  executionId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    generation_id: generationId,
    batch_index: 1,
    shop_id: fixture.shopId,
    execution_id: executionId,
    status: 'pending',
    attempt_count: 0,
    shopify_adjustment_group_id: null,
    succeeded_at: null,
    updated_at: new Date(),
    ...overrides,
  };
}

function attemptRow(
  fixture: Fixture,
  generationId: string,
  executionId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    attempt_id: crypto.randomUUID(),
    shop_id: fixture.shopId,
    execution_id: executionId,
    generation_id: generationId,
    batch_index: 1,
    attempt_number: 1,
    dispatch_lease_token: crypto.randomUUID(),
    finalized_by_lease_token: null,
    request_sha256: REQUEST_SHA256,
    requested_api_version: '2026-04',
    started_at: new Date(),
    finalized_at: null,
    outcome: null,
    http_status: null,
    x_request_id: null,
    served_api_version: null,
    user_errors: null,
    shopify_adjustment_group_id: null,
    error_class: null,
    error_detail: null,
    ...overrides,
  };
}

function verificationRow(
  fixture: Fixture,
  generationId: string,
  executionId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    verification_id: crypto.randomUUID(),
    shop_id: fixture.shopId,
    execution_id: executionId,
    generation_id: generationId,
    purpose: 'final_convergence',
    batch_index: null,
    started_by_lease_token: crypto.randomUUID(),
    finalized_by_lease_token: null,
    status: 'collecting',
    requested_api_version: '2026-04',
    served_api_version: null,
    page_count: 0,
    read_started_at: new Date(),
    read_completed_at: null,
    readiness_passed: null,
    target_fingerprint: null,
    identity_fingerprint: null,
    shop_gid: `gid://shopify/Shop/${fixture.shopId}`,
    location_gid: `gid://shopify/Location/8${fixture.shopId}`,
    verdict: null,
    ...overrides,
  };
}

function verificationLineRow(
  fixture: Fixture,
  verificationId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    verification_id: verificationId,
    shop_id: fixture.shopId,
    shopify_inventory_item_gid:
      `gid://shopify/InventoryItem/9${fixture.shopId}`,
    observed_on_hand: 7,
    level_present: true,
    active: true,
    tracked: true,
    expected_target: 7,
    frozen_change_from: 5,
    line_verdict: 'match',
    ...overrides,
  };
}

function completeVerificationPatch() {
  return {
    status: 'complete',
    served_api_version: '2026-04',
    page_count: 1,
    read_completed_at: new Date(),
    readiness_passed: true,
    target_fingerprint: '2'.repeat(64),
    identity_fingerprint: '1'.repeat(64),
    verdict: 'converged',
    finalized_by_lease_token: crypto.randomUUID(),
  };
}

/** Insert an execution via the runtime role and return it. */
async function insertExecution(
  fixture: Fixture,
  generationId: string,
  overrides: Record<string, unknown> = {}
) {
  const row = executionRow(fixture, generationId, overrides);
  await withTenant(fixture.shopId, (trx) => trx(EXECUTIONS).insert(row));
  return row;
}

async function updateExecution(
  fixture: Fixture,
  executionId: string,
  patch: Record<string, unknown>
) {
  return withTenant(fixture.shopId, (trx) =>
    trx(EXECUTIONS)
      .where({ shop_id: fixture.shopId, execution_id: executionId })
      .update({ updated_at: new Date(), ...patch })
  );
}

const CLEAR_LEASE = {
  lease_token: null,
  lease_expires_at: null,
  lease_heartbeat_at: null,
};

function terminalPatch(status: 'converged' | 'requires_regeneration') {
  return {
    status,
    ...CLEAR_LEASE,
    terminal_at: new Date(),
    terminal_reason: status,
  };
}

function blockedPatch() {
  return {
    status: 'blocked',
    ...CLEAR_LEASE,
    blocked_at: new Date(),
    blocked_reason: 'manual_hold',
  };
}

/**
 * A dispatch attempt represents provider dispatch authority, so the fixture
 * moves the batch pending → dispatching in the SAME transaction before the
 * attempt row is inserted. (No DB coupling is asserted here; that belongs to
 * the executor RED.)
 */
async function insertDispatchingAttempt(
  tenantShopId: number,
  row: ReturnType<typeof attemptRow>
) {
  return withTenant(tenantShopId, async (trx) => {
    await trx(BATCH_EXECUTIONS)
      .where({
        shop_id: tenantShopId,
        generation_id: row.generation_id,
        batch_index: row.batch_index,
        status: 'pending',
      })
      .update({ status: 'dispatching', updated_at: new Date() });

    await trx(ATTEMPTS).insert(row);
  });
}

/** Owner-side pending → dispatching, for scenarios whose attempt insert runs as another tenant. */
async function markBatchDispatching(
  fixture: Fixture,
  generationId: string,
  batchIndex = 1
) {
  return withTenant(fixture.shopId, (trx) =>
    trx(BATCH_EXECUTIONS)
      .where({
        shop_id: fixture.shopId,
        generation_id: generationId,
        batch_index: batchIndex,
        status: 'pending',
      })
      .update({ status: 'dispatching', updated_at: new Date() })
  );
}

const SLICE_E_PRESENCE_SQL = `
  SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
  FROM unnest(?::text[]) AS name
  ORDER BY name
`;

async function sliceETablePresence(
  runner?: CatalogRunner
): Promise<Record<string, boolean>> {
  const rows = await catalog<{ name: string; present: boolean }>(
    SLICE_E_PRESENCE_SQL,
    [SLICE_E_TABLES],
    runner
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.present]));
}

function allSliceETables(value: boolean): Record<string, boolean> {
  return Object.fromEntries(SLICE_E_TABLES.map((table) => [table, value]));
}

/** 0203's additive tenant-qualified UNIQUE on the immutable Slice-D batch table. */
async function hasTenantBatchUnique(runner?: CatalogRunner): Promise<boolean> {
  return hasFullUnique(await indexShapes(BATCHES, runner), [
    'generation_id',
    'shop_id',
    'batch_index',
  ]);
}

/** Frozen generation + executing execution + pending batch execution. */
async function executionScenario(prefix: string) {
  const fixture = await createFixture(prefix);
  const generationId = await insertFrozenGeneration(fixture, 1);
  const execution = await insertExecution(fixture, generationId);

  await withTenant(fixture.shopId, (trx) =>
    trx(BATCH_EXECUTIONS).insert(
      batchExecutionRow(fixture, generationId, execution.execution_id)
    )
  );

  return { fixture, generationId, execution };
}

// ---------------------------------------------------------------------------
// Catalog probes
// ---------------------------------------------------------------------------

type CatalogRunner = Knex | Knex.Transaction;

/** Catalog read; `runner` lets migration-role transactions probe their own (uncommitted) schema. */
async function catalog<T = any>(
  sql: string,
  bindings: unknown[],
  runner?: CatalogRunner
): Promise<T[]> {
  const { rows } = runner
    ? await runner.raw(sql, bindings as any)
    : await systemTransaction((trx) => trx.raw(sql, bindings as any));
  return rows as T[];
}

async function columnContractDiff(
  table: string,
  expected: Record<string, ColumnContract>
) {
  const rows = await catalog<{
    column_name: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `
      SELECT column_name, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ?
    `,
    [table]
  );

  const byName = new Map(rows.map((row) => [row.column_name, row]));

  const actual: Record<string, unknown> = {};
  const wanted: Record<string, unknown> = {};

  for (const [column, contract] of Object.entries(expected)) {
    const row = byName.get(column);
    actual[column] = row
      ? {
          udt: contract.udt.includes(row.udt_name)
            ? contract.udt[0]
            : row.udt_name,
          nullable: row.is_nullable === 'YES',
        }
      : 'MISSING';
    wanted[column] = { udt: contract.udt[0], nullable: contract.nullable };
  }

  return { actual, wanted };
}

async function columnDefault(
  table: string,
  column: string
): Promise<string | null> {
  const rows = await catalog<{ column_default: string | null }>(
    `
      SELECT column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ?
        AND column_name = ?
    `,
    [table, column]
  );

  return rows[0]?.column_default ?? null;
}

async function constraintDefinitions(
  table: string,
  contype?: string
): Promise<string[]> {
  const rows = await catalog<{ definition: string }>(
    `
      SELECT pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND rel.relname = ?
        AND (?::text IS NULL OR con.contype::text = ?::text)
      ORDER BY con.conname
    `,
    [table, contype ?? null, contype ?? null]
  );

  return rows.map((row) => String(row.definition));
}

async function constraintNames(
  table: string,
  runner?: CatalogRunner
): Promise<string[]> {
  const rows = await catalog<{ conname: string }>(
    `
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND rel.relname = ?
    `,
    [table],
    runner
  );

  return rows.map((row) => String(row.conname));
}

/** CHECK constraint naming `column` that lists every allowed literal. */
async function checkListsValues(
  table: string,
  column: string,
  values: string[]
): Promise<boolean> {
  const checks = await constraintDefinitions(table, 'c');
  const columnPattern = new RegExp(`\\b${column}\\b`);

  return checks.some(
    (definition) =>
      columnPattern.test(definition) &&
      values.every((value) => definition.includes(`'${value}'`))
  );
}

type ForeignKey = {
  ref_table: string;
  pairs: string[];
  /** Ordered source columns as declared (conkey order). */
  cols: string[];
  /** Ordered referenced columns as declared (confkey order). */
  ref_cols: string[];
  on_delete: string;
};

async function foreignKeys(table: string): Promise<ForeignKey[]> {
  const rows = await catalog<{
    ref_table: string;
    cols: string[];
    ref_cols: string[];
    confdeltype: string;
  }>(
    `
      SELECT
        ref.relname AS ref_table,
        array_agg(att.attname::text ORDER BY k.ord) AS cols,
        array_agg(fatt.attname::text ORDER BY k.ord) AS ref_cols,
        con.confdeltype::text AS confdeltype
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_class ref ON ref.oid = con.confrelid
      CROSS JOIN LATERAL unnest(con.conkey, con.confkey)
        WITH ORDINALITY AS k(attnum, fattnum, ord)
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      JOIN pg_attribute fatt
        ON fatt.attrelid = con.confrelid AND fatt.attnum = k.fattnum
      WHERE con.contype = 'f'
        AND ns.nspname = 'public'
        AND rel.relname = ?
      GROUP BY con.oid, ref.relname, con.confdeltype
    `,
    [table]
  );

  const onDelete: Record<string, string> = {
    a: 'NO ACTION',
    r: 'RESTRICT',
    c: 'CASCADE',
    n: 'SET NULL',
    d: 'SET DEFAULT',
  };

  return rows.map((row) => ({
    ref_table: row.ref_table,
    pairs: row.cols.map((col, i) => `${col}->${row.ref_cols[i]}`).sort(),
    cols: row.cols,
    ref_cols: row.ref_cols,
    on_delete: onDelete[row.confdeltype] ?? row.confdeltype,
  }));
}

/** FK from `table` to `refTable` whose column pairs are exactly / at least `pairs`. */
function hasForeignKey(
  fks: ForeignKey[],
  refTable: string,
  pairs: string[],
  mode: 'exact' | 'includes',
  onDelete?: string
): boolean {
  const wanted = [...pairs].sort();

  return fks.some(
    (fk) =>
      fk.ref_table === refTable &&
      (mode === 'exact'
        ? JSON.stringify(fk.pairs) === JSON.stringify(wanted)
        : wanted.every((pair) => fk.pairs.includes(pair))) &&
      (onDelete === undefined || fk.on_delete === onDelete)
  );
}

type IndexShape = {
  unique: boolean;
  primary: boolean;
  cols: string[];
  predicate: string | null;
  definition: string;
};

async function indexShapes(
  table: string,
  runner?: CatalogRunner
): Promise<IndexShape[]> {
  const rows = await catalog<{
    indisunique: boolean;
    indisprimary: boolean;
    cols: string[];
    predicate: string | null;
    definition: string;
  }>(
    `
      SELECT
        i.indisunique,
        i.indisprimary,
        ARRAY(
          SELECT a.attname::text
          FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          ORDER BY k.ord
        ) AS cols,
        pg_get_expr(i.indpred, i.indrelid) AS predicate,
        pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i
      JOIN pg_class rel ON rel.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND rel.relname = ?
    `,
    [table],
    runner
  );

  return rows.map((row) => ({
    unique: row.indisunique,
    primary: row.indisprimary,
    cols: row.cols,
    predicate: row.predicate,
    definition: row.definition,
  }));
}

function sameSet(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    [...a].sort().join(',') === [...b].sort().join(',')
  );
}

/** Non-partial UNIQUE/PK whose key columns are exactly `cols` (any order). */
function hasFullUnique(indexes: IndexShape[], cols: string[]): boolean {
  return indexes.some(
    (index) => index.unique && index.predicate === null && sameSet(index.cols, cols)
  );
}

/** Non-partial index whose LEADING columns are `prefix` in order. */
function hasLeadingIndex(indexes: IndexShape[], prefix: string[]): boolean {
  return indexes.some(
    (index) =>
      index.predicate === null &&
      prefix.every((col, i) => index.cols[i] === col)
  );
}

async function rlsFlags(tables: string[]) {
  const rows = await catalog<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public'
        AND c.relname = ANY(?)
      ORDER BY c.relname
    `,
    [tables]
  );

  return rows.map((row) => ({
    relname: row.relname,
    enabled: row.relrowsecurity,
    forced: row.relforcerowsecurity,
  }));
}

/** Tenant policy in the established 0201 FOR ALL USING + WITH CHECK form. */
async function hasTenantPolicy(table: string): Promise<boolean> {
  const rows = await catalog<{
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `
      SELECT cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ?
    `,
    [table]
  );

  // Rendered 0201 form:
  //   shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
  //   AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  const tenant =
    String.raw`\(NULLIF\(current_setting\('app\.current_tenant'::text, true\), ''::text\)\)::integer`;
  const tenantEquality = new RegExp(String.raw`shop_id = ${tenant}`);
  const tenantPositive = new RegExp(String.raw`${tenant} > 0`);

  const tenantExpr = (expr: string | null) =>
    expr !== null && tenantEquality.test(expr) && tenantPositive.test(expr);

  return rows.some(
    (row) =>
      row.cmd === 'ALL' && tenantExpr(row.qual) && tenantExpr(row.with_check)
  );
}

type TriggerShape = {
  name: string;
  before: boolean;
  row: boolean;
  onInsert: boolean;
  onUpdate: boolean;
  onDelete: boolean;
  source: string;
};

async function triggers(table: string): Promise<TriggerShape[]> {
  const rows = await catalog<{
    tgname: string;
    tgtype: number;
    prosrc: string;
  }>(
    `
      SELECT t.tgname, t.tgtype::int AS tgtype, p.prosrc
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE ns.nspname = 'public'
        AND c.relname = ?
        AND NOT t.tgisinternal
    `,
    [table]
  );

  return rows.map((row) => ({
    name: row.tgname,
    row: (row.tgtype & 1) !== 0,
    before: (row.tgtype & 2) !== 0,
    onInsert: (row.tgtype & 4) !== 0,
    onDelete: (row.tgtype & 8) !== 0,
    onUpdate: (row.tgtype & 16) !== 0,
    source: String(row.prosrc),
  }));
}

// ---------------------------------------------------------------------------
// Migration-role helpers (precedent: opening-inventory-cutover-shop-gid-migration-safety)
// ---------------------------------------------------------------------------

let migrationDb: Knex | undefined;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `GH-1179 E01 refuses to run: PGDATABASE="${name}" is not a ` +
        `disposable synchroflow_test_* database. Run via: npm run test:integration`
    );
  }
}

function migrationRole(): Knex {
  if (!migrationDb) {
    migrationDb = knexLib({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGMIGRATION_USER,
        password: process.env.PGMIGRATION_PASSWORD,
        database: process.env.PGDATABASE,
      },
      pool: { min: 0, max: 2 },
    });
  }

  return migrationDb;
}

/** Run `body` in a migration-role transaction that is ALWAYS rolled back. */
async function inRolledBackTransaction(
  body: (trx: Knex.Transaction) => Promise<void>
): Promise<void> {
  const sentinel = new Error('__rollback__');
  try {
    await migrationRole().transaction(async (trx) => {
      await body(trx);
      throw sentinel;
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
}

/** Settle a migration call inside a savepoint so a failure cannot abort the outer trx. */
async function inSavepoint(
  trx: Knex.Transaction,
  body: (sp: Knex.Transaction) => Promise<void>
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return trx.transaction(body).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error })
  );
}

beforeAll(async () => {
  assertDisposableDatabase();
  presence = await probeSliceEPresence();
});

afterAll(async () => {
  if (migrationDb) await migrationDb.destroy();
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe(
  'GH-1179 Slice E / E01 — opening inventory cutover execution persistence (migration 0203)',
  () => {
    it('E01-M01 — all five Slice-E execution/evidence tables exist', async () => {
      const rows = await catalog<{ name: string; present: boolean }>(
        `
          SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
          FROM unnest(?::text[]) AS name
          ORDER BY name
        `,
        [SLICE_E_TABLES]
      );

      expect(
        Object.fromEntries(rows.map((row) => [row.name, row.present]))
      ).toEqual(
        Object.fromEntries(SLICE_E_TABLES.map((table) => [table, true]))
      );
    });

    // ORDERING: M17a is declared immediately after M01 (which commits
    // nothing) so it executes before ANY scenario in this file commits
    // Slice-E rows. Its zero-evidence precondition is asserted explicitly
    // rather than assumed.
    it('E01-M17a — 0203 down SUCCEEDS with zero Slice-E evidence (real down, rolled back to head)', async () => {
      requireMigration0203();
      requireSliceESchema();
      const migration0203 = loadMigration0203();

      try {
        await inRolledBackTransaction(async (trx) => {
          // Migration role sees every tenant's rows (no RLS filtering).
          await trx.raw(`SET LOCAL row_security = off`);

          const counts = await trx.raw(
            `SELECT ${SLICE_E_TABLES.map(
              (table) => `(SELECT count(*)::int FROM ${table}) AS "${table}"`
            ).join(', ')}`
          );

          expect(counts.rows[0]).toEqual(
            Object.fromEntries(SLICE_E_TABLES.map((table) => [table, 0]))
          );

          expect({
            tables: await sliceETablePresence(trx),
            tenantBatchUnique: await hasTenantBatchUnique(trx),
          }).toEqual({
            tables: allSliceETables(true),
            tenantBatchUnique: true,
          });

          const outcome = await inSavepoint(trx, (sp) => migration0203.down(sp));

          expect({
            ok: outcome.ok,
            error: outcome.ok
              ? null
              : String((outcome as any).error?.message ?? outcome),
          }).toEqual({ ok: true, error: null });

          const batchConstraints = await constraintNames(BATCHES, trx);

          expect({
            tables: await sliceETablePresence(trx),
            tenantBatchUnique: await hasTenantBatchUnique(trx),
            sliceDBatchPkSurvives: batchConstraints.includes(
              'opening_inventory_cutover_generation_batches_pk'
            ),
            sliceDBatchParentFkSurvives: batchConstraints.includes(
              'opening_inventory_cutover_generation_batches_parent_fk'
            ),
          }).toEqual({
            tables: allSliceETables(false),
            tenantBatchUnique: false,
            sliceDBatchPkSurvives: true,
            sliceDBatchParentFkSurvives: true,
          });
        });
      } finally {
        // Rollback must leave the shared disposable DB at head, RED or GREEN.
        await inRolledBackTransaction(async (trx) => {
          expect({
            tables: await sliceETablePresence(trx),
            tenantBatchUnique: await hasTenantBatchUnique(trx),
          }).toEqual({
            tables: allSliceETables(true),
            tenantBatchUnique: true,
          });
        });
      }
    });

    it('E01-M02 — execution header shape, invariants, UNIQUE(generation_id) and tenant RESTRICT FK', async () => {
      requireSliceESchema();

      const shape = await columnContractDiff(EXECUTIONS, EXECUTION_COLUMNS);
      expect(shape.actual).toEqual(shape.wanted);

      const indexes = await indexShapes(EXECUTIONS);
      expect({
        primaryKeyExecutionId: indexes.some(
          (index) => index.primary && sameSet(index.cols, ['execution_id'])
        ),
        uniqueGenerationId: hasFullUnique(indexes, ['generation_id']),
        tenantGenerationFk: hasForeignKey(
          await foreignKeys(EXECUTIONS),
          GENERATIONS,
          ['generation_id->generation_id', 'shop_id->shop_id'],
          'exact',
          'RESTRICT'
        ),
        statusCheckListsAllStates: await checkListsValues(
          EXECUTIONS,
          'status',
          ['executing', 'verifying', 'blocked', 'requires_regeneration', 'converged']
        ),
      }).toEqual({
        primaryKeyExecutionId: true,
        uniqueGenerationId: true,
        tenantGenerationFk: true,
        statusCheckListsAllStates: true,
      });

      const fixture = await createFixture('e01-m02');
      const genA = await insertFrozenGeneration(fixture, 1);
      const genB = await insertFrozenGeneration(fixture, 2);

      // Unknown status rejected.
      await expect(
        insertExecution(fixture, genA, { status: 'paused' })
      ).rejects.toBeDefined();

      // Lease invariant: active status requires lease_token AND lease_expires_at.
      await expect(
        insertExecution(fixture, genA, { lease_token: null })
      ).rejects.toBeDefined();
      await expect(
        insertExecution(fixture, genA, { lease_expires_at: null })
      ).rejects.toBeDefined();

      // Terminal / blocked markers cannot appear on an active execution.
      await expect(
        insertExecution(fixture, genA, { terminal_at: new Date() })
      ).rejects.toBeDefined();
      await expect(
        insertExecution(fixture, genA, { blocked_at: new Date() })
      ).rejects.toBeDefined();

      // Positive control.
      const execA = await insertExecution(fixture, genA);

      // Blocked: requires blocked_at and must NOT keep an active lease.
      await expect(
        updateExecution(fixture, execA.execution_id, {
          status: 'blocked',
          blocked_at: new Date(),
          blocked_reason: 'manual_hold',
        })
      ).rejects.toBeDefined();
      await expect(
        updateExecution(fixture, execA.execution_id, {
          ...blockedPatch(),
          blocked_at: null,
        })
      ).rejects.toBeDefined();

      // Terminal: requires terminal_at and no active lease.
      await expect(
        updateExecution(fixture, execA.execution_id, {
          ...terminalPatch('requires_regeneration'),
          terminal_at: null,
        })
      ).rejects.toBeDefined();
      await expect(
        updateExecution(fixture, execA.execution_id, {
          status: 'requires_regeneration',
          terminal_at: new Date(),
          terminal_reason: 'requires_regeneration',
        })
      ).rejects.toBeDefined();

      await expect(
        updateExecution(
          fixture,
          execA.execution_id,
          terminalPatch('requires_regeneration')
        )
      ).resolves.toBe(1);

      // UNIQUE(generation_id): even a terminal execution keeps its generation.
      await expect(
        insertExecution(fixture, genA)
      ).rejects.toBeDefined();

      // Tenant-aware parent FK: another tenant cannot execute A's generation.
      const other = await createFixture('e01-m02-other');
      await expect(
        insertExecution(other, genB)
      ).rejects.toBeDefined();

      // The slot freed by the terminal execution accepts the next generation.
      await expect(
        insertExecution(fixture, genB)
      ).resolves.toBeDefined();
    });

    it('E01-M03 — one active (executing/verifying/blocked) execution per shop; terminal rows free the slot', async () => {
      requireSliceESchema();

      const indexes = await indexShapes(EXECUTIONS);
      const activeSlot = indexes.filter(
        (index) =>
          index.unique &&
          sameSet(index.cols, ['shop_id']) &&
          index.predicate !== null
      );

      expect(
        activeSlot.map((index) => ({
          executing: /'executing'/.test(String(index.predicate)),
          verifying: /'verifying'/.test(String(index.predicate)),
          blocked: /'blocked'/.test(String(index.predicate)),
          converged: /'converged'/.test(String(index.predicate)),
          requires_regeneration:
            /'requires_regeneration'/.test(String(index.predicate)),
        }))
      ).toEqual([
        {
          executing: true,
          verifying: true,
          blocked: true,
          converged: false,
          requires_regeneration: false,
        },
      ]);

      // Executing / verifying / terminal walk.
      const shop = await createFixture('e01-m03');
      const gen1 = await insertFrozenGeneration(shop, 1);
      const gen2 = await insertFrozenGeneration(shop, 2);
      const gen3 = await insertFrozenGeneration(shop, 3);

      const exec1 = await insertExecution(shop, gen1);
      await expect(insertExecution(shop, gen2)).rejects.toBeDefined();

      await expect(
        updateExecution(shop, exec1.execution_id, { status: 'verifying' })
      ).resolves.toBe(1);
      await expect(insertExecution(shop, gen2)).rejects.toBeDefined();

      await expect(
        updateExecution(
          shop,
          exec1.execution_id,
          terminalPatch('requires_regeneration')
        )
      ).resolves.toBe(1);

      const exec2 = await insertExecution(shop, gen2);
      await expect(
        updateExecution(shop, exec2.execution_id, { status: 'verifying' })
      ).resolves.toBe(1);
      await expect(
        updateExecution(shop, exec2.execution_id, terminalPatch('converged'))
      ).resolves.toBe(1);

      await expect(insertExecution(shop, gen3)).resolves.toBeDefined();

      // Blocked (manual hold) still occupies the slot.
      const held = await createFixture('e01-m03-held');
      const heldGen1 = await insertFrozenGeneration(held, 1);
      const heldGen2 = await insertFrozenGeneration(held, 2);
      const heldExec = await insertExecution(held, heldGen1);

      await expect(
        updateExecution(held, heldExec.execution_id, blockedPatch())
      ).resolves.toBe(1);
      await expect(insertExecution(held, heldGen2)).rejects.toBeDefined();

      // Another merchant is independent.
      const independent = await createFixture('e01-m03-independent');
      const independentGen = await insertFrozenGeneration(independent, 1);
      await expect(
        insertExecution(independent, independentGen)
      ).resolves.toBeDefined();
    });

    it('E01-M04 — execution table ENABLE + FORCE RLS with 0201 tenant policy; cross-tenant invisible/rejected', async () => {
      requireSliceESchema();

      expect(await rlsFlags([EXECUTIONS])).toEqual([
        { relname: EXECUTIONS, enabled: true, forced: true },
      ]);
      expect(await hasTenantPolicy(EXECUTIONS)).toBe(true);

      const owner = await createFixture('e01-m04-owner');
      const other = await createFixture('e01-m04-other');
      const generationId = await insertFrozenGeneration(owner, 1);
      const execution = await insertExecution(owner, generationId);

      const foreignRead = await withTenant(other.shopId, (trx) =>
        trx(EXECUTIONS).where({ execution_id: execution.execution_id })
      );
      expect(foreignRead).toEqual([]);

      const foreignUpdate = await withTenant(other.shopId, (trx) =>
        trx(EXECUTIONS)
          .where({ execution_id: execution.execution_id })
          .update({ updated_at: new Date() })
      );
      expect(foreignUpdate).toBe(0);

      // Other tenant cannot write a row claiming the owner's shop_id.
      const ownerGen2 = await insertFrozenGeneration(owner, 2);
      await expect(
        withTenant(other.shopId, (trx) =>
          trx(EXECUTIONS).insert(executionRow(owner, ownerGen2))
        )
      ).rejects.toBeDefined();

      const ownerRead = await withTenant(owner.shopId, (trx) =>
        trx(EXECUTIONS).where({ execution_id: execution.execution_id })
      );
      expect(ownerRead).toHaveLength(1);
    });

    // Not gated: proves the policy probe recognises the established 0201
    // tenant policy, so a GREEN/RED verdict on Slice-E policies is about the
    // policy, not about the probe.
    it('E01-M04c — tenant-policy probe calibration: established 0201 policies are recognised', async () => {
      expect({
        generations: await hasTenantPolicy(GENERATIONS),
        entries: await hasTenantPolicy(ENTRIES),
        batches: await hasTenantPolicy(BATCHES),
      }).toEqual({ generations: true, entries: true, batches: true });
    });

    it('E01-M04b — ALL five Slice-E tables ENABLE + FORCE RLS with direct 0201 tenant policy; batch executions and attempts isolate at runtime', async () => {
      requireSliceESchema();

      expect(await rlsFlags(SLICE_E_TABLES)).toEqual(
        [...SLICE_E_TABLES]
          .sort()
          .map((relname) => ({ relname, enabled: true, forced: true }))
      );

      expect(
        Object.fromEntries(
          await Promise.all(
            SLICE_E_TABLES.map(async (table) => [
              table,
              await hasTenantPolicy(table),
            ])
          )
        )
      ).toEqual(allSliceETables(true));

      const owner = await createFixture('e01-m04b-owner');
      const other = await createFixture('e01-m04b-other');
      const generationId = await insertFrozenGeneration(owner, 1);
      const execution = await insertExecution(owner, generationId);

      // Batch executions: an otherwise-valid owner row written by another
      // tenant is rejected; the identical row written by the owner is accepted.
      const batch = batchExecutionRow(owner, generationId, execution.execution_id);

      await expect(
        withTenant(other.shopId, (trx) => trx(BATCH_EXECUTIONS).insert(batch))
      ).rejects.toBeDefined();
      await expect(
        withTenant(owner.shopId, (trx) => trx(BATCH_EXECUTIONS).insert(batch))
      ).resolves.toBeDefined();

      // Attempts: same discriminator, with the batch already dispatching.
      await expect(markBatchDispatching(owner, generationId)).resolves.toBe(1);

      const attempt = attemptRow(owner, generationId, execution.execution_id);

      await expect(
        withTenant(other.shopId, (trx) => trx(ATTEMPTS).insert(attempt))
      ).rejects.toBeDefined();
      await insertDispatchingAttempt(owner.shopId, attempt);

      const ownerView = await withTenant(owner.shopId, async (trx) => ({
        batches: (
          await trx(BATCH_EXECUTIONS).where({
            generation_id: generationId,
            batch_index: 1,
          })
        ).length,
        attempts: (
          await trx(ATTEMPTS).where({ attempt_id: attempt.attempt_id })
        ).length,
      }));
      expect(ownerView).toEqual({ batches: 1, attempts: 1 });

      const foreignView = await withTenant(other.shopId, async (trx) => ({
        batches: await trx(BATCH_EXECUTIONS).where({
          generation_id: generationId,
          batch_index: 1,
        }),
        attempts: await trx(ATTEMPTS).where({ attempt_id: attempt.attempt_id }),
      }));
      expect(foreignView).toEqual({ batches: [], attempts: [] });

      const foreignUpdates = await withTenant(other.shopId, async (trx) => ({
        batches: await trx(BATCH_EXECUTIONS)
          .where({ generation_id: generationId, batch_index: 1 })
          .update({ updated_at: new Date() }),
        attempts: await trx(ATTEMPTS)
          .where({ attempt_id: attempt.attempt_id })
          .update({ error_detail: 'cross-tenant rewrite' }),
      }));
      expect(foreignUpdates).toEqual({ batches: 0, attempts: 0 });

      const ownerState = await withTenant(owner.shopId, async (trx) => ({
        batch: await trx(BATCH_EXECUTIONS)
          .where({ generation_id: generationId, batch_index: 1 })
          .first('status', 'execution_id'),
        attempt: await trx(ATTEMPTS)
          .where({ attempt_id: attempt.attempt_id })
          .first('error_detail', 'finalized_at'),
      }));
      expect(ownerState).toEqual({
        batch: { status: 'dispatching', execution_id: execution.execution_id },
        attempt: { error_detail: null, finalized_at: null },
      });
    });

    it('E01-M05 — execution DELETE forbidden, identity immutable, converged/requires_regeneration immutable, no illegal transitions', async () => {
      requireSliceESchema();

      const executionTriggers = await triggers(EXECUTIONS);
      expect({
        beforeUpdate: executionTriggers.some(
          (t) => t.before && t.row && t.onUpdate
        ),
        beforeDelete: executionTriggers.some(
          (t) => t.before && t.row && t.onDelete
        ),
      }).toEqual({ beforeUpdate: true, beforeDelete: true });

      const fixture = await createFixture('e01-m05');
      const gen1 = await insertFrozenGeneration(fixture, 1);
      const gen2 = await insertFrozenGeneration(fixture, 2);
      const gen3 = await insertFrozenGeneration(fixture, 3);

      const exec = await insertExecution(fixture, gen1);

      // DELETE forbidden.
      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(EXECUTIONS)
            .where({ shop_id: fixture.shopId, execution_id: exec.execution_id })
            .del()
        )
      ).rejects.toBeDefined();

      // Identity immutable.
      await expect(
        updateExecution(fixture, exec.execution_id, {
          execution_id: crypto.randomUUID(),
        })
      ).rejects.toBeDefined();
      await expect(
        updateExecution(fixture, exec.execution_id, { generation_id: gen2 })
      ).rejects.toBeDefined();

      // Illegal transition: executing cannot jump straight to converged.
      await expect(
        updateExecution(fixture, exec.execution_id, terminalPatch('converged'))
      ).rejects.toBeDefined();

      // verifying cannot regress to executing.
      await expect(
        updateExecution(fixture, exec.execution_id, { status: 'verifying' })
      ).resolves.toBe(1);
      await expect(
        updateExecution(fixture, exec.execution_id, { status: 'executing' })
      ).rejects.toBeDefined();

      // converged is immutable (no terminal regression, no rewrite).
      await expect(
        updateExecution(fixture, exec.execution_id, terminalPatch('converged'))
      ).resolves.toBe(1);
      await expect(
        updateExecution(fixture, exec.execution_id, {
          status: 'executing',
          lease_token: crypto.randomUUID(),
          lease_expires_at: new Date(Date.now() + 60_000),
          terminal_at: null,
          terminal_reason: null,
        })
      ).rejects.toBeDefined();
      await expect(
        updateExecution(fixture, exec.execution_id, {
          terminal_reason: 'rewritten',
        })
      ).rejects.toBeDefined();

      // requires_regeneration is immutable.
      const exec2 = await insertExecution(fixture, gen2);
      await expect(
        updateExecution(
          fixture,
          exec2.execution_id,
          terminalPatch('requires_regeneration')
        )
      ).resolves.toBe(1);
      await expect(
        updateExecution(fixture, exec2.execution_id, {
          ...terminalPatch('converged'),
        })
      ).rejects.toBeDefined();
      await expect(
        updateExecution(fixture, exec2.execution_id, {
          terminal_reason: 'rewritten',
        })
      ).rejects.toBeDefined();

      // Remaining allowed edges: executing → blocked, verifying → blocked,
      // verifying → requires_regeneration.
      const exec3 = await insertExecution(fixture, gen3);
      await expect(
        updateExecution(fixture, exec3.execution_id, blockedPatch())
      ).resolves.toBe(1);

      const verifyingBlocked = await createFixture('e01-m05-vb');
      const vbGen = await insertFrozenGeneration(verifyingBlocked, 1);
      const vbExec = await insertExecution(verifyingBlocked, vbGen);
      await expect(
        updateExecution(verifyingBlocked, vbExec.execution_id, {
          status: 'verifying',
        })
      ).resolves.toBe(1);
      await expect(
        updateExecution(verifyingBlocked, vbExec.execution_id, blockedPatch())
      ).resolves.toBe(1);

      const verifyingRegen = await createFixture('e01-m05-vr');
      const vrGen = await insertFrozenGeneration(verifyingRegen, 1);
      const vrExec = await insertExecution(verifyingRegen, vrGen);
      await expect(
        updateExecution(verifyingRegen, vrExec.execution_id, {
          status: 'verifying',
        })
      ).resolves.toBe(1);
      await expect(
        updateExecution(
          verifyingRegen,
          vrExec.execution_id,
          terminalPatch('requires_regeneration')
        )
      ).resolves.toBe(1);

      const persisted = await withTenant(fixture.shopId, (trx) =>
        trx(EXECUTIONS)
          .whereIn('execution_id', [exec.execution_id, exec2.execution_id])
          .orderBy('generation_id')
          .select('execution_id', 'status', 'terminal_reason')
      );
      expect(
        Object.fromEntries(
          persisted.map((row: any) => [row.execution_id, row.status])
        )
      ).toEqual({
        [exec.execution_id]: 'converged',
        [exec2.execution_id]: 'requires_regeneration',
      });
    });

    it('E01-M06 — batch execution shape, PK, state set, succeeded IFF succeeded_at, tenant FKs and additive Slice-D UNIQUE', async () => {
      requireSliceESchema();

      const shape = await columnContractDiff(
        BATCH_EXECUTIONS,
        BATCH_EXECUTION_COLUMNS
      );
      expect(shape.actual).toEqual(shape.wanted);

      const indexes = await indexShapes(BATCH_EXECUTIONS);
      const fks = await foreignKeys(BATCH_EXECUTIONS);
      const sliceDBatchIndexes = await indexShapes(BATCHES);

      expect({
        primaryKey: indexes.some(
          (index) =>
            index.primary && sameSet(index.cols, ['generation_id', 'batch_index'])
        ),
        attemptCountDefaultZero: /^0\b/.test(
          String(await columnDefault(BATCH_EXECUTIONS, 'attempt_count'))
        ),
        statusCheckListsAllStates: await checkListsValues(
          BATCH_EXECUTIONS,
          'status',
          ['pending', 'dispatching', 'ambiguous', 'succeeded', 'rejected']
        ),
        tenantExecutionFk: hasForeignKey(
          fks,
          EXECUTIONS,
          [
            'execution_id->execution_id',
            'shop_id->shop_id',
            'generation_id->generation_id',
          ],
          'exact',
          'RESTRICT'
        ),
        tenantGenerationBatchFk: hasForeignKey(
          fks,
          BATCHES,
          [
            'generation_id->generation_id',
            'shop_id->shop_id',
            'batch_index->batch_index',
          ],
          'exact'
        ),
        sliceDTenantBatchUnique: hasFullUnique(sliceDBatchIndexes, [
          'generation_id',
          'shop_id',
          'batch_index',
        ]),
      }).toEqual({
        primaryKey: true,
        attemptCountDefaultZero: true,
        statusCheckListsAllStates: true,
        tenantExecutionFk: true,
        tenantGenerationBatchFk: true,
        sliceDTenantBatchUnique: true,
      });

      // Exact ordered execution FK: execution + tenant + generation identity.
      expect(
        fks
          .filter((fk) => fk.ref_table === EXECUTIONS)
          .map(({ cols, ref_cols, on_delete }) => ({
            cols,
            ref_cols,
            on_delete,
          }))
      ).toEqual([
        {
          cols: ['execution_id', 'shop_id', 'generation_id'],
          ref_cols: ['execution_id', 'shop_id', 'generation_id'],
          on_delete: 'RESTRICT',
        },
      ]);

      const fixture = await createFixture('e01-m06');
      const generationId = await insertFrozenGeneration(fixture, 1);
      const execution = await insertExecution(fixture, generationId);

      const insertBatch = (overrides: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(BATCH_EXECUTIONS).insert(
            batchExecutionRow(
              fixture,
              generationId,
              execution.execution_id,
              overrides
            )
          )
        );

      await expect(insertBatch({ status: 'queued' })).rejects.toBeDefined();
      await expect(insertBatch({ attempt_count: -1 })).rejects.toBeDefined();
      await expect(
        insertBatch({ succeeded_at: new Date() })
      ).rejects.toBeDefined();
      // No immutable Slice-D batch 2 exists for this generation.
      await expect(insertBatch({ batch_index: 2 })).rejects.toBeDefined();

      // Exact tuple (execution A, shop S, generation A) is accepted.
      await expect(insertBatch({})).resolves.toBeDefined();

      // Wrong generation: execution A paired with a legitimate immutable
      // batch of generation B (same shop) is rejected by the execution FK.
      const otherGenerationId = await insertFrozenGeneration(fixture, 2);
      const otherGenerationBatch = await withTenant(fixture.shopId, (trx) =>
        trx(BATCHES)
          .where({
            shop_id: fixture.shopId,
            generation_id: otherGenerationId,
            batch_index: 1,
          })
          .first('batch_index')
      );
      expect(otherGenerationBatch).toEqual({ batch_index: 1 });

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(BATCH_EXECUTIONS).insert(
            batchExecutionRow(
              fixture,
              otherGenerationId,
              execution.execution_id
            )
          )
        )
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'opening_inventory_cutover_batch_executions_execution_fk',
      });

      const updateBatch = (patch: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(BATCH_EXECUTIONS)
            .where({
              shop_id: fixture.shopId,
              generation_id: generationId,
              batch_index: 1,
            })
            .update({ updated_at: new Date(), ...patch })
        );

      // succeeded requires succeeded_at.
      await expect(
        updateBatch({ status: 'succeeded' })
      ).rejects.toBeDefined();

      // Cross-tenant FK: another shop cannot attach to this execution/batch.
      const other = await createFixture('e01-m06-other');
      await expect(
        withTenant(other.shopId, (trx) =>
          trx(BATCH_EXECUTIONS).insert(
            batchExecutionRow(other, generationId, execution.execution_id)
          )
        )
      ).rejects.toBeDefined();
    });

    it('E01-M07 — batch execution DELETE forbidden, identity immutable, succeeded is final', async () => {
      requireSliceESchema();

      const fixture = await createFixture('e01-m07');
      const gen1 = await insertFrozenGeneration(fixture, 1);
      const gen2 = await insertFrozenGeneration(fixture, 2);
      const execution = await insertExecution(fixture, gen1);

      await withTenant(fixture.shopId, (trx) =>
        trx(BATCH_EXECUTIONS).insert(
          batchExecutionRow(fixture, gen1, execution.execution_id)
        )
      );

      const updateBatch = (patch: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(BATCH_EXECUTIONS)
            .where({
              shop_id: fixture.shopId,
              generation_id: gen1,
              batch_index: 1,
            })
            .update({ updated_at: new Date(), ...patch })
        );

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(BATCH_EXECUTIONS)
            .where({
              shop_id: fixture.shopId,
              generation_id: gen1,
              batch_index: 1,
            })
            .del()
        )
      ).rejects.toBeDefined();

      // Identity immutable: generation_id cannot be re-pointed even to a
      // real immutable batch of the same shop.
      await expect(
        updateBatch({ generation_id: gen2 })
      ).rejects.toBeDefined();

      await expect(updateBatch({ status: 'dispatching' })).resolves.toBe(1);
      await expect(
        updateBatch({
          status: 'succeeded',
          succeeded_at: new Date(),
          shopify_adjustment_group_id:
            'gid://shopify/InventoryAdjustmentGroup/1',
        })
      ).resolves.toBe(1);

      for (const status of ['pending', 'dispatching', 'ambiguous', 'rejected']) {
        await expect(
          updateBatch({ status, succeeded_at: null })
        ).rejects.toBeDefined();
      }

      const persisted = await withTenant(fixture.shopId, (trx) =>
        trx(BATCH_EXECUTIONS)
          .where({ generation_id: gen1, batch_index: 1 })
          .first('status', 'execution_id')
      );
      expect(persisted).toEqual({
        status: 'succeeded',
        execution_id: execution.execution_id,
      });
    });

    it('E01-M08 — attempt shape, PK, UNIQUE attempt number, FK to batch execution, outcome set and finalization CHECKs', async () => {
      requireSliceESchema();

      const shape = await columnContractDiff(ATTEMPTS, ATTEMPT_COLUMNS);
      expect(shape.actual).toEqual(shape.wanted);

      const indexes = await indexShapes(ATTEMPTS);

      expect({
        primaryKey: indexes.some(
          (index) => index.primary && sameSet(index.cols, ['attempt_id'])
        ),
        uniqueAttemptNumber: hasFullUnique(indexes, [
          'generation_id',
          'batch_index',
          'attempt_number',
        ]),
        tenantExecutionBatchFk: hasForeignKey(
          await foreignKeys(ATTEMPTS),
          BATCH_EXECUTIONS,
          [
            'execution_id->execution_id',
            'shop_id->shop_id',
            'generation_id->generation_id',
            'batch_index->batch_index',
          ],
          'exact',
          'RESTRICT'
        ),
        outcomeCheckListsAll: await checkListsValues(ATTEMPTS, 'outcome', [
          'succeeded',
          'user_errors',
          'graphql_error',
          'http_error',
          'throttled',
          'no_response',
          'aborted',
          'abandoned',
        ]),
      }).toEqual({
        primaryKey: true,
        uniqueAttemptNumber: true,
        tenantExecutionBatchFk: true,
        outcomeCheckListsAll: true,
      });

      const { fixture, generationId, execution } =
        await executionScenario('e01-m08');

      const insertAttempt = (overrides: Record<string, unknown>) =>
        insertDispatchingAttempt(
          fixture.shopId,
          attemptRow(fixture, generationId, execution.execution_id, overrides)
        );

      await expect(insertAttempt({ attempt_number: 0 })).rejects.toBeDefined();

      const attempt = attemptRow(fixture, generationId, execution.execution_id);
      await insertDispatchingAttempt(fixture.shopId, attempt);

      const finalize = (patch: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(ATTEMPTS)
            .where({ shop_id: fixture.shopId, attempt_id: attempt.attempt_id })
            .update(patch)
        );

      // (outcome IS NULL) = (finalized_at IS NULL)
      await expect(
        finalize({
          outcome: 'succeeded',
          finalized_by_lease_token: attempt.dispatch_lease_token,
        })
      ).rejects.toBeDefined();
      await expect(
        finalize({
          finalized_at: new Date(),
          finalized_by_lease_token: attempt.dispatch_lease_token,
        })
      ).rejects.toBeDefined();

      // (finalized_at IS NULL) IFF (finalized_by_lease_token IS NULL)
      await expect(
        finalize({ finalized_at: new Date(), outcome: 'succeeded' })
      ).rejects.toBeDefined();

      // Unknown outcome rejected.
      await expect(
        finalize({
          finalized_at: new Date(),
          outcome: 'exploded',
          finalized_by_lease_token: attempt.dispatch_lease_token,
        })
      ).rejects.toBeDefined();

      // Positive control.
      await expect(
        finalize({
          finalized_at: new Date(),
          outcome: 'succeeded',
          finalized_by_lease_token: attempt.dispatch_lease_token,
          http_status: 200,
          x_request_id: 'req-e01-m08',
          served_api_version: '2026-04',
          shopify_adjustment_group_id:
            'gid://shopify/InventoryAdjustmentGroup/8',
        })
      ).resolves.toBe(1);

      // Same attempt number cannot be reused.
      await expect(insertAttempt({ attempt_number: 1 })).rejects.toBeDefined();
    });

    it('E01-M08b — attempt parent tuple is tenant + execution consistent (execution_id, shop_id, generation_id, batch_index)', async () => {
      requireSliceESchema();

      expect(
        hasFullUnique(await indexShapes(BATCH_EXECUTIONS), [
          'execution_id',
          'shop_id',
          'generation_id',
          'batch_index',
        ])
      ).toBe(true);

      const owner = await createFixture('e01-m08b-owner');
      const other = await createFixture('e01-m08b-other');

      // Execution 1 (generation 1) is terminal; execution 2 (generation 2)
      // owns the dispatching batch under test.
      const gen1 = await insertFrozenGeneration(owner, 1);
      const gen2 = await insertFrozenGeneration(owner, 2);

      const exec1 = await insertExecution(owner, gen1);
      await expect(
        updateExecution(owner, exec1.execution_id, terminalPatch('requires_regeneration'))
      ).resolves.toBe(1);

      const exec2 = await insertExecution(owner, gen2);
      await withTenant(owner.shopId, (trx) =>
        trx(BATCH_EXECUTIONS).insert(
          batchExecutionRow(owner, gen2, exec2.execution_id)
        )
      );
      await expect(markBatchDispatching(owner, gen2)).resolves.toBe(1);

      // Wrong execution_id, otherwise valid generation/batch → rejected.
      await expect(
        insertDispatchingAttempt(
          owner.shopId,
          attemptRow(owner, gen2, exec1.execution_id)
        )
      ).rejects.toBeDefined();

      // Wrong shop_id (tenant B), otherwise valid parent → rejected.
      await expect(
        insertDispatchingAttempt(
          other.shopId,
          attemptRow(other, gen2, exec2.execution_id)
        )
      ).rejects.toBeDefined();

      // Exact matching tuple → accepted.
      const exact = attemptRow(owner, gen2, exec2.execution_id);
      await insertDispatchingAttempt(owner.shopId, exact);

      const persisted = await withTenant(owner.shopId, (trx) =>
        trx(ATTEMPTS)
          .where({ generation_id: gen2, batch_index: 1 })
          .select('attempt_id', 'execution_id', 'shop_id')
      );
      expect(
        persisted.map((row: any) => ({
          attempt_id: row.attempt_id,
          execution_id: row.execution_id,
          shop_id: Number(row.shop_id),
        }))
      ).toEqual([
        {
          attempt_id: exact.attempt_id,
          execution_id: exec2.execution_id,
          shop_id: owner.shopId,
        },
      ]);
    });

    it('E01-M09 — at most one open (unfinalized) attempt per batch', async () => {
      requireSliceESchema();

      const indexes = await indexShapes(ATTEMPTS);
      expect(
        indexes
          .filter(
            (index) =>
              index.unique &&
              sameSet(index.cols, ['generation_id', 'batch_index']) &&
              /finalized_at IS NULL/i.test(String(index.predicate))
          )
          .map((index) => index.cols.length)
      ).toEqual([2]);

      const { fixture, generationId, execution } =
        await executionScenario('e01-m09');

      const first = attemptRow(fixture, generationId, execution.execution_id);
      await insertDispatchingAttempt(fixture.shopId, first);

      await expect(
        insertDispatchingAttempt(
          fixture.shopId,
          attemptRow(fixture, generationId, execution.execution_id, {
            attempt_number: 2,
          })
        )
      ).rejects.toBeDefined();

      await withTenant(fixture.shopId, (trx) =>
        trx(ATTEMPTS)
          .where({ shop_id: fixture.shopId, attempt_id: first.attempt_id })
          .update({
            finalized_at: new Date(),
            outcome: 'no_response',
            finalized_by_lease_token: first.dispatch_lease_token,
            error_class: 'timeout',
          })
      );

      await insertDispatchingAttempt(
        fixture.shopId,
        attemptRow(fixture, generationId, execution.execution_id, {
          attempt_number: 2,
        })
      );
    });

    it('E01-M10 — attempt finalization is one-shot; request/identity immutable; DELETE forbidden; finalizer lease may differ', async () => {
      requireSliceESchema();

      const { fixture, generationId, execution } =
        await executionScenario('e01-m10');

      // INSERT must be unfinalized.
      await expect(
        insertDispatchingAttempt(
          fixture.shopId,
          attemptRow(fixture, generationId, execution.execution_id, {
            finalized_at: new Date(),
            outcome: 'succeeded',
            finalized_by_lease_token: crypto.randomUUID(),
          })
        )
      ).rejects.toBeDefined();

      const attempt = attemptRow(fixture, generationId, execution.execution_id);
      await insertDispatchingAttempt(fixture.shopId, attempt);

      const update = (patch: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(ATTEMPTS)
            .where({ shop_id: fixture.shopId, attempt_id: attempt.attempt_id })
            .update(patch)
        );

      // Request/identity immutable while open.
      await expect(
        update({ request_sha256: '6'.repeat(64) })
      ).rejects.toBeDefined();
      await expect(
        update({ dispatch_lease_token: crypto.randomUUID() })
      ).rejects.toBeDefined();
      await expect(update({ attempt_number: 9 })).rejects.toBeDefined();
      await expect(
        update({ requested_api_version: '2026-07' })
      ).rejects.toBeDefined();
      await expect(
        update({ attempt_id: crypto.randomUUID() })
      ).rejects.toBeDefined();

      // A NEW lease owner abandons the old unfinalized attempt.
      const takeoverLease = crypto.randomUUID();
      expect(takeoverLease).not.toBe(attempt.dispatch_lease_token);

      await expect(
        update({
          finalized_at: new Date(),
          outcome: 'abandoned',
          finalized_by_lease_token: takeoverLease,
          error_class: 'lease_takeover',
          error_detail: 'previous lease expired before finalization',
        })
      ).resolves.toBe(1);

      // Immutable after finalization.
      await expect(update({ outcome: 'succeeded' })).rejects.toBeDefined();
      await expect(update({ error_detail: 'rewritten' })).rejects.toBeDefined();
      await expect(
        update({
          finalized_at: null,
          outcome: null,
          finalized_by_lease_token: null,
        })
      ).rejects.toBeDefined();

      // DELETE forbidden.
      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(ATTEMPTS)
            .where({ shop_id: fixture.shopId, attempt_id: attempt.attempt_id })
            .del()
        )
      ).rejects.toBeDefined();

      const persisted = await withTenant(fixture.shopId, (trx) =>
        trx(ATTEMPTS)
          .where({ attempt_id: attempt.attempt_id })
          .first(
            'outcome',
            'dispatch_lease_token',
            'finalized_by_lease_token',
            'request_sha256'
          )
      );
      expect(persisted).toEqual({
        outcome: 'abandoned',
        dispatch_lease_token: attempt.dispatch_lease_token,
        finalized_by_lease_token: takeoverLease,
        request_sha256: REQUEST_SHA256,
      });
    });

    it('E01-M11 — attempt request_sha256 must equal the immutable Slice-D batch request_sha256', async () => {
      requireSliceESchema();

      const attemptTriggers = await triggers(ATTEMPTS);
      expect(
        attemptTriggers.some(
          (t) =>
            t.before &&
            t.row &&
            t.onInsert &&
            t.source.includes(BATCHES) &&
            t.source.includes('request_sha256')
        )
      ).toBe(true);

      const { fixture, generationId, execution } =
        await executionScenario('e01-m11');

      // Well-formed but manufactured request identity.
      await expect(
        insertDispatchingAttempt(
          fixture.shopId,
          attemptRow(fixture, generationId, execution.execution_id, {
            request_sha256: '6'.repeat(64),
          })
        )
      ).rejects.toBeDefined();

      await insertDispatchingAttempt(
        fixture.shopId,
        attemptRow(fixture, generationId, execution.execution_id)
      );
    });

    it('E01-M12 — verification header shape, value sets, purpose/batch rule, complete requires finalization', async () => {
      requireSliceESchema();

      const shape = await columnContractDiff(
        VERIFICATIONS,
        VERIFICATION_COLUMNS
      );
      expect(shape.actual).toEqual(shape.wanted);

      const indexes = await indexShapes(VERIFICATIONS);

      expect({
        primaryKey: indexes.some(
          (index) => index.primary && sameSet(index.cols, ['verification_id'])
        ),
        pageCountDefaultZero: /^0\b/.test(
          String(await columnDefault(VERIFICATIONS, 'page_count'))
        ),
        tenantGenerationExecutionFk: hasForeignKey(
          await foreignKeys(VERIFICATIONS),
          EXECUTIONS,
          [
            'execution_id->execution_id',
            'shop_id->shop_id',
            'generation_id->generation_id',
          ],
          'exact',
          'RESTRICT'
        ),
        purposeCheck: await checkListsValues(VERIFICATIONS, 'purpose', [
          'ambiguity_inspection',
          'final_convergence',
        ]),
        statusCheck: await checkListsValues(VERIFICATIONS, 'status', [
          'collecting',
          'complete',
          'failed',
          'abandoned',
        ]),
        verdictCheck: await checkListsValues(VERIFICATIONS, 'verdict', [
          'applied',
          'not_applied',
          'mixed',
          'converged',
          'not_converged',
        ]),
      }).toEqual({
        primaryKey: true,
        pageCountDefaultZero: true,
        tenantGenerationExecutionFk: true,
        purposeCheck: true,
        statusCheck: true,
        verdictCheck: true,
      });

      const { fixture, generationId, execution } =
        await executionScenario('e01-m12');

      const insertVerification = (overrides: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATIONS).insert(
            verificationRow(
              fixture,
              generationId,
              execution.execution_id,
              overrides
            )
          )
        );

      await expect(
        insertVerification({ purpose: 'spot_check' })
      ).rejects.toBeDefined();
      await expect(
        insertVerification({ status: 'pending' })
      ).rejects.toBeDefined();
      await expect(
        insertVerification({ page_count: -1 })
      ).rejects.toBeDefined();

      // purpose ↔ batch_index rule.
      await expect(
        insertVerification({ purpose: 'ambiguity_inspection', batch_index: null })
      ).rejects.toBeDefined();
      await expect(
        insertVerification({ purpose: 'final_convergence', batch_index: 1 })
      ).rejects.toBeDefined();

      // Collecting rows are unfinalized.
      await expect(
        insertVerification({ finalized_by_lease_token: crypto.randomUUID() })
      ).rejects.toBeDefined();

      await expect(
        insertVerification({ purpose: 'ambiguity_inspection', batch_index: 1 })
      ).resolves.toBeDefined();

      const header = verificationRow(
        fixture,
        generationId,
        execution.execution_id
      );
      await withTenant(fixture.shopId, (trx) =>
        trx(VERIFICATIONS).insert(header)
      );

      const update = (patch: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATIONS)
            .where({
              shop_id: fixture.shopId,
              verification_id: header.verification_id,
            })
            .update(patch)
        );

      // complete requires read_completed_at, verdict and finalizer lease.
      await expect(
        update({ ...completeVerificationPatch(), read_completed_at: null })
      ).rejects.toBeDefined();
      await expect(
        update({ ...completeVerificationPatch(), verdict: null })
      ).rejects.toBeDefined();
      await expect(
        update({
          ...completeVerificationPatch(),
          finalized_by_lease_token: null,
        })
      ).rejects.toBeDefined();
      await expect(
        update({ ...completeVerificationPatch(), verdict: 'probably' })
      ).rejects.toBeDefined();

      await expect(update(completeVerificationPatch())).resolves.toBe(1);
    });

    it('E01-M12b — verification parent tuple is tenant + generation consistent (execution_id, shop_id, generation_id)', async () => {
      requireSliceESchema();

      expect(
        hasFullUnique(await indexShapes(EXECUTIONS), [
          'execution_id',
          'shop_id',
          'generation_id',
        ])
      ).toBe(true);

      const owner = await createFixture('e01-m12b-owner');
      const other = await createFixture('e01-m12b-other');

      const gen1 = await insertFrozenGeneration(owner, 1);
      const gen2 = await insertFrozenGeneration(owner, 2);
      const execution = await insertExecution(owner, gen1);

      // Wrong generation_id (another real frozen generation of the same shop).
      await expect(
        withTenant(owner.shopId, (trx) =>
          trx(VERIFICATIONS).insert(
            verificationRow(owner, gen2, execution.execution_id)
          )
        )
      ).rejects.toBeDefined();

      // Wrong shop_id (tenant B), otherwise valid execution/generation.
      await expect(
        withTenant(other.shopId, (trx) =>
          trx(VERIFICATIONS).insert(
            verificationRow(other, gen1, execution.execution_id)
          )
        )
      ).rejects.toBeDefined();

      // Exact execution/shop/generation tuple → accepted.
      const exact = verificationRow(owner, gen1, execution.execution_id);
      await withTenant(owner.shopId, (trx) =>
        trx(VERIFICATIONS).insert(exact)
      );

      const persisted = await withTenant(owner.shopId, (trx) =>
        trx(VERIFICATIONS)
          .where({ execution_id: execution.execution_id })
          .select('verification_id', 'generation_id')
      );
      expect(persisted).toEqual([
        { verification_id: exact.verification_id, generation_id: gen1 },
      ]);
    });

    it('E01-M13 — verification line shape, verdict set, (verification_id, item) identity and tenant FK', async () => {
      requireSliceESchema();

      const shape = await columnContractDiff(
        VERIFICATION_LINES,
        VERIFICATION_LINE_COLUMNS
      );
      expect(shape.actual).toEqual(shape.wanted);

      const indexes = await indexShapes(VERIFICATION_LINES);

      expect({
        lineIdentity: hasFullUnique(indexes, [
          'verification_id',
          'shopify_inventory_item_gid',
        ]),
        tenantVerificationFk: hasForeignKey(
          await foreignKeys(VERIFICATION_LINES),
          VERIFICATIONS,
          ['verification_id->verification_id', 'shop_id->shop_id'],
          'exact'
        ),
        lineVerdictCheck: await checkListsValues(
          VERIFICATION_LINES,
          'line_verdict',
          ['match', 'mismatch', 'old_state', 'unknown_item', 'inactive', 'untracked']
        ),
      }).toEqual({
        lineIdentity: true,
        tenantVerificationFk: true,
        lineVerdictCheck: true,
      });

      const { fixture, generationId, execution } =
        await executionScenario('e01-m13');

      const header = verificationRow(
        fixture,
        generationId,
        execution.execution_id
      );
      await withTenant(fixture.shopId, (trx) =>
        trx(VERIFICATIONS).insert(header)
      );

      const insertLine = (overrides: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATION_LINES).insert(
            verificationLineRow(fixture, header.verification_id, overrides)
          )
        );

      await expect(
        insertLine({ line_verdict: 'close_enough' })
      ).rejects.toBeDefined();

      await expect(insertLine({})).resolves.toBeDefined();
      await expect(insertLine({})).rejects.toBeDefined();

      // Another tenant cannot attach lines to this verification.
      const other = await createFixture('e01-m13-other');
      await expect(
        withTenant(other.shopId, (trx) =>
          trx(VERIFICATION_LINES).insert(
            verificationLineRow(other, header.verification_id, {
              shopify_inventory_item_gid:
                `gid://shopify/InventoryItem/9${other.shopId}`,
            })
          )
        )
      ).rejects.toBeDefined();
    });

    it('E01-M14 — verification evidence: append-only lines while collecting; header identity/terminal immutable; no DELETE', async () => {
      requireSliceESchema();

      const { fixture, generationId, execution } =
        await executionScenario('e01-m14');
      const gen2 = await insertFrozenGeneration(fixture, 2);

      const header = verificationRow(
        fixture,
        generationId,
        execution.execution_id
      );
      await withTenant(fixture.shopId, (trx) =>
        trx(VERIFICATIONS).insert(header)
      );

      const line = verificationLineRow(fixture, header.verification_id);
      await withTenant(fixture.shopId, (trx) =>
        trx(VERIFICATION_LINES).insert(line)
      );

      const lineWhere = {
        shop_id: fixture.shopId,
        verification_id: header.verification_id,
        shopify_inventory_item_gid: line.shopify_inventory_item_gid,
      };

      // Lines: no UPDATE, no DELETE.
      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATION_LINES)
            .where(lineWhere)
            .update({ observed_on_hand: 99 })
        )
      ).rejects.toBeDefined();
      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATION_LINES).where(lineWhere).del()
        )
      ).rejects.toBeDefined();

      const updateHeader = (patch: Record<string, unknown>) =>
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATIONS)
            .where({
              shop_id: fixture.shopId,
              verification_id: header.verification_id,
            })
            .update(patch)
        );

      // Header identity immutable.
      await expect(
        updateHeader({ verification_id: crypto.randomUUID() })
      ).rejects.toBeDefined();
      await expect(
        updateHeader({ generation_id: gen2 })
      ).rejects.toBeDefined();

      // Header DELETE forbidden.
      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATIONS)
            .where({
              shop_id: fixture.shopId,
              verification_id: header.verification_id,
            })
            .del()
        )
      ).rejects.toBeDefined();

      await expect(updateHeader(completeVerificationPatch())).resolves.toBe(1);

      // Terminal header immutable; no return to collecting.
      await expect(
        updateHeader({ status: 'collecting' })
      ).rejects.toBeDefined();
      await expect(
        updateHeader({ verdict: 'not_converged' })
      ).rejects.toBeDefined();
      await expect(
        updateHeader({ status: 'failed' })
      ).rejects.toBeDefined();

      // No late append after the header left collecting.
      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATION_LINES).insert(
            verificationLineRow(fixture, header.verification_id, {
              shopify_inventory_item_gid:
                `gid://shopify/InventoryItem/10${fixture.shopId}`,
            })
          )
        )
      ).rejects.toBeDefined();

      // failed / abandoned are also terminal and immutable.
      for (const terminal of ['failed', 'abandoned']) {
        const other = verificationRow(
          fixture,
          generationId,
          execution.execution_id
        );
        await withTenant(fixture.shopId, (trx) =>
          trx(VERIFICATIONS).insert(other)
        );

        const updateOther = (patch: Record<string, unknown>) =>
          withTenant(fixture.shopId, (trx) =>
            trx(VERIFICATIONS)
              .where({
                shop_id: fixture.shopId,
                verification_id: other.verification_id,
              })
              .update(patch)
          );

        await expect(
          updateOther({
            status: terminal,
            read_completed_at: new Date(),
            finalized_by_lease_token: crypto.randomUUID(),
          })
        ).resolves.toBe(1);
        await expect(
          updateOther(completeVerificationPatch())
        ).rejects.toBeDefined();
        await expect(
          updateOther({ status: 'collecting' })
        ).rejects.toBeDefined();
      }

      const persisted = await withTenant(fixture.shopId, (trx) =>
        trx(VERIFICATIONS)
          .where({ verification_id: header.verification_id })
          .first('status', 'verdict', 'generation_id')
      );
      expect(persisted).toEqual({
        status: 'complete',
        verdict: 'converged',
        generation_id: generationId,
      });
    });

    it('E01-M15 — both verification tables ENABLE + FORCE RLS with tenant policy; cross-tenant invisible', async () => {
      requireSliceESchema();

      expect(await rlsFlags([VERIFICATIONS, VERIFICATION_LINES])).toEqual([
        { relname: VERIFICATION_LINES, enabled: true, forced: true },
        { relname: VERIFICATIONS, enabled: true, forced: true },
      ]);
      expect({
        verifications: await hasTenantPolicy(VERIFICATIONS),
        lines: await hasTenantPolicy(VERIFICATION_LINES),
      }).toEqual({ verifications: true, lines: true });

      const { fixture, generationId, execution } =
        await executionScenario('e01-m15');
      const other = await createFixture('e01-m15-other');

      const header = verificationRow(
        fixture,
        generationId,
        execution.execution_id
      );
      await withTenant(fixture.shopId, async (trx) => {
        await trx(VERIFICATIONS).insert(header);
        await trx(VERIFICATION_LINES).insert(
          verificationLineRow(fixture, header.verification_id)
        );
      });

      const foreign = await withTenant(other.shopId, async (trx) => ({
        verifications: await trx(VERIFICATIONS).where({
          verification_id: header.verification_id,
        }),
        lines: await trx(VERIFICATION_LINES).where({
          verification_id: header.verification_id,
        }),
      }));
      expect(foreign).toEqual({ verifications: [], lines: [] });

      // Other tenant cannot write a header claiming the owner's shop_id.
      await expect(
        withTenant(other.shopId, (trx) =>
          trx(VERIFICATIONS).insert(
            verificationRow(fixture, generationId, execution.execution_id)
          )
        )
      ).rejects.toBeDefined();
    });

    it('E01-M16a — migration 0201 source is unchanged', () => {
      const source = fs.readFileSync(
        path.join(MIGRATIONS_DIR, MIGRATION_0201)
      );

      expect(
        crypto.createHash('sha256').update(source).digest('hex')
      ).toBe(MIGRATION_0201_SHA256);
    });

    it('E01-M16b — 0203 is additive: no Slice-D table recreate/rewrite; Slice-D constraints intact', async () => {
      const { source } = requireMigration0203();
      requireSliceESchema();

      const sliceDTable =
        'opening_inventory_cutover_generation(?:s|_entries|_batches)\\b';

      expect({
        recreatesSliceD: new RegExp(
          `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${sliceDTable}`,
          'i'
        ).test(source),
        dropsSliceD: new RegExp(
          `DROP\\s+TABLE[^;]*${sliceDTable}`,
          'i'
        ).test(source),
        rewritesSliceDColumns: new RegExp(
          `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${sliceDTable}[^;]*\\b(?:ADD|DROP|ALTER)\\s+COLUMN\\b`,
          'i'
        ).test(source),
      }).toEqual({
        recreatesSliceD: false,
        dropsSliceD: false,
        rewritesSliceDColumns: false,
      });

      const intact = {
        generations: await constraintNames(GENERATIONS),
        entries: await constraintNames(ENTRIES),
        batches: await constraintNames(BATCHES),
      };

      expect(intact.generations).toEqual(
        expect.arrayContaining([
          'opening_inventory_cutover_generations_tenant_identity_unique',
          'opening_inventory_cutover_generations_shop_sequence_unique',
          'opening_inventory_cutover_generations_status_valid',
        ])
      );
      expect(intact.entries).toEqual(
        expect.arrayContaining([
          'opening_inventory_cutover_generation_entries_pk',
          'opening_inventory_cutover_generation_entries_parent_fk',
        ])
      );
      expect(intact.batches).toEqual(
        expect.arrayContaining([
          'opening_inventory_cutover_generation_batches_pk',
          'opening_inventory_cutover_generation_batches_parent_fk',
          'opening_inventory_cutover_generation_batches_hash_valid',
        ])
      );

      // Slice-D batch immutability is still enforced by 0201.
      const batchTriggers = await triggers(BATCHES);
      expect(
        batchTriggers.map((t) => t.name).sort()
      ).toEqual(
        expect.arrayContaining([
          'opening_inventory_cutover_generation_batches_immutable',
          'opening_inventory_cutover_generation_batches_insert_guard',
        ])
      );
    });

    it('E01-M17b — 0203 down fails closed (migration role, row_security off, locked) when durable Slice-E evidence exists', async () => {
      const { source } = requireMigration0203();
      requireSliceESchema();
      const migration0203 = loadMigration0203();

      const downSource = source.slice(
        source.search(/export\s+async\s+function\s+down\b/)
      );

      expect({
        hasDown: /export\s+async\s+function\s+down\b/.test(source),
        rowSecurityOff: /row_security\s*=\s*off/i.test(downSource),
        locks: /LOCK\s+TABLE/i.test(downSource),
        blockedMarker: /ROLLBACK_BLOCKED/.test(downSource),
      }).toEqual({
        hasDown: true,
        rowSecurityOff: true,
        locks: true,
        blockedMarker: true,
      });

      const fixture = await createFixture('e01-m17');

      try {
        await inRolledBackTransaction(async (trx) => {
          await trx.raw(
            `SELECT set_config('app.current_tenant', ?, true)`,
            [String(fixture.shopId)]
          );

          // Minimal evidence: ONE execution header only. Any Slice-E
          // execution evidence must block rollback.
          const generationId = await insertFrozenGeneration(fixture, 1, trx);
          const execution = executionRow(fixture, generationId);
          await trx(EXECUTIONS).insert(execution);

          await trx.raw(
            `SET CONSTRAINTS opening_inventory_cutover_generations_frozen_at_commit IMMEDIATE`
          );

          // Drop tenant context so evidence is NOT visible through the
          // policy: down must still see it (row_security off) and refuse.
          await trx.raw(`SELECT set_config('app.current_tenant', '', true)`);

          const outcome = await inSavepoint(trx, (sp) => migration0203.down(sp));

          await trx.raw(
            `SELECT set_config('app.current_tenant', ?, true)`,
            [String(fixture.shopId)]
          );

          const { rows } = await trx.raw(
            `
              SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
              FROM unnest(?::text[]) AS name
              ORDER BY name
            `,
            [SLICE_E_TABLES]
          );

          const persisted = await trx(EXECUTIONS)
            .where({ execution_id: execution.execution_id })
            .first('execution_id');

          expect({
            downRejected: outcome.ok === false,
            tables: Object.fromEntries(
              rows.map((row: any) => [row.name, row.present])
            ),
            tenantBatchUnique: await hasTenantBatchUnique(trx),
            executionSurvives: persisted?.execution_id ?? null,
          }).toEqual({
            downRejected: true,
            tables: Object.fromEntries(
              SLICE_E_TABLES.map((table) => [table, true])
            ),
            tenantBatchUnique: true,
            executionSurvives: execution.execution_id,
          });

          expect(String((outcome as any).error?.message)).toMatch(
            /ROLLBACK_BLOCKED/
          );
        });
      } finally {
        // Rollback must leave the shared disposable DB at head, RED or GREEN.
        await inRolledBackTransaction(async (trx) => {
          const { rows } = await trx.raw(
            `
              SELECT count(*)::int AS present
              FROM unnest(?::text[]) AS name
              WHERE to_regclass('public.' || name) IS NOT NULL
            `,
            [SLICE_E_TABLES]
          );
          expect(rows[0].present).toBe(SLICE_E_TABLES.length);
        });
      }
    });

    it('E01-M18 — lookup indexes exist (definitions, not generated names)', async () => {
      requireSliceESchema();

      const executions = await indexShapes(EXECUTIONS);
      const batchExecutions = await indexShapes(BATCH_EXECUTIONS);
      const attempts = await indexShapes(ATTEMPTS);
      const verifications = await indexShapes(VERIFICATIONS);
      const lines = await indexShapes(VERIFICATION_LINES);

      expect({
        executions_shop_status: hasLeadingIndex(executions, ['shop_id', 'status']),
        batch_executions_shop_status: hasLeadingIndex(batchExecutions, [
          'shop_id',
          'status',
        ]),
        batch_executions_execution: hasLeadingIndex(batchExecutions, [
          'execution_id',
        ]),
        attempts_execution: hasLeadingIndex(attempts, ['execution_id']),
        attempts_generation_batch: hasLeadingIndex(attempts, [
          'generation_id',
          'batch_index',
        ]),
        verifications_execution: hasLeadingIndex(verifications, [
          'execution_id',
        ]),
        verifications_generation_purpose: hasLeadingIndex(verifications, [
          'generation_id',
          'purpose',
        ]),
        lines_shop_verification: hasLeadingIndex(lines, [
          'shop_id',
          'verification_id',
        ]),
      }).toEqual({
        executions_shop_status: true,
        batch_executions_shop_status: true,
        batch_executions_execution: true,
        attempts_execution: true,
        attempts_generation_batch: true,
        verifications_execution: true,
        verifications_generation_purpose: true,
        lines_shop_verification: true,
      });
    });

    it('E01-M19 — suite runs only inside the disposable synchroflow_test_* lifecycle', () => {
      expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
      expect(process.env.PGMIGRATION_USER).toBeTruthy();
      expect(process.env.PGMIGRATION_USER).not.toBe(process.env.PGUSER);
    });
  }
);
