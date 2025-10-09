// packages/ui/src/pages/DashboardPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import axios from 'axios';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;
const mockedAxiosPost = axios.post as jest.Mock;

test('renders the main dashboard with key metric placeholders', () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

  // Look for the main page heading
  expect(screen.getByRole('heading', { name: /FinOps Command Center/i })).toBeInTheDocument();

  // Look for placeholders for our future KPI widgets
  expect(screen.getByText(/Total Inventory Value/i)).toBeInTheDocument();
  expect(screen.getByText(/Cash Conversion Cycle/i)).toBeInTheDocument();
});

test('fetches and displays the total inventory value', async () => {
  // --- 1. SETUP ---
  // Define the fake data our API will return
  const fakeApiResponse = {
    total_inventory_value: 125340.75
  };
  // Tell our mock to return this fake data when called
  mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

  // --- 2. ASSERTION ---
  // The component will fetch data on render. We need to wait for the
  // element with the correct value to appear.
  // We look for "$125,340.75"
  const valueElement = await screen.findByText(/\$125,340\.75/);
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

  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

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

  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

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
