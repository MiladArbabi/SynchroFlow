import { getActivationVerdict } from 'api-src/api/activation/activation.controller';
import db from 'api-src/db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import {
  ModuleOnboardingReadiness,
  OnboardingReadinessSnapshot,
} from '@lasyncro/shared';

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

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

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

describe('Activation Verdict Controller', () => {
  const mockDbInstance = (db as any)();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when unauthenticated', async () => {
    const req = { user: null };
    const res = mockRes();

    await getActivationVerdict(req as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns BLOCKED / NOT_CONNECTED when user has no shop', async () => {
    mockDbInstance.first.mockResolvedValueOnce(null);

    const req = { user: { userId: 1 } };
    const res = mockRes();

    await getActivationVerdict(req as any, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'BLOCKED',
        reason: 'NOT_CONNECTED',
      })
    );
  });

  test('returns INTEGRATION_COMPLETE_NOT_READY when readiness incomplete', async () => {
    mockDbInstance.first
      .mockResolvedValueOnce({ shop_id: 1 }) // users
      .mockResolvedValueOnce({ id: 10, sync_status: 'COMPLETED' }); // integrations

    jest
    .spyOn(OnboardingReadinessService.prototype, 'getSnapshot')
    .mockResolvedValue(
      mockReadinessSnapshot({
        modules: [
          mockModule({ isReady: false }),
        ],
      })
    );


    const req = { user: { userId: 1 } };
    const res = mockRes();

    await getActivationVerdict(req as any, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'INTEGRATION_COMPLETE_NOT_READY',
      })
    );
  });

  test('returns ACTIVE when integration and readiness complete', async () => {
    mockDbInstance.first
      .mockResolvedValueOnce({ shop_id: 1 })
      .mockResolvedValueOnce({ id: 10, sync_status: 'COMPLETED' });

    jest
    .spyOn(OnboardingReadinessService.prototype, 'getSnapshot')
    .mockResolvedValue(
      mockReadinessSnapshot({
        modules: [
          mockModule({ isReady: true }),
        ],
      })
    );

    const req = { user: { userId: 1 } };
    const res = mockRes();

    await getActivationVerdict(req as any, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'ACTIVE',
        activatedModules: ['order-nexus'],
      })
    );
  });
});
