// packages/ui/src/components/DataMapper/DataMapper.test.tsx
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import DataMapper from './DataMapper';

// Mock the axios module
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DataMapper', () => {
  it('renders the main heading', () => {
    render(<DataMapper />);
    expect(screen.getByRole('heading', { name: /data mapping rules/i })).toBeInTheDocument();
  });

  it('fetches and displays mapping rules on mount', async () => {
    // 1. Setup the mock API response
    const mockRules = [
      { id: 1, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.email', target_field_path: 'synchro.customer_email', created_at: '', updated_at: '' },
      { id: 2, shop_id: 1, source_platform: 'shopify', source_field_path: 'order.total_price', target_field_path: 'synchro.order_total', created_at: '', updated_at: '' },
    ];
    mockedAxios.get.mockResolvedValue({ data: mockRules });

    // 2. Render the component
    render(<DataMapper />);

    // 3. Assert that the data is eventually displayed
    // Use findByText which waits for the element to appear
    expect(await screen.findByText('order.email')).toBeInTheDocument();
    expect(screen.getByText('synchro.order_total')).toBeInTheDocument();

    // Verify axios was called correctly
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/mappings?shop_id=1');
  });
});