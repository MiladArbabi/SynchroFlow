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
import axios from 'axios';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;
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

test('renders the main dashboard and hides the sandbox banner in live mode', () => {
  renderWithProviders(<DashboardPage />, {
    userProviderProps: { value: { isSandbox: false } },
  });

  // Look for the main page heading
  //expect(screen.getByRole('heading', { name: /FinOps Command Center/i })).toBeInTheDocument();

  // Assert that the sandbox banner is NOT visible
  expect(screen.queryByText(/You are currently in a sandbox environment/i)).not.toBeInTheDocument();
});

test('displays a sandbox banner when in sandbox mode', () => {
  renderWithProviders(<DashboardPage />);

  // Assert that the sandbox banner IS visible
  expect(screen.getByText(/You are currently in a sandbox environment/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Connect Your Store/i })).toBeInTheDocument();
});

//test('clicking the sandbox banner button opens the connection modal', async () => {
  //const user = userEvent.setup();
  //renderWithProviders(<DashboardPage />, {
    //userProviderProps: { value: { isSandbox: true } },
  //});

  // Find and click the button in the banner
  //const connectButton = screen.getByRole('button', { name: /Connect Your Store/i });
  //await user.click(connectButton);

  // Assert that the modal is now visible by finding its title
  //expect(await screen.findByRole('heading', { name: /Connect a Data Source/i })).toBeInTheDocument();
//});

test('fetches and displays the total inventory value', async () => {
  // --- 1. SETUP ---
  // Define the fake data our API will return
  const fakeApiResponse = {
    total_inventory_value: 125340.75
  };
  // Tell our mock to return this fake data when called
  mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

  renderWithProviders(<DashboardPage />);

  // --- 2. ASSERTION ---
  // The component will fetch data on render. We need to wait for the
  // element with the correct value to appear.
  // We look for "$125,340.75"
  const valueElement = await screen.findByText(/\$125,340\.75/);
  expect(valueElement).toBeInTheDocument();

  // A robust test: Assert that the icon for this card is rendered.
  // "paid" is the name of the Material Icon for currency/value.
  expect(screen.getByText("paid")).toBeInTheDocument();
});

test('fetches and displays the gross margin percentage', async () => {
  const fakeApiResponse = {
    gross_margin_percentage: 42.5
  };
  mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

  renderWithProviders(<DashboardPage />);

  // Wait for the formatted percentage value to appear
  const valueElement = await screen.findByText(/42\.5%/);
  expect(valueElement).toBeInTheDocument();
});

//test('clicking the chart opens the simulation modal', async () => {
  // --- 1. SETUP ---
  // Mock the initial data fetch for the KPI widget to ensure the page renders
  //mockedAxiosGet.mockResolvedValue({ data: { total_inventory_value: 100 } });

  //renderWithProviders(<DashboardPage />);

  // --- 2. EXECUTION ---
  // Wait for the chart to be visible by finding its title
  //const chartTitle = await screen.findByRole('heading', { name: /Cash Flow Forecast/i });

  // Find the chart's parent container and simulate a user click
  //const chartContainer = chartTitle.parentElement;
  //fireEvent.click(chartContainer!);

  // --- 3. ASSERTION ---
  // After the click, the simulation modal should appear. We'll wait for its title to be visible.
  //const modalTitle = await screen.findByRole('heading', { name: /Simulate a Scenario/i });
  //expect(modalTitle).toBeInTheDocument();

  // We can also verify that the form inside it is now visible.
  // This uses the test from the SimulationModal component to ensure it's fully rendered.
  //expect(screen.getByLabelText(/Payment Amount/i)).toBeInTheDocument();
  //});

  test('fetches and displays the cost of stockout', async () => {
  // 1. SETUP
  const fakeApiResponse = {
    cost_of_stockout: 1680.00,
  };
  mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

  renderWithProviders(<DashboardPage />);

  // 3. ASSERTION
  // Wait for the formatted currency value to appear
  const valueElement = await screen.findByText('$1,680.00');
  expect(valueElement).toBeInTheDocument();

  // Also check that the corresponding title is rendered
  expect(screen.getByText(/Cost of Stockout/i)).toBeInTheDocument();
});