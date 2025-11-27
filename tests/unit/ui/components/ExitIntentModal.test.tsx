// tests/unit/ui/components/ExitIntentModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ExitIntentModal } from 'components/ExitIntentModal';

// Mock the useExitIntent hook
jest.mock('hooks/useExitIntent', () => ({
  useExitIntent: jest.fn(),
}));

const mockUseExitIntent = require('hooks/useExitIntent').useExitIntent as jest.Mock;

describe('ExitIntentModal', () => {
  const mockOnClose = jest.fn();
  const mockOnAccept = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Set default mock implementation
    mockUseExitIntent.mockReturnValue({
      exitIntentDetected: true,
      shouldShowOffer: true,
      resetExitIntent: jest.fn(),
      intentScore: 75,
      intentLevel: 'high',
    });
  });

  it('should render when exit intent is detected', () => {
    render(
      <ExitIntentModal 
        onClose={mockOnClose}
        onAccept={mockOnAccept}
        offer="10% OFF"
      />
    );

    expect(screen.getByText(/don't go yet!/i)).toBeInTheDocument();
    expect(screen.getByText(/10% OFF/i)).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    render(
      <ExitIntentModal 
        onClose={mockOnClose}
        onAccept={mockOnAccept}
        offer="10% OFF"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should call onAccept when offer is accepted', () => {
    render(
      <ExitIntentModal 
        onClose={mockOnClose}
        onAccept={mockOnAccept}
        offer="10% OFF"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /yes, claim my offer/i }));
    expect(mockOnAccept).toHaveBeenCalledTimes(1);
  });

  it('should display dynamic offer text', () => {
    render(
      <ExitIntentModal 
        onClose={mockOnClose}
        onAccept={mockOnAccept}
        offer="Free Shipping"
      />
    );

    expect(screen.getByText(/free shipping/i)).toBeInTheDocument();
  });

  it('should not render when exit intent is not detected', () => {
    // Override for this specific test
    mockUseExitIntent.mockReturnValue({
      exitIntentDetected: false,
      shouldShowOffer: false,
      resetExitIntent: jest.fn(),
      intentScore: 0,
      intentLevel: 'low',
    });

    render(
      <ExitIntentModal 
        onClose={mockOnClose}
        onAccept={mockOnAccept}
        offer="10% OFF"
      />
    );

    expect(screen.queryByText(/don't go yet!/i)).not.toBeInTheDocument();
  });

describe('ExitIntentModal - Edge Cases', () => {
    it('should call resetExitIntent on close', () => {
        const mockResetExitIntent = jest.fn();
        mockUseExitIntent.mockReturnValue({
        exitIntentDetected: true,
        shouldShowOffer: true,
        resetExitIntent: mockResetExitIntent,
        intentScore: 75,
        intentLevel: 'high',
        });

        render(
        <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer="10% OFF"
        />
        );

        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        
        expect(mockResetExitIntent).toHaveBeenCalledTimes(1);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call resetExitIntent on offer acceptance', () => {
        const mockResetExitIntent = jest.fn();
        mockUseExitIntent.mockReturnValue({
        exitIntentDetected: true,
        shouldShowOffer: true,
        resetExitIntent: mockResetExitIntent,
        intentScore: 75,
        intentLevel: 'high',
        });

        render(
        <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer="10% OFF"
        />
        );

        fireEvent.click(screen.getByRole('button', { name: /yes, claim my offer/i }));
        
        expect(mockResetExitIntent).toHaveBeenCalledTimes(1);
        expect(mockOnAccept).toHaveBeenCalledWith('10% OFF');
    });

    it('should handle very long offer text gracefully', () => {
        const longOffer = '50% OFF EVERYTHING PLUS FREE EXPRESS SHIPPING AND A FREE GIFT WITH YOUR ORDER!';
        
        render(
        <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer={longOffer}
        />
        );

        expect(screen.getByText(longOffer)).toBeInTheDocument();
        // Should not break layout or overflow
        expect(screen.getByText(longOffer).parentElement).toBeVisible();
    });

    it('should handle special characters in offer text', () => {
        const specialOffer = '25% OFF + FREE 🚀 SHIPPING! 🎉';
        
        render(
        <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer={specialOffer}
        />
        );

        expect(screen.getByText(specialOffer)).toBeInTheDocument();
    });

    it('should be accessible with proper ARIA labels', () => {
        render(
        <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer="10% OFF"
        />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByLabelText(/don't go yet/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /yes, claim my offer/i })).toBeInTheDocument();
    });

    it('should handle rapid consecutive opens and closes', () => {
        const { rerender } = render(
        <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer="10% OFF"
        />
        );

        // Rapidly toggle the modal
        for (let i = 0; i < 3; i++) {
        // Hide modal
        mockUseExitIntent.mockReturnValue({
            exitIntentDetected: false,
            shouldShowOffer: false,
            resetExitIntent: jest.fn(),
        });
        rerender(
            <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer="10% OFF"
            />
        );

        // Show modal
        mockUseExitIntent.mockReturnValue({
            exitIntentDetected: true,
            shouldShowOffer: true,
            resetExitIntent: jest.fn(),
        });
        rerender(
            <ExitIntentModal 
            onClose={mockOnClose}
            onAccept={mockOnAccept}
            offer="10% OFF"
            />
        );
        }

        // Should handle without errors
        expect(screen.getByText(/don't go yet!/i)).toBeInTheDocument();
    });
    });
});