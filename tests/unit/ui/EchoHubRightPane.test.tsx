// tests/unit/ui/EchoHubRightPane.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import userEvent from '@testing-library/user-event';
import EchoHubRightPane from 'components/EchoHub/EchoHubRightPane.tsx';

jest.mock('components/Customer360/CustomerProfile.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="customer-profile-mock">Profile Component</div>,
}));
jest.mock('components/Customer360/CustomerKeyMetrics.tsx', () => ({
  __esModule: true,
  default: () => <div data-testid="customer-metrics-mock">Metrics Component</div>,
}));

describe('EchoHubRightPane (#FEAT(UI): Implement Echo Hub Right Pane Shell...)', () => {
  it('should render placeholders for thread, composer, and tabs', () => {
    renderWithProviders(<EchoHubRightPane selectedId="conv1" />);

    // This test is RED.
    // It will FAIL: Cannot find module 'components/EchoHub/EchoHubRightPane.tsx'

    // Assertions for when the component exists:
    // Check for Tabs (Context Tabs)
    expect(screen.getByRole('tab', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Customer 360' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Order 360' })).toBeInTheDocument();

    // Check for Conversation Thread placeholder content
    // Use a regex for flexibility as mock content might change slightly
    expect(screen.getByText(/Details for Conversation: conv1/i)).toBeInTheDocument();

    // Check for Composer elements
    expect(screen.getByRole('textbox', { name: /reply/i })).toBeInTheDocument(); // TextField (assuming label)
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument(); // Send Button
  });

    it('should render customer components when Customer 360 tab is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EchoHubRightPane selectedId="conv1" />);
  });
});