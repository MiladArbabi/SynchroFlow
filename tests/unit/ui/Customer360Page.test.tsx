// tests/unit/ui/Customer360Page.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import Customer360Page from 'pages/Customer360Page.tsx';

// Mock react-router-dom hooks
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ id: 'cust_abc' }), // Mock customer ID
}));

describe('Customer360Page Shell (#325)', () => {
  it('should render placeholders for all main sections', () => {
    renderWithProviders(<Customer360Page />);

    // This test is RED.
    // It will FAIL: Cannot find module 'pages/Customer360Page.tsx'

    // Assertions for when the component exists:
    expect(screen.getByText(/Customer Profile Placeholder/i)).toBeInTheDocument();
    expect(screen.getByText(/Key Metrics Placeholder/i)).toBeInTheDocument();
    expect(screen.getByText(/Order History Placeholder/i)).toBeInTheDocument();
    expect(screen.getByText(/Support History Placeholder/i)).toBeInTheDocument();

    // Check for customer ID rendering
    expect(screen.getByText(/Details for Customer #cust_abc/i)).toBeInTheDocument();
  });
});