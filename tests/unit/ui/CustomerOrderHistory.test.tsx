// tests/unit/ui/CustomerOrderHistory.test.tsx
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
// This import will fail
import CustomerOrderHistory from 'components/Customer360/CustomerOrderHistory.tsx';

// Mock DataGrid simply renders rows/cells text content
jest.mock('@mui/x-data-grid', () => ({
  ...jest.requireActual('@mui/x-data-grid'),
  DataGrid: ({ rows, columns }: any) => (
    <div data-testid="data-grid-mock">
      <table>
        <thead>
          <tr>{columns.map((col: any) => <th key={col.field}>{col.headerName}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <tr key={row.id}>
              {columns.map((col: any) => <td key={col.field}>{/* Render formatted value if exists, else raw value */}
                {col.valueFormatter ? col.valueFormatter(row[col.field]) : row[col.field]}
              </td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
}));


// Define mock data structure
const mockOrders = [
  { id: '1002', orderDate: '2025-10-20T14:00:00Z', status: 'Shipped', total: 75.50 },
  { id: '1001', orderDate: '2025-09-15T10:30:00Z', status: 'Delivered', total: 50.00 },
];

describe('CustomerOrderHistory Component (#328)', () => {
  it('should render a DataGrid with order history', () => {
    renderWithProviders(<CustomerOrderHistory orders={mockOrders} />);

    // This test is RED.
    // It will FAIL: Cannot find module 'components/Customer360/CustomerOrderHistory.tsx'

    // Assertions for when the component exists:
    const dataGrid = screen.getByTestId('data-grid-mock');
    expect(dataGrid).toBeInTheDocument();

    // Check for headers
    expect(within(dataGrid).getByRole('columnheader', { name: 'Order ID' })).toBeInTheDocument();
    expect(within(dataGrid).getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(within(dataGrid).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(within(dataGrid).getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();

    // Check for cell content (use within to scope search to the grid)
    expect(within(dataGrid).getByText('1002')).toBeInTheDocument();
    expect(within(dataGrid).getByText('Shipped')).toBeInTheDocument();
    expect(within(dataGrid).getByText('$76')).toBeInTheDocument(); // Formatted total
    expect(within(dataGrid).getByText(/Oct 20, 2025/i)).toBeInTheDocument(); // Formatted date
  });

  it('should render empty state if no orders provided', () => {
    renderWithProviders(<CustomerOrderHistory orders={[]} />);
    expect(screen.getByText(/No order history available/i)).toBeInTheDocument();
    expect(screen.queryByTestId('data-grid-mock')).not.toBeInTheDocument();
  });

  it('should render loading state', () => {
     renderWithProviders(<CustomerOrderHistory orders={undefined} isLoading={true} />);
     expect(screen.getByRole('progressbar')).toBeInTheDocument();
     expect(screen.queryByTestId('data-grid-mock')).not.toBeInTheDocument();
  });
});