// tests/unit/ui/widgets/CashFlowWidget.test.tsx
import { screen } from '@testing-library/react';
import { CashFlowWidget } from 'components/widgets/mock-widgets';
import { EnhancedWidgetShellProps } from 'components/widgets/types';
import { renderWithTheme } from 'test-utils';

const mockProps: EnhancedWidgetShellProps = {
  id: 'cash-flow',
  title: 'Cash Flow',
  intelligenceLevel: 'L3',
  businessContext: { stage: 'survival', burningPriority: 'cash-flow' },
  metricConfig: { type: 'financial' },
  currentValue: 15420,
  format: 'currency',
  isLoading: false,
  isEmpty: false,
  children: <div>Test Children</div>,
};

describe('CashFlowWidget', () => {
  it('should render the current cash flow value', () => {
    renderWithTheme(<CashFlowWidget {...mockProps} />);
    
    expect(screen.getByText('$15,420')).toBeInTheDocument();
  });

  it('should show a trend indicator when previous value is provided', () => {
    const propsWithPrevious = { ...mockProps, previousValue: 12800 };
    renderWithTheme(<CashFlowWidget {...propsWithPrevious} />);
    
    expect(screen.getByText(/\+20\.5%/)).toBeInTheDocument(); // (15420-12800)/12800 * 100
  });

  it('should show loading state when isLoading is true', () => {
    const loadingProps = { ...mockProps, isLoading: true };
    renderWithTheme(<CashFlowWidget {...loadingProps} />);
    
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('should show empty state when isEmpty is true', () => {
    const emptyProps = { ...mockProps, isEmpty: true };
    renderWithTheme(<CashFlowWidget {...emptyProps} />);
    
    expect(screen.getByText('No cash flow data available')).toBeInTheDocument();
  });

  it('should show critical alert when cash flow is negative', () => {
    const negativeProps = { ...mockProps, currentValue: -5000 };
    renderWithTheme(<CashFlowWidget {...negativeProps} />);
    
    expect(screen.getByText('-$5,000')).toBeInTheDocument();
    expect(screen.getByText(/Critical: Negative Cash Flow/)).toBeInTheDocument();
  });
});