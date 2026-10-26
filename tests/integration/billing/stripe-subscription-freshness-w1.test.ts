// RUN_ID: SF-TIER-W1A-RED-001 ATTEMPT: 04
import crypto from 'crypto';
jest.mock('api-src/utils/analytics', () => ({ captureEvent: jest.fn() }));
// Provider boundary is scripted locally before importing production registration.
const mockRetrieve = jest.fn();
const mockList = jest.fn();
const mockCheckoutRetrieve = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({ subscriptions: { retrieve: mockRetrieve, list: mockList }, checkout: { sessions: { retrieve: mockCheckoutRetrieve } } })) }));
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import 'api-src/api/billing/stripe.webhook';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { handleSubscriptionUpsert } from 'api-src/api/billing/handlers/handleSubscriptionUpsert';
import { handleSubscriptionDeleted } from 'api-src/api/billing/handlers/handleSubscriptionDeleted';

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_w1_local_stub_only';
  process.env.STRIPE_PRICE_GROWTH_MONTHLY_USD = 'price_w1_growth';
  process.env.STRIPE_PRICE_CORE_MONTHLY_USD = 'price_w1_core';
});
afterAll(async () => { await db.destroy(); });
function payload(shopId: number, id: string, status = 'active', price = 'price_w1_growth', end = 1990000000) {
  return { id, customer: `cus_w1_${shopId}`, status, metadata: { shopId: String(shopId) }, items: { data: [{ price: { id: price }, quantity: 1, current_period_start: 1900000000, current_period_end: end }] } };
}
async function fixture(provider = 'stripe', tier = 'growth', status = 'active') {
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `w1-fresh-${crypto.randomUUID()}`);
    await setTenantContext(trx, id);
    return id;
  });
  await withTenant(shopId, async trx => {
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier, status, billing_provider: provider, stripe_customer_id: `cus_w1_${shopId}`, stripe_subscription_id: 'sub_w1_B', current_period_start: new Date(1900000000000), current_period_end: new Date(1990000000000) });
    await trx('shop_module_entitlements').insert({ shop_id: shopId, module_key: 'floor-planning', flag_key: null, source: 'tier:growth', valid_from: new Date(Date.now() - 60000) });
  });
  mockRetrieve.mockReset().mockResolvedValue(payload(shopId, 'sub_w1_B'));
  mockList.mockReset().mockResolvedValue({ data: [payload(shopId, 'sub_w1_B')] });
  mockCheckoutRetrieve.mockReset().mockRejectedValue(new Error('W1_NO_VERIFIED_REPLACEMENT'));
  return shopId;
}
async function read(shopId: number) {
  return withTenant(shopId, async trx => ({
    subscription: await trx('shop_subscriptions').where({ shop_id: shopId }).first('tier', 'status', 'billing_provider', 'stripe_customer_id', 'stripe_subscription_id', 'current_period_start', 'current_period_end'),
    grants: await trx('shop_module_entitlements').where({ shop_id: shopId }).orderBy('id'),
    ledger: await trx('shop_subscription_transitions').where({ shop_id: shopId }).orderBy('id'),
  }));
}
async function dispatch(shopId: number, rawPayload: any, eventType: string) {
  const envelope = { integration: 'stripe', shopId, rawPayload, eventType, eventId: `evt_w1_${crypto.randomUUID()}`, verified: true as const, receivedAt: new Date('2030-01-01') };
  await WebhookRouter.dispatch(envelope);
  return envelope;
}

it('A-OBSOLETE-DELETE: deleting obsolete A preserves current B and its grants and ledger', async () => {
  const id = await fixture();
  const before = await read(id);
  await dispatch(id, payload(id, 'sub_w1_A', 'canceled'), 'customer.subscription.deleted');
  expect(await read(id)).toEqual(before);
}, 20000);

// These controls are expected GREEN where the existing invariant is satisfied;
// they are not additional defect claims or unexpected GREENs.
it('A-CURRENT-FRESHNESS controls: authorized renewal, reactivation and replay remain valid', async () => {
  const renewal = await fixture();
  const renewed = payload(renewal, 'sub_w1_B', 'active', 'price_w1_growth', 2000000000);
  const beforeRenewal = await read(renewal);
  mockRetrieve.mockResolvedValue(renewed);
  mockList.mockResolvedValue({ data: [renewed] });
  const event = await dispatch(renewal, renewed, 'customer.subscription.updated');
  const afterRenewal = await read(renewal);
  expect(afterRenewal.grants).toEqual(beforeRenewal.grants);
  expect(afterRenewal.ledger).toEqual(beforeRenewal.ledger);
  expect(afterRenewal.subscription).toMatchObject({ tier: 'growth', status: 'active', stripe_subscription_id: 'sub_w1_B', current_period_end: new Date(2000000000000) });
  await WebhookRouter.dispatch(event);
  expect(await read(renewal)).toEqual(afterRenewal);

  const reactivation = await fixture('stripe', 'starter', 'canceled');
  const active = payload(reactivation, 'sub_w1_B');
  mockRetrieve.mockResolvedValue(active);
  mockList.mockResolvedValue({ data: [active] });
  const activationEvent = await dispatch(reactivation, active, 'customer.subscription.updated');
  const after = await read(reactivation);
  expect(after.subscription).toMatchObject({ tier: 'growth', status: 'active', stripe_subscription_id: 'sub_w1_B' });
  expect(after.ledger).toHaveLength(1);
  expect(after.ledger[0]).toMatchObject({ from_tier: 'starter', to_tier: 'growth', from_status: 'canceled', to_status: 'active', external_event_id: activationEvent.eventId });
}, 30000);

