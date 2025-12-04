// tests/integration/specter/SpecterConfigIntegration.test.tsx
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { SpecterConfigPanel } from 'components/specter/SpecterConfigPanel';
import { renderWithProviders } from 'test-utils';

// Instead of testing with real providers, let's create a simplified test
// that mocks the context directly but tests the integration between
// the panel and the context

// Mock the entire context
jest.mock('contexts/SpecterConfigContext', () => {
  let config = null;
  let isLoading = false;
  let isSaving = false;
  let error = null;
  let listeners: Array<() => void> = [];
  
  const mockContext = {
    config,
    isLoading,
    isSaving,
    error,
    saveConfig: jest.fn(),
  };
  
  return {
    useSpecterConfig: jest.fn(() => mockContext),
    SpecterConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const mockedUseSpecterConfig = jest.requireMock('contexts/SpecterConfigContext').useSpecterConfig;

describe('SpecterConfigPanel Integration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Reset the mock context state
    const mockContext = {
      config: null,
      isLoading: false,
      isSaving: false,
      error: null,
      saveConfig: jest.fn(),
    };
    mockedUseSpecterConfig.mockReturnValue(mockContext);
  });

  it('loads and displays config from provider', async () => {
    // Set up mock context with config
    const mockConfig = {
      businessStage: 'growth',
      primarySalesChannel: 'Shopify DTC',
      enableOnboardingNudges: false
    };
    
    mockedUseSpecterConfig.mockReturnValue({
      config: mockConfig,
      isLoading: false,
      isSaving: false,
      error: null,
      saveConfig: jest.fn(),
    });
    
    renderWithProviders(<SpecterConfigPanel />);

    // Should display the config values
    expect(screen.getByTestId('specter-primary-channel-input')).toHaveValue('Shopify DTC');
    expect(screen.getByRole('switch', { name: /onboarding nudges/i })).not.toBeChecked();
  });

  it('saves config through provider', async () => {
    const mockConfig = {
      businessStage: 'growth',
      primarySalesChannel: 'Shopify DTC',
      enableOnboardingNudges: false
    };
    
    const saveConfigMock = jest.fn().mockResolvedValue(undefined);
    
    mockedUseSpecterConfig.mockReturnValue({
      config: mockConfig,
      isLoading: false,
      isSaving: false,
      error: null,
      saveConfig: saveConfigMock,
    });
    
    renderWithProviders(<SpecterConfigPanel />);

    // Update the form
    const channelInput = screen.getByTestId('specter-primary-channel-input');
    fireEvent.change(channelInput, { target: { value: 'Amazon' } });
    
    const toggle = screen.getByRole('switch', { name: /onboarding nudges/i });
    fireEvent.click(toggle);

    const saveButton = screen.getByTestId('specter-config-save-button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          businessStage: 'growth',
          primarySalesChannel: 'Amazon',
          enableOnboardingNudges: true
        })
      );
    });
  });

  it('shows loading state when context is loading', () => {
    mockedUseSpecterConfig.mockReturnValue({
      config: null,
      isLoading: true,
      isSaving: false,
      error: null,
      saveConfig: jest.fn(),
    });
    
    renderWithProviders(<SpecterConfigPanel />);

    // Should show loading state
    expect(screen.getByTestId('specter-config-save-button')).toBeDisabled();
    expect(screen.getByTestId('specter-primary-channel-input')).toBeDisabled();
  });

  it('shows error from context', () => {
    const errorMessage = 'Failed to load configuration';
    
    mockedUseSpecterConfig.mockReturnValue({
      config: null,
      isLoading: false,
      isSaving: false,
      error: errorMessage,
      saveConfig: jest.fn(),
    });
    
    renderWithProviders(<SpecterConfigPanel />);

    // Should display the error
    expect(screen.getByTestId('specter-config-error')).toHaveTextContent(errorMessage);
  });
});