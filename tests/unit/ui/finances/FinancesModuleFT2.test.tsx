// tests/unit/ui/finances/FinancesModuleFT2.test.tsx

import { render, screen } from '@testing-library/react';
import {
  FinancesModuleFT2,
  FinancesModuleFT2Props,
} from '@lasyncro/finances';

describe('FinancesModuleFT2 (FT2 Observability Snapshot)', () => {
  const baseProps: FinancesModuleFT2Props = {
    context: {
      period: { from: '2025-01-01', to: '2025-01-31' },
      transactionsObserved: 1200,
    },

    costModelState: {
      hasActiveModel: true,
      updatedAt: '2025-01-15T12:00:00Z',
      currency: 'USD',
    },

    timeSignal: {
      trend: 'stable',
    },
  };

  it('renders context deterministically', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/2025-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/2025-01-31/i)).toBeInTheDocument();
    expect(screen.getByText(/1200/i)).toBeInTheDocument();
  });

  it('renders cost model status without interpretation', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/cost model status/i)).toBeInTheDocument();
    expect(screen.getByText(/yes/i)).toBeInTheDocument(); // active model
    expect(screen.getByText(/2025-01-15/i)).toBeInTheDocument();
    expect(screen.getByText(/USD/i)).toBeInTheDocument();
  });

  it('renders placeholders for unknown cost model state', () => {
    render(
      <FinancesModuleFT2
        {...baseProps}
        costModelState={null}
      />
    );

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders trend signal when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/stable/i)).toBeInTheDocument();
  });

  it('renders placeholder when trend is unknown', () => {
    render(
      <FinancesModuleFT2
        {...baseProps}
        timeSignal={null}
      />
    );

    const trendSection = screen.getByText(/trend/i).parentElement;
    expect(trendSection).toBeTruthy();
    expect(trendSection!.textContent).toContain('—');
  });

  /**
   * Doctrine guard:
   * These terms must NEVER appear in FT2.
   * If this test fails, intelligence has leaked.
   */
  it('does not render forbidden financial intelligence', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    const forbiddenTerms = [
      /revenue/i,
      /margin/i,
      /profit/i,
      /net result/i,
      /breakdown/i,
      /dominant/i,
      /pressure/i,
      /confidence/i,
      /%/,
    ];

    forbiddenTerms.forEach((term) => {
      expect(screen.queryByText(term)).toBeNull();
    });
  });
});