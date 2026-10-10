/**
 * AUTH-TENANT-01: real createApp registrations, JWT admission, controllers,
 * requireAction and permissionCache. Only persistence/cache/provider boundaries
 * and unrelated bootstrap modules are doubled. No database or provider calls.
 * This proves boundary decisions and attempted effects, not real DB persistence.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const SHOP_A = 71001;
const SHOP_B = 71002;
const USER = 72001;
const INTEGRATION_A = 73001;
const INTEGRATION_B = 73002;
const secret = 'auth-tenant-01-synthetic-secret';
const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = secret;

const membership = jest.fn();
const resolveTier = jest.fn().mockResolvedValue('starter');
const credential = jest.fn();
const initialSync = jest.fn();
const backfill = jest.fn();
const eventInsert = jest.fn();
const integrationRead = jest.fn();
const permissionRead = jest.fn();
let permissionRows: Array<{ action: string; role: string; granted: boolean }> = [];
const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };

// Two independent synthetic tenants. Foreign integration lookup returns nothing
// unless BOTH integration id and tenant predicate match the stored ownership.
function tenantQuery(tenant: number) {
  const query = (table: string) => {
    if (table === 'integrations') {
      return { where: (where: { id: unknown; shop_id: number }) => ({
        first: async () => {
          integrationRead(tenant, where);
          const owner = Number(where.id) === INTEGRATION_A ? SHOP_A
            : Number(where.id) === INTEGRATION_B ? SHOP_B : undefined;
          return owner === tenant && owner === where.shop_id
            ? { id: Number(where.id), shop_id: owner } : undefined;
        },
      }) };
    }
    if (table === 'domain_events') {
      return { insert: (row: unknown) => {
        eventInsert(tenant, row);
        return { returning: async () => [{ id: 74001 }] };
      } };
    }
    throw new Error(`Unexpected tenant table: ${table}`);
  };
  query.fn = { now: () => 'synthetic-event-time' };
  return query;
}
const withTenant = jest.fn(async (tenant: number, work: Function) => work(tenantQuery(tenant)));
const db = jest.fn((table: string) => {
  if (table !== 'shop_role_permissions') throw new Error(`Unexpected global table: ${table}`);
  return { where: (where: { shop_id: number }) => ({ select: async () => {
    permissionRead(where.shop_id);
    return permissionRows;
  } }) };
});

jest.doMock('@lasyncro/backend-core/db.js', () => ({ __esModule: true, default: db, withTenant }));
jest.doMock('@lasyncro/backend-core/services/shop-resolution.service.js', () => ({
  requireShopContextForUser: membership, resolveTierForShop: resolveTier,
}));
jest.doMock('../../../../packages/backend-core/src/services/shop-resolution.service.ts', () => ({
  requireShopContextForUser: membership, resolveTierForShop: resolveTier,
}));
jest.doMock('@lasyncro/backend-core/services/redis.client.js', () => ({ getRedisClient: () => redis }));
// Exercise current source rather than relying on generated backend-core dist.
jest.doMock('@lasyncro/backend-core/middleware/auth.middleware.js', () =>
  jest.requireActual('../../../../packages/backend-core/src/middleware/auth.middleware.ts'));
jest.doMock('@lasyncro/backend-core/middleware/requireAuthStrict.js', () =>
  jest.requireActual('../../../../packages/backend-core/src/middleware/requireAuthStrict.ts'));
jest.doMock('api-src/services/shopify/shopifyAdminCredentialConsumer.service', () => ({
  resolveShopifyAdminCredentialForConsumer: credential,
}));
jest.doMock('api-src/services/shopify.service', () => ({ performInitialSync: initialSync }));
jest.doMock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({ backfillShopifyRefunds: backfill }));

// Ancillary imports belong to other controller operations, never these routes.
for (const module of [
  'api/auth/token.service', 'services/shopify/shopifyWebhook.service', 'utils/audit',
  'utils/rateLimit', 'queue', 'services/billing/subscriptionTransition.service',
  'services/shopify/applyShopifyBillingState.service', 'services/shopify/shopifyScopes',
  'services/shopify/shopifyOAuthAcquisition.service',
  'services/shopify/shopifyAdminCredential.repository',
  'services/shopify/shopifyAdminCredentialLifecycle.service',
]) jest.doMock(`api-src/${module}`, () => ({}));
jest.doMock('@lasyncro/backend-core/services/entitlements.service.js', () => ({}));
jest.doMock('@lasyncro/backend-core/services/pre-tenant.service.js', () => ({}));

// Keep the actual bootstrap registration (including refund-backfill); isolate
// unrelated routers so this slice neither imports WIP nor starts workers.
for (const module of [
  'layouts/layout.routes', 'orders/orders.routes', 'customers/customers.routes',
  'products/products.routes', 'auth/auth.routes', 'user-state/user-state.routes',
  'shopify/shopify.routes', 'customers/customers.ft2.routes', 'order-nexus/orderNexus.routes',
  'products/products.ft2.routes', 'overview/index', 'trust/index', 'system/system.routes',
  'alerts/alerts.routes', 'aha/aha.routes', 'returns/returns.routes', 'operations/operations.routes',
  'customers/customers.ltv.routes', 'demand/demand.routes', 'wms/wms.routes',
  'suppliers/suppliers.routes', 'floor-planning/floor-planning.routes',
  'notifications/notifications.routes', 'members/members.routes', 'currency/currency.routes',
  'settings/permissions.routes', 'settings/shopSettings.routes', 'operators/operators.routes',
  'shopify/shopify.billing.routes', 'exports/exports.routes', 'search/search.routes',
  'billing/billing.routes', 'waitlist/waitlist.routes', 'pilot/pilot.routes',
  'webhooks/sendcloud.tracking.router', 'webhooks/shippo.tracking.router',
]) jest.doMock(`api-src/api/${module}`, () => ({ __esModule: true, default: express.Router() }));
jest.doMock('api-src/onboarding/readiness.router', () => ({ __esModule: true, default: express.Router() }));
jest.doMock('api-src/api/activation/activation.routes', () => ({ registerActivationRoutes: jest.fn() }));
jest.doMock('api-src/api/lifecycle/lifecycle.routes', () => ({ registerLifecycleRoutes: jest.fn() }));
const unusedHandler = (_req: unknown, res: any) => res.sendStatus(501);
jest.doMock('api-src/api/entitlements/entitlements.controller', () => ({ getMyEntitlements: unusedHandler }));
jest.doMock('api-src/api/billing/stripe.webhook', () => ({ stripeWebhookHandler: unusedHandler }));
jest.doMock('api-src/api/billing/stripe.verify.middleware', () => ({ verifyStripeSignature: unusedHandler }));
jest.doMock('api-src/api/webhooks/sendcloud.tracking.verify.middleware', () => ({ verifySendcloudTrackingWebhook: unusedHandler }));

const { createApp } = require('api-src/bootstrap/express');
const { requireAction } = require('api-src/middleware/require-action.middleware');
const { authenticateToken } = require('@lasyncro/backend-core/middleware/auth.middleware.js');
const app = createApp();
const policyApp = express();
policyApp.post('/permission', authenticateToken, requireAction('integrations:write'),
  (_req: unknown, res: any) => res.json({ admitted: true }));

function token(role = 'owner', shopId: unknown = SHOP_A) {
  return jwt.sign({ user_id: USER, shop_id: shopId, shop_roles: [role] }, secret);
}
function post(path: string, body = {}, role = 'owner', shopId: unknown = SHOP_A) {
  return request(app).post(`/api/v1/integrations/${path}`)
    .set('Authorization', `Bearer ${token(role, shopId)}`).send(body);
}
function effects() {
  return {
    tenants: withTenant.mock.calls.map(([tenant]) => tenant),
    credentials: credential.mock.calls.length,
    initialSync: initialSync.mock.calls.length,
    events: eventInsert.mock.calls.length,
    backfill: backfill.mock.calls.length,
  };
}
function denied(response: any, status?: number) {
  expect({ rejected: status ? response.status === status : [400, 401, 403, 404].includes(response.status),
    ...effects() }).toEqual({ rejected: true, tenants: [], credentials: 0, initialSync: 0, events: 0, backfill: 0 });
}
function canonical() {
  expect(membership).toHaveBeenCalledWith(USER);
}
beforeEach(() => {
  jest.clearAllMocks();
  permissionRows = [];
  membership.mockResolvedValue({ shopId: SHOP_A, role: 'owner' });
  credential.mockResolvedValue({ kind: 'READY', accessToken: 'synthetic-token', shopDomain: 'synthetic.myshopify.com' });
  initialSync.mockResolvedValue(undefined);
  backfill.mockResolvedValue({ processed: 2 });
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe('AUTH-TENANT-01 manual initial sync', () => {
  it('rejects body shop B before tenant DB, credentials or performInitialSync', async () => {
    denied(await post('manual-initial-sync', { shopId: SHOP_B, integrationId: INTEGRATION_B }));
  });
  it('rejects authenticated shop A/current membership B disagreement before effects', async () => {
    membership.mockResolvedValue({ shopId: SHOP_B, role: 'owner' });
    denied(await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_A }));
  });
  it('rejects missing body tenant without effects', async () => {
    denied(await post('manual-initial-sync', { integrationId: INTEGRATION_A }), 400);
  });
  it('rejects malformed body tenant before tenant DB access', async () => {
    denied(await post('manual-initial-sync', { shopId: 'not-a-tenant', integrationId: INTEGRATION_A }), 400);
  });
  it('rejects negative body tenant before tenant DB access', async () => {
    denied(await post('manual-initial-sync', { shopId: -1, integrationId: INTEGRATION_A }), 400);
  });
  it('rejects malformed integration identifier before tenant DB access', async () => {
    denied(await post('manual-initial-sync', { shopId: SHOP_A, integrationId: 'not-an-id' }), 400);
  });
  it('rejects missing authenticated tenant before controller effects', async () => {
    denied(await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_A }, 'owner', null), 401);
  });
  it('rejects operator without management permission before effects', async () => {
    denied(await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_A }, 'operator'), 403);
  });
  it('keeps same-shop owner behavior and delegates to canonical performInitialSync', async () => {
    const response = await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_A });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'initial_sync_triggered', shopId: SHOP_A, integrationId: INTEGRATION_A });
    expect(credential).toHaveBeenCalledWith(expect.objectContaining({ shopId: SHOP_A }));
    expect(initialSync.mock.calls).toEqual([['synthetic-token', 'synthetic.myshopify.com', SHOP_A, INTEGRATION_A]]);
    expect(eventInsert).not.toHaveBeenCalled();
  });
  it('resolves current tenant using authenticated user identity on authorized requests', async () => {
    await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_A, userId: 99999 });
    canonical();
  });
  it('cannot sync a foreign integration under shop A', async () => {
    const response = await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_B });
    expect(response.status).toBe(404);
    expect(effects()).toEqual({ tenants: [SHOP_A], credentials: 0, initialSync: 0, events: 0, backfill: 0 });
  });
});

describe('AUTH-TENANT-01 manual integration sync', () => {
  it('rejects operator without management permission before event or tenant access', async () => {
    denied(await post(`sync/${INTEGRATION_A}`, {}, 'operator'), 403);
  });
  it('cannot emit an event for an integration owned by shop B', async () => {
    const response = await post(`sync/${INTEGRATION_B}`);
    expect(response.status).toBe(404);
    expect(eventInsert).not.toHaveBeenCalled();
    expect(integrationRead.mock.calls).toEqual([[SHOP_A, { id: String(INTEGRATION_B), shop_id: SHOP_A }]]);
    canonical();
  });
  it('rejects authenticated shop A/current membership B disagreement before effects', async () => {
    membership.mockResolvedValue({ shopId: SHOP_B, role: 'owner' });
    denied(await post(`sync/${INTEGRATION_B}`));
  });
  it('keeps same-shop admin behavior and emits the canonical tenant event', async () => {
    const response = await post(`sync/${INTEGRATION_A}`, { shopId: SHOP_B, userId: 99999 }, 'admin');
    expect(response.status).toBe(200);
    canonical();
    expect(eventInsert.mock.calls).toEqual([[SHOP_A, expect.objectContaining({
      shop_id: SHOP_A, event_type: 'integration/manual_sync_requested',
      event_payload: { integration_id: INTEGRATION_A },
    })]]);
  });
  it('fails closed if canonical membership cannot be resolved', async () => {
    membership.mockRejectedValue(new Error('SHOP_CONTEXT_REQUIRED'));
    denied(await post(`sync/${INTEGRATION_A}`), 403);
  });
});

describe('AUTH-TENANT-01 refund backfill', () => {
  it('rejects operator without management permission and never invokes backfill', async () => {
    denied(await post('refund-backfill', {}, 'operator'), 403);
  });
  it('rejects authenticated shop A/current membership B disagreement before backfill', async () => {
    membership.mockResolvedValue({ shopId: SHOP_B, role: 'owner' });
    denied(await post('refund-backfill'));
  });
  it('keeps authorized behavior and uses authenticated tenant despite body shop B', async () => {
    const response = await post('refund-backfill', { shopId: SHOP_B, userId: 99999 }, 'admin');
    expect(response.status).toBe(200);
    expect(backfill.mock.calls).toEqual([[SHOP_A]]);
    expect(response.body).toMatchObject({ processed: 2 });
  });
  it('resolves current membership using authenticated identity before backfill', async () => {
    await post('refund-backfill', { userId: 99999 });
    canonical();
    expect(membership.mock.invocationCallOrder[0]).toBeLessThan(backfill.mock.invocationCallOrder[0]);
  });
});

describe('AUTH-TENANT-01 real management policy', () => {
  async function policy(role: string) {
    const response = await request(policyApp).post('/permission')
      .set('Authorization', `Bearer ${token(role)}`);
    expect(permissionRead).toHaveBeenCalledWith(SHOP_A);
    return response;
  }
  it('allows owner by default', async () => { expect((await policy('owner')).status).toBe(200); });
  it('allows admin by default', async () => { expect((await policy('admin')).status).toBe(200); });
  it('denies operator by default', async () => {
    expect((await policy('operator')).body).toMatchObject({ error: 'ACTION_FORBIDDEN', action: 'integrations:write' });
  });
  it('preserves configured operator grant', async () => {
    permissionRows = [{ action: 'integrations:write', role: 'operator', granted: true }];
    expect((await policy('operator')).status).toBe(200);
  });
  it('preserves configured admin denial', async () => {
    permissionRows = [{ action: 'integrations:write', role: 'admin', granted: false }];
    expect((await policy('admin')).status).toBe(403);
  });
  it('uses configured denial in actual manual-initial-sync admission', async () => {
    permissionRows = [{ action: 'integrations:write', role: 'admin', granted: false }];
    denied(await post('manual-initial-sync', { shopId: SHOP_A, integrationId: INTEGRATION_A }, 'admin'), 403);
  });
  it('uses configured denial in actual manual-sync admission', async () => {
    permissionRows = [{ action: 'integrations:write', role: 'admin', granted: false }];
    denied(await post(`sync/${INTEGRATION_A}`, {}, 'admin'), 403);
  });
  it('uses configured denial in actual refund-backfill admission', async () => {
    permissionRows = [{ action: 'integrations:write', role: 'admin', granted: false }];
    denied(await post('refund-backfill', {}, 'admin'), 403);
  });
});
