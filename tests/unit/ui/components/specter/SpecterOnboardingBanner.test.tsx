// tests/unit/ui/components/specter/SpecterOnboardingBanner.test.tsx
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import { SpecterOnboardingBanner } from 'components/specter/SpecterOnboardingBanner';
import { SpecterConfigProvider, useSpecterConfig } from 'contexts/SpecterConfigContext';
import { useIntegration } from 'contexts/IntegrationContext';
import { useEntitlements } from 'contexts/EntitlementsContext';

jest.mock('contexts/SpecterConfigContext', () => {
  const actual = jest.requireActual('contexts/SpecterConfigContext');
  return {
    ...actual,
    useSpecterConfig: jest.fn()
  };
});

jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: jest.fn(),
}));

const mockedUseIntegration = useIntegration as jest.Mock;
const mockedUseEntitlements = useEntitlements as jest.Mock;
const mockedUseSpecterConfig = useSpecterConfig as jest.Mock;

describe('SpecterOnboardingBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: sync complete + specter entitlement present
    mockedUseIntegration.mockReturnValue({
      syncStatus: 'COMPLETED',
      hasIntegrations: true,
      isLoading: false,
      progress: { current: 0, total: 0, percentage: 0 },
      lastError: null,
      refreshIntegrationStatus: jest.fn(),
    });

    mockedUseEntitlements.mockReturnValue({
      modules: ['core-dashboard', 'specter_sdk_free'],
      flags: [],
    });
  });

  it('does not render when shouldShowOnboardingNudges is false', () => {
    mockedUseSpecterConfig.mockReturnValue({
      config: {
        businessStage: 'survival',
        primarySalesChannel: 'Shopify DTC',
        enableOnboardingNudges: false
      },
      shouldShowOnboardingNudges: false
    });

    renderWithProviders(<SpecterOnboardingBanner />);

    expect(
      screen.queryByTestId('specter-onboarding-banner')
    ).toBeNull();
  });

  it('renders when shouldShowOnboardingNudges is true and calls saveConfig on dismiss', () => {
    const saveConfigMock = jest.fn().mockResolvedValue(undefined);

    mockedUseSpecterConfig.mockReturnValue({
      config: {
        businessStage: 'survival',
        primarySalesChannel: 'Shopify DTC',
        enableOnboardingNudges: true
      },
      shouldShowOnboardingNudges: true,
      saveConfig: saveConfigMock
    });

    renderWithProviders(<SpecterOnboardingBanner />);

    expect(
      screen.getByTestId('specter-onboarding-banner')
    ).toBeInTheDocument();

    const dismissButton = screen.getByTestId('specter-onboarding-dismiss');
    fireEvent.click(dismissButton);

    expect(saveConfigMock).toHaveBeenCalledWith({
      businessStage: 'survival',
      primarySalesChannel: 'Shopify DTC',
      enableOnboardingNudges: false
    });
  });

    it('does not render if sync is not completed', () => {
    mockedUseSpecterConfig.mockReturnValue({
      config: {
        businessStage: 'survival',
        primarySalesChannel: 'Shopify DTC',
        enableOnboardingNudges: true,
      },
      shouldShowOnboardingNudges: true,
      saveConfig: jest.fn(),
    });

    mockedUseIntegration.mockReturnValue({
      syncStatus: 'SYNCING_PRODUCTS',
      hasIntegrations: true,
      isLoading: false,
      progress: { current: 0, total: 10, percentage: 10 },
      lastError: null,
      refreshIntegrationStatus: jest.fn(),
    });

    renderWithProviders(<SpecterOnboardingBanner />);

    expect(
      screen.queryByTestId('specter-onboarding-banner')
    ).toBeNull();
  });

  it('does not render if specter_sdk_free entitlement is missing', () => {
    mockedUseSpecterConfig.mockReturnValue({
      config: {
        businessStage: 'survival',
        primarySalesChannel: 'Shopify DTC',
        enableOnboardingNudges: true,
      },
      shouldShowOnboardingNudges: true,
      saveConfig: jest.fn(),
    });

    mockedUseEntitlements.mockReturnValue({
      modules: ['core-dashboard'], // no specter_sdk_free
      flags: [],
    });

    renderWithProviders(<SpecterOnboardingBanner />);

    expect(
      screen.queryByTestId('specter-onboarding-banner')
    ).toBeNull();
  });
});