it('A-CURRENT-FRESHNESS controls: verified replacement succeeds, subsequent old B is ignored', async () => {
  const id = await fixture();
  const replacement = payload(id, 'sub_w1_C', 'active', 'price_w1_growth', 2000000000);
  const session = { id: `cs_w1_${id}`, mode: 'subscription', status: 'complete', payment_status: 'paid', customer: `cus_w1_${id}`, subscription: 'sub_w1_C', metadata: { shopId: String(id) } };
  mockRetrieve.mockResolvedValue(replacement);
  mockList.mockResolvedValue({ data: [replacement] });
  mockCheckoutRetrieve.mockResolvedValue(session);
  // A genuine verified checkout notification establishes replacement authority;
  // an ordinary unknown subscription notification below has no such authority.
  await dispatch(id, session, 'checkout.session.completed');
  await dispatch(id, replacement, 'customer.subscription.created');
  const accepted = await read(id);
  expect(accepted.subscription).toMatchObject({ stripe_subscription_id: 'sub_w1_C', current_period_end: new Date(2000000000000), tier: 'growth', status: 'active' });
  await dispatch(id, payload(id, 'sub_w1_B'), 'customer.subscription.updated');
  expect(await read(id)).toEqual(accepted);
}, 25000);

it('A-CURRENT-FRESHNESS controls: failed provider fetch cannot grant access or change business state', async () => {
  const id = await fixture('stripe', 'starter', 'canceled');
  const before = await read(id);
  mockRetrieve.mockRejectedValue(new Error('W1_PROVIDER_UNAVAILABLE'));
  mockList.mockRejectedValue(new Error('W1_PROVIDER_UNAVAILABLE'));
  let error: any;
  try { await dispatch(id, payload(id, 'sub_w1_B'), 'customer.subscription.updated'); }
  catch (caught) { error = caught; }
  // Transport may fail for retry; the business-state invariant is independent.
  console.info('W1_PROVIDER_FAILURE_TRANSPORT', error?.message ?? 'resolved');
  expect(await read(id)).toEqual(before);
}, 20000);

it('D8/D9: missing or fabricated attribution cannot mutate subscription, ledger or grants', async () => {
  const id = await fixture();
  const before = await read(id);
  const envelope = { integration: 'stripe', shopId: id, eventId: `evt_w1_${crypto.randomUUID()}`, eventType: 'customer.subscription.updated', verified: true as const, receivedAt: new Date(), rawPayload: payload(id, 'sub_w1_B') };
  for (const handler of [handleSubscriptionUpsert, handleSubscriptionDeleted]) {
    await expect(withTenant(id, trx => handler(envelope, trx))).rejects.toThrow('verified pre-transaction authority required');
    await expect(withTenant(id, trx => handler(envelope, trx, { shopId: id, eventId: envelope.eventId, ignored: false, subscription: envelope.rawPayload }))).rejects.toThrow('verified pre-transaction authority required');
  }
  expect(await read(id)).toEqual(before);
});

it('A-CURRENT-FRESHNESS controls: unknown relationship and customer mismatch never establish ownership', async () => {
  const outcomes = [];
  for (const scenario of ['unverified_C', 'wrong_customer']) {
    const id = await fixture();
    const before = await read(id);
    const observation = payload(id, scenario === 'unverified_C' ? 'sub_w1_C' : 'sub_w1_B', 'active', 'price_w1_core', 2000000000);
    if (scenario === 'wrong_customer') observation.customer = 'cus_w1_foreign';
    mockRetrieve.mockResolvedValue(scenario === 'unverified_C' ? payload(id, 'sub_w1_B') : observation);
    let error: any;
    try { await dispatch(id, observation, 'customer.subscription.updated'); } catch (caught) { error = caught; }
    outcomes.push({ scenario, unchanged: JSON.stringify(await read(id)) === JSON.stringify(before) });
    console.info('W1_REJECTED_RELATIONSHIP_TRANSPORT', scenario, error?.message ?? 'resolved');
  }
  expect(outcomes).toEqual([{ scenario: 'unverified_C', unchanged: true }, { scenario: 'wrong_customer', unchanged: true }]);
}, 30000);

it('Shopify ownership control: foreign Stripe upsert and deletion leave subscription, grants and ledger intact', async () => {
  const id = await fixture('shopify');
  const before = await read(id);
  for (const eventType of ['customer.subscription.updated', 'customer.subscription.deleted']) {
    let error: any;
    try { await dispatch(id, payload(id, 'sub_w1_B', 'canceled'), eventType); } catch (caught) { error = caught; }
    console.info('W1_FOREIGN_PROVIDER_TRANSPORT', error?.message ?? 'resolved');
    expect(await read(id)).toEqual(before);
  }
}, 25000);

