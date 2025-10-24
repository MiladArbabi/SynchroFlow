// tests/unit/ui/SidenavContent.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import SidenavContent from 'layouts/AppLayout/SidenavContent';

// --- Mocks ---
jest.mock('layout/MainLayout/LogoSection', () => ({
  __esModule: true,
  default: () => <div data-testid="logo-section-mock" />,
}));

jest.mock('ui-component/third-party/SimpleBar', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('api/menu', () => ({
  useGetMenuMaster: () => ({
    menuMaster: { isDashboardDrawerOpened: true },
  }),
}));

// Mock the MenuList component itself
jest.mock('layout/MainLayout/MenuList', () => ({
  __esModule: true,
  default: () => <div data-testid="menu-list-mock" />,
}));
// --- End Mocks ---

describe('SidenavContent (#278) - Menu Items', () => {
  // We need a test for MenuList itself to check the items
  // This test file will just check SidenavContent renders
  it('should render the Sidenav container', () => {
     renderWithProviders(<SidenavContent />);
     expect(screen.getByTestId('logo-section-mock')).toBeInTheDocument();
     expect(screen.getByTestId('menu-list-mock')).toBeInTheDocument();
  });
});