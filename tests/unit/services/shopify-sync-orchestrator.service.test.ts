// tests/unit/services/shopify-sync-orchestrator.service.test.ts
import { performSmartSync } from 'api-src/services/shopify-sync-orchestrator.service';

const mockPerformInitialSync = jest.fn();
const mockPerformNonPCDSync = jest.fn();

jest.mock('api-src/services/shopify.service', () => ({
  performInitialSync: (...args: any[]) => mockPerformInitialSync(...args),
}));

jest.mock('api-src/services/shopify-fallback.service', () => ({
  performNonPCDSync: (...args: any[]) => mockPerformNonPCDSync(...args),
}));

describe('ShopifySyncOrchestrator - performSmartSync', () => {
  const accessToken = 'test-access-token';
  const platformShopName = 'test-shop.myshopify.com';
  const shopId = 1;
  const integrationId = 123;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses performInitialSync on happy path and does not call fallback', async () => {
    mockPerformInitialSync.mockResolvedValueOnce(undefined);

    await performSmartSync(accessToken, platformShopName, shopId, integrationId);

    expect(mockPerformInitialSync).toHaveBeenCalledTimes(1);
    expect(mockPerformInitialSync).toHaveBeenCalledWith(
      accessToken,
      platformShopName,
      shopId,
      integrationId
    );
    expect(mockPerformNonPCDSync).not.toHaveBeenCalled();
  });

  it('falls back to non-PCD sync when error message contains "Protected Customer Data"', async () => {
    mockPerformInitialSync.mockRejectedValueOnce(
      new Error('Access denied: Protected Customer Data is not approved for this app')
    );

    await performSmartSync(accessToken, platformShopName, shopId, integrationId);

    expect(mockPerformInitialSync).toHaveBeenCalledTimes(1);
    expect(mockPerformNonPCDSync).toHaveBeenCalledTimes(1);
    expect(mockPerformNonPCDSync).toHaveBeenCalledWith(
      accessToken,
      platformShopName,
      shopId,
      integrationId
    );
  });

  it('falls back to non-PCD sync when error message contains "not approved to access the Order object"', async () => {
    mockPerformInitialSync.mockRejectedValueOnce(
      new Error('Your app is not approved to access the Order object in this store')
    );

    await performSmartSync(accessToken, platformShopName, shopId, integrationId);

    expect(mockPerformInitialSync).toHaveBeenCalledTimes(1);
    expect(mockPerformNonPCDSync).toHaveBeenCalledTimes(1);
    expect(mockPerformNonPCDSync).toHaveBeenCalledWith(
      accessToken,
      platformShopName,
      shopId,
      integrationId
    );
  });

  it('rethrows non-PCD-related errors and does not call fallback', async () => {
    const networkError = new Error('Network failure: ECONNRESET');
    mockPerformInitialSync.mockRejectedValueOnce(networkError);

    await expect(
      performSmartSync(accessToken, platformShopName, shopId, integrationId)
    ).rejects.toBe(networkError);

    expect(mockPerformInitialSync).toHaveBeenCalledTimes(1);
    expect(mockPerformNonPCDSync).not.toHaveBeenCalled();
  });
});
