import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemTransaction,
  setTenantContext,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';
import {
  billingUsageAlertKey,
  persistBillingUsageThresholdAlert,
} from '../../../apps/backend/src/services/billing/billingUsageThreshold.service';

const app = createApp();

async function fixture() {
  const suffix = crypto.randomBytes(5).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `surface-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `owner-${suffix}@test.example`,
        password_hash: 'test',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: owner.id,
      role: 'owner',
    });

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      status: 'active',
      billing_interval: 'monthly',
      billing_currency: 'USD',
      billing_provider: 'stripe',
      allow_overage: true,
      extra_seats: 0,
      current_period_start: new Date('2026-09-01T00:00:00Z'),
      current_period_end: new Date('2026-10-01T00:00:00Z'),
    });

    await trx('shop_usage_metrics').insert({
      shop_id: shopId,
      period_starts_at: new Date('2026-09-01T00:00:00Z'),
      period_ends_at: null,
      tier_at_period_start: 'core',
      shipped_orders: 1500,
      ingested_orders: 1600,
    });

    for (const action of ['billing:read', 'billing:write']) {
      await trx('shop_role_permissions')
        .insert({
          shop_id: shopId,
          action,
          role: 'owner',
          granted: true,
        })
        .onConflict(['shop_id', 'action', 'role'])
        .merge({ granted: true });
    }

    return Number(owner.id);
  });

  return {
    shopId,
    token: issueTestToken({
      userId: ownerId,
      shopId,
      tier: 'core',
      roles: ['owner'],
    }),
  };
}

afterAll(async () => {
  await db.destroy();
});

describe('MON-REM-01B-4 — merchant billing API surface', () => {
  it('subscription response does not expose allow_overage', async () => {
    const f = await fixture();

    const res = await request(app)
      .get('/api/v1/billing/subscription')
      .set('Authorization', `Bearer ${f.token}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('allow_overage');
  });

  it('obsolete overage preference mutation is not routable', async () => {
    const f = await fixture();

    const res = await request(app)
      .patch('/api/v1/billing/overage')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ allow_overage: false });

    expect(res.status).toBe(404);
  });

  it('usage response exposes canonical processed-order billing read model', async () => {
    const f = await fixture();

    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('Authorization', `Bearer ${f.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tier: 'core',
      processed_orders: 1500,
      shipped_orders: 1500,
      included_allowance: 2000,
      remaining_included: 500,
      usage_percent: 75,
      overage_units: 0,
      overage_rate_cents: 8,
      estimated_overage_cents: 0,
    });
    expect(res.body.period_ends_at).toBeTruthy();
  });

  it('billing usage threshold alerts are period scoped, owner-audience, highest-only, and idempotent', async () => {
    const f = await fixture();
    const usagePeriod = await withTenant(f.shopId, (trx) =>
      trx('shop_usage_metrics').where({ shop_id: f.shopId }).first('id')
    );

    await withTenant(f.shopId, async (trx) => {
      const intent = await persistBillingUsageThresholdAlert(trx, {
        shopId: f.shopId,
        tier: 'core',
        usagePeriodId: usagePeriod.id,
        previousProcessed: 1400,
        projectedProcessed: 2050,
      });
      expect(intent?.title).toBe('Included allowance used');

      const duplicate = await persistBillingUsageThresholdAlert(trx, {
        shopId: f.shopId,
        tier: 'core',
        usagePeriodId: usagePeriod.id,
        previousProcessed: 1400,
        projectedProcessed: 2050,
      });
      expect(duplicate).toBeNull();
    });

    const rows = await withTenant(f.shopId, (trx) =>
      trx('alerts').where({ shop_id: f.shopId }).select(
        'alert_key', 'source', 'alert_type', 'severity', 'category', 'audience'
      )
    );
    expect(rows).toEqual([
      {
        alert_key: billingUsageAlertKey(usagePeriod.id, 100),
        source: 'billing',
        alert_type: 'billing_usage_threshold',
        severity: 'warning',
        category: 'money_margin',
        audience: 'owner',
      },
    ]);

    const nextPeriodId = await withTenant(f.shopId, async (trx) => {
      await trx('shop_usage_metrics')
        .where({ shop_id: f.shopId, id: usagePeriod.id })
        .update({ period_ends_at: new Date('2026-10-01T00:00:00Z') });
      const [row] = await trx('shop_usage_metrics')
        .insert({
          shop_id: f.shopId,
          period_starts_at: new Date('2026-10-01T00:00:00Z'),
          period_ends_at: null,
          tier_at_period_start: 'core',
          shipped_orders: 0,
        })
        .returning('id');
      return row.id;
    });

    await withTenant(f.shopId, (trx) =>
      persistBillingUsageThresholdAlert(trx, {
        shopId: f.shopId,
        tier: 'core',
        usagePeriodId: nextPeriodId,
        previousProcessed: 1400,
        projectedProcessed: 1500,
      })
    );

    const count = await withTenant(f.shopId, async (trx) => {
      const [{ count }] = await trx('alerts')
        .where({ shop_id: f.shopId, alert_type: 'billing_usage_threshold' })
        .count<{ count: string }[]>('* as count');
      return Number(count);
    });
    expect(count).toBe(2);
  });

  it('billing usage threshold alert rolls back with its transaction', async () => {
    const f = await fixture();
    const usagePeriod = await withTenant(f.shopId, (trx) =>
      trx('shop_usage_metrics').where({ shop_id: f.shopId }).first('id')
    );

    await expect(withTenant(f.shopId, async (trx) => {
      await persistBillingUsageThresholdAlert(trx, {
        shopId: f.shopId,
        tier: 'core',
        usagePeriodId: usagePeriod.id,
        previousProcessed: 1499,
        projectedProcessed: 1500,
      });
      throw new Error('ROLLBACK_PROOF');
    })).rejects.toThrow('ROLLBACK_PROOF');

    const rows = await withTenant(f.shopId, (trx) =>
      trx('alerts').where({
        shop_id: f.shopId,
        alert_key: billingUsageAlertKey(usagePeriod.id, 75),
      })
    );
    expect(rows).toEqual([]);
  });
});
