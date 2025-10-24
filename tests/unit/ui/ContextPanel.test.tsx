// tests/unit/ui/ContextPanel.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from 'test-utils';
import ContextPanel from 'ui-component/ContextPanel/index.tsx'; 

// Mock MainCard
jest.mock('ui-component/cards/MainCard', () => ({
  __esModule: true,
  default: ({ title, children }: { title: React.ReactNode, children: React.ReactNode }) => (
    <div data-testid="main-card-mock">
      <div data-testid="card-title">{title}</div>
      <div data-testid="card-content">{children}</div>
    </div>
  ),
}));

// MODIFICATION: The mock must conditionally render children
jest.mock('ui-component/ContextPanel/TabPanel.tsx', () => ({
  __esModule: true,
  default: ({ children, value, index }: { children: React.ReactNode, value: number, index: number }) => (
    <div role="tabpanel" hidden={value !== index}>
      {/* This logic prevents inactive content from being in the DOM */}
      {value === index && children}
    </div>
  ),
}));

describe('ContextPanel (#280)', () => {
  const tabs = [
    { label: 'Summary', content: <div>Summary Content</div> },
    { label: 'Details', content: <div>Details Content</div> },
  ];

  it('should render tabs and default content, then switch tabs on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ContextPanel tabs={tabs} />
    );
    
    // Assertions
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument();

    // This will now pass, as "Details Content" is not rendered
    expect(screen.getByText('Summary Content')).toBeInTheDocument();
    expect(screen.queryByText('Details Content')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Details' }));

    // This will now pass
    expect(screen.queryByText('Summary Content')).not.toBeInTheDocument();
    expect(screen.getByText('Details Content')).toBeInTheDocument();
  });
});