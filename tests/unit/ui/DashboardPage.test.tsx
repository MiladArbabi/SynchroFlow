// tests/unit/ui/DashboardPage.test.tsx
import { screen, act } from '@testing-library/react';
import { DashboardPage } from 'pages/DashboardPage'; // <-- USE ALIAS
import { renderWithProviders } from 'test-utils';
import axios from 'axios';

// Mock axios
jest.mock('axios');

// Mock the layout context
jest.mock('App', () => ({
  useLayoutContext: () => ({
    isEditing: false,
    isLibraryOpen: false,
    setIsLibraryOpen: jest.fn(),
    currentUserPlan: 'pro',
    layoutRef: { current: null },
    activeWidgetsRef: { current: [] }
  })
}));

// Mock complex child components
jest.mock('react-grid-layout', () => ({
  WidthProvider: (Component: React.ElementType) => (props: any) => (
    <Component {...props} />
  ),
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rgl-grid">{children}</div>
   ),
}));

jest.mock('components/Icon', () => () => <span data-testid="icon" />);

// Mock all the widgets that the dashboard tries to render
jest.mock('../../../packages/ui/src/widgets/widgetRegistry', () => ({
  WIDGET_REGISTRY: {
    'kpi-revenue': { component: () => <div data-testid="widget-kpi-revenue" /> },
    'kpi-margin': { component: () => <div data-testid="widget-kpi-margin" /> },
    'kpi-inventory': { component: () => <div data-testid="widget-kpi-inventory" /> },
    'a-opex-gauge': { component: () => <div data-testid="widget-a-opex-gauge" /> },
    'cashflow-chart': { component: () => <div data-testid="widget-cashflow-chart" /> },
    'inventory-health': { component: () => <div data-testid="widget-inventory-health" /> },
  },
  PlanLevel: {} // Mock the enum/type object
}));

// Mock components
jest.mock('components/WidgetLibrary', () => () => (
  <div data-testid="widget-library" />
));
jest.mock(
  'components/ConnectStoreBanner',
  () => () => <div data-testid="connect-banner" />
);
jest.mock(
  'components/ConnectStoreModal',
  () => ({ ConnectStoreModal: () => <div data-testid="connect-modal" /> })
);

// Helper function to render with router context
const renderDashboard = (route: string) => {
  return renderWithProviders(<DashboardPage />, {
    // We use 'initialEntries' to simulate the URL
    routerProps: { initialEntries: [`/dashboard${route}`] }
  });
};

describe('DashboardPage - Connection Success UX', () => {
  beforeEach(() => {
    (axios.get as jest.Mock).mockClear();
    // Mock a successful layout fetch by default
    (axios.get as jest.Mock).mockResolvedValue({
      data: { layout: [], activeWidgets: [] }
    });
  });

  it('should NOT show a success alert on normal load', async () => {
    renderDashboard('');
    // Wait for effects
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should show a success alert when URL has ?connect=success', async () => {
    renderDashboard('?connect=success');

    // --- THIS IS THE "RED" TEST ---
    const successAlert = await screen.findByRole('alert');
    expect(successAlert).toBeInTheDocument();
    expect(successAlert).toHaveTextContent(/Connection successful!/i);

    // It should also HIDE the banner
    expect(screen.queryByTestId('connect-banner')).not.toBeInTheDocument();
  });
});