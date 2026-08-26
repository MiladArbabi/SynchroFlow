// tests/integration/wms/shipped-order-commercial-enforcement.test.ts
//
// MON-ALLOW-04 — regression contract for shipped-order commercial
// enforcement at WMS pack-complete.
//
// Endpoint under test: POST /api/v1/wms/batch/:batchId/pack-complete
// (httpCompletePack, apps/backend/src/api/wms/wms.controller.ts). This is
// the ONLY place shipped-order allowance/cap/overage decisions are made —
// POST /batch/:batchId/ship (confirmShipment.service.ts) performs physical
// status transitions only and contains no commercial logic.
//
// Every assertion here traces to a specific source line proven during the
// read-only preflight for this slice:
//   - Tier for the cap decision is read live from shop_subscriptions.tier
//     inside the transaction, never the JWT (wms.controller.ts:1559-1568).
//   - TIER_CONFIG.shippedOrderCap: starter=50, core=500, growth=2500
//     (packages/backend-core/src/config/tiers.ts).
//   - Reaching the cap exactly is never billable: overageUnits is only
//     > 0 strictly beyond shippedOrderCap (wms.controller.ts:1622-1630).
//   - A rejection throws before any mutation in the same transaction
//     (pick_batches update, usage increment, domain_events insert, alert)
//     so the whole transaction rolls back (wms.controller.ts:1596-1787).
//   - domain_event_outbox gets exactly one row per domain_event via the
//     DB trigger (migration 0062), never written directly by the handler.
//   - The dispatcher worker (apps/backend/src/workers/domain-event-outbox
//     .dispatcher.ts) is what calls Stripe/Shopify — it is a separate
//     poll-loop process never started by createApp() or this test.
//
// Real Express app (createApp(), never server.ts/api-server) + real
// disposable PostgreSQL + issueTestToken for auth. No global/full_identity
// seed. No worker started. No Stripe/Shopify call anywhere in this file or
// the code path it exercises.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

type FixtureTier = 'starter' | 'core' | 'growth';

type FixtureInput = {
  tier: FixtureTier;
  usageBefore: number;
  allowOverage?: boolean;
  billingProvider?: 'stripe';
  stripeCustomerId?: string;
};

type Fixture = {
  shopId: number;
  userId: number;
  batchId: string;
  usagePeriodId: number;
};

/**
 * Minimum deterministic fixture graph proven required by httpCompletePack:
 * shop, owner user + membership, FT2 lifecycle snapshot, explicit
 * shop_subscriptions row, one compatible OPEN shop_usage_metrics period,
 * one order + non-cancelled order_fulfillment_status row, one pick_batches
 * row in 'packing' status owned by the fixture user, and the
 * pick_batch_orders link between them. No warehouse, location, inventory,
 * product, variant, order-line, pick-scan, shipment-tracking,
 * shop_role_permissions, or Shopify-installation row is read by this
 * handler — none are created here.
 */
async function createCommercialFixture(
  namePrefix: string,
  input: FixtureInput
): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${namePrefix}+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return row.id as number;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
    })
  );

  // requireFt2 defaults to FT_MINUS_ONE (403) absent a snapshot row.
  await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    })
  );

  // Explicit subscription row: the cap decision reads shop_subscriptions
  // live, defaulting to tier='starter' if absent — pinning it here makes
  // the tier under test unambiguous rather than relying on that default.
  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: input.tier,
      allow_overage: input.allowOverage ?? true,
      billing_provider: input.billingProvider ?? 'stripe',
      stripe_customer_id: input.stripeCustomerId ?? null,
    })
  );

  // getOrRotateOpenUsagePeriod only reuses an existing open Starter period
  // if period_starts_at falls within the current UTC calendar month;
  // Core/Growth periods are reused regardless of period_starts_at. Anchor
  // to the current UTC month start so Starter fixtures are never rotated
  // out from under the seeded usageBefore value.
  const now = new Date();
  const currentUtcMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const periodStartsAt = input.tier === 'starter' ? currentUtcMonthStart : now;

  const usagePeriodId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('shop_usage_metrics')
      .insert({
        shop_id: shopId,
        period_starts_at: periodStartsAt,
        period_ends_at: null,
        tier_at_period_start: input.tier,
        shipped_orders: input.usageBefore,
      })
      .returning('id');
    return row.id as number;
  });

  const lasyncroOrderId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: '0.00',
      subtotal_price: '0.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    })
  );

  // Default status is 'pending' — must participate in the handler's
  // billable-order JOIN and must not be 'cancelled'. order_fulfillment_status
  // is projection-single-writer guarded (migration 0076): direct writes
  // outside SET LOCAL synchroflow.projection = 'true' raise
  // PROJECTION_WRITE_VIOLATION.
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'pending',
    });
  });

  const batchId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('pick_batches').insert({
      pick_batch_id: batchId,
      shop_id: shopId,
      status: 'packing',
      release_trigger: 'manual',
      max_line_items: 10,
      total_line_items: 1,
      total_units: 1,
      packed_by: userId,
      released_at: now,
    })
  );

  await withTenant(shopId, (trx) =>
    trx('pick_batch_orders').insert({
      pick_batch_id: batchId,
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
    })
  );

  return { shopId, userId, batchId, usagePeriodId };
}

async function readShippedOrders(shopId: number, usagePeriodId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_usage_metrics')
      .where({ id: usagePeriodId, shop_id: shopId })
      .first('shipped_orders')
  );
  return Number(row?.shipped_orders);
}

