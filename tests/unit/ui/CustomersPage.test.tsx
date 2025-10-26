// tests/unit/ui/CustomersPage.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from 'test-utils';
import axios from 'axios';
// This import will fail
import CustomersPage from 'pages/CustomersPage.tsx';

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

// Mock DataGrid
jest.mock('@mui/x-data-grid', () => ({
  ...jest.requireActual('@mui/x-data-grid'),
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

// Mock customer data
const mockCustomers = [
  { id: 'cust_abc', name: 'John Doe', email: 'john.doe@example.com', total_orders: 5 },
  { id: 'cust_def', name: 'Jane Smith', email: 'jane.smith@example.com', total_orders: 2 },
];

describe('CustomersPage (#FEAT(UI): Build Customers Master Panel page)', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockNavigate.mockReset();
    mockedAxios.get.mockResolvedValue({ data: mockCustomers }); // Mock API response
  });

  it('should fetch customers, render MasterPanel/DataGrid, and navigate on row click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);

    // This test is RED.
    // It will FAIL: Cannot find module 'pages/CustomersPage.tsx'

    // Assertions:
    // 1. API call
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/customers');
    });

    // 2. MasterPanel and Title
    expect(screen.getByTestId('master-panel-mock')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument();

    // 3. DataGrid content
    const dataGrid = await screen.findByTestId('data-grid-mock'); // Wait for grid
    expect(dataGrid).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();

    // 4. Row click navigation
    await user.click(screen.getByText('John Doe')); // Click cell in John's row
    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust_abc');
  });
});