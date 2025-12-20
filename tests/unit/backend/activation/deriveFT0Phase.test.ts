//tests/unit/backend/activation/deriveFT0Phase.test.ts
import { deriveFT0Phase } from '@lasyncro/shared/activation/deriveFT0Phase';

describe('deriveFT0Phase', () => {
  it('returns PRE_INTEGRATION when there are no integrations', () => {
    const result = deriveFT0Phase([]);
    expect(result).toBe('PRE_INTEGRATION');
  });

  it('returns SYNCING when integration is NOT_STARTED', () => {
    const result = deriveFT0Phase([
      { platform: 'shopify', syncStatus: 'NOT_STARTED' },
    ]);
    expect(result).toBe('SYNCING');
  });

  it('returns SYNCING when integration is IN_PROGRESS', () => {
    const result = deriveFT0Phase([
      { platform: 'shopify', syncStatus: 'IN_PROGRESS' },
    ]);
    expect(result).toBe('SYNCING');
  });

  it('returns SYNCING when integration is FAILED', () => {
    const result = deriveFT0Phase([
      { platform: 'shopify', syncStatus: 'FAILED' },
    ]);
    expect(result).toBe('SYNCING');
  });

  it('returns RESOLVED when integration is COMPLETED', () => {
    const result = deriveFT0Phase([
      { platform: 'shopify', syncStatus: 'COMPLETED' },
    ]);
    expect(result).toBe('RESOLVED');
  });

  it('returns RESOLVED when at least one integration is COMPLETED', () => {
    const result = deriveFT0Phase([
      { platform: 'shopify', syncStatus: 'IN_PROGRESS' },
      { platform: 'stripe', syncStatus: 'COMPLETED' },
    ]);
    expect(result).toBe('RESOLVED');
  });

  it('returns SYNCING when multiple integrations exist but none are COMPLETED', () => {
    const result = deriveFT0Phase([
      { platform: 'shopify', syncStatus: 'FAILED' },
      { platform: 'stripe', syncStatus: 'IN_PROGRESS' },
    ]);
    expect(result).toBe('SYNCING');
  });
});