import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopifyConnectionsSettings, { type ShopifyConnectionState } from 'pages/ft2-pages/ShopifyConnectionsSettings';

// GH-979 SECTION C — owner-only Shopify disconnect from Settings → Connections.
const CAPABILITY = '/api/v1/integrations/shopify/disconnect/capability';
const DISCONNECT = '/api/v1/integrations/shopify/disconnect';
const RECONCILE = '/api/v1/integrations/shopify/disconnect/reconcile';
const DOMAIN = 'verified-shop.myshopify.com';

const mockStatus = jest.fn();
const mockCapability = jest.fn();
const mockPost = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (url: string) => {
      if (url === '/api/v1/integrations/sync-status') return mockStatus();
      if (url === '/api/v1/integrations/capabilities') return Promise.resolve({ data: { canManageConnection: true } });
      if (url === '/api/v1/integrations/shopify/disconnect/capability') return mockCapability();
      return Promise.reject(new Error(`unexpected GET ${url}`));
    },
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

function status(connectionState: ShopifyConnectionState) {
  return { data: { integrationId: 41, status: 'COMPLETED', connectionState, shopDomain: DOMAIN,
    recoveryRequestOutstanding: false, lastSyncedAt: '2026-10-18T10:00:00.000Z', lastError: null } };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ShopifyConnectionsSettings /></QueryClientProvider>);
}

async function openConfirmation() {
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Shopify' }));
  return screen.findByRole('group', { name: `Uninstall LaSyncro from ${DOMAIN}?` });
}

beforeEach(() => {
  mockStatus.mockReset().mockResolvedValue(status('CONNECTED'));
  mockCapability.mockReset().mockResolvedValue({ data: { canDisconnectShopify: true, disconnect: null } });
  mockPost.mockReset();
});

