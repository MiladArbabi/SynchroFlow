import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopifyConnectionsSettings, {
  safeShopifyAuthorizationUrl,
  type ShopifyConnectionState,
} from 'pages/ft2-pages/ShopifyConnectionsSettings';
import { SETTINGS_TABS } from 'pages/ft2-pages/settingsTabs';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockGetPermissions = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...args: unknown[]) => args[0] === '/api/v1/integrations/capabilities'
      ? mockGetPermissions() : mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

function status(connectionState: ShopifyConnectionState, overrides: Record<string, unknown> = {}) {
  return {
    integrationId: 41,
    status: 'COMPLETED',
    connectionState,
    shopDomain: connectionState === 'NOT_INSTALLED' ? null : 'verified-shop.myshopify.com',
    recoveryRequestOutstanding: false,
    lastSyncedAt: '2026-10-18T10:00:00.000Z',
    lastError: null,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ShopifyConnectionsSettings /></QueryClientProvider>);
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGetPermissions.mockReset();
  mockGetPermissions.mockResolvedValue({ data: { canManageConnection: true } });
});

describe('Settings → Connections', () => {
  it.each([
    ['NOT_INSTALLED', 'Not installed'],
    ['UNINSTALLED', 'Uninstalled'],
    ['CONNECTED', 'Connected'],
    ['REFRESHING', 'Refreshing'],
    ['REAUTH_REQUIRED', 'Authorization required'],
    ['RECONNECT_IN_PROGRESS', 'Reconnecting'],
  ] as Array<[ShopifyConnectionState, string]>)('renders canonical %s separately from synchronization', async (state, label) => {
    mockGet.mockResolvedValue({ data: status(state) });
    renderPage();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows verified identity, failed sync recovery, and treats 202 only as a request', async () => {
    mockGet.mockImplementation((url: string) => Promise.resolve({ data: status('CONNECTED', {
      status: 'FAILED', lastError: 'synthetic', lastSyncedAt: null,
      recoveryRequestOutstanding: mockPost.mock.calls.length > 0,
    }) }));
    mockPost.mockResolvedValue({ status: 202, data: { status: 'SYNC_RECOVERY_REQUESTED' } });
    renderPage();
    expect(await screen.findByText('verified-shop.myshopify.com')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry synchronization' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/v1/integrations/sync/41'));
    expect(await screen.findByText('Sync recovery requested. Waiting to start.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry synchronization' })).not.toBeInTheDocument();
    expect(screen.queryByText(/synchronization completed/i)).not.toBeInTheDocument();
  });

  it('re-enables retry when an accepted recovery starts and fails between polls', async () => {
    let poll = 0;
    mockGet.mockImplementation(() => Promise.resolve({ data: status('CONNECTED', {
      status: 'FAILED',
      recoveryRequestOutstanding: poll++ === 0 ? false : false,
    }) }));
    mockPost.mockResolvedValue({ status: 202, data: { status: 'SYNC_RECOVERY_REQUESTED' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry synchronization' }));
    expect(await screen.findByText('The recovery attempt did not complete. You can retry synchronization.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry synchronization' })).toBeInTheDocument();
  });

  it('fails closed when authoritative recovery state is unavailable', async () => {
    mockGet.mockResolvedValue({ data: status('CONNECTED', {
      status: 'FAILED', recoveryRequestOutstanding: null,
    }) });
    renderPage();
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry synchronization' })).not.toBeInTheDocument();
  });

  it('preserves a truthful 409 refusal', async () => {
    mockGet.mockResolvedValue({ data: status('CONNECTED', { status: 'FAILED', lastError: 'synthetic' }) });
    mockPost.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry synchronization' }));
    expect(await screen.findByText('Synchronization recovery is not available in the current state.')).toBeInTheDocument();
  });

  it('does not expose write actions while permissions are unverified', async () => {
    mockGet.mockResolvedValue({ data: status('REAUTH_REQUIRED') });
    mockGetPermissions.mockRejectedValue(new Error('permission lookup failed'));
    renderPage();
    expect(await screen.findByText(/permissions could not be verified/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();
  });

  it('requests reconnect for only the canonical domain and refuses an unsafe server URL', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/integrations/sync-status') {
        return Promise.resolve({ data: status('REAUTH_REQUIRED') });
      }
      if (url === '/api/v1/integrations/oauth/initiate') {
        return Promise.resolve({ data: { authorizationUrl: 'https://evil.example/admin/oauth/authorize' } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Shopify' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/integrations/oauth/initiate',
      { params: { platform: 'shopify', shop: 'verified-shop.myshopify.com' } },
    ));
    expect(await screen.findByText('Shopify reconnection could not be started. Please try again.')).toBeInTheDocument();
  });

  it('does not announce recovery without a recovery request or integration', async () => {
    mockGet.mockResolvedValue({ data: status('NOT_INSTALLED', {
      integrationId: null,
      status: 'NOT_FOUND',
      recoveryRequestOutstanding: false,
      lastSyncedAt: null,
    }) });

    renderPage();

    expect(await screen.findByText('Not started')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText(
      /Sync recovery started|Sync recovery requested|recovery attempt did not complete/i
    )).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows loading, API error retry, and missing App Store URL guidance', async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    mockGet.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    const view = renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Shopify connection…');
    rejectRequest?.(new Error('offline'));
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    view.unmount();

    mockGet.mockResolvedValue({ data: status('NOT_INSTALLED', { integrationId: null, status: 'NOT_FOUND' }) });
    renderPage();
    expect(await screen.findByText('Shopify App Store installation is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Install from App Store/i })).not.toBeInTheDocument();
  });

  it('registers Connections as an ordinary Settings destination', () => {
    expect(SETTINGS_TABS).toContainEqual({ id: 'connections', label: 'Connections', path: '/settings/connections' });
    expect(SETTINGS_TABS[1].id).toBe('connections');
  });

  it('prioritizes reconnect over failed-sync recovery', async () => {
    mockGet.mockResolvedValue({ data: status('REAUTH_REQUIRED', { status: 'FAILED' }) });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Reconnect Shopify' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry synchronization' })).not.toBeInTheDocument();
  });

  it('does not offer recovery after uninstall', async () => {
    mockGet.mockResolvedValue({ data: status('UNINSTALLED', { status: 'FAILED' }) });
    renderPage();
    expect(await screen.findByText('Uninstalled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry synchronization' })).not.toBeInTheDocument();
  });

  it('explains denial and retries a failed permission lookup', async () => {
    mockGet.mockResolvedValue({ data: status('REAUTH_REQUIRED') });
    mockGetPermissions.mockRejectedValueOnce(new Error('offline')).mockRejectedValue({ response: {
      status: 403, data: { error: 'ACTION_FORBIDDEN' },
    } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry permissions' }));
    expect(await screen.findByText('You don’t have permission to manage this connection.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();
  });

  it('handles malformed API states without exposing actions', async () => {
    mockGet.mockResolvedValue({ data: status('CONNECTED', { connectionState: 'UNKNOWN' }) });
    renderPage();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText('verified-shop.myshopify.com')).not.toBeInTheDocument();
  });

  it('keeps actions unavailable while permission verification is pending', async () => {
    mockGet.mockResolvedValue({ data: status('REAUTH_REQUIRED') });
    mockGetPermissions.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByText('Checking connection permissions…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();
  });

  it('displays the recorded timestamp with an explicit timezone', async () => {
    mockGet.mockResolvedValue({ data: status('CONNECTED') });
    renderPage();
    const expected = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date('2026-10-18T10:00:00.000Z'));
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('explains completed recovery refusal without claiming a new success', async () => {
    mockGet.mockResolvedValue({ data: status('CONNECTED', { status: 'FAILED' }) });
    mockPost.mockRejectedValue({ response: { status: 409, data: { error: 'SYNC_ALREADY_COMPLETED' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry synchronization' }));
    expect(await screen.findByText('Synchronization is already complete. No recovery was started.')).toBeInTheDocument();
  });
});

describe('Shopify reconnect URL safety', () => {
  it('accepts only the server-provided canonical owned shop OAuth URL', () => {
    const domain = 'verified-shop.myshopify.com';
    expect(safeShopifyAuthorizationUrl(`https://${domain}/admin/oauth/authorize?state=ok`, domain))
      .toBe(`https://${domain}/admin/oauth/authorize?state=ok`);
    expect(safeShopifyAuthorizationUrl('https://evil.example/admin/oauth/authorize?state=bad', domain)).toBeNull();
    expect(safeShopifyAuthorizationUrl(`javascript:alert(1)`, domain)).toBeNull();
    expect(safeShopifyAuthorizationUrl(`https://${domain}.evil.example/admin/oauth/authorize`, domain)).toBeNull();
  });
});
