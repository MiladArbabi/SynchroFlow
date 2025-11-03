//tests/unit/ui/components/OpsCommandCenter/ConfirmationDialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpsAction } from 'components/OpsCommandCenter/types';

// This import will fail
import { ConfirmationDialog } from 'components/OpsCommandCenter/ConfirmationDialog';

// Mock data
const mockAction: OpsAction = {
  id: '3',
  name: 'Refund Order',
  category: 'destructive',
  context: { pages: ['*'] },
  execute: async () => ({ success: true, message: 'Admin action!' }),
  keywords: [],
  description: '',
  confirmationMessage: 'Are you sure you want to refund?',
};

const mockOnConfirm = jest.fn();
const mockOnCancel = jest.fn();

describe('ConfirmationDialog', () => {
  beforeEach(() => {
    mockOnConfirm.mockClear();
    mockOnCancel.mockClear();
  });

  it('should not render when isOpen is false', () => {
    render(
      <ConfirmationDialog
        isOpen={false}
        action={mockAction}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />,
    );
    
    // We query, as getBy would throw an error
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should render with correct content when isOpen is true', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        action={mockAction}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />,
    );

    // Check for the title (using the action name)
    expect(screen.getByRole('heading', { name: /Confirm: Refund Order/i })).toBeInTheDocument();
    
    // Check for the confirmation message
    expect(screen.getByText('Are you sure you want to refund?')).toBeInTheDocument();
    
    // Check for buttons
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('should call onConfirm when "Confirm" button is clicked', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        action={mockAction}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('should call onCancel when "Cancel" button is clicked', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        action={mockAction}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });
});