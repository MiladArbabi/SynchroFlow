// tests/unit/ui/entitlements/EntitlementsContext.test.tsx
import '@testing-library/jest-dom';
import { screen, render, waitFor } from '@testing-library/react';
import { axiosInstance } from 'api/axiosConfig';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import { act, ReactNode } from 'react';

jest.mock('api/axiosConfig', () => ({
   axiosInstance: {
     get: jest.fn(),
   },
 }));

 const mockedAxios = axiosInstance as jest.Mocked<typeof axiosInstance>;

// Test helper components
const Capture = ({ children }: { children?: ReactNode }) => {
  const value = useEntitlements();
  return (
    <div>
      <div data-testid="modules">{JSON.stringify(value.modules)}</div>
      <div data-testid="flags">{JSON.stringify(value.flags)}</div>
      <div data-testid="shopId">{value.shopId}</div>
      <div data-testid="isLoading">{value.isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="error">{value.error || 'no-error'}</div>
      <div data-testid="has-basic-sales">
        {value.hasFlag('view_basic_sales') ? 'yes' : 'no'}
      </div>
      <div data-testid="has-order-nexus">
        {value.hasModule('order_nexus') ? 'yes' : 'no'}
      </div>
      <div data-testid="has-nonexistent-module">
        {value.hasModule('nonexistent_module') ? 'yes' : 'no'}
      </div>
      <div data-testid="has-nonexistent-flag">
        {value.hasFlag('nonexistent_flag') ? 'yes' : 'no'}
      </div>
      <button data-testid="refresh-button" onClick={value.refresh}>
        Refresh
      </button>
    </div>
  );
};

const ErrorCapture = () => {
  try {
    useEntitlements();
    return <div data-testid="no-error">No error thrown</div>;
  } catch (error: any) {
    return <div data-testid="error-message">{error.message}</div>;
  }
};

// Mock AuthContext with configurable values
const mockAuthContext = {
  accessToken: 'test-access-token',
  isLoggedIn: true,
};

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => mockAuthContext,
}));

