// RUN_ID: SF-TIER-W1A-RED-001 ATTEMPT: 04
import crypto from 'crypto';
jest.mock('api-src/utils/analytics', () => ({ captureEvent: jest.fn() }));
const mockRetrieve = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({ subscriptions: { retrieve: (...args: any[]) => mockRetrieve(...args) } })) }));
import request from 'supertest';
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createApp } from 'api-src/bootstrap/express';
import { handleSubscriptionUpsert } from 'api-src/api/billing/handlers/handleSubscriptionUpsert';
import { attributeStripeSubscription } from 'api-src/services/billing/stripeSubscriptionAuthority.service';
import { issueTestToken } from '../../unit/helpers/auth';
const app = createApp();
afterAll(async () => { await db.destroy(); });

it('A-PAYMENT: all eight Stripe states enforce effective access using the same pre-change Growth token', async () => {
  process.env.STRIPE_PRICE_GROWTH_MONTHLY_USD = 'price_w1_growth';
  process.env.STRIPE_SECRET_KEY = 'sk_test_w1_local_stub_only';
  const outcomes = [];
  const invalidTrialOutcomes = [];
  for (const status of ['active', 'trialing', 'past_due', 'incomplete', 'incomplete_expired', 'paused', 'unpaid', 'canceled', 'expired_trial', 'invalid_trial']) {
    const suffix = crypto.randomUUID();
    const shopId = await systemTransaction(async trx => {
      const id = await createTenantShop(trx, `w1-payment-${suffix}`);
      await setTenantContext(trx, id);
      return id;
    });
    const userId = await withTenant(shopId, async trx => {
      const [user] = await trx('users').insert({ shop_id: shopId, email: `${suffix}@test.example`, password_hash: 'test', first_name: 'Owner', role: 'owner' }).returning('id');
      await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner' });
      await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: user.id, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() });
      await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', status: 'active', billing_provider: 'stripe', stripe_customer_id: `cus_${suffix}`, stripe_subscription_id: `sub_${suffix}` });
      return Number(user.id);
    });
    const token = issueTestToken({ shopId, userId, tier: 'growth', roles: ['owner'] });
    await withTenant(shopId, trx => trx('warehouses').insert({ shop_id: shopId, name: `W1 retained ${suffix}`, root_location_code: `w1_${suffix}`, is_default: false }));
    const warehouseBefore = await withTenant(shopId, trx => trx('warehouses').where({ shop_id: shopId }).orderBy('warehouse_id'));
    const before = await request(app).get('/api/v1/floor-planning/layout').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);
    const rawPayload = { id: `sub_${suffix}`, customer: `cus_${suffix}`, status: status.endsWith('_trial') ? 'trialing' : status, trial_end: status === 'invalid_trial' ? null : Math.floor(Date.now() / 1000) + (status === 'expired_trial' ? -60 : 86400), metadata: { shopId: String(shopId) }, items: { data: [{ price: { id: 'price_w1_growth' }, quantity: 1, current_period_start: 1900000000, current_period_end: 1990000000 }] } };
    mockRetrieve.mockReset().mockResolvedValue(rawPayload);
    // Only canonical active state is seeded above. Unsupported statuses enter
    // through the REAL provider handler. A handler persistence failure is part
    // of the product result, recorded for every status rather than swallowed.
    let handlerError: string | null = null;
    try {
      const envelope = { integration: 'stripe', shopId, eventId: `evt_${suffix}`, eventType: 'customer.subscription.updated', verified: true as const, receivedAt: new Date(), rawPayload };
      const authority = await attributeStripeSubscription(envelope);
      await withTenant(shopId, trx => handleSubscriptionUpsert(envelope, trx, authority));
    } catch (error: any) { handlerError = error.message; }
    const canonical = await withTenant(shopId, trx => trx('shop_subscriptions').where({ shop_id: shopId }).first('tier', 'status'));
    expect(['trialing', 'active', 'past_due', 'canceled', 'unpaid']).toContain(canonical.status);
    expect(await withTenant(shopId, trx => trx('warehouses').where({ shop_id: shopId }).orderBy('warehouse_id'))).toEqual(warehouseBefore);
    const after = await request(app).get('/api/v1/floor-planning/layout').set('Authorization', `Bearer ${token}`);
    const allowed = ['active', 'trialing', 'past_due'].includes(status);
    // Also mint a current token: persisted canonical tier and live middleware
    // must agree, independently of the earlier Growth claim.
    const currentToken = issueTestToken({ shopId, userId, tier: canonical.tier, roles: ['owner'] });
    const current = await request(app).get('/api/v1/floor-planning/layout').set('Authorization', `Bearer ${currentToken}`);
    const result = { status, handlerError, http: after.status, currentHttp: current.status, tier: canonical.tier, denial: allowed ? null : after.body?.error, currentTier: allowed ? null : after.body?.currentTier };
    if (status.endsWith('_trial')) {
      const ledger = await withTenant(shopId, trx => trx('shop_subscription_transitions').where({ shop_id: shopId }).first('metadata'));
      expect(ledger.metadata.stripe_raw_status).toBe('trialing');
      expect(canonical.status).toBe('unpaid');
      invalidTrialOutcomes.push(result);
    } else outcomes.push(result);
  }
  console.info('W1_PAYMENT_RESULTS', outcomes);
  expect(outcomes).toEqual(['active', 'trialing', 'past_due', 'incomplete', 'incomplete_expired', 'paused', 'unpaid', 'canceled'].map(status => ({ status, handlerError: null, http: ['active', 'trialing', 'past_due'].includes(status) ? 200 : 403, currentHttp: ['active', 'trialing', 'past_due'].includes(status) ? 200 : 403, tier: ['active', 'trialing', 'past_due'].includes(status) ? 'growth' : 'starter', denial: ['active', 'trialing', 'past_due'].includes(status) ? null : 'COMMERCIAL_ACCESS_DENIED', currentTier: ['active', 'trialing', 'past_due'].includes(status) ? null : 'starter' })));
  expect(invalidTrialOutcomes).toEqual(['expired_trial', 'invalid_trial'].map(status => ({ status, handlerError: null, http: 403, currentHttp: 403, tier: 'starter', denial: 'COMMERCIAL_ACCESS_DENIED', currentTier: 'starter' })));
}, 90000);

it('PL-001: authoritative ineligible state revokes paid access even when price classification fails', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_w1_local_stub_only';
  const suffix = crypto.randomUUID();
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `w1-pl001-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  await withTenant(shopId, trx => trx('shop_subscriptions').insert({
    shop_id: shopId,
    tier: 'growth',
    status: 'active',
    billing_provider: 'stripe',
    stripe_customer_id: `cus_${suffix}`,
    stripe_subscription_id: `sub_${suffix}`,
  }));
  const providerState = {
    id: `sub_${suffix}`,
    customer: `cus_${suffix}`,
    status: 'paused',
    metadata: { shopId: String(shopId) },
    items: { data: [{ price: { id: 'price_w1_unknown' }, quantity: 1 }] },
  };
  mockRetrieve.mockReset().mockResolvedValue(providerState);
  const envelope = { integration: 'stripe', shopId, eventId: `evt_${suffix}`, eventType: 'customer.subscription.updated', verified: true as const, receivedAt: new Date(), rawPayload: providerState };
  const authority = await attributeStripeSubscription(envelope);
  await withTenant(shopId, trx => handleSubscriptionUpsert(envelope, trx, authority));
  expect(await withTenant(shopId, trx => trx('shop_subscriptions').where({ shop_id: shopId }).first('tier', 'status')))
    .toEqual({ tier: 'starter', status: 'unpaid' });
}, 20000);
