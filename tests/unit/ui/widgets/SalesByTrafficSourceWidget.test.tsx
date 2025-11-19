// tests/unit/ui/widgets/SalesByTrafficSourceWidget.test.tsx
import { screen, waitFor } from '@testing-library/react';
import { SalesByTrafficSourceWidget } from 'components/widgets/SalesByTrafficSourceWidget';
import { EnhancedWidgetShellProps } from 'components/widgets/types';
import { renderWithProviders } from 'test-utils';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
 
// Mock dependencies
jest.mock('axios');
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// Mock data shape from our new getSalesByTrafficSource endpoint
const mockApiData = [
  { 
    source: 'google.com', 
    totalRevenue: 12500, 
    orderCount: 50,
    conversionRate: 0.05,
    averageOrderValue: 250
  },
  { 
    source: 'instagram.com', 
    totalRevenue: 8200, 
    orderCount: 120,
    conversionRate: 0.03,
    averageOrderValue: 68.33
  },
  { 
    source: 'direct', 
    totalRevenue: 5000, 
    orderCount: 30,
    conversionRate: 0.04,
    averageOrderValue: 166.67
  },
];

// Mock data for over-reliant scenario (one source dominating)
const mockOverReliantData = [
  { 
    source: 'google.com', 
    totalRevenue: 15000, 
    orderCount: 100,
    conversionRate: 0.04,
    averageOrderValue: 150
  },
  { 
    source: 'facebook.com', 
    totalRevenue: 1000, 
    orderCount: 10,
    conversionRate: 0.01,
    averageOrderValue: 100
  },
];

// Mock data for high opportunity scenario
const mockHighOpportunityData = [
  { 
    source: 'pinterest.com', 
    totalRevenue: 3000, 
    orderCount: 12,
    conversionRate: 0.06,
    averageOrderValue: 250
  },
  { 
    source: 'direct', 
    totalRevenue: 5000, 
    orderCount: 45,
    conversionRate: 0.05,
    averageOrderValue: 111.11
  },
];

const mockProps = {
  id: 'traffic-source',
  title: 'Sales by Traffic Source',
  intelligenceLevel: 'L1' as const,
  businessContext: {
    stage: 'survival' as const,
    burningPriority: 'acquisition' as const
  },
  metricConfig: { type: 'growth' as const },
  currentValue: 0,
  format: 'number' as const,
  isLoading: false,
  isEmpty: false,
  insightId: 'traffic-source-insight',
  children: undefined
} satisfies EnhancedWidgetShellProps & { insightId: string };

describe('SalesByTrafficSourceWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      accessToken: 'mock-token-123',
      isLoggedIn: true,
    } as any);
  });

  it('should render a list of traffic sources from the API', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: mockApiData });
    renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

    await waitFor(() => {
      // Check for the source
      expect(screen.getByText('google.com')).toBeInTheDocument();
      // Check for the revenue
      expect(screen.getByText('$12,500')).toBeInTheDocument();
      // Check for the order count (now includes AOV)
      expect(screen.getByText(/50 orders/)).toBeInTheDocument();
      expect(screen.getByText(/\$250 AOV/)).toBeInTheDocument();
    });
  });

  it('should show loading state when isLoading is true', () => {
    mockedAxios.get.mockImplementation(() => new Promise(() => {})); // Never resolves
    renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('should show empty state when API returns no items', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] });
    renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

    await waitFor(() => {
      expect(
        screen.getByText('No traffic source data available')
      ).toBeInTheDocument();
    });
  });

  it('should show error state when API call fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
    renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

    await waitFor(() => {
      expect(
        screen.getByText('Error loading traffic source data')
      ).toBeInTheDocument();
    });
  });

  // 4 C's Retrofit Tests
  describe('4 C\'s Framework Retrofit', () => {
    it('should wrap content in CoachTrigger with marketing insights', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockApiData });
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      await waitFor(() => {
        // Context: CoachTrigger should be present
        expect(screen.getByTestId('coach-trigger-content')).toBeInTheDocument();
        
        // Clear Path Forward: Should show recommended tactic
        expect(screen.getByText(/Recommended Tactic:/)).toBeInTheDocument();
        expect(screen.getByTestId('coach-tactic')).toBeInTheDocument();
        
        // Success metrics should be visible
        expect(screen.getByText(/Expected Impact On:/)).toBeInTheDocument();
        expect(screen.getByTestId('coach-success-metrics')).toBeInTheDocument();
        
        // Estimated impact should be visible
        expect(screen.getByText(/Estimated Impact:/)).toBeInTheDocument();
        expect(screen.getByTestId('coach-impact')).toBeInTheDocument();
      });
    });

    it('should show performance indicators for each traffic source', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockApiData });
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      await waitFor(() => {
        // Context: Performance summary chips should be visible
        expect(screen.getByText(/Top:/)).toBeInTheDocument();
        
        // Enhanced data display with conversion rates and AOV
        expect(screen.getByText('5.0% CR')).toBeInTheDocument();
        // AOV is formatted without commas for values under 1000
        expect(screen.getByText(/\$250 AOV/)).toBeInTheDocument();
      });
    });

    it('should provide budget optimization insights for over-reliant scenario', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockOverReliantData });
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      await waitFor(() => {
        // Causation: Should identify over-reliance risk
        expect(screen.getByText(/Budget Optimization Needed/)).toBeInTheDocument();
        expect(screen.getByText(/Review:/)).toBeInTheDocument();
      });
    });

    it('should identify growth opportunities for high-value channels', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockHighOpportunityData });
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      await waitFor(() => {
        // Clear Path Forward: Should highlight opportunities
        expect(screen.getByText(/Opportunity:/)).toBeInTheDocument();
        expect(screen.getByText(/Growth Opportunity Identified/)).toBeInTheDocument();
      });
    });

    it('should maintain CoachTrigger wrapper in error state for closed loop learning', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      await waitFor(() => {
        // Closed Loop: Even in error, coaching framework remains for feedback
        expect(screen.getByTestId('coach-trigger-content')).toBeInTheDocument();
        expect(screen.getByText('Error loading traffic source data')).toBeInTheDocument();
      });
    });
  });

  describe('Loading State Behavior', () => {
    test('should show loading skeleton immediately on initial render', () => {
      mockedAxios.get.mockImplementation(() => new Promise(() => {}));
      
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    test('should show loading skeleton for minimum time to prevent flicker', async () => {
      const mockTrafficData = [
        { 
          source: 'Direct', 
          totalRevenue: 5000, 
          orderCount: 50,
          conversionRate: 0.05,
          averageOrderValue: 100
        },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockTrafficData });
      
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.getByText('Direct')).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    test('should maintain loading state during entire API call duration', async () => {
      let resolveApi: (value: any) => void;
      const apiPromise = new Promise(resolve => {
        resolveApi = resolve;
      });
      
      mockedAxios.get.mockImplementation(() => apiPromise);
      
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      setTimeout(() => {
        resolveApi({ 
          data: [
            { 
              source: 'Direct', 
              totalRevenue: 5000, 
              orderCount: 50,
              conversionRate: 0.05,
              averageOrderValue: 100
            },
          ]
        });
      }, 100);
      
      await waitFor(() => {
        expect(screen.getByText('Direct')).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });
  });
});