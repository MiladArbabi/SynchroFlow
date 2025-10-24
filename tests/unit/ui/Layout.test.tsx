// tests/unit/ui/Layout.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// MODIFICATION: Use 'Layout' alias
import Layout from 'Layout';

// Mock child components using aliases
// MODIFICATION: Use 'layouts/' alias
jest.mock('layouts/AppLayout/SidenavContent', () => ({
  __esModule: true,
  default: () => <div data-testid="sidenav-mock" />,
}));
// MODIFICATION: Use 'pages/' alias
jest.mock('pages/DashboardPage', () => ({
  __esModule: true,
  DashboardPage: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-page-mock">{children}</div>
  ),
}));

describe('Layout (#277)', () => {
  it('should render the resizable Master/Context panels', () => {
    renderWithProviders(
        <Layout />
    );

    // This test is RED.
    // It should now fail: "Unable to find an element with the role 'group'"
    const panels = screen.getAllByRole('group');
    expect(panels).toHaveLength(2);
  });
});