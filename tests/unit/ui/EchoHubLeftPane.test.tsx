// tests/unit/ui/EchoHubLeftPane.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import EchoHubLeftPane from 'components/EchoHub/EchoHubLeftPane.tsx';

describe('EchoHubLeftPane (#FEAT(UI): Implement Echo Hub Left Pane (Static))', () => {
  it('should render the static lists of sources and filters', () => {
    renderWithProviders(<EchoHubLeftPane />);

    // This test is RED.
    // It will FAIL: Cannot find module 'components/EchoHub/EchoHubLeftPane.tsx'

    // Assertions for when the component exists:
    // Check for list headers
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();

    // Check for specific items
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Mine')).toBeInTheDocument();
  });
});