async function readBatchState(
  shopId: number,
  batchId: string
): Promise<{ status: string; pack_completed_at: Date | null }> {
  const row = await withTenant(shopId, (trx) =>
    trx('pick_batches')
      .where({ pick_batch_id: batchId, shop_id: shopId })
      .first('status', 'pack_completed_at')
  );
  return row;
}

async function countBillingOverageEvents(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'billing/overage' })
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

/** domain_event_outbox has no shop_id column — scope through domain_events. */
async function countBillingOverageOutboxRows(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('domain_event_outbox as o')
      .join('domain_events as e', 'e.id', 'o.domain_event_id')
      .where({ 'e.shop_id': shopId, 'e.event_type': 'billing/overage' })
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

async function getBillingOverageEventPayload(shopId: number): Promise<Record<string, unknown>> {
  const row = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'billing/overage' })
      .first('event_payload')
  );
  return row.event_payload as Record<string, unknown>;
}

async function packComplete(shopId: number, userId: number, batchId: string) {
  const token = issueTestToken({ userId, shopId });
  return request(app)
    .post(`/api/v1/wms/batch/${batchId}/pack-complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

describe('Shipped-order commercial enforcement (MON-ALLOW-04)', () => {
  // ── COMMERCIAL-01 ──────────────────────────────────────────────────────
  // Starter, at the included allowance: succeeds, usage increments exactly
  // once, and reaching the boundary is not billable.
  describe('COMMERCIAL-01: Starter included allowance succeeds', () => {
    it('49 -> 50 succeeds with zero billing/outbox side effects', async () => {
      const { shopId, userId, batchId, usagePeriodId } = await createCommercialFixture(
        'com01',
        { tier: 'starter', usageBefore: 49 }
      );

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(50);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(0);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(0);
    });
  });

  // ── COMMERCIAL-02 + ATOMICITY-01 (Starter) ────────────────────────────
  // Starter hard cap rejects the next shipped order with zero persisted
  // shipping/billing side effects — the transaction that would have caused
  // them never commits.
  describe('COMMERCIAL-02: Starter hard cap rejects atomically', () => {
    it('at 50 rejects 403 SHIPPED_ORDER_CAP_REACHED, leaving all state unchanged', async () => {
      const { shopId, userId, batchId, usagePeriodId } = await createCommercialFixture(
        'com02',
        { tier: 'starter', usageBefore: 50 }
      );

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('SHIPPED_ORDER_CAP_REACHED');

      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(50);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('packing');
      expect(batch.pack_completed_at).toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(0);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(0);
    });
  });

  // ── COMMERCIAL-03 ──────────────────────────────────────────────────────
  // Core can consume its included allowance even when allow_overage=false:
  // the flag only governs execution BEYOND the allowance, not up to it.
  describe('COMMERCIAL-03: Core included allowance succeeds under allow_overage=false', () => {
    it('499 -> 500 succeeds with zero billing/outbox side effects', async () => {
      const { shopId, userId, batchId, usagePeriodId } = await createCommercialFixture(
        'com03',
        { tier: 'core', usageBefore: 499, allowOverage: false }
      );

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(500);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(0);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(0);
    });
  });

  // ── COMMERCIAL-04 + ATOMICITY-01 (Growth) ─────────────────────────────
  // Growth at allowance with allow_overage=false rejects atomically —
  // same zero-side-effect guarantee as the Starter hard cap.
  describe('COMMERCIAL-04: Growth at allowance rejects atomically when overage disabled', () => {
    it('at 2500 rejects 403 OVERAGE_DISABLED, leaving all state unchanged', async () => {
      const { shopId, userId, batchId, usagePeriodId } = await createCommercialFixture(
        'com04',
        { tier: 'growth', usageBefore: 2500, allowOverage: false }
      );

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('OVERAGE_DISABLED');

      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(2500);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('packing');
      expect(batch.pack_completed_at).toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(0);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(0);
    });
  });

  // ── COMMERCIAL-05 ──────────────────────────────────────────────────────
  // Growth at allowance with allow_overage=true succeeds and persists
  // exactly one billable overage intent + outbox row. No provider call is
  // made or expected here — delivery is a separate, unstarted worker.
  describe('COMMERCIAL-05: Growth overage succeeds and persists one billable intent', () => {
    it('2500 -> 2501 succeeds with exactly one billing/overage event and outbox row', async () => {
      const stripeCustomerId = 'cus_test_fixture_com05';
      const { shopId, userId, batchId, usagePeriodId } = await createCommercialFixture(
        'com05',
        {
          tier: 'growth',
          usageBefore: 2500,
          allowOverage: true,
          billingProvider: 'stripe',
          stripeCustomerId,
        }
      );

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(2501);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(1);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(1);

      // Only fields actually consumed by the delivery path
      // (apps/backend/src/workers/domain-event-outbox.dispatcher.ts
      // parseBillingPayload) are asserted here. tier, included_allowance,
      // current_before, projected_after, usage_period_id, and batch_id are
      // written into the payload but are not read by any current
      // downstream consumer — audited as incidental, not asserted.
      const payload = await getBillingOverageEventPayload(shopId);
      expect(payload.billing_provider).toBe('stripe');
      expect(payload.overage_units).toBe(1);
      expect(payload.stripe_customer_id).toBe(stripeCustomerId);
      expect(typeof payload.idempotency_key).toBe('string');
      expect((payload.idempotency_key as string).length).toBeGreaterThan(0);
    });
  });
});
