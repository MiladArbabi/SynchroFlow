/* eslint-disable @typescript-eslint/no-explicit-any */
import { screen } from '@testing-library/react';
import { SyncProgressBanner } from 'components/SyncProgressBanner';
import { renderWithTheme } from 'test-utils';

// Mock IntegrationContext
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

import { useIntegration } from 'contexts/IntegrationContext';
const mockedUseIntegration = useIntegration as jest.MockedFunction<any>;

describe('SyncProgressBanner (contract-safe)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when no integration record exists', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrationRecord: false,
      isSyncComplete: false,
      syncStatus: 'NOT_FOUND',
      progress: { current: 0, total: 0, percentage: 0 },
    });

    renderWithTheme(<SyncProgressBanner />);

    expect(screen.queryByTestId('sync-progress-banner')).toBeNull();
  });

  it('does not render when sync is complete', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrationRecord: true,
      isSyncComplete: true,
      syncStatus: 'COMPLETED',
      progress: { current: 100, total: 100, percentage: 100 },
    });

    renderWithTheme(<SyncProgressBanner />);

    expect(screen.queryByTestId('sync-progress-banner')).toBeNull();
  });

  it('renders banner during in-progress sync', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrationRecord: true,
      isSyncComplete: false,
      syncStatus: 'SYNCING_PRODUCTS',
      progress: { current: 50, total: 100, percentage: 50 },
    });

    renderWithTheme(<SyncProgressBanner />);

    const banner = screen.getByTestId('sync-progress-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Importing your Shopify data');
    expect(banner).toHaveTextContent('Status: SYNCING_PRODUCTS');
    expect(banner).toHaveTextContent('50% complete');
  });

  it('uses indeterminate progress when percentage is zero', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrationRecord: true,
      isSyncComplete: false,
      syncStatus: 'SYNCING_PRODUCTS',
      progress: { current: 0, total: 0, percentage: 0 },
    });

    renderWithTheme(<SyncProgressBanner />);

    expect(screen.queryByText(/% complete/i)).toBeNull();
  });
});
