// tests/unit/backend/onboarding/deriveKnownCount.test.ts

import { deriveKnownCount } from 'api-src/onboarding/utils/deriveKnownCount';

describe('deriveKnownCount', () => {
  it('returns known=false when rawCount is not a finite number', () => {
    const result = deriveKnownCount(undefined);

    expect(result).toEqual({
      known: false,
      count: null,
      usageCount: 0,
    });
  });

  it('returns known=true with count=0 when rawCount is "0"', () => {
    const result = deriveKnownCount('0');

    expect(result).toEqual({
      known: true,
      count: 0,
      usageCount: 0,
    });
  });

  it('returns known=true with count>0 when rawCount is numeric', () => {
    const result = deriveKnownCount('3');

    expect(result).toEqual({
      known: true,
      count: 3,
      usageCount: 3,
    });
  });
});