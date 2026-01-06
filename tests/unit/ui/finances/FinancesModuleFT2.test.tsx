//tests/unit/ui/finances/FinancesModuleFT2.test.tsx
import { render, screen } from '@testing-library/react';
import {
  FinancesModuleFT2,
  FinancesModuleFT2Props,
} from '@lasyncro/finances';

describe('FinancesModuleFT2', () => {
  const baseProps: FinancesModuleFT2Props = {
    context: {
      period: { from: '2025-01-01', to: '2025-01-31' },
      transactionsAnalyzed: 1200,
    },

    costSummary: {
      totalRevenue: 50000,
      totalCost: 42000,
      netResult: 8000,
      currency: 'USD',
    },

    costBreakdown: [
      {
        type: 'cogs',
        amount: 25000,
        pctOfRevenue: 50,
      },
    ],

    dominantPressure: {
      type: 'cogs',
      confidence: 'high',
    },

    timeSignal: {
      trend: 'stable',
    },
  };

  it('renders core financial context deterministically', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/2025-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/1200/i)).toBeInTheDocument();
    expect(screen.getByText(/50000/i)).toBeInTheDocument();
    expect(screen.getByText(/8000/i)).toBeInTheDocument();
  });

  it('renders placeholders when values are null', () => {
    render(
      <FinancesModuleFT2
        {...baseProps}
        context={{
          ...baseProps.context,
          transactionsAnalyzed: null,
        }}
        costBreakdown={null}
        dominantPressure={null}
        timeSignal={null}
      />
    );

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders cost breakdown rows when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getAllByText(/cogs/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/50%/i)).toBeInTheDocument();
  });

  it('renders dominant pressure confidence when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/high/i)).toBeInTheDocument();
  });

  it('renders trend signal when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/stable/i)).toBeInTheDocument();
  });
});