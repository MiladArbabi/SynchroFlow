// SF-RECEIVE-PC-RELEASE-SAFETY-015 — shared disposable-DB fixture: turn a
// provisioned Shopify-linked test shop into one whose Receive recovery is
// genuinely eligible (owner decision: fixtures represent real eligibility;
// the guard is never weakened to pass tests).
//
//   1. canonical offline installation + ACTIVE credential (GH-1101 CONNECTED);
//   2. the default warehouse mapped to a Shopify location;
//   3. a REAL empty opening-inventory cutover (start → bins completed → freeze
//      → execute → converge) through the production services, so the marker,
//      the single converged generation and its CB1 capture header are written
//      by their own owners — never inserted by hand.
//
// Owner decision 015/C6 (option B): eligible shops are NOT seeded with
// seed_fresh_install's unlocated ROOT stock (no application flow can drain it
// before cutover). They reach FT1 through the real zero-order lifecycle path
// (provisionLinkedShopifyIntegration: updateIntegrationStatus COMPLETED →
// integration/sync_completed, as zero-order-sync-completion.test.ts), and
// their physical stock arrives only afterwards, through the suites' real
// Receive → close → Stow flows. Cutover readiness therefore sees a clean ROOT;
// no inventory correction or maintenance-role write is used.
//
// Provider I/O is injected and answers an empty, active location. No real
// Shopify request is ever made. The sync flag is the caller's to set.
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  claimRecountTask,
  completeOpeningInventoryBin,
} from 'api-src/services/wms/inventoryRecount.service';
import { startShopOpeningInventory } from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';
import { createOpeningInventoryCutoverGeneration } from 'api-src/services/wms/openingInventoryCutoverGeneration.service';
import * as executionModule from 'api-src/services/wms/openingInventoryCutoverExecution.service';
import { readRecoveryBaseline } from 'api-src/services/wms/shopifyRecoveryInventorySync.service';
import { updateIntegrationStatus } from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import { seedOfflineShopifySyncAuthority } from '../lifecycle/shopify-sync-authority.fixture';

type Entrypoint = (
  params: { shopId: number; generationId: string },
  deps?: { createShopifyGraphQLClient?: (args: any) => any; leaseDurationMs?: number }
) => Promise<any>;

const executeGeneration = executionModule.executeOpeningInventoryCutoverGeneration as unknown as Entrypoint;
const convergeGeneration = (executionModule as any).verifyOpeningInventoryCutoverConvergence as Entrypoint;

const FIXTURE_LEASE_MS = 2000;
/** Generation's supported served version; pinned like the I4 cutover suite. */
const CUTOVER_API_VERSION = '2026-04';

export const RECOVERY_SYNC_FLAG = 'SHOPIFY_RECOVERY_INVENTORY_SYNC_ENABLED';

function emptyLocationPage(locationGid: string) {
  return {
    data: {
      location: {
        id: locationGid,
        isActive: true,
        inventoryLevels: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
      },
    },
    extensions: {},
    headers: { 'X-Shopify-API-Version': [CUTOVER_API_VERSION] },
  };
}

/** Reads answer the empty location; any mutation means the fixture is wrong. */
function emptyProvider(locationGid: string) {
  return () => ({
    request: async (document: string) => {
      if (/\bmutation\b/.test(document)) throw new Error('[SAFETY015_FIXTURE] unexpected Shopify mutation');
      return emptyLocationPage(locationGid);
    },
  });
}

