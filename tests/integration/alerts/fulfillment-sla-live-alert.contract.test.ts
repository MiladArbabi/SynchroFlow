import crypto from 'crypto';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { aggregateAlertsForShop } from 'api-src/services/alerts/alerts.aggregator';

const mockEvaluateStockProtectionForShop = jest.fn();

jest.mock('api-src/services/inventory/stockProtectionMonitoring', () => ({
  evaluateStockProtectionForShop: (...args: unknown[]) =>
    mockEvaluateStockProtectionForShop(...args),
}));

async function createShop(slaHours = 24): Promise<number> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `sla-alert-${crypto.randomUUID().slice(0, 8)}`
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

async function seedBreachedOrderWithStaleSnapshot(
  shopId: number,
  totalPrice = '125.50'
): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: totalPrice,
      subtotal_price: totalPrice,
      total_tax: '0.00',
      order_created_at: new Date(now.getTime() - 26 * 60 * 60 * 1000),
      paid_at: new Date(now.getTime() - 25 * 60 * 60 * 1000),
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

    // Intentionally stale: persisted snapshot says only 1h old / not breached.
    await trx('order_age_snapshot').insert({
      lasyncro_order_id: orderId,
      aggregate_version: 1,
      age_since_creation_seconds: 2 * 60 * 60,
      age_since_paid_seconds: 60 * 60,
      age_since_fulfillment_seconds: null,
      is_shipping_sla_breached: false,
      is_delivery_sla_breached: false,
      snapshot_generated_at: now,
    });
  });

  return orderId;
}

async function readSlaAlert(shopId: number) {
  const row = await withTenant(shopId, (trx) =>
    trx('alerts')
      .where({
        shop_id: shopId,
        alert_key: `sla:shop-${shopId}:shipping_breach`,
      })
      .first(
        'alert_key',
        'source',
        'alert_type',
        'is_active',
        'revenue_impact',
        'resolved_at',
        'dismissed_at',
        'title',
        'message'
      )
  );

  return row
    ? {
        ...row,
        revenue_impact:
          row.revenue_impact == null
            ? null
            : Number(row.revenue_impact),
      }
    : row;
}

async function countSlaAlerts(shopId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('alerts')
      .where({
        shop_id: shopId,
        alert_key: `sla:shop-${shopId}:shipping_breach`,
      })
      .count<{ count: string }[]>('* as count')
      .first()
  );

  return Number(row?.count ?? 0);
}

describe('SLA-CANONICAL-01B live SLA alert consumer', () => {
  beforeEach(() => {
    mockEvaluateStockProtectionForShop.mockReset();
    mockEvaluateStockProtectionForShop.mockResolvedValue([]);
  });

  it('activates the SLA alert from live current truth even when snapshot truth is stale', async () => {
    const shopId = await createShop(24);

    await seedBreachedOrderWithStaleSnapshot(shopId, '125.50');

    await aggregateAlertsForShop(shopId);

    expect(await readSlaAlert(shopId)).toMatchObject({
      alert_key: `sla:shop-${shopId}:shipping_breach`,
      alert_type: 'sla_breach',
      is_active: true,
      revenue_impact: 125.5,
      resolved_at: null,
    });
  });

  it('keeps one alert row and preserves deactivate/reactivate lifecycle', async () => {
    const shopId = await createShop(24);
    const orderId = await seedBreachedOrderWithStaleSnapshot(
      shopId,
      '80.00'
    );

    await aggregateAlertsForShop(shopId);
    await aggregateAlertsForShop(shopId);

    expect(await countSlaAlerts(shopId)).toBe(1);

    expect(await readSlaAlert(shopId)).toMatchObject({
      is_active: true,
      revenue_impact: 80,
      resolved_at: null,
    });

    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await trx('order_fulfillment_status')
        .where({ lasyncro_order_id: orderId })
        .update({
          status: 'fulfilled',
          fulfilled_at: trx.fn.now(),
        });
    });

    await aggregateAlertsForShop(shopId);

    const resolved = await readSlaAlert(shopId);

    expect(resolved).toMatchObject({
      is_active: false,
    });
    expect(resolved.resolved_at).toBeTruthy();
    expect(await countSlaAlerts(shopId)).toBe(1);

    await withTenant(shopId, (trx) =>
      trx('alerts')
        .where({
          shop_id: shopId,
          alert_key: `sla:shop-${shopId}:shipping_breach`,
        })
        .update({
          dismissed_at: trx.fn.now(),
        })
    );

    // A new breached order re-fires the same shop-level SLA alert.
    // Fulfillment status itself is monotonic; fulfilled orders do not regress
    // to pending.
    await seedBreachedOrderWithStaleSnapshot(shopId, '80.00');

    await aggregateAlertsForShop(shopId);

    expect(await readSlaAlert(shopId)).toMatchObject({
      is_active: true,
      revenue_impact: 80,
      resolved_at: null,
      dismissed_at: null,
    });

    expect(await countSlaAlerts(shopId)).toBe(1);
  });
});
