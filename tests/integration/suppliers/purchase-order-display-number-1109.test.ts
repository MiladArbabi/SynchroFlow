import crypto from 'crypto';
import type { Knex } from 'knex';
import knexLib from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';
import * as migration0179 from '../../../apps/backend/migrations/20260915170000_0179_purchase_order_display_number';

const app = createApp();

jest.setTimeout(180_000);

beforeAll(() => {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function createShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function createUser(shopId: number): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `po-number-${crypto.randomUUID()}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'PO Number',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: row.id,
      role: 'owner',
    });

    return row.id as number;
  });
}

async function activateGrowthShop(shopId: number, userId: number): Promise<void> {
  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });
}

async function createSupplier(shopId: number, overrides: Record<string, unknown> = {}): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({
        shop_id: shopId,
        name: `PO Number Supplier ${crypto.randomUUID()}`,
        lead_time_days: 3,
        ...overrides,
      })
      .returning('id');

    return row.id as number;
  });
}

async function createVariant(shopId: number): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'PO Number Product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `PO-NUM-${variantId.slice(0, 8)}`,
      title: 'Default Title',
      unit_cost: '1.00',
      status: 'active',
    });
  });

  return variantId;
}

/**
 * GH-1262 S1: manual PO lines must name a canonical Shopify variant of an
 * installed store. A live installation without credentials classifies as
 * REAUTH_REQUIRED, which still permits draft PO creation; no provider call.
 */
async function installShopify(shopId: number): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: `po-number-${crypto.randomBytes(5).toString('hex')}.myshopify.com`,
      scopes: 'read_products',
    }),
  );
}

async function linkShopifyIdentity(shopId: number, variantId: string): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_variant_id: `gid://shopify/ProductVariant/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_inventory_item_id: null,
    }),
  );
}

async function insertPo(
  trx: Knex.Transaction,
  shopId: number,
  supplierId: number,
  overrides: Record<string, unknown> = {},
) {
  const [row] = await trx('purchase_orders')
    .insert({
      shop_id: shopId,
      supplier_id: supplierId,
      status: 'draft',
      ...overrides,
    })
    .returning(['id', 'po_number']);

  return row as { id: string; po_number: number };
}

