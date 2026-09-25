// tests/integration/overview/operations-pulse-structured-truth.test.ts
//
// OV-V1-1B-A — RED CONTRACT: structured Operations Pulse truth on Overview's
// existing `pulse` read model (getOverviewPulse).
//
// Target future fields (legacy pulse fields may remain; not asserted away):
//
//   blockedOrderCount        ← latest orders_operational_control_snapshot.constrained_orders
//   blockedRevenue           ← same latest snapshot .blocked_revenue
//   inventoryWaitingCount    ← same latest snapshot .queue_awaiting_inventory
//                              (NOT constrained_orders, NOT their sum)
//   inventoryBlockedRevenue  ← same latest snapshot .revenue_blocked_inventory
//   pastSlaCount             ← readCurrentFulfillmentSlaSummary().breachedCount
//   pastSlaRevenue           ← readCurrentFulfillmentSlaSummary().breachedRevenue
//                              (NOT orders_at_sla_risk, NOT sla_breach_24h_revenue,
//                               NOT alert copy, NOT order_age_snapshot flags)
//
// Uses the canonical disposable synchroflow_test_* backend-integration
// harness with real Postgres, real RLS (createTenantShop + withTenant) and a
// real foreign tenant per case. Fixture helpers follow
// business-pulse-revenue-semantics.test.ts and
// fulfillment-sla-current-summary.test.ts. The SLA algorithm is NOT
// re-implemented here: past-SLA expectations are anchored to the canonical
// readCurrentFulfillmentSlaSummary on the same fixture.
//
// RED today: OverviewPulse exposes only revenueToday, revenueDeltaVsYesterday,
// atRiskRevenue, blockedRevenue and topBlockingType.

import crypto from 'crypto';

import { getOverviewPulse, type OverviewPulse } from 'api-src/services/overview-ft2/overviewPulse.resolver';
import { readCurrentFulfillmentSlaSummary } from 'api-src/services/orders/fulfillmentSla.service';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';

// Future contract — read loosely so the RED state is a runtime assertion
// failure on the missing fields, not a compile-time error.
type StructuredOperationsPulse = OverviewPulse & {
  blockedOrderCount?: number | null;
  inventoryWaitingCount?: number | null;
  inventoryBlockedRevenue?: number | null;
  pastSlaCount?: number | null;
  pastSlaRevenue?: number | null;
};

async function readPulse(shopId: number): Promise<StructuredOperationsPulse> {
  return (await getOverviewPulse(shopId)) as StructuredOperationsPulse;
}

const HOUR_MS = 60 * 60 * 1000;

