// packages/ui/src/components/PerfectOrderGauge.test.tsx
import { waitFor, screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import axios from "axios";
import { PerfectOrderGauge } from '../../../packages/ui/src/components/PerfectOrderGauge'

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

describe('PerfectOrderGauge', () => {

afterEach(() => {
    jest.clearAllMocks();
  });

  
  it('fetches data and renders the gauge with the correct percentage', async () => {
    // Mock the API response
    mockedAxiosGet.mockResolvedValue({
      data: { perfect_order_percentage: 80.0 },
    })

    // 2. RENDER
    renderWithProviders(<PerfectOrderGauge />);

    // Wait for loading state to resolve and check for title
    expect(await screen.findByText('Perfect Order %', {}, { timeout: 2000 })).toBeInTheDocument();
    
    // Check for the formatted percentage value
    expect(await screen.findByText('80.0%')).toBeInTheDocument();
    
    // Verify the API was called with the correct URL
    expect(mockedAxiosGet).toHaveBeenCalledWith('/api/v1/analytics/perfect-order-percentage?shop_id=1');
  });

  it('displays loading state initially', () => {
    // Mock API to be pending
    mockedAxiosGet.mockImplementation(() => new Promise(() => {})); // Never resolves
    renderWithProviders(<PerfectOrderGauge />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    // Mock API failure
    mockedAxiosGet.mockRejectedValueOnce(new Error('API failure'));
    renderWithProviders(<PerfectOrderGauge />);

    // Wait for loading to resolve
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Check that percentage displays as 0% on error
    expect(await screen.findByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('Perfect Order %')).toBeInTheDocument();
  });
});