describe('GH-1109 — purchase_orders.po_number migration and DB invariants', () => {
  it('backfills existing rows deterministically by shop, created_at, id and keeps numbering shop-scoped', async () => {
    const shopA = await createShop('po-number-backfill-a');
    const shopB = await createShop('po-number-backfill-b');
    const supplierA = await createSupplier(shopA);
    const supplierB = await createSupplier(shopB);

    const db = knexLib({
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

    try {
      await db.transaction(async (trx) => {
        await migration0179.down(trx);

        await trx.raw(`SELECT set_config('app.current_tenant', ?::text, true)`, [shopA]);
        const a2Id = '00000000-0000-4000-8000-000000000002';
        const a1Id = '00000000-0000-4000-8000-000000000001';
        await trx('purchase_orders').insert([
          {
            id: a2Id,
            shop_id: shopA,
            supplier_id: supplierA,
            status: 'draft',
            created_at: '2026-09-15T10:00:00.000Z',
          },
          {
            id: a1Id,
            shop_id: shopA,
            supplier_id: supplierA,
            status: 'draft',
            created_at: '2026-09-15T10:00:00.000Z',
          },
        ]);

        await trx.raw(`SELECT set_config('app.current_tenant', ?::text, true)`, [shopB]);
        const b1Id = '00000000-0000-4000-8000-000000000011';
        await trx('purchase_orders').insert({
          id: b1Id,
          shop_id: shopB,
          supplier_id: supplierB,
          status: 'draft',
          created_at: '2026-09-15T09:00:00.000Z',
        });

        await migration0179.up(trx);

        const rows = await trx('purchase_orders')
          .whereIn('id', [a1Id, a2Id, b1Id])
          .orderBy('shop_id', 'asc')
          .orderBy('po_number', 'asc')
          .select('id', 'shop_id', 'po_number');

        expect(rows).toEqual([
          { id: a1Id, shop_id: shopA, po_number: 1001 },
          { id: a2Id, shop_id: shopA, po_number: 1002 },
          { id: b1Id, shop_id: shopB, po_number: 1001 },
        ]);

        const { rows: columns } = await trx.raw(
          `SELECT is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'purchase_orders'
              AND column_name = 'po_number'`,
        );
        expect(columns[0].is_nullable).toBe('NO');

        const { rows: indexes } = await trx.raw(
          `SELECT indexdef
             FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'purchase_orders'
              AND indexdef ILIKE '%po_number%'`,
        );
        expect(indexes.some((row: { indexdef: string }) =>
          /UNIQUE INDEX .*shop_id.*po_number/i.test(row.indexdef)
        )).toBe(true);

        await trx.raw('SAVEPOINT duplicate_po_number');
        await expect(
          trx('purchase_orders').insert({
            id: '00000000-0000-4000-8000-000000000003',
            shop_id: shopA,
            supplier_id: supplierA,
            status: 'draft',
            po_number: 1001,
          })
        ).rejects.toThrow();
        await trx.raw('ROLLBACK TO SAVEPOINT duplicate_po_number');

        await expect(
          trx('purchase_orders')
            .where({ id: a1Id, shop_id: shopA })
            .update({ po_number: 2001 })
        ).rejects.toThrow(/immutable/i);

        throw new Error('__rollback__');
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== '__rollback__') throw error;
    } finally {
      await db.destroy();
    }
  });

  it('allocates distinct consecutive numbers for concurrent inserts in the same shop', async () => {
    const shopId = await createShop('po-number-concurrency');
    const supplierId = await createSupplier(shopId);

    const [first, second] = await Promise.all([
      withTenant(shopId, (trx) => insertPo(trx, shopId, supplierId)),
      withTenant(shopId, (trx) => insertPo(trx, shopId, supplierId)),
    ]);

    const numbers = [Number(first.po_number), Number(second.po_number)].sort((a, b) => a - b);
    expect(numbers).toEqual([1001, 1002]);
  });
});

describe('GH-1109 — PO number API projection', () => {
  it('manual PO creation returns and reads the DB-owned po_number', async () => {
    const shopId = await createShop('po-number-manual');
    const supplierId = await createSupplier(shopId);
    const userId = await createUser(shopId);
    await activateGrowthShop(shopId, userId);
    await installShopify(shopId);
    const variantId = await createVariant(shopId);
    await linkShopifyIdentity(shopId, variantId);
    const token = issueTestToken({ userId, shopId, tier: 'growth', roles: ['owner'] });

    const createResponse = await request(app)
      .post('/api/v1/suppliers/purchase-orders')
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': `po-number-${crypto.randomUUID()}` })
      .send({
        supplier_id: supplierId,
        line_items: [{ description: 'Manual PO line', quantity_ordered: 2, lasyncro_variant_id: variantId }],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.purchase_order.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(createResponse.body.purchase_order.po_number).toBe(1001);

    const listResponse = await request(app)
      .get('/api/v1/suppliers/purchase-orders')
      .set({ Authorization: `Bearer ${token}` });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.purchase_orders[0]).toMatchObject({
      id: createResponse.body.purchase_order.id,
      po_number: 1001,
    });
  });

  it('reorder-request conversion returns and reads the DB-owned po_number', async () => {
    const shopId = await createShop('po-number-reorder');
    const supplierId = await createSupplier(shopId, { moq: 1 });
    const variantId = await createVariant(shopId);
    const userId = await createUser(shopId);
    await activateGrowthShop(shopId, userId);
    const token = issueTestToken({ userId, shopId, tier: 'growth', roles: ['owner'] });

    const queueResponse = await request(app)
      .post('/api/v1/suppliers/reorder-requests')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        lasyncro_variant_id: variantId,
        supplier_id: supplierId,
        qty_requested: 3,
        source: 'manual',
      });

    expect(queueResponse.status).toBe(201);

    const convertResponse = await request(app)
      .post('/api/v1/suppliers/reorder-requests/convert')
      .set({ Authorization: `Bearer ${token}` })
      .send({ supplier_id: supplierId });

    expect(convertResponse.status).toBe(201);
    expect(convertResponse.body.po_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // E2 keeps its established { po_id } response; po_number is read from
    // the canonical PO list projection below.

    const listResponse = await request(app)
      .get('/api/v1/suppliers/purchase-orders')
      .set({ Authorization: `Bearer ${token}` });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.purchase_orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: convertResponse.body.po_id,
          po_number: 1001,
        }),
      ]),
    );
  });

  it('receive job list and detail include po_number while retaining UUID po_id', async () => {
    const shopId = await createShop('po-number-receive');
    const supplierId = await createSupplier(shopId);
    const userId = await createUser(shopId);
    await activateGrowthShop(shopId, userId);
    const token = issueTestToken({ userId, shopId, tier: 'growth', roles: ['owner'] });

    const po = await withTenant(shopId, async (trx) => {
      const row = await insertPo(trx, shopId, supplierId, { status: 'shipped' });
      await trx('purchase_order_line_items').insert({
        po_id: row.id,
        shop_id: shopId,
        description: 'Receive PO line',
        quantity_ordered: 4,
        quantity_received: 0,
      });
      return row;
    });

    const createJobResponse = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${po.id}/receive-jobs`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ assigned_operator_id: userId });

    expect(createJobResponse.status).toBe(201);

    const listResponse = await request(app)
      .get('/api/v1/suppliers/receive-jobs?status=pending')
      .set({ Authorization: `Bearer ${token}` });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.receive_jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receive_job_id: createJobResponse.body.receive_job_id,
          po_id: po.id,
          po_number: 1001,
        }),
      ]),
    );

    const detailResponse = await request(app)
      .get(`/api/v1/suppliers/receive-jobs/${createJobResponse.body.receive_job_id}`)
      .set({ Authorization: `Bearer ${token}` });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.job).toMatchObject({
      receive_job_id: createJobResponse.body.receive_job_id,
      po_id: po.id,
      po_number: 1001,
    });
  });
});
