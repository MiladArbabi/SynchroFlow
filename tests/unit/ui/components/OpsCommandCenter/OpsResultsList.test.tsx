//tests/unit/ui/components/OpsCommandCenter/OpsResultsList.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpsAction, SearchResult } from 'components/OpsCommandCenter/types';
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

// Create mock data for Entities
const mockEntities: SearchResult[] = [
  {
    id: 'e1',
    type: 'order', // Use lowercase 'order' as per types.ts
    title: 'Order #1001',
    description: 'Customer: John Doe',
    url: '/orders/e1', // Add required 'url' property
  },
];

// Create a mock callback function
const mockOnCommandSelect = jest.fn();

describe('OpsResultsList', () => {
  beforeEach(() => {
    // Mock viewport heights for virtualization in jsdom (where default is 0, causing no items to render)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        height: 400,
        width: 300,
        top: 0, left: 0, bottom: 400, right: 300,
      }),
    });
    mockOnCommandSelect.mockClear();
  });

  it('should render a list of commands and entities with headers', () => {
    render(
      <OpsResultsList
        commands={mockActions}
        entities={mockEntities}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}      
      />
    );

    // Check headers
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Entities')).toBeInTheDocument();
    // for scalability
    expect(screen.getByTestId('header-actions')).toBeInTheDocument();
    expect(screen.getByTestId('header-entities')).toBeInTheDocument();

    // Check that both items are rendered
    expect(screen.getByText('Find Order')).toBeInTheDocument();
    expect(screen.getByText('Look up a specific order')).toBeInTheDocument();
    expect(screen.getByText('Find Customer')).toBeInTheDocument();
    expect(screen.getByText('Look up a specific customer')).toBeInTheDocument();

    // Check entity items
    expect(screen.getByText('Order #1001')).toBeInTheDocument();
    expect(screen.getByText('Customer: John Doe')).toBeInTheDocument();
  });

  it('should call onCommandSelect when an item is clicked', () => {
    render(
      <OpsResultsList
        commands={mockActions}
        entities={[]}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}      />
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
        entities={mockEntities} // Pass entities
        selectedIndex={4}
        onCommandSelect={mockOnCommandSelect}     
      />
    );

    // Get the list item by its role. The selected one should have 'aria-selected=true'
    const listItems = screen.getAllByRole('listitem');
    
    // The first item ("Find Order", flat index 1) should NOT be selected
    expect(listItems[0]).not.toHaveAttribute('aria-selected', 'true');
    // The second item ("Find Customer", flat index 2) should NOT be selected
    expect(listItems[1]).not.toHaveAttribute('aria-selected', 'true');

    // The third item ("Order #1001") SHOULD be selected
    expect(listItems[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('should render a "no results" message if commands array is empty', () => {
    render(
      <OpsResultsList
        commands={[]} 
        entities={[]} 
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}      
      />
    );

    expect(screen.getByText('No actions found.')).toBeInTheDocument();
  });

  it('should only render a small subset of items when the list is very large (virtualization)', () => {
    // 1. Arrange: Create a massive list
    const mockLargeEntities: SearchResult[] = Array.from(
      { length: 500 },
      (_, i) => ({
        id: `e${i}`,
        type: 'product', // Use 'product' as per types.ts
        title: `Product #${i + 1}`,
        description: `This is mock product ${i + 1}`,
        url: `/products/e${i}`,
      }),
    );

    // 2. Act: Render the component
    render(
      <OpsResultsList
        commands={[]} // No commands
        entities={mockLargeEntities} // 500 entities
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // 3. Assert: Check how many items are *actually* in the DOM
    // Expect virtualization to render viewport + overscan (~27 items with height 400, item ~58px) <50
    const allListItems = screen.getAllByRole('listitem');

    // This assertion will FAIL (RED)
    // The current code will render 500 items. 500 is not less than 50.
    expect(allListItems.length).toBeLessThan(50);
  });
});