describe('Settings → Connections — Disconnect Shopify (GH-979 C)', () => {
  it('owner confirms with the identified store, sees pending state, then truthful success', async () => {
    let resolvePost!: (value: unknown) => void;
    mockPost.mockImplementation(() => new Promise(resolve => { resolvePost = resolve; }));
    renderPage();

    const confirmation = await openConfirmation();
    expect(confirmation).toHaveTextContent(/workspace, users, orders, inventory and history are kept/i);
    expect(confirmation).toHaveTextContent(/reinstall LaSyncro from the Shopify App Store/i);
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall from Shopify' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(DISCONNECT, { confirmShopDomain: DOMAIN }));
    expect(screen.getByRole('button', { name: 'Disconnecting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    mockStatus.mockResolvedValue(status('UNINSTALLED'));
    resolvePost({ status: 200, data: { status: 'SHOPIFY_DISCONNECTED', shopDomain: DOMAIN, connectionState: 'UNINSTALLED' } });
    expect(await screen.findByText(new RegExp(`LaSyncro was uninstalled from ${DOMAIN}`))).toBeInTheDocument();
    expect(await screen.findByText('Uninstalled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect Shopify' })).not.toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('cancel closes the confirmation without any request', async () => {
    renderPage();
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: /Uninstall LaSyncro/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Shopify' })).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-owner', () => mockCapability.mockResolvedValue({ data: { canDisconnectShopify: false } })],
    ['an unverifiable owner capability', () => mockCapability.mockRejectedValue(new Error('offline'))],
  ])('is not offered to %s', async (_label, arrange) => {
    arrange();
    renderPage();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    await waitFor(() => expect(mockCapability).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Disconnect Shopify' })).not.toBeInTheDocument();
  });

  it.each(['REAUTH_REQUIRED', 'UNINSTALLED', 'RECONNECT_IN_PROGRESS'] as ShopifyConnectionState[])(
    'is not offered without an active connection (%s)', async state => {
      mockStatus.mockResolvedValue(status(state));
      renderPage();
      expect(await screen.findByText(DOMAIN)).toBeInTheDocument();
      // REAUTH_REQUIRED is also how an unresolved disconnect reads, so only it looks one up.
      if (state === 'REAUTH_REQUIRED') await waitFor(() => expect(mockCapability).toHaveBeenCalled());
      else expect(mockCapability).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Disconnect Shopify' })).not.toBeInTheDocument();
      expect(screen.queryByText(/couldn’t be confirmed/)).not.toBeInTheDocument();
    });

  it.each([
    ['an ambiguous provider outcome', { response: { status: 502, data: { error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN' } } }],
    ['no response at all', new Error('Network Error')],
    ['an unrecognized refusal', { response: { status: 418, data: { error: 'SOMETHING_NEW' } } }],
  ])('never claims success or "nothing changed" for %s', async (_label, failure) => {
    mockPost.mockRejectedValue(failure);
    renderPage();
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall from Shopify' }));
    expect(await screen.findByText(/couldn’t confirm whether Shopify completed the uninstall/i)).toBeInTheDocument();
    expect(screen.queryByText(/was uninstalled from/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing was changed/i)).not.toBeInTheDocument();
    await waitFor(() => expect(mockStatus.mock.calls.length).toBeGreaterThan(1));
  });

  it.each([
    ['SHOPIFY_DISCONNECT_REJECTED', 422, 'Shopify declined the uninstall. Nothing was changed.'],
    ['OWNER_REQUIRED', 403, 'Only the store owner can disconnect Shopify.'],
    ['SHOPIFY_UNAVAILABLE', 503, 'Shopify couldn’t be reached. Nothing was changed. Please try again.'],
  ])('explains a definitive %s refusal', async (code, httpStatus, copy) => {
    mockPost.mockRejectedValue({ response: { status: httpStatus, data: { error: code } } });
    renderPage();
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall from Shopify' }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Shopify' })).toBeEnabled();
  });

  it('reports a provider-confirmed uninstall still being finalized without claiming completion', async () => {
    mockPost.mockResolvedValue({ status: 202, data: { status: 'SHOPIFY_DISCONNECT_PENDING_CONFIRMATION', shopDomain: DOMAIN } });
    renderPage();
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall from Shopify' }));
    expect(await screen.findByText(/Shopify confirmed the uninstall. LaSyncro is finishing the disconnect/)).toBeInTheDocument();
    expect(screen.queryByText(/was uninstalled from/i)).not.toBeInTheDocument();
  });
});

describe('Settings → Connections — unresolved disconnect (GH-979 C)', () => {
  const unresolved = (disconnect: Record<string, unknown>, canDisconnectShopify = true) =>
    mockCapability.mockResolvedValue({ data: { canDisconnectShopify, disconnect: { shopDomain: DOMAIN, ...disconnect } } });

  beforeEach(() => mockStatus.mockResolvedValue(status('REAUTH_REQUIRED')));

  it('shows an unconfirmed uninstall and lets the owner re-check without resending it', async () => {
    unresolved({ status: 'OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' });
    mockPost.mockRejectedValue({ response: { status: 409, data: { error: 'SHOPIFY_DISCONNECT_NOT_APPLIED', shopDomain: DOMAIN } } });
    renderPage();

    expect(await screen.findByText(new RegExp(`asked Shopify to uninstall the app from ${DOMAIN}, but the result couldn’t be confirmed`)))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect Shopify' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check with Shopify again' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(RECONCILE, { confirmShopDomain: DOMAIN }));
    expect(await screen.findByText(/Shopify confirms LaSyncro is still installed/)).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalledWith(DISCONNECT, expect.anything());
  });

  it('a still-unknown re-check never claims success or "nothing changed"', async () => {
    unresolved({ status: 'OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' });
    mockPost.mockRejectedValue({ response: { status: 502, data: { error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN',
      recovery: 'CHECK_LATER' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Check with Shopify again' }));
    expect(await screen.findByText(/couldn’t confirm whether Shopify completed the uninstall/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was changed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/was uninstalled from/i)).not.toBeInTheDocument();
  });

  it('is visible to non-owners, who cannot act on it', async () => {
    unresolved({ status: 'OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' }, false);
    renderPage();
    expect(await screen.findByText(/result couldn’t be confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check with Shopify again' })).not.toBeInTheDocument();
  });

  it('after exhausted checks, points to reconnect or reinstall instead of another check', async () => {
    unresolved({ status: 'OUTCOME_UNKNOWN', recovery: 'RECONNECT' });
    renderPage();
    expect(await screen.findByText(/Reconnect Shopify, or reinstall LaSyncro from the Shopify App Store/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check with Shopify again' })).not.toBeInTheDocument();
  });

  it('a provider-confirmed uninstall being finalized completes through the re-check', async () => {
    unresolved({ status: 'LOCAL_FENCE_PENDING', recovery: null });
    mockPost.mockResolvedValue({ status: 200, data: { status: 'SHOPIFY_DISCONNECTED', shopDomain: DOMAIN,
      connectionState: 'UNINSTALLED' } });
    renderPage();
    expect(await screen.findByText(/Shopify confirmed that LaSyncro was uninstalled from/)).toBeInTheDocument();
    mockStatus.mockResolvedValue(status('UNINSTALLED'));
    fireEvent.click(screen.getByRole('button', { name: 'Check with Shopify again' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(RECONCILE, { confirmShopDomain: DOMAIN }));
    expect(await screen.findByText(new RegExp(`LaSyncro was uninstalled from ${DOMAIN}`))).toBeInTheDocument();
    expect(await screen.findByText('Uninstalled')).toBeInTheDocument();
  });
});
