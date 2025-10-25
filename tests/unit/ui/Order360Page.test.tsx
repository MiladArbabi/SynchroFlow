// tests/unit/ui/Order360Page.test.tsx
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import axios from 'axios';
// This import will fail
import Order360Page from 'pages/Order360Page.tsx';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock ContextPanel
jest.mock('ui-component/ContextPanel/index.tsx', () => ({
  __esModule: true,
  default: ({ tabs }: { tabs: { label: string; content: React.ReactNode }[] }) => (
    <div data-testid="context-panel-mock">
      {/* Render only the first tab's content for simplicity */}
      {tabs[0]?.content}
    </div>
  ),
}));

// Mock WmsStatusStepper
jest.mock('ui-component/WmsStatusStepper/index.tsx', () => ({
  __esModule: true,
  default: ({ currentStatus }: { currentStatus: string }) => (
    <div data-testid="wms-stepper-mock">{currentStatus}</div>
  ),
}));

// Mock react-router-dom hooks
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '54321' }), // Provide a mock order ID
  };
});

describe('Order360Page (#287)', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    // Mock the API response
    mockedAxios.get.mockResolvedValue({
      data: { orderId: '54321', status: 'Picking' },
    });
  });

  it('should fetch order status and render the WmsStatusStepper', async () => {
    renderWithProviders(<Order360Page />);

    // This test is RED.
    // It will FAIL: Cannot find module 'pages/Order360Page.tsx'

    // Assertions for when the component exists:
    // 1. Check for the API call
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/orders/54321/status');
    });

    // Wait for the stepper to appear after loading
    const stepper = await screen.findByTestId('wms-stepper-mock');
    expect(stepper).toHaveTextContent('Picking');
    // Also check that the loading spinner disappears
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});