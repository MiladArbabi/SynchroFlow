//tests/unit/ui/components/OpsCommandCenter/InterpretationBanner.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpsAction } from 'components/OpsCommandCenter/types';
import { Intent } from 'components/OpsCommandCenter/naturalLanguage/types';
import { InterpretationBanner } from 'components/OpsCommandCenter/InterpretationBanner';

// Mock data
const mockAction: OpsAction = {
  id: 'find-orders-nlp',
  name: 'Find orders with status "unfulfilled"',
  category: 'analytical',
  context: { pages: ['*'] },
  execute: async () => ({ success: true, message: 'Executed' }),
  keywords: [],
  description: 'Dynamic action',
};

const mockInterpretation = {
  originalQuery: 'show me unfulfilled orders',
  interpretedAction: mockAction,
  intent: {} as Intent,
  confidence: 0.9,
};

const mockOnExecute = jest.fn();
const mockOnCancel = jest.fn();

describe('InterpretationBanner', () => {
  beforeEach(() => {
    mockOnExecute.mockClear();
    mockOnCancel.mockClear();
  });

  it('should render the interpreted action name', () => {
    render(
      <InterpretationBanner
        interpretation={mockInterpretation}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
      />
    );

    // It should show the *name* of the action it's about to run
    expect(
      screen.getByText('Find orders with status "unfulfilled"'),
    ).toBeInTheDocument();
  });

  it('should call onExecute when the "Execute" button is clicked', () => {
    render(
      <InterpretationBanner
        interpretation={mockInterpretation}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    expect(mockOnExecute).toHaveBeenCalledTimes(1);
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('should call onCancel when the "Cancel" button is clicked', () => {
    render(
      <InterpretationBanner
        interpretation={mockInterpretation}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
    expect(mockOnExecute).not.toHaveBeenCalled();
  });
});