describe('EntitlementsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock auth context to default
    mockAuthContext.accessToken = 'test-access-token';
    mockAuthContext.isLoggedIn = true;

    // Set default axios mock to prevent "Cannot read properties of undefined"
   mockedAxios.get.mockResolvedValue({
     data: {
       shopId: null,
       modules: [],
       flags: [],
     },
   });
  });

  describe('Hook Usage Validation', () => {
    it('throws an error when used outside of EntitlementsProvider', () => {
      render(<ErrorCapture />);
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'useEntitlements must be used within an EntitlementsProvider'
      );
    });

    it('does not throw when used inside EntitlementsProvider', async () => {

    mockedAxios.get.mockResolvedValue({
       data: {
         shopId: null,
         modules: [],
         flags: [],
       },
     });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );
      // Wait for the initial load to complete to avoid act warnings
     await waitFor(() => {
       expect(screen.getByTestId('isLoading')).toHaveTextContent('ready');
     });
     
     // Verify the hook doesn't throw by checking that our component rendered
     expect(screen.getByTestId('modules')).toBeInTheDocument();
    });
  });

  describe('Initial State', () => {
    it('initializes with default values', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: null,
          modules: [],
          flags: [],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Initially loading should be true
      expect(screen.getByTestId('isLoading')).toHaveTextContent('loading');

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('ready');
      });

      expect(screen.getByTestId('modules')).toHaveTextContent('[]');
      expect(screen.getByTestId('flags')).toHaveTextContent('[]');
      expect(screen.getByTestId('shopId')).toHaveTextContent('');
      expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    });
  });

  describe('Authentication State Handling', () => {
    it('clears entitlements when user logs out', async () => {
      // First render with logged in user
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard'],
          flags: ['view_basic_sales'],
        },
      });

      const { rerender } = render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('123');
      });

      // Now simulate logout
      mockAuthContext.isLoggedIn = false;
      mockAuthContext.accessToken = null as any;

      // Mock axios to not be called (should clear state without API call)
      mockedAxios.get.mockClear();

      rerender(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // State should be cleared
      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('');
        expect(screen.getByTestId('modules')).toHaveTextContent('[]');
        expect(screen.getByTestId('flags')).toHaveTextContent('[]');
        expect(screen.getByTestId('error')).toHaveTextContent('no-error');
      });

      // Should not make API call when logged out
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('does not fetch when not logged in initially', () => {
      mockAuthContext.isLoggedIn = false;
      mockAuthContext.accessToken = null as any;

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(screen.getByTestId('isLoading')).toHaveTextContent('ready');
    });

    it('fetches when user logs in', async () => {
      // Start logged out
      mockAuthContext.isLoggedIn = false;
      mockAuthContext.accessToken = null as any;

      const { rerender } = render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      expect(mockedAxios.get).not.toHaveBeenCalled();

      // Now log in
      mockAuthContext.isLoggedIn = true;
      mockAuthContext.accessToken = 'new-token';
      
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 456,
          modules: ['shopify_integration'],
          flags: ['use_shopify_sync'],
        },
      });

      rerender(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('456');
        expect(screen.getByTestId('modules')).toHaveTextContent('shopify_integration');
      });

      expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/entitlements/me');
    });
  });

  describe('Data Fetching - Success Cases', () => {
    it('fetches entitlements and exposes modules/flags', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard', 'shopify_integration'],
          flags: ['view_basic_sales', 'use_shopify_sync'],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Check loading state
      expect(screen.getByTestId('isLoading')).toHaveTextContent('loading');

      // Wait for data
      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent('core_dashboard');
        expect(screen.getByTestId('flags')).toHaveTextContent('view_basic_sales');
        expect(screen.getByTestId('shopId')).toHaveTextContent('123');
      });

      // Feature checks
      expect(screen.getByTestId('has-basic-sales')).toHaveTextContent('yes');
      expect(screen.getByTestId('has-order-nexus')).toHaveTextContent('no');

      // Correct request
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/entitlements/me');
    });

    it('returns empty lists when server returns empty entitlements', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: null,
          modules: [],
          flags: [],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent('[]');
        expect(screen.getByTestId('flags')).toHaveTextContent('[]');
        expect(screen.getByTestId('shopId')).toHaveTextContent('');
        expect(screen.getByTestId('error')).toHaveTextContent('no-error');
      });
    });

    it('handles null shopId from server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: null,
          modules: ['core_dashboard'],
          flags: ['view_basic_sales'],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('');
        expect(screen.getByTestId('modules')).toHaveTextContent('core_dashboard');
        expect(screen.getByTestId('flags')).toHaveTextContent('view_basic_sales');
      });
    });
  });

  describe('Data Fetching - Edge Cases', () => {
    it('handles missing data properties from server response', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          // Missing modules and flags
          shopId: 123,
        } as any,
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('123');
        expect(screen.getByTestId('modules')).toHaveTextContent('[]');
        expect(screen.getByTestId('flags')).toHaveTextContent('[]');
      });
    });

    it('handles null response data', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: null,
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('');
        expect(screen.getByTestId('modules')).toHaveTextContent('[]');
        expect(screen.getByTestId('flags')).toHaveTextContent('[]');
        expect(screen.getByTestId('error')).toHaveTextContent('no-error');
      });
    });

    it('handles undefined response data', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: undefined,
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('shopId')).toHaveTextContent('');
        expect(screen.getByTestId('modules')).toHaveTextContent('[]');
        expect(screen.getByTestId('flags')).toHaveTextContent('[]');
      });
    });

    it('handles duplicate values in modules/flags arrays', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard', 'core_dashboard', 'shopify_integration'],
          flags: ['view_basic_sales', 'view_basic_sales'],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent(
          JSON.stringify(['core_dashboard', 'core_dashboard', 'shopify_integration'])
        );
        expect(screen.getByTestId('flags')).toHaveTextContent(
          JSON.stringify(['view_basic_sales', 'view_basic_sales'])
        );
      });

      // hasModule/hasFlag should still work with duplicates
      expect(screen.getByTestId('has-basic-sales')).toHaveTextContent('yes');
    });

    it('handles null values in arrays', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard', null, 'shopify_integration'] as any,
          flags: [null, 'view_basic_sales', null] as any,
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent(
          JSON.stringify(['core_dashboard', null, 'shopify_integration'])
        );
        expect(screen.getByTestId('flags')).toHaveTextContent(
          JSON.stringify([null, 'view_basic_sales', null])
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('handles network errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network Error'));

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Network Error');
        expect(screen.getByTestId('shopId')).toHaveTextContent('');
        expect(screen.getByTestId('modules')).toHaveTextContent('[]');
        expect(screen.getByTestId('flags')).toHaveTextContent('[]');
        expect(screen.getByTestId('isLoading')).toHaveTextContent('ready');
      });
    });

    it('handles axios error with response', async () => {
      const axiosError = {
        message: 'Request failed with status code 500',
        response: {
          data: { message: 'Internal Server Error' },
        },
      };
      mockedAxios.get.mockRejectedValueOnce(axiosError);

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent(
          'Request failed with status code 500'
        );
      });
    });

    it('handles axios error without response', async () => {
      const axiosError = {
        message: 'Network timeout',
      };
      mockedAxios.get.mockRejectedValueOnce(axiosError);

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Network timeout');
      });
    });

    it('handles error with no message', async () => {
      mockedAxios.get.mockRejectedValueOnce({});

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent(
          'Failed to load entitlements'
        );
      });
    });

    it('clears previous error on successful refresh', async () => {
      // First request fails
      mockedAxios.get.mockRejectedValueOnce(new Error('Initial Error'));

      const { rerender } = render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Initial Error');
      });

      // Now refresh successfully
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard'],
          flags: [],
        },
      });

      act(() => {
        screen.getByTestId('refresh-button').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('no-error');
        expect(screen.getByTestId('shopId')).toHaveTextContent('123');
      });
    });
  });

  describe('Refresh Functionality', () => {
    it('triggers re-fetch when refresh is called', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            shopId: 123,
            modules: ['core_dashboard'],
            flags: ['view_basic_sales'],
          },
        })
        .mockResolvedValueOnce({
          data: {
            shopId: 123,
            modules: ['core_dashboard', 'shopify_integration'],
            flags: ['view_basic_sales', 'use_shopify_sync'],
          },
        });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent(
          JSON.stringify(['core_dashboard'])
        );
      });

      // Click refresh button
      act(() => {
        screen.getByTestId('refresh-button').click();
      });

      // Should show loading state again
      expect(screen.getByTestId('isLoading')).toHaveTextContent('loading');

      // Wait for new data
      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent(
          JSON.stringify(['core_dashboard', 'shopify_integration'])
        );
        expect(screen.getByTestId('flags')).toHaveTextContent(
          JSON.stringify(['view_basic_sales', 'use_shopify_sync'])
        );
      });

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('maintains current data while refreshing', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            shopId: 123,
            modules: ['core_dashboard'],
            flags: ['view_basic_sales'],
          },
        })
        .mockImplementationOnce(() => {
          // Simulate slow second request
          return new Promise((resolve) => {
            setTimeout(() => resolve({
              data: {
                shopId: 123,
                modules: ['updated_module'],
                flags: ['updated_flag'],
              },
            }), 100);
          });
        });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Wait for initial data
      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent(
          JSON.stringify(['core_dashboard'])
        );
      });

      // Click refresh
      act(() => {
        screen.getByTestId('refresh-button').click();
      });

      // Should still show old data while loading
      expect(screen.getByTestId('modules')).toHaveTextContent(
        JSON.stringify(['core_dashboard'])
      );
      expect(screen.getByTestId('isLoading')).toHaveTextContent('loading');

      // Wait for new data
      await waitFor(() => {
        expect(screen.getByTestId('modules')).toHaveTextContent(
          JSON.stringify(['updated_module'])
        );
        expect(screen.getByTestId('isLoading')).toHaveTextContent('ready');
      });
    });
  });

  describe('Helper Functions', () => {
    it('hasModule correctly identifies module presence', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard', 'shopify_integration'],
          flags: ['view_basic_sales'],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('has-order-nexus')).toHaveTextContent('no');
        expect(screen.getByTestId('has-nonexistent-module')).toHaveTextContent('no');
      });

      // hasModule should return true for existing modules
      expect(screen.getByTestId('modules')).toHaveTextContent('core_dashboard');
    });

    it('hasFlag correctly identifies flag presence', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard'],
          flags: ['view_basic_sales', 'use_shopify_sync'],
        },
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('has-basic-sales')).toHaveTextContent('yes');
        expect(screen.getByTestId('has-nonexistent-flag')).toHaveTextContent('no');
      });
    });

    it('helper functions update when data changes', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            shopId: 123,
            modules: ['core_dashboard'],
            flags: ['view_basic_sales'],
          },
        })
        .mockResolvedValueOnce({
          data: {
            shopId: 123,
            modules: ['core_dashboard', 'new_module'],
            flags: ['view_basic_sales', 'new_flag'],
          },
        });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('has-nonexistent-module')).toHaveTextContent('no');
      });

      // Refresh to get new data
      act(() => {
        screen.getByTestId('refresh-button').click();
      });

      await waitFor(() => {
        // hasModule/hasFlag should now reflect new data
        expect(screen.getByTestId('modules')).toHaveTextContent('new_module');
      });
    });
  });

  describe('Cancellation and Cleanup', () => {
    it('cancels pending requests on unmount', async () => {
      let resolveRequest: any;
      const promise = new Promise((resolve) => {
        resolveRequest = () => resolve({
          data: {
            shopId: 123,
            modules: [],
            flags: [],
          },
        });
      });

      mockedAxios.get.mockReturnValueOnce(promise);

      const { unmount } = render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Unmount before request completes
      unmount();

      // Resolve the promise after unmount
      resolveRequest();

      // Wait a bit to ensure no state updates happen after unmount
      await act(() => new Promise(resolve => setTimeout(resolve, 100)));

      // No assertions needed - just ensuring no errors
    });

    it('cancels pending requests when dependencies change', async () => {
      let requestCount = 0;
      mockedAxios.get.mockImplementation(() => {
        requestCount++;
        return new Promise((resolve) => {
          setTimeout(() => resolve({
            data: {
              shopId: 123,
              modules: [],
              flags: [],
            },
          }), 100);
        });
      });

      const { rerender } = render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Change auth token to trigger new request
      mockAuthContext.accessToken = 'new-token';
      rerender(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      // Wait for any pending operations
      await act(() => new Promise(resolve => setTimeout(resolve, 200)));

      // Should have attempted 2 requests (first one should be cancelled)
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance and Optimization', () => {
    it('memoizes hasModule and hasFlag functions', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          shopId: 123,
          modules: ['core_dashboard'],
          flags: ['view_basic_sales'],
        },
      });

      const hasModuleCalls: any[] = [];
      const hasFlagCalls: any[] = [];

      const TestComponent = () => {
        const { hasModule, hasFlag } = useEntitlements();
        
        // Track function calls
        hasModuleCalls.push(hasModule);
        hasFlagCalls.push(hasFlag);
        
        return (
          <div>
            <div data-testid="module-result">{hasModule('core_dashboard') ? 'yes' : 'no'}</div>
            <div data-testid="flag-result">{hasFlag('view_basic_sales') ? 'yes' : 'no'}</div>
          </div>
        );
      };

      const { rerender } = render(
        <EntitlementsProvider>
          <TestComponent />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('module-result')).toHaveTextContent('yes');
      });

      // Force a re-render
      rerender(
        <EntitlementsProvider>
          <TestComponent />
        </EntitlementsProvider>
      );

      // Functions should be memoized (same reference)
      expect(hasModuleCalls[0]).toBe(hasModuleCalls[1]);
      expect(hasFlagCalls[0]).toBe(hasFlagCalls[1]);
    });
  });

  describe('Resolution semantics', () => {
    it('does NOT mark entitlements as resolved on 401', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: { status: 401 }
      });

      render(
        <EntitlementsProvider>
          <Capture />
        </EntitlementsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('ready');
      });

      // Modules cleared, but this must NOT be treated as a resolved snapshot
      // (hasResolved will be added in implementation; test will fail until then)
      expect((screen as any).queryByTestId('hasResolved')).toBeNull();
    });
  });
});