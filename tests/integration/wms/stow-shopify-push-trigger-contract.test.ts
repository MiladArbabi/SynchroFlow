// GH-1193 — P0: Stow must not inflate Shopify inventory on non-inbound restows.
//
// LOCKED PRODUCT CONTRACT (generic Stow → Shopify):
//   inbound_stock            → PUSH +placedNow exactly once.
//   problem_center           → NO Shopify inventory push.
//   return_restock           → NO generic Stow Shopify inventory push.
//   order_cancelled_mid_pick → NO generic Stow Shopify inventory push.
//
// Invariant: a physical placement does not automatically imply a Shopify
// inventory increase. Only inventory proven to be newly entering
// Shopify-tracked warehouse stock may emit +qty.
//
// Exercised through the real route (POST /api/v1/wms/stow-tasks/:taskId/confirm)
// against the disposable synchroflow_test_* database. Only the Shopify provider
// client boundary is mocked. Every provider prerequisite (installation, token,
// inventory-item identity, warehouse Shopify location) is real for every case,
// so a zero-call assertion cannot pass vacuously; R1 proves the mocked provider
// path is reachable with the same fixture shape.
//
// The Shopify push is fire-and-forget after the stow transaction commits, so
// each case applies a bounded settle window after the route returns.

const mockRequest = jest.fn();

const mockCreateShopifyGraphQLClient = jest.fn(() => ({
  request: mockRequest,
}));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: any[]) =>
    mockCreateShopifyGraphQLClient(...args),
}));

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { claimStowTask } from 'api-src/services/wms/stow.service';
import { encrypt } from 'api-src/security/encryption.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING, normalizeAndValidateShopifyGrantedScopes } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(60000);

const app = createApp();

const DEST_BIN = 'GH1193-A-1';
const PROBLEM_BIN = 'GH1193-PROBLEM';

/** Upper bound for the post-response fire-and-forget push to reach the provider. */
const SHOPIFY_SETTLE_MS = 2000;
const SHOPIFY_SETTLE_POLL_MS = 25;

type StowTrigger =
  | 'inbound_stock'
  | 'problem_center'
  | 'return_restock'
  | 'order_cancelled_mid_pick';

interface Fixture {
  shopId: number;
  operatorId: number;
  operatorToken: string;
  shopDomain: string;
  variantId: string;
  rootCode: string;
  externalLocationId: string;
  externalInventoryItemId: string;
  receiveJobLineId: string;
  poId: string;
}

function successfulAdjustResponse() {
  return {
    data: {
      inventoryAdjustQuantities: {
        inventoryAdjustmentGroup: {
          id: 'gid://shopify/InventoryAdjustmentGroup/1193',
          reason: 'received',
          changes: [{ name: 'available', delta: 1, quantityAfterChange: 1 }],
        },
        userErrors: [],
      },
    },
  };
}

function inventoryAdjustCalls() {
  return mockRequest.mock.calls.filter(([query]) =>
    String(query).includes('inventoryAdjustQuantities')
  );
}

/**
 * Bounded settle for the fire-and-forget push: returns as soon as an
 * adjustment reaches the provider stub, otherwise after SHOPIFY_SETTLE_MS.
 */
async function settleShopifyPush(): Promise<void> {
  const deadline = Date.now() + SHOPIFY_SETTLE_MS;
  while (Date.now() < deadline) {
    if (inventoryAdjustCalls().length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, SHOPIFY_SETTLE_POLL_MS));
  }
  // Drain any remaining microtasks/IO callbacks queued by the push chain.
  await new Promise((resolve) => setImmediate(resolve));
}

