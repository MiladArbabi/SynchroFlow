import request from 'supertest';
import { createLifecycleTestApp } from 'api-src/api/lifecycle/__tests__/createLifecycleTestApp';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';

jest.mock('api-src/services/lifecycle-transition.service');

// ─────────────────────────────────────────────
// MOCK AUTH MIDDLEWARE (WITH shop_id)
// ─────────────────────────────────────────────
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 1, shop_id: 10 };
    next();
  },
}));

// ─────────────────────────────────────────────
// MOCK LIFECYCLE SERVICE
// ─────────────────────────────────────────────
jest.mock('api-src/services/lifecycle.service', () => ({
  LifecycleService: {
    resolveForUser: jest.fn(),
  },
}));

jest.mock('api-src/services/shop-resolution.service', () => ({
  requireShopContextForUser: jest.fn().mockResolvedValue({ shopId: 10 }),
}));

describe('GET /api/v1/lifecycle (unit)', () => {
  const app = createLifecycleTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns FT1 and audits lifecycle transition', async () => {
    (LifecycleService.resolveForUser as jest.Mock).mockResolvedValue('FT1');

    const res = await request(app).get('/api/v1/lifecycle');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phase: 'FT1' });

    expect(LifecycleTransitionService.auditIfTransitioned)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          shopId: 10,
          currentPhase: 'FT1',
        })
      );
  });

  it('returns FT0 when lifecycle service resolves FT0', async () => {
    (LifecycleService.resolveForUser as jest.Mock).mockResolvedValue('FT0');

    const res = await request(app).get('/api/v1/lifecycle');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phase: 'FT0' });
  });

  it('returns FT2 when lifecycle service resolves FT2', async () => {
    (LifecycleService.resolveForUser as jest.Mock).mockResolvedValue('FT2');

    const res = await request(app).get('/api/v1/lifecycle');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phase: 'FT2' });
  });

  it('returns 500 when lifecycle service throws', async () => {
    (LifecycleService.resolveForUser as jest.Mock).mockRejectedValue(
      new Error('boom')
    );

    const res = await request(app).get('/api/v1/lifecycle');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to resolve lifecycle' });
  });
});
