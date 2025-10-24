// tests/unit/ui/MasterPanel.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail, which is the point of the Red Test
import MasterPanel from 'ui-component/MasterPanel'; 

// Mock MainCard, the Berry component we will use
jest.mock('ui-component/cards/MainCard', () => ({
  __esModule: true,
  default: ({ title, children }: { title: React.ReactNode, children: React.ReactNode }) => (
    <div data-testid="main-card-mock">
      <h1>{title}</h1>
      <div>{children}</div>
    </div>
  ),
}));

describe('MasterPanel (#279)', () => {
  it('should render its title and children', () => {
    renderWithProviders(
      <MasterPanel title="Test Title">
        <div>Child Content</div>
      </MasterPanel>
    );

    // This test is RED.
    // It will FAIL: "Cannot find module 'ui-component/MasterPanel'"
    
    // Assertions for when the component exists
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Child Content')).toBeInTheDocument();
  });
});