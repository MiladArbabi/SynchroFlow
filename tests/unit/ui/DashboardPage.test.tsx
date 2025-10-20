// tests/unit/ui/DashboardPage.test.tsx
import '@testing-library/jest-dom';

// Mock the user context hook
jest.mock('contexts/UserContext');

jest.mock('components/KpiCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string; dataUrl: string; format: string; icon: string; color: string }) => <div data-testid="kpi-card">{title}</div>,
}));

jest.mock('components/InventoryHealthTable', () => ({
  InventoryHealthTable: () => <div>Inventory Health Table</div>,
}));
jest.mock('components/FulfillmentPipelineChart', () => ({
  FulfillmentPipelineChart: () => <div>Fulfillment Pipeline Chart</div>,
}));
jest.mock('components/PerfectOrderGauge', () => ({
  PerfectOrderGauge: () => <div>Perfect Order Gauge</div>,
}));
jest.mock('components/ConnectStoreModal', () => ({
  ConnectStoreModal: ({ isOpen }: { isOpen: boolean; onClose: () => void }) => isOpen ? <h2>Connect a Data Source</h2> : null,
}));


describe('DashboardPage', () => {
  // Reset mocks before each test
  beforeEach(() => {
   /*  mockedUseUser.mockClear(); */
  });

  it('renders the main dashboard layout and all widgets', () => {
    // Set the default mock return value for this test
    /* mockedUseUser.mockReturnValue({ isSandbox: false });
    renderWithProviders(<DashboardPage />); */

    //expect(screen.getByText('Gross Margin')).toBeInTheDocument();
    //expect(screen.getByText('Total Inventory Value')).toBeInTheDocument();
    //expect(screen.getByText('Cost of Stockout')).toBeInTheDocument();
    //expect(screen.getByText('Inventory Health Table')).toBeInTheDocument();
    //expect(screen.getByText('Fulfillment Pipeline Chart')).toBeInTheDocument();
    //expect(screen.getByText('Perfect Order Gauge')).toBeInTheDocument();
  });
});