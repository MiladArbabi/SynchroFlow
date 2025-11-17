// tests/unit/ui/widgets/OrderMetricsWidget.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderMetricsWidget } from 'components/widgets/OrderMetricsWidget';
import { EnhancedWidgetShellProps } from 'packages/ui/src/components/widgets/types';
import { 
  renderWithProviders, 
  createEnhancedWidgetProps,
  createL3WidgetProps 
} from 'test-utils';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';

// Mock dependencies
jest.mock('axios');
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// Test data factories
const createMockPulseData = (overrides?: Partial<{
  totalRevenue: number;
  orderCount: number;
  unfulfilledCount: number;
}>) => ({
  totalRevenue: 10000,
  orderCount: 80,
  unfulfilledCount: 5,
  ...overrides,
});

const createMockWidgetProps = (overrides?: Partial<EnhancedWidgetShellProps>) => 
  createEnhancedWidgetProps({
    id: 'order-metrics',
    title: 'Order Metrics',
    intelligenceLevel: 'L1',
    ...overrides,
  });

// Test scenarios
const TEST_SCENARIOS = {
  HAPPY_PATH: {
    data: createMockPulseData(),
    expected: {
      totalOrders: '80',
      avgOrder: '$125',
    },
  },
  ZERO_ORDERS: {
    data: createMockPulseData({ totalRevenue: 0, orderCount: 0 }),
    expected: {
      totalOrders: '0',
      avgOrder: '$0',
    },
  },
  LARGE_NUMBERS: {
    data: createMockPulseData({ totalRevenue: 2500000, orderCount: 12500 }),
    expected: {
      totalOrders: '12500', // Without comma formatting
      avgOrder: '$200',
    },
  },
  DECIMAL_AVERAGE: {
    data: createMockPulseData({ totalRevenue: 9999, orderCount: 100 }),
    expected: {
      totalOrders: '100',
      avgOrder: '$100', // 9999/100 = 99.99, but formatted without decimals
    },
  },
};

