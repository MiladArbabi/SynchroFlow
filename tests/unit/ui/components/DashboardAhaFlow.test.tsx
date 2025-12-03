// tests/unit/ui/components/DashboardAhaFlow.test.tsx
import '@testing-library/jest-dom';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';

import { renderWithProviders } from 'test-utils';
import { DashboardPage } from 'pages/DashboardPage';
import { useIntegration } from 'contexts/IntegrationContext';

// ---- Mocks ----

// Mock AuthContext so useAuth doesn't blow up in DashboardPage
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    accessToken: 'test-access-token',
    isLoggedIn: true,
  }),
}));

// Mock IntegrationContext so we can control sync state + spy on refreshIntegrationStatus
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

// Mock DashboardStateManager to expose an explicit "connect" trigger button
jest.mock('components/DashboardStateManager/DashboardStateManager', () => ({
  DashboardStateManager: ({ onConnectStore, children }: any) => (
    <div data-testid="dashboard-state-manager">
      <button
        data-testid="connect-store-trigger"
        onClick={onConnectStore}
      >
        Connect Store (test)
      </button>
      {children}
    </div>
  ),
}));

// Mock WidgetLayoutWithRegistry to avoid pulling the whole widget system into this test
jest.mock('components/widgets/WidgetLayoutWithRegistry', () => ({
  WidgetLayoutWithRegistry: () => (
    <div data-testid="widget-layout">Widget Layout</div>
  ),
}));

// Mock DataSyncingModal so we can simply assert when it's "open"
jest.mock('components/DataSyncingModal', () => ({
  DataSyncingModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="data-syncing-modal">Sync Modal Open</div> : null,
}));

// Mock ConnectStoreModal so we only care whether it is open
jest.mock('components/ConnectStoreModal', () => ({
  ConnectStoreModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="connect-store-modal-open" /> : null,
}));

// Mock ConnectionErrorModal to inspect error text
jest.mock('components/ConnectionErrorModal', () => ({
  ConnectionErrorModal: ({
    open,
    error,
  }: {
    open: boolean;
    error: string | null;
  }) =>
    open ? (
      <div data-testid="connection-error-modal">{error}</div>
    ) : null,
}));

// Mock axios for pre-flight checks
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DashboardPage Aha-flow & Shopify connect UX', () => {
  const baseIntegrationState = {
    isLoading: false,
    hasIntegrations: true,
    isFirstTimeSync: true,
    syncStatus: 'SYNCING_PRODUCTS',
    progress: { current: 0, total: 0, percentage: 0 },
    lastError: null,
    refreshIntegrationStatus: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useIntegration as jest.Mock).mockReturnValue({
      ...baseIntegrationState,
      refreshIntegrationStatus: jest.fn(),
    });
  });

  it('opens DataSyncingModal and refreshes integration status when connect=success is present', async () => {
    const refreshIntegrationStatus = jest.fn();
    (useIntegration as jest.Mock).mockReturnValue({
      ...baseIntegrationState,
      refreshIntegrationStatus,
    });

    renderWithProviders(
        <DashboardPage handleSidenavToggle={jest.fn()}>
            <div data-testid="dashboard-child" />
        </DashboardPage>,
        {
            routerProps: {
            initialEntries: ['/dashboard?connect=success'],
            },
        }
    );

    // Modal should appear as a result of the query param
    await waitFor(() =>
      expect(
        screen.getByTestId('data-syncing-modal')
      ).toBeInTheDocument()
    );

    // refreshIntegrationStatus should be called once on success path
    expect(refreshIntegrationStatus).toHaveBeenCalled();
  });

  it('opens ConnectionErrorModal when connect=error is present and shows message', async () => {
    const errorMessage = 'Authorization was canceled. Please try again.';

    renderWithProviders(
        <DashboardPage handleSidenavToggle={jest.fn()}>
            <div data-testid="dashboard-child" />
        </DashboardPage>,
        {
            routerProps: {
            initialEntries: [`/dashboard?connect=error&message=${encodeURIComponent(errorMessage)}`],
            },
        }
    );


    // Error modal should be visible with the provided message
    await waitFor(() =>
      expect(
        screen.getByTestId('connection-error-modal')
      ).toBeInTheDocument()
    );

    expect(screen.getByTestId('connection-error-modal')).toHaveTextContent(
      errorMessage
    );
  });

  it('runs pre-flight check and opens ConnectStoreModal when onConnectStore is triggered and pre-flight succeeds', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { ready: true, issues: [] },
    });

    renderWithProviders(
    <DashboardPage handleSidenavToggle={jest.fn()}>
        <div data-testid="dashboard-child" />
    </DashboardPage>,
    {
        routerProps: {
        initialEntries: ['/dashboard'],
        },
    }
    );

    const trigger = screen.getByTestId('connect-store-trigger');
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/api/v1/integrations/pre-flight',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-access-token',
          },
        })
      );
    });

    // Connect modal should now be open
    await waitFor(() => {
      expect(
        screen.getByTestId('connect-store-modal-open')
      ).toBeInTheDocument();
    });

    // No error modal in the happy path
    expect(
      screen.queryByTestId('connection-error-modal')
    ).not.toBeInTheDocument();
  });

  it('shows ConnectionErrorModal when pre-flight check fails', async () => {
    mockedAxios.get.mockRejectedValueOnce({
      response: {
        data: {
          issues: ['Database connection error.'],
        },
      },
    });

    renderWithProviders(
        <DashboardPage handleSidenavToggle={jest.fn()}>
            <div data-testid="dashboard-child" />
        </DashboardPage>,
        {
            routerProps: {
            initialEntries: ['/dashboard'],
            },
        }
    );

    const trigger = screen.getByTestId('connect-store-trigger');
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(
        screen.getByTestId('connection-error-modal')
      ).toBeInTheDocument()
    );

    expect(screen.getByTestId('connection-error-modal')).toHaveTextContent(
      'System check failed: Database connection error.'
    );

    // Connect modal should not be open when pre-flight fails
    expect(
      screen.queryByTestId('connect-store-modal-open')
    ).not.toBeInTheDocument();
  });
});
