// RECOUNT-CTA-33b
//
// CONTRACT-RECOUNT-LOCATIONS-01
// One explicit multi-location request creates one blind recount task containing
// only lines belonging to the selected locations.
//
// CONTRACT-RECOUNT-LOCATIONS-02
// Empty, malformed, or duplicate location_codes are rejected before mutation.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

type Fixture = {
  shopId: number;
  userId: number;
  warehouseId: string;
  token: string;
};

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `recount-locations-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `recount-locations+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    return row.id as number;
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
    });
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Main warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
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
        location_code: 'A-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'A-2',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'A-3',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);
  });

  const productId = crypto.randomUUID();
  const variants = [
    { id: crypto.randomUUID(), code: 'A-1', qty: 5 },
    { id: crypto.randomUUID(), code: 'A-2', qty: 7 },
    { id: crypto.randomUUID(), code: 'A-3', qty: 11 },
  ];

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Recount fixture product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert(
      variants.map((variant, index) => ({
        lasyncro_variant_id: variant.id,
        lasyncro_product_id: productId,
        shop_id: shopId,
        sku: `RECOUNT-${unique}-${index + 1}`,
        title: `Variant ${index + 1}`,
        unit_cost: '1.00',
        status: 'active',
      }))
    );

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('inventory_truth').insert(
      variants.map((variant) => ({
        shop_id: shopId,
        lasyncro_variant_id: variant.id,
        location_code: variant.code,
        on_hand_quantity: variant.qty,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: variant.qty,
        last_evaluated_at: new Date(),
      }))
    );
  });

  return {
    shopId,
    userId,
    warehouseId,
    token: issueTestToken({ userId, shopId, tier: 'core' }),
  };
}

describe('RECOUNT-CTA-33b multi-location recount creation', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  });

  it('CONTRACT-RECOUNT-LOCATIONS-01: creates one task containing only selected bins', async () => {
    const response = await request(app)
      .post('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${fixture.token}`)
      .send({
        scope: 'locations',
        location_codes: ['A-1', 'A-2'],
      });

    expect(response.status).toBe(201);
    expect(response.body?.task?.recount_task_id).toEqual(expect.any(String));
    expect(response.body?.task?.line_count).toBe(2);

    const taskId = response.body.task.recount_task_id as string;

    const task = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_recount_tasks')
        .where({
          shop_id: fixture.shopId,
          recount_task_id: taskId,
        })
        .first('scope', 'warehouse_id', 'blind')
    );

    expect(task.scope).toBe('locations');
    expect(task.warehouse_id).toBe(fixture.warehouseId);
    expect(task.blind).toBe(true);

    const lines = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_recount_lines')
        .where({
          shop_id: fixture.shopId,
          recount_task_id: taskId,
        })
        .orderBy('location_code', 'asc')
        .select('location_code')
    );

    expect(lines.map((line) => line.location_code)).toEqual(['A-1', 'A-2']);
    expect(lines.some((line) => line.location_code === 'A-3')).toBe(false);
  });

  it.each([
    ['empty', []],
    ['duplicate', ['A-1', 'A-1']],
    ['blank', ['A-1', '   ']],
  ])(
    'CONTRACT-RECOUNT-LOCATIONS-02: rejects %s location_codes before mutation',
    async (_caseName, locationCodes) => {
      const before = await withTenant(fixture.shopId, async (trx) => {
        const [{ count }] = await trx('inventory_recount_tasks')
          .where({ shop_id: fixture.shopId })
          .count<{ count: string }[]>('* as count');
        return Number(count);
      });

      const response = await request(app)
        .post('/api/v1/wms/recount-tasks')
        .set('Authorization', `Bearer ${fixture.token}`)
        .send({
          scope: 'locations',
          location_codes: locationCodes,
        });

      expect(response.status).toBe(400);

      const after = await withTenant(fixture.shopId, async (trx) => {
        const [{ count }] = await trx('inventory_recount_tasks')
          .where({ shop_id: fixture.shopId })
          .count<{ count: string }[]>('* as count');
        return Number(count);
      });

      expect(after).toBe(before);
    }
  );
});
