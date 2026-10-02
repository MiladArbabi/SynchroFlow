import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ShopSettingsWarehousePage from 'pages/ft2-pages/ShopSettingsWarehousePage';
const mockPopper = jest.fn();
jest.mock('@mui/material', () => {
  const actual = jest.requireActual('@mui/material');
  return { ...actual, Popper: (props: any) => { mockPopper(props); return <actual.Popper {...props} />; } };
});
const mockGet = jest.fn();
const mockPatch = jest.fn();
jest.mock('api/axiosConfig', () => ({ axiosInstance: { get: (...args: unknown[]) => mockGet(...args), patch: (...args: unknown[]) => mockPatch(...args) } }));
jest.mock('contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@lasyncro/shared/ui', () => ({ SpotlightCoachMark: jest.requireActual('../../../../modules/shared/src/ui/SpotlightCoachMark').SpotlightCoachMark }));
const BODY = 'Your Shopify store can have multiple locations. Select the one this warehouse represents. LaSyncro will use that location for opening stock and future inventory updates.';
const MAPPINGS = '/api/v1/settings/shop/warehouse-shopify-locations';
let mapped: string | null;
let client: QueryClient;
function Location() { return <output data-testid="url">{useLocation().search}</output>; }
function mount(search = '?guide=shopify-location&keep=yes') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['onboarding', 'readiness'], { canonical: true });
  return render(<MemoryRouter initialEntries={['/settings/warehouse' + search]}><QueryClientProvider client={client}><Location /><ShopSettingsWarehousePage /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  jest.clearAllMocks(); mapped = null;
  jest.spyOn(window, 'WebSocket').mockImplementation(() => ({ close: jest.fn() } as unknown as WebSocket));
  mockGet.mockImplementation((url: string) => Promise.resolve({ data: url === MAPPINGS ? {
    warehouses: [{ warehouse_id: 'wh-test', name: 'Test warehouse', active: true, is_default: true, shopify_location_id: mapped }],
    shopify_locations: [{ shopify_location_id: 'loc-test', name: 'Main Shopify', is_active: true }],
  } : url.endsWith('/printers') ? { printers: [] } : url.endsWith('/display-tokens') ? { tokens: [] } : { settings: {} } }));
  mockPatch.mockImplementation((_url: string, body: { shopify_location_id: string }) => { mapped = body.shopify_location_id; return Promise.resolve({ data: { warehouse_id: 'wh-test', shopify_location_id: mapped } }); });
});
afterEach(() => { cleanup(); client?.clear(); jest.restoreAllMocks(); });
describe('GH-1179 Settings contextual guidance', () => {
  it('guided unmapped control has the exact contextual coach; Got it only dismisses and cleans the URL', async () => {
    mount();
    expect(await screen.findByText('Choose your Shopify location')).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeEnabled();
    const openPopper = mockPopper.mock.calls.find(([props]) => props.open)?.[0];
    expect(openPopper.anchorEl).toBe(screen.getByRole('combobox').closest('.MuiFormControl-root'));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByText(BODY)).toBeNull());
    expect(screen.getByTestId('url')).toHaveTextContent('?keep=yes');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox').parentElement?.querySelector('input')).toHaveValue('');
    expect(screen.getByRole('combobox')).toBeEnabled();
  });
  it('X dismisses explanation without selecting a location', async () => {
    mount(); await screen.findByText(BODY);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(BODY)).toBeNull());
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('url')).toHaveTextContent('?keep=yes');
  });
  it('mapped state suppresses stale guidance', async () => {
    mapped = 'loc-test'; mount();
    await screen.findByText('Main Shopify');
    expect(screen.queryByText(BODY)).toBeNull();
  });
  it('normal Settings visit stays coach-free', async () => {
    mount(''); await screen.findByRole('combobox');
    expect(screen.queryByText(BODY)).toBeNull();
  });
  it('successful mapping clears intent and invalidates canonical readiness', async () => {
    mount(); await screen.findByRole('combobox');
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Main Shopify' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/api/v1/settings/shop/warehouses/wh-test/shopify-location', { shopify_location_id: 'loc-test' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('?keep=yes'));
    expect(screen.queryByText(BODY)).toBeNull();
    expect(client.getQueryState(['onboarding', 'readiness'])?.isInvalidated).toBe(true);
  });
});
