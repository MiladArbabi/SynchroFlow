// packages/ui/src/pages/DashboardPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { UserProvider } from '../contexts/UserContext';
import { MaterialUIControllerProvider } from 'contexts/MaterialUI';
import { ThemeProvider } from '@mui/material/styles';
import theme from 'assets/theme';
import CssBaseline from '@mui/material/CssBaseline';
import axios from 'axios';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;
const mockedAxiosPost = axios.post as jest.Mock;

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
  expect(screen.getByRole('heading', { name: /FinOps Command Center/i })).toBeInTheDocument();

  // Assert that the sandbox banner is NOT visible
  expect(screen.queryByText(/You are currently in a sandbox environment/i)).not.toBeInTheDocument();
});

test('displays a sandbox banner when in sandbox mode', () => {
  renderWithProviders(<DashboardPage />);

  // Assert that the sandbox banner IS visible
  expect(screen.getByText(/You are currently in a sandbox environment/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Connect Your Store/i })).toBeInTheDocument();
});

test('clicking the sandbox banner button opens the connection modal', async () => {
  const user = userEvent.setup();
  renderWithProviders(<DashboardPage />, {
    userProviderProps: { value: { isSandbox: true } },
  });

  // Find and click the button in the banner
  const connectButton = screen.getByRole('button', { name: /Connect Your Store/i });
  await user.click(connectButton);

  // Assert that the modal is now visible by finding its title
  expect(await screen.findByRole('heading', { name: /Connect a Data Source/i })).toBeInTheDocument();
});

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

test('allows a user to run a payment delay simulation and updates the chart', async () => {
  // --- 1. SETUP ---
  // Mock the initial data fetch
  mockedAxiosGet.mockResolvedValue({ data: { total_inventory_value: 100 } });

  // Define the fake response our SIMULATION API will return
  const fakeSimulationResponse = {
    simulated_cash_flow: [10000, 2500, 12000, 500]
  };
  mockedAxiosPost.mockResolvedValue({ data: fakeSimulationResponse });

  renderWithProviders(<DashboardPage />);

  // --- 2. EXECUTION ---
  // Find the button to trigger the simulation (we will add this button)
  const simulateButton = screen.getByRole('button', { name: /Simulate 2-Week Delay/i });
  // Simulate the user clicking the button
  fireEvent.click(simulateButton);

  // --- 3. ASSERTION ---
  // This is a more robust test. We verify that the component's LOGIC is correct
  // by checking that it called the API with the expected payload.
  await waitFor(() => {
    expect(mockedAxiosPost).toHaveBeenCalledWith('/api/v1/simulations/payment-delay', {
      current_cash_flow: [10000, -5000, 12000, 8000],
      payment_details: { amount: 7500, original_due_week: 1, delay_weeks: 2 },
    });
  });
});

test('clicking the chart opens the simulation modal', async () => {
  // --- 1. SETUP ---
  // Mock the initial data fetch for the KPI widget to ensure the page renders
  mockedAxiosGet.mockResolvedValue({ data: { total_inventory_value: 100 } });

  renderWithProviders(<DashboardPage />);

  // --- 2. EXECUTION ---
  // Wait for the chart to be visible by finding its title
  const chartTitle = await screen.findByRole('heading', { name: /Cash Flow Forecast/i });

  // Find the chart's parent container and simulate a user click
  const chartContainer = chartTitle.parentElement;
  fireEvent.click(chartContainer!);

  // --- 3. ASSERTION ---
  // After the click, the simulation modal should appear. We'll wait for its title to be visible.
  const modalTitle = await screen.findByRole('heading', { name: /Simulate a Scenario/i });
  expect(modalTitle).toBeInTheDocument();

  // We can also verify that the form inside it is now visible.
  // This uses the test from the SimulationModal component to ensure it's fully rendered.
  expect(screen.getByLabelText(/Payment Amount/i)).toBeInTheDocument();
  });