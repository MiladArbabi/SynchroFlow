// tests/unit/ui/EchoHubMiddlePane.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import EchoHubMiddlePane from 'components/EchoHub/EchoHubMiddlePane.tsx';

import { within } from '@testing-library/react';

describe('EchoHubMiddlePane (#FEAT(UI): Implement Echo Hub Middle Pane...)', () => {
  it('should render a list of mock conversations with details', () => {
    renderWithProviders(<EchoHubMiddlePane />);

    const aliceItem = screen.getByText('Alice Johnson').closest('li')!;
    expect(within(aliceItem).getByText('Regarding Order #12345')).toBeInTheDocument();
    expect(within(aliceItem).getByText('Open')).toBeInTheDocument();

    const bobItem = screen.getByText('Bob Williams').closest('li')!;
    expect(within(bobItem).getByText('Question about Shipping')).toBeInTheDocument();
    expect(within(bobItem).getByText('Pending')).toBeInTheDocument();

    expect(screen.getByText('Resolved')).toBeInTheDocument();

    expect(screen.getAllByText(/ago$/i).length).toBeGreaterThan(0);
  });
});