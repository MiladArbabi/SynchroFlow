//tests/unit/ui/components/OpsCommandCenter/OpsClarificationList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClarificationOption } from 'components/OpsCommandCenter/naturalLanguage/types';

// This import will fail
import { OpsClarificationList } from 'components/OpsCommandCenter/OpsClarificationList';
// Mock data
const mockOptions: ClarificationOption[] = [
  {
    label: "Show orders from yesterday?",
    intent: { name: 'find-orders', confidence: 0.9, entities: { date: 'yesterday' } }
  },
  {
    label: "Show customers created yesterday?",
    intent: { name: 'customer-lookup', confidence: 0.9, entities: { date: 'yesterday' } }
  }
];

const mockOnSelect = jest.fn();

describe('OpsClarificationList', () => {
  beforeEach(() => {
    mockOnSelect.mockClear();
  });

  it('should render the header and all options', () => {
    render(
      <OpsClarificationList
        options={mockOptions}
        onSelect={mockOnSelect}
      />
    );
    
    // Check for the header
    expect(screen.getByText('What did you mean?')).toBeInTheDocument();

    // Check for both option labels
    expect(screen.getByText('Show orders from yesterday?')).toBeInTheDocument();
    expect(screen.getByText('Show customers created yesterday?')).toBeInTheDocument();
  });

  it('should call onSelect with the correct option when clicked', () => {
    render(
      <OpsClarificationList
        options={mockOptions}
        onSelect={mockOnSelect}
      />
    );

    // Click the second option
    fireEvent.click(screen.getByText('Show customers created yesterday?'));

    // Verify the callback was called with the correct option object
    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(mockOptions[1]);
  });
});