// tests/unit/ui/widgets/WidgetLayout.test.tsx
import { screen } from '@testing-library/react';
import { WidgetLayout } from 'components/widgets/WidgetLayout';
import { renderWithTheme } from 'test-utils';

// Mock data with all required properties
const mockWidgets = [
  { 
    id: 'widget-1', 
    title: 'Widget 1', 
    intelligenceLevel: 'L1' as const,
    priority: 'critical' as const,
    businessContext: { stage: 'survival' as const },
    metricConfig: { type: 'financial' },
    currentValue: 1000,
    format: 'number' as const,
    isLoading: false,
    isEmpty: false
  },
  { 
    id: 'widget-2', 
    title: 'Widget 2', 
    intelligenceLevel: 'L2' as const,
    priority: 'high' as const,
    businessContext: { stage: 'survival' as const },
    metricConfig: { type: 'inventory' },
    currentValue: 75,
    format: 'percentage' as const,
    isLoading: false,
    isEmpty: false
  },
  { 
    id: 'widget-3', 
    title: 'Widget 3', 
    intelligenceLevel: 'L3' as const,
    priority: 'medium' as const,
    businessContext: { stage: 'survival' as const },
    metricConfig: { type: 'customer' },
    currentValue: 50000,
    format: 'currency' as const,
    isLoading: false,
    isEmpty: false
  },
];

// Mock the useDashboardState hook
jest.mock('contexts/DashboardStateContext', () => ({
  useDashboardState: () => ({
    currentView: 'survival',
    userState: null,
    isLoading: false,
    error: null,
    refetchUserState: jest.fn()
  })
}));

describe('WidgetLayout', () => {
  it('should render the layout with correct number of widgets', () => {
    renderWithTheme(<WidgetLayout widgets={mockWidgets} />);
    
    // Count widgets by their titles (h3 elements)
    const widgetHeaders = screen.getAllByRole('heading', { level: 3 });
    expect(widgetHeaders).toHaveLength(3);
    expect(widgetHeaders.map(header => header.textContent)).toEqual(['Widget 1', 'Widget 2', 'Widget 3']);
  });

  it('should show loading state when isLoading is true', () => {
    renderWithTheme(<WidgetLayout widgets={mockWidgets} isLoading={true} />);
    
    expect(screen.getByTestId('layout-loading-skeleton')).toBeInTheDocument();
  });

  it('should render empty state when no widgets are provided', () => {
    renderWithTheme(<WidgetLayout widgets={[]} />);
    
    expect(screen.getByTestId('empty-layout-state')).toBeInTheDocument();
    expect(screen.getByText(/No widgets available/)).toBeInTheDocument();
  });

  it('should prioritize critical widgets first in survival mode', () => {
    renderWithTheme(<WidgetLayout widgets={mockWidgets} />);
    
    // Get all widget titles (h3 elements)
    const widgetTitles = screen.getAllByRole('heading', { level: 3 });
    expect(widgetTitles[0]).toHaveTextContent('Widget 1'); // Critical should be first
    expect(widgetTitles[1]).toHaveTextContent('Widget 2'); // High should be second
    expect(widgetTitles[2]).toHaveTextContent('Widget 3'); // Medium should be third
  });
});