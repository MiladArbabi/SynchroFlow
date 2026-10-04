// tests/unit/ui/orders/OrdersOutboundPage.ops-console-wiring.test.tsx
//
// OUTBOUND SLICE A RED — Outbound follows the shared Ops Console state.
//
// Mirrors OrdersFT2Page.ops-console-wiring.test.tsx: the page reads the
// shared Ops Console state (owned by the top-nav trigger) and withdraws its
// Shipping State rail while the console is open. The Shipped Orders primary
// workspace stays mounted — the same node — across open/close, and the page
// owns no Ops Console entry point of its own.
//
// The real shared OperationalContextShell is used (its source has no
// barrel-dependent imports); the rest of @lasyncro/shared/ui is stubbed
// because its barrel does not resolve under jest (./activation/index.js).

import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, screen, within } from '@testing-library/react';

import { renderWithProviders } from 'test-utils';
import OrdersOutboundPage from 'pages/ft2-pages/OrdersOutboundPage';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

jest.mock('@lasyncro/shared/ui', () => {
  const React = require('react');
  const { OperationalContextShell } = jest.requireActual(
    '../../../../modules/shared/src/ui/OperationalContextShell'
  );
  return {
    __esModule: true,
    OperationalContextShell,
    EntityDetailModal: ({ children }: any) => React.createElement(React.Fragment, {}, children),
    PulseCard: ({ title }: any) => React.createElement('section', {}, React.createElement('h2', {}, title)),
  };
});

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  __esModule: true,
  OrderDetailModalBody: () => null,
}));

jest.mock('components/ModuleTabBar', () => ({
  __esModule: true,
  ModuleTabBar: () => null,
}));

jest.mock('components/ExportDrawer', () => ({
  __esModule: true,
  ExportDrawer: () => null,
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    locale: 'en-US',
    tier: 'growth',
    snapshot: { modules: new Set<string>(), flags: new Set<string>() },
    hasResolved: true,
  }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
}));

const OUTBOUND_ROW = {
  lasyncro_order_id: '00000000-0000-4000-8000-000000000001',
  external_order_id: '1001',
  shipped_at: '2026-09-02T10:00:00.000Z',
  total_price: '42.00',
  currency: 'USD',
  tracking_number: 'TRACK-1',
  carrier: null,
  carrier_provider: 'sendcloud',
  latest_status: 'in_transit',
  latest_event_at: '2026-09-02T12:00:00.000Z',
  is_stalled: false,
};

const mockGet = jest.fn((url: string) => {
  if (url.startsWith('/api/v1/orders/outbound')) {
    return Promise.resolve({ data: { orders: [OUTBOUND_ROW], total: 1, page: 1, limit: 10 } });
  }
  if (url.startsWith('/api/v1/wms/carrier-settings')) {
    return Promise.resolve({ data: { carriers: [] } });
  }
  if (url.startsWith('/api/v1/wms/outbound/handoff-queue')) {
    return Promise.resolve({ data: { orders: [], total: 0 } });
  }
  return Promise.reject(new Error(`unexpected GET ${url}`));
});

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (url: string) => mockGet(url),
    post: jest.fn(),
  },
}));

beforeEach(() => {
  mockGet.mockClear();
});

function SetConsole() {
  const { dispatch } = useConfig();
  return (
    <>
      <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: true })}>open console</button>
      <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: false })}>close console</button>
    </>
  );
}

function renderInShell() {
  renderWithProviders(
    <ConfigProvider>
      <SetConsole />
      <OrdersOutboundPage />
    </ConfigProvider>,
  );
}

const findPrimary = () => screen.findByRole('region', { name: /shipped orders/i });
const queryRail = () => screen.queryByRole('region', { name: /shipping state/i });

describe('OUTBOUND SLICE A: Ops Console closed', () => {
  it('renders the Shipped Orders primary and the Shipping State rail in the shared shell tracks', async () => {
    renderInShell();

    const primary = await findPrimary();
    const rail = queryRail();

    expect(rail).not.toBeNull();
    expect(primary.closest('[data-shell-track="primary"]')).not.toBeNull();
    expect(rail!.closest('[data-shell-track="rail"]')).not.toBeNull();
  });
});

describe('OUTBOUND SLICE A: Shipping State follows shared Ops Console state', () => {
  it('open -> rail withdraws and the primary stays the same node; close -> rail returns', async () => {
    renderInShell();

    const primary = await findPrimary();
    expect(queryRail()).not.toBeNull();

    act(() => { screen.getByText('open console').click(); });
    expect(queryRail()).toBeNull();
    expect(await findPrimary()).toBe(primary);

    act(() => { screen.getByText('close console').click(); });
    expect(queryRail()).not.toBeNull();
    expect(await findPrimary()).toBe(primary);
  });
});

describe('OUTBOUND SLICE A: page owns no Ops Console entry point', () => {
  it('renders no screen-local Ops Console control', async () => {
    renderInShell();

    const primary = await findPrimary();
    expect(within(primary).queryByRole('button', { name: /ops console/i })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /ops console/i })).toHaveLength(0);
  });

  it('source introduces no onOpenOpsConsole or local SET_OPS_CONSOLE dispatch', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx'),
      'utf8'
    );
    expect(source).not.toMatch(/\bonOpenOpsConsole\b/);
    expect(source).not.toMatch(/\bSET_OPS_CONSOLE\b/);
  });
});
