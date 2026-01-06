// tests/unit/ui/pages/customers/useCustomersFt2Adapter.test.ts

import { mapCustomersFt2Props } from 'ui/src/pages/customers/useCustomersFt2Adapter';

describe('FT2 Customers Adapter - mapCustomersFt2Props', () => {
  it('maps a full backend snapshot without inference', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      sessionsObserved: 120,

      systemState: {
        status: 'healthy',
        confidence: 'high',
      },

      timeSignal: {
        trend: 'stable',
      },
    } as const satisfies Parameters<typeof mapCustomersFt2Props>[0];

    const props = mapCustomersFt2Props(snapshot);

    expect(props.context.sessionsObserved).toBe(120);
    expect(props.systemState?.status).toBe('healthy');
    expect(props.timeSignal?.trend).toBe('stable');
  });

  it('preserves explicit nulls without coercion', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      sessionsObserved: null,
      systemState: null,
      timeSignal: null,
    };

    const props = mapCustomersFt2Props(snapshot);

    expect(props.context.sessionsObserved).toBeNull();
    expect(props.systemState).toBeNull();
    expect(props.timeSignal).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapCustomersFt2Props(snapshot);

    expect(props.context.sessionsObserved).toBeNull();
    expect(props.systemState).toBeNull();
    expect(props.timeSignal).toBeNull();
  });
});