async function waitForExecutionLeaseExpiry(shopId: number, generationId: string): Promise<void> {
  for (let i = 0; i < 800; i += 1) {
    const result = await withTenant(shopId, (trx) =>
      trx.raw(
        `SELECT bool_and(lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) AS expired
           FROM opening_inventory_cutover_executions WHERE shop_id = ? AND generation_id = ?`,
        [shopId, generationId]
      ));
    if (result.rows[0]?.expired === true) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('[SAFETY015_FIXTURE] execution lease did not expire');
}

/**
 * Real zero-order Shopify link for a freshly HMAC-installed shop: integration
 * row (offline fixture — the OAuth callback cannot run offline), canonical
 * offline installation + ACTIVE credential, then the REAL
 * updateIntegrationStatus(COMPLETED), which emits integration/sync_completed.
 * The caller pumps domain events (FT_MINUS_ONE → FT0 → FT1) before FT2.
 */
export async function provisionLinkedShopifyIntegration(shopId: number, shopDomain: string): Promise<void> {
  const [row] = await withTenant(shopId, (trx) =>
    trx('integrations')
      .insert({
        shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
        sync_status: 'SYNCING_ORDERS', updated_at: new Date(),
      })
      .returning(['id']));
  const executionAuthority = await seedOfflineShopifySyncAuthority(shopId, shopDomain);
  await updateIntegrationStatus({
    integrationId: Number(row.id), shopId, status: 'COMPLETED', error: null, executionAuthority,
  });
}

/**
 * Establishes valid recovery sync eligibility for a shop provisioned through
 * provisionLinkedShopifyIntegration (variant mapping is the caller's:
 * syncProducts already maps fixture variants). Call before any stock exists,
 * so the cutover is empty. Returns the Shopify location id.
 */
export async function makeRecoverySyncEligible(shopId: number, userId: number): Promise<string> {
  const previousApiVersion = process.env.SHOPIFY_API_VERSION;
  process.env.SHOPIFY_API_VERSION = CUTOVER_API_VERSION;
  try {
    return await establishBaseline(shopId, userId);
  } finally {
    if (previousApiVersion === undefined) delete process.env.SHOPIFY_API_VERSION;
    else process.env.SHOPIFY_API_VERSION = previousApiVersion;
  }
}

async function establishBaseline(shopId: number, userId: number): Promise<string> {
  const installation = await withTenant(shopId, (trx) =>
    trx('shopify_app_installations').where({ shop_id: shopId }).whereNull('uninstalled_at').first('id'));
  if (!installation) throw new Error('[SAFETY015_FIXTURE] provisionLinkedShopifyIntegration first');

  const locationRaw = `77${shopId}`;
  const locationGid = `gid://shopify/Location/${locationRaw}`;
  await withTenant(shopId, async (trx) => {
    const warehouse = await trx('warehouses').where({ shop_id: shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    await trx('warehouses').where({ shop_id: shopId, warehouse_id: warehouse.warehouse_id })
      .update({ external_location_id: locationRaw });
    // Opening inventory needs at least one active stock bin to count.
    const stockBin = await trx('warehouse_locations')
      .where({ shop_id: shopId, warehouse_id: warehouse.warehouse_id, type: 'bin', active: true })
      .whereIn('zone_type', ['pick', 'storage'])
      .first('location_code');
    if (!stockBin) {
      await trx('warehouse_locations').insert({
        shop_id: shopId, warehouse_id: warehouse.warehouse_id, location_code: `S015-OPEN-${shopId}`,
        parent_location_code: warehouse.root_location_code, active: true, type: 'bin', zone_type: 'storage',
      });
    }
  });

  const readLocationPage = async () => emptyLocationPage(locationGid) as any;
  const started = await startShopOpeningInventory(
    { shopId, createdBy: userId, assignedTo: userId },
    { readLocationPage }
  );
  for (const bin of started.bins) {
    await withTenant(shopId, (trx) => claimRecountTask(trx, shopId, bin.recount_task_id, userId));
    await withTenant(shopId, (trx) => completeOpeningInventoryBin(trx, shopId, bin.recount_task_id, userId));
  }

  await createOpeningInventoryCutoverGeneration(
    { shopId, actingUserId: userId, acceptPhysicalTruth: true },
    { readLocationPage }
  );
  const generation = await withTenant(shopId, (trx) =>
    trx('opening_inventory_cutover_generations').where({ shop_id: shopId })
      .orderBy('generation_sequence', 'desc').first('generation_id'));
  const generationId = String(generation.generation_id);

  await executeGeneration(
    { shopId, generationId },
    { createShopifyGraphQLClient: emptyProvider(locationGid), leaseDurationMs: FIXTURE_LEASE_MS }
  );
  await waitForExecutionLeaseExpiry(shopId, generationId);
  const converged = await convergeGeneration(
    { shopId, generationId },
    { createShopifyGraphQLClient: emptyProvider(locationGid) }
  );
  if (!JSON.stringify(converged).includes('OPENING_CUTOVER_CONVERGED')) {
    throw new Error(`[SAFETY015_FIXTURE] cutover did not converge: ${JSON.stringify(converged)}`);
  }

  const baseline = await withTenant(shopId, (trx) => readRecoveryBaseline(trx, shopId));
  if (baseline.kind !== 'valid') throw new Error(`[SAFETY015_FIXTURE] baseline not valid: ${baseline.holdReason}`);
  return locationRaw;
}

/** Runs `fn` with the I4 flag set as given, restoring the previous value. */
export async function withRecoverySyncFlag<T>(value: 'true' | 'false' | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[RECOVERY_SYNC_FLAG];
  if (value === undefined) delete process.env[RECOVERY_SYNC_FLAG];
  else process.env[RECOVERY_SYNC_FLAG] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[RECOVERY_SYNC_FLAG];
    else process.env[RECOVERY_SYNC_FLAG] = previous;
  }
}
