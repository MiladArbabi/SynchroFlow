// tests/unit/ui/CustomersPage.test.tsx
import { screen, waitFor } from '@testing-library/react'; // Add waitFor
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from 'test-utils';
import CustomersPage from 'pages/CustomersPage.tsx';
// No longer import from @tanstack/react-query here

// Mock axios
import axios from 'axios';
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

// Mock DataGrid (renders basic table content for verification)
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

describe('CustomersPage with useQuery (#351)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockedAxios.get.mockReset(); // Reset axios mock
    // Default SUCCESS mock for axios.get
    mockedAxios.get.mockResolvedValue({
      data: mockCustomers,
    });
  });

  it('should render loading state initially, then data, and navigate on row click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);

    // 1. Check for loading state initially
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('data-grid-mock')).not.toBeInTheDocument();

    // 2. Wait for data to load and check MasterPanel/Title
    expect(await screen.findByTestId('master-panel-mock')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument();

    // 3. Verify loading spinner is gone and DataGrid content is present
    // MODIFICATION: Wait for the progress bar to disappear
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    const dataGrid = screen.getByTestId('data-grid-mock');
    expect(dataGrid).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();

    // 4. Row click navigation
    await user.click(screen.getByText('John Doe')); // Click cell in John's row
    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust_abc');
  });


  it('should render error state', async () => {
    // Override axios mock to reject for this test
    const mockError = new Error('Network Error');
    mockedAxios.get.mockRejectedValueOnce(mockError);
    renderWithProviders(<CustomersPage />);

    // Wait for the error alert to appear
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Failed to load customers/i)).toBeInTheDocument();
    expect(screen.queryByTestId('data-grid-mock')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(); // Ensure loading is also gone
  });
});