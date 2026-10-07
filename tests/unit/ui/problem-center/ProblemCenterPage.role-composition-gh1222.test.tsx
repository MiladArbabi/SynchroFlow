// tests/unit/ui/problem-center/ProblemCenterPage.role-composition-gh1222.test.tsx
//
// GH-1222 / TIER-07 — TEST STRATEGY / RED — Problem Center role composition.
// ==========================================================================
// Ratified:
//   - Problem Center is NOT blanket-hidden from operators. BASE page access is
//     operational and follows warehouse.operations (Core+); Growth-only
//     functionality is gated inside the surface, not around the whole page.
//   - Operators see their scoped operational task pool, but cannot make
//     management/destructive resolution decisions and cannot resolve pack
//     approval/hold decisions (owner/admin `wms:problem:resolve`,
//     `wms:batch:release`).
//   - Owner/admin keep management resolution and the pending-decisions strip.
//
// Covers brief sections E (page composition) and F (module resolution UI).
// F is exercised through the page with the REAL module source so the role
// reaches the module however the implementation wires it — no prop name is
// frozen here.
//
// Harness: REAL ProblemCenterPage, CommercialGate, ModuleTabBar,
// EntitlementsProvider (driven through /api/v1/entitlements/me), react-query
// hooks and ProblemCenterModuleFT2 source. Stubbed: AuthContext role, the
// axios HTTP boundary and UpgradePrompt rendering.

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UpgradePromptProps } from 'components/UpgradePrompt';

type Role = 'owner' | 'admin' | 'operator';
type Tier = 'starter' | 'core' | 'growth' | 'scale';

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
    accessToken: 'test-token',
    user: { id: 7, shop_id: 1222, role: mockRole, first_name: 'Test', last_name: '', email: 'user@example.test' },
    logout: jest.fn(),
  }),
}));
jest.mock('hooks/useAppTheme', () => ({ useAppTheme: () => ({}) }));
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: (props: UpgradePromptProps) => (
    <div
      data-testid="upgrade-prompt"
      data-open={String(Boolean(props.open))}
      data-required-tier={props.decision?.requiredTier ?? props.requiredTier ?? ''}
    >
      {props.children}
    </div>
  ),
}));
jest.mock('@lasyncro/problem-center', () => ({
  ProblemCenterModuleFT2: jest.requireActual(
    '../../../../modules/problem-center/src/ui/pages/ProblemCenterModuleFT2',
  ).default,
}));

import { EntitlementsProvider, useEntitlements } from 'contexts/EntitlementsContext';
import ProblemCenterPage from 'pages/ft2-pages/ProblemCenterPage';

const PACK_DECISIONS_URL = /\/api\/v1\/wms\/pack\/decision-requests/;

const TASKS = [
  {
    problem_task_id: '11111111-1111-4111-8111-111111111111',
    status: 'open',
    source: 'pick',
    exception_type: 'item_missing',
    quantity: 1,
    notes: 'PROB-1222-0001',
    problem_bin_location: null,
    created_at: '2026-10-07T08:00:00.000Z',
    variant_title: 'Missing Widget',
    sku: 'SKU-MISSING-1222',
  },
  {
    problem_task_id: '22222222-2222-4222-8222-222222222222',
    status: 'open',
    source: 'receive',
    exception_type: 'product_defect',
    quantity: 2,
    notes: 'PROB-1222-0002',
    problem_bin_location: null,
    created_at: '2026-10-07T09:00:00.000Z',
    variant_title: 'Defective Gadget',
    sku: 'SKU-DEFECT-1222',
  },
];

function arrangeHttp(tier: Tier) {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: {} });
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/v1/entitlements/me') {
      return Promise.resolve({
        data: {
          shopId: 1222,
          modules: [],
          flags: [],
          tier,
          trialEndsAt: null,
          subscriptionStatus: 'active',
          displayCurrency: 'USD',
          locale: 'en-US',
          billingCurrency: 'USD',
          billingProvider: 'shopify',
        },
      });
    }
    if (url === '/api/v1/wms/problem-center') {
      return Promise.resolve({ data: { problem_tasks: TASKS } });
    }
    if (PACK_DECISIONS_URL.test(url)) {
      return Promise.resolve({ data: { requests: [], total: 0 } });
    }
    return Promise.resolve({ data: {} });
  });
}

function EntitlementsProbe() {
  const { hasResolved, error, tier } = useEntitlements();
  return <div data-testid="entitlements-probe">{`${hasResolved}|${error ?? ''}|${tier}`}</div>;
}

async function renderPage(role: Role, tier: Tier) {
  mockRole = role;
  arrangeHttp(tier);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/problem-center']}>
        <EntitlementsProvider>
          <ProblemCenterPage />
          <EntitlementsProbe />
        </EntitlementsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Precondition: commercial truth resolved to the tier the case claims.
  await waitFor(() =>
    expect(screen.getByTestId('entitlements-probe')).toHaveTextContent(new RegExp(`^true\\|\\|${tier}$`)),
  );
  await settle();
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

const packDecisionQueries = () =>
  mockGet.mock.calls.filter(([url]) => PACK_DECISIONS_URL.test(String(url)));

const taskRowsVisible = () =>
  screen.queryByText('PROB-1222-0001') !== null && screen.queryByText('PROB-1222-0002') !== null;

const resolveCtas = () => screen.queryAllByText(/Resolve\s*→/);

/** The Resolve CTA inside the row that shows a given PROB label. */
function resolveCtaForTask(probLabel: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(probLabel);
  while (el && within(el).queryAllByText(/Resolve\s*→/).length === 0) el = el.parentElement;
  expect(el).not.toBeNull();
  const ctas = within(el as HTMLElement).getAllByText(/Resolve\s*→/);
  expect(ctas).toHaveLength(1);
  return ctas[0];
}

/**
 * Commercial denial rendered in place of the page body. CommercialGate's deny
 * path renders UpgradePrompt with `open` set and without the children; the
 * ModuleTabBar's own (closed) prompt lives INSIDE the gate, so an open prompt
 * present without any click is the page-level gate denial.
 */
const pageCommerciallyBlocked = () =>
  screen.queryAllByTestId('upgrade-prompt').some((el) => el.getAttribute('data-open') === 'true');

// ---------------------------------------------------------------------------
// E — page role / commercial composition
// ---------------------------------------------------------------------------

describe('GH-1222 E1 — OPERATOR enters the operational Problem Center', () => {
  it('E1 EXPECTED RED: operator @ Core — base page is not blocked behind warehouse.problem_center; scoped task pool renders', async () => {
    await renderPage('operator', 'core');

    expect(pageCommerciallyBlocked()).toBe(false);
    await waitFor(() => expect(taskRowsVisible()).toBe(true));
  });

  it('E1 GREEN CONTROL: operator @ Starter — base page follows warehouse.operations and stays commercially denied', async () => {
    await renderPage('operator', 'starter');

    expect(pageCommerciallyBlocked()).toBe(true);
    expect(taskRowsVisible()).toBe(false);
  });

  it('E1 EXPECTED RED: operator @ Growth — PendingDecisionsStrip never issues the owner/admin pack-decision query', async () => {
    await renderPage('operator', 'growth');
    await waitFor(() => expect(taskRowsVisible()).toBe(true));

    expect(packDecisionQueries()).toHaveLength(0);
  });
});

describe('GH-1222 E2 — OWNER / ADMIN keep management eligibility', () => {
  it.each(['owner', 'admin'] as const)(
    'E2 GREEN CONTROL: %s @ Growth — pending-decisions strip queries and management Resolve is available',
    async (role) => {
      await renderPage(role, 'growth');
      await waitFor(() => expect(taskRowsVisible()).toBe(true));

      expect(packDecisionQueries().length).toBeGreaterThan(0);
      expect(resolveCtas().length).toBeGreaterThan(0);
    },
  );

  it.each(['owner', 'admin'] as const)(
    'E3 EXPECTED RED: %s @ Core — operational page renders with management Resolve (base is warehouse.operations)',
    async (role) => {
      await renderPage(role, 'core');

      expect(pageCommerciallyBlocked()).toBe(false);
      await waitFor(() => expect(taskRowsVisible()).toBe(true));
      expect(resolveCtas().length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// F — module resolution UI by role (commercial held at Growth to isolate role)
// ---------------------------------------------------------------------------

describe('GH-1222 F — Problem Center resolution UI role parity', () => {
  it('F1 EXPECTED RED: operator — task rows visible, but no Resolve CTA and no Discard / Write Off choice', async () => {
    await renderPage('operator', 'growth');
    await waitFor(() => expect(taskRowsVisible()).toBe(true));

    expect(resolveCtas()).toHaveLength(0);
    expect(screen.queryByText('Resolve Exception')).toBeNull();
    expect(screen.queryByText('Discard')).toBeNull();
    expect(screen.queryByText('Write Off')).toBeNull();
  });

  it.each(['owner', 'admin'] as const)(
    'F2 GREEN CONTROL: %s — Resolve opens the dialog with the existing workflow options (Write Off, Discard)',
    async (role) => {
      await renderPage(role, 'growth');
      await waitFor(() => expect(taskRowsVisible()).toBe(true));

      const rowCtas = resolveCtas();
      expect(rowCtas.length).toBeGreaterThanOrEqual(2);

      // item_missing task → Write Off is an offered action.
      fireEvent.click(resolveCtaForTask('PROB-1222-0001'));
      expect(await screen.findByText('Resolve Exception')).toBeInTheDocument();
      expect(screen.getByText('Write Off')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByText('Resolve Exception')).toBeNull());

      // product_defect task → Discard is an offered action.
      fireEvent.click(resolveCtaForTask('PROB-1222-0002'));
      expect(await screen.findByText('Resolve Exception')).toBeInTheDocument();
      expect(screen.getByText('Discard')).toBeInTheDocument();
    },
  );
});
