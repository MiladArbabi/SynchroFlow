// tests/unit/ui/CustomerKeyMetrics.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import CustomerKeyMetrics from 'components/Customer360/CustomerKeyMetrics.tsx';

// Define mock data structure
const mockMetrics = {
  ltv: 1204.50,
  aov: 110.40,
  totalOrders: 11,
  totalMargin: 550.25, // Example
  lastOrderDate: '2025-10-15T09:30:00Z',
};

describe('CustomerKeyMetrics Component (#327)', () => {
  it('should render key customer metrics correctly formatted', () => {
    renderWithProviders(<CustomerKeyMetrics metrics={mockMetrics} />);

    // This test is RED.
    // It will FAIL: Cannot find module 'components/Customer360/CustomerKeyMetrics.tsx'

    // Assertions for when the component exists:
    expect(screen.getByText(/Lifetime Value/i)).toBeInTheDocument();
    expect(screen.getByText('$1,205')).toBeInTheDocument(); // Check formatting

    expect(screen.getByText(/Avg. Order Value/i)).toBeInTheDocument();
    expect(screen.getByText('$110')).toBeInTheDocument(); // Check formatting

    expect(screen.getByText(/Total Orders/i)).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();

    expect(screen.getByText(/Total Margin/i)).toBeInTheDocument();
    expect(screen.getByText('$550')).toBeInTheDocument(); // Check formatting

    expect(screen.getByText(/Last Order/i)).toBeInTheDocument();
    // Check for a reasonable date format (exact format depends on implementation)
    expect(screen.getByText(/Oct 15, 2025/i)).toBeInTheDocument();
  });

  it('should handle missing or partial data gracefully', () => {
    renderWithProviders(<CustomerKeyMetrics metrics={null} />);

    expect(screen.getByText(/Metrics data unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Lifetime Value/i)).not.toBeInTheDocument();
  });
});