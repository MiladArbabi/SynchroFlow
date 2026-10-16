jest.mock('@lasyncro/backend-core/db.js', () => ({
  withTenant: jest.fn(),
}));

jest.mock('@shopify/shopify-api', () => ({
  shopifyApi: jest.fn(() => ({ clients: {} })),
  Session: jest.fn(),
  LogSeverity: { Warning: 3 },
}));

jest.mock('@shopify/shopify-api/adapters/node', () => ({}));

import { performNonPCDSync } from
  'api-src/services/shopify-fallback.service';

const mockWithTenant =
  jest.requireMock('@lasyncro/backend-core/db.js')
    .withTenant as jest.Mock;

describe('GH-1068 T2 PCD-01 — disabled fallback is fail-closed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects without any direct database write', async () => {
    const shopDomain = 'pcd-t2.myshopify.com';
    const authority = {
      installationId: 9,
      shopDomain,
      generation: '4',
    };

    await expect(
      (performNonPCDSync as any)(
        'synthetic-token',
        shopDomain,
        7,
        41,
        authority
      )
    ).rejects.toThrow(
      'SHOPIFY_FALLBACK_SYNC_DISABLED_ARCHITECTURE_GUARD'
    );

    expect(mockWithTenant).not.toHaveBeenCalled();
  });
});