async function createShop(slaHours = 24): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `ov-v1-1b-a-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_operational_settings')
      .insert({ shop_id: shopId, fulfillment_sla_hours: slaHours })
      .onConflict('shop_id')
      .merge({ fulfillment_sla_hours: slaHours })
  );

  return shopId;
}

// orders_operational_control_snapshot is append-only (0065) with PK
// (shop_id, snapshot_date) (0072). Only shop_id, snapshot_date and
// aggregate_version lack defaults (0060/0063); every other metric column is
// NOT NULL DEFAULT 0 / 'none', so omitted metrics are real zeros.
type SnapshotMetrics = {
  constrained_orders?: number;
  blocked_revenue?: string;
  queue_awaiting_inventory?: number;
  revenue_blocked_inventory?: string;
  orders_at_sla_risk?: number;
  sla_breach_24h_revenue?: string;
  at_risk_revenue?: string;
};

async function seedSnapshot(shopId: number, snapshotDate: Date, metrics: SnapshotMetrics): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('orders_operational_control_snapshot').insert({
      shop_id: shopId,
      snapshot_date: snapshotDate,
      aggregate_version: 1,
      ...metrics,
    })
  );
}

// Mirrors fulfillment-sla-current-summary.test.ts seedOrder: real order
// timestamps relative to NOW, fulfillment status via the projection guard.
async function seedOrder(input: {
  shopId: number;
  paidAgeMs: number;
  totalPrice: string;
  status?: 'pending' | 'partially_fulfilled' | 'fulfilled' | 'cancelled';
}): Promise<string> {
  const { shopId, paidAgeMs, totalPrice, status = 'pending' } = input;
  const orderId = crypto.randomUUID();
  const now = new Date();
  const paidAt = new Date(now.getTime() - paidAgeMs);
  const createdAt = new Date(paidAt.getTime() - HOUR_MS);

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
  });

  return orderId;
}

describe('OV-V1-1B-A — Overview pulse exposes structured Operations Pulse truth', () => {
  it('(1) exposes blocked and inventory-waiting values from the operational-control snapshot', async () => {
    const shopId = await createShop();
    const foreignShopId = await createShop();

    await seedSnapshot(shopId, new Date(Date.now() - HOUR_MS), {
      constrained_orders: 9,
      blocked_revenue: '1250.00',
      queue_awaiting_inventory: 2,
      revenue_blocked_inventory: '600.00',
    });
    // Foreign tenant, newer snapshot, hostile values — must never leak.
    await seedSnapshot(foreignShopId, new Date(), {
      constrained_orders: 55,
      blocked_revenue: '5555.00',
      queue_awaiting_inventory: 44,
      revenue_blocked_inventory: '4444.00',
    });

    const pulse = await readPulse(shopId);

    expect(pulse).toEqual(
      expect.objectContaining({
        blockedOrderCount: 9,
        blockedRevenue: 1250,
        inventoryWaitingCount: 2,
        inventoryBlockedRevenue: 600,
      })
    );
  });

  it('(2) inventoryWaitingCount is queue_awaiting_inventory — not constrained_orders, not their sum', async () => {
    const shopId = await createShop();

    await seedSnapshot(shopId, new Date(Date.now() - HOUR_MS), {
      constrained_orders: 9,
      queue_awaiting_inventory: 2,
    });

    const pulse = await readPulse(shopId);

    expect(pulse.inventoryWaitingCount).toBe(2);
    expect(pulse.inventoryWaitingCount).not.toBe(9);
    expect(pulse.inventoryWaitingCount).not.toBe(11);
    // Blocked orders stay the broader constrained count.
    expect(pulse.blockedOrderCount).toBe(9);
  });

  it('(3) the latest snapshot wins consistently for all four snapshot-derived fields', async () => {
    const shopId = await createShop();

    // Newer row inserted FIRST so selection cannot be insertion order.
    await seedSnapshot(shopId, new Date(Date.now() - HOUR_MS), {
      constrained_orders: 9,
      blocked_revenue: '1250.00',
      queue_awaiting_inventory: 2,
      revenue_blocked_inventory: '600.00',
    });
    await seedSnapshot(shopId, new Date(Date.now() - 48 * HOUR_MS), {
      constrained_orders: 40,
      blocked_revenue: '7777.00',
      queue_awaiting_inventory: 13,
      revenue_blocked_inventory: '3333.00',
    });

    const pulse = await readPulse(shopId);

    expect({
      blockedOrderCount: pulse.blockedOrderCount,
      blockedRevenue: pulse.blockedRevenue,
      inventoryWaitingCount: pulse.inventoryWaitingCount,
      inventoryBlockedRevenue: pulse.inventoryBlockedRevenue,
    }).toEqual({
      blockedOrderCount: 9,
      blockedRevenue: 1250,
      inventoryWaitingCount: 2,
      inventoryBlockedRevenue: 600,
    });
  });

  it('(4) past-SLA uses CURRENT canonical fulfillment-SLA truth, not hostile snapshot SLA metrics', async () => {
    const shopId = await createShop(24);
    const foreignShopId = await createShop(24);

    // 24h SLA. Breached-now: 30h ($125.50) and 26h ($74.50) pending.
    // Not breached: 2h pending ($999.00); 40h fulfilled ($500.00); 40h cancelled ($300.00).
    await seedOrder({ shopId, paidAgeMs: 30 * HOUR_MS, totalPrice: '125.50' });
    await seedOrder({ shopId, paidAgeMs: 26 * HOUR_MS, totalPrice: '74.50' });
    await seedOrder({ shopId, paidAgeMs: 2 * HOUR_MS, totalPrice: '999.00' });
    await seedOrder({ shopId, paidAgeMs: 40 * HOUR_MS, totalPrice: '500.00', status: 'fulfilled' });
    await seedOrder({ shopId, paidAgeMs: 40 * HOUR_MS, totalPrice: '300.00', status: 'cancelled' });
    // Foreign tenant breached order — must never leak.
    await seedOrder({ shopId: foreignShopId, paidAgeMs: 30 * HOUR_MS, totalPrice: '888.00' });

    // Hostile historical/projected SLA metrics on the latest snapshot.
    await seedSnapshot(shopId, new Date(Date.now() - HOUR_MS), {
      orders_at_sla_risk: 999,
      sla_breach_24h_revenue: '99999.00',
    });

    // Fixture sanity via the canonical service itself (no second SLA
    // calculation in this test).
    const canonical = await readCurrentFulfillmentSlaSummary(shopId);
    expect(canonical).toEqual(
      expect.objectContaining({ fulfillmentSlaHours: 24, breachedCount: 2, breachedRevenue: 200 })
    );

    const pulse = await readPulse(shopId);

    expect({ pastSlaCount: pulse.pastSlaCount, pastSlaRevenue: pulse.pastSlaRevenue }).toEqual({
      pastSlaCount: canonical.breachedCount,
      pastSlaRevenue: canonical.breachedRevenue,
    });
    expect(pulse.pastSlaCount).not.toBe(999);
    expect(pulse.pastSlaRevenue).not.toBe(99999);
  });

  it('(5) empty state: counts resolve to 0, snapshot money keeps missing-snapshot null, live past-SLA revenue is 0', async () => {
    // Chosen contract:
    //   - counts (blockedOrderCount, inventoryWaitingCount, pastSlaCount) → 0
    //   - snapshot-derived money (blockedRevenue, inventoryBlockedRevenue) →
    //     null, matching existing OverviewPulse missing-snapshot semantics
    //     (blockedRevenue / atRiskRevenue are already null without a snapshot)
    //   - pastSlaRevenue → 0: it is live canonical truth, always computable,
    //     and readCurrentFulfillmentSlaSummary returns 0 when nothing breaches.
    const shopId = await createShop(24);
    await seedOrder({ shopId, paidAgeMs: 2 * HOUR_MS, totalPrice: '45.00' });

    const pulse = await readPulse(shopId);

    expect({
      blockedOrderCount: pulse.blockedOrderCount,
      inventoryWaitingCount: pulse.inventoryWaitingCount,
      pastSlaCount: pulse.pastSlaCount,
      blockedRevenue: pulse.blockedRevenue,
      inventoryBlockedRevenue: pulse.inventoryBlockedRevenue,
      pastSlaRevenue: pulse.pastSlaRevenue,
    }).toEqual({
      blockedOrderCount: 0,
      inventoryWaitingCount: 0,
      pastSlaCount: 0,
      blockedRevenue: null,
      inventoryBlockedRevenue: null,
      pastSlaRevenue: 0,
    });
  });
});
