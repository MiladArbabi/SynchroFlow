// tests/unit/specter/specter-fallback-manager.test.ts
import { SpecterCustomerSignal } from '../../../modules/specter/src/public/specter-customer-intelligence-service';
import { CustomerSignalResult } from '../../../modules/specter/src/resilience/specter-fallback-manager';

describe('SpecterFallbackManager (red tests)', () => {
  const shopId = 42;
  const hashedCustomerId = 'hash-abc-123';

  it('returns a CustomerSignalResult shape with default source when no integrations present', async () => {
    // We expect a SpecterFallbackManager to expose getCustomerSignalWithFallbacks(shopId, hashedCustomerId)
    // and return an object matching CustomerSignalResult:
    //
    // {
    //   signal: SpecterCustomerSignal,
    //   source: 'default' | 'fallback' | 'specter',
    //   confidence: number,
    //   dataSources: { orderNexus: boolean; sku-os: boolean; finance: boolean }
    // }
    //
    // This is a red test: implementation will be added after we assert the contract.

    // dynamic import to allow isolated module mocking later
    const mod = await import('../../../modules/specter/src/resilience/specter-fallback-manager').catch(() => null);

    // The module should export SpecterFallbackManager class. If it doesn't exist yet, fail the test.
    expect(mod).not.toBeNull();

    const { SpecterFallbackManager } = mod as any;

    // If the class doesn't exist, we expect the test to be red (fail). If it exists, we continue to call it.
    expect(typeof SpecterFallbackManager).toBe('function');

    const mgr = new SpecterFallbackManager();

    // call the method (may throw if not implemented) — wrap to assert shape rather than values
    const result: CustomerSignalResult = await mgr.getCustomerSignalWithFallbacks(shopId, hashedCustomerId);

    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('source');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('dataSources');

    // signal should match minimal SpecterCustomerSignal fields
    const s = result.signal as SpecterCustomerSignal;
    expect(s).toHaveProperty('shopId');
    expect(s).toHaveProperty('hashedCustomerId');
    expect(s).toHaveProperty('specterCustomerTier');
    expect(s).toHaveProperty('predictedLTV');
    expect(s).toHaveProperty('updatedAt');

    // source should be one of the allowed values
    expect(['default', 'fallback', 'specter']).toContain(result.source);

    // confidence is a number between 0 and 1
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);

    // dataSources should contain booleans
    expect(result.dataSources).toHaveProperty('orderNexus');
   /*  expect(result.dataSources).toHaveProperty('sku-os'); */
    expect(result.dataSources).toHaveProperty('finance');
    expect(typeof result.dataSources.orderNexus).toBe('boolean');
  });

  it('prefers OrderNexus enrichment when module presence indicates orderNexus=true', async () => {
    // This test will be wired later with a mocked modulePresenceManager and orderNexus client.
    // For now it asserts that the method exists and can be called with different shopIds.
    const mod = await import('../../../modules/specter/src/resilience/specter-fallback-manager').catch(() => null);
    expect(mod).not.toBeNull();

    const { SpecterFallbackManager } = mod as any;
    expect(typeof SpecterFallbackManager).toBe('function');

    const mgr = new SpecterFallbackManager();

    // call again — the behavior will be validated by later tests/mocks.
    const result = await mgr.getCustomerSignalWithFallbacks(shopId + 1, hashedCustomerId);
    expect(result).toHaveProperty('source');
    expect(['default', 'fallback', 'specter']).toContain(result.source);
  });
});
