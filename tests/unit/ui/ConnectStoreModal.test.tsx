// tests/unit/ui/ConnectStoreModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
// Correct relative path from tests/unit/ui/ to packages/ui/src/components/
import { ConnectStoreModal } from '../../../packages/ui/src/components/ConnectStoreModal';
import axios from 'axios';

// Mock the onClose function
const mockOnClose = jest.fn();

// Mock the IconComponent to avoid issues with Lucide icons in a unit test
jest.mock(
  '../../../packages/ui/src/components/Icon',
  () =>
    ({ name }: { name: string }) =>
      <span data-testid="icon">{name}</span>
);

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn(() => Promise.resolve({ data: {} }))
}));

describe('ConnectStoreModal - OAuth Flow', () => {
  beforeEach(() => {
    mockOnClose.mockClear();
    (axios.get as jest.Mock).mockClear();
  });

  it('should render the platform selection grid on initial load', () => {
    render(<ConnectStoreModal isOpen={true} onClose={mockOnClose} />);

    // It should NOT find the "Shop Name" field.
    expect(screen.queryByLabelText(/Shop Name/i)).not.toBeInTheDocument();

    // It should find the platform buttons
    expect(screen.getByRole('button', { name: /Shopify/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /QuickBooks/i })
    ).toBeInTheDocument();
  });

  it('should show the Shop Name input after clicking Shopify', () => {
    render(<ConnectStoreModal isOpen={true} onClose={mockOnClose} />);

    // 1. Find the Shopify button
    const shopifyButton = screen.getByRole('button', { name: /Shopify/i });
    fireEvent.click(shopifyButton);

    // 2. Now, the "Shop Name" field should be visible
    expect(screen.getByLabelText(/Shop Name/i)).toBeInTheDocument();

    // 3. And the platform buttons should be gone
    expect(
      screen.queryByRole('button', { name: /Shopify/i })
    ).not.toBeInTheDocument();
  });
});