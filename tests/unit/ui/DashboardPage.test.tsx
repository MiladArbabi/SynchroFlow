// tests/unit/ui/DashboardPage.test.tsx
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { DashboardPage } from 'pages/DashboardPage';
import { renderWithProviders } from 'test-utils';
import { useIntegration } from 'contexts/IntegrationContext';
import { useAuth } from 'contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useLayoutContext } from 'App';
import { PlanLevel } from 'widgets/widgetRegistry';

const mockUseSearchParams = jest.fn();

jest.mock('axios');
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));
jest.mock('App', () => ({
  useLayoutContext: jest.fn(),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: jest.fn().mockReturnValue({
    data: {
      automated_tasks: 0,
      labor_cost_saved: 0,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));
jest.mock('widgets/widgetRegistry', () => ({
  getWidgetConfigByVariantId: jest.fn(),
  WIDGET_REGISTRY: {},
  PlanLevel: {},
}));
jest.mock('components/WidgetLibrary', () => ({
  __esModule: true,
  default: ({ open }: any) => 
    open ? <div data-testid="widget-library">Widget Library</div> : null
}));
jest.mock('components/DataSyncingModal', () => ({
  DataSyncingModal: ({ open }: any) => 
    open ? <div data-testid="data-syncing-modal">Data Syncing Modal</div> : null
}));
jest.mock('components/Icon', () => ({
  __esModule: true,
  default: ({ name }: any) => 
    <span data-testid={`icon-${name}`}>Icon</span>
}));

// Mock the problematic axios configuration
jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}));

// Mock widget components
jest.mock('components/KpiCard', () => ({
  KPIWidget: ({ title, value }: { title: string; value: string }) => (
    <div data-testid={`kpi-widget-${title}`}>{value}</div>
  )
}));

jest.mock('widgets/AOpexGauge', () => ({
  OPEXGaugeWidget: ({ value }: { value: number }) => (
    <div data-testid="opex-gauge">{value}</div>
  )
}));

jest.mock('widgets/CashFlowWidget', () => ({
  CashflowChartWidget: () => (
    <div data-testid="cashflow-chart">Cashflow Chart</div>
  )
}));

jest.mock('widgets/InventoryHealthWidget', () => ({
  InventoryHealthWidget: ({ data }: { data: any }) => (
    <div data-testid="inventory-health">
      {data?.length || 0} items
    </div>
  )
}));

// Mock react-grid-layout
jest.mock('react-grid-layout', () => ({
  WidthProvider: (Component: any) => Component,
  __esModule: true,
  default: ({ children, ...props }: any) => (
    <div data-testid="grid-layout" {...props}>
      {children}
    </div>
  )
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useSearchParams: () => {
    const result = mockUseSearchParams();
    // Ensure we always return a tuple [URLSearchParams, function]
    if (Array.isArray(result) && result.length === 2) {
      return result;
    }
    // Default fallback
    return [new URLSearchParams(), jest.fn()];
  },
}));

const mockedUseLayoutContext = useLayoutContext as jest.MockedFunction<typeof useLayoutContext>;
const mockedUseQuery = useQuery as jest.MockedFunction<typeof useQuery>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseIntegration = useIntegration as jest.MockedFunction<typeof useIntegration>;
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedGetWidgetConfigByVariantId = require('widgets/widgetRegistry').getWidgetConfigByVariantId as jest.MockedFunction<any>;

// Default mock for layout context
const defaultMockLayoutContext = {
  isEditing: false,
  isLibraryOpen: false,
  setIsLibraryOpen: jest.fn(),
  currentUserPlan: 'Ignition' as PlanLevel,
  layoutRef: { current: [] },
  activeWidgetsRef: { current: [] },
  handleSaveLayout: jest.fn(),
};

// Default mock for React Query
const defaultMockUseQuery = {
  data: {
    automated_tasks: 0,
    labor_cost_saved: 0,
  },
  isLoading: false,
  isError: false,
  error: null,
};

// Define default mock objects based on the actual AuthContext structure
const defaultMockAuth = {
  isLoggedIn: true,
  isLoading: false,
  user: { 
    id: 1,
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    shop_id: 1
  },
  accessToken: 'mock-token-123',
  login: jest.fn(),
  logout: jest.fn(),
  setAccessToken: jest.fn(),
};

const defaultMockIntegration = {
  syncStatus: 'NOT_FOUND',
  progress: { percentage: 0, current: 0, total: 0 },
  hasIntegrations: false,
  isFirstTimeSync: false,
  isLoading: false,
  refreshIntegrationStatus: jest.fn(),
  lastError: null,
};

describe('DashboardPage', () => {
  const mockHandleSidenavToggle = jest.fn();
  const mockChildren = <div>Test Children</div>;
  
  // Default mock data
  const mockOpsIntelData = {
    automated_tasks: 15,
    labor_cost_saved: 5000
  };

  const mockLayoutContext = {
  isEditing: false,
  isLibraryOpen: false,
  setIsLibraryOpen: jest.fn(),
  currentUserPlan: 'Ignition' as const,
  layoutRef: { current: [] }, // Changed from null to []
  activeWidgetsRef: { current: [] },
  handleSaveLayout: jest.fn(), // Added this
  };

  const mockIntegrationContext = {
    ...defaultMockIntegration,
    hasIntegrations: true,
    isFirstTimeSync: false,
    syncStatus: 'COMPLETED' as const,
    isLoading: false,
    refreshIntegrationStatus: jest.fn(),
  };

  // Mock widget configurations
  const mockWidgetConfigs = {
    'kpi-revenue': {
      parentConfig: { component: require('components/KpiCard').KPIWidget },
      variant: { w: 3, h: 1, isResizable: false }
    },
    'kpi-margin': {
      parentConfig: { component: require('components/KpiCard').KPIWidget },
      variant: { w: 3, h: 1, isResizable: false }
    },
    'kpi-inventory': {
      parentConfig: { component: require('components/KpiCard').KPIWidget },
      variant: { w: 3, h: 1, isResizable: false }
    },
    'a-opex-gauge': {
      parentConfig: { component: require('widgets/AOpexGauge').OPEXGaugeWidget },
      variant: { w: 3, h: 1, isResizable: false }
    },
    'cashflow-chart-large': {
      parentConfig: { component: require('widgets/CashFlowWidget').CashflowChartWidget },
      variant: { w: 12, h: 4, isResizable: false }
    },
    'inventory-health-table': {
      parentConfig: { component: require('widgets/InventoryHealthWidget').InventoryHealthWidget },
      variant: { w: 12, h: 4, isResizable: false }
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks for ALL tests
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(), // No params by default
      jest.fn(), // setSearchParams mock
    ]);
    mockedUseLayoutContext.mockReturnValue(mockLayoutContext);
    mockedUseIntegration.mockReturnValue(mockIntegrationContext);
    mockedAxios.get.mockResolvedValue({ data: mockOpsIntelData });
    
    // Mock widget configs
    mockedGetWidgetConfigByVariantId.mockImplementation((variantId: string) => 
      mockWidgetConfigs[variantId as keyof typeof mockWidgetConfigs]
    );
  });

  describe('Rendering and Layout', () => {
    it('should render the dashboard with initial widgets', async () => {
    renderWithProviders(
      <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
        {mockChildren}
      </DashboardPage>,
    );

    // Wait for the widgets to actually render, not just the API call
    await waitFor(() => {
      expect(screen.getByTestId('kpi-widget-Gross Revenue')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Verify initial widgets are rendered
    expect(screen.getByTestId('kpi-widget-Gross Revenue')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-widget-Gross Margin')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-widget-Inventory Value')).toBeInTheDocument();
    expect(screen.getByTestId('opex-gauge')).toBeInTheDocument();
    expect(screen.getByTestId('cashflow-chart')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-health')).toBeInTheDocument();
  });

    it('should render grid layout with correct props', async () => {
      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('grid-layout')).toBeInTheDocument();
      });

      const gridLayout = screen.getByTestId('grid-layout');
      expect(gridLayout).toHaveAttribute('cols', '12');
      expect(gridLayout).toHaveAttribute('rowHeight', '120');
    });
  });

  describe('Edit Mode', () => {
    it('should show remove buttons on widgets when in edit mode', async () => {
      mockedUseLayoutContext.mockReturnValue({
        ...mockLayoutContext,
        isEditing: true
      });

      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>
      );

      await waitFor(() => {
        // Should find multiple remove buttons (one for each widget)
        const removeButtons = screen.getAllByRole('button');
        expect(removeButtons.length).toBeGreaterThan(0);
      });

      // Grid should have editing class
      expect(screen.getByTestId('grid-layout')).toHaveClass('grid-editing');
      expect(screen.getByTestId('grid-layout')).toHaveClass('grid-wiggling');
    });
  });

  describe.skip('OpsIntel Data', () => {
    it('should show loading state when fetching OpsIntel data', async () => {
      // Mock slow API response
      mockedAxios.get.mockImplementation(() => new Promise(() => {}));

      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should show error state when OpsIntel data fetch fails', async () => {
      const errorMessage = 'Network error';
      mockedAxios.get.mockRejectedValue(new Error(errorMessage));

      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>,
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(`Failed to load dashboard data: ${errorMessage}`);
      });
    });
  });

  describe('AHA-FLOW: OAuth Integration', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      
      // Setup default mocks for all contexts
      mockedUseLayoutContext.mockReturnValue({
        ...defaultMockLayoutContext,
        currentUserPlan: 'premium' as PlanLevel,
      });
      
      mockedUseQuery.mockReturnValue(defaultMockUseQuery as any);
      mockedUseAuth.mockReturnValue(defaultMockAuth);
      mockedUseIntegration.mockReturnValue({
        ...defaultMockIntegration,
        syncStatus: 'NOT_FOUND',
      });

      // Default URL params - no OAuth flow
      mockUseSearchParams.mockReturnValue([
        new URLSearchParams(), // No params by default
        jest.fn(), // setSearchParams mock
      ]);
    });

    it('should render DataSyncingModal when connect=success param is present', async () => {
      // Mock URL with success parameter
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'success');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(), // setSearchParams mock
      ]);

      // Mock integration context for syncing state
      mockedUseIntegration.mockReturnValue({
        ...defaultMockIntegration,
        syncStatus: 'SYNCING_PRODUCTS',
        refreshIntegrationStatus: jest.fn(),
      });

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={() => {}} />
      );

      // The modal should be rendered
      expect(screen.getByTestId('data-syncing-modal')).toBeInTheDocument();
    });

    it('should render ConnectionErrorModal when connect=error param is present', () => {
      // Mock URL with error parameter  
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'error');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(), // setSearchParams mock
      ]);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={() => {}} />
      );

      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Skip for Now')).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should not render modals when no OAuth flow conditions are met', () => {
      // Default mocks already set no URL params
      
      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={() => {}} />
      );

      expect(screen.queryByTestId('data-syncing-modal')).not.toBeInTheDocument();
      expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument();
    });

    it('should handle multiple URL parameters correctly', () => {
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'error');
      searchParams.set('other', 'value');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(),
      ]);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={() => {}} />
      );

      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
    });
  });

  describe('Widget Library', () => {
    it('should open widget library when context indicates', async () => {
      mockedUseLayoutContext.mockReturnValue({
        ...mockLayoutContext,
        isLibraryOpen: true
      });

      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>
      );

      await waitFor(() => {
        expect(screen.getByTestId('widget-library')).toBeInTheDocument();
      });
    });
  });

  describe('Integration with Context', () => {
    it('should use layout context values correctly', async () => {
      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>      
      );


      expect(mockedUseLayoutContext).toHaveBeenCalled();
    });

    it('should use integration context values correctly', async () => {
      renderWithProviders(
        <DashboardPage handleSidenavToggle={mockHandleSidenavToggle}>
          {mockChildren}
        </DashboardPage>
      );

      expect(mockedUseIntegration).toHaveBeenCalled();
    });
  });
});