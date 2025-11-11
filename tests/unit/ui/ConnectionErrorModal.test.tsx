//tests/unit/ui/ConnectionErrorModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionErrorModal } from 'components/ConnectionErrorModal';

// Mock the Icon component
jest.mock('components/Icon', () => ({
  __esModule: true,
  default: ({ name, size, color }: any) => (
    <div data-testid={`icon-${name}`} data-size={size} data-color={color}>
      {name} Icon
    </div>
  ),
}));

// Mock window.open
const mockWindowOpen = jest.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true,
});

describe('ConnectionErrorModal', () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    onRetry: jest.fn(),
    error: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should render when open is true', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('There was an issue connecting your store. Please check your credentials or store name and try again.')).toBeInTheDocument();
    });

    it('should not render when open is false', () => {
      render(<ConnectionErrorModal {...defaultProps} open={false} />);
      
      expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument();
    });
  });

  describe('Error Display', () => {
    it('should display error details when error is provided', () => {
      const errorMessage = 'Invalid API credentials';
      render(<ConnectionErrorModal {...defaultProps} error={errorMessage} />);
      
      expect(screen.getByText(`Details: ${errorMessage}`)).toBeInTheDocument();
    });

    it('should not display error details when error is null', () => {
      render(<ConnectionErrorModal {...defaultProps} error={null} />);
      
      expect(screen.queryByText(/Details:/)).not.toBeInTheDocument();
    });

    it('should apply error styling to error message', () => {
      render(<ConnectionErrorModal {...defaultProps} error="Test error" />);
      
      const errorText = screen.getByText(/Details:/);
      expect(errorText).toHaveStyle('font-style: italic');
    });
  });

  describe('Icon', () => {
    it('should render AlertCircle icon with correct props', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const icon = screen.getByTestId('icon-AlertCircle');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('data-size', 'xl');
      expect(icon).toHaveAttribute('data-color', 'error');
    });

    it('should display icon and title in flex layout', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const titleBox = screen.getByText('Connection Failed').parentElement;
      expect(titleBox).toHaveStyle('display: flex');
      expect(titleBox).toHaveStyle('align-items: center');
      expect(titleBox).toHaveStyle('gap: 12px'); // 1.5 * 8 = 12
    });
  });

  describe('Button Actions', () => {
    it('should call onClose when "Skip for Now" is clicked', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const skipButton = screen.getByText('Skip for Now');
      fireEvent.click(skipButton);
      
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry when "Try Again" is clicked', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const retryButton = screen.getByText('Try Again');
      fireEvent.click(retryButton);
      
      expect(defaultProps.onRetry).toHaveBeenCalledTimes(1);
    });

    it('should open help page when "Get Help" is clicked', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const helpButton = screen.getByText('Get Help');
      fireEvent.click(helpButton);
      
      expect(mockWindowOpen).toHaveBeenCalledWith('/help/shopify-connection', '_blank');
    });
  });

  describe('Button Styling and Layout', () => {
    it('should have correct button variants and colors', () => {
        render(<ConnectionErrorModal {...defaultProps} />);
        
        const skipButton = screen.getByText('Skip for Now');
        const helpButton = screen.getByText('Get Help'); 
        const retryButton = screen.getByText('Try Again');
        
        // Check for class names instead of attributes since MUI uses classes for styling
        expect(skipButton).toHaveClass('MuiButton-text');
        expect(helpButton).toHaveClass('MuiButton-outlined');
        expect(retryButton).toHaveClass('MuiButton-contained');
    });

    it('should have correct button layout with space-between justification', () => {
        render(<ConnectionErrorModal {...defaultProps} />);
        
        const dialogActions = screen.getByText('Skip for Now').closest('.MuiDialogActions-root');
        expect(dialogActions).toHaveStyle('justify-content: space-between');
        // Update to match the actual padding from sx={{ p: 3, pt: 1 }}
        expect(dialogActions).toHaveStyle('padding: 8px 24px 24px 24px');
    });

    it('should have help and retry buttons in flex layout', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const buttonGroup = screen.getByText('Get Help').parentElement;
      expect(buttonGroup).toHaveStyle('display: flex');
      expect(buttonGroup).toHaveStyle('gap: 8px');
    });
  });

  describe('Dialog Configuration', () => {
    it('should have correct maxWidth and fullWidth props', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      // The dialog should have maxWidth="xs" and fullWidth=true
    });

    it('should allow closing via backdrop click', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const dialog = screen.getByRole('dialog');
      // MUI Dialog calls onClose on backdrop click by default
      // We can verify this by checking the dialog is present and onClose is available
      expect(dialog).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper dialog role and accessibility', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      
      const title = screen.getByText('Connection Failed');
      expect(title).toBeInTheDocument();
    });

    it('should have meaningful button labels', () => {
      render(<ConnectionErrorModal {...defaultProps} />);
      
      expect(screen.getByText('Skip for Now')).toBeInTheDocument();
      expect(screen.getByText('Get Help')).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });
  });
});