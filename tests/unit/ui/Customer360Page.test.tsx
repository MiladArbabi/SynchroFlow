// tests/unit/ui/Customer360Page.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import Customer360Page from 'pages/Customer360Page.tsx';

// Mock react-router-dom hooks
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ id: 'cust_abc' }), // Mock customer ID
}));

// --- ADD MOCKS FOR INTEGRATED COMPONENTS ---
jest.mock('components/Customer360/CustomerProfile.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="customer-profile-mock">Profile Component</div>,
}));
jest.mock('components/Customer360/CustomerKeyMetrics.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="customer-metrics-mock">Metrics Component</div>,
}));
jest.mock('components/Customer360/CustomerOrderHistory.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="order-history-mock">Order History Component</div>,
}));
jest.mock('components/Customer360/CustomerSupportHistory.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="support-history-mock">Support History Component</div>,
 }));

describe('Customer360Page Shell (#325)', () => {
  it('should render placeholders for all main sections', () => {
    renderWithProviders(<Customer360Page />);

    // This test is RED.
    // It will FAIL: Cannot find module 'pages/Customer360Page.tsx'

    // Assertions for integrated components (using mocks):
    expect(screen.getByTestId('customer-profile-mock')).toBeInTheDocument();
    expect(screen.getByTestId('customer-metrics-mock')).toBeInTheDocument();
    expect(screen.getByTestId('order-history-mock')).toBeInTheDocument();
    expect(screen.getByTestId('support-history-mock')).toBeInTheDocument();

    // Check for customer ID rendering
    expect(screen.getByText(/Details for Customer #cust_abc/i)).toBeInTheDocument();
  });
});