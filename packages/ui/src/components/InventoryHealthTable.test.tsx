// packages/ui/src/components/InventoryHealthTable.test.tsx
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../theme';
import { MaterialUIControllerProvider } from '../contexts/MaterialUI';
import { UserProvider } from '../contexts/UserContext';
import { InventoryHealthTable } from './InventoryHealthTable';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

// A robust render helper to provide all necessary contexts
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <MemoryRouter>
      <MaterialUIControllerProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <UserProvider>{ui}</UserProvider>
        </ThemeProvider>
      </MaterialUIControllerProvider>
    </MemoryRouter>
  );
};

describe('InventoryHealthTable', () => {
  it('fetches and displays inventory health data in a grid', async () => {
    // 1. SETUP
    const fakeData = [
      { sku: 'HEALTHY-SKU', quantity_available: 50, status: 'Healthy' },
      { sku: 'AT-RISK-SKU', quantity_available: 5, status: 'At Risk' },
    ];
    mockedAxiosGet.mockResolvedValue({ data: fakeData });

    // 2. RENDER
    renderWithProviders(<InventoryHealthTable />);

    // 3. ASSERTION
    // A robust test: Wait for a specific piece of data to appear,
    // confirming the API call and rendering was successful.
    expect(await screen.findByText('HEALTHY-SKU')).toBeInTheDocument();

    // Also, check for the column headers, a key part of the table structure.
    expect(screen.getByRole('columnheader', { name: /SKU/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Status/i })).toBeInTheDocument();
    expect(screen.getByText('AT-RISK-SKU')).toBeInTheDocument();
  });
});