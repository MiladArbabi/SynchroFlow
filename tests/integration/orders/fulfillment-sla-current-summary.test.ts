import crypto from 'crypto';

import {
  readCurrentFulfillmentSlaSummary,
} from 'api-src/services/orders/fulfillmentSla.service';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

type FulfillmentStatus =
  | 'pending'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'cancelled';

async function createShop(slaHours: number): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `sla-canonical-01a-${unique}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_operational_settings')
      .insert({
        shop_id: shopId,
        fulfillment_sla_hours: slaHours,
      })
      .onConflict('shop_id')
      .merge({
        fulfillment_sla_hours: slaHours,
      })
  );

  return shopId;
}

async function seedOrder(input: {
  shopId: number;
  paidAgeMs: number;
  totalPrice: string;
  status?: FulfillmentStatus;
  staleSnapshot?: {
    paidAgeSeconds: number;
    breached: boolean;
  };
}): Promise<string> {
  const {
    shopId,
    paidAgeMs,
    totalPrice,
    status = 'pending',
    staleSnapshot,
  } = input;

  const orderId = crypto.randomUUID();
  const now = new Date();
  const paidAt = new Date(now.getTime() - paidAgeMs);
  const createdAt = new Date(paidAt.getTime() - 60 * 60 * 1000);

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: totalPrice,
      subtotal_price: totalPrice,
      total_tax: '0.00',
      order_created_at: createdAt,
      paid_at: paidAt,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status,
      fulfilled_at: status === 'fulfilled' ? now : null,
    });

    if (staleSnapshot) {
      await trx('order_age_snapshot').insert({
        lasyncro_order_id: orderId,
        aggregate_version: 1,
        age_since_creation_seconds:
          staleSnapshot.paidAgeSeconds + 3600,
        age_since_paid_seconds: staleSnapshot.paidAgeSeconds,
        age_since_fulfillment_seconds: null,
        is_shipping_sla_breached: staleSnapshot.breached,
        is_delivery_sla_breached: false,
        snapshot_generated_at: now,
      });
    }
  });

  return orderId;
}

describe('SLA-CANONICAL-01A current Fulfillment SLA summary', () => {
  it('uses live time instead of stale order_age_snapshot breach truth', async () => {
    const shopId = await createShop(24);

    await seedOrder({
      shopId,
      paidAgeMs: 25 * 60 * 60 * 1000,
      totalPrice: '125.50',
      staleSnapshot: {
        paidAgeSeconds: 60 * 60,
        breached: false,
      },
    });

    const summary = await readCurrentFulfillmentSlaSummary(shopId);

    expect(summary).toEqual({
      fulfillmentSlaHours: 24,
      breachedCount: 1,
      breachedRevenue: 125.5,
      approachingCount: 0,
    });
  });

  it('reclassifies idle orders immediately when merchant SLA changes', async () => {
    const shopId = await createShop(24);

    await seedOrder({
      shopId,
      paidAgeMs: 13 * 60 * 60 * 1000,
      totalPrice: '80.00',
      staleSnapshot: {
        paidAgeSeconds: 13 * 60 * 60,
        breached: false,
      },
    });

    const before = await readCurrentFulfillmentSlaSummary(shopId);

    expect(before).toEqual({
      fulfillmentSlaHours: 24,
      breachedCount: 0,
      breachedRevenue: 0,
      approachingCount: 0,
    });

    await withTenant(shopId, (trx) =>
      trx('shop_operational_settings')
        .where({ shop_id: shopId })
        .update({ fulfillment_sla_hours: 12 })
    );

    const after = await readCurrentFulfillmentSlaSummary(shopId);

    expect(after).toEqual({
      fulfillmentSlaHours: 12,
      breachedCount: 1,
      breachedRevenue: 80,
      approachingCount: 0,
    });
  });

  it('uses the canonical approaching window for short SLAs', async () => {
    const shopId = await createShop(1);

    await seedOrder({
      shopId,
      paidAgeMs: 47 * 60 * 1000,
      totalPrice: '40.00',
    });

    await seedOrder({
      shopId,
      paidAgeMs: 70 * 60 * 1000,
      totalPrice: '50.00',
    });

    const summary = await readCurrentFulfillmentSlaSummary(shopId);

    expect(summary).toEqual({
      fulfillmentSlaHours: 1,
      breachedCount: 1,
      breachedRevenue: 50,
      approachingCount: 1,
    });
  });

  it('counts only current unfulfilled non-cancelled orders for the shop', async () => {
    const shopId = await createShop(24);
    const foreignShopId = await createShop(24);

    await seedOrder({
      shopId,
      paidAgeMs: 30 * 60 * 60 * 1000,
      totalPrice: '40.00',
      status: 'pending',
    });

    await seedOrder({
      shopId,
      paidAgeMs: 30 * 60 * 60 * 1000,
      totalPrice: '60.00',
      status: 'fulfilled',
    });

    await seedOrder({
      shopId,
      paidAgeMs: 30 * 60 * 60 * 1000,
      totalPrice: '70.00',
      status: 'cancelled',
    });

    await seedOrder({
      shopId: foreignShopId,
      paidAgeMs: 30 * 60 * 60 * 1000,
      totalPrice: '999.00',
      status: 'pending',
    });

    const summary = await readCurrentFulfillmentSlaSummary(shopId);

    expect(summary).toEqual({
      fulfillmentSlaHours: 24,
      breachedCount: 1,
      breachedRevenue: 40,
      approachingCount: 0,
    });
  });
});
