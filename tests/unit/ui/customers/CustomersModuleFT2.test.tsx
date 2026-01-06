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
      customersAnalyzed: 240,
    },

    valueSummary: {
      activeCustomers: 180,
      repeatRatePct: 45,
      avgOrderValue: 82,
      lifetimeValue: 320,
      currency: 'USD',
    },

    qualitySignal: {
      type: 'low_repeat',
      confidence: 'high',
    },

    timeSignal: {
      trend: 'stable',
    },
  };

  it('renders core customer context deterministically', () => {
    render(<CustomersModuleFT2 {...baseProps} />);

    expect(screen.getByText(/2025-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/240/i)).toBeInTheDocument();
    expect(screen.getByText(/180/i)).toBeInTheDocument();
    expect(screen.getByText(/45%/i)).toBeInTheDocument();
  });

  it('renders placeholders when values are null', () => {
    render(
      <CustomersModuleFT2
        {...baseProps}
        context={{
          ...baseProps.context,
          customersAnalyzed: null,
        }}
        qualitySignal={null}
        timeSignal={null}
      />
    );

    expect(
    screen.getAllByText((_, node) => 
      node?.textContent?.includes('—') ?? false)
        .length
    ).toBeGreaterThan(0);
  });

  it('renders customer value summary when present', () => {
    render(<CustomersModuleFT2 {...baseProps} />);

    expect(screen.getByText(/82/i)).toBeInTheDocument();
    expect(screen.getByText(/320/i)).toBeInTheDocument();
    expect(screen.getAllByText(/USD/i).length).toBeGreaterThan(0);
  });

  it('renders quality signal with confidence when present', () => {
    render(<CustomersModuleFT2 {...baseProps} />);

    expect(screen.getByText(/low_repeat/i)).toBeInTheDocument();
    expect(screen.getByText(/high/i)).toBeInTheDocument();
  });

  it('renders trend signal when present', () => {
    render(<CustomersModuleFT2 {...baseProps} />);

    expect(screen.getByText(/stable/i)).toBeInTheDocument();
  });
});