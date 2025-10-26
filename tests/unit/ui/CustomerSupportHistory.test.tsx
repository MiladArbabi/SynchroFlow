// tests/unit/ui/CustomerSupportHistory.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import CustomerSupportHistory from 'components/Customer360/CustomerSupportHistory.tsx';

// Define mock data structure
const mockTickets = [
  { id: 'TKT-501', subject: 'Question about Shipping', date: '2025-10-25T11:00:00Z', status: 'Pending' },
  { id: 'TKT-498', subject: 'Return Request - SF-TS-BLK-M', date: '2025-10-22T16:30:00Z', status: 'Resolved' },
];

describe('CustomerSupportHistory Component (#329)', () => {
  it('should render a list of support tickets', () => {
    renderWithProviders(<CustomerSupportHistory tickets={mockTickets} />);

    // This test is RED.
    // It will FAIL: Cannot find module 'components/Customer360/CustomerSupportHistory.tsx'

    // Assertions for when the component exists:
    // Check for ticket IDs/Subjects
    expect(screen.getByText('TKT-501')).toBeInTheDocument();
    expect(screen.getByText(/Question about Shipping/i)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument(); // Status Chip

    expect(screen.getByText('TKT-498')).toBeInTheDocument();
    expect(screen.getByText(/Return Request/i)).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument(); // Status Chip

    // Check for formatted dates
    expect(screen.getByText(/Oct 25, 2025/i)).toBeInTheDocument();
    expect(screen.getByText(/Oct 22, 2025/i)).toBeInTheDocument();
  });

  it('should render empty state if no tickets provided', () => {
    renderWithProviders(<CustomerSupportHistory tickets={[]} />);
    expect(screen.getByText(/No support history available/i)).toBeInTheDocument();
    expect(screen.queryByText('TKT-501')).not.toBeInTheDocument();
  });

   it('should render loading state', () => {
     renderWithProviders(<CustomerSupportHistory tickets={undefined} isLoading={true} />);
     expect(screen.getByRole('progressbar')).toBeInTheDocument();
     expect(screen.queryByText('TKT-501')).not.toBeInTheDocument();
  });
});