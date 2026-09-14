// tests/integration/alerts/stock-protection-alert-transport.contract.test.ts
//
// STOCK-PROTECT-03 Slice 3A — GET /api/v1/alerts transport contract for
// alert_type='stock_protection'. PERMANENT regression contract, authored RED.
// ===========================================================================
// INDEPENDENTLY RED (at authoring time)
//   apps/backend/src/api/alerts/alerts.controller.ts's ALERT_SELECT does not
//   include `treatment`, and the response shaping does not compute an
//   `action` field at all — every assertion below that reads
//   `alert.treatment`/`alert.action` fails against the CURRENT controller,
//   narrowly attributable to the missing transport, not a malformed test.
//
// Synthetic rows are inserted directly into `alerts` — no monitoring/
// producer service is used or created to obtain these fixtures.

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const now = new Date('2026-09-13T12:00:00.000Z');

async function bootstrapShop(unique: string, tier: 'starter' | 'core' | 'growth' | 'scale') {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-alert-transport-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sp-alert-transport+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return Number(row.id ?? row);
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: now,
      last_event_id: crypto.randomUUID(),
    });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier,
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
  });

  return { shopId, userId, token: issueTestToken({ userId, shopId, tier }) };
}

async function seedAlert(
  shopId: number,
  overrides: Partial<{
    alert_key: string;
    alert_type: string;
    treatment: string | null;
    entity_type: string | null;
    entity_id: string | null;
    is_active: boolean;
    resolved_at: Date | null;
    severity: string;
  }> = {},
) {
  await withTenant(shopId, async (trx) => {
    await trx('alerts').insert({
      shop_id: shopId,
      alert_key: overrides.alert_key ?? `stock_protection:${crypto.randomUUID()}`,
      source: 'projection',
      alert_type: overrides.alert_type ?? 'stock_protection',
      severity: overrides.severity ?? 'critical',
      title: 'Fixture title',
      message: 'Fixture message',
      entity_id: overrides.entity_id ?? crypto.randomUUID(),
      entity_type: overrides.entity_type ?? 'variant',
      treatment: overrides.treatment ?? 'reorder_now',
      is_active: overrides.is_active ?? true,
      resolved_at: overrides.resolved_at ?? null,
      category: 'stock_reorder',
      audience: 'all',
    });
  });
}

describe('GET /api/v1/alerts — stock_protection treatment/action transport', () => {
  it('A1: stock_protection row exposes treatment verbatim', async () => {
    const { shopId, token } = await bootstrapShop('a1', 'growth');
    await seedAlert(shopId, { treatment: 'reorder_now' });

    const res = await request(app).get('/api/v1/alerts').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const row = res.body.data.find((a: any) => a.alert_type === 'stock_protection');
    expect(row).toBeDefined();
    expect(row.treatment).toBe('reorder_now');
  });

  it('A2: fully-entitled reorder_now resolves a real action object', async () => {
    const { shopId, token } = await bootstrapShop('a2', 'growth');
    const variantId = crypto.randomUUID();
    await seedAlert(shopId, { treatment: 'reorder_now', entity_id: variantId });

    const res = await request(app).get('/api/v1/alerts').set('Authorization', `Bearer ${token}`);
    const row = res.body.data.find((a: any) => a.alert_type === 'stock_protection');

    expect(row.action).toEqual({
      key: 'stock_protection_reorder_now',
      label: 'Reorder now',
      route: `/suppliers-portal/sourcing?variantId=${variantId}`,
      module: 'suppliers-portal',
    });
  });

  it('A3: complete_setup exposes treatment but action is null', async () => {
    const { shopId, token } = await bootstrapShop('a3', 'growth');
    await seedAlert(shopId, { treatment: 'complete_setup' });

    const res = await request(app).get('/api/v1/alerts').set('Authorization', `Bearer ${token}`);
    const row = res.body.data.find((a: any) => a.alert_type === 'stock_protection');

    expect(row.treatment).toBe('complete_setup');
    expect(row.action).toBeNull();
  });

  it('A4: resolved stock_protection row retains treatment but action is null', async () => {
    const { shopId, token } = await bootstrapShop('a4', 'growth');
    await seedAlert(shopId, {
      treatment: 'reorder_now',
      is_active: false,
      resolved_at: now,
    });

    const res = await request(app)
      .get('/api/v1/alerts')
      .query({ status: 'resolved' })
      .set('Authorization', `Bearer ${token}`);
    const row = res.body.data.find((a: any) => a.alert_type === 'stock_protection');

    expect(row).toBeDefined();
    expect(row.treatment).toBe('reorder_now');
    expect(row.action).toBeNull();
  });

  it('A5: legacy alert type is unaffected — treatment null, action null', async () => {
    const { shopId, token } = await bootstrapShop('a5', 'growth');
    await withTenant(shopId, async (trx) => {
      await trx('alerts').insert({
        shop_id: shopId,
        alert_key: `demand:stockout_risk:${crypto.randomUUID()}`,
        source: 'demand',
        alert_type: 'stockout_risk',
        severity: 'critical',
        title: 'Legacy fixture',
        message: 'Legacy fixture message',
        entity_id: crypto.randomUUID(),
        entity_type: 'variant',
        is_active: true,
        category: 'stock_reorder',
        audience: 'all',
      });
    });

    const res = await request(app).get('/api/v1/alerts').set('Authorization', `Bearer ${token}`);
    const row = res.body.data.find((a: any) => a.alert_type === 'stockout_risk');

    expect(row).toBeDefined();
    expect(row.treatment).toBeNull();
    expect(row.action).toBeNull();
  });

  it('A6: commercially denied shop (starter tier) resolves reorder_now action to null', async () => {
    const { shopId, token } = await bootstrapShop('a6', 'starter');
    await seedAlert(shopId, { treatment: 'reorder_now' });

    const res = await request(app).get('/api/v1/alerts').set('Authorization', `Bearer ${token}`);
    const row = res.body.data.find((a: any) => a.alert_type === 'stock_protection');

    expect(row.treatment).toBe('reorder_now');
    expect(row.action).toBeNull();
  });

  it('A7: unknown treatment resolves action to null, never guessed', async () => {
    const { shopId, token } = await bootstrapShop('a7', 'growth');
    await seedAlert(shopId, { treatment: 'some_future_treatment' });

    const res = await request(app).get('/api/v1/alerts').set('Authorization', `Bearer ${token}`);
    const row = res.body.data.find((a: any) => a.alert_type === 'stock_protection');

    expect(row.action).toBeNull();
  });
});
