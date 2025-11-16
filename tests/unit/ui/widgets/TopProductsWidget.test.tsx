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
});