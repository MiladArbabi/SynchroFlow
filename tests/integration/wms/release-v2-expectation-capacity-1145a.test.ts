/**
 * GH-1145-A1 — dynamic release-path proof on a genuine v2 install.
 *
 * Real HMAC install (=> reconcile_opening_expectation_v2), real product sync,
 * the REAL Shopify opening ingestion reporting inventoryQuantity=20 (an
 * expectation only), 5 units of physical stock at WH-{shopId}-ROOT, real
 * order sync + domain-event intake, the real lifecycle ladder, and the real
 * POST /api/v1/wms/batch/release endpoint.
 *
 *   demand 6  -> not releasable: no batch, zero reservation_hold
 *   demand 5  -> releases and reserves exactly 5 at ROOT
 *   5 + 5 released together (both eligible at intake) -> the release-time
 *                precheck admits exactly one and excludes the other
 *
 * The variant carries a barcode so Pick scan readiness (GH-1145-D) is
 * satisfied and the proof isolates quantity capacity.
 *
 * FT2EvaluatorService bypasses its data-coverage blockers under
 * NODE_ENV=test (see fresh-install-release-path.test.ts); the sync guard
 * above that bypass is real, hence the COMPLETED integrations row.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncShopifyProducts } from 'api-src/services/shopify/shopifyProductSync.service';
import { syncShopifyOrders } from 'api-src/services/shopify/shopifyOrderSync.service';
import { seedShopifyOpeningBalances } from 'api-src/services/inventory/seedShopifyOpeningBalances';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { readReleaseCapacity } from 'api-src/services/inventory/releaseCapacity.service';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`)
    .join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);
  expect(install.status).toBe(302);

  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [
      `shopify-install+${shopDomain}@lasyncro.internal`,
    ])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

function orderEdge(shopId: number, n: number, productGid: string, variantGid: string, qty: number) {
  const created = new Date(Date.now() - (10 - n) * 36e5).toISOString();
  const lineTotal = (10 * qty).toFixed(2);
  return {
    node: {
      id: `8${shopId}11${n}`,
      name: `#${shopId}11${n}`,
      customer: { id: `gid://shopify/Customer/5${shopId}00${n}` },
      createdAt: created,
      updatedAt: created,
      processedAt: created,
      sourceName: 'web',
      currencyCode: 'USD',
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'UNFULFILLED',
      totalPriceSet: { shopMoney: { amount: lineTotal, currencyCode: 'USD' } },
      subtotalPriceSet: { shopMoney: { amount: lineTotal } },
      totalTaxSet: { shopMoney: { amount: '0.0' } },
      shippingAddress: {
        zip: '11245',
        city: 'Stockholm',
        name: `A1 Customer ${n}`,
        phone: null,
        address1: 'Sankt Goransgatan 95',
        address2: null,
        countryCode: 'SE',
        provinceCode: null,
      },
      lineItems: {
        edges: [
          {
            node: {
              id: `gid://shopify/LineItem/8${shopId}11${n}001`,
              product: { id: productGid },
              variant: { id: variantGid },
              quantity: qty,
              originalTotalSet: { shopMoney: { amount: lineTotal } },
              originalUnitPriceSet: { shopMoney: { amount: '10.00' } },
              discountedUnitPriceSet: { shopMoney: { amount: '10.00' } },
            },
          },
        ],
      },
    },
  };
}

async function holdsFor(shopId: number, variantId: string) {
  return withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'reservation_hold' })
      .select('location_code', 'quantity_delta', 'reference_id')
  );
}

async function capacity(shopId: number, variantId: string): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    readReleaseCapacity(trx, { shopId, variantIds: [variantId], lock: 'none' })
  );
  return rows.reduce((sum, row) => sum + row.availableQuantity, 0);
}

describe('GH-1145-A1 — v2 expectation vs physical capacity on the real release path', () => {
  it('RELEASE-01: v2 expectation 20 + physical 5 — demand 6 is not released, demand 5 reserves exactly 5, the precheck admits only one of 5+5', async () => {
    const shopDomain = `gh1145a-release-${crypto.randomBytes(4).toString('hex')}.myshopify.com`;
    const { shopId, userId } = await hmacInstall(shopDomain);
    const rootCode = `WH-${shopId}-ROOT`;

    const settings = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first('bootstrap_model')
    );
    expect(settings?.bootstrap_model).toBe('reconcile_opening_expectation_v2');

    // ---- products + opening expectation --------------------------------
    const productGid = `gid://shopify/Product/7${shopId}001`;
    const variantGid = `gid://shopify/ProductVariant/6${shopId}001`;

    await withTenant(shopId, (trx) =>
      syncShopifyProducts({
        trx,
        shopId,
        integrationId: 0,
        accessToken: 'offline-no-network-call',
        platformShopName: shopDomain,
        products: [
          {
            node: {
              id: productGid,
              title: 'GH-1145-A1 release product',
              status: 'ACTIVE',
              productType: 'Apparel',
              featuredImage: { url: null },
              variants: {
                edges: [
                  {
                    node: {
                      id: variantGid,
                      sku: `A1REL-${shopId}`,
                      title: 'Default Title',
                      barcode: `1145${shopId}0001`,
                      image: { url: null },
                      inventoryItem: {
                        id: `gid://shopify/InventoryItem/5${shopId}001`,
                        unitCost: { amount: '5.00' },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      })
    );

    const variant = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId, sku: `A1REL-${shopId}` }).first('lasyncro_variant_id')
    );
    const variantId = variant!.lasyncro_variant_id as string;

    const shopifyClient = {
      request: jest.fn().mockResolvedValue({
        data: {
          products: {
            edges: [{ node: { variants: { edges: [{ node: { id: variantGid, inventoryQuantity: 20 } }] } } }],
          },
        },
      }),
    };

    await withTenant(shopId, async (trx) => {
      await seedShopifyOpeningBalances(trx, 'offline', shopDomain, shopId, shopifyClient);
      await rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date());
    });

    const expectation = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('expected_quantity')
    );
    expect(Number(expectation?.expected_quantity)).toBe(20);
    expect(await capacity(shopId, variantId)).toBe(0);

    // ---- 5 units of physical stock at ROOT -----------------------------
    await withTenant(shopId, async (trx) => {
      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'inbound_purchase',
        quantity_delta: 5,
        reference_type: 'test_fixture_receipt',
        reference_id: crypto.randomUUID(),
        platform: 'wms',
        location_code: rootCode,
        occurred_at: new Date(),
        triggered_by: 'receive_job',
      });
      await rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date());
    });
    expect(await capacity(shopId, variantId)).toBe(5);

    // ---- orders: 6, 5, 5 through real intake ---------------------------
    await withTenant(shopId, (trx) =>
      syncShopifyOrders({
        trx,
        shopId,
        orderEdges: [
          orderEdge(shopId, 1, productGid, variantGid, 6),
          orderEdge(shopId, 2, productGid, variantGid, 5),
          orderEdge(shopId, 3, productGid, variantGid, 5),
        ],
      })
    );

    await withTenant(shopId, (trx) =>
      trx('integrations').insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        access_token_encrypted: encrypt('offline-test-token-no-network-call'),
        sync_status: 'COMPLETED',
        updated_at: new Date(),
      })
    );

    let cursor = 0;
    cursor = await pumpEvents(shopId, cursor);
    cursor = await pumpEvents(shopId, cursor);
    cursor = await pumpEvents(shopId, cursor);

    const token = issueTestToken({ userId, shopId, tier: 'core' });
    const confirm = await request(app)
      .post('/api/v1/lifecycle/ft2/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(confirm.status).toBe(200);
    await pumpEvents(shopId, cursor);

    const phase = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first('phase')
    );
    expect(phase?.phase).toBe('FT2');

    const orderLines: Array<{ lasyncro_order_id: string; quantity: number }> = await withTenant(shopId, (trx) =>
      trx('orders as o')
        .join('order_line_items as li', 'li.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .orderBy('o.order_created_at', 'asc')
        .select('o.lasyncro_order_id', 'li.quantity')
    );
    expect(orderLines.map((l) => Number(l.quantity))).toEqual([6, 5, 5]);
    const [orderOfSix, firstOrderOfFive, secondOrderOfFive] = orderLines.map((l) => l.lasyncro_order_id);
    expect(orderOfSix && firstOrderOfFive && secondOrderOfFive).toBeTruthy();

    // Intake: the expectation 20 does not make 6 eligible.
    const activeInventoryConstraints = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({ constraint_type: 'inventory', is_active: true })
        .whereIn('lasyncro_order_id', [orderOfSix, firstOrderOfFive, secondOrderOfFive])
        .select('lasyncro_order_id')
    );
    expect(activeInventoryConstraints.map((r: { lasyncro_order_id: string }) => r.lasyncro_order_id)).toEqual([
      orderOfSix,
    ]);

    // ---- demand 6: rejected, zero reservation ---------------------------
    const releaseSix = await request(app)
      .post('/api/v1/wms/batch/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ priority_order_ids: [orderOfSix], exclusive: true });

    // Existing exclusive-release contract: 201 with no batch, the order
    // reported as skipped because it is inventory-blocked.
    expect(releaseSix.status).toBe(201);
    expect(releaseSix.body.pick_batch_id).toBeNull();
    expect(releaseSix.body.order_count).toBe(0);
    expect(releaseSix.body.skipped_orders).toEqual([
      expect.objectContaining({ order_id: orderOfSix, reason: 'blocked' }),
    ]);
    expect(await holdsFor(shopId, variantId)).toEqual([]);
    expect(await capacity(shopId, variantId)).toBe(5);

    // ---- 5 + 5 together: precheck admits exactly one -------------------
    const releaseFives = await request(app)
      .post('/api/v1/wms/batch/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ priority_order_ids: [firstOrderOfFive, secondOrderOfFive], exclusive: true });

    expect(releaseFives.status).toBe(201);
    expect(releaseFives.body.order_count).toBe(1);

    const batchId = releaseFives.body.pick_batch_id as string;
    const batchOrders = await withTenant(shopId, (trx) =>
      trx('pick_batch_orders').where({ shop_id: shopId, pick_batch_id: batchId }).select('lasyncro_order_id')
    );
    expect(batchOrders).toHaveLength(1);
    const releasedOrderId = batchOrders[0].lasyncro_order_id as string;
    const heldBackOrderId = releasedOrderId === firstOrderOfFive ? secondOrderOfFive : firstOrderOfFive;
    expect([firstOrderOfFive, secondOrderOfFive]).toContain(releasedOrderId);

    const holds = await holdsFor(shopId, variantId);
    expect(holds).toEqual([{ location_code: rootCode, quantity_delta: 5, reference_id: batchId }]);

    const allocations = await withTenant(shopId, (trx) =>
      trx('pick_reservation_allocations')
        .where({ shop_id: shopId, pick_batch_id: batchId })
        .select('lasyncro_order_id', 'location_code', 'quantity')
    );
    expect(allocations).toEqual([
      { lasyncro_order_id: releasedOrderId, location_code: rootCode, quantity: 5 },
    ]);
    expect(await capacity(shopId, variantId)).toBe(0);

    // The release-time precheck excluded the other 5 from the batch and
    // reported it; it holds no reservation. (Whether a persisted constraint
    // follows is decided by the pre-existing canonical re-evaluation, which
    // runs before this batch's reservation and is not an A1 contract.)
    expect(releaseFives.body.newly_blocked_orders).toEqual([
      expect.objectContaining({ order_id: heldBackOrderId, block_type: 'oversell' }),
    ]);
    const heldBackInBatch = await withTenant(shopId, (trx) =>
      trx('pick_batch_orders').where({ shop_id: shopId, lasyncro_order_id: heldBackOrderId }).first('pick_batch_id')
    );
    expect(heldBackInBatch).toBeUndefined();
  }, 120000);
});
