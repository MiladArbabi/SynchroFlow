//tests/unit/ui/components/OpsCommandCenter/OpsResultsList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpsAction } from 'components/OpsCommandCenter/types';

// This import will fail
import { OpsResultsList } from 'components/OpsCommandCenter/OpsResultsList';

// Create mock data
const mockActions: OpsAction[] = [
  {
    id: '1',
    name: 'Find Order',
    description: 'Look up a specific order',
    keywords: [],
    category: 'analytical',
    context: { pages: ['*'] },
    execute: async () => ({ success: true, message: 'Executed' }),
  },
  {
    id: '2',
    name: 'Find Customer',
    description: 'Look up a specific customer',
    keywords: [],
    category: 'analytical',
    context: { pages: ['*'] },
    execute: async () => ({ success: true, message: 'Executed' }),
  },
];

// Create a mock callback function
const mockOnCommandSelect = jest.fn();

describe('OpsResultsList', () => {
  beforeEach(() => {
    mockOnCommandSelect.mockClear();
  });

  it('should render a list of commands', () => {
    render(
      <OpsResultsList
        commands={mockActions}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // Check that both items are rendered
    expect(screen.getByText('Find Order')).toBeInTheDocument();
    expect(screen.getByText('Look up a specific order')).toBeInTheDocument();
    expect(screen.getByText('Find Customer')).toBeInTheDocument();
    expect(screen.getByText('Look up a specific customer')).toBeInTheDocument();
  });

  it('should call onCommandSelect when an item is clicked', () => {
    render(
      <OpsResultsList
        commands={mockActions}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // Click the second item ("Find Customer")
    fireEvent.click(screen.getByText('Find Customer'));

    // Verify the callback was called with the correct action object
    expect(mockOnCommandSelect).toHaveBeenCalledTimes(1);
    expect(mockOnCommandSelect).toHaveBeenCalledWith(mockActions[1]);
  });

  it('should highlight the selected item based on selectedIndex', () => {
    render(
      <OpsResultsList
        commands={mockActions}
        selectedIndex={1} // Select the second item
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // Get the list item by its role. The selected one should have 'aria-selected=true'
    const listItems = screen.getAllByRole('listitem');
    
    // The first item should NOT be selected
    expect(listItems[0]).not.toHaveAttribute('aria-selected', 'true');

    // The second item ("Find Customer") SHOULD be selected
    expect(listItems[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('should render a "no results" message if commands array is empty', () => {
    render(
      <OpsResultsList
        commands={[]} // Pass an empty array
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    expect(screen.getByText('No actions found.')).toBeInTheDocument();
  });
});