import { render, screen } from '@testing-library/react';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

// ---- MOCKS ----

// Mock IntegrationContext
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

// Mock ActivationSurfacePage
jest.mock('activation/ActivationSurfacePage', () => () => (
  <div data-testid="activation-surface">ACTIVATION_SURFACE</div>
));

// Mock SyncSurfacePage
jest.mock('activation/SyncSurfacePage', () => () => (
  <div data-testid="sync-surface">SYNC_SURFACE</div>
));

// Mock ConnectStoreModal (not under test)
jest.mock('components/ConnectStoreModal', () => ({
  ConnectStoreModal: () => null,
}));

// Mock AuthContext
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

// Mock axios
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const { useIntegration } = require('contexts/IntegrationContext');

describe('CommerceActivationGate — FT phases', () => {
  const renderGate = () =>
    render(
      <CommerceActivationGate moduleId="order-nexus">
        <div data-testid="live-ui">LIVE_UI</div>
      </CommerceActivationGate>
    );

  test('FT-1 → renders ActivationSurface when no integration exists', () => {
    useIntegration.mockReturnValue({
      hasIntegrations: false,
      syncStatus: 'NOT_FOUND',
      progress: { current: 0, total: 0, percentage: 0 },
    });

    renderGate();

    expect(screen.getByTestId('activation-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('sync-surface')).toBeNull();
    expect(screen.queryByTestId('live-ui')).toBeNull();
  });

  test('FT-0 → renders SyncSurface when integration exists but sync incomplete', () => {
    useIntegration.mockReturnValue({
      hasIntegrations: true,
      syncStatus: 'SYNCING_PRODUCTS',
      progress: { current: 3, total: 10, percentage: 30 },
    });

    renderGate();

    expect(screen.getByTestId('sync-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('activation-surface')).toBeNull();
    expect(screen.queryByTestId('live-ui')).toBeNull();
  });

  test('LIVE → renders children when sync is COMPLETED', () => {
    useIntegration.mockReturnValue({
      hasIntegrations: true,
      syncStatus: 'COMPLETED',
      progress: { current: 10, total: 10, percentage: 100 },
    });

    renderGate();

    expect(screen.getByTestId('live-ui')).toBeInTheDocument();
    expect(screen.queryByTestId('activation-surface')).toBeNull();
    expect(screen.queryByTestId('sync-surface')).toBeNull();
  });
});
