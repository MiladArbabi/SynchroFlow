// tests/unit/ui/components/DashboardStateManager.activation-surface.test.tsx

import React from 'react';
import { renderWithProviders } from 'test-utils';
import { DashboardStateManager } from 'components/DashboardStateManager/DashboardStateManager';

// ─────────────────────────────────────────────────────────────
// Mock Activation Surface (authoritative)
// ─────────────────────────────────────────────────────────────
jest.mock('activation/useActivationSurface', () => ({
  useActivationSurface: jest.fn(),
}));

const mockUseActivationSurface =
  require('activation/useActivationSurface').useActivationSurface as jest.Mock;

// ─────────────────────────────────────────────────────────────
// HARD FAIL if raw lifecycle data is touched
// ─────────────────────────────────────────────────────────────
jest.mock('contexts/DashboardStateContext', () => ({
  useDashboardState: () => ({
    userState: {
      get shopify_connected() {
        throw new Error('❌ Dashboard must not read shopify_connected');
      },
      get first_insight_delivered() {
        throw new Error('❌ Dashboard must not read first_insight_delivered');
      },
    },
    isLoading: false,
  }),
}));

describe('DashboardStateManager — ActivationSurface ownership', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders EmptyDashboardState when ActivationSurface requires it', () => {
    mockUseActivationSurface.mockReturnValue({
      isLoading: false,
      showSyncModal: false,
      showEmptyState: true,
      showDashboard: false,
    });

    expect(() =>
      renderWithProviders(
        <DashboardStateManager onConnectStore={jest.fn()}>
          <div>dashboard</div>
        </DashboardStateManager>
      )
    ).not.toThrow();
  });

  it('renders dashboard content only when ActivationSurface allows it', () => {
    mockUseActivationSurface.mockReturnValue({
      isLoading: false,
      showSyncModal: false,
      showEmptyState: false,
      showDashboard: true,
    });

    const { getByText } = renderWithProviders(
      <DashboardStateManager onConnectStore={jest.fn()}>
        <div>dashboard content</div>
      </DashboardStateManager>
    );

    expect(getByText('dashboard content')).toBeInTheDocument();
  });

  it('never reads raw lifecycle or onboarding flags', () => {
    mockUseActivationSurface.mockReturnValue({
      isLoading: false,
      showSyncModal: false,
      showEmptyState: true,
      showDashboard: false,
    });

    expect(() =>
      renderWithProviders(
        <DashboardStateManager onConnectStore={jest.fn()}>
          <div />
        </DashboardStateManager>
      )
    ).not.toThrow();
  });
});
