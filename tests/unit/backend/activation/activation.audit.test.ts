import request from 'supertest';
import { createActivationTestApp } from 'api-src/api/activation/__tests__/createActivationTestApp';
const app = createActivationTestApp();
import db from 'api-src/db';
import { ACTIVATION_DERIVATION_VERSION } from '@lasyncro/shared/activation';

jest.mock('api-src/db', () => {
  let insertedRow: any = null;

  const mockDbInstance = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    first: jest.fn(),
    del: jest.fn().mockResolvedValue(undefined),
    orderBy: jest.fn().mockReturnThis(),

    insert: jest.fn().mockImplementation((row) => {
      insertedRow = row;
      return Promise.resolve(undefined);
    }),

    limit: jest.fn().mockImplementation(() => {
      return Promise.resolve(insertedRow ? [insertedRow] : []);
    }),
  };

  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn() };

  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn,
  };
});

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 1 };
    next();
  },
}));

// Mock ShopifyAppService
jest.mock('api-src/services/shopify-app.service', () => ({
  ShopifyAppService: {
    completePostInstallation: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Activation Audit Trail', () => {
  beforeEach(async () => {
    await db('activation_audit_events').del();
  });

  it('writes an audit event with derivation version and payload', async () => {
    // assume test user already exists via seeds
    await request(app)
      .get('/api/v1/activation/verdict')
      .expect(200);

    const rows = await db('activation_audit_events')
      .select('*')
      .orderBy('id', 'desc')
      .limit(1);

    expect(rows.length).toBe(1);

    const audit = rows[0];

    expect(audit.verdict).toBeDefined();
    expect(audit.payload).toBeDefined();
    expect(audit.payload).toBeDefined();

    expect(audit.payload.identity).toBeDefined();
    expect(audit.payload.integrations).toBeDefined();
    expect(audit.payload.entitlements).toBeDefined();
  });

  it('writes an audit event when activation is BLOCKED due to missing shop', async () => {
    await request(app)
      .get('/api/v1/activation/verdict')
      .expect(200);

    const rows = await db('activation_audit_events')
      .select('*')
      .orderBy('id', 'desc')
      .limit(1);

    expect(rows.length).toBe(1);

    const audit = rows[0];

    // Core invariant
    expect(audit.verdict).toBe('BLOCKED');

    // Audit must still be complete
    expect(audit.payload).toBeDefined();
    expect(audit.payload.identity).toBeDefined();
    expect(audit.payload.integrations).toBeDefined();
    expect(audit.payload.entitlements).toBeDefined();

    // Reason must exist for blocked states
    expect(audit.reason).toBeDefined();
  });
});
