// tests/integration/specter-store.bootstrap.test.ts
// Verifies initSpecterStore() / closeSpecterStore() call the redis-backed init/close helpers.

jest.resetModules();

const mockInit = jest.fn(async () => ({ mock: true }));
const mockClose = jest.fn(async () => {});

// Mock the redis store module BEFORE importing the bootstrap wrapper.
jest.mock('modules-specter/store/session-store-redis', () => ({
  initRedisSessionStore: mockInit,
  closeRedisSessionStore: mockClose
}));

describe('specter-store bootstrap wiring', () => {
  beforeEach(() => {
    // ensure env isolation
    delete process.env.SPECTER_SESSION_STORE;
    delete process.env.SPECTER_REDIS_URL;
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('does not init when SPECTER_SESSION_STORE not set and no REDIS_URL', async () => {
    // import AFTER reset/mocks
    const { initSpecterStore, closeSpecterStore } = await import('../../../apps/backend/src/bootstrap/specter-store');
    await initSpecterStore();
    expect(mockInit).not.toHaveBeenCalled();
    await closeSpecterStore();
    expect(mockClose).not.toHaveBeenCalled();
  });

  test('initializes and closes when SPECTER_SESSION_STORE=redis', async () => {
    process.env.SPECTER_SESSION_STORE = 'redis';
    const { initSpecterStore, closeSpecterStore } = await import('../../../apps/backend/src/bootstrap/specter-store');
    await initSpecterStore();
    expect(mockInit).toHaveBeenCalledTimes(1);
    // idempotency: second init should be a no-op
    await initSpecterStore();
    expect(mockInit).toHaveBeenCalledTimes(1);

    await closeSpecterStore();
    expect(mockClose).toHaveBeenCalledTimes(1);
    // second close should be a no-op
    await closeSpecterStore();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  test('initializes when REDIS_URL present even if SPECTER_SESSION_STORE unset', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { initSpecterStore, closeSpecterStore } = await import('../../../apps/backend/src/bootstrap/specter-store');
    await initSpecterStore();
    expect(mockInit).toHaveBeenCalledTimes(1);
    await closeSpecterStore();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
