/**
 * SF-PICK-LOCATION-TRUTH-01 — Mobile Pick parity (Option B).
 * Labelled units: one LSU scan verifies the product/location; the quantity is
 * counted and Confirmed (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001); the
 * scanned label is sent as lasyncro_unit_ids and recorded only when the
 * server confirms.
 * Never inferred on the device; product-only picking stays for unlabelled
 * stock; warehouse-root stock has no location scan.
 * Harness copied from pick-allocation-scan-c007 (real PickBriefScreen;
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
const mockDock: { onResolve: ((raw: string, method?: string) => Promise<string | void>) | null; hint: string | null; hidEnabled?: boolean } = { onResolve: null, hint: null };
const mockSheet: { onReport: ((type: string, qty: number) => Promise<string | void>) | null; onClose?: (() => void) | null } = { onReport: null };

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
    ProblemSheet: ({ onReport, onClose }: any) => { mockSheet.onReport = onReport; mockSheet.onClose = onClose; return null; },
    Badge: ({ label }: any) => React.createElement(Text, null, label),
    Button: ({ label, onPress, disabled }: any) =>
      React.createElement(TouchableOpacity, { onPress, disabled, accessibilityRole: 'button' }, React.createElement(Text, null, label)),
    SessionShell,
    useSession: () => React.useContext(Ctx),
    ScanDock: ({ hint, onResolve, hidEnabled }: any) => {
      mockDock.onResolve = onResolve; mockDock.hint = hint; mockDock.hidEnabled = hidEnabled;
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
  location_pickable: true, location_scan_required: true, unit_scan_required: 3, scan_unit_id: 'LSU-001', ...over, // 3 = stale pre-custody count; clamped to 1
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
});
afterEach(() => alert.mockRestore());

/** Restored at `phase` for item 0 with its location already confirmed. */
async function openAt(items: Item[], phase: 'product_scan' | 'location_scan' = 'product_scan') {
  serve(items);
  mockSession.initial = {
    phase,
    phaseData: { currentIndex: 0, confirmedLocation: phase === 'product_scan' ? items[0].location_code : null, generation: 'gen-7' },
  };
  render(<PickBriefScreen />);
  await waitFor(() => expect(mockDock.onResolve).not.toBeNull());
}
async function scan(raw: string): Promise<string | void> {
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!(raw, 'hid'); });
  return result;
}
const sent = () => q.submitScanOnline.mock.calls.map(([entry]) => entry);
const posts = (suffix: string) => post.mock.calls.filter(([url]) => String(url).endsWith(suffix));
/** SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — the one verified label, as shown after the scan. */
// QUANTITY-UX-001: the verified LSU (green ✓) sits in the card's identifier row.
const verified = (label: string) => {
  const el = screen.queryByTestId('pick-scan-accepted');
  return el && el.props.children === `✓ ${label}` ? el : null;
};
const anyVerified = () => screen.queryByTestId('pick-scan-accepted');

test('ML-01 one LSU verifies (a stale count of 3 is clamped); nothing is sent until the counted quantity is Confirmed; one Pick with that identity', async () => {
  await openAt([item(), NEXT]);
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  // ACTIONABLE-ID-001: the complete server-projected LSU, not a placeholder; display ≠ verification.
  expect(screen.getByTestId('pick-scan-target').props.children).toBe('LSU-001');
  expect(screen.queryByText(/LSU-…|Scan: Unit label/)).toBeNull();
  expect(screen.queryByTestId('pick-label-progress')).toBeNull();
  expect(screen.queryByText(/Scan individual unit labels|Product barcode \(reference\)/)).toBeNull();

  expect(screen.getByText(/^dock:/)).toBeTruthy(); // scanning stage: the scanner (camera + HID) is shown
  expect(await scan('LSU-001')).toBeUndefined();
  expect(verified('LSU-001')).toBeTruthy();
  // SCAN-INPUT-VISIBILITY-001: after the verifying scan the scanner is hidden; only the stepper and Confirm remain.
  expect(screen.queryByText(/^dock:/)).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '2x');
  expect(screen.getByLabelText('Quantity picked').props.value).toBe('2'); // digits only, into the quantity field
  fireEvent.press(screen.getByLabelText('Add one unit'));
  expect(screen.getByLabelText('Quantity picked').props.value).toBe('3');
  fireEvent.press(screen.getByLabelText('Add one unit')); // capped at the required quantity
  expect(screen.getByLabelText('Quantity picked').props.value).toBe('3');
  fireEvent.press(screen.getByLabelText('Remove one unit'));
  expect(screen.getByLabelText('Quantity picked').props.value).toBe('2');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '1');
  expect(screen.queryByTestId('pick-scan-target')).toBeNull(); // the verified LSU replaces the suggestion
  // QUANTITY-UX-001: [ − ] [ n  out of N ] [ + ]; the camera stays, the HID wedge yields the keyboard.
  expect(screen.getByTestId('pick-qty-out-of').props.children).toBe('out of 3');
  expect(screen.getByLabelText('Quantity picked').props.autoFocus).toBe(true);
  expect(screen.getByLabelText('Add one unit')).toBeTruthy();
  expect(screen.getByLabelText('Remove one unit')).toBeTruthy();
  expect(screen.queryByText(/^\d+ of 3$/)).toBeNull();
  expect(screen.getByLabelText('Quantity picked').props.value).toBe('1');
  expect(sent()).toHaveLength(0); // never updated optimistically

  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '3');
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (3)')); });
  expect(sent()).toHaveLength(1);
  const [entry] = sent();
  expect(JSON.parse(JSON.stringify(entry.body))).toStrictEqual({
    pick_batch_id:             BATCH,
    lasyncro_line_item_id:     'l1',
    lasyncro_variant_id:       'v1',
    lasyncro_unit_ids:         ['LSU-001'],
    reservation_allocation_id: ALLOC,
    location_code:             'A-1',
    quantity_confirmed:        3,
    device_event_id:           entry.deviceEventId,
    scan_source:               'hid',
    pick_claim_generation:     'gen-7',
  });
  // Advanced only after the server confirmed: next stop, fresh location scan.
  await waitFor(() => expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } }));
});

test('ML-02 product, wrong-product and elsewhere-stowed scans are refused and never counted or sent; after the one label, further scans add nothing', async () => {
  await openAt([item()]);
  expect(await scan('EAN-v1')).toBe('Scan the unit label (LSU-…) on the item.');
  expect(await scan('LSU-OTHER')).toBe('Wrong item — this label is another product.');
  expect(await scan('LSU-FAR')).toMatch(/^This unit is stowed in Z-9, not here\./);
  expect(await scan('LSU-404')).toBe('No variant found for scanned value'); // existing 404 copy
  expect(anyVerified()).toBeNull();
  expect(screen.queryByText(/Confirm pick/)).toBeNull();
  expect(sent()).toHaveLength(0);
  expect(await scan('LSU-001')).toBeUndefined();
  for (const raw of ['LSU-001', 'LSU-002', 'LSU-R01', 'EAN-v1']) {
    expect(await scan(raw)).toBe('All labels are scanned. Tap Confirm pick.');
  }
  expect(verified('LSU-001')).toBeTruthy();
  expect(sent()).toHaveLength(0);
});

test('ML-03 a server identity refusal records nothing: the label is cleared, the count is re-read, and the retry reuses the same scan identity', async () => {
  await openAt([item(), NEXT]);
  await scan('LSU-001');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '3');
  q.submitScanOnline.mockResolvedValueOnce({
    status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH', error: 'That unit label cannot be picked here. Scan another label.',
  });
  const lineReadsBefore = get.mock.calls.filter(([u]) => String(u).includes('/line-items')).length;
  lineItems = [item({ unit_scan_required: 1 }), NEXT];
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (3)')); });

  expect(screen.getByText('That unit label cannot be picked here. Scan another label. Label cleared — scan the unit label again.')).toBeTruthy();
  expect(get.mock.calls.filter(([u]) => String(u).includes('/line-items')).length).toBe(lineReadsBefore + 1);
  expect(anyVerified()).toBeNull();
  expect(mockSession.persisted).toBeNull(); // no advance

  await scan('LSU-002');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '3');
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (3)')); });
  const [refused, retried] = sent();
  expect(retried.body.lasyncro_unit_ids).toEqual(['LSU-002']);
  expect(retried.deviceEventId).toBe(refused.deviceEventId);
  await waitFor(() => expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } }));
});

test('ML-04 Short Pick (Difference) carries the one scanned label for the found units', async () => {
  await openAt([item()]);
  await scan('LSU-001');
  // ProblemSheet "quantity affected" = 1 → found 2.
  let msg: string | void = 'unset';
  await act(async () => { msg = await mockSheet.onReport!('short_pick', 1); });
  expect(msg).toBeUndefined();
  const [[, body]] = posts('/exception');
  expect(body).toMatchObject({
    exception_type: 'short_pick', quantity_required: 3, quantity_found: 2,
    reservation_allocation_id: ALLOC, lasyncro_unit_ids: ['LSU-001'],
  });
  expect(sent()).toHaveLength(0);
});

test('ML-04b a scanned label means a unit is in hand: reporting every unit affected is refused before any request', async () => {
  await openAt([item()]);
  await scan('LSU-001');
  let msg: string | void = 'unset';
  await act(async () => { msg = await mockSheet.onReport!('short_pick', 3); });
  expect(msg).toBe('You scanned 1 label. Report at most 2 affected.');
  expect(posts('/exception')).toHaveLength(0);
});

test('ML-05 a server label refusal on Short Pick re-reads the count and nothing is recorded', async () => {
  await openAt([item({ unit_scan_required: 0 })]);
  lineItems = [item({ unit_scan_required: 1 })];
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/exception')) {
      throw { response: { status: 409, data: { code: 'PICK_UNIT_IDENTITY_REQUIRED', error: 'Scan the unit label on one item.', units_required: 1 } } };
    }
    if (url.endsWith('/barcode/resolve')) return { data: UNITS[body.scanned_value] };
    throw new Error(url);
  });
  let msg: string | void = 'unset';
  await act(async () => { msg = await mockSheet.onReport!('short_pick', 2); });
  expect(msg).toBe('Scan the unit label on one item. Close this, scan the unit label on one item you found, then report again.');
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  expect(anyVerified()).toBeNull();
});

test('ML-06 product-only opening inventory at the warehouse root: no location scan, one product scan picks, and no server-attached unit is sent', async () => {
  await openAt([item({ location_code: ROOT, location_scan_required: false, unit_scan_required: 0, quantity: 2 })], 'location_scan');
  await waitFor(() => expect(mockSession.persisted).toMatchObject({ phase: 'product_scan', phaseData: { currentIndex: 0 } }));
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at product barcode'));
  expect(posts('/location/resolve')).toHaveLength(0);
  expect(screen.getAllByText('Not in a bin').length).toBeGreaterThan(0);

  expect(await scan('EAN-v1')).toBeUndefined();
  expect(sent()).toHaveLength(0);
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '2');
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (2)')); });
  const [entry] = sent();
  expect(entry.body).toMatchObject({ location_code: ROOT, quantity_confirmed: 2, lasyncro_unit_id: null });
  expect(entry.body).not.toHaveProperty('lasyncro_unit_ids');
});

test('ML-07 root received LSU, single unit: the label scan auto-confirms the pick', async () => {
  await openAt([item({ location_code: ROOT, location_scan_required: false, unit_scan_required: 1, quantity: 1 })], 'location_scan');
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  expect(await scan('LSU-R01')).toBeUndefined();
  const [entry] = sent();
  expect(entry.body).toMatchObject({ location_code: ROOT, quantity_confirmed: 1, lasyncro_unit_ids: ['LSU-R01'] });
  expect(entry.body).not.toHaveProperty('lasyncro_unit_id');
});

test('ML-08 mixed stock: the labelled unit is named, the remainder is confirmed explicitly — one Pick for the full quantity', async () => {
  await openAt([item({ unit_scan_required: 1, quantity: 3 })]);
  expect(await scan('LSU-001')).toBeUndefined();
  expect(sent()).toHaveLength(0);
  expect(verified('LSU-001')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '3');
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (3)')); });
  const [entry] = sent();
  expect(entry.body).toMatchObject({ quantity_confirmed: 3, lasyncro_unit_ids: ['LSU-001'] });
});

test('ML-09 a stop that is not a pick bin fails closed before any location lookup', async () => {
  await openAt([item({ location_code: 'ZONE-A', location_pickable: false })], 'location_scan');
  let msg: string | void = 'unset';
  await act(async () => { msg = await mockDock.onResolve!('ZONE-A'); });
  expect(msg).toBe('ZONE-A is not a pick bin. Stow this stock into a pick bin, then use Report problem.');
  expect(posts('/location/resolve')).toHaveLength(0);
});

test('ML-10 a lost connection on Confirm pauses Picking, keeps the label and records nothing', async () => {
  await openAt([item()]);
  await scan('LSU-001');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '3');
  q.submitScanOnline.mockResolvedValueOnce({ status: 0, code: 'PICK_CONNECTION_LOST', error: 'offline' });
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (3)')); });
  expect(screen.getByText('No connection — this scan was not recorded.')).toBeTruthy();
  expect(screen.getByText('Connection lost')).toBeTruthy();
  expect(verified('LSU-001')).toBeTruthy();
  expect(mockSession.persisted).toBeNull();
});

test('ML-11 a fallback (EAN/SKU/LSP) resolution never yields a unit identity, even when the scan looks like an LSU label', async () => {
  // Stop 1 — product-only: the LSU-looking fallback scan picks product-only;
  // the server-attached LSU-001 is never sent.
  const productOnly = item({ unit_scan_required: 0, quantity: 2 });
  const labelled = item({ reservation_allocation_id: 'a11c0003-0000-4000-8000-00000000000c', lasyncro_line_item_id: 'l3', location_code: 'C-3' });
  await openAt([productOnly, labelled]);
  expect(await scan('lsu-001')).toBeUndefined();
  expect(sent()).toHaveLength(0);
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '2');
  await act(async () => { fireEvent.press(screen.getByText('Confirm pick (2)')); });
  const [entry] = sent();
  expect(entry.body).toMatchObject({ location_code: 'A-1', quantity_confirmed: 2, lasyncro_unit_id: null });
  expect(entry.body).not.toHaveProperty('lasyncro_unit_ids');

  // Stop 2 — labelled: no fallback answer is counted as a label.
  await waitFor(() => expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } }));
  await act(async () => { await mockDock.onResolve!('C-3'); });
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  for (const raw of ['lsu-001', 'LSU-001-SKU', 'LSP-v1']) {
    expect(await scan(raw)).toBe('Scan the unit label (LSU-…) on the item.');
  }
  expect(anyVerified()).toBeNull();
  expect(sent()).toHaveLength(1); // only stop 1
});

test('ML-12 a settled-by-quantity (picked) LSU is not refused on the device: the server alone reverifies or refuses it', async () => {
  await openAt([item({ quantity: 1, unit_scan_required: 1 })]);
  expect(await scan('LSU-GONE')).toBeUndefined();
  const [entry] = sent();
  expect(entry.body).toMatchObject({ quantity_confirmed: 1, lasyncro_unit_ids: ['LSU-GONE'] });
});

test('MA-01 one label reveals the count; a count above the quantity fails closed and sends nothing', async () => {
  await openAt([item()]); await scan('LSU-001');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '4');
  await act(async () => fireEvent.press(screen.getByText('Confirm pick (3)')));
  expect(screen.getByText(/Enter a whole quantity/)).toBeTruthy();
  expect(sent()).toHaveLength(0);
});
test('MA-02 mixed count below scanned labels fails closed, corrected count can confirm', async () => {
  await openAt([item({ unit_scan_required: 1 })]); await scan('LSU-001');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '0');
  await act(async () => fireEvent.press(screen.getByText('Report 0 of 3')));
  expect(screen.getByText(/Enter a whole quantity/)).toBeTruthy();
  expect(sent()).toHaveLength(0);
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '3');
  await act(async () => fireEvent.press(screen.getByText('Confirm pick (3)')));
  expect(sent()[0].body.lasyncro_unit_ids).toEqual(['LSU-001']);
});
test('MA-03 product-only quantity one remains auto-confirmed without a count', async () => {
  await openAt([item({ quantity: 1, unit_scan_required: 0 })]); await scan('EAN-v1');
  expect(sent()).toHaveLength(1);
  expect(sent()[0].body).toMatchObject({ quantity_confirmed: 1, lasyncro_unit_id: null });
});
test('MA-04 multi-unit product confirms only after a server answer', async () => {
  let accept!: () => void;
  q.submitScanOnline.mockImplementationOnce(() => new Promise<void>(r => { accept = r; }));
  await openAt([item({ quantity: 2, unit_scan_required: 0 }), NEXT]); await scan('EAN-v1');
  fireEvent.changeText(screen.getByLabelText('Quantity picked'), '2');
  act(() => fireEvent.press(screen.getByText('Confirm pick (2)')));
  await waitFor(() => expect(q.submitScanOnline).toHaveBeenCalledTimes(1));
  expect(mockSession.persisted).toBeNull();
  await act(async () => accept());
  await waitFor(() => expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } }));
});

// ── SF-PICK-UX-ADAPTIVE-01-FINALIZE-001 — one final "Pick complete" screen ────────────────
const completeCalls = () => post.mock.calls.filter(([url]) => String(url).endsWith('/pick-complete'));
function answerPickComplete(...answers: Array<'ok' | 'network' | 'already' | { status: number; data: any }>) {
  const base = post.getMockImplementation()!;
  let i = 0;
  post.mockImplementation(async (url: string, body: any) => {
    if (!String(url).endsWith('/pick-complete')) return base(url, body);
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a === 'ok') return { data: { pick_batch_id: BATCH, status: 'pick_complete' } };
    if (a === 'network') throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    if (a === 'already') throw { response: { status: 409, data: { code: 'PICK_BATCH_NOT_PICKING', status: 'pick_complete', error: 'Batch not in picking status: pick_complete' } } };
    throw { response: a };
  });
}
const lastItemRoot = () => item({ location_code: ROOT, location_scan_required: false, unit_scan_required: 1, quantity: 1, scan_unit_id: 'LSU-R01' });

test('FN-01 last item confirmed → pick-complete is called automatically once → "Pick complete" with truthful totals; no intermediate screen', async () => {
  await openAt([lastItemRoot()], 'location_scan');
  answerPickComplete('ok');
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  expect(await scan('LSU-R01')).toBeUndefined();
  await waitFor(() => expect(screen.getByText('Pick complete')).toBeTruthy());
  expect(completeCalls()).toHaveLength(1);
  expect(completeCalls()[0][1]).toMatchObject({ pick_claim_generation: 'gen-7' });
  expect(screen.queryByText(/All items picked|Review and mark complete|Complete pick$/)).toBeNull();
  expect(screen.getByTestId('pick-complete-totals').props.children).toBe('Picked 1 · Short 0 · Flagged 0');
  expect(screen.getByText('Return to Operations')).toBeTruthy();
});

test('FN-02 failed finalization → recoverable error, no success, one call; Retry → success', async () => {
  await openAt([lastItemRoot()], 'location_scan');
  answerPickComplete({ status: 500, data: { error: 'Pick complete failed: boom' } }, 'ok');
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  await scan('LSU-R01');
  await waitFor(() => expect(screen.getByText('Pick complete failed: boom')).toBeTruthy());
  expect(screen.queryByText('Pick complete')).toBeNull();
  expect(completeCalls()).toHaveLength(1);
  await act(async () => { fireEvent.press(screen.getByText('Retry finishing pick')); });
  await waitFor(() => expect(screen.getByText('Pick complete')).toBeTruthy());
  expect(completeCalls()).toHaveLength(2);
});

test('FN-03 uncertain answer → Retry answered "already pick_complete" by the server → Pick complete (committed outcome); never on a different refusal', async () => {
  await openAt([lastItemRoot()], 'location_scan');
  answerPickComplete('network', 'already');
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  await scan('LSU-R01');
  await waitFor(() => expect(screen.getByText('Retry finishing pick')).toBeTruthy());
  expect(screen.queryByText('Pick complete')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByText('Retry finishing pick')); });
  await waitFor(() => expect(screen.getByText('Pick complete')).toBeTruthy());
  expect(completeCalls()).toHaveLength(2);
});

test('FN-04 Short Pick outcome stays truthful on the final screen', async () => {
  await openAt([item({ location_code: ROOT, location_scan_required: false, unit_scan_required: 1, quantity: 3 })], 'location_scan');
  answerPickComplete('ok');
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at unit label'));
  await scan('LSU-R01');
  let msg: string | void = 'unset';
  await act(async () => { msg = await mockSheet.onReport!('short_pick', 1); }); // found 2 of 3
  expect(msg).toBeUndefined();
  expect(completeCalls()).toHaveLength(0); // not finalized while the sheet is still open
  await act(async () => { mockSheet.onClose!(); }); // operator closes the sheet → advance → finalize
  await waitFor(() => expect(screen.getByText('Pick complete')).toBeTruthy());
  expect(screen.getByTestId('pick-complete-totals').props.children).toBe('Picked 2 · Short 1 · Flagged 1');
  expect(screen.getByTestId('pick-pack-readiness').props.children[0]).toMatch(/1 item reported — routed to Problem Center/);
  expect(completeCalls()).toHaveLength(1);
});
