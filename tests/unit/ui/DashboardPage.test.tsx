// tests/unit/ui/DashboardPage.test.tsx
import { screen, waitFor, findByText } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import axios from 'axios';
import { DashboardPage } from 'pages/DashboardPage.tsx'; // Import the named export
import { useLayoutContext } from 'App';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock SidenavContent to prevent the 'imporxt.meta' syntax error
jest.mock('layouts/AppLayout/SidenavContent', () => ({
  __esModule: true,
  default: () => <div data-testid="sidenav-content-mock" />,
}));

// Mock the 'App' alias
jest.mock('App', () => ({
  ...jest.requireActual('App'), 
  useLayoutContext: jest.fn(),
}));
const mockedUseLayoutContext = useLayoutContext as jest.Mock;

// Mock the widgets in the registry
jest.mock('components/KpiCard', () => ({
  __esModule: true,
  default: () => <div data-testid="kpi-card-mock" />,
}));
jest.mock('widgets/CashFlowWidget', () => ({
  __esModule: true,
  default: () => <div data-testid="cashflow-widget-mock" />,
}));
jest.mock('widgets/InventoryHealthWidget', () => ({
  __esModule: true,
  default: () => <div data-testid="inventory-health-mock" />,
}));
// Mock the NEW widget we are about to add
jest.mock('widgets/AOpexGauge', () => ({
  __esModule: true,
  default: ({ title, value }: { title: string, value: number }) => (
    <div data-testid="a-opex-gauge-mock">
      {title}: {value}
    </div>
  ),
}));

describe('DashboardPage (#283)', () => {

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedUseLayoutContext.mockReturnValue({
      isEditing: false,
      isLibraryOpen: false,
      setIsLibraryOpen: jest.fn(),
      currentUserPlan: 'Ignition',
      layoutRef: { current: [] },
      activeWidgetsRef: { current: [] },
      handleSaveLayout: jest.fn(),
    });

    // Mock the layout fetch (404 = use default)
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/api/v1/layouts/dashboard') {
        return Promise.reject(new Error('404')); 
      }
      if (url === '/api/v1/ops-intel/summary') {
        return Promise.resolve({ 
          data: { automated_tasks: 4500, labor_cost_saved: 8125.75 } 
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it('should fetch ops-intel data and render the AOpexGauge widget', async () => {
    const { container } = renderWithProviders(<DashboardPage />);

    // ... (Assertions) ...
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        '/api/v1/ops-intel/summary'
      );
    });
    
    expect(screen.getByTestId('a-opex-gauge-mock')).toBeInTheDocument();
    
    expect(
      await findByText(container as HTMLElement, 'Opex Saved: 8125.75')
    ).toBeInTheDocument();
  });
});