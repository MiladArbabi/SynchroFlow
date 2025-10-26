// tests/unit/ui/EchoHubPage.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event'; 
import { renderWithProviders } from 'test-utils';
import EchoHubPage from 'pages/EchoHubPage.tsx'

// --- Mocks for Child Components ---
// Keep these simple for layout testing, but add interaction capability for MiddlePane
jest.mock('components/EchoHub/EchoHubLeftPane.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="left-pane-mock">Sources Pane Placeholder</div>,
}));

// Mock Middle Pane to render clickable items based on mock data
const mockConversationsForTest = [
  { id: 'conv1', customerName: 'Alice Johnson', subject: 'Regarding Order #12345' },
  { id: 'conv2', customerName: 'Bob Williams', subject: 'Question about Shipping' },
];
jest.mock('components/EchoHub/EchoHubMiddlePane.tsx', () => ({
  __esModule: true,
  // Mock accepts props now: selectedId and onSelect callback
  default: ({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) => (
    <div data-testid="middle-pane-mock">
      {mockConversationsForTest.map(conv => (
        <button key={conv.id} onClick={() => onSelect(conv.id)} data-selected={selectedId === conv.id}>
          {conv.customerName} - {conv.subject}
        </button>
      ))}
      Conversations Pane Placeholder
    </div>
  ),
}));

// Mock Right Pane to display content based on a prop
jest.mock('components/EchoHub/EchoHubRightPane.tsx', () => ({
  __esModule: true,
  // Mock accepts selectedId prop
  default: ({ selectedId }: { selectedId: string | null }) => (
    <div data-testid="right-pane-mock">
      Details for: {selectedId ?? 'None'}
      Details Pane Placeholder
    </div>
  ),
}));

describe('EchoHubPage Interaction (#TASK(UI): Link Echo Hub Conversation List...)', () => {

  it('should update the Right Pane when a conversation is clicked in the Middle Pane', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EchoHubPage />);

    // This test is RED initially because the click handler and state passing aren't implemented.
    // Clicking Bob should fail to update the Right Pane content.

    // 1. Verify initial state (assuming first item 'conv1' is selected by default)
    const rightPane = screen.getByTestId('right-pane-mock');
    expect(rightPane).toHaveTextContent('Details for: conv1'); // Check initial content

    // 2. Find and click the button for the second conversation ('conv2')
    const bobButton = screen.getByRole('button', { name: /Bob Williams/i });
    await user.click(bobButton);

    // 3. Assert that the Right Pane content has updated to show 'conv2' details
    // This assertion will FAIL until the state logic is implemented in EchoHubPage
    expect(rightPane).toHaveTextContent('Details for: conv2');
  });
});