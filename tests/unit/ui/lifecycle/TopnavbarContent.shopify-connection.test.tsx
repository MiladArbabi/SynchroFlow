import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  getShopifyConnectionBadgePresentation,
  ShopifyConnectionBadge,
  type ShopifyConnectionState,
} from 'components/ShopifyConnectionBadge/ShopifyConnectionBadge';

const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

function status(connectionState: ShopifyConnectionState) {
  return {
    connectionState,
    recoveryRequestOutstanding: false,
    status: 'COMPLETED',
  };
}

function renderBadge(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/overview']}>
          <ShopifyConnectionBadge />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('Shopify connection badge', () => {
  it.each([
    ['CONNECTED', 'connected', 'Connected'],
    ['REFRESHING', 'reconnecting', 'Refreshing'],
    ['RECONNECT_IN_PROGRESS', 'reconnecting', 'Reconnecting'],
    ['NOT_INSTALLED', 'disconnected', 'Not installed'],
    ['UNINSTALLED', 'disconnected', 'Uninstalled'],
    ['REAUTH_REQUIRED', 'disconnected', 'Authorization required'],
    ['UNINSTALL_VERIFICATION_UNRESOLVED', 'disconnected', 'Status unresolved'],
  ] as Array<[ShopifyConnectionState, string, string]>)('maps %s to %s / %s', (state, tone, label) => {
    expect(getShopifyConnectionBadgePresentation(status(state))).toEqual({ tone, label });
  });

  it.each([
    undefined,
    null,
    {},
    { connectionState: 'UNKNOWN', recoveryRequestOutstanding: false, status: 'COMPLETED' },
  ])('fails closed for unavailable or unexpected authority: %p', (value) => {
    expect(getShopifyConnectionBadgePresentation(value)).toEqual({
      tone: 'disconnected',
      label: 'Status unavailable',
    });
  });

  it('uses the authoritative endpoint and navigates only to Connections', async () => {
    mockGet.mockResolvedValue({ data: status('CONNECTED') });
    renderBadge();

    const badge = await screen.findByRole('button', {
      name: 'Shopify connection: Connected. Open connection settings',
    });
    expect(badge).toHaveTextContent(/^Shopify$/);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/integrations/sync-status');

    fireEvent.click(badge);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][0]).toBe('/settings/connections');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['REFRESHING', 'Refreshing'],
    ['RECONNECT_IN_PROGRESS', 'Reconnecting'],
    ['NOT_INSTALLED', 'Not installed'],
    ['UNINSTALLED', 'Uninstalled'],
    ['REAUTH_REQUIRED', 'Authorization required'],
    ['UNINSTALL_VERIFICATION_UNRESOLVED', 'Status unresolved'],
  ] as Array<[ShopifyConnectionState, string]>)('keeps the explicit %s label visible', async (state, label) => {
    mockGet.mockResolvedValue({ data: status(state) });
    renderBadge();

    const badge = await screen.findByRole('button', {
      name: `Shopify connection: ${label}. Open connection settings`,
    });
    expect(badge).toHaveTextContent(`Shopify · ${label}`);
  });

  it('fails closed while loading and after a request failure', async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    mockGet.mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    renderBadge();

    expect(screen.getByRole('button', {
      name: 'Shopify connection: Status unavailable. Open connection settings',
    })).toHaveTextContent('Shopify · Status unavailable');

    await act(async () => rejectRequest?.(new Error('offline')));
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Shopify connection: Status unavailable. Open connection settings',
    })).toHaveTextContent('Shopify · Status unavailable'));
  });

  it('updates from the shared authoritative cache after refresh', async () => {
    mockGet.mockResolvedValue({ data: status('REFRESHING') });
    const { client } = renderBadge();
    expect(await screen.findByRole('button', {
      name: 'Shopify connection: Refreshing. Open connection settings',
    })).toHaveAttribute('data-state', 'reconnecting');

    await act(async () => {
      client.setQueryData(['shopify-connection-status'], status('CONNECTED'));
    });

    expect(await screen.findByRole('button', {
      name: 'Shopify connection: Connected. Open connection settings',
    })).toHaveAttribute('data-state', 'connected');
  });
});
