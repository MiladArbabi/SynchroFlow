// tests/unit/ui/customers/CustomersModuleFT2.test.tsx

import { render, screen } from '@testing-library/react';
import {
  CustomersModuleFT2,
  CustomersModuleFT2Props,
} from '@lasyncro/customers';

describe('CustomersModuleFT2', () => {
  const baseProps: CustomersModuleFT2Props = {
    context: {
      period: { from: '2025-01-01', to: '2025-01-31' },
      sessionsObserved: 240,
    },

    systemState: {
      status: 'healthy',
      confidence: 'high',
    },

    timeSignal: {
      trend: 'stable',
    },
  };

  it('renders core customer context deterministically', () => {
    render(<CustomersModuleFT2 {...baseProps} />);

    expect(screen.getByText(/2025-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/240/i)).toBeInTheDocument(); // sessions observed
    expect(screen.getByText(/healthy/i)).toBeInTheDocument();
  });

  it('renders placeholders when values are null', () => {
    render(
      <CustomersModuleFT2
        {...baseProps}
        context={{
          ...baseProps.context,
          sessionsObserved: null,
        }}
        systemState={null}
        timeSignal={null}
      />
    );

    expect(
    screen.getAllByText((_, node) => 
      node?.textContent?.includes('—') ?? false)
        .length
    ).toBeGreaterThan(0);
  });

  it('renders trend signal when present', () => {
    render(<CustomersModuleFT2 {...baseProps} />);

    expect(screen.getByText(/stable/i)).toBeInTheDocument();
  });
});