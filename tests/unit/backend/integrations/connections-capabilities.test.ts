import express from 'express';
import request from 'supertest';
import { issueTestToken } from '../../helpers/auth';

const mockMembership = jest.fn();
const mockPermissionRead = jest.fn();
let mockRows: Array<{ action: string; role: string; granted: boolean }> = [];
jest.mock('@lasyncro/backend-core/services/shop-resolution.service.js', () => ({
  resolveShopContextForUser: (...args: unknown[]) => mockMembership(...args),
  resolveTierForShop: async () => 'starter',
}));
// The source middleware resolves this service through a relative import.
jest.mock('../../../../packages/backend-core/src/services/shop-resolution.service.ts', () => ({
  resolveShopContextForUser: (...args: unknown[]) => mockMembership(...args),
  resolveTierForShop: async () => 'starter',
}));
jest.mock('@lasyncro/backend-core/middleware/auth.middleware.js', () =>
  jest.requireActual('../../../../packages/backend-core/src/middleware/auth.middleware.ts'));
jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: () => ({ where: (where: unknown) => ({ select: async () => {
    mockPermissionRead(where); return mockRows;
  } }) }),
}));
jest.mock('@lasyncro/backend-core/services/redis.client.js', () => ({
  getRedisClient: () => ({ get: async () => null, set: async () => 'OK' }),
}));
jest.mock('api-src/api/integrations/integration.controller', () => {
  const handler = (_req: unknown, res: any) => res.sendStatus(501);
  return Object.fromEntries(['initiateOAuth', 'handleOAuthCallback', 'handleShopifyInstall',
    'getSyncStatus', 'preFlightCheck', 'triggerManualSync', 'requestSyncNotification'].map(key => [key, handler]));
});
jest.mock('api-src/api/integrations/manualSync.controller', () => ({
  triggerManualInitialSync: (_req: unknown, res: any) => res.sendStatus(501),
}));
import router from 'api-src/api/integrations/integration.routes';
const app = express();
app.use('/integrations', router);
const originalSecret = process.env.JWT_SECRET;
beforeAll(() => { process.env.JWT_SECRET = 'connections-capabilities-synthetic-secret'; });
afterAll(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
beforeEach(() => {
  jest.clearAllMocks();
  mockMembership.mockResolvedValue({ shopId: 71001, role: 'admin' });
  mockRows = [{ action: 'integrations:write', role: 'admin', granted: true },
    { action: 'wms:settings:write', role: 'admin', granted: false }];
});
const get = () => request(app).get('/integrations/capabilities').set('Authorization', `Bearer ${issueTestToken({ userId: 72001, shopId: 71001, roles: ['admin'] })}`);

it('allows integrations:write independently of WMS settings and scopes the permission read', async () => {
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ canManageConnection: true });
  expect(mockPermissionRead).toHaveBeenCalledWith({ shop_id: 71001 });
});
it('rejects a revoked integration grant despite a WMS settings grant', async () => {
  mockRows = [{ action: 'integrations:write', role: 'admin', granted: false },
    { action: 'wms:settings:write', role: 'admin', granted: true }];
  const response = await get();
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ error: 'ACTION_FORBIDDEN', action: 'integrations:write' });
});
it('returns a sanitized retryable error when permission authority rejects', async () => {
  mockRows = [];
  mockPermissionRead.mockImplementationOnce(() => { throw new Error('sensitive permission failure'); });
  const response = await get();
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: 'PERMISSION_AUTHORITY_UNAVAILABLE', retryable: true });
  expect(JSON.stringify(response.body)).not.toContain('sensitive permission failure');
});
it('requires authentication', async () => {
  expect((await request(app).get('/integrations/capabilities')).status).toBe(401);
  expect(mockPermissionRead).not.toHaveBeenCalled();
});
it('rejects mismatched current tenant before reading permissions', async () => {
  mockMembership.mockResolvedValue({ shopId: 71002, role: 'admin' });
  expect((await get()).status).toBe(403);
  expect(mockPermissionRead).not.toHaveBeenCalled();
});
