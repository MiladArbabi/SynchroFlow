// tests/unit/ui/InventoryHealthTable.test.tsx
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import axios from 'axios';
import { InventoryHealthTable } from 'components/InventoryHealthTable';

jest.mock('axios');
const mockedAxiosGet = axios.get as jest.Mock;

test('fetches and displays inventory health data', async () => {
  const fakeData = [
    { sku: 'SKU-01', status: 'Healthy', quantity_available: 100 },
    { sku: 'SKU-02', status: 'At Risk', quantity_available: 15 },
  ];
  mockedAxiosGet.mockResolvedValue({ data: fakeData });

  renderWithProviders(<InventoryHealthTable />);

  await waitFor(() => {
    expect(screen.getByText('SKU-01')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('SKU-02')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
  });
});