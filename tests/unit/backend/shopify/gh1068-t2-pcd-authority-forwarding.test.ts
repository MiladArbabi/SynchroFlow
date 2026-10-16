jest.mock('api-src/services/shopify.service', () => ({
  performInitialSync: jest.fn(),
}));

jest.mock('api-src/services/shopify-fallback.service', () => ({
  performNonPCDSync: jest.fn(),
}));

import { performSmartSync } from
  'api-src/services/shopify-sync-orchestrator.service';

const mockPerformInitialSync =
  jest.requireMock('api-src/services/shopify.service')
    .performInitialSync as jest.Mock;

const mockPerformNonPCDSync =
  jest.requireMock('api-src/services/shopify-fallback.service')
    .performNonPCDSync as jest.Mock;

describe('GH-1068 T2 PCD-02 — fallback authority propagation', () => {
  beforeEach(() => jest.resetAllMocks());

  it('forwards installation identity on PCD denial', async () => {
    const shopDomain = 'pcd-t2.myshopify.com';
    const authority = {
      installationId: 9,
      shopDomain,
      generation: '4',
    };

    mockPerformInitialSync.mockRejectedValueOnce(
      new Error('Protected Customer Data access not approved')
    );
    mockPerformNonPCDSync.mockResolvedValueOnce(undefined);

    await performSmartSync(
      'synthetic-token',
      shopDomain,
      7,
      41,
      authority
    );

    expect(mockPerformNonPCDSync).toHaveBeenCalledWith(
      'synthetic-token',
      shopDomain,
      7,
      41,
      authority
    );
  });
});
