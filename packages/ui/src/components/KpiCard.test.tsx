//packages/ui/src/components/KpiCard.test.tsx
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import { KpiCard } from './KpiCard';
import { MemoryRouter } from 'react-router-dom';
import { UserProvider } from '../contexts/UserContext';
import { MaterialUIControllerProvider } from 'contexts/MaterialUI';
import { ThemeProvider } from '@mui/material/styles';
import theme from 'assets/theme';
import CssBaseline from '@mui/material/CssBaseline';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

// --- Helper function ---
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <MemoryRouter>
      <MaterialUIControllerProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <UserProvider>
            {ui}
          </UserProvider>
        </ThemeProvider>
      </MaterialUIControllerProvider>
    </MemoryRouter>
  );
};

describe('KpiCard', () => {
  it('fetches data from a URL and displays the formatted value', async () => {
    // 1. SETUP
    // Define the fake data our API will return
    const fakeApiResponse = {
      gross_revenue: 75999.95,
    };
    mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

    // 2. RENDER
    // Render the component with the new data-fetching props
    renderWithProviders(
      <KpiCard
        title="Gross Revenue"
        dataUrl="/api/v1/analytics/gross-revenue"
        dataKey="gross_revenue"
        formatAs="currency"
        icon=''
      />
    );

    // 3. ASSERTION
    // Wait for the component to finish fetching and re-render with the value
    const valueElement = await screen.findByText('$75,999.95');
    expect(valueElement).toBeInTheDocument();

    // Also check that axios was called with the correct URL
    expect(mockedAxiosGet).toHaveBeenCalledWith('/api/v1/analytics/gross-revenue');
  });
});