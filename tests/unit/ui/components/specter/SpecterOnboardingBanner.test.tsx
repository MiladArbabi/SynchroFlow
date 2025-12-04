// tests/unit/ui/components/specter/SpecterOnboardingBanner.test.tsx
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import { SpecterOnboardingBanner } from 'components/specter/SpecterOnboardingBanner';
import { SpecterConfigProvider, useSpecterConfig } from 'contexts/SpecterConfigContext';

jest.mock('contexts/SpecterConfigContext', () => {
  const actual = jest.requireActual('contexts/SpecterConfigContext');
  return {
    ...actual,
    useSpecterConfig: jest.fn()
  };
});

const mockedUseSpecterConfig = useSpecterConfig as jest.Mock;

describe('SpecterOnboardingBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
