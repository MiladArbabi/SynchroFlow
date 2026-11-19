/**
 * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — native Pick product card parity.
 * Name · variant (from the /line-items payload's product_title/variant_title),
 * SKU when present, the actual accepted scan identifier (the server barcode,
 * or "Scan: Unit label (LSU-…)" for labelled stock) and quantity — in every
 * stage. SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 removed the reference
 * barcode, the "required" instruction and the scanned-progress counter.
 * Harness copied from pick-location-truth-mobile-01 (real PickBriefScreen;
 * transport and online-only queue mocked).
 */
import React from 'react';
import { act, fireEvent, render, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { apiClient, offlineQueue } from '@lasyncro/mobile-core';
import PickBriefScreen from '../src/screens/PickBriefScreen';

const BATCH = 'pick0001-0000-4000-8000-000000000001';

const mockNav = { goBack: jest.fn(), navigate: jest.fn() };
const mockSession: {
  initial: { phase: string; phaseData: Record<string, unknown> };
  persisted: { phase: string; phaseData: Record<string, unknown> } | null;
} = { initial: { phase: 'brief', phaseData: {} }, persisted: null };
const mockDock: { onResolve: ((raw: string, method?: string) => Promise<string | void>) | null; hint: string | null } = { onResolve: null, hint: null };
const mockSheet: { onReport: ((type: string, qty: number) => Promise<string | void>) | null } = { onReport: null };

jest.mock('@lasyncro/mobile-core', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  offlineQueue: {
    subscribe: jest.fn(() => () => {}),
    flush: jest.fn(async () => {}),
    getRejected: jest.fn(async () => []),
    dismissRejected: jest.fn(async () => {}),
    submitScanOnline: jest.fn(async () => undefined),
  },
}));
jest.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ userId: 7 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: { task: { id: 'pick0001-0000-4000-8000-000000000001', title: 'Batch PICK0001' } } }),
}));
jest.mock('../src/ui', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  const Container = ({ children }: any) => React.createElement(View, null, children);
  const Ctx = React.createContext(null);
  let n = 0;
  function SessionShell({ children }: any) {
    const [phase, setPhaseState] = React.useState(mockSession.initial.phase);
    const [phaseData, setPhaseData] = React.useState(mockSession.initial.phaseData);
    const value = {
      phase, phaseData, isRestoring: false,
      newEventId: () => `evt-${++n}`,
      setPhase: async (p: string, d: Record<string, unknown> = {}) => {
        setPhaseState(p); setPhaseData(d); mockSession.persisted = { phase: p, phaseData: d };
      },
      clearSession: async () => { mockSession.persisted = null; },
    };
    return React.createElement(Ctx.Provider, { value }, children);
  }
  return {
    Screen: Container, Card: Container, Row: Container, Divider: () => null, AppHeader: () => null,
    NodeTrack: () => null,
    ProblemSheet: ({ onReport }: any) => { mockSheet.onReport = onReport; return null; },
    Badge: ({ label }: any) => React.createElement(Text, null, label),
    Button: ({ label, onPress, disabled }: any) =>
      React.createElement(TouchableOpacity, { onPress, disabled, accessibilityRole: 'button' }, React.createElement(Text, null, label)),
    SessionShell,
    useSession: () => React.useContext(Ctx),
    ScanDock: ({ hint, onResolve }: any) => {
      mockDock.onResolve = onResolve; mockDock.hint = hint;
      return React.createElement(Text, null, `dock:${hint}`);
    },
  };
});

const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;
const q = offlineQueue as unknown as Record<string, jest.Mock>;
const ROOT = 'WH-1-ROOT';
const EAN = '501234567892';
type Item = Record<string, unknown>;
/**
 * R2 shape as /line-items serves it: product_title + variant_title, no `title`;
 * order-line SKU snapshot null, variant's current SKU CWB-002.
 */
const item = (over: Item = {}): Item => ({
  reservation_allocation_id: 'a11c0001-0000-4000-8000-00000000000a', lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1',
  sku: null, variant_sku: 'CWB-002', product_title: 'Canvas Weekender Bag', variant_title: 'Default Title', barcode: EAN, quantity: 2, location_code: ROOT,
  location_pickable: true, location_scan_required: false, unit_scan_required: 1,
  scan_unit_id: 'LSU-e1161b1e', // ACTIONABLE-ID-001: one eligible LSU projected by /line-items
  ...over,
});
const RESOLVE: Record<string, Item> = {
  'LSU-bf1b13e9': { resolution_method: 'unit_barcode', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-bf1b13e9', unit_status: 'stowed', current_location_code: ROOT },
  'LSU-3058d336': { resolution_method: 'unit_barcode', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-3058d336', unit_status: 'stowed', current_location_code: ROOT },
  [EAN]: { resolution_method: 'barcode', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-SERVERPICKED', unit_status: 'stowed', current_location_code: ROOT },
};
function serve(items: Item[]) {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/pick-session')) return { data: { pick_claim_generation: 'gen-7' } };
    if (url.includes('/line-items')) return { data: { line_items: items } };
    return { data: { batches: [{ pick_batch_id: BATCH, status: 'picking', picked_by: 7 }] } };
  });
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/barcode/resolve')) {
      const r = RESOLVE[body.scanned_value];
      if (!r) throw { response: { status: 404, data: { error: 'No variant found for scanned value' } } };
      return { data: r };
    }
    throw new Error(`unexpected POST ${url}`);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.persisted = null; mockDock.onResolve = null; mockDock.hint = null; mockSheet.onReport = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
async function openAt(items: Item[]) {
  serve(items);
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: null, generation: 'gen-7' } };
  render(<PickBriefScreen />);
  await waitFor(() => expect(mockDock.onResolve).not.toBeNull());
}
async function scan(raw: string): Promise<string | void> {
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!(raw, 'hid'); });
  return result;
}
const text = (id: string) => {
  const c = screen.getByTestId(id).props.children;
  return (Array.isArray(c) ? c : [c]).filter((x: unknown) => typeof x === 'string' || typeof x === 'number').join('');
};
/** ACTIONABLE-ID-001 — the full scan target value (nested in its line). */
const target = () => screen.getByTestId('pick-scan-target').props.children;
function expectLsuIdentity(scanned = false) {
  expect(text('pick-product-name')).toBe('Canvas Weekender Bag');
  expect(text('pick-product-sku')).toBe('SKU: CWB-002');
  if (!scanned) {
    // The complete server LSU is shown before the scan; display is never verification.
    expect(text('pick-product-accepted-identifier')).toBe('Unit label: ');
    expect(target()).toBe('LSU-e1161b1e');
  } else {
    // After the scan the verified LSU (green ✓) replaces the suggestion.
    expect(screen.queryByTestId('pick-scan-target')).toBeNull();
    expect(screen.getByTestId('pick-scan-accepted')).toBeTruthy();
  }
  expect(screen.queryByText(/LSU-…|Scan: Unit label|Scan the unit label on one item/)).toBeNull();
  expect(screen.queryByTestId('pick-product-barcode')).toBeNull();
  expect(screen.queryByTestId('pick-product-lsu')).toBeNull();
  expect(screen.queryByTestId('pick-label-progress')).toBeNull();
  expect(screen.queryByText(/Product barcode \(reference\)|Scan individual unit labels|labels scanned/)).toBeNull();
  expect(screen.getByText('Quantity: 2')).toBeTruthy();
}

test('PI-01 LSU mode: identity visible; a product-barcode scan is not a label; one label verifies; facts persist through the count', async () => {
  await openAt([item()]);
  expectLsuIdentity();
  expect(await scan(EAN)).toBe('Scan the unit label (LSU-…) on the item.');
  expect(screen.queryByText(/^✓ LSU-/)).toBeNull();
  expect(screen.queryByText(/LSU-SERVERPICKED/)).toBeNull();
  expectLsuIdentity();
  await scan('LSU-bf1b13e9');
  expect(screen.getByTestId('pick-scan-accepted').props.children).toBe('✓ LSU-bf1b13e9');
  expect(await scan('LSU-3058d336')).toBe('All labels are scanned. Tap Confirm pick.');
  expectLsuIdentity(true);
  expect(q.submitScanOnline).not.toHaveBeenCalled(); // nothing sent before Confirm
});

test('PI-02 EAN-only stock: barcode is the scan target; no unit-label instruction', async () => {
  await openAt([item({ unit_scan_required: 0 })]);
  expect(text('pick-product-name')).toBe('Canvas Weekender Bag');
  expect(text('pick-product-sku')).toBe('SKU: CWB-002');
  expect(text('pick-product-barcode')).toBe('Barcode: ');
  expect(target()).toBe(EAN);
  expect(screen.queryByTestId('pick-product-accepted-identifier')).toBeNull();
  expect(screen.queryByTestId('pick-product-lsu')).toBeNull();
  expect(screen.queryByTestId('pick-label-progress')).toBeNull();
});

test('PI-03 missing optional identifiers are never invented', async () => {
  await openAt([item({ sku: null, variant_sku: null, barcode: null, variant_title: 'Olive' })]);
  expect(text('pick-product-name')).toBe('Canvas Weekender Bag · Olive');
  expect(screen.queryByTestId('pick-product-sku')).toBeNull();
  // Labelled stock: the accepted identifier is the unit label; no product-barcode line.
  expect(target()).toBe('LSU-e1161b1e');
  expect(screen.queryByTestId('pick-product-barcode')).toBeNull();
});

test('PI-04 no barcode field and a blank SKU → no lines; a payload carrying only `title` still names the product', async () => {
  const { barcode: _b, product_title: _p, variant_title: _v, variant_sku: _s, ...rest } = item({ sku: '  ' });
  await openAt([{ ...rest, title: 'Widget' }]);
  expect(text('pick-product-name')).toBe('Widget');
  expect(screen.queryByTestId('pick-product-sku')).toBeNull();
  expect(screen.queryByTestId('pick-product-barcode')).toBeNull();
  expect(target()).toBe('LSU-e1161b1e');
});

test.each([
  ['order snapshot populated → snapshot', { sku: 'ORDER-SNAP-1', variant_sku: 'CWB-002' }, 'SKU: ORDER-SNAP-1'],
  ['order snapshot null → current variant SKU', { sku: null, variant_sku: 'CWB-002' }, 'SKU: CWB-002'],
  ['order snapshot blank → current variant SKU (trimmed)', { sku: '  ', variant_sku: ' CWB-002 ' }, 'SKU: CWB-002'],
  ['both unavailable → no SKU line', { sku: null, variant_sku: '' }, null],
])('PI-05 SKU precedence (same as web): %s', async (_l, over, shown) => {
  await openAt([item({ ...over, unit_scan_required: 0 })]);
  if (shown) expect(text('pick-product-sku')).toBe(shown);
  else expect(screen.queryByTestId('pick-product-sku')).toBeNull();
});
