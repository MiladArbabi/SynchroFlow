// tests/integration/overview/business-pulse-revenue-semantics.test.ts
//
// OV-DATA-03 — RED-first financial semantics for Overview Business Pulse.
//
// Uses the canonical disposable synchroflow_test_* backend-integration harness.
// These assertions exercise real Postgres date/RLS/view/upsert behavior rather
// than mocking SQL semantics in JS.

import crypto from 'crypto';

import { getOverviewPulse } from 'api-src/services/overview-ft2/overviewPulse.resolver';
import { projectRevenueDaily } from 'api-src/projections/orderRevenueDailyProjection';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';

type SeedRevenueOrderInput = {
  shopId: number;
  orderCreatedAt: Date;
  revenueUnitCreatedAt?: Date;
  paymentState?: 'paid' | 'unpaid';
  quantity?: number;
  unitPrice?: string;
  isAtRisk?: boolean;
};

async function createShop(timezone = 'UTC'): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `ov-data-03-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shops')
      .where({ id: shopId })
      .update({ timezone })
  );

  return shopId;
}

async function seedRevenueOrder({
  shopId,
  orderCreatedAt,
  revenueUnitCreatedAt = orderCreatedAt,
  paymentState = 'paid',
  quantity = 1,
  unitPrice = '100.00',
  isAtRisk = false,
}: SeedRevenueOrderInput): Promise<{ orderId: string; revenueUnitId: string }> {
  const orderId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const revenueUnitId = crypto.randomUUID();
  const unique = crypto.randomBytes(6).toString('hex');
  const lineTotal = (quantity * Number(unitPrice)).toFixed(2);

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `ov-data-03-product-${unique}`,
      title: `OV-DATA-03 product ${unique}`,
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `ov-data-03-variant-${unique}`,
      title: `OV-DATA-03 variant ${unique}`,
      unit_cost: '10.00',
      status: 'active',
    });

    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: paymentState,
      currency: 'USD',
      total_price: lineTotal,
      subtotal_price: lineTotal,
      total_tax: '0.00',
      order_created_at: orderCreatedAt,
      order_updated_at: orderCreatedAt,
      created_at: orderCreatedAt,
      updated_at: orderCreatedAt,
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: `ov-data-03-variant-${unique}`,
      title: `OV-DATA-03 revenue unit ${unique}`,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      estimated_unit_cost: '10.00',
      created_at: revenueUnitCreatedAt,
      updated_at: revenueUnitCreatedAt,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_risk_snapshot').insert({
      lasyncro_order_id: orderId,
      aggregate_version: 1,
      shop_id: shopId,
      is_inventory_blocked: false,
      is_customer_blocked: false,
      is_operational_blocked: false,
      is_at_risk: isAtRisk,
      inventory_blocked_revenue: '0.00',
      order_health_score: 0,
      aging_risk_component: 0,
      sla_risk_component: 0,
      inventory_risk_component: 0,
      customer_risk_component: 0,
      operational_risk_component: 0,
      evaluated_at: revenueUnitCreatedAt,
    });
  });

  return { orderId, revenueUnitId };
}

async function refundRevenueUnit(shopId: number, revenueUnitId: string, quantity: number): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('refund_execution_line_items').insert({
      lasyncro_refund_line_item_id: crypto.randomUUID(),
      lasyncro_revenue_unit_id: revenueUnitId,
      refunded_quantity: quantity,
      refunded_amount: null,
      source: 'refund_webhook',
    })
  );
}

async function runProjection(shopId: number, eventAnchor = new Date('2026-09-01T12:00:00.000Z')): Promise<void> {
  await withTenant(shopId, (trx) =>
    projectRevenueDaily(trx, String(shopId), 1, eventAnchor)
  );
}

async function revenueRows(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('revenue_projection_daily')
      .where({ shop_id: shopId })
      .orderBy('revenue_date', 'asc')
      .select('revenue_date', 'gross_revenue', 'order_count', 'at_risk_revenue')
  );
}

async function seedRevenueProjectionRows(
  shopId: number,
  rows: { revenueDate: string; grossRevenue: string }[]
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('revenue_projection_daily').insert(
      rows.map((row) => ({
        shop_id: shopId,
        revenue_date: row.revenueDate,
        gross_revenue: row.grossRevenue,
        order_count: '1',
        at_risk_revenue: '0.00',
        evaluated_at: new Date('2026-03-10T12:00:00.000Z'),
      }))
    )
  );
}

describe('OV-DATA-03 revenue_projection_daily semantics', () => {
  it('OV-REV-01 counts only paid orders', async () => {
    const shopId = await createShop('UTC');
    const day = new Date('2026-09-01T10:00:00.000Z');

    await seedRevenueOrder({ shopId, orderCreatedAt: day, paymentState: 'paid', unitPrice: '100.00' });
    await seedRevenueOrder({ shopId, orderCreatedAt: day, paymentState: 'unpaid', unitPrice: '70.00' });

    await runProjection(shopId);

    const rows = await revenueRows(shopId);
    expect(rows).toEqual([
      expect.objectContaining({
        revenue_date: '2026-09-01',
        gross_revenue: '100.00',
        order_count: '1',
      }),
    ]);
  });

  it('OV-REV-02/03 buckets by merchant-local orders.order_created_at, not revenue-unit created_at', async () => {
    const shopId = await createShop('America/New_York');

    await seedRevenueOrder({
      shopId,
      orderCreatedAt: new Date('2026-03-10T03:30:00.000Z'),
      revenueUnitCreatedAt: new Date('2026-03-10T12:00:00.000Z'),
      paymentState: 'paid',
      unitPrice: '120.00',
    });

    await runProjection(shopId);

    const rows = await revenueRows(shopId);
    expect(rows).toEqual([
      expect.objectContaining({
        revenue_date: '2026-03-09',
        gross_revenue: '120.00',
        order_count: '1',
      }),
    ]);
  });

  it('OV-REV-04 uses order_revenue_units_net.net_revenue, net of recorded refunds', async () => {
    const shopId = await createShop('UTC');
    const { revenueUnitId } = await seedRevenueOrder({
      shopId,
      orderCreatedAt: new Date('2026-09-01T10:00:00.000Z'),
      paymentState: 'paid',
      quantity: 2,
      unitPrice: '50.00',
    });
    await refundRevenueUnit(shopId, revenueUnitId, 1);

    await runProjection(shopId);

    const rows = await revenueRows(shopId);
    expect(rows).toEqual([
      expect.objectContaining({
        revenue_date: '2026-09-01',
        gross_revenue: '50.00',
        order_count: '1',
      }),
    ]);
  });

  it('OV-REV-05 recomputation refreshes existing aggregate values on conflict', async () => {
    const shopId = await createShop('UTC');
    const day = new Date('2026-09-01T10:00:00.000Z');

    await seedRevenueOrder({
      shopId,
      orderCreatedAt: day,
      paymentState: 'paid',
      unitPrice: '100.00',
      isAtRisk: true,
    });
    await runProjection(shopId, new Date('2026-09-01T12:00:00.000Z'));

    await seedRevenueOrder({
      shopId,
      orderCreatedAt: day,
      paymentState: 'paid',
      unitPrice: '75.00',
      isAtRisk: true,
    });
    await runProjection(shopId, new Date('2026-09-01T13:00:00.000Z'));

    const rows = await revenueRows(shopId);
    expect(rows).toEqual([
      expect.objectContaining({
        revenue_date: '2026-09-01',
        gross_revenue: '175.00',
        order_count: '2',
        at_risk_revenue: '175.00',
      }),
    ]);
  });

  it('OV-REV-06 selects today/yesterday from the merchant-local calendar date', async () => {
    const shopId = await createShop('America/New_York');

    await seedRevenueProjectionRows(shopId, [
      { revenueDate: '2026-03-08', grossRevenue: '90.00' },
      { revenueDate: '2026-03-09', grossRevenue: '250.00' },
      { revenueDate: '2026-03-10', grossRevenue: '999.00' },
    ]);

    const pulse = await getOverviewPulse(shopId, new Date('2026-03-10T03:30:00.000Z'));

    expect(pulse.revenueToday).toBe(250);
    expect(pulse.revenueDeltaVsYesterday).toBe(160);
  });
});
