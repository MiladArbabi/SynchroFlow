// tests/unit/ui/SyncProgressBanner.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SyncProgressBanner } from 'components/SyncProgressBanner';

// Mock IntegrationContext so we can control sync state
jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

import { useIntegration } from 'contexts/IntegrationContext';

const mockedUseIntegration = useIntegration as jest.MockedFunction<any>;

describe('SyncProgressBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when there is no integration', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrations: false,
      syncStatus: 'PENDING',
      progress: { current: 0, total: 0, percentage: 0 },
    });

    const { container } = render(<SyncProgressBanner />);

    expect(screen.queryByTestId('sync-progress-banner')).toBeNull();
    // sanity: no Alert rendered
    expect(container).toMatchSnapshot();
  });

  it('renders nothing when sync is completed', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrations: true,
      syncStatus: 'COMPLETED',
      progress: { current: 100, total: 100, percentage: 100 },
    });

    render(<SyncProgressBanner />);

    expect(screen.queryByTestId('sync-progress-banner')).toBeNull();
  });

  it('renders banner for in-progress sync with percentage', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrations: true,
      syncStatus: 'SYNCING_PRODUCTS',
      progress: { current: 50, total: 100, percentage: 50 },
    });

    render(<SyncProgressBanner />);

    const banner = screen.getByTestId('sync-progress-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Importing your Shopify data…');
    expect(banner).toHaveTextContent('Status: SYNCING_PRODUCTS');
    expect(banner).toHaveTextContent('50% complete');
  });

  it('uses indeterminate progress when percentage is 0 or missing', () => {
    mockedUseIntegration.mockReturnValue({
      hasIntegrations: true,
      syncStatus: 'SYNCING_PRODUCTS',
      progress: { current: 0, total: 0, percentage: 0 },
    });

    const { container } = render(<SyncProgressBanner />);

    const linear = container.querySelector('.MuiLinearProgress-root');
    expect(linear).toBeInTheDocument();
    // We rely on the component logic:
    // pct === 0 => variant="indeterminate" (no % text shown)
    expect(screen.queryByText(/0% complete/i)).toBeNull();
  });
});
