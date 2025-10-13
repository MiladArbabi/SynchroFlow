//packages/ui/src/components/KpiCard.test.tsx
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import { KpiCard } from './KpiCard';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

describe('KpiCard', () => {
  it('renders the title, value, and handles loading state', () => {
    // Test the loading state
    const { rerender } = render(<KpiCard title="Test Metric" value="" isLoading={true} />);
    expect(screen.getByText('Test Metric')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    // Rerender the component in the non-loading state
    rerender(<KpiCard title="Test Metric" value="$1,234.56" isLoading={false} />);
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
  });

  it('fetches data from a URL and displays the formatted value', async () => {
    // 1. SETUP
    // Define the fake data our API will return
    const fakeApiResponse = {
      gross_revenue: 75999.95,
    };
    mockedAxiosGet.mockResolvedValue({ data: fakeApiResponse });

    // 2. RENDER
    // Render the component with the new data-fetching props
    render(
      <KpiCard
        title="Gross Revenue"
        dataUrl="/api/v1/analytics/gross-revenue"
        dataKey="gross_revenue"
        formatAs="currency"
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