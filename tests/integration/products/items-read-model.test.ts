// GH-1208: real Products router + restricted PostgreSQL, disposable harness only.
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import productsRouter from 'api-src/api/products/products.ft2.routes';
import { systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = express();
app.use(express.json());
app.use('/api/v1/modules/products', productsRouter);

let shopId: number;
let foreignShopId: number;
let token: string;
let foreignToken: string;
const productId = crypto.randomUUID();
const stockedId = crypto.randomUUID();
const absentId = crypto.randomUUID();
const zeroId = crypto.randomUUID();
const digitalId = crypto.randomUUID();
const foreignId = crypto.randomUUID();

async function tenant(label: string) {
  const id = await systemTransaction(trx => createTenantShop(trx, `items-1208-${label}-${crypto.randomUUID()}`));
  const userId = await withTenant(id, async trx => {
    const [user] = await trx('users').insert({ shop_id: id, email: `items-${crypto.randomUUID()}@test.example`, password_hash: 'synthetic', role: 'owner' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: id, user_id: user.id, role: 'owner' });
    return user.id;
  });
  return { shopId: id, token: issueTestToken({ shopId: id, userId, tier: 'starter' }) };
}

beforeAll(async () => {
  const own = await tenant('own');
  const other = await tenant('foreign');
  shopId = own.shopId; token = own.token;
  foreignShopId = other.shopId; foreignToken = other.token;
  await withTenant(shopId, async trx => {
    const digitalProduct = crypto.randomUUID();
    await trx('products').insert([
      { shop_id: shopId, lasyncro_product_id: productId, title: 'Physical items', product_type: 'physical' },
      { shop_id: shopId, lasyncro_product_id: digitalProduct, title: 'Digital item', product_type: 'digital' },
    ]);
    await trx('variants').insert([
      { shop_id: shopId, lasyncro_product_id: productId, lasyncro_variant_id: stockedId, title: 'Stocked', sku: 'ITEM-STOCKED', unit_cost: '12.50', barcode: 'external-1208', lasyncro_barcode: 'LSP-ABCDEFGH' },
      { shop_id: shopId, lasyncro_product_id: productId, lasyncro_variant_id: absentId, title: 'Absent truth', sku: 'ITEM-ABSENT', unit_cost: '5.00' },
      { shop_id: shopId, lasyncro_product_id: productId, lasyncro_variant_id: zeroId, title: 'Real zero', sku: 'ITEM-ZERO', unit_cost: '0.00' },
      { shop_id: shopId, lasyncro_product_id: digitalProduct, lasyncro_variant_id: digitalId, title: 'Nonphysical', sku: 'ITEM-DIGITAL', unit_cost: '2.00' },
    ]);
    // sellable_quantity is generated from available_quantity by migration 0144.
    await trx('inventory_truth').insert([
      { shop_id: shopId, lasyncro_variant_id: stockedId, location_code: 'A-01', on_hand_quantity: 8, available_quantity: 6, reserved_quantity: 2, last_evaluated_at: new Date() },
      { shop_id: shopId, lasyncro_variant_id: stockedId, location_code: 'A-04', on_hand_quantity: 5, available_quantity: 4, reserved_quantity: 1, last_evaluated_at: new Date() },
      { shop_id: shopId, lasyncro_variant_id: zeroId, location_code: 'A-01', on_hand_quantity: 0, available_quantity: 0, reserved_quantity: 0, last_evaluated_at: new Date() },
    ]);
  });
  await withTenant(foreignShopId, async trx => {
    const product = crypto.randomUUID();
    await trx('products').insert({ shop_id: foreignShopId, lasyncro_product_id: product, title: 'Foreign', product_type: 'physical' });
    await trx('variants').insert({ shop_id: foreignShopId, lasyncro_product_id: product, lasyncro_variant_id: foreignId, sku: 'ITEM-STOCKED', unit_cost: '8.00' });
  });
});

async function items(auth = token) {
  const res = await request(app).get('/api/v1/modules/products/items').set('Authorization', `Bearer ${auth}`);
  expect(res.status).toBe(200);
  return res.body.variants as Array<Record<string, any>>;
}

it('A: aggregates two locations into exactly one authoritative item row', async () => {
  const before = await withTenant(shopId, trx => trx('inventory_truth').where({ lasyncro_variant_id: stockedId }).select('location_code'));
  expect(before).toHaveLength(2);
  const matching = (await items()).filter(v => v.lasyncro_variant_id === stockedId);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toEqual(expect.objectContaining({ has_inventory_record: true, on_hand_quantity: 13, available_quantity: 10, reserved_quantity: 3, sellable_quantity: 10, barcode: 'external-1208', lasyncro_barcode: 'LSP-ABCDEFGH', scan_identity_issue: false }));
});

it('B: absent inventory is null, never ordinary zero', async () => {
  const before = await withTenant(shopId, trx => trx('inventory_truth').where({ lasyncro_variant_id: absentId }).select('location_code'));
  expect(before).toHaveLength(0);
  const matching = (await items()).filter(v => v.lasyncro_variant_id === absentId);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toEqual(expect.objectContaining({ has_inventory_record: false, on_hand_quantity: null, available_quantity: null, sellable_quantity: null, reserved_quantity: null, scan_identity_issue: true, unit_cost: 5, cost_state: 'present' }));
});

it('C: real zero inventory remains numeric zero', async () => {
  const matching = (await items()).filter(v => v.lasyncro_variant_id === zeroId);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toEqual(expect.objectContaining({ has_inventory_record: true, on_hand_quantity: 0, available_quantity: 0, reserved_quantity: 0, sellable_quantity: 0 }));
});

it('D: persisted zero cost is missing while positive cost is present', async () => {
  const persisted = await withTenant(shopId, trx => trx('variants').where({ lasyncro_variant_id: zeroId }).select('unit_cost'));
  expect(persisted).toHaveLength(1);
  expect(Number(persisted[0].unit_cost)).toBe(0);
  const rows = await items();
  expect(rows.find(v => v.lasyncro_variant_id === zeroId)).toEqual(expect.objectContaining({ unit_cost: 0, cost_state: 'missing' }));
  expect(rows.find(v => v.lasyncro_variant_id === stockedId)).toEqual(expect.objectContaining({ unit_cost: 12.5, cost_state: 'present' }));
});

it('E: tenant-isolated physical universe excludes foreign and nonphysical rows', async () => {
  const rows = await items();
  expect(rows.map(v => v.lasyncro_variant_id).sort()).toEqual([stockedId, absentId, zeroId].sort());
  expect(rows.every(v => v.product_type === 'physical')).toBe(true);
  const foreign = await items(foreignToken);
  expect(foreign.map(v => v.lasyncro_variant_id)).toEqual([foreignId]);
});
