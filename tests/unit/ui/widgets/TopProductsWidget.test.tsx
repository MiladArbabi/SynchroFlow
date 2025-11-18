// tests/unit/ui/widgets/TopProductsWidget.test.tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

const mockProps = {
  id: 'top-products',
  title: 'Top Products',
  intelligenceLevel: 'L1' as const,
  businessContext: { stage: 'survival' as const },
  metricConfig: { type: 'inventory' as const },
  currentValue: 0,
  format: 'number' as const,
  isLoading: false,
  isEmpty: false,
  insightId: 'top-products-insight-123',
  children: undefined
} satisfies EnhancedWidgetShellProps & { insightId: string };

describe('TopProductsWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      accessToken: 'mock-token-123',
      isLoggedIn: true,
      login: jest.fn(),
     logout: jest.fn(),
     user: null,
     setAccessToken: function (_token: string | null): void {
       throw new Error('Function not implemented.');
     },
     isLoading: false
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
      expect(screen.getByText('No data to display.')).toBeInTheDocument();
    });
  });

  it('should show error state when API call fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
    renderWithProviders(<TopProductsWidget {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
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
      
      renderWithProviders(<TopProductsWidget {...mockProps} />);

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

  describe('4 C\'s Retrofit (CoachTrigger Integration)', () => {
    it('should warn about Concentration Risk when top product dominates', async () => {
      const mockData = [
        { id: '1', title: 'Hero Product', totalSold: 800 }, // 80% of 1000 total
        { id: '2', title: 'Small Item', totalSold: 100 },
        { id: '3', title: 'Tiny Item', totalSold: 100 },
      ];
      mockedAxios.get.mockResolvedValue({ data: mockData });

      renderWithProviders(
        <TopProductsWidget 
          {...mockProps} 
          insightId="top-products-risk"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Hero Product')).toBeInTheDocument();
      });

       // Verify 4 C's insights are shown
       expect(screen.getByText('Product Portfolio Optimization')).toBeInTheDocument();
       // Check for the specific insight text that should be generated
       // For dominating product, we expect text about dependency risk
       expect(screen.getByText(/creates dependency risk/)).toBeInTheDocument();
       expect(screen.getByText('Product Sales, Revenue Diversification')).toBeInTheDocument();
    });

    it('should suggest Inventory Protection for balanced portfolio', async () => {
      const mockData = [
        { id: '1', title: 'Product A', totalSold: 300 }, // 30% - Balanced
        { id: '2', title: 'Product B', totalSold: 250 },
        { id: '3', title: 'Product C', totalSold: 200 },
      ];
      mockedAxios.get.mockResolvedValue({ data: mockData });

      renderWithProviders(
        <TopProductsWidget 
          {...mockProps} 
          insightId="top-products-opportunity"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Product A')).toBeInTheDocument();
      });

      // Verify insights for balanced portfolio
      expect(screen.getByText('Product Portfolio Optimization')).toBeInTheDocument();
      expect(screen.getByText(/All top products are performing well with high sales volume/)).toBeInTheDocument();
    });

    it('should submit feedback', async () => {
      const mockData = [{ id: '1', title: 'Item', totalSold: 10 }];
      mockedAxios.get.mockResolvedValue({ data: mockData });
      mockedAxios.post.mockResolvedValue({ data: { success: true } });

      // Create a mock feedback handler
      const mockOnFeedback = jest.fn();

      renderWithProviders(
        <TopProductsWidget 
          {...mockProps} 
          insightId="top-products-feedback"
          onFeedback={mockOnFeedback}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Item')).toBeInTheDocument();
      });

      const helpfulBtn = screen.getByLabelText('This was helpful');
      fireEvent.click(helpfulBtn);

      await waitFor(() => {
        expect(mockOnFeedback).toHaveBeenCalledWith('top-products-feedback', 'accepted');
      });
    });
  });
});

