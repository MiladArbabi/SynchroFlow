// tests/unit/backend/utils/ft2Period.custom.test.ts
import {
  resolveFt2PeriodFromPreset,
} from 'api-src/utils/ft2Period';

describe('ft2Period — custom preset', () => {
  it('accepts a valid custom date range', () => {
    const result = resolveFt2PeriodFromPreset({
      preset: 'custom',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-31T23:59:59.999Z',
    });

    expect(result).toEqual({
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-31T23:59:59.999Z',
    });
  });

  it('throws if from is not a valid ISO date', () => {
    expect(() =>
      resolveFt2PeriodFromPreset({
        preset: 'custom',
        from: 'NOT_A_DATE',
        to: '2024-01-31T23:59:59.999Z',
      })
    ).toThrow('Invalid custom FT2 date range');
  });

  it('throws if to is not a valid ISO date', () => {
    expect(() =>
      resolveFt2PeriodFromPreset({
        preset: 'custom',
        from: '2024-01-01T00:00:00.000Z',
        to: 'INVALID',
      })
    ).toThrow('Invalid custom FT2 date range');
  });

  it('throws if from is equal to to', () => {
    expect(() =>
      resolveFt2PeriodFromPreset({
        preset: 'custom',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-01T00:00:00.000Z',
      })
    ).toThrow('FT2 custom range requires from < to');
  });

  it('throws if from is after to', () => {
    expect(() =>
      resolveFt2PeriodFromPreset({
        preset: 'custom',
        from: '2024-02-01T00:00:00.000Z',
        to: '2024-01-01T00:00:00.000Z',
      })
    ).toThrow('FT2 custom range requires from < to');
  });
});