// tests/unit/ui/components/OpsCommandCenter/OpsResultsList.test.tsx
import { screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpsAction, SearchResult, VirtualItem } from 'components/OpsCommandCenter/types';
import { OpsResultsList } from 'components/OpsCommandCenter/OpsResultsList';
import { renderWithProviders } from 'test-utils';

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = MockResizeObserver;

// Mock @tanstack/react-virtual to avoid virtualization issues in tests
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: jest.fn(),
}));

const { useVirtualizer } = require('@tanstack/react-virtual');

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

const mockEntities: SearchResult[] = [
  {
    id: 'e1',
    type: 'order',
    title: 'Order #1001',
    description: 'Customer: John Doe',
    url: '/orders/e1',
  },
  {
    id: 'e2',
    type: 'customer',
    title: 'Customer Jane Smith',
    description: 'Email: jane@example.com',
    url: '/customers/e2',
  },
];

// Helper to build the 'items' prop
// --- Helper to build the 'items' prop ---
const buildItems = (
  actions: OpsAction[],
  entities: SearchResult[],
): VirtualItem[] => {
  const newItems: VirtualItem[] = [];
  if (actions.length > 0) {
    newItems.push({ type: 'header', label: 'Actions' });
    newItems.push(...actions.map((cmd) => ({ type: 'item', data: cmd } as VirtualItem)));
  }
  if (entities.length > 0) {
    newItems.push({ type: 'header', label: 'Entities' });
    newItems.push(...entities.map((ent) => ({ type: 'item', data: ent } as VirtualItem)));
  }
  return newItems;
};

// Mock callback function
const mockOnCommandSelect = jest.fn();

// Mock virtual items for testing
const createMockVirtualItems = (items: VirtualItem[]) => {
  return items.map((_, index) => ({
    index,
    start: index * 58,
    size: 58,
    key: index,
    measureElement: jest.fn(),
  }));
};

describe('OpsResultsList', () => {
  beforeEach(() => {
    mockOnCommandSelect.mockClear();
    
    // Mock the virtualizer to return all items (bypass virtualization for testing)
    (useVirtualizer as jest.Mock).mockReturnValue({
      getVirtualItems: () => createMockVirtualItems(buildItems(mockActions, mockEntities)),
      getTotalSize: () => 1000,
      measureElement: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render headers and items correctly', () => {
      const items = buildItems(mockActions, mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={0}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      // Check headers are rendered
      expect(screen.getByTestId('header-actions')).toBeInTheDocument();
      expect(screen.getByTestId('header-entities')).toBeInTheDocument();
      
      // Check action items
      expect(screen.getByText('Find Order')).toBeInTheDocument();
      expect(screen.getByText('Look up a specific order')).toBeInTheDocument();
      expect(screen.getByText('Find Customer')).toBeInTheDocument();
      expect(screen.getByText('Look up a specific customer')).toBeInTheDocument();
      
      // Check entity items
      expect(screen.getByText('Order #1001')).toBeInTheDocument();
      expect(screen.getByText('Customer: John Doe')).toBeInTheDocument();
      expect(screen.getByText('Customer Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('Email: jane@example.com')).toBeInTheDocument();
    });

    it('should render empty state when no items are provided', () => {
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => [],
        getTotalSize: () => 0,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={[]}
          selectedIndex={-1}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      expect(screen.getByText('No actions found.')).toBeInTheDocument();
      expect(screen.queryByTestId('header-actions')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-entities')).not.toBeInTheDocument();
    });

    it('should render only actions when no entities are provided', () => {
      const items = buildItems(mockActions, []);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={0}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      expect(screen.getByTestId('header-actions')).toBeInTheDocument();
      expect(screen.queryByTestId('header-entities')).not.toBeInTheDocument();
      expect(screen.getByText('Find Order')).toBeInTheDocument();
      expect(screen.getByText('Find Customer')).toBeInTheDocument();
    });

    it('should render only entities when no actions are provided', () => {
      const items = buildItems([], mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={0}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      expect(screen.queryByTestId('header-actions')).not.toBeInTheDocument();
      expect(screen.getByTestId('header-entities')).toBeInTheDocument();
      expect(screen.getByText('Order #1001')).toBeInTheDocument();
      expect(screen.getByText('Customer Jane Smith')).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
  it('should call onCommandSelect when an action item is clicked', () => {
    const items = buildItems(mockActions, mockEntities);
    
    // Create virtual items that properly map to the actual data
    const virtualItems = items.map((item, index) => ({
      index,
      start: index * 58,
      size: item.type === 'header' ? 32 : 58,
      key: index,
      measureElement: jest.fn(),
    }));

    (useVirtualizer as jest.Mock).mockReturnValue({
      getVirtualItems: () => virtualItems,
      getTotalSize: () => items.length * 58,
      measureElement: jest.fn(),
    });

    renderWithProviders(
      <OpsResultsList
        items={items}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // Click the first action - use the actual text content to find the button
    const actionButton = screen.getByRole('button', { name: /Find Order/ });
    fireEvent.click(actionButton);
    
    expect(mockOnCommandSelect).toHaveBeenCalledWith(mockActions[0]);
    expect(mockOnCommandSelect).toHaveBeenCalledTimes(1);
  });

  it('should call onCommandSelect when an entity item is clicked', () => {
    const items = buildItems(mockActions, mockEntities);
    
    const virtualItems = items.map((item, index) => ({
      index,
      start: index * 58,
      size: item.type === 'header' ? 32 : 58,
      key: index,
      measureElement: jest.fn(),
    }));

    (useVirtualizer as jest.Mock).mockReturnValue({
      getVirtualItems: () => virtualItems,
      getTotalSize: () => items.length * 58,
      measureElement: jest.fn(),
    });

    renderWithProviders(
      <OpsResultsList
        items={items}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // Click the first entity - use the actual text content
    const entityButton = screen.getByRole('button', { name: /Order #1001/ });
    fireEvent.click(entityButton);
    
    expect(mockOnCommandSelect).toHaveBeenCalledWith(mockEntities[0]);
    expect(mockOnCommandSelect).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple clicks correctly', () => {
    const items = buildItems(mockActions, mockEntities);
    
    const virtualItems = items.map((item, index) => ({
      index,
      start: index * 58,
      size: item.type === 'header' ? 32 : 58,
      key: index,
      measureElement: jest.fn(),
    }));

    (useVirtualizer as jest.Mock).mockReturnValue({
      getVirtualItems: () => virtualItems,
      getTotalSize: () => items.length * 58,
      measureElement: jest.fn(),
    });

    renderWithProviders(
      <OpsResultsList
        items={items}
        selectedIndex={0}
        onCommandSelect={mockOnCommandSelect}
      />
    );

    // Click multiple items using their text content
    fireEvent.click(screen.getByRole('button', { name: /Find Order/ }));
    fireEvent.click(screen.getByRole('button', { name: /Order #1001/ }));
    fireEvent.click(screen.getByRole('button', { name: /Find Customer/ }));

    expect(mockOnCommandSelect).toHaveBeenCalledTimes(3);
    expect(mockOnCommandSelect).toHaveBeenCalledWith(mockActions[0]);
    expect(mockOnCommandSelect).toHaveBeenCalledWith(mockEntities[0]);
    expect(mockOnCommandSelect).toHaveBeenCalledWith(mockActions[1]);
  });
});

  describe('Selection State', () => {
    it('should highlight the selected item based on selectedIndex', () => {
      const items = buildItems(mockActions, mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      // Select the second item (index 1)
      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={1}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      const selectedItem = screen.getByTestId('item-1');
      expect(selectedItem).toHaveAttribute('aria-selected', 'true');
    });

    it('should not highlight any item when selectedIndex is -1', () => {
      const items = buildItems(mockActions, mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={-1}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      const listItems = screen.getAllByRole('listitem');
      listItems.forEach(item => {
        expect(item).not.toHaveAttribute('aria-selected', 'true');
      });
    });

    it('should handle selection of header items gracefully', () => {
      const items = buildItems(mockActions, mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      // Select index 0 which is a header
      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={0}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      // Header should not be selectable, so no item should have aria-selected=true
      const header = screen.getByTestId('header-actions');
      expect(header).not.toHaveAttribute('aria-selected');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const items = buildItems(mockActions, mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={1}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      expect(screen.getByTestId('virtual-scroll-container')).toBeInTheDocument();
      
      const listItems = screen.getAllByRole('listitem');
      expect(listItems.length).toBeGreaterThan(0);
      
      // Check that selected item has proper aria attribute
      const selectedItem = screen.getByTestId('item-1');
      expect(selectedItem).toHaveAttribute('aria-selected', 'true');
    });

    it('should render headers with proper test IDs', () => {
      const items = buildItems(mockActions, mockEntities);
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(items),
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={0}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      expect(screen.getByTestId('header-actions')).toBeInTheDocument();
      expect(screen.getByTestId('header-entities')).toBeInTheDocument();
    });
  });

  describe('Virtualization', () => {
    it('should use virtualization for large lists', () => {
      const largeEntities: SearchResult[] = Array.from(
        { length: 1000 },
        (_, i) => ({
          id: `e${i}`,
          type: 'product',
          title: `Product #${i + 1}`,
          description: `This is mock product ${i + 1}`,
          url: `/products/e${i}`,
        }),
      );

      const items = buildItems([], largeEntities);
      const virtualItemsMock = createMockVirtualItems(items).slice(0, 20); // Simulate virtualization

      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => virtualItemsMock,
        getTotalSize: () => items.length * 58,
        measureElement: jest.fn(),
      });

      renderWithProviders(
        <OpsResultsList
          items={items}
          selectedIndex={0}
          onCommandSelect={mockOnCommandSelect}
        />
      );

      // Should only render a subset of items due to virtualization
      const allListItems = screen.getAllByRole('listitem');
      expect(allListItems.length).toBeLessThan(50); // Virtualization should render fewer items
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed items gracefully', () => {
      const malformedItems: VirtualItem[] = [
        { type: 'header', label: 'Test Header' },
        // Intentionally malformed - missing required data properties
        { type: 'item', data: { id: 'malformed' } as any },
      ];
      
      (useVirtualizer as jest.Mock).mockReturnValue({
        getVirtualItems: () => createMockVirtualItems(malformedItems),
        getTotalSize: () => malformedItems.length * 58,
        measureElement: jest.fn(),
      });

      expect(() => {
        renderWithProviders(
          <OpsResultsList
            items={malformedItems}
            selectedIndex={0}
            onCommandSelect={mockOnCommandSelect}
          />
        );
      }).not.toThrow();
    });
  });
});