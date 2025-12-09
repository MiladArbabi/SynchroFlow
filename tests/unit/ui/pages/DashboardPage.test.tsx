// tests/unit/ui/DashboardPage.test.tsx
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { DashboardPage } from 'pages/DashboardPage';
import { renderWithProviders } from 'test-utils';
import { useIntegration } from 'contexts/IntegrationContext';
import { useAuth } from 'contexts/AuthContext';

// Mock hooks
const mockUseSearchParams = jest.fn();
jest.mock('axios');
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

// Mock components
jest.mock('components/DataSyncingModal', () => ({
  DataSyncingModal: ({ open, onClose }: any) => 
    open ? (
      <div data-testid="data-syncing-modal">
        <button onClick={onClose} data-testid="close-sync-modal">
          Close Modal
        </button>
        Data Syncing Modal
      </div>
    ) : null
}));

jest.mock('components/ConnectStoreModal', () => ({
  ConnectStoreModal: ({ isOpen, onClose }: any) => 
    isOpen ? (
      <div data-testid="connect-store-modal">
        Connect Store Modal
        <button onClick={onClose} data-testid="close-connect-modal">
          Close Connect Modal
        </button>
      </div>
    ) : null
}));

jest.mock('components/ConnectionErrorModal', () => ({
  ConnectionErrorModal: ({ open, error, onClose, onRetry }: any) =>
    open ? (
      <div data-testid="connection-error-modal">
        <div>Connection Error: {error}</div>
        <button onClick={onClose} data-testid="close-error-modal">
          Skip for Now
        </button>
        <button onClick={onRetry} data-testid="retry-connection">
          Try Again
        </button>
      </div>
    ) : null
}));

jest.mock('components/widgets/WidgetLayoutWithRegistry', () => ({
  WidgetLayoutWithRegistry: () => <div data-testid="widget-layout">Widget Layout</div>
}));

jest.mock('components/DashboardStateManager/DashboardStateManager', () => ({
  DashboardStateManager: ({ children, onConnectStore }: any) => (
    <div data-testid="dashboard-state-manager">
      <button onClick={onConnectStore} data-testid="connect-store-button">
        Connect Store
      </button>
      {children}
    </div>
  )
}));

// Mock react-router-dom
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useSearchParams: () => {
    const result = mockUseSearchParams();
    return Array.isArray(result) && result.length === 2 ? result : [new URLSearchParams(), jest.fn()];
  },
}));

// Mock axios configuration
jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseIntegration = useIntegration as jest.MockedFunction<typeof useIntegration>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Default mock data
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
  syncStatus: 'NOT_FOUND' as const,
  progress: { percentage: 0, current: 0, total: 0 },
  hasIntegrations: false,
  isFirstTimeSync: false,
  isLoading: false,
  refreshIntegrationStatus: jest.fn(),
  lastError: null,
};

// Mock query client
const mockInvalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

describe('DashboardPage', () => {
  const mockHandleSidenavToggle = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateQueries.mockClear();
    
    // Default mocks
    mockUseSearchParams.mockReturnValue([
      new URLSearchParams(),
      jest.fn(),
    ]);
    
    mockedUseAuth.mockReturnValue(defaultMockAuth);
    mockedUseIntegration.mockReturnValue({
      ...defaultMockIntegration,
      hasIntegrations: true, // User has integrations by default
    });
  });

  describe('AHA-FLOW: OAuth Integration', () => {
    it('should render DataSyncingModal when connect=success param is present', () => {
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'success');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(),
      ]);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      expect(screen.getByTestId('data-syncing-modal')).toBeInTheDocument();
    });

    it('should stagger query invalidations with delays when DataSyncingModal is closed', async () => {
      jest.useFakeTimers();
      
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'success');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(),
      ]);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      // Click the close button to trigger handleSyncModalClose
      const closeButton = screen.getByTestId('close-sync-modal');
      closeButton.click();

      // Immediately after close, no queries should be invalidated yet
      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      // After 300ms: dashboardInventory
      jest.advanceTimersByTime(200);
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboardInventory'] });

      // After 500ms: dashboardShipments
      jest.advanceTimersByTime(200);
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboardShipments'] });

      // Verify call order
      const calls = mockInvalidateQueries.mock.calls;
      expect(calls.map(call => call[0].queryKey[0])).toEqual([
        'dashboardPulse', 
        'dashboardInventory', 
        'dashboardShipments'
      ]);

      jest.useRealTimers();
    });

    it('should render ConnectionErrorModal when connect=error param is present', () => {
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'error');
      searchParams.set('message', 'Test error message');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(),
      ]);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      expect(screen.getByTestId('connection-error-modal')).toBeInTheDocument();
      expect(screen.getByText('Connection Error: Test error message')).toBeInTheDocument();
    });

    it('should not render modals when no OAuth flow conditions are met', () => {
      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      expect(screen.queryByTestId('data-syncing-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('connection-error-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('connect-store-modal')).not.toBeInTheDocument();
    });
  });

  describe('Connect Store Flow', () => {
    it('should open ConnectStoreModal when pre-flight check succeeds', async () => {
      // Mock user with no integrations
      mockedUseIntegration.mockReturnValue({
        ...defaultMockIntegration,
        hasIntegrations: false,
      });

      // Mock successful pre-flight check
      mockedAxios.get.mockResolvedValueOnce({ data: { status: 'ok' } });

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      // Click the connect store button from DashboardStateManager
      const connectButton = screen.getByTestId('connect-store-button');
      connectButton.click();

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/integrations/pre-flight', {
          headers: {
            Authorization: 'Bearer mock-token-123',
          },
        });
        expect(screen.getByTestId('connect-store-modal')).toBeInTheDocument();
      });
    });

    it('should show ConnectionErrorModal when pre-flight check fails', async () => {
      // Mock user with no integrations
      mockedUseIntegration.mockReturnValue({
        ...defaultMockIntegration,
        hasIntegrations: false,
      });

      // Mock failed pre-flight check
      const errorResponse = {
        response: {
          data: {
            issues: ['Service unavailable'],
          },
        },
      };
      mockedAxios.get.mockRejectedValueOnce(errorResponse);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      // Click the connect store button
      const connectButton = screen.getByTestId('connect-store-button');
      connectButton.click();

      await waitFor(() => {
        expect(screen.getByTestId('connection-error-modal')).toBeInTheDocument();
        expect(screen.getByText(/System check failed: Service unavailable/)).toBeInTheDocument();
      });
    });

    it('should handle retry from ConnectionErrorModal', async () => {
      // First, set up error state
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'error');
      searchParams.set('message', 'Initial error');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        jest.fn(),
      ]);

      // Mock successful pre-flight on retry
      mockedAxios.get.mockResolvedValueOnce({ data: { status: 'ok' } });

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      // Click retry button
      const retryButton = screen.getByTestId('retry-connection');
      retryButton.click();

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/integrations/pre-flight', {
          headers: {
            Authorization: 'Bearer mock-token-123',
          },
        });
        expect(screen.getByTestId('connect-store-modal')).toBeInTheDocument();
      });
    });
  });

  describe('Component Integration', () => {
    it('should render DashboardStateManager and WidgetLayoutWithRegistry', () => {
      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      expect(screen.getByTestId('dashboard-state-manager')).toBeInTheDocument();
      expect(screen.getByTestId('widget-layout')).toBeInTheDocument();
    });

    it('should pass onConnectStore handler to DashboardStateManager', () => {
      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      // The connect button should be present in DashboardStateManager
      expect(screen.getByTestId('connect-store-button')).toBeInTheDocument();
    });
  });

  describe('URL Parameter Cleanup', () => {
    it('should clean URL parameters after processing OAuth flow', () => {
      const mockSetSearchParams = jest.fn();
      const searchParams = new URLSearchParams();
      searchParams.set('connect', 'success');
      
      mockUseSearchParams.mockReturnValue([
        searchParams,
        mockSetSearchParams,
      ]);

      renderWithProviders(
        <DashboardPage children={<></>} handleSidenavToggle={mockHandleSidenavToggle} />
      );

      // Should call setSearchParams to clean the URL
      expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true });
    });
  });
});