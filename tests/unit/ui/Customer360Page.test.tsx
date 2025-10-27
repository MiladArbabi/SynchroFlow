// tests/unit/ui/Customer360Page.test.tsx
import { screen, waitFor } from '@testing-library/react';
// Remove userEvent if not clicking anything in this test yet
// import userEvent from '@testing-library/user-event';
import { renderWithProviders } from 'test-utils';
import Customer360Page from 'pages/Customer360Page.tsx';

// Mock axios - This is what we control
import axios from 'axios';
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock react-router-dom hooks
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ id: 'cust_abc' }), // Mock customer ID
}));

// --- Mocks for Child Components Rendered by Customer360Page ---
jest.mock('components/Customer360/CustomerProfile.tsx', () => ({
  __esModule: true,
  default: ({ customer }: { customer: any }) => (
      <div data-testid="customer-profile-mock">Name: {customer?.name ?? 'N/A'}</div>
  ),
}));
jest.mock('components/Customer360/CustomerKeyMetrics.tsx', () => ({
  __esModule: true,
  default: ({ metrics }: { metrics: any }) => (
      <div data-testid="customer-metrics-mock">LTV: {metrics?.ltv ?? 'N/A'}</div>
  ),
}));
jest.mock('components/Customer360/CustomerOrderHistory.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="order-history-mock">Order History (Static)</div>,
}));
jest.mock('components/Customer360/CustomerSupportHistory.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="support-history-mock">Support History (Static)</div>,
}));
// --- End Child Component Mocks ---

// --- Test Data ---
const mockApiResponse = {
    id: 'cust_abc',
    profile: {
      name: 'Live John Doe',
      email: 'live.john@example.com',
      // ... other profile fields
    },
    metrics: {
      ltv: 2500.00,
      aov: 125.00,
      // ... other metrics fields
    }
};
// --- End Test Data ---

describe('Customer360Page with useQuery (#352)', () => {

    beforeEach(() => {
      // Reset mocks before each test
      mockedAxios.get.mockReset();

      // Default SUCCESS mock for axios.get targeting the customer ID endpoint
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url === `/api/v1/customers/cust_abc`) {
            return { data: mockApiResponse };
        }
        // Add fallbacks for other endpoints if needed by dependencies, or throw error
        throw new Error(`Unhandled axios GET request: ${url}`);
      });
    });

    it('should render loading state initially, then fetch data and pass to children', async () => {
        renderWithProviders(<Customer360Page />);

        // 1. Check title rendering
        expect(screen.getByText(/Details for Customer #cust_abc/i)).toBeInTheDocument();

        // 2. Check for loading state initially
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(screen.queryByTestId('customer-profile-mock')).not.toBeInTheDocument(); // Data not loaded yet

        // 3. Wait for API call to have been made
        await waitFor(() => {
          expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/customers/cust_abc');
        });

        // 4. Wait for child components to render with data
        expect(await screen.findByText(/Name: Live John Doe/i)).toBeInTheDocument();
        expect(await screen.findByText(/LTV: 2500/i)).toBeInTheDocument();

        // 5. Verify loading spinner is gone
        await waitFor(() => {
            expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        });

        // 6. Ensure static components are still rendered
        expect(screen.getByTestId('order-history-mock')).toBeInTheDocument();
        expect(screen.getByTestId('support-history-mock')).toBeInTheDocument();
    });


     it('should render error state', async () => {
        // Override axios mock to reject for this specific test case
        const mockError = new Error('Load failed');
        mockedAxios.get.mockRejectedValueOnce(mockError);

        renderWithProviders(<Customer360Page />);

        // Assert error message is displayed (use findBy* to wait)
        expect(await screen.findByText(/Failed to load customer data: Load failed/i)).toBeInTheDocument();

        // Assert data-dependent components are NOT shown
        expect(screen.queryByTestId('customer-profile-mock')).not.toBeInTheDocument();
        expect(screen.queryByTestId('customer-metrics-mock')).not.toBeInTheDocument();

        // Assert loading spinner is gone
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

        // MODIFICATION: Assert static components are ALSO not rendered in error state
        // because the main conditional block prevents the Grid container from rendering
        expect(screen.queryByTestId('order-history-mock')).not.toBeInTheDocument();
        expect(screen.queryByTestId('support-history-mock')).not.toBeInTheDocument();
    });
});