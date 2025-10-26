// tests/unit/ui/EchoHubPage.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import EchoHubPage from 'pages/EchoHubPage.tsx'

// Mock react-resizable-panels if we decide to use it
// For simplicity, let's assume MUI Grid first, or mock panels later if needed.
// For now, just test for placeholder text.

describe('EchoHubPage (Layout Shell) (#FEAT(UI): Create Echo Hub page...)', () => {

  it('should render placeholders for the three panes', () => {
    renderWithProviders(<EchoHubPage />);

    // This test is RED.
    // It will FAIL: Cannot find module 'pages/EchoHubPage.tsx'

    // Assertions for when the component exists:
    expect(screen.getByText('Sources Pane Placeholder')).toBeInTheDocument();
    expect(screen.getByText('Conversations Pane Placeholder')).toBeInTheDocument();
    expect(screen.getByText('Details Pane Placeholder')).toBeInTheDocument();
  });
});