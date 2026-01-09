import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';

describe('DEV readiness override (FT1)', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('forces FT1 readiness in development via dev override signals', async () => {
    const service = new OnboardingReadinessService();

    const snapshot = await service.getSnapshot({
      shopId: 999, // arbitrary, no DB dependency intended
      userId: 999,
    });

    // --- REQUIRED DEV OVERRIDE SIGNALS ---
    const signals = snapshot.modules.flatMap(m => m.signals);

    const syncCompleted = signals.find(
      s => s.name === 'integration.syncCompleted'
    );

    const analyticsReady = signals.find(
      s => s.name === 'analytics.baseSignalsReady'
    );

    expect(syncCompleted?.value).toBe(true);
    expect(analyticsReady?.value).toBe(true);

    // --- FT1 VERDICT ---
    expect(snapshot.ft1.isComplete).toBe(true);
  });
});