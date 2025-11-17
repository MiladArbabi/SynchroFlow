// tests/unit/ui/widgets/CashFlowSnapshotWidget.test.tsx
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';

// Mock the components and hooks
jest.mock('components/widgets/types', () => ({
  EnhancedWidgetShellProps: jest.requireActual('components/widgets/types').EnhancedWidgetShellProps,
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Import after mocks
import { CashFlowSnapshotWidget } from 'components/widgets/CashFlowSnapshotWidget';
import { useAuth } from 'contexts/AuthContext';
import { renderWithProviders } from 'test-utils';
import { EnhancedWidgetShellProps } from 'components/widgets/types';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// Mock props for the widget
const mockProps: EnhancedWidgetShellProps = {
  id: 'cash-flow',
  title: 'Cash Flow',
  intelligenceLevel: 'L3',
  businessContext: { stage: 'survival', burningPriority: 'cash-flow' },
  metricConfig: { type: 'financial' },
  currentValue: 15420,
  format: 'currency',
  isLoading: false,
  isEmpty: false,
  children: <div>Test Children</div>,
};

describe('CashFlowSnapshotWidget', () => {
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
    });
  });

  describe('Data Fetching', () => {
    it('should fetch cash flow data from the pulse API', async () => {
      const mockPulseData = {
        totalRevenue: 15420,
        orderCount: 15,
        unfulfilledCount: 3,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/dashboard/pulse', {
          headers: {
            Authorization: 'Bearer mock-token-123',
          },
        });
      });
    });

    it('should only fetch data when access token is available', () => {
      mockUseAuth.mockReturnValue({
        accessToken: null,
        isLoggedIn: false,
        login: jest.fn(),
        logout: jest.fn(),
        user: null,
        setAccessToken: function (_token: string | null): void {
          throw new Error('Function not implemented.');
        },
        isLoading: false
      });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('Rendering States', () => {
    it('should display loading skeleton when data is loading', () => {
      mockedAxios.get.mockImplementation(() => new Promise(() => {})); // Never resolves

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    it('should display cash flow data when successfully loaded', async () => {
      const mockPulseData = {
        totalRevenue: 15420,
        orderCount: 15,
        unfulfilledCount: 3,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('$15,420')).toBeInTheDocument();
      });
      
      expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
      expect(screen.getByTestId('AccountBalanceWalletIcon')).toBeInTheDocument();
    });

    it('should display empty state when no revenue data is available', async () => {
      const mockPulseData = {
        totalRevenue: 0,
        orderCount: 0,
        unfulfilledCount: 0,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('No cash flow data available')).toBeInTheDocument();
      });
    });

    it('should display error state when API call fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Error loading cash flow data')).toBeInTheDocument();
      });
    });
  });

  describe('Currency Formatting', () => {
    it('should format positive revenue correctly', async () => {
      const mockPulseData = {
        totalRevenue: 2500,
        orderCount: 5,
        unfulfilledCount: 1,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('$2,500')).toBeInTheDocument();
      });
    });

    it('should format negative revenue correctly and show critical alert', async () => {
      const mockPulseData = {
        totalRevenue: -500,
        orderCount: 2,
        unfulfilledCount: 0,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('-$500')).toBeInTheDocument();
        expect(screen.getByText('Critical: Negative Cash Flow')).toBeInTheDocument();
      });
    });

    it('should handle very large revenue numbers', async () => {
      const mockPulseData = {
        totalRevenue: 1250000,
        orderCount: 250,
        unfulfilledCount: 12,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('$1,250,000')).toBeInTheDocument();
      });
    });
  });

  describe('Visual Indicators', () => {
    it('should show green wallet icon for positive revenue', async () => {
      const mockPulseData = {
        totalRevenue: 1000,
        orderCount: 10,
        unfulfilledCount: 2,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        const walletIcon = screen.getByTestId('AccountBalanceWalletIcon');
        expect(walletIcon).toHaveStyle('color: var(--palette-success-main)');
      });
    });

    it('should show red wallet icon for negative revenue', async () => {
      const mockPulseData = {
        totalRevenue: -100,
        orderCount: 2,
        unfulfilledCount: 0,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        const walletIcon = screen.getByTestId('AccountBalanceWalletIcon');
        expect(walletIcon).toHaveStyle('color: var(--palette-error-main)');
      });
    });
  });

  describe('Error Scenarios', () => {
    it('should handle API 401 unauthorized errors', async () => {
      const error = new Error('Unauthorized');
      (error as any).response = { status: 401 };
      mockedAxios.get.mockRejectedValueOnce(error);

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} /> );

      await waitFor(() => {
        expect(screen.getByText('Error loading cash flow data')).toBeInTheDocument();
      });
    });

    it('should handle API 500 server errors', async () => {
      const error = new Error('Server error');
      (error as any).response = { status: 500 };
      mockedAxios.get.mockRejectedValueOnce(error);

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Error loading cash flow data')).toBeInTheDocument();
      });
    });

    it('should handle network timeout errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('timeout of 5000ms exceeded'));

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Error loading cash flow data')).toBeInTheDocument();
      });
    });
  });

  describe('Integration with Widget System', () => {
    it('should pass correct props to EnhancedWidgetShell', async () => {
      const mockPulseData = {
        totalRevenue: 5000,
        orderCount: 8,
        unfulfilledCount: 1,
      };
      
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });

      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      await waitFor(() => {
        // Verify the widget integrates properly with the shell
        expect(screen.getByText('$5,000')).toBeInTheDocument();
      });
    });
  });

  describe('Loading State Behavior', () => {
    test('should show loading skeleton immediately on initial render', () => {
      mockedAxios.get.mockImplementation(() => new Promise(() => {}));
      
      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    });

    test('should show loading skeleton for minimum time to prevent flicker', async () => {
      const mockPulseData = {
        totalRevenue: 15420,
        orderCount: 15,
        unfulfilledCount: 1,
      };
      mockedAxios.get.mockResolvedValueOnce({ data: mockPulseData });
      
      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      await waitFor(() => {
        expect(screen.getByText('$15,420')).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });

    test('should maintain loading state during entire API call duration', async () => {
      let resolveApi: (value: any) => void;
      const apiPromise = new Promise(resolve => {
        resolveApi = resolve;
      });
      
      mockedAxios.get.mockImplementation(() => apiPromise);
      
      renderWithProviders(<CashFlowSnapshotWidget {...mockProps} />);

      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      
      setTimeout(() => {
        resolveApi({ 
          data: {
            totalRevenue: 5000,
            orderCount: 8,
            unfulfilledCount: 1,
          }
        });
      }, 100);
      
      await waitFor(() => {
        expect(screen.getByText('$5,000')).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
    });
  });
});