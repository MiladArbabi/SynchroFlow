/**
 * SF-PICK-LOCATION-TRUTH-01 — Mobile Pick parity (Option B).
 * Labelled units are identified one LSU scan at a time (n of m), submitted
 * together as lasyncro_unit_ids, and recorded only when the server confirms.
 * Never inferred on the device; product-only picking stays for unlabelled
 * stock; warehouse-root stock has no location scan.
 * Harness copied from pick-allocation-scan-c007 (real PickBriefScreen;
 * transport and online-only queue mocked).
 */
import React from 'react';
import { act, fireEvent, renderAsync, waitFor, screen, within } from '@testing-library/react-native';
import { Alert, Modal, Vibration } from 'react-native';
import { apiClient, offlineQueue } from '@lasyncro/mobile-core';
import PickBriefScreen from '../src/screens/PickBriefScreen';
import { ProblemSheet } from '../src/ui/ProblemSheet';

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
    ProblemSheet: jest.requireActual('../src/ui/ProblemSheet').ProblemSheet,
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

const ALLOC = 'a11c0001-0000-4000-8000-00000000000a';
const ROOT = 'WH-1-ROOT';
type Item = Record<string, unknown>;
const item = (over: Item = {}): Item => ({
  reservation_allocation_id: ALLOC, lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1',
  sku: 'S1', title: 'Widget', quantity: 3, location_code: 'A-1',
  location_pickable: true, location_scan_required: true, unit_scan_required: 3, ...over,
});
const NEXT = item({ reservation_allocation_id: 'a11c0002-0000-4000-8000-00000000000b', lasyncro_line_item_id: 'l2', location_code: 'B-2', quantity: 1, unit_scan_required: 0 });

/**
 * Resolver: LSU labels resolve to their exact unit (resolution_method
 * 'unit_barcode', as barcodeResolution.service returns); every other method
 * gets a server-attached unit.
 */
