import { devReadinessOverrideProvider } from 'api-src/onboarding/providers/dev-readiness.provider';

describe('devReadinessOverrideProvider', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const HAD_OVERRIDE_FLAG = Object.prototype.hasOwnProperty.call(
    process.env,
    'DEV_READINESS_OVERRIDE_ENABLED'
  );
  const ORIGINAL_OVERRIDE_FLAG = process.env.DEV_READINESS_OVERRIDE_ENABLED;

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
      delete (process.env as { NODE_ENV?: string }).NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }

    if (!HAD_OVERRIDE_FLAG) {
      delete process.env.DEV_READINESS_OVERRIDE_ENABLED;
    } else {
      process.env.DEV_READINESS_OVERRIDE_ENABLED = ORIGINAL_OVERRIDE_FLAG;
    }
  });

  it('returns [] when DEV_READINESS_OVERRIDE_ENABLED is absent, even in development', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_READINESS_OVERRIDE_ENABLED;

    const signals = await devReadinessOverrideProvider.getSignals({ shopId: 1 });

    expect(signals).toEqual([]);
  });

  it("returns [] when DEV_READINESS_OVERRIDE_ENABLED='false', even in development", async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_READINESS_OVERRIDE_ENABLED = 'false';

    const signals = await devReadinessOverrideProvider.getSignals({ shopId: 1 });

    expect(signals).toEqual([]);
  });

  it("returns exactly the synthetic platform signals when NODE_ENV='development' and DEV_READINESS_OVERRIDE_ENABLED='true'", async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_READINESS_OVERRIDE_ENABLED = 'true';

    const signals = await devReadinessOverrideProvider.getSignals({ shopId: 1 });

    expect(signals).toEqual([
      { name: 'integration.connected', value: true },
      { name: 'integration.syncCompleted', value: true },
    ]);
  });

  it("returns [] in production even when DEV_READINESS_OVERRIDE_ENABLED='true'", async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_READINESS_OVERRIDE_ENABLED = 'true';

    const signals = await devReadinessOverrideProvider.getSignals({ shopId: 1 });

    expect(signals).toEqual([]);
  });
});
