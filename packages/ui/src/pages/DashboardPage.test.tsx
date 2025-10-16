// packages/ui/src/pages/DashboardPage.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { UserProvider } from '../contexts/UserContext';
import { MaterialUIControllerProvider } from '../contexts/MaterialUI';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../theme';
import CssBaseline from '@mui/material/CssBaseline';

// Mock all complex child components to isolate the DashboardPage test
jest.mock('../components/KpiCard', () => ({
  KpiCard: ({ title }: { title: string }) => <div data-testid="kpi-card">{title}</div>,
}));
jest.mock('../components/InventoryHealthTable', () => ({
  InventoryHealthTable: () => <div>Inventory Health Table</div>,
}));
jest.mock('../components/FulfillmentPipelineChart', () => ({
  FulfillmentPipelineChart: () => <div>Fulfillment Pipeline Chart</div>,
}));
jest.mock('../components/PerfectOrderGauge', () => ({
  PerfectOrderGauge: () => <div>Perfect Order Gauge</div>,
}));

jest.mock('axios');
//const mockedAxiosGet = axios.get as jest.Mock;
//const mockedAxiosPost = axios.post as jest.Mock;

// --- Helper function ---
const renderWithProviders = (ui: React.ReactElement, { userProviderProps = {} } = {}) => {
  return render(
    <MemoryRouter>
      <MaterialUIControllerProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <UserProvider {...userProviderProps}>
            {ui}
          </UserProvider>
        </ThemeProvider>
      </MaterialUIControllerProvider>
    </MemoryRouter>
  );
};

describe('DashboardPage', () => {
  it('renders the main dashboard layout and all widgets', () => {
    renderWithProviders(<DashboardPage />);

    // Verify all our widget placeholders are rendered
    expect(screen.getByText('Gross Revenue')).toBeInTheDocument();
    expect(screen.getByText('Gross Margin')).toBeInTheDocument();
    expect(screen.getByText('Total Inventory Value')).toBeInTheDocument();
    expect(screen.getByText('Cost of Stockout')).toBeInTheDocument();
    expect(screen.getByText('Inventory Health Table')).toBeInTheDocument();
    expect(screen.getByText('Fulfillment Pipeline Chart')).toBeInTheDocument();
    expect(screen.getByText('Perfect Order Gauge')).toBeInTheDocument();
  });

  it('hides the sandbox banner in live mode', () => {
    renderWithProviders(<DashboardPage />, {
      userProviderProps: { value: { isSandbox: false } },
    });
    expect(screen.queryByText(/You are currently in a sandbox environment/i)).not.toBeInTheDocument();
  });

  it('displays a sandbox banner when in sandbox mode', () => {
    renderWithProviders(<DashboardPage />, {
      userProviderProps: { value: { isSandbox: true } },
    });
    expect(screen.getByText(/You are currently in a sandbox environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Your Store/i })).toBeInTheDocument();
  });

  it('clicking the sandbox banner button opens the connection modal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />, {
      userProviderProps: { value: { isSandbox: true } },
    });

    await user.click(screen.getByRole('button', { name: /Connect Your Store/i }));
    expect(await screen.findByRole('heading', { name: /Connect a Data Source/i })).toBeInTheDocument();
  });
});