async function createMember(
  shopId: number,
  unique: string,
  label: string,
  role: 'owner' | 'operator'
): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `gh1193-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role,
      })
      .returning('id');
    const userId = Number((row as any).id ?? row);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: null,
    });

    return userId;
  });
}

/**
 * Shopify-connected FT2 shop with every provider prerequisite present:
 * installation + fresh canonical credential, warehouse Shopify location mapping, and a
 * variant mapped to a Shopify inventory item. Also seeds the synthetic
 * PO → receive-job → receive-line chain inventory_units requires.
 */
async function createFixture(): Promise<Fixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const unique = crypto.randomBytes(6).toString('hex');
  const shopDomain = `gh1193-${unique}.myshopify.com`;
  const externalLocationId = String(crypto.randomInt(1_000_000, 9_999_999));
  const externalInventoryItemId = String(crypto.randomInt(1_000_000, 9_999_999));

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1193-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createMember(shopId, unique, 'owner', 'owner');
  const operatorId = await createMember(shopId, unique, 'operator', 'operator');

  const rootCode = `WH-${shopId}-ROOT`;
  const warehouseId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const { poId, receiveJobLineId } = await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      scopes: 'write_inventory',
    }).returning('id');

    // Fresh canonical authority for the same merchant credential and domain.
    const now = new Date();
    const time = (seconds: number) => new Date(now.getTime() + seconds * 1000);
    await trx('shopify_admin_credentials').insert({
      shop_id: shopId,
      installation_id: installation.id,
      access_token_encrypted: encrypt('gh1193-offline-token-no-network-call'),
      refresh_token_encrypted: encrypt('gh1193-refresh-token-no-network-call'),
      access_expires_at: time(86400),
      refresh_expires_at: time(2592000),
      granted_scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      credential_generation: '7',
      credential_state: 'ACTIVE',
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `GH1193 warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
      external_location_id: externalLocationId,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: DEST_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: PROBLEM_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'GH1193 product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GH1193-${unique}`,
      title: 'GH1193 variant',
      unit_cost: '5.00',
      status: 'active',
    });

    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_variant_id: `gid://shopify/ProductVariant/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_inventory_item_id: externalInventoryItemId,
    });

    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shopId, name: `GH1193 supplier ${unique}`, active: true })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: (supplier as any).id ?? supplier, status: 'shipped' })
      .returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        description: 'GH1193 PO line',
        quantity_ordered: 1,
        quantity_received: 1,
      })
      .returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: poId, status: 'closed', total_variants: 1, total_units: 1 })
      .returning('receive_job_id');
    const receiveJobId = String((job as any).receive_job_id ?? job);
    const [line] = await trx('receive_job_lines')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLine as any).id ?? poLine,
        lasyncro_variant_id: variantId,
        quantity_expected: 1,
        quantity_accepted: 1,
        inspection_complete: true,
      })
      .returning('receive_job_line_id');

    return {
      poId,
      receiveJobLineId: String((line as any).receive_job_line_id ?? line),
    };
  });

  return {
    shopId,
    operatorId,
    operatorToken: issueTestToken({
      userId: operatorId,
      shopId,
      tier: 'core',
      roles: ['operator'],
    }),
    shopDomain,
    variantId,
    rootCode,
    externalLocationId,
    externalInventoryItemId,
    receiveJobLineId,
    poId,
  };
}

/**
 * Seeds one physical unit, its pre-stow inventory truth, and a pending stow
 * task for the given trigger, then claims it as the operator.
 *
 *   inbound_stock            received, unlocated LSU; 1 on hand at ROOT
 *   problem_center           LSU stowed in PROBLEM_BIN; 1 on hand at PROBLEM_BIN;
 *                            open problem task sourcing PROBLEM_BIN
 *   return_restock           received, unlocated LSU; no source truth (credit)
 *   order_cancelled_mid_pick picked, unlocated LSU; no source truth (credit);
 *                            open order_cancelled problem task sourcing PROBLEM_BIN
 */
async function seedClaimedStowTask(fixture: Fixture, trigger: StowTrigger) {
  const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;

  const unitState: Record<StowTrigger, { status: string; location: string | null }> = {
    inbound_stock: { status: 'received', location: null },
    problem_center: { status: 'stowed', location: PROBLEM_BIN },
    return_restock: { status: 'received', location: null },
    order_cancelled_mid_pick: { status: 'picked', location: null },
  };
  const sourceTruthLocation: Record<StowTrigger, string | null> = {
    inbound_stock: fixture.rootCode,
    problem_center: PROBLEM_BIN,
    return_restock: null,
    order_cancelled_mid_pick: null,
  };

  const taskId = await withTenant(fixture.shopId, async (trx) => {
    await trx('inventory_units').insert({
      shop_id: fixture.shopId,
      lasyncro_variant_id: fixture.variantId,
      receive_job_line_id: fixture.receiveJobLineId,
      receive_sequence: 1,
      status: unitState[trigger].status,
      current_location_code: unitState[trigger].location,
      lasyncro_unit_id: lasyncroUnitId,
    });

    const truthLocation = sourceTruthLocation[trigger];
    if (truthLocation) {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx('inventory_truth').insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        location_code: truthLocation,
        on_hand_quantity: 1,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: 1,
        last_evaluated_at: new Date(),
      });
    }

    let sourceTaskId: string | null = null;
    if (trigger === 'problem_center' || trigger === 'order_cancelled_mid_pick') {
      const [problemTask] = await trx('problem_center_tasks')
        .insert({
          shop_id: fixture.shopId,
          status: 'open',
          source: trigger === 'problem_center' ? 'stow' : 'pick',
          lasyncro_variant_id: fixture.variantId,
          quantity: 1,
          exception_type:
            trigger === 'problem_center' ? 'bin_over_capacity' : 'order_cancelled',
          problem_bin_location: PROBLEM_BIN,
        })
        .returning('problem_task_id');
      sourceTaskId = String((problemTask as any).problem_task_id ?? problemTask);
    }

    const [task] = await trx('stow_tasks')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        quantity: 1,
        location_code: DEST_BIN,
        status: 'pending',
        trigger,
        receive_job_line_id: trigger === 'inbound_stock' ? fixture.receiveJobLineId : null,
        po_id: trigger === 'inbound_stock' ? fixture.poId : null,
        source_task_id: sourceTaskId,
      })
      .returning('stow_task_id');

    return String((task as any).stow_task_id ?? task);
  });

  await withTenant(fixture.shopId, (trx) =>
    claimStowTask(trx, taskId, fixture.shopId, fixture.operatorId)
  );

  return { taskId, lasyncroUnitId };
}

function confirmStowRoute(fixture: Fixture, taskId: string, lasyncroUnitId: string) {
  return request(app)
    .post(`/api/v1/wms/stow-tasks/${taskId}/confirm`)
    .set('Authorization', `Bearer ${fixture.operatorToken}`)
    .send({ quantity_placed: 1, lasyncro_unit_id: lasyncroUnitId });
}

async function physicalState(fixture: Fixture, taskId: string, lasyncroUnitId: string) {
  return withTenant(fixture.shopId, async (trx) => {
    const truthRows = await trx('inventory_truth')
      .where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId })
      .select('location_code', 'on_hand_quantity');
    const onHand = (location: string) =>
      Number(truthRows.find((row: any) => row.location_code === location)?.on_hand_quantity ?? 0);

    return {
      task: await trx('stow_tasks')
        .where({ shop_id: fixture.shopId, stow_task_id: taskId })
        .first('status', 'quantity_placed'),
      unit: await trx('inventory_units')
        .where({ shop_id: fixture.shopId, lasyncro_unit_id: lasyncroUnitId })
        .first('status', 'current_location_code'),
      rootOnHand: onHand(fixture.rootCode),
      problemOnHand: onHand(PROBLEM_BIN),
      destinationOnHand: onHand(DEST_BIN),
    };
  });
}

describe('GH-1193 — generic Stow → Shopify inventory push is trigger-scoped', () => {
  const previousEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY ||
      'gh1193-stow-shopify-test-key-that-is-at-least-thirty-two-characters';
  });

  afterAll(() => {
    if (previousEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = previousEncryptionKey;
    }
  });

  beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValue(successfulAdjustResponse());
    mockCreateShopifyGraphQLClient.mockClear();
    mockCreateShopifyGraphQLClient.mockImplementation(() => ({ request: mockRequest }));
  });

  it('R1 inbound_stock: pushes +1 to the warehouse-mapped Shopify location exactly once; replay does not push again', async () => {
    const fixture = await createFixture();
    const { taskId, lasyncroUnitId } = await seedClaimedStowTask(fixture, 'inbound_stock');

    const response = await confirmStowRoute(fixture, taskId, lasyncroUnitId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      stow_task_id: taskId,
      status: 'completed',
      is_fully_placed: true,
      placed_now: 1,
    });

    const after = await physicalState(fixture, taskId, lasyncroUnitId);
    expect(after.task).toMatchObject({ status: 'completed', quantity_placed: 1 });
    expect(after.unit).toEqual({ status: 'stowed', current_location_code: DEST_BIN });
    expect(after.rootOnHand).toBe(0);
    expect(after.destinationOnHand).toBe(1);

    await settleShopifyPush();

    expect(mockCreateShopifyGraphQLClient).toHaveBeenCalledWith({
      accessToken: 'gh1193-offline-token-no-network-call',
      platformShopName: fixture.shopDomain,
      shopId: fixture.shopId,
    });

    const calls = inventoryAdjustCalls();
    expect(calls).toHaveLength(1);
    const [, options] = calls[0];
    expect(options.variables.idempotencyKey).toBe(
      `lasyncro:stow:${fixture.shopId}:${taskId}:1`
    );
    expect(options.variables.input).toEqual({
      reason: 'received',
      name: 'available',
      changes: [
        {
          inventoryItemId: `gid://shopify/InventoryItem/${fixture.externalInventoryItemId}`,
          locationId: `gid://shopify/Location/${fixture.externalLocationId}`,
          delta: 1,
          changeFromQuantity: null,
        },
      ],
    });

    // Replay of the same confirm must not produce a second adjustment.
    const replay = await confirmStowRoute(fixture, taskId, lasyncroUnitId);
    expect(replay.status).toBe(409);

    mockRequest.mockClear();
    await settleShopifyPush();
    expect(inventoryAdjustCalls()).toHaveLength(0);
  });

  it('R2 problem_center: re-stow moves truth PROBLEM → destination with zero Shopify adjustments', async () => {
    const fixture = await createFixture();
    const { taskId, lasyncroUnitId } = await seedClaimedStowTask(fixture, 'problem_center');

    const response = await confirmStowRoute(fixture, taskId, lasyncroUnitId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', placed_now: 1 });

    const after = await physicalState(fixture, taskId, lasyncroUnitId);
    expect(after.task).toMatchObject({ status: 'completed', quantity_placed: 1 });
    expect(after.unit).toEqual({ status: 'stowed', current_location_code: DEST_BIN });
    expect(after.problemOnHand).toBe(0);
    expect(after.destinationOnHand).toBe(1);

    await settleShopifyPush();
    expect(inventoryAdjustCalls()).toHaveLength(0);
  });

  it('R3 return_restock: physical recovery credits the destination with zero generic Stow Shopify adjustments', async () => {
    const fixture = await createFixture();
    const { taskId, lasyncroUnitId } = await seedClaimedStowTask(fixture, 'return_restock');

    const response = await confirmStowRoute(fixture, taskId, lasyncroUnitId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', placed_now: 1 });

    const after = await physicalState(fixture, taskId, lasyncroUnitId);
    expect(after.task).toMatchObject({ status: 'completed', quantity_placed: 1 });
    expect(after.unit).toEqual({ status: 'stowed', current_location_code: DEST_BIN });
    expect(after.destinationOnHand).toBe(1);

    await settleShopifyPush();
    expect(inventoryAdjustCalls()).toHaveLength(0);
  });

  it('R4 order_cancelled_mid_pick: physical recovery credits the destination with zero generic Stow Shopify adjustments', async () => {
    const fixture = await createFixture();
    const { taskId, lasyncroUnitId } = await seedClaimedStowTask(
      fixture,
      'order_cancelled_mid_pick'
    );

    const response = await confirmStowRoute(fixture, taskId, lasyncroUnitId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', placed_now: 1 });

    const after = await physicalState(fixture, taskId, lasyncroUnitId);
    expect(after.task).toMatchObject({ status: 'completed', quantity_placed: 1 });
    expect(after.unit).toEqual({ status: 'stowed', current_location_code: DEST_BIN });
    expect(after.problemOnHand).toBe(0);
    expect(after.destinationOnHand).toBe(1);

    await settleShopifyPush();
    expect(inventoryAdjustCalls()).toHaveLength(0);
  });
});
