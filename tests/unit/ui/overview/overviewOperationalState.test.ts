// tests/unit/ui/overview/overviewOperationalState.test.ts
//
// OVERVIEW-LIVE-MAP-01 Slice A — regression coverage for the pure Overview
// operational-state precedence model.

import {
  resolveOverviewOperationalState,
  pendingStowSignal,
  receiveAtDockSignal,
  staleOperatorActivitySignal,
  locationBoundExceptionSignal,
  type OverviewOperationalSignal,
  type OverviewOperationalState,
} from '../../../../apps/frontend/src/pages/overview/overviewOperationalState';

function signal(state: OverviewOperationalState): OverviewOperationalSignal {
  return { state };
}

describe('resolveOverviewOperationalState — precedence contract', () => {
  const cases: Array<{
    name: string;
    signals: OverviewOperationalSignal[];
    expected: OverviewOperationalState;
  }> = [
    {
      name: 'contract 1: critical outranks every other state',
      signals: [
        signal('warning'),
        signal('stale'),
        signal('active'),
        signal('healthy'),
        signal('neutral'),
        signal('critical'),
      ],
      expected: 'critical',
    },
    {
      name: 'contract 2: warning outranks stale/active/healthy/neutral',
      signals: [
        signal('stale'),
        signal('active'),
        signal('healthy'),
        signal('neutral'),
        signal('warning'),
      ],
      expected: 'warning',
    },
    {
      name: 'contract 3: stale outranks active/healthy/neutral',
      signals: [signal('active'), signal('healthy'), signal('neutral'), signal('stale')],
      expected: 'stale',
    },
    {
      name: 'contract 4: active outranks healthy/neutral',
      signals: [signal('healthy'), signal('neutral'), signal('active')],
      expected: 'active',
    },
    {
      name: 'contract 5: healthy outranks neutral',
      signals: [signal('neutral'), signal('healthy')],
      expected: 'healthy',
    },
    {
      name: 'contract 6: no signals resolves to neutral',
      signals: [],
      expected: 'neutral',
    },
  ];

  it.each(cases)('$name', ({ signals, expected }) => {
    expect(resolveOverviewOperationalState(signals)).toBe(expected);
  });
});

describe('resolveOverviewOperationalState — signal-source contracts', () => {
  it('contract 7: pending stow alone resolves to active, never warning/critical', () => {
    const resolved = resolveOverviewOperationalState([pendingStowSignal()]);

    expect(resolved).toBe('active');
    expect(resolved).not.toBe('warning');
    expect(resolved).not.toBe('critical');
  });

  it('contract 8: receive-at-dock alone resolves to active, never warning/critical', () => {
    const resolved = resolveOverviewOperationalState([receiveAtDockSignal()]);

    expect(resolved).toBe('active');
    expect(resolved).not.toBe('warning');
    expect(resolved).not.toBe('critical');
  });

  it('contract 9: stale operator activity alone resolves to stale, never critical', () => {
    const resolved = resolveOverviewOperationalState([staleOperatorActivitySignal()]);

    expect(resolved).toBe('stale');
    expect(resolved).not.toBe('critical');
  });

  it('contract 10: a canonical location-bound exception can resolve to critical', () => {
    const resolved = resolveOverviewOperationalState([locationBoundExceptionSignal()]);

    expect(resolved).toBe('critical');
  });

  it('deterministically resolves regardless of candidate signal order', () => {
    const forward = resolveOverviewOperationalState([
      pendingStowSignal(),
      locationBoundExceptionSignal(),
      staleOperatorActivitySignal(),
    ]);
    const reversed = resolveOverviewOperationalState([
      staleOperatorActivitySignal(),
      locationBoundExceptionSignal(),
      pendingStowSignal(),
    ]);

    expect(forward).toBe('critical');
    expect(reversed).toBe('critical');
  });
});
