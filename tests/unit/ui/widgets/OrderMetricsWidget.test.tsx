// tests/unit/ui/widgets/OrderMetricsWidget.test.tsx
import { render, screen } from '@testing-library/react';
import { OrderMetricsWidget } from 'components/widgets/mock-widgets';
import { EnhancedWidgetShellProps } from 'components/widgets/types';
import { renderWithTheme } from 'test-utils';

const mockProps: EnhancedWidgetShellProps = {
  id: 'order-metrics',
  title: 'Order Metrics',
  intelligenceLevel: 'L1',
  businessContext: { stage: 'survival' },
  metricConfig: { type: 'growth' },
  currentValue: 0,
  format: 'number',
  isLoading: false,
  isEmpty: false,
  children: <div>Test Children</div>,
};

describe('OrderMetricsWidget', () => {
  it('should render order metrics', () => {
    renderWithTheme(<OrderMetricsWidget {...mockProps} />);
    
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('$125.5')).toBeInTheDocument();
    expect(screen.getByText('2.3%')).toBeInTheDocument();
  });

  it('should show metric labels', () => {
    renderWithTheme(<OrderMetricsWidget {...mockProps} />);
    
    expect(screen.getByText('Total Orders')).toBeInTheDocument();
    expect(screen.getByText('Avg. Order')).toBeInTheDocument();
    expect(screen.getByText('Conversion')).toBeInTheDocument();
  });

  it('should show loading state when isLoading is true', () => {
    const loadingProps = { ...mockProps, isLoading: true };
    renderWithTheme(<OrderMetricsWidget {...loadingProps} />);
    
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('should show empty state when isEmpty is true', () => {
    const emptyProps = { ...mockProps, isEmpty: true };
    renderWithTheme(<OrderMetricsWidget {...emptyProps} />);
    
    expect(screen.getByText('No order data available')).toBeInTheDocument();
  });
});