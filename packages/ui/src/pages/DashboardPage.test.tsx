// packages/ui/src/pages/DashboardPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import axios from 'axios';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

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