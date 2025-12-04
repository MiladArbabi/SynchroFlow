// tests/unit/ui/contexts/SpecterConfigContext.test.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from 'react';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import {
  SpecterConfigProvider,
  useSpecterConfig,
} from 'contexts/SpecterConfigContext';
import { SpecterConfigShape } from 'api/specter';
import renderWithProviders from 'test-utils';

jest.mock('api/specter');

// Mock the AuthContext
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock the API functions
const mockFetchSpecterConfig = jest.fn();
const mockUpsertSpecterConfig = jest.fn();

jest.mock('api/specter', () => ({
  fetchSpecterConfig: (...args: any[]) => mockFetchSpecterConfig(...args),
  upsertSpecterConfig: (...args: any[]) => mockUpsertSpecterConfig(...args),
  SpecterConfigShape: {} as any,
}));

const { useAuth } = jest.requireMock('contexts/AuthContext');

// Test components
const BasicConsumer: React.FC = () => {
  const { shopId, config, isLoading, error, refresh } = useSpecterConfig();

  if (isLoading) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div>
      <div data-testid="shop-id">
        {shopId === null ? 'null' : String(shopId)}
      </div>
      <div data-testid="stage">
        {config?.businessStage ?? 'none'}
      </div>
      <div data-testid="focus-areas">
        {config?.focusAreas?.join(', ') || 'none'}
      </div>
      <div data-testid="error">{error ?? 'no-error'}</div>
      <button onClick={refresh} data-testid="refresh-button">
        Refresh
      </button>
    </div>
  );
};

const AlwaysShowRefreshConsumer: React.FC = () => {
  const { shopId, config, isLoading, error, refresh } = useSpecterConfig();

  return (
    <div>
      <div data-testid="shop-id">
        {shopId === null ? 'null' : String(shopId)}
      </div>
      <div data-testid="stage">
        {config?.businessStage ?? 'none'}
      </div>
      <div data-testid="error">{error ?? 'no-error'}</div>
      {/* Always show refresh button, even when loading */}
      <button onClick={refresh} data-testid="refresh-button">
        Refresh
      </button>
      {isLoading && <div data-testid="loading">loading</div>}
    </div>
  );
};

const SaveConfigConsumer: React.FC = () => {
  const { config, saveConfig, isLoading, error } = useSpecterConfig();
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const handleSave = async () => {
    try {
      await saveConfig({ businessStage: 'growth', focusAreas: ['marketing'] });
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed');
    }
  };

  return (
    <div>
      <div data-testid="current-stage">
        {config?.businessStage ?? 'none'}
      </div>
      <div data-testid="save-error">{saveError ?? 'no-save-error'}</div>
      <div data-testid="context-error">{error ?? 'no-context-error'}</div>
      <button
        onClick={handleSave}
        data-testid="save-button"
        disabled={isLoading}
      >
        Save Config
      </button>
      {isLoading && <div data-testid="saving">saving...</div>}
    </div>
  );
};

const ErrorBoundaryTest: React.FC = () => {
  try {
    useSpecterConfig();
    return <div data-testid="no-error">No error thrown</div>;
  } catch (err: any) {
    return <div data-testid="error-message">{err.message}</div>;
  }
};

const TestConsumer: React.FC = () => {
   const {
     shopId,
     config,
     isFirstRun,
     shouldShowOnboardingNudges,
   } = useSpecterConfig();

   return (
     <div>
       <div data-testid="shop-id">{shopId ?? ''}</div>
       <div data-testid="primary-channel">
         {config?.primarySalesChannel ?? ''}
       </div>
       <div data-testid="is-first-run">{isFirstRun ? 'yes' : 'no'}</div>
       <div data-testid="nudges">
         {shouldShowOnboardingNudges ? 'yes' : 'no'}
       </div>
     </div>
   );
 };

