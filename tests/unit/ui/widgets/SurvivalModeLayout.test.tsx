// tests/unit/ui/widgets/SurvivalModeLayout.test.tsx
import { render, screen } from '@testing-library/react';
import { SurvivalModeLayout } from 'components/widgets/SurvivalModeLayout';
import { renderWithTheme } from 'test-utils';

const mockSurvivalWidgets = [
  { 
    id: 'cash-flow', 
    title: 'Cash Flow', 
    intelligenceLevel: 'L3' as const,
    priority: 'critical' as const
  },
  { 
    id: 'inventory-alerts', 
    title: 'Inventory Alerts', 
    intelligenceLevel: 'L2' as const,
    priority: 'high' as const
  },
  { 
    id: 'order-volume', 
    title: 'Order Volume', 
    intelligenceLevel: 'L1' as const,
    priority: 'medium' as const
  },
];

describe('SurvivalModeLayout', () => {
  it('should prioritize critical widgets first', () => {
    renderWithTheme(<SurvivalModeLayout widgets={mockSurvivalWidgets} />);
    
    const widgetContainers = screen.getAllByTestId(/widget-container/);
    expect(widgetContainers[0]).toHaveAttribute('data-widget-id', 'cash-flow');
  });

  it('should apply urgent emotional styling to critical widgets', () => {
    renderWithTheme(<SurvivalModeLayout widgets={mockSurvivalWidgets} />);
    
    const criticalWidget = screen.getByTestId('widget-container-cash-flow');
    expect(criticalWidget).toHaveClass('emotional-status--urgent');
  });

  it('should use single column layout for survival mode', () => {
    const { container } = renderWithTheme(
      <SurvivalModeLayout widgets={mockSurvivalWidgets} />
    );
    
    const layout = container.firstChild;
    expect(layout).toHaveStyle({
      display: 'flex',
      flexDirection: 'column'
    });
  });

  it('should show survival-specific empty state', () => {
    renderWithTheme(<SurvivalModeLayout widgets={[]} />);
    
    expect(screen.getByTestId('survival-empty-state')).toBeInTheDocument();
    expect(screen.getByText(/focus on cash flow/)).toBeInTheDocument();
  });
});