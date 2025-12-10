// tests/unit/specter/shopify-sync-orchestrator.test.ts

describe('shopify-sync-orchestrator performSmartSync', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('calls performInitialSync and appends sync.complete on success', async () => {
    const performInitialSync = jest.fn().mockResolvedValue(undefined);
    const performNonPCDSync = jest.fn();
    const appendEvent = jest.fn().mockResolvedValue(undefined);

    jest.doMock('api-src/services/shopify.service', () => ({ performInitialSync }));
    jest.doMock('api-src/services/shopify-fallback.service', () => ({ performNonPCDSync }));
    jest.doMock('../../../modules/specter/src/store/session-store', () => ({ appendEvent }));

    const { performSmartSync } = await import('api-src/services/shopify-sync-orchestrator.service');

    await performSmartSync('token', 'shopName', 42, 99);

    expect(performInitialSync).toHaveBeenCalledWith('token', 'shopName', 42, 99);
    expect(performNonPCDSync).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledWith(42, expect.objectContaining({ type: 'sync.complete', integrationId: 99 }));
  });

  test('falls back to performNonPCDSync when PCD error occurs and appends sync.complete after fallback', async () => {
    const pcdErr = new Error('not approved to access the Order object');
    const performInitialSync = jest.fn().mockRejectedValue(pcdErr);
    const performNonPCDSync = jest.fn().mockResolvedValue(undefined);
    const appendEvent = jest.fn().mockResolvedValue(undefined);

    jest.doMock('api-src/services/shopify.service', () => ({ performInitialSync }));
    jest.doMock('api-src/services/shopify-fallback.service', () => ({ performNonPCDSync }));
    jest.doMock('../../../modules/specter/src/store/session-store', () => ({ appendEvent }));

    const { performSmartSync } = await import('api-src/services/shopify-sync-orchestrator.service');

    await performSmartSync('token', 'shopName', 43, 100);

    expect(performInitialSync).toHaveBeenCalledWith('token', 'shopName', 43, 100);
    expect(performNonPCDSync).toHaveBeenCalledWith('token', 'shopName', 43, 100);
    expect(appendEvent).toHaveBeenCalledWith(43, expect.objectContaining({ type: 'sync.complete', integrationId: 100, fallback: true }));
  });

  test('appends sync.error and rethrows non-PCD errors', async () => {
    const otherErr = new Error('some network error');
    const performInitialSync = jest.fn().mockRejectedValue(otherErr);
    const performNonPCDSync = jest.fn();
    const appendEvent = jest.fn().mockResolvedValue(undefined);

    jest.doMock('api-src/services/shopify.service', () => ({ performInitialSync }));
    jest.doMock('api-src/services/shopify-fallback.service', () => ({ performNonPCDSync }));
    jest.doMock('../../../modules/specter/src/store/session-store', () => ({ appendEvent }));

    const { performSmartSync } = await import('api-src/services/shopify-sync-orchestrator.service');

    await expect(performSmartSync('token', 'shopName', 44, 101)).rejects.toThrow('some network error');

    expect(appendEvent).toHaveBeenCalledWith(44, expect.objectContaining({ type: 'sync.error', error: expect.any(Object) }));
  });
});