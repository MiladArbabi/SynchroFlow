// tests/unit/ui/IntegrationContext.contract.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { IntegrationProvider, useIntegration } from 'contexts/IntegrationContext';
import { useAuth } from 'contexts/AuthContext';

jest.mock('axios');
jest.mock('contexts/AuthContext');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

/**
 * Test consumer that exposes the *contract* of IntegrationContext.
 * Anything rendered here is considered public, stable API.
 */
const ContractConsumer = () => {
  const ctx = useIntegration();

  return (
    <div>
      <div data-testid="hasIntegrationRecord">
        {String((ctx as any).hasIntegrationRecord)}
      </div>
      <div data-testid="syncStatus">{ctx.syncStatus}</div>
      <div data-testid="isSyncComplete">
        {String((ctx as any).isSyncComplete)}
      </div>
      <div data-testid="progress">
        {JSON.stringify(ctx.progress)}
      </div>
      <div data-testid="lastError">
        {String(ctx.lastError)}
      </div>
    </div>
  );
};

const renderWithProvider = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IntegrationProvider>
        <ContractConsumer />
      </IntegrationProvider>
    </QueryClientProvider>
  );
};

describe('IntegrationContext — CONTRACT', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedUseAuth.mockReturnValue({
      isLoggedIn: true,
      accessToken: 'test-token',
      user: { id: 1 },
      login: jest.fn(),
      logout: jest.fn(),
      setAccessToken: jest.fn(),
      isLoading: false,
    } as any);
  });

  it('NOT_FOUND → no integration record, not complete', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        status: 'NOT_FOUND',
        progress: { current: 0, total: 0, percentage: 0 },
        lastError: null,
      },
    });

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId('syncStatus')).toHaveTextContent('NOT_FOUND')
    );

    expect(screen.getByTestId('hasIntegrationRecord')).toHaveTextContent('false');
    expect(screen.getByTestId('isSyncComplete')).toHaveTextContent('false');
  });

  it('SYNCING → integration exists, but data not trustworthy', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        status: 'SYNCING_ORDERS',
        progress: { current: 3, total: 10, percentage: 30 },
        lastError: null,
      },
    });

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId('syncStatus')).toHaveTextContent('SYNCING_ORDERS')
    );

    expect(screen.getByTestId('hasIntegrationRecord')).toHaveTextContent('true');
    expect(screen.getByTestId('isSyncComplete')).toHaveTextContent('false');
  });

  it('COMPLETED → integration exists and data is trustworthy', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        status: 'COMPLETED',
        progress: { current: 10, total: 10, percentage: 100 },
        lastError: null,
      },
    });

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId('syncStatus')).toHaveTextContent('COMPLETED')
    );

    expect(screen.getByTestId('hasIntegrationRecord')).toHaveTextContent('true');
    expect(screen.getByTestId('isSyncComplete')).toHaveTextContent('true');
  });

  it('401 / auth error → treated as no integration record', async () => {
    mockedAxios.get.mockRejectedValue({
      response: { status: 401 },
    } as AxiosError);

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId('hasIntegrationRecord')).toHaveTextContent('false')
    );

    expect(screen.getByTestId('isSyncComplete')).toHaveTextContent('false');
  });
});