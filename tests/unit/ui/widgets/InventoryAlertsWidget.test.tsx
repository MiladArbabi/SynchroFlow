// tests/unit/ui/widgets/InventoryAlertsWidget.test.tsx
import { screen } from '@testing-library/react';
import { InventoryAlertsWidget } from 'components/widgets/mock-widgets';
import { EnhancedWidgetShellProps } from 'components/widgets/types';
import { renderWithTheme } from 'test-utils';

const mockProps: EnhancedWidgetShellProps = {
  id: 'inventory-alerts',
  title: 'Inventory Alerts',
  intelligenceLevel: 'L2',
  businessContext: { stage: 'survival', burningPriority: 'inventory' },
  metricConfig: { type: 'inventory' },
  currentValue: 0,
  format: 'number',
  isLoading: false,
  isEmpty: false,
  children: <div>Test Children</div>
};

describe('InventoryAlertsWidget', () => {
  it('should render inventory alerts', () => {
    renderWithTheme(<InventoryAlertsWidget {...mockProps} />);
    
    expect(screen.getByText('Inventory Alerts')).toBeInTheDocument();
    expect(screen.getByText('Product A')).toBeInTheDocument();
    expect(screen.getByText('Product B')).toBeInTheDocument();
    expect(screen.getByText('Product C')).toBeInTheDocument();
  });

  it('should show out of stock alerts', () => {
    renderWithTheme(<InventoryAlertsWidget {...mockProps} />);
    
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
  });

  it('should show low stock alerts', () => {
    renderWithTheme(<InventoryAlertsWidget {...mockProps} />);
    
    expect(screen.getByText('Low: 5')).toBeInTheDocument();
    expect(screen.getByText('Low: 3')).toBeInTheDocument();
  });

  it('should show loading state when isLoading is true', () => {
    const loadingProps = { ...mockProps, isLoading: true };
    renderWithTheme(<InventoryAlertsWidget {...loadingProps} />);
    
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('should show empty state when isEmpty is true', () => {
    const emptyProps = { ...mockProps, isEmpty: true };
    renderWithTheme(<InventoryAlertsWidget {...emptyProps} />);
    
    expect(screen.getByText('No inventory alerts')).toBeInTheDocument();
  });
});