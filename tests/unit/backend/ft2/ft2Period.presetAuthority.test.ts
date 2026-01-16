// tests/unit/backend/ft2/ft2Period.presetAuthority.test.ts

import { resolveFt2PeriodFromPreset } from 'api-src/utils/ft2Period';

describe('FT2 period resolver — preset authority', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-16T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves past_7_days deterministically', () => {
    const period = resolveFt2PeriodFromPreset({
      preset: 'past_7_days',
    });

    expect(period).toEqual({
      from: '2026-01-09T12:00:00.000Z',
      to: '2026-01-16T12:00:00.000Z',
    });
  });

  it('resolves today as UTC day boundaries', () => {
    const period = resolveFt2PeriodFromPreset({
      preset: 'today',
    });

    expect(period).toEqual({
      from: '2026-01-16T00:00:00.000Z',
      to: '2026-01-16T23:59:59.999Z',
    });
  });

  it('resolves this_month from UTC month start', () => {
    const period = resolveFt2PeriodFromPreset({
      preset: 'this_month',
    });

    expect(period).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-16T12:00:00.000Z',
    });
  });

  it('throws on unsupported preset', () => {
    expect(() =>
      resolveFt2PeriodFromPreset({
        preset: 'custom' as any,
      })
    ).toThrow('Unsupported FT2 preset');
  });
});