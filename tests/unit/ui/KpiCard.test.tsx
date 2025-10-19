//packages/ui/src/components/KpiCard.test.tsx
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import KpiCard from 'components/KpiCard';
import { renderWithProviders } from 'test-utils';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

describe('KpiCard', () => {
  it('fetches data from a URL and displays the formatted value', async () => {
    // 1. SETUP
    // Define the fake data our API will return
    const fakeApiResponse = { value: 75999.95 };
    mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

    // 2. RENDER
    // Render the component with the new data-fetching props
    renderWithProviders(
      <KpiCard
        title="Gross Revenue"
        dataUrl="/api/v1/analytics/gross-revenue"
        format="currency"
        icon=''
      />
    );

    // 3. ASSERTION
    // Wait for the component to finish fetching and re-render with the value
    await waitFor(() => expect(screen.getByText('$75,999.95')).toBeInTheDocument());

    // Also check that axios was called with the correct URL
    expect(mockedAxiosGet).toHaveBeenCalledWith('/api/v1/analytics/gross-revenue');
  });
});