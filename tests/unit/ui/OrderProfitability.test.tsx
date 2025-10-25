// tests/unit/ui/OrderProfitability.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import OrderProfitability from 'widgets/OrderProfitability/index.tsx';

// Mock MainCard
jest.mock('ui-component/cards/MainCard', () => ({
  __esModule: true,
  // Pass children through so we can find the rendered text
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="main-card-mock">{children}</div>
  ),
}));

describe('OrderProfitability Widget (#289)', () => {
  const mockData = {
    revenue: 149.99,
    cogs: 62.50,
    shippingCost: 12.00,
    fees: 4.50,
    margin: 70.99,
    marginPercent: 47.3, // As a number, e.g., 47.3 for 47.3%
  };

  it('should render the profitability metrics correctly formatted', () => {
    renderWithProviders(<OrderProfitability data={mockData} />);

    // This test is RED.
    // It will FAIL: Cannot find module 'widgets/OrderProfitability/index.tsx'

    // Assertions for when the component exists:
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('$150')).toBeInTheDocument(); // Check formatting (rounded currency)

    expect(screen.getByText('COGS')).toBeInTheDocument();
    expect(screen.getByText('$63')).toBeInTheDocument(); // Check formatting

    expect(screen.getByText('Margin')).toBeInTheDocument();
    // Check for both value and percentage
    expect(screen.getByText('$71 (47%)')).toBeInTheDocument();
  });

  it('should handle missing data gracefully', () => {
    // Render without data or with partial data if needed
    renderWithProviders(<OrderProfitability data={null} />);

    // Example: Assert placeholder text or loading state
    expect(screen.getByText('Profitability data unavailable.')).toBeInTheDocument();
  });
});