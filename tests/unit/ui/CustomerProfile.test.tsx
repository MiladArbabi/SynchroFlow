// tests/unit/ui/CustomerProfile.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import CustomerProfile from 'components/Customer360/CustomerProfile.tsx';

// Define mock data structure (adjust as needed)
const mockCustomer = {
  name: 'John Doe',
  email: 'john.doe@example.com',
  phone: '555-1234',
  tags: ['VIP', 'High Return Rate'],
  shippingAddress: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '12345',
    country: 'USA',
  },
  billingAddress: { // Example: Billing same as shipping
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '12345',
    country: 'USA',
  },
  accountCreated: '2024-01-15T10:00:00Z',
  source: 'Shopify',
};

describe('CustomerProfile Component (#326)', () => {
  it('should render customer profile details', () => {
    renderWithProviders(<CustomerProfile customer={mockCustomer} />);

    // This test is RED.
    // It will FAIL: Cannot find module 'components/Customer360/CustomerProfile.tsx'

    // Assertions for when the component exists:
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
    expect(screen.getByText('555-1234')).toBeInTheDocument();

    // Check for address details (parts of it)
    expect(screen.getByText(/123 Main St/i)).toBeInTheDocument(); // Shipping
    expect(screen.getByText(/123 Main St, Anytown, CA, 12345, USA/i)).toBeInTheDocument();

    // Check for tags
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('High Return Rate')).toBeInTheDocument();
  });

  it('should handle missing or partial data gracefully', () => {
    renderWithProviders(<CustomerProfile customer={null} />);
    // Or render with partial data: <CustomerProfile customer={{ name: 'Jane Doe' }} />

    // Assert placeholder or absence of elements
    expect(screen.getByText(/Profile data unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
  });
});