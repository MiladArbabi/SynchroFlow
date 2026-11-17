/**
 * SF-PICK-ASSIGN-01 Correction 007 (REVIEW-005 H-1) — the mobile Pick scan
 * carries the exact reservation_allocation_id of the task on screen, so an
 * allocation-backed batch can be picked. Legacy tasks (no allocation) send none.
 * Harness copied from pick-generation-c003-sf-pick-assign-01 (real PickBriefScreen;
 * transport and offline queue mocked; the body handed to the queue is what is
 * posted live and what is persisted/replayed offline).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { apiClient, offlineQueue } from '@lasyncro/mobile-core';
import PickBriefScreen from '../src/screens/PickBriefScreen';

const BATCH = 'pick0001-0000-4000-8000-000000000001';
const ME = 7;
const OTHER = 9;

const mockNav = { goBack: jest.fn(), navigate: jest.fn() };
const mockSession: {
  initial: { phase: string; phaseData: Record<string, unknown> };
  persisted: { phase: string; phaseData: Record<string, unknown> } | null;
  clears: number;
} = { initial: { phase: 'brief', phaseData: {} }, persisted: null, clears: 0 };
const mockDock: { onResolve: ((raw: string) => Promise<string | void>) | null; hint: string | null } = { onResolve: null, hint: null };

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
      clearSession: async () => { mockSession.persisted = null; mockSession.clears += 1; },
    };
    return React.createElement(Ctx.Provider, { value }, children);
  }
  return {
    Screen: Container, Card: Container, Row: Container, Divider: () => null, AppHeader: () => null,
    NodeTrack: () => null, ProblemSheet: () => null,
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
// One order line split across two locations: two allocations, same line item.
const ALLOC_A = 'a11c0001-0000-4000-8000-00000000000a';
const ALLOC_B = 'a11c0002-0000-4000-8000-00000000000b';
const split = [
  { reservation_allocation_id: ALLOC_A, lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1', sku: 'S1', title: 'Widget', quantity: 2, location_code: 'A-1' },
  { reservation_allocation_id: ALLOC_B, lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1', sku: 'S1', title: 'Widget', quantity: 1, location_code: 'B-2' },
];
// Legacy batch line: the line-items endpoint returns no allocation identity.
const legacy = [{ lasyncro_line_item_id: 'l9', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o9', sku: 'S1', title: 'Widget', quantity: 1, location_code: 'C-3' }];

function serve(items: Record<string, unknown>[]) {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/pick-session')) return { data: { pick_claim_generation: 'gen-7' } };
    if (url.includes('/line-items')) return { data: { line_items: items } };
    return { data: { batches: [{ pick_batch_id: BATCH, status: 'picking', picked_by: ME }] } };
  });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('/barcode/resolve')) return { data: { lasyncro_variant_id: 'v1', lasyncro_unit_id: 'LSU-77' } };
    throw new Error(`unexpected POST ${url}`);
  });
}

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.initial = { phase: 'brief', phaseData: {} };
  mockSession.persisted = null;
  mockSession.clears = 0;
  mockDock.onResolve = null;
  mockDock.hint = null;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());


/** Restored at product_scan for item `index`, its location already confirmed. */
async function scanAt(items: Record<string, unknown>[], index: number) {
  serve(items);
  // C010 (F1): a restored session holds its generation; it is never adopted from pick-session.
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: index, confirmedLocation: items[index].location_code, generation: 'gen-7' } };
  render(<PickBriefScreen />);
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at product barcode'));
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!('EAN-v1'); });
  return result;
}

const sent = () => q.submitScanOnline.mock.calls.map(([entry]) => entry);

test('AS-01 an allocation-backed task sends its exact allocation with the full scan context', async () => {
  expect(await scanAt(split, 0)).toBeUndefined();
  expect(sent()).toHaveLength(1);
  const [entry] = sent();
  expect(entry.url).toBe('/api/v1/wms/pick/scan');
  expect(entry.body).toStrictEqual({
    pick_batch_id:             BATCH,
    lasyncro_line_item_id:     'l1',
    lasyncro_variant_id:       'v1',
    lasyncro_unit_id:          'LSU-77',
    reservation_allocation_id: ALLOC_A,
    location_code:             'A-1',
    quantity_confirmed:        2,
    device_event_id:           entry.deviceEventId,
    scan_source:               'camera',
    pick_claim_generation:     'gen-7',
  });
});

test('AS-02 the second allocation of a split line sends its own allocation, never the first', async () => {
  expect(await scanAt(split, 1)).toBeUndefined();
  const [entry] = sent();
  expect(entry.body.reservation_allocation_id).toBe(ALLOC_B);
  expect(entry.body.location_code).toBe('B-2');
  expect(entry.body.quantity_confirmed).toBe(1);
});

test('AS-03 a legacy task without an allocation sends no allocation identity (none invented)', async () => {
  expect(await scanAt(legacy, 0)).toBeUndefined();
  const [entry] = sent();
  expect(JSON.parse(JSON.stringify(entry.body))).toStrictEqual({
    pick_batch_id:         BATCH,
    lasyncro_line_item_id: 'l9',
    lasyncro_variant_id:   'v1',
    lasyncro_unit_id:      'LSU-77',
    location_code:         'C-3',
    quantity_confirmed:    1,
    device_event_id:       entry.deviceEventId,
    scan_source:           'camera',
    pick_claim_generation: 'gen-7',
  });
});