it('A-CURRENT-FRESHNESS control: relationship changed during provider lookup cannot be overwritten by the stale observation', async () => {
  const id = await fixture();
  let competingWriteCompleted = false;
  const observedB = payload(id, 'sub_w1_B', 'active', 'price_w1_growth', 2000000000);
  const duringLookup = async () => {
    // The provider response remains pending until this independent transaction
    // commits. A caller holding row/advisory locks fails the bounded DB wait.
    await withTenant(id, async trx => {
      await trx.raw("SET LOCAL lock_timeout = '1000ms'");
      await trx.raw("SET LOCAL statement_timeout = '3000ms'");
      await transitionShopSubscription({ shopId: id, to: {}, fields: { stripe_subscription_id: 'sub_w1_C' }, source: 'w1_verified_replacement_control', reason: 'relationship_changed_during_lookup', actorType: 'stripe', actingProvider: 'stripe' }, trx);
    });
    competingWriteCompleted = true;
    return observedB;
  };
  mockRetrieve.mockImplementation(duringLookup);
  mockList.mockImplementation(async () => ({ data: [await duringLookup()] }));
  let error: any;
  try { await dispatch(id, observedB, 'customer.subscription.updated'); } catch (caught) { error = caught; }
  console.info('W1_LOOKUP_RACE', { competingWriteCompleted, transport: error?.message ?? 'resolved' });
  expect(competingWriteCompleted).toBe(true);
  const after = await read(id);
  expect(after.subscription).toMatchObject({ stripe_subscription_id: 'sub_w1_C', current_period_end: new Date(1990000000000) });
  expect(after.ledger).toHaveLength(0);
}, 20000);

it('PL-002: same-millisecond same-identity field change rejects the stale provider observation', async () => {
  const id = await fixture();
  const collisionTimestamp = new Date('2030-01-01T00:00:00.123Z');
  await withTenant(id, trx => trx('shop_subscriptions').where({ shop_id: id }).update({ updated_at: collisionTimestamp }));
  const original = await withTenant(id, trx => trx('shop_subscriptions').where({ shop_id: id }).first('updated_at'));
  const stale = payload(id, 'sub_w1_B', 'active', 'price_w1_growth', 2000000000);
  let competingWriteCompleted = false;
  mockRetrieve.mockImplementation(async () => {
    await withTenant(id, async trx => {
      await transitionShopSubscription({
        shopId: id,
        to: {},
        fields: { extra_seats: 4, current_period_start: new Date(1910000000000), current_period_end: new Date(2010000000000) },
        source: 'w1_same_millisecond_control',
        reason: 'same_identity_fields_changed',
        actorType: 'stripe',
        actingProvider: 'stripe',
      }, trx);
      await trx('shop_subscriptions').where({ shop_id: id }).update({ updated_at: original.updated_at });
    });
    competingWriteCompleted = true;
    return stale;
  });
  await dispatch(id, stale, 'customer.subscription.updated');
  expect(competingWriteCompleted).toBe(true);
  expect(await withTenant(id, trx => trx('shop_subscriptions').where({ shop_id: id }).first('extra_seats', 'current_period_start', 'current_period_end')))
    .toEqual({ extra_seats: 4, current_period_start: new Date(1910000000000), current_period_end: new Date(2010000000000) });
}, 20000);

it('A-OBSOLETE-UPSERT: obsolete A cannot change B, including a same-tier field-only notification', async () => {
  const outcomes = [];
  for (const price of ['price_w1_core', 'price_w1_growth']) {
    const id = await fixture();
    const before = await read(id);
    await dispatch(id, payload(id, 'sub_w1_A', 'active', price, 2000000000), 'customer.subscription.updated');
    outcomes.push({ price, unchanged: JSON.stringify(await read(id)) === JSON.stringify(before) });
  }
  expect(outcomes).toEqual([{ price: 'price_w1_core', unchanged: true }, { price: 'price_w1_growth', unchanged: true }]);
}, 30000);

it('A-CURRENT-FRESHNESS: stale B notification reconciles the authoritative canceled B snapshot', async () => {
  const id = await fixture();
  mockRetrieve.mockResolvedValue(payload(id, 'sub_w1_B', 'canceled'));
  const stale = payload(id, 'sub_w1_B', 'active');
  const envelope = await dispatch(id, stale, 'customer.subscription.updated');
  const current = await read(id);
  expect(current.subscription).toMatchObject({ stripe_subscription_id: 'sub_w1_B', tier: 'starter', status: 'canceled' });
  expect(current.ledger).toHaveLength(1);
  expect(current.ledger[0]).toMatchObject({ external_event_id: envelope.eventId, to_tier: 'starter', to_status: 'canceled' });
  await WebhookRouter.dispatch(envelope);
  expect(await read(id)).toEqual(current);
}, 20000);
