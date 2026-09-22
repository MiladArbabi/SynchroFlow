import crypto from 'crypto';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { computeSlaMetrics } from 'api-src/workers/projections/metric-engine/sla.metrics';

async function createShop(slaHours = 24): Promise<number> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `sla-metric-live-${crypto.randomUUID().slice(0, 8)}`
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
  paidAgeHours: number;
  totalPrice: string;
  stalePaidAgeHours?: number;
}): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();

  const paidAt = new Date(
    now.getTime() - input.paidAgeHours * 60 * 60 * 1000
  );

  const createdAt = new Date(
    paidAt.getTime() - 60 * 60 * 1000
  );

  await withTenant(input.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: input.shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: input.totalPrice,
      subtotal_price: input.totalPrice,
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
      status: 'pending',
    });

    const stalePaidAgeHours = input.stalePaidAgeHours ?? 1;

    await trx('order_age_snapshot').insert({
      lasyncro_order_id: orderId,
      aggregate_version: 1,
      age_since_creation_seconds:
        (stalePaidAgeHours + 1) * 60 * 60,
      age_since_paid_seconds:
        stalePaidAgeHours * 60 * 60,
      age_since_fulfillment_seconds: null,
      is_shipping_sla_breached: false,
      is_delivery_sla_breached: false,
      snapshot_generated_at: now,
    });
  });

  return orderId;
}

async function metrics(shopId: number) {
  return withTenant(shopId, (trx) =>
    computeSlaMetrics(
      trx,
      String(shopId),
      new Date()
    )
  );
}

describe('SLA-CANONICAL-01D metric-engine live SLA truth', () => {
  it('uses live current truth for approaching count and breached revenue despite stale snapshots', async () => {
    const shopId = await createShop(24);

    // Live breached.
    await seedOrder({
      shopId,
      paidAgeHours: 25,
      totalPrice: '125.50',
    });

    // Live approaching: 24h SLA has a 4h warning lead.
    await seedOrder({
      shopId,
      paidAgeHours: 21,
      totalPrice: '50.00',
    });

    // Paid and unfulfilled, but neither approaching nor breached.
    // This must NOT contribute to breached revenue.
    await seedOrder({
      shopId,
      paidAgeHours: 2,
      totalPrice: '999.00',
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(1);

    expect((result as any).slaBreachedRevenue).toBe(125.5);

    // Internal metric naming must stop claiming a fixed 24h SLA.
    expect((result as any).slaBreach24hRevenue).toBeUndefined();
  });

  it('reclassifies an idle order immediately after the merchant SLA setting changes', async () => {
    const shopId = await createShop(24);

    await seedOrder({
      shopId,
      paidAgeHours: 13,
      totalPrice: '80.00',
    });

    const before = await metrics(shopId);

    expect(before.ordersAtSlaRisk).toBe(0);
    expect((before as any).slaBreachedRevenue).toBe(0);

    await withTenant(shopId, (trx) =>
      trx('shop_operational_settings')
        .where({ shop_id: shopId })
        .update({
          fulfillment_sla_hours: 12,
        })
    );

    const after = await metrics(shopId);

    expect(after.ordersAtSlaRisk).toBe(0);
    expect((after as any).slaBreachedRevenue).toBe(80);
  });
});
