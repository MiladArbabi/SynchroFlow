// tests/unit/backend/customers/customersFt2.controller.test.ts
import request from 'supertest';
import app from 'api-server';

jest.mock('api-src/services/customers-ft2.provider', () => ({
  getCustomersFt2Snapshot: jest.fn().mockResolvedValue({
    context: {
      period: { from: '2024-01-01', to: '2024-01-07' },
      customersObserved: 1
    },
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' }
  })
}));

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (_req: any, _res: any, next: any) => {
    _req.user = { userId: 1, shopId: 1 };
    next();
  }
}));

describe('GET /api/v1/modules/customers/ft2', () => {
  it('returns FT2 snapshot unchanged', async () => {
    const res = await request(app)
      .get('/api/v1/modules/customers/ft2')
      .set('x-test-shop-id', '1');

    expect(res.status).toBe(200);
    expect(res.body.context.customersObserved).toBe(1);
    expect(res.body.outcome.status).toBe('positive');
  });
});