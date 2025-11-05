//tests/unit/ui/components/OpsCommandCenter/OpsProactiveList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProactiveInsight, SuggestedAction } from 'components/OpsCommandCenter/types';

// This import will fail
import { OpsProactiveList } from 'components/OpsCommandCenter/OpsProactiveList';

// Mock data
const mockAction: SuggestedAction = {
  label: 'View Order',
  action: { id: 'nav-order-detail' } as any, // Simplified for test
};

const mockInsights: ProactiveInsight[] = [
  {
    id: 'ins-123',
    type: 'alert',
    title: 'Stale Order Detected',
    message: "Order #1001 has been 'pending' for 3 days.",
    urgency: 'high',
    timestamp: Date.now(),
    source: 'orders',
    status: 'new',
    actionPayload: [],
    suggestedActions: [mockAction], // Add the mock action
  },
  {
    id: 'ins-456',
    type: 'recommendation',
    title: 'Low Inventory',
    message: 'Product "Blue Shirt" is low on stock.',
    urgency: 'medium',
    timestamp: Date.now(),
    source: 'inventory',
    status: 'new',
    actionPayload: [],
    suggestedActions: [],
  },
];

const mockOnActionClick = jest.fn();
const mockOnDismiss = jest.fn();

describe('OpsProactiveList', () => {
  beforeEach(() => {
    mockOnActionClick.mockClear();
    mockOnDismiss.mockClear();
  });

  it('should render the header and all insights', () => {
    render(
      <OpsProactiveList
        insights={mockInsights}
        onActionClick={mockOnActionClick}
        onDismiss={mockOnDismiss}
      />
    );
    
    // Check for the header
    expect(screen.getByText("Kore: Here's what needs your attention:")).toBeInTheDocument();

    // Check for both insight titles
    expect(screen.getByText('Stale Order Detected')).toBeInTheDocument();
    expect(screen.getByText('Low Inventory')).toBeInTheDocument();
    
    // Check for a message
    expect(screen.getByText(/Order #1001/)).toBeInTheDocument();
  });

  it('should call onActionClick when a suggested action is clicked', () => {
    render(
      <OpsProactiveList
        insights={mockInsights}
        onActionClick={mockOnActionClick}
        onDismiss={mockOnDismiss}
      />
    );

    // Click the "View Order" button from the first insight
    fireEvent.click(screen.getByRole('button', { name: 'View Order' }));

    // Verify the callback was called with the correct insight and action
    expect(mockOnActionClick).toHaveBeenCalledTimes(1);
    expect(mockOnActionClick).toHaveBeenCalledWith(mockInsights[0], mockAction);
  });

  it('should call onDismiss when the dismiss button is clicked', () => {
    render(
      <OpsProactiveList
        insights={mockInsights}
        onActionClick={mockOnActionClick}
        onDismiss={mockOnDismiss}
      />
    );

    // Find the dismiss button for the first insight
    const allDismissButtons = screen.getAllByRole('button', { name: 'Dismiss Insight' });
    fireEvent.click(allDismissButtons[0]);

    // Verify the callback was called with the correct insight ID
    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    expect(mockOnDismiss).toHaveBeenCalledWith('ins-123');
  });
});