// tests/unit/ui/widgets/SalesByTrafficSourceWidget.test.tsx
import { screen, waitFor } from '@testing-library/react';
import { SalesByTrafficSourceWidget } from 'components/widgets/SalesByTrafficSourceWidget'; // This file doesn't exist yet
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
  { source: 'google.com', totalRevenue: 12500, orderCount: 50 },
  { source: 'instagram.com', totalRevenue: 8200, orderCount: 120 },
  { source: 'direct', totalRevenue: 5000, orderCount: 30 },
];

const mockProps: Omit<EnhancedWidgetShellProps, 'children'> = {
  id: 'traffic-source',
  title: 'Sales by Traffic Source',
  intelligenceLevel: 'L1',
  businessContext: { stage: 'survival' },
  metricConfig: { type: 'growth' },
  currentValue: 0,
  format: 'number',
  isLoading: false,
  isEmpty: false,
};

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
      // Check for the order count
      expect(screen.getByText('50 orders')).toBeInTheDocument();
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

  describe('Loading State Behavior', () => {
    test('should show loading skeleton immediately on initial render', () => {
      mockedAxios.get.mockImplementation(() => new Promise(() => {}));
      
      renderWithProviders(<SalesByTrafficSourceWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    test('should show loading skeleton for minimum time to prevent flicker', async () => {
      const mockTrafficData = [
        { id: '1', source: 'Direct', revenue: 5000 },
        { id: '2', source: 'Organic Search', revenue: 3000 },
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
            { id: '1', source: 'Direct', revenue: 5000 },
            { id: '2', source: 'Organic Search', revenue: 3000 },
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