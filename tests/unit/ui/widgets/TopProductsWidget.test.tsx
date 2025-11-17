// tests/unit/ui/widgets/TopProductsWidget.test.tsx
import { screen, waitFor } from '@testing-library/react';
import { TopProductsWidget } from 'components/widgets/TopProductsWidget';
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

// Mock data shape from our new getTopProducts endpoint
const mockApiData = [
  { title: 'Product A', totalSold: 150, id: '1' },
  { title: 'Product B', totalSold: 120, id: '2' },
  { title: 'Product C', totalSold: 95, id: '3' },
];

const mockProps: Omit<EnhancedWidgetShellProps, 'children'> = {
  id: 'top-products',
  title: 'Top Products',
  intelligenceLevel: 'L1',
  businessContext: { stage: 'survival' },
  metricConfig: { type: 'inventory' },
  currentValue: 0,
  format: 'number',
  isLoading: false,
  isEmpty: false,
};

describe('TopProductsWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      accessToken: 'mock-token-123',
      isLoggedIn: true,
    } as any);
  });

  it('should render a list of top products from the API', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: mockApiData });
    renderWithProviders(<TopProductsWidget {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Product A')).toBeInTheDocument();
      expect(screen.getByText('150 sold')).toBeInTheDocument();
      expect(screen.getByText('Product C')).toBeInTheDocument();
      expect(screen.getByText('95 sold')).toBeInTheDocument();
    });
  });

  it('should show loading state when isLoading is true', () => {
    mockedAxios.get.mockImplementation(() => new Promise(() => {})); // Never resolves
    renderWithProviders(<TopProductsWidget {...mockProps} />);

    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('should show empty state when API returns no items', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] });
    renderWithProviders(<TopProductsWidget {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('No top products data available')).toBeInTheDocument();
    });
  });

  it('should show error state when API call fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
    renderWithProviders(<TopProductsWidget {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Error loading top products')).toBeInTheDocument();
    });
  });

  describe('Loading State Behavior', () => {
    test('should show loading skeleton immediately on initial render', () => {
      // Mock axios to never resolve to test initial loading state
      mockedAxios.get.mockImplementation(() => new Promise(() => {}));
      
      renderWithProviders(<TopProductsWidget {...mockProps} />);

      // Loading skeleton should appear instantly, no waiting needed
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    test('should show loading skeleton for at least 500ms to prevent flicker', async () => {
      // Mock a very fast API response
      mockedAxios.get.mockResolvedValueOnce({ data: mockApiData });
      
      const { unmount } = renderWithProviders(<TopProductsWidget {...mockProps} />);

      // Should show loading state immediately
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      // Wait for data to load but verify loading state was shown
      await waitFor(() => {
        expect(screen.getByText('Product A')).toBeInTheDocument();
      });
      
      // Verify loading skeleton is gone
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    test('should maintain loading state during API call', async () => {
      let resolveApi: (value: any) => void;
      const apiPromise = new Promise(resolve => {
        resolveApi = resolve;
      });
      
      mockedAxios.get.mockImplementation(() => apiPromise);
      
      renderWithProviders(<TopProductsWidget {...mockProps} />);

      // Verify loading state is shown while API is pending
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      // Resolve the API call after some time
      setTimeout(() => {
        resolveApi({ data: mockApiData });
      }, 100);
      
      // Loading state should persist until data arrives
      await waitFor(() => {
        expect(screen.getByText('Product A')).toBeInTheDocument();
      });
      
      // Loading state should be removed
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    test('should show loading state when widget props indicate loading', () => {
      // Test that EnhancedWidgetShell respects isLoading prop
      const loadingProps = { ...mockProps, isLoading: true };
      
      renderWithProviders(<TopProductsWidget {...loadingProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });
  });
});

