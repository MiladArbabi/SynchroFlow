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
      netObserved: 3200,
    },

    outcome: {
      status: 'positive',
    },

    trend: {
      direction: 'up',
    },

    dataCoverage: {
      completenessPct: 95,
    },
  };

  it('renders period deterministically', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/2025-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/2025-01-31/i)).toBeInTheDocument();
  });

  it('renders net observed value or placeholder', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/net observed/i)).toBeInTheDocument();
    expect(screen.getByText(/3200/i)).toBeInTheDocument();
  });

  it('renders outcome when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/outcome/i)).toBeInTheDocument();
    expect(screen.getByText(/positive/i)).toBeInTheDocument();
  });

  it('renders trend direction when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/trend/i)).toBeInTheDocument();
    expect(screen.getByText(/up/i)).toBeInTheDocument();
  });

  it('renders data coverage percentage when present', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    expect(screen.getByText(/data coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/95%/i)).toBeInTheDocument();
  });

  it('renders placeholders for unknown values', () => {
    render(
      <FinancesModuleFT2
        {...baseProps}
        outcome={null}
        trend={null}
        dataCoverage={{ completenessPct: null }}
      />
    );

    // Outcome placeholder
    expect(
      screen.getByText(/outcome/i).parentElement?.textContent
    ).toContain('—');

    // Trend placeholder
    expect(
      screen.getByText(/trend/i).parentElement?.textContent
    ).toContain('—');

    // Data coverage placeholder
    expect(
      screen.getByText(/data coverage/i).parentElement?.textContent
    ).toContain('—');
  });

  /**
   * Doctrine guard:
   * FT2 must NEVER expose financial intelligence.
   */
  it('does not render forbidden financial intelligence', () => {
    render(<FinancesModuleFT2 {...baseProps} />);

    const forbiddenTerms = [
      /revenue/i,
      /margin/i,
      /profit/i,
      /transactions/i,
      /cost model/i,
      /breakdown/i,
      /dominant/i,
      /confidence/i,
      /% of/i,
    ];

    forbiddenTerms.forEach((term) => {
      expect(screen.queryByText(term)).toBeNull();
    });
  });

  it('renders placeholder for null period (no empty strings)', () => {
    render(
      <FinancesModuleFT2
        context={{
          period: { from: '', to: '' } as any,
          netObserved: null,
        }}
        outcome={null}
        trend={null}
        dataCoverage={null}
      />
    );

    // Empty strings are forbidden in FT2
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.getByTestId('finances-ft2-root').textContent).toContain('—');
  });
});