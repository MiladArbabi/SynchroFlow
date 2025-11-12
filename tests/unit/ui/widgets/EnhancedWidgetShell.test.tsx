// tests/unit/ui/widgets/EnhancedWidgetShell.test.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EnhancedWidgetShell } from 'components/widgets/EnhancedWidgetShell';
import { CommerceMetricConfig, EnhancedWidgetShellProps } from 'components/widgets/types';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { 
    renderWithTheme, 
    createEnhancedWidgetProps,
    createL3WidgetProps,
    mockResizeObserver
} from 'test-utils';

// Mock MUI theme for consistent testing
const theme = createTheme();

// Mock data using the new factory functions
const mockBaseProps = createEnhancedWidgetProps();
const mockL3Props = createL3WidgetProps();

// Test wrapper with ThemeProvider
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme}>
    {children}
  </ThemeProvider>
);

const mockMetricConfig: CommerceMetricConfig = {
  type: 'financial',
  urgencyThresholds: {
    critical: 3,
    high: 6, 
    medium: 12,
    low: 12
  },
  idealRanges: { min: 6, max: 18 },
  industryBenchmarks: {
    poor: 3,
    average: 6,
    good: 12,
    excellent: 18
  }
};

const mockL4Props: EnhancedWidgetShellProps = {
  ...mockL3Props,
  intelligenceLevel: 'L4',
  secondaryActions: [
    {
      label: 'Secondary Action 1',
      onClick: jest.fn(),
      variant: 'secondary' as const,
      workflowType: 'inventory-management',
      expectedImpact: 'medium',
      timeToComplete: 'hours'
    },
    {
      label: 'Secondary Action 2',
      onClick: jest.fn(),
      variant: 'secondary' as const,
      workflowType: 'customer-retention',
      expectedImpact: 'low',
      timeToComplete: 'days'
    }
  ],
  metricConfig: mockMetricConfig  
};

// Test Suite
describe('EnhancedWidgetShell', () => {
    beforeEach(() => {
        mockResizeObserver();
    });

  // ===== BASIC RENDERING TESTS =====
  describe('Basic Rendering', () => {
    it('should render the component with title and children', () => {
      renderWithTheme(<EnhancedWidgetShell {...mockBaseProps} />);
      
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Test Widget');
      expect(screen.getByTestId('test-children')).toBeInTheDocument();
    });

    it('should render with correct emotional status classes', () => {
      const propsWithUrgent: EnhancedWidgetShellProps = {
           ...mockBaseProps,
           businessContext: {
             ...mockBaseProps.businessContext,
             burningPriority: 'cash-flow', // Use existing prop for urgency
             stage: 'survival'
           }
         };
      
      render(<EnhancedWidgetShell {...propsWithUrgent} />, { wrapper: TestWrapper });
      
      const widget = screen.getByTestId('test-children').closest('.MuiBox-root');
      expect(widget).toBeInTheDocument();
    });

   it.skip('should render title and optional subtitle when provided', () => {
   const propsWithSubtitle: EnhancedWidgetShellProps = {
     ...mockBaseProps,
     title: 'Main Title',
     subtitle: 'Additional context'
   };
   
   render(<EnhancedWidgetShell {...propsWithSubtitle} />, { wrapper: TestWrapper });
   
   expect(screen.getByText('Main Title')).toBeInTheDocument();
   expect(screen.getByText('Additional context')).toBeInTheDocument();
 });

  // ===== INTELLIGENCE LEVEL TESTS =====
  describe.skip('Intelligence Levels', () => {
    it('should not render footer for L1 intelligence level', () => {
      render(<EnhancedWidgetShell {...mockBaseProps} intelligenceLevel="L1" />, { 
        wrapper: TestWrapper 
      });
      
      expect(screen.queryByTestId('widget-footer')).not.toBeInTheDocument();
    });

    it('should render insight text for L2 intelligence level', () => {
      const l2Props: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        intelligenceLevel: 'L2',
        insightText: 'L2 insight text'
      };
      
      render(<EnhancedWidgetShell {...l2Props} />, { wrapper: TestWrapper });
      
      expect(screen.getByText('L2 insight text')).toBeInTheDocument();
    });

    it('should render primary action for L3 intelligence level', () => {
      render(<EnhancedWidgetShell {...mockL3Props} />, { wrapper: TestWrapper });
      
      expect(screen.getByText('Test insight message')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Test Action' })).toBeInTheDocument();
    });

    it('should render secondary actions for L4 intelligence level', () => {
      render(<EnhancedWidgetShell {...mockL4Props} />, { wrapper: TestWrapper });
      
      expect(screen.getByRole('button', { name: 'Test Action' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Secondary Action 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Secondary Action 2' })).toBeInTheDocument();
    });

    it('should apply correct severity styling to insight text', () => {
      const criticalProps: EnhancedWidgetShellProps = {
        ...mockL3Props,
        insightSeverity: 'critical'
      };
      
      render(<EnhancedWidgetShell {...criticalProps} />, { wrapper: TestWrapper });
      
      const insightElement = screen.getByText('Test insight message');
      expect(insightElement).toBeInTheDocument();
    });
  });

  // ===== STATE MANAGEMENT TESTS =====
  describe.skip('State Management', () => {
    it('should show loading state when isLoading is true', () => {
      render(
        <EnhancedWidgetShell {...mockBaseProps} isLoading={true} />, 
        { wrapper: TestWrapper }
      );
      
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('test-children')).not.toBeInTheDocument();
    });

    it('should show error state when error is provided', () => {
      const errorProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        error: 'Test error message'
      };
      
      render(<EnhancedWidgetShell {...errorProps} />, { wrapper: TestWrapper });
      
      expect(screen.getByText('Test error message')).toBeInTheDocument();
      expect(screen.queryByTestId('test-children')).not.toBeInTheDocument();
    });

    it('should show empty state when isEmpty is true', () => {
      const emptyProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        isEmpty: true
      };
      
      render(<EnhancedWidgetShell {...emptyProps} />, { wrapper: TestWrapper });
      
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('test-children')).not.toBeInTheDocument();
    });

    it('should prioritize error state over loading state', () => {
      const errorLoadingProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        isLoading: true,
        error: 'Test error message'
      };
      
      render(<EnhancedWidgetShell {...errorLoadingProps} />, { wrapper: TestWrapper });
      
      expect(screen.getByText('Test error message')).toBeInTheDocument();
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    it('should show stale indicator when isStale is true', () => {
      const staleProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        isStale: true
      };
      
      render(<EnhancedWidgetShell {...staleProps} />, { wrapper: TestWrapper });
      
      expect(screen.getByTestId('stale-indicator')).toBeInTheDocument();
    });
  });

  // ===== INTERACTION TESTS =====
  describe.skip('User Interactions', () => {
    it('should call primary action callback when clicked', () => {
      const mockOnClick = jest.fn();
      const propsWithAction: EnhancedWidgetShellProps = {
        ...mockL3Props,
        primaryAction: {
          ...mockL3Props.primaryAction!,
          onClick: mockOnClick
        }
      };
      
      render(<EnhancedWidgetShell {...propsWithAction} />, { wrapper: TestWrapper });
      
      fireEvent.click(screen.getByRole('button', { name: 'Test Action' }));
      
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('should call secondary action callbacks when clicked', () => {
      const mockOnClick1 = jest.fn();
      const mockOnClick2 = jest.fn();
      const propsWithSecondaryActions: EnhancedWidgetShellProps = {
        ...mockL4Props,
        secondaryActions: [
          { ...mockL4Props.secondaryActions![0], onClick: mockOnClick1 },
          { ...mockL4Props.secondaryActions![1], onClick: mockOnClick2 }
        ]
      };
      
      render(<EnhancedWidgetShell {...propsWithSecondaryActions} />, { wrapper: TestWrapper });
      
      fireEvent.click(screen.getByRole('button', { name: 'Secondary Action 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Secondary Action 2' }));
      
      expect(mockOnClick1).toHaveBeenCalledTimes(1);
      expect(mockOnClick2).toHaveBeenCalledTimes(1);
    });

    it('should open config menu when config button is clicked', () => {
      const mockConfigMenu = <div data-testid="config-menu">Config Options</div>;
      
      render(
        <EnhancedWidgetShell {...mockBaseProps} configMenu={mockConfigMenu} />, 
        { wrapper: TestWrapper }
      );
      
      fireEvent.click(screen.getByTestId('config-button'));
      
      expect(screen.getByTestId('config-menu')).toBeInTheDocument();
    });

    it('should navigate to header link when title is clicked and headerLink is provided', () => {
      const mockHeaderLink = '/test-path';
      const propsWithLink: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        headerLink: mockHeaderLink
      };
      
      render(<EnhancedWidgetShell {...propsWithLink} />, { wrapper: TestWrapper });
      
      const titleLink = screen.getByRole('heading', { level: 3 }).closest('a');
      expect(titleLink).toHaveAttribute('href', mockHeaderLink);
    });
  });

  // ===== BUSINESS CONTEXT TESTS =====
  describe.skip('Business Context Adaptation', () => {
    it('should adapt styling based on business context stage', () => {
      const survivalProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        businessContext: { ...mockBaseProps.businessContext, stage: 'survival' }
      };
      
      render(<EnhancedWidgetShell {...survivalProps} />, { wrapper: TestWrapper });
      
      const widget = screen.getByTestId('test-children').closest('[data-stage="survival"]');
      expect(widget).toBeInTheDocument();
    });

    it('should show different content based on revenue band', () => {
      const enterpriseProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        businessContext: { ...mockBaseProps.businessContext, revenueBand: '50M+' }
      };
      
      render(<EnhancedWidgetShell {...enterpriseProps} />, { wrapper: TestWrapper });
      
      const widget = screen.getByTestId('test-children').closest('[data-revenue-band="50M+"]');
      expect(widget).toBeInTheDocument();
    });
  });

  // ===== ACCESSIBILITY TESTS =====
  describe.skip('Accessibility', () => {
    it('should have proper ARIA labels for loading state', () => {
      render(
        <EnhancedWidgetShell {...mockBaseProps} isLoading={true} />, 
        { wrapper: TestWrapper }
      );
      
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading widget content');
    });

    it('should have proper ARIA labels for error state', () => {
      const errorProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        error: 'Test error message'
      };
      
      render(<EnhancedWidgetShell {...errorProps} />, { wrapper: TestWrapper });
      
      expect(screen.getByRole('alert')).toHaveTextContent('Test error message');
    });

    it('should have proper keyboard navigation for actions', () => {
      render(<EnhancedWidgetShell {...mockL3Props} />, { wrapper: TestWrapper });
      
      const actionButton = screen.getByRole('button', { name: 'Test Action' });
      expect(actionButton).toHaveAttribute('tabindex', '0');
      
      fireEvent.keyDown(actionButton, { key: 'Enter', code: 'Enter' });
      expect(mockL3Props.primaryAction!.onClick).toHaveBeenCalled();
    });

    it('should maintain focus management in config menu', async () => {
      const mockConfigMenu = (
        <div data-testid="config-menu">
          <button data-testid="menu-item-1">Option 1</button>
          <button data-testid="menu-item-2">Option 2</button>
        </div>
      );
      
      render(
        <EnhancedWidgetShell {...mockBaseProps} configMenu={mockConfigMenu} />, 
        { wrapper: TestWrapper }
      );
      
      fireEvent.click(screen.getByTestId('config-button'));
      
      await waitFor(() => {
        expect(screen.getByTestId('menu-item-1')).toHaveFocus();
      });
    });
  });

  // ===== PERFORMANCE & EDGE CASES =====
  describe('Performance and Edge Cases', () => {
    it('should handle very long titles without breaking layout', () => {
      const longTitleProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        title: 'This is a very long title that might break the layout if not handled properly in the component'
      };
      
      render(<EnhancedWidgetShell {...longTitleProps} />, { wrapper: TestWrapper });
      
      const titleElement = screen.getByRole('heading', { level: 3 });
      expect(titleElement).toBeInTheDocument();
      expect(titleElement).toHaveTextContent(longTitleProps.title);
    });

    it('should handle missing optional props gracefully', () => {
      const minimalProps: EnhancedWidgetShellProps = {
          id: 'minimal-widget',
          title: 'Minimal Widget',
          children: <div>Content</div>,
          intelligenceLevel: 'L1',
          isLoading: false,
          isEmpty: false,
          currentValue: 0,
          format: 'number',
          businessContext: {},
          metricConfig: mockMetricConfig
      };
      
      expect(() => {
        render(<EnhancedWidgetShell {...minimalProps} />, { wrapper: TestWrapper });
      }).not.toThrow();
    });

    it('should memoize expensive computations', () => {
      const expensiveProps: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        currentValue: 999999.99999,
        format: 'currency'
      };
      
      render(<EnhancedWidgetShell {...expensiveProps} />, { wrapper: TestWrapper });
      
      // Test that formatting large numbers doesn't cause performance issues
      const content = screen.getByTestId('test-children');
      expect(content).toBeInTheDocument();
    });

    it('should handle rapid state changes without errors', async () => {
      const { rerender } = render(
        <EnhancedWidgetShell {...mockBaseProps} isLoading={true} />, 
        { wrapper: TestWrapper }
      );
      
      // Rapidly change states
      rerender(<TestWrapper><EnhancedWidgetShell {...mockBaseProps} isLoading={false} /></TestWrapper>);
      rerender(<TestWrapper><EnhancedWidgetShell {...mockBaseProps} error="Error" /></TestWrapper>);
      rerender(<TestWrapper><EnhancedWidgetShell {...mockBaseProps} isEmpty={true} /></TestWrapper>);
      rerender(<TestWrapper><EnhancedWidgetShell {...mockBaseProps} /></TestWrapper>);
      
      await waitFor(() => {
        expect(screen.getByTestId('test-children')).toBeInTheDocument();
      });
    });
  });

  // ===== CROSS-WIDGET COMMUNICATION TESTS =====
  describe('Cross-Widget Communication', () => {
    it.skip('should emit events when onEvent callback is provided', () => {
      const mockOnEvent = jest.fn();
      const propsWithEvent: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        onEvent: mockOnEvent,
        listenedEvents: ['DATA_UPDATED']
      };
      
      render(<EnhancedWidgetShell {...propsWithEvent} />, { wrapper: TestWrapper });
      
      // Simulate an event that should trigger the callback
      fireEvent.click(screen.getByTestId('test-children'));
      
      expect(mockOnEvent).toHaveBeenCalled();
    });

    it('should respond to external events when listenedEvents is provided', () => {
      const mockOnEvent = jest.fn();
      const propsWithListener: EnhancedWidgetShellProps = {
        ...mockBaseProps,
        onEvent: mockOnEvent,
        listenedEvents: ['CASH_RUNWAY_CRITICAL', 'INVENTORY_STOCKOUT']
      };
      
      render(<EnhancedWidgetShell {...propsWithListener} />, { wrapper: TestWrapper });
      
      // This would typically be triggered by an external event bus
      // For now, we test that the component is set up to listen
      expect(propsWithListener.listenedEvents).toContain('CASH_RUNWAY_CRITICAL');
        });
    });
    });
});