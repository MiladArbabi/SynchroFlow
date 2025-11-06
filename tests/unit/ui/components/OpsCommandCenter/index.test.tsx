// tests/unit/ui/components/OpsCommandCenter/index.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OpsCommandCenter } from 'components/OpsCommandCenter'; // This import will fail
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

import { OpsAction, SearchResult } from 'components/OpsCommandCenter/types';
import { useOpsCommands } from 'components/OpsCommandCenter/hooks/useOpsCommands';
import { useKoreRanking } from 'components/OpsCommandCenter/hooks/useKoreRanking';
import { useSemanticQuery } from 'components/OpsCommandCenter/hooks/useSemanticQuery';
import { useCommandExecution } from 'components/OpsCommandCenter/hooks/useCommandExecution';
import { useHealthContext } from 'contexts/HealthContext';
import { useOpsContext } from 'contexts/OpsContext';
import useConfig from 'hooks/useConfig';

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver;

// Mock all the hooks
jest.mock('components/OpsCommandCenter/hooks/useOpsCommands');
jest.mock('components/OpsCommandCenter/hooks/useKoreRanking');
jest.mock('components/OpsCommandCenter/hooks/useSemanticQuery');
jest.mock('components/OpsCommandCenter/hooks/useCommandExecution');
jest.mock('contexts/HealthContext');
jest.mock('contexts/OpsContext');
jest.mock('hooks/useConfig');

// --- Mock Data ---
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
];

// Create a query client for <QueryClientProvider>
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

describe('OpsCommandCenter', () => {

  const mockScrollContainer = () => {
    const scrollContainer = screen.getByTestId('virtual-scroll-container');
    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 400, width: 300, top: 0, left: 0, bottom: 400, right: 300 }),
    });
  };

  beforeEach(() => {
    // Reset all mocks
    (useOpsCommands as jest.Mock).mockReturnValue(mockActions);
    (useKoreRanking as jest.Mock).mockReturnValue([...mockActions, ...mockEntities]);
    (useSemanticQuery as jest.Mock).mockImplementation((q) => q);
    (useCommandExecution as jest.Mock).mockReturnValue({
      executeCommand: jest.fn(),
      isExecuting: false,
    });
    (useHealthContext as jest.Mock).mockReturnValue({ isKoreHealthy: true });
    (useOpsContext as jest.Mock).mockReturnValue({
      context: { proactiveInsights: [] },
      dispatch: jest.fn(),
    });
    (useConfig as jest.Mock).mockReturnValue({
      state: { isOpsConsoleOpen: true },
    });

    // Mock the L2 search hook (useQuery)
    queryClient.setQueryData(['kore-federated-search', 'find'], mockEntities);
  });

  const renderComponent = () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OpsCommandCenter />
      </QueryClientProvider>,
    );
    mockScrollContainer();
  };

  it('should render the input and results', async () => {
    renderComponent();
    const input = screen.getByTestId('kore-command-input');
    fireEvent.change(input, { target: { value: 'find' } });

    // Wait for the results to appear
    expect(await screen.findByText('Find Order')).toBeInTheDocument();
    expect(screen.getByText('Order #1001')).toBeInTheDocument();
  });

  // --- NEW FAILING TEST (RED) ---
  it('should skip headers when navigating down with ArrowDown', async () => {
    renderComponent();
    const input = screen.getByTestId('kore-command-input');

    // 1. Type to show results
    fireEvent.change(input, { target: { value: 'find' } });
    expect(await screen.findByTestId('header-actions')).toBeInTheDocument();

    // 2. Act: Press ArrowDown
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });

    // 3. Assert: The *first item* (id: '1') should be selected, not the header
    // This will FAIL. The current logic selects index 0 (the header).
    // The header doesn't get aria-selected, so the test fails because item-1 is *not* selected.
    expect(screen.getByTestId('item-1')).toHaveAttribute('aria-selected', 'true');
  });
});