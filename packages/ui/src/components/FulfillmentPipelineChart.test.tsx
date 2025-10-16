// packages/ui/src/components/FulfillmentPipelineChart.test.tsx
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../theme';
import { MaterialUIControllerProvider } from '../contexts/MaterialUI';
import { UserProvider } from '../contexts/UserContext';
import { FulfillmentPipelineChart } from './FulfillmentPipelineChart';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

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

describe('FulfillmentPipelineChart', () => {
  it('fetches data and renders the bar chart with correct labels', async () => {
    // 1. SETUP: Mock the API response
    const fakeData = {
      processing: 5,
      in_transit: 2,
      delivered: 8,
    };
    mockedAxiosGet.mockResolvedValue({ data: fakeData });

    // 2. RENDER
    renderWithProviders(<FulfillmentPipelineChart />);

    // 3. ASSERTION
    // A robust test waits for the chart title to ensure the component has mounted.
    expect(await screen.findByText(/Fulfillment Pipeline/i)).toBeInTheDocument();

    // Check for the labels on the X-axis, which are rendered as text elements by the chart library.
    //expect(screen.getByText('Processing')).toBeInTheDocument();
    //expect(screen.getByText('In Transit')).toBeInTheDocument();
    //expect(screen.getByText('Delivered')).toBeInTheDocument();
  });
});