// tests/unit/ui/problem-center/ProblemCenterPage.pack-before-queue-i5-d1.test.tsx
//
// SF-PC-V2-I5-UI-CORRECT-005 — D1 through the real page and its queries.
// ==========================================================================
// The pending pack-decision query (owner/admin only) usually resolves before
// the Problem Center projection. Until the projection arrives — or after it
// fails with nothing cached — the page must not expose a pack decision or its
// Ship partial / Hold order controls. Once the projection loads (directly or
// via Retry) the decisions join the queue. Operators never query or see them.
//
// Harness: REAL ProblemCenterPage, CommercialGate, EntitlementsProvider,
// react-query hooks and ProblemCenterModuleFT2 source. Stubbed: AuthContext
// role, the axios HTTP boundary and UpgradePrompt rendering (as GH-1222).

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Role = 'owner' | 'admin' | 'operator';

let mockRole: Role = 'owner';
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    // Unsigned JWT-shaped token for shop 1222 ({ user_id: 7, shop_id: 1222 }).
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo3LCJzaG9wX2lkIjoxMjIyfQ.sig',
    user: { id: 7, shop_id: 1222, role: mockRole, first_name: 'Test', last_name: '', email: 'user@example.test' },
    logout: jest.fn(),
  }),
}));
jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: { open?: boolean; children?: React.ReactNode }) => (
    <div data-testid="upgrade-prompt" data-open={String(Boolean(props.open))}>{props.children}</div>
  ),
}));
jest.mock('@lasyncro/problem-center', () => ({
  ProblemCenterModuleFT2: jest.requireActual(
    '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2',
  ).default,
}));

import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import ProblemCenterPage from 'pages/ft2-pages/ProblemCenterPage';

const PROBLEM_CENTER_URL = '/api/v1/wms/problem-center';
const PACK_DECISIONS_URL = /\/api\/v1\/wms\/pack\/decision-requests/;

const TASK = {
  problem_task_id: 'd1d1d1d1-1111-4111-8111-111111111111',
  status: 'open',
  source: 'pick',
  exception_type: 'order_cancelled',
  quantity: 1,
  notes: 'PROB-D1-0001',
  problem_bin_location: 'PROB-BIN',
  created_at: '2026-11-02T09:00:00.000Z',
  variant_title: 'Cancelled Gadget',
  sku: 'SKU-D1-TASK',
};

const PACK_REQUEST = {
  id: 'd1d1d1d1-2222-4222-8222-222222222222',
  pick_batch_id: 'b1b1b1b1-0000-4000-8000-000000000001',
  lasyncro_order_id: 'o1o1o1o1-0000-4000-8000-000000000001',
  lasyncro_line_item_id: 'l1l1l1l1-0000-4000-8000-000000000001',
  exception_type: 'missing_item',
  question: 'Ship partial?',
  status: 'pending',
  partial_shipment: null,
  raised_by: 9,
  raised_at: '2026-11-02T08:00:00.000Z',
  resolved_by: null,
  resolved_at: null,
  note: null,
  external_order_id: '30001',
  variant_title: 'Copper Kettle',
  sku: 'SKU-D1-PACK',
};

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

/** Each Problem Center request gets the next deferred; pack decisions resolve immediately. */
function arrangeHttp(problemCenterResponses: Deferred[]) {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: {} });
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/v1/entitlements/me') {
      return Promise.resolve({
        data: {
          shopId: 1222, modules: [], flags: [], tier: 'growth', trialEndsAt: null, subscriptionStatus: 'active',
          displayCurrency: 'USD', locale: 'en-US', billingCurrency: 'USD', billingProvider: 'shopify',
        },
      });
    }
    if (url === PROBLEM_CENTER_URL) {
      const next = problemCenterResponses.shift();
      return next ? next.promise : new Promise(() => {});
    }
    if (PACK_DECISIONS_URL.test(url)) return Promise.resolve({ data: { requests: [PACK_REQUEST], total: 1 } });
    return Promise.resolve({ data: {} });
  });
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function renderPage(role: Role) {
  mockRole = role;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/problem-center']}>
        <EntitlementsProvider>
          <ProblemCenterPage />
        </EntitlementsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const queueRows = (): HTMLElement[] => {
  const list = screen.queryByRole('listbox', { name: 'Exceptions' });
  return list ? within(list).queryAllByRole('option') : [];
};
const rowFor = (text: string) => queueRows().find((r) => r.textContent?.includes(text)) ?? null;
const detail = () => screen.getByRole('region', { name: 'Exception detail' });
const packDecisionQueries = () => mockGet.mock.calls.filter(([url]) => PACK_DECISIONS_URL.test(String(url)));
const packControls = () => screen.queryAllByRole('button', { name: /Ship partial|Hold order/ });

async function waitForPage() {
  await waitFor(() => expect(screen.getByTestId('problem-center-v2')).toBeInTheDocument());
  await settle();
}

describe.each(['owner', 'admin'] as const)('%s — pack decisions resolve before the Problem Center projection', (role) => {
  it('loading: the resolved pack decision is not selectable or actionable; it joins the queue on arrival', async () => {
    const problemCenter = deferred();
    arrangeHttp([problemCenter]);
    renderPage(role);
    await waitForPage();

    await waitFor(() => expect(packDecisionQueries().length).toBeGreaterThan(0));
    await settle();
    expect(queueRows()).toHaveLength(0);
    expect(packControls()).toHaveLength(0);
    expect(within(detail()).queryByText('Copper Kettle')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs decision: loading' })).toBeInTheDocument();

    await act(async () => { problemCenter.resolve({ data: { problem_tasks: [TASK] } }); });
    await settle();

    await waitFor(() => expect(rowFor('Copper Kettle')).not.toBeNull());
    expect(rowFor('Cancelled Gadget')).not.toBeNull();
    fireEvent.click(rowFor('Copper Kettle') as HTMLElement);
    expect(within(detail()).getByRole('button', { name: /Ship partial/ })).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('error without cached data: Retry, no pack controls; a successful Retry integrates both', async () => {
    const failed = deferred();
    const retried = deferred();
    arrangeHttp([failed, retried]);
    renderPage(role);
    await waitForPage();

    await act(async () => { failed.reject(Object.assign(new Error('boom'), { response: { status: 500 } })); });
    await settle();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Problem Center could not load.');
    expect(packDecisionQueries().length).toBeGreaterThan(0);
    expect(queueRows()).toHaveLength(0);
    expect(packControls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Needs decision: unavailable' })).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await act(async () => { retried.resolve({ data: { problem_tasks: [TASK] } }); });
    await settle();

    await waitFor(() => expect(rowFor('Copper Kettle')).not.toBeNull());
    expect(rowFor('Cancelled Gadget')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('operator', () => {
  it('never queries pack decisions; no decision controls before or after the projection loads', async () => {
    const problemCenter = deferred();
    arrangeHttp([problemCenter]);
    renderPage('operator');
    await waitForPage();

    expect(queueRows()).toHaveLength(0);
    expect(packControls()).toHaveLength(0);

    await act(async () => { problemCenter.resolve({ data: { problem_tasks: [TASK] } }); });
    await settle();

    await waitFor(() => expect(rowFor('Cancelled Gadget')).not.toBeNull());
    expect(rowFor('Copper Kettle')).toBeNull();
    fireEvent.click(rowFor('Cancelled Gadget') as HTMLElement);
    expect(within(detail()).queryAllByRole('button')).toHaveLength(0);
    expect(packDecisionQueries()).toHaveLength(0);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