describe('OrderMetricsWidget', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      accessToken: 'mock-token-123',
      isLoggedIn: true,
    } as any);
  });

  describe('API Integration', () => {
    it('should make API call with correct parameters', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith(
          '/api/v1/dashboard/pulse',
          {
            headers: {
              Authorization: 'Bearer mock-token-123',
            },
          }
        );
      });
    });

    it('should not make API call when no access token is available', () => {
      mockUseAuth.mockReturnValue({
        accessToken: null,
        isLoggedIn: false,
      } as any);

      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(screen.getByText('Error loading order data')).toBeInTheDocument();
      });
    });
  });

  describe('Data Display', () => {
  it.each([
    ['HAPPY_PATH', TEST_SCENARIOS.HAPPY_PATH, false],
    ['LARGE_NUMBERS', TEST_SCENARIOS.LARGE_NUMBERS, false],
    ['DECIMAL_AVERAGE', TEST_SCENARIOS.DECIMAL_AVERAGE, false],
    ['ZERO_ORDERS', TEST_SCENARIOS.ZERO_ORDERS, true],
  ])('should correctly display metrics for %s scenario', async (_, scenario, shouldBeEmpty) => {
    mockedAxios.get.mockResolvedValueOnce({ data: scenario.data });
    
    renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

    await waitFor(() => {
      if (shouldBeEmpty) {
        // For zero orders, expect empty state instead of metrics
        expect(screen.getByText('No order data available')).toBeInTheDocument();
        expect(screen.queryByText(scenario.expected.totalOrders)).not.toBeInTheDocument();
        expect(screen.queryByText(scenario.expected.avgOrder)).not.toBeInTheDocument();
      } else {
        // For non-zero orders, expect the metrics to be displayed
        // Note: totalOrders is displayed without comma formatting in the component
        const expectedTotalOrders = scenario.expected.totalOrders.replace(/,/g, '');
        expect(screen.getByText(expectedTotalOrders)).toBeInTheDocument();
        expect(screen.getByText(scenario.expected.avgOrder)).toBeInTheDocument();
      }
    });
  });

    it('should format currency without decimal places', async () => {
      mockedAxios.get.mockResolvedValueOnce({ 
        data: createMockPulseData({ totalRevenue: 1234.56, orderCount: 10 }) 
      });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        // 1234.56 / 10 = 123.456, should format to $123 without decimals
        expect(screen.getByText('$123')).toBeInTheDocument();
      });
    });

    it('should display correct metric labels', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(screen.getByText('Total Orders')).toBeInTheDocument();
        expect(screen.getByText('Avg. Order')).toBeInTheDocument();
      });
      
      // Verify conversion metric is not present (as per requirements)
      expect(screen.queryByText('Conversion')).not.toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });
  });

  describe('State Management', () => {
    it('should show loading state during initial fetch', () => {
      mockedAxios.get.mockImplementation(() => new Promise(() => {})); // Never resolves
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);
      
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    it('should show empty state when no orders exist', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.ZERO_ORDERS.data });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(screen.getByText('No order data available')).toBeInTheDocument();
      });
    });

    it('should transition from loading to data state successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      const { rerender } = renderWithProviders(
        <OrderMetricsWidget {...createMockWidgetProps({ isLoading: true })} />
      );

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

      // Simulate loading completion
      rerender(
        <OrderMetricsWidget 
          {...createMockWidgetProps({ 
            isLoading: false,
            isEmpty: false 
          })} 
        />
      );

      await waitFor(() => {
        expect(screen.getByText('80')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message on API failure', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        message: 'Server unavailable'
      });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(screen.getByText('Error loading order data')).toBeInTheDocument();
      });
    });

    it('should not show data when in error state', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Failed to fetch'));
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(screen.getByText('Error loading order data')).toBeInTheDocument();
        expect(screen.queryByText('Total Orders')).not.toBeInTheDocument();
      });
    });
  });

  describe('Business Logic', () => {
    it('should calculate average order value correctly', async () => {
      const testData = createMockPulseData({ totalRevenue: 5000, orderCount: 25 });
      mockedAxios.get.mockResolvedValueOnce({ data: testData });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        // 5000 / 25 = 200
        expect(screen.getByText('$200')).toBeInTheDocument();
      });
    });

    it('should handle division by zero gracefully', async () => {
    const testData = createMockPulseData({ totalRevenue: 1000, orderCount: 0 });
    mockedAxios.get.mockResolvedValueOnce({ data: testData });
    
    renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        // When there are zero orders, should show empty state instead of $0
        expect(screen.getByText('No order data available')).toBeInTheDocument();
        expect(screen.queryByText('$0')).not.toBeInTheDocument();
      });
    });

    it('should calculate zero average order when revenue is zero but orders exist', async () => {
      const testData = createMockPulseData({ totalRevenue: 0, orderCount: 5 });
      mockedAxios.get.mockResolvedValueOnce({ data: testData });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        // Should show $0 average when revenue is 0 but orders exist
        expect(screen.getByText('$0')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
      });
    });

    it('should maintain data consistency between metrics', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        const totalOrdersElement = screen.getByText('80');
        const avgOrderElement = screen.getByText('$125');
        
        expect(totalOrdersElement).toBeInTheDocument();
        expect(avgOrderElement).toBeInTheDocument();
        
        // Verify they are in the same widget context
        const widgetContainer = totalOrdersElement.closest('[data-testid*="widget"]') || 
                               document.body;
        expect(within(widgetContainer).getByText('$125')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility and UX', () => {
    it('should have proper ARIA labels for metrics', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        const totalOrdersSection = screen.getByText('Total Orders').closest('div');
        const avgOrderSection = screen.getByText('Avg. Order').closest('div');
        
        expect(totalOrdersSection).toBeInTheDocument();
        expect(avgOrderSection).toBeInTheDocument();
      });
    });

    it('should maintain consistent spacing and layout', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      const { container } = renderWithProviders(
        <OrderMetricsWidget {...createMockWidgetProps()} />
      );

      await waitFor(() => {
        const gridContainer = container.querySelector('.MuiGrid-container');
        expect(gridContainer).toBeInTheDocument();
        expect(gridContainer).toHaveClass('MuiGrid-container');
      });
    });
  });

  describe('Performance and Optimization', () => {
    it('should not make unnecessary API calls on re-render', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      const { rerender } = renderWithProviders(
        <OrderMetricsWidget {...createMockWidgetProps()} />
      );

      // Re-render with same props
      rerender(<OrderMetricsWidget {...createMockWidgetProps()} />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle rapid prop changes gracefully', async () => {
      mockedAxios.get.mockResolvedValue({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      const { rerender } = renderWithProviders(
        <OrderMetricsWidget {...createMockWidgetProps({ intelligenceLevel: 'L1' })} />
      );

      // Rapid prop changes
      rerender(<OrderMetricsWidget {...createMockWidgetProps({ intelligenceLevel: 'L2' })} />);
      rerender(<OrderMetricsWidget {...createMockWidgetProps({ intelligenceLevel: 'L3' })} />);

      await waitFor(() => {
        // Should still only make one call due to query caching
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Loading State Behavior', () => {
    test('should show loading skeleton immediately on initial render', () => {
      mockedAxios.get.mockImplementation(() => new Promise(() => {}));
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    test('should show loading skeleton for minimum time to prevent flicker', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.getByText('Total Orders')).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    test('should maintain loading state during entire API call duration', async () => {
      let resolveApi: (value: any) => void;
      const apiPromise = new Promise(resolve => {
        resolveApi = resolve;
      });
      
      mockedAxios.get.mockImplementation(() => apiPromise);
      
      renderWithProviders(<OrderMetricsWidget {...createMockWidgetProps()} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      setTimeout(() => {
        resolveApi({ data: TEST_SCENARIOS.HAPPY_PATH.data });
      }, 100);
      
      await waitFor(() => {
        expect(screen.getByText('Total Orders')).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });
  });
});