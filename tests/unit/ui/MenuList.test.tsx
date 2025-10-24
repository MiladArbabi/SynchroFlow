// tests/unit/ui/MenuList.test.tsx
import { screen } from '@testing-library/react'; // Import 'logRoles' for debugging
import { renderWithProviders } from 'test-utils';
import MenuList from 'layout/MainLayout/MenuList';
import { useGetMenuMaster } from 'api/menu';

// --- Mocks ---
jest.mock('api/menu', () => ({
  useGetMenuMaster: jest.fn(),
}));

jest.mock('layout/MainLayout/MenuList/NavItem', () => ({
  __esModule: true,
  default: ({ item }: { item: { title: string } }) => (
    <div>{item.title}</div> // This mock renders the title
  ),
}));

/* jest.mock('layout/MainLayout/MenuList/NavCollapse', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

jest.mock('layout/MainLayout/MenuList/NavGroup', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
})); */
// --- End Mocks ---

describe('MenuList (#278)', () => {
  beforeEach(() => {
    (useGetMenuMaster as jest.Mock).mockReturnValue({
        menuMaster: { isDashboardDrawerOpened: true },
        // This ensures the test loads the same module as the app.
        menu: { items: require('menu-items').default.items } 
    });
  });

  it('should render entity-driven links and not old module links', () => {
    renderWithProviders(<MenuList />);
    
    // DEBUG STEP: Uncomment this to see the DOM if the test fails again.
    // screen.debug(); 

    // Assertion 1: Check for a new entity link
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument(); // From dashboard.ts

    // Assertion 2: Check for an old module link
    expect(screen.queryByText('Data Mapper')).not.toBeInTheDocument();
  });
});