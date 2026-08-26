// tests/integration/billing/allow-overage-preference.test.ts
//
// MON-ALLOW-04 — regression contract for the allow_overage preference API.
//
// Protects behavior and persistence invariants (billing.controller.ts:
// getSubscription / updateOveragePreference), not incidental response
// wording. Every assertion here traces to a specific source line proven
// during the read-only preflight for this slice:
//   - PATCH /api/v1/billing/overage only ever writes shop_subscriptions
//     (allow_overage, updated_at) — no other table, no provider call.
//   - Tier authority is shop_subscriptions.tier, read fresh per request,
//     never the JWT.
//   - Missing-row defaults differ by endpoint: GET falls back to a
//     hardcoded { allow_overage: true } with no write; PATCH treats a
//     missing row as tier='starter' and returns 409 without ever reaching
//     the update statement.
//
// Real Express app (createApp(), never server.ts/api-server) + real
// disposable PostgreSQL + issueTestToken for auth. No global/full_identity
// seed. No Stripe/Shopify call anywhere in this file or the code path it
// exercises.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

type SubscriptionFixtureInput = {
  tier?: 'starter' | 'core' | 'growth' | 'scale';
  allowOverage?: boolean;
};

/**
 * Creates an isolated shop + owner user + owner membership, and (unless
 * `subscription` is omitted) a shop_subscriptions row.
 *
 * shops has forced RLS keyed on the row's own id, so a brand-new shop can't
 * satisfy that policy's WITH CHECK via a plain insert (the id isn't known
 * until after the row exists). create_tenant_shop() is the existing,
 * SECURITY DEFINER, sf_app-granted function real application code already
 * uses for exactly this bootstrap step (see
 * apps/backend/src/api/integrations/integration.controller.ts:797-798) —
 * reused here rather than duplicated.
 */
async function createFixtureShop(
  namePrefix: string,
  subscription?: SubscriptionFixtureInput | null
): Promise<{ shopId: number; userId: number }> {
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

  if (subscription !== null) {
    await withTenant(shopId, (trx) =>
      trx('shop_subscriptions').insert({
        shop_id: shopId,
        tier: subscription?.tier ?? 'starter',
        allow_overage: subscription?.allowOverage ?? true,
      })
    );
  }

  return { shopId, userId };
}

async function readAllowOverage(shopId: number): Promise<boolean | null> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').where({ shop_id: shopId }).first('allow_overage')
  );
  return row?.allow_overage ?? null;
}

async function countSubscriptionRows(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').where({ shop_id: shopId }).count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

async function countDomainEvents(shopId: number, eventType?: string): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) => {
    const qb = trx('domain_events').where({ shop_id: shopId });
    if (eventType) qb.andWhere({ event_type: eventType });
    return qb.count<{ count: string }[]>('* as count');
  });
  return Number(count);
}

/** domain_event_outbox has no shop_id column — scope through domain_events. */
async function countOutboxRowsForShop(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('domain_event_outbox as o')
      .join('domain_events as e', 'e.id', 'o.domain_event_id')
      .where('e.shop_id', shopId)
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

describe('Billing overage preference (MON-ALLOW-04)', () => {
  // ── OVERAGE-PREF-01 ────────────────────────────────────────────────────
  // Configurable tiers (Core, Growth) can persist an explicit true/false
  // overage preference.
  describe('OVERAGE-PREF-01: configurable tiers persist explicit preference', () => {
    it.each([
      ['core', true],
      ['core', false],
      ['growth', true],
      ['growth', false],
    ] as const)('tier=%s can persist allow_overage=%s', async (tier, targetValue) => {
      const { shopId, userId } = await createFixtureShop('pref01', {
        tier,
        allowOverage: !targetValue, // start opposite, so a real write is proven
      });
      const token = issueTestToken({ userId, shopId });

      const res = await request(app)
        .patch('/api/v1/billing/overage')
        .set('Authorization', `Bearer ${token}`)
        .send({ allow_overage: targetValue });

      expect(res.status).toBe(200);
      expect(res.body.allow_overage).toBe(targetValue);

      const persisted = await readAllowOverage(shopId);
      expect(persisted).toBe(targetValue);
    });
  });

  // ── OVERAGE-PREF-02 ────────────────────────────────────────────────────
  // Starter and Scale cannot configure overage; rejection must not mutate
  // the persisted value.
  describe('OVERAGE-PREF-02: non-configurable tiers reject mutation', () => {
    it.each(['starter', 'scale'] as const)(
      'tier=%s returns 409 and leaves persisted value unchanged',
      async (tier) => {
        const { shopId, userId } = await createFixtureShop('pref02', {
          tier,
          allowOverage: true,
        });
        const token = issueTestToken({ userId, shopId });

        const res = await request(app)
          .patch('/api/v1/billing/overage')
          .set('Authorization', `Bearer ${token}`)
          .send({ allow_overage: false }); // opposite of the starting value

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('OVERAGE_NOT_CONFIGURABLE');
        expect(res.body.tier).toBe(tier);

        const persisted = await readAllowOverage(shopId);
        expect(persisted).toBe(true); // unchanged
      }
    );
  });

  // ── OVERAGE-PREF-03 ────────────────────────────────────────────────────
  // Invalid non-boolean values must not mutate persistence, on a
  // configurable (Core) tier.
  describe('OVERAGE-PREF-03: invalid non-boolean values cannot mutate persistence', () => {
    it.each([
      ['string "true"', 'true'],
      ['number 1', 1],
      ['null', null],
    ] as const)('allow_overage=%s is rejected without persisting', async (_label, invalidValue) => {
      const { shopId, userId } = await createFixtureShop('pref03', {
        tier: 'core',
        allowOverage: true,
      });
      const token = issueTestToken({ userId, shopId });

      const res = await request(app)
        .patch('/api/v1/billing/overage')
        .set('Authorization', `Bearer ${token}`)
        .send({ allow_overage: invalidValue });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ALLOW_OVERAGE');

      const persisted = await readAllowOverage(shopId);
      expect(persisted).toBe(true); // unchanged
    });
  });

  // ── OVERAGE-PREF-04 ────────────────────────────────────────────────────
  // Missing shop_subscriptions row: GET resolves to the canonical default
  // and performs no implicit write.
  describe('OVERAGE-PREF-04: missing-row GET default is true and read-only', () => {
    it('returns allow_overage=true and creates no shop_subscriptions row', async () => {
      const { shopId, userId } = await createFixtureShop('pref04', null); // no subscription row
      const token = issueTestToken({ userId, shopId });

      const res = await request(app)
        .get('/api/v1/billing/subscription')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.allow_overage).toBe(true);

      const rowCount = await countSubscriptionRows(shopId);
      expect(rowCount).toBe(0);
    });
  });

  // ── OVERAGE-PREF-05 ────────────────────────────────────────────────────
  // Preference mutation is not itself billable usage: no domain event, no
  // outbox row, no usage-counter change, for a successful Core/Growth PATCH.
  describe('OVERAGE-PREF-05: preference mutation has no billing/usage side effects', () => {
    it('leaves domain events, outbox, and usage counters unchanged across a successful PATCH', async () => {
      const { shopId, userId } = await createFixtureShop('pref05', {
        tier: 'growth',
        allowOverage: false,
      });

      await withTenant(shopId, (trx) =>
        trx('shop_usage_metrics').insert({
          shop_id: shopId,
          period_starts_at: new Date(),
          period_ends_at: null,
          tier_at_period_start: 'growth',
          shipped_orders: 2500,
        })
      );

      const before = {
        domainEvents: await countDomainEvents(shopId),
        billingOverageEvents: await countDomainEvents(shopId, 'billing/overage'),
        outboxRows: await countOutboxRowsForShop(shopId),
        shippedOrders: (
          await withTenant(shopId, (trx) =>
            trx('shop_usage_metrics').where({ shop_id: shopId }).first('shipped_orders')
          )
        )?.shipped_orders,
      };
      expect(before.domainEvents).toBe(0);
      expect(before.billingOverageEvents).toBe(0);
      expect(before.outboxRows).toBe(0);
      expect(Number(before.shippedOrders)).toBe(2500);

      const token = issueTestToken({ userId, shopId });
      const res = await request(app)
        .patch('/api/v1/billing/overage')
        .set('Authorization', `Bearer ${token}`)
        .send({ allow_overage: true });

      expect(res.status).toBe(200);
      expect(res.body.allow_overage).toBe(true);

      const persisted = await readAllowOverage(shopId);
      expect(persisted).toBe(true);

      const after = {
        domainEvents: await countDomainEvents(shopId),
        billingOverageEvents: await countDomainEvents(shopId, 'billing/overage'),
        outboxRows: await countOutboxRowsForShop(shopId),
        shippedOrders: (
          await withTenant(shopId, (trx) =>
            trx('shop_usage_metrics').where({ shop_id: shopId }).first('shipped_orders')
          )
        )?.shipped_orders,
      };

      expect(after.domainEvents).toBe(before.domainEvents);
      expect(after.billingOverageEvents).toBe(0);
      expect(after.outboxRows).toBe(before.outboxRows);
      expect(Number(after.shippedOrders)).toBe(2500);
    });
  });
});