describe('SpecterConfigContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      accessToken: 'test-token',
    });
  });

  describe('Initialization and authentication', () => {
    it('fetches config on mount when authenticated', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: { businessStage: 'survival', focusAreas: ['cash-flow'] },
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      expect(screen.getByTestId('loading')).toBeInTheDocument();
      expect(mockFetchSpecterConfig).toHaveBeenCalledWith('test-token');

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('shop-id')).toHaveTextContent('42');
      expect(screen.getByTestId('stage')).toHaveTextContent('survival');
      expect(screen.getByTestId('focus-areas')).toHaveTextContent('cash-flow');
      expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    });

    it('does not fetch config when not logged in', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        isLoggedIn: false,
        accessToken: null,
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      expect(mockFetchSpecterConfig).not.toHaveBeenCalled();
      expect(screen.getByTestId('shop-id')).toHaveTextContent('null');
      expect(screen.getByTestId('stage')).toHaveTextContent('none');
      expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    });

    it('clears config when user logs out', async () => {
      // First render with logged in user
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: { businessStage: 'survival' },
      });

      const { rerender } = render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shop-id')).toHaveTextContent('42');
      });

      // Re-render with logged out user
      (useAuth as jest.Mock).mockReturnValue({
        isLoggedIn: false,
        accessToken: null,
      });

      rerender(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      expect(screen.getByTestId('shop-id')).toHaveTextContent('null');
      expect(screen.getByTestId('stage')).toHaveTextContent('none');
    });

    it('treats missing config as first-run with nudges enabled by default', async () => {
      mockFetchSpecterConfig.mockResolvedValue({
        shopId: 42,
        config: null,
      });

      renderWithProviders(
        <SpecterConfigProvider>
          <TestConsumer />
        </SpecterConfigProvider>
      );

      // Wait for async fetch to settle
      await waitFor(() =>
        expect(screen.getByTestId('shop-id').textContent).toBe('42')
      );

      expect(screen.getByTestId('primary-channel').textContent).toBe('');
      expect(screen.getByTestId('is-first-run').textContent).toBe('yes');
      expect(screen.getByTestId('nudges').textContent).toBe('yes');
    });


    it('handles missing access token even when isLoggedIn is true', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        isLoggedIn: true,
        accessToken: null,
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      expect(mockFetchSpecterConfig).not.toHaveBeenCalled();
      expect(screen.getByTestId('shop-id')).toHaveTextContent('null');
    });
  });

  describe('Data fetching and state management', () => {
    it('handles successful fetch with full config', async () => {
      const fullConfig: SpecterConfigShape = {
        businessStage: 'architect',
        focusAreas: ['scaling', 'automation'],
        aiAssistsEnabled: true,
        customField: 'test',
      };

      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 123,
        config: fullConfig,
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shop-id')).toHaveTextContent('123');
      });

      expect(screen.getByTestId('stage')).toHaveTextContent('architect');
      expect(screen.getByTestId('focus-areas')).toHaveTextContent('scaling, automation');
    });

    it('handles fetch with null config', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: null,
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('shop-id')).toHaveTextContent('42');
      expect(screen.getByTestId('stage')).toHaveTextContent('none');
    });

    it('handles fetch with missing shopId', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: null,
        config: { businessStage: 'growth' },
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('shop-id')).toHaveTextContent('null');
      expect(screen.getByTestId('stage')).toHaveTextContent('growth');
    });

    it('handles empty config object', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: {},
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('shop-id')).toHaveTextContent('42');
      expect(screen.getByTestId('stage')).toHaveTextContent('none');
    });

    it('refetches config when refresh is called', async () => {
      mockFetchSpecterConfig
        .mockResolvedValueOnce({
          shopId: 42,
          config: { businessStage: 'survival' },
        })
        .mockResolvedValueOnce({
          shopId: 42,
          config: { businessStage: 'growth' },
        });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('survival');
      });

      // Click refresh button
      fireEvent.click(screen.getByTestId('refresh-button'));

      // Should show loading state
      expect(screen.getByTestId('loading')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
        expect(screen.getByTestId('stage')).toHaveTextContent('growth');
      });

      expect(mockFetchSpecterConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('handles fetch error and sets error state', async () => {
      mockFetchSpecterConfig.mockRejectedValueOnce(
        new Error('Network error: Failed to fetch')
      );

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('shop-id')).toHaveTextContent('null');
      expect(screen.getByTestId('stage')).toHaveTextContent('none');
      expect(screen.getByTestId('error')).toHaveTextContent('Network error: Failed to fetch');
    });

    it('handles fetch error with custom message', async () => {
      mockFetchSpecterConfig.mockRejectedValueOnce({
        message: 'Unauthorized access',
      });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('error')).toHaveTextContent('Unauthorized access');
    });

    it('clears error on successful refetch after failure', async () => {
      mockFetchSpecterConfig
        .mockRejectedValueOnce(new Error('First fetch failed'))
        .mockResolvedValueOnce({
          shopId: 42,
          config: { businessStage: 'survival' },
        });

      render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('First fetch failed');
      });

      // Click refresh to trigger successful fetch
      fireEvent.click(screen.getByTestId('refresh-button'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('no-error');
        expect(screen.getByTestId('stage')).toHaveTextContent('survival');
      });
    });
  });

  describe('saveConfig functionality', () => {
    it('successfully saves config and updates state', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: { businessStage: 'survival' },
      });

      const newConfig: SpecterConfigShape = { businessStage: 'growth', focusAreas: ['marketing'] };
      mockUpsertSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: newConfig,
      });

      render(
        <SpecterConfigProvider>
          <SaveConfigConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-stage')).toHaveTextContent('survival');
      });

      // Click save button
      fireEvent.click(screen.getByTestId('save-button'));

      // Should show saving indicator
      expect(screen.getByTestId('saving')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByTestId('saving')).not.toBeInTheDocument();
        expect(screen.getByTestId('current-stage')).toHaveTextContent('growth');
      });

      expect(mockUpsertSpecterConfig).toHaveBeenCalledWith('test-token', newConfig);
      expect(screen.getByTestId('save-error')).toHaveTextContent('no-save-error');
    });

    it('handles save error and sets error state', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: { businessStage: 'survival' },
      });

      mockUpsertSpecterConfig.mockRejectedValueOnce(
        new Error('Validation failed: Invalid business stage')
      );

      render(
        <SpecterConfigProvider>
          <SaveConfigConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-stage')).toHaveTextContent('survival');
      });

      // Click save button
      fireEvent.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('saving')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('context-error')).toHaveTextContent(
        'Validation failed: Invalid business stage'
      );
    });

    it('uses provided config when API returns null config', async () => {
      // Mock the initial fetch
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: { businessStage: 'survival' },
      });

      const newConfig: SpecterConfigShape = { businessStage: 'growth' };
      
      // Mock upsert to return null config
      mockUpsertSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: null, // API returns null
      });

      // Create a test component that shows the current config
      const TestSaveComponent: React.FC = () => {
        const { config, saveConfig, isLoading } = useSpecterConfig();
        const [savedConfig, setSavedConfig] = React.useState<SpecterConfigShape | null>(null);

        React.useEffect(() => {
          if (config?.businessStage === 'survival' && !isLoading) {
            // Save config when initial load is complete
            saveConfig(newConfig).then(() => {
              setSavedConfig(config);
            });
          }
        }, [config, isLoading, saveConfig]);

        return (
          <div>
            <div data-testid="current-stage">{config?.businessStage || 'none'}</div>
            <div data-testid="saved-stage">{savedConfig?.businessStage || 'none'}</div>
          </div>
        );
      };

      render(
        <SpecterConfigProvider>
          <TestSaveComponent />
        </SpecterConfigProvider>
      );

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockFetchSpecterConfig).toHaveBeenCalledWith('test-token');
      });

      // Wait for save to be called
      await waitFor(() => {
        expect(mockUpsertSpecterConfig).toHaveBeenCalledWith('test-token', newConfig);
      });

      // The context should fall back to using newConfig when API returns null
      // The implementation shows it uses: result.config || nextConfig
      await waitFor(() => {
        expect(screen.getByTestId('current-stage')).toHaveTextContent('growth');
      });
    });

    it('does not save when accessToken is missing', async () => {
      // Set auth with no access token
      (useAuth as jest.Mock).mockReturnValue({
        isLoggedIn: true,
        accessToken: null, // No token
      });

      render(
        <SpecterConfigProvider>
          <SaveConfigConsumer />
        </SpecterConfigProvider>
      );

      // With no access token, config should be null
      expect(screen.getByTestId('current-stage')).toHaveTextContent('none');

      // Click save button - should do nothing (silently fail)
      fireEvent.click(screen.getByTestId('save-button'));

      // Wait a bit to ensure no async operations happen
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should not call upsert API
      expect(mockUpsertSpecterConfig).not.toHaveBeenCalled();
    });

    it('re-throws error from saveConfig for caller handling', async () => {
      mockFetchSpecterConfig.mockResolvedValueOnce({
        shopId: 42,
        config: { businessStage: 'survival' },
      });

      const saveError = new Error('Database connection failed');
      mockUpsertSpecterConfig.mockRejectedValueOnce(saveError);

      render(
        <SpecterConfigProvider>
          <SaveConfigConsumer />
        </SpecterConfigProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-stage')).toHaveTextContent('survival');
      });

      // Click save button
      fireEvent.click(screen.getByTestId('save-button'));

      await waitFor(() => {
        expect(screen.getByTestId('save-error')).toHaveTextContent('Database connection failed');
      });
    });
  });

  describe('Cleanup and cancellation', () => {
    it('cancels pending fetch on unmount', async () => {
      // Create a promise that we can manually resolve
      let resolveFetch: (value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      mockFetchSpecterConfig.mockImplementationOnce(() => fetchPromise);

      const { unmount } = render(
        <SpecterConfigProvider>
          <BasicConsumer />
        </SpecterConfigProvider>
      );

      // Unmount before fetch completes
      unmount();

      // Resolve the promise after unmount
      resolveFetch!({
        shopId: 42,
        config: { businessStage: 'survival' },
      });

      // Wait a bit to ensure no state updates happen
      await act(() => new Promise(resolve => setTimeout(resolve, 100)));

      // No assertions needed - just ensuring no errors occur
    });

    it('cancels previous fetch when new fetch starts', async () => {
      // Create a mock that tracks calls
      let firstFetchResolve: (value: any) => void;
      let secondFetchResolve: (value: any) => void;
      
      const firstFetchPromise = new Promise(resolve => {
        firstFetchResolve = resolve;
      });
      
      const secondFetchPromise = new Promise(resolve => {
        secondFetchResolve = resolve;
      });

      mockFetchSpecterConfig
        .mockImplementationOnce(() => firstFetchPromise)
        .mockImplementationOnce(() => secondFetchPromise);

      render(
        <SpecterConfigProvider>
          <AlwaysShowRefreshConsumer />
        </SpecterConfigProvider>
      );

      // Should show loading initially
      expect(screen.getByTestId('loading')).toBeInTheDocument();

      // Trigger a refresh before first fetch completes
      fireEvent.click(screen.getByTestId('refresh-button'));

      // Now resolve the second fetch first (it's faster)
      act(() => {
        secondFetchResolve!({
          shopId: 2,
          config: { businessStage: 'second' },
        });
      });

      // Should show the second result
      await waitFor(() => {
        expect(screen.getByTestId('stage')).toHaveTextContent('second');
      });

      // Now resolve the first fetch - should be ignored
      act(() => {
        firstFetchResolve!({
          shopId: 1,
          config: { businessStage: 'first' },
        });
      });

      // Wait a bit and ensure state hasn't changed back to first
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Should still show second result
      expect(screen.getByTestId('stage')).toHaveTextContent('second');
    });
  });

  describe('Hook usage validation', () => {
    it('throws error when used outside provider', () => {
      // Suppress console error for this test
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      render(<ErrorBoundaryTest />);

      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'useSpecterConfig must be used within a SpecterConfigProvider'
      );

      consoleError.mockRestore();
    });
  });
});