// tests/unit/ui/OrdersPage.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from 'test-utils';
import axios from 'axios';
// This import will fail
import OrdersPage from 'pages/OrdersPage';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock MasterPanel
jest.mock('ui-component/MasterPanel/index.tsx', () => ({
  __esModule: true,
  default: ({ title, children }: { title: React.ReactNode, children: React.ReactNode }) => (
    <div data-testid="master-panel-mock">
      <h1>{title}</h1>
      <div>{children}</div>
    </div>
  ),
}));

// Mock DataGrid from MUI - essential for testing row clicks
jest.mock('@mui/x-data-grid', () => ({
  ...jest.requireActual('@mui/x-data-grid'), // Keep original exports like GridColDef
  DataGrid: ({ rows, columns, onRowClick }: any) => (
    <div data-testid="data-grid-mock">
      <table>
        <thead>
          <tr>{columns.map((col: any) => <th key={col.field}>{col.headerName}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <tr key={row.id} onClick={() => onRowClick({ row })}>
              {columns.map((col: any) => <td key={col.field}>{row[col.field]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
}));

// Mock react-router-dom's useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

describe('OrdersPage (#292)', () => {
  const mockOrders = [
    { id: '1001', customer_name: 'Alice', total: 50.00, status: 'Pending' },
    { id: '1002', customer_name: 'Bob', total: 75.50, status: 'Shipped' },
  ];

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockNavigate.mockReset();
    // Mock the API response for fetching orders
    mockedAxios.get.mockResolvedValue({ data: mockOrders });
  });

  it('should fetch orders, render MasterPanel with DataGrid, and navigate on row click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrdersPage />);

    // This test is RED.
    // It will FAIL: Cannot find module 'pages/OrdersPage.tsx'

    // Assertions for when the component exists:
    // 1. Check API call
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/orders');
    });

    // 2. Check MasterPanel and Title
    expect(screen.getByTestId('master-panel-mock')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();

    // 3. Check DataGrid render (via mock content)
    const dataGrid = await screen.findByTestId('data-grid-mock');
    expect(dataGrid).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument(); // Check for cell content
    expect(screen.getByText('Bob')).toBeInTheDocument();

    // 4. Simulate row click and check navigation
    await user.click(screen.getByText('Alice')); // Click cell in the first row
    expect(mockNavigate).toHaveBeenCalledWith('/orders/1001'); // Check navigation path
  });
});