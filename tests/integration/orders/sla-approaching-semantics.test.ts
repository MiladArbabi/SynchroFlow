// tests/integration/orders/sla-approaching-semantics.test.ts
//
// SLA-SEM-01 — RED-first canonical approaching-Fulfillment-SLA contract.
//
// Uses the disposable backend-integration Postgres harness because the defect
// is fundamentally SQL/version/current-state semantics, not just arithmetic.

import crypto from 'crypto';

import { computeSlaMetrics } from 'api-src/workers/projections/metric-engine/sla.metrics';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';

type AgeVersion = {
  aggregateVersion: number;
  creationAgeSeconds: number;
  paidAgeSeconds: number | null;
  breached?: boolean;
};

async function createShop(slaHours: number): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sla-sem-01-${unique}`);
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

async function seedAgeOrder(input: {
  shopId: number;
  fulfillmentStatus?: 'pending' | 'partially_fulfilled' | 'fulfilled';
  versions: AgeVersion[];
}): Promise<string> {
  const {
    shopId,
    fulfillmentStatus = 'pending',
    versions,
  } = input;

  const orderId = crypto.randomUUID();
  const now = new Date();

  const currentVersion = versions[versions.length - 1];

  if (!currentVersion) {
    throw new Error('seedAgeOrder requires at least one age version');
  }

  const orderCreatedAt = new Date(
    now.getTime() - currentVersion.creationAgeSeconds * 1000
  );

  const paidAt =
    currentVersion.paidAgeSeconds == null
      ? null
      : new Date(
          now.getTime() - currentVersion.paidAgeSeconds * 1000
        );

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
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
      status: fulfillmentStatus,
      fulfilled_at: fulfillmentStatus === 'fulfilled' ? now : null,
    });

    await trx('order_age_snapshot').insert(
      versions.map((version) => ({
        lasyncro_order_id: orderId,
        aggregate_version: version.aggregateVersion,
        age_since_creation_seconds: version.creationAgeSeconds,
        age_since_paid_seconds: version.paidAgeSeconds,
        age_since_fulfillment_seconds: null,
        is_shipping_sla_breached: version.breached ?? false,
        is_delivery_sla_breached: false,
        snapshot_generated_at: now,
      }))
    );
  });

  return orderId;
}

async function metrics(shopId: number) {
  return withTenant(shopId, (trx) =>
    computeSlaMetrics(
      trx,
      String(shopId),
      new Date('2026-09-01T12:00:00.000Z')
    )
  );
}

describe('SLA-SEM-01 canonical approaching Fulfillment SLA', () => {
  it('SLA-APPROACH-02 does not treat creation-age-only Watch orders as SLA risk', async () => {
    const shopId = await createShop(24);

    await seedAgeOrder({
      shopId,
      versions: [{
        aggregateVersion: 1,
        creationAgeSeconds: 40 * 3600,
        paidAgeSeconds: 2 * 3600,
      }],
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(0);
  });

  it('SLA-APPROACH-03 counts a 24h-SLA order inside the final 4h window', async () => {
    const shopId = await createShop(24);

    await seedAgeOrder({
      shopId,
      versions: [{
        aggregateVersion: 1,
        creationAgeSeconds: 21 * 3600,
        paidAgeSeconds: 21 * 3600,
      }],
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(1);
  });

  it('SLA-APPROACH-03 scales short SLAs: 1h SLA warns inside final 15m', async () => {
    const shopId = await createShop(1);

    await seedAgeOrder({
      shopId,
      versions: [{
        aggregateVersion: 1,
        creationAgeSeconds: 46 * 60,
        paidAgeSeconds: 46 * 60,
      }],
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(1);
  });

  it('SLA-APPROACH-04 excludes fulfilled orders', async () => {
    const shopId = await createShop(24);

    await seedAgeOrder({
      shopId,
      fulfillmentStatus: 'fulfilled',
      versions: [{
        aggregateVersion: 1,
        creationAgeSeconds: 50 * 3600,
        paidAgeSeconds: 21 * 3600,
      }],
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(0);
  });

  it('SLA-APPROACH-05 excludes already-breached orders', async () => {
    const shopId = await createShop(24);

    await seedAgeOrder({
      shopId,
      versions: [{
        aggregateVersion: 1,
        creationAgeSeconds: 50 * 3600,
        paidAgeSeconds: 25 * 3600,
        breached: true,
      }],
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(0);
  });

  it('SLA-APPROACH-06/07 does not double-count one live order with multiple snapshots', async () => {
    const shopId = await createShop(24);

    await seedAgeOrder({
      shopId,
      versions: [
        {
          aggregateVersion: 1,
          creationAgeSeconds: 30 * 3600,
          paidAgeSeconds: 10 * 3600,
        },
        {
          aggregateVersion: 2,
          creationAgeSeconds: 30 * 3600,
          paidAgeSeconds: 21 * 3600,
        },
      ],
    });

    const result = await metrics(shopId);

    expect(result.ordersAtSlaRisk).toBe(1);
  });
});
