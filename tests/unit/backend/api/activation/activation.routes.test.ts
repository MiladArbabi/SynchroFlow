import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db from 'api-src/db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import {
  ModuleOnboardingReadiness,
  OnboardingReadinessSnapshot,
} from '@lasyncro/shared';

// ─────────────────────────────────────────────
// DB mock — SAME SHAPE as controller test
// ─────────────────────────────────────────────
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    first: jest.fn(),
  };

  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn() };

  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn,
  };
});

// ─────────────────────────────────────────────
// Auth middleware mock — explicit & predictable
// ─────────────────────────────────────────────
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = { userId: 1 };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  },
}));

// ─────────────────────────────────────────────
// Shopify Service mock
// ─────────────────────────────────────────────

jest.mock('api-src/services/shopify-app.service', () => ({
  __esModule: true,
  ShopifyAppService: {
    completePostInstallation: jest.fn(),
    createAppInstallation: jest.fn(),
    updateAccessToken: jest.fn(),
  },
}));


// ─────────────────────────────────────────────
// Helpers (mirrored from controller test)
// ─────────────────────────────────────────────
const mockModule = (
  overrides: Partial<ModuleOnboardingReadiness>
): ModuleOnboardingReadiness => ({
  moduleId: 'order-nexus',
  displayName: 'Order Nexus',
  requiredSignals: [],
  tasks: [],
  signals: [],
  isReady: false,
  ...overrides,
});

const mockReadinessSnapshot = (
  overrides?: Partial<OnboardingReadinessSnapshot>
): OnboardingReadinessSnapshot => ({
  shopId: 1,
  modules: [],
  ...overrides,
});

describe('GET /api/v1/activation/verdict (route)', () => {
  const app = createApp();
  const mockDbInstance = (db as any)();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/activation/verdict');

    expect(res.status).toBe(401);
  });

  test('returns INTEGRATION_COMPLETE_NOT_READY when readiness incomplete', async () => {
    mockDbInstance.first
      .mockResolvedValueOnce({ shop_id: 1 }) // users
      .mockResolvedValueOnce({ id: 10, sync_status: 'COMPLETED' }); // integrations

    jest
      .spyOn(OnboardingReadinessService.prototype, 'getSnapshot')
      .mockResolvedValue(
        mockReadinessSnapshot({
          modules: [mockModule({ isReady: false })],
        })
      );

    const res = await request(app)
      .get('/api/v1/activation/verdict')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('INTEGRATION_COMPLETE_NOT_READY');
  });

  test('returns ACTIVE when integration and readiness complete', async () => {
    mockDbInstance.first
      .mockResolvedValueOnce({ shop_id: 1 })
      .mockResolvedValueOnce({ id: 10, sync_status: 'COMPLETED' });

    jest
      .spyOn(OnboardingReadinessService.prototype, 'getSnapshot')
      .mockResolvedValue(
        mockReadinessSnapshot({
          modules: [mockModule({ isReady: true })],
        })
      );

    const res = await request(app)
      .get('/api/v1/activation/verdict')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        verdict: 'ACTIVE',
        activatedModules: ['order-nexus'],
      })
    );
  });
});
