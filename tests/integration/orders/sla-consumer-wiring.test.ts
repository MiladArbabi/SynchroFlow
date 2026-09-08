import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { getOrdersOperatorFacts } from 'api-src/services/orders-operator/OrdersOperatorFacts.service';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

async function createShop(): Promise<{ shopId: number; userId: number }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sla-consumer-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sla-consumer-${unique}@test.example`,
        password_hash: 'not-a-real-hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: row.id,
      role: 'owner',
    });

    await trx('shop_operational_settings')
      .insert({
        shop_id: shopId,
        fulfillment_sla_hours: 24,
      })
      .onConflict('shop_id')
      .merge({ fulfillment_sla_hours: 24 });

    return row.id as number;
  });

  return { shopId, userId };
}

async function seedOrder(input: {
  shopId: number;
  creationAgeHours: number;
  paidAgeHours: number;
  status?: 'pending' | 'fulfilled';
  constrained?: boolean;
  versions?: Array<{
    aggregateVersion: number;
    creationAgeHours: number;
    paidAgeHours: number;
  }>;
}): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();
  const orderCreatedAt = new Date(now.getTime() - input.creationAgeHours * 3600_000);
  const paidAt = new Date(now.getTime() - input.paidAgeHours * 3600_000);

  await withTenant(input.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: input.shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: orderCreatedAt,
      paid_at: paidAt,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: input.status ?? 'pending',
      fulfilled_at: input.status === 'fulfilled' ? now : null,
    });

    const versions =
      input.versions ??
      [{
        aggregateVersion: 1,
        creationAgeHours: input.creationAgeHours,
        paidAgeHours: input.paidAgeHours,
      }];

    await trx('order_age_snapshot').insert(
      versions.map((v) => ({
        lasyncro_order_id: orderId,
        aggregate_version: v.aggregateVersion,
        age_since_creation_seconds: v.creationAgeHours * 3600,
        age_since_paid_seconds: v.paidAgeHours * 3600,
        age_since_fulfillment_seconds: null,
        is_shipping_sla_breached: v.paidAgeHours >= 24,
        is_delivery_sla_breached: false,
        snapshot_generated_at: now,
      }))
    );

    if (input.constrained) {
      await trx('order_constraints').insert({
        constraint_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        target_id: null,
        constraint_type: 'customer',
        block_type: 'awaiting_customer_response',
        started_at: now,
        is_active: true,
        write_source: 'sla-sem-01-test',
      });
    }
  });

  return orderId;
}

describe('SLA-SEM-01 consumer wiring', () => {
  it('SLA-APPROACH-03/04/06 operator summary exposes only the canonical approaching population', async () => {
    const { shopId } = await createShop();

    const approachingId = await seedOrder({
      shopId,
      creationAgeHours: 21,
      paidAgeHours: 21,
    });

    await seedOrder({
      shopId,
      creationAgeHours: 40,
      paidAgeHours: 2,
    });

    await seedOrder({
      shopId,
      creationAgeHours: 21,
      paidAgeHours: 21,
      status: 'fulfilled',
    });

    await seedOrder({
      shopId,
      creationAgeHours: 30,
      paidAgeHours: 10,
      versions: [
        {
          aggregateVersion: 1,
          creationAgeHours: 30,
          paidAgeHours: 21,
        },
        {
          aggregateVersion: 2,
          creationAgeHours: 30,
          paidAgeHours: 10,
        },
      ],
    });

    const facts = await getOrdersOperatorFacts(shopId);

    expect(facts.imminentSlaBreachers).toHaveLength(1);
    expect(facts.imminentSlaBreachers[0]).toEqual(
      expect.objectContaining({
        lasyncro_order_id: approachingId,
        minutesUntilBreach: 180,
      })
    );
  });

  it('SLA-APPROACH-02/03 constrained-order API transports paid age and merchant SLA', async () => {
    const { shopId, userId } = await createShop();

    const orderId = await seedOrder({
      shopId,
      creationAgeHours: 40,
      paidAgeHours: 21,
      constrained: true,
    });

    const token = issueTestToken({ userId, shopId });

    const res = await request(app)
      .get('/api/v1/orders/constrained')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const row = res.body.data.find(
      (item: { order_id: string }) => item.order_id === orderId
    );

    expect(Number(row.age_since_creation_seconds)).toBeGreaterThanOrEqual(40 * 3600);
    expect(Number(row.age_since_creation_seconds)).toBeLessThan(40 * 3600 + 10);
    expect(Number(row.age_since_paid_seconds)).toBeGreaterThanOrEqual(21 * 3600);
    expect(Number(row.age_since_paid_seconds)).toBeLessThan(21 * 3600 + 10);
    expect(row).toEqual(
      expect.objectContaining({
        fulfillment_sla_hours: 24,
        is_shipping_sla_breached: false,
        sla_state: 'approaching',
      })
    );
  });
});