const UNIT = 'unit_barcode';
const UNITS: Record<string, Item> = {
  'LSU-001': { resolution_method: UNIT, lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-001', unit_status: 'stowed', current_location_code: 'A-1' },
  'LSU-002': { resolution_method: UNIT, lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-002', unit_status: 'stowed', current_location_code: 'A-1' },
  'LSU-003': { resolution_method: UNIT, lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-003', unit_status: 'stowed', current_location_code: 'A-1' },
  'LSU-R01': { resolution_method: UNIT, lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-R01', unit_status: 'received', current_location_code: null },
  'LSU-OTHER': { resolution_method: UNIT, lasyncro_variant_id: 'v2', lasyncro_unit_id: 'LSU-OTHER', unit_status: 'stowed', current_location_code: 'A-1' },
  'LSU-GONE': { resolution_method: UNIT, lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-GONE', unit_status: 'picked', current_location_code: null },
  'LSU-FAR': { resolution_method: UNIT, lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-FAR', unit_status: 'stowed', current_location_code: 'Z-9' },
  'EAN-v1': { resolution_method: 'barcode', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-77', unit_status: 'received', current_location_code: null },
  // Fallback lookups that LOOK like unit labels (or are our own product label)
  // but were answered by a non-unit method: the attached LSU-001 was chosen
  // by the server, not scanned.
  'lsu-001': { resolution_method: 'barcode', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-001', unit_status: 'stowed', current_location_code: 'A-1' },
  'LSU-001-SKU': { resolution_method: 'sku', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-001', unit_status: 'stowed', current_location_code: 'A-1' },
  'LSP-v1': { resolution_method: 'product_barcode', lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-001', unit_status: 'stowed', current_location_code: 'A-1' },
};

let lineItems: Item[] = [];
function serve(items: Item[]) {
  lineItems = items;
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/pick-session')) return { data: { pick_claim_generation: 'gen-7' } };
    if (url.includes('/line-items')) return { data: { line_items: lineItems } };
    return { data: { batches: [{ pick_batch_id: BATCH, status: 'picking', picked_by: 7 }] } };
  });
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/barcode/resolve')) {
      const r = UNITS[body.scanned_value];
      if (!r) throw { response: { status: 404, data: { error: 'No variant found for scanned value' } } };
      return { data: r };
    }
    if (url.endsWith('/location/resolve')) return { data: { location_code: body.scanned_value } };
    if (url.endsWith('/exception')) return { data: { pick_exception_id: 'ex-1' } };
    throw new Error(`unexpected POST ${url}`);
  });
}

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.initial = { phase: 'brief', phaseData: {} };
  mockSession.persisted = null;
  mockDock.onResolve = null;
  mockDock.hint = null;
  mockSheet.onReport = null;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
});
afterEach(() => { alert.mockRestore(); jest.restoreAllMocks(); });

/** Restored at `phase` for item 0 with its location already confirmed. */
async function openAt(items: Item[], phase: 'product_scan' | 'location_scan' = 'product_scan') {
  serve(items);
  mockSession.initial = {
    phase,
    phaseData: { currentIndex: 0, confirmedLocation: phase === 'product_scan' ? items[0].location_code : null, generation: 'gen-7' },
  };
  await renderAsync(<PickBriefScreen />);
  await waitFor(() => expect(mockDock.onResolve).not.toBeNull());
}
async function scan(raw: string): Promise<string | void> {
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!(raw, 'hid'); });
  return result;
}
const sent = () => q.submitScanOnline.mock.calls.map(([entry]) => entry);
/** SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — the one verified label, as shown after the scan. */
const verifiedLabel = () => screen.queryByTestId('pick-scan-accepted');
const posts = (suffix: string) => post.mock.calls.filter(([url]) => String(url).endsWith(suffix));


function openProblemSheet() {
  fireEvent.press(screen.getByText('Report problem'));
  fireEvent(screen.UNSAFE_getByType(Modal), 'show');
  fireEvent.press(screen.getByText('Short pick'));
}
function submitProblemSheet() {
  const labels = within(screen.UNSAFE_getByType(Modal)).getAllByText('Report problem');
  fireEvent.press(labels[labels.length - 1]);
}
test('CORRECTIONS-001 — native quantity changes preserve the ProblemSheet instance and current Short Pick default', async () => {
  await openAt([item()]);
  const sheet = screen.UNSAFE_getByType(ProblemSheet);
  await scan('LSU-001');
  expect(screen.UNSAFE_getByType(ProblemSheet)).toBe(sheet);
  openProblemSheet();
  expect(screen.getByText('Quantity affected')).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy(); // required 3 minus scanned/found 1
  expect(sent()).toHaveLength(0);
});
test('CORRECTIONS-001 — real native Short Pick retains identity refusal and rescan instructions, then recovers and retries', async () => {
  await openAt([item(), NEXT]); await scan('LSU-001');
  openProblemSheet();
  const sheet = screen.UNSAFE_getByType(ProblemSheet);
  const failure = jest.fn();
  const originalPost = post.getMockImplementation()!;
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/exception') && failure.mock.calls.length === 0) {
      failure();
      throw { response: { status: 409, data: { code: 'PICK_UNIT_IDENTITY_MISMATCH', error: 'That unit label cannot be picked here.' } } };
    }
    return originalPost(url, body);
  });
  await act(async () => submitProblemSheet());
  expect(await screen.findByText('That unit label cannot be picked here. Close this, scan the unit label on one item you found, then report again. Tap to retry.')).toBeTruthy();
  expect(screen.UNSAFE_getByType(ProblemSheet)).toBe(sheet);
  expect(verifiedLabel()).toBeNull();
  expect(mockSession.persisted).toBeNull();
  expect(sent()).toHaveLength(0);
  await act(async () => fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose'));
  await scan('LSU-002');
  expect(screen.getByTestId('pick-scan-accepted').props.children).toBe('✓ LSU-002');
  openProblemSheet();
  await act(async () => submitProblemSheet());
  const attempts = posts('/exception');
  expect(attempts).toHaveLength(2);
  expect(attempts[0][1]).toMatchObject({ quantity_found: 1, lasyncro_unit_ids: ['LSU-001'] });
  expect(attempts[1][1]).toMatchObject({ quantity_found: 1, lasyncro_unit_ids: ['LSU-002'] });
  expect(posts('/problem-center')).toHaveLength(0);
  expect(mockSession.persisted).toBeNull(); // no progression before successful sheet close
  await act(async () => fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose'));
  await waitFor(() => expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } }));
});
