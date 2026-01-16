import request from 'supertest';
import app from 'api-server';

jest.useFakeTimers().setSystemTime(
  new Date('2026-01-16T12:00:00.000Z')
);
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (_req: any, _res: any, next: any) => {
    _req.user = { shopId: 123 };
    next();
  },
}));
jest.mock('api-src/middleware/require-ft2.middleware', () => ({
  requireFt2: (_req: any, _res: any, next: any) => next(),
}));

describe('Orders FT2 controller — preset authority', () => {
  it('resolves period from preset (not from/to)', async () => {
    const res = await request(app)
      .get('/api/v1/modules/order-nexus/ft2')
      .query({ preset: 'past_7_days' })
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);

    expect(res.body.context.period).toEqual({
      from: '2026-01-09T12:00:00.000Z',
      to: '2026-01-16T12:00:00.000Z',
    });
  });
});