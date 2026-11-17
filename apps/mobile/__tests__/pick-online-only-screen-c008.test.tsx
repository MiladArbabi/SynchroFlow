/**
 * SF-PICK-ASSIGN-01 C008 — online-only mobile Pick (PickBriefScreen).
 * Harness copied from pick-allocation-scan-c007 (real screen; transport and
 * offline-queue module mocked). The screen must:
 *   - advance only on the server's confirmation (submitScanOnline → undefined);
 *   - on PICK_CONNECTION_LOST stay on the same step, show "Connection lost",
 *     and never use the offline queue;
 *   - recover automatically: re-read ownership (read-only pick-session) and the
 *     authoritative remaining work, then resume at a fresh location scan;
 *   - show "Batch reassigned" when ownership changed while disconnected;
 *   - reuse the scan identity when the same task is retried;
 *   - send one confirmation for rapid duplicate scans.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { apiClient, offlineQueue } from '@lasyncro/mobile-core';
import PickBriefScreen from '../src/screens/PickBriefScreen';

const BATCH = 'pick0001-0000-4000-8000-000000000001';
const ME = 7;

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
    enqueue: jest.fn(async () => {}),
    submitScan: jest.fn(async () => undefined),
    submitScanWithDetail: jest.fn(async () => undefined),
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

const ALLOC_A = 'a11c0001-0000-4000-8000-00000000000a';
const ALLOC_B = 'a11c0002-0000-4000-8000-00000000000b';
const itemA = { reservation_allocation_id: ALLOC_A, lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1', sku: 'S1', title: 'Widget', quantity: 1, location_code: 'A-1' };
const itemB = { reservation_allocation_id: ALLOC_B, lasyncro_line_item_id: 'l2', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1', sku: 'S1', title: 'Widget', quantity: 1, location_code: 'B-2' };

const LOST = { status: 0, code: 'PICK_CONNECTION_LOST', error: 'No connection — this scan was not recorded.' };

let lineItems: Record<string, unknown>[] = [itemA, itemB];
let pickSession: () => Promise<unknown> = async () => ({ data: { pick_claim_generation: 'gen-7' } });

function serve() {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/pick-session')) return pickSession();
    if (url.includes('/line-items')) return { data: { line_items: lineItems } };
    return { data: { batches: [{ pick_batch_id: BATCH, status: 'picking', picked_by: ME }] } };
  });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('/barcode/resolve')) return { data: { lasyncro_variant_id: 'v1' } };
    if (url.endsWith('/location/resolve')) return { data: { location_code: 'A-1' } };
    throw new Error(`unexpected POST ${url}`);
  });
}

let appStateHandlers: Array<(s: string) => void> = [];
let alert: jest.SpyInstance;
let appStateSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  lineItems = [itemA, itemB];
  pickSession = async () => ({ data: { pick_claim_generation: 'gen-7' } });
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1', generation: 'gen-7' } };
  mockSession.persisted = { ...mockSession.initial };
  mockSession.clears = 0;
  mockDock.onResolve = null;
  mockDock.hint = null;
  appStateHandlers = [];
  appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
    appStateHandlers.push(fn);
    return { remove: () => { appStateHandlers = appStateHandlers.filter((h) => h !== fn); } };
  }) as never);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  serve();
});
afterEach(() => { alert.mockRestore(); appStateSpy.mockRestore(); });

async function atProductScan() {
  const view = render(<PickBriefScreen />);
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at product barcode'));
  return view;
}
async function scan(value = 'EAN-v1') {
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!(value); });
  return result;
}
async function foreground() {
  await act(async () => { for (const h of [...appStateHandlers]) h('active'); });
}

test('OS-01 online: a confirmed scan advances; the allocation travels; the offline queue is never used', async () => {
  await atProductScan();
  expect(await scan()).toBeUndefined();
  expect(q.submitScanOnline).toHaveBeenCalledTimes(1);
  const [entry] = q.submitScanOnline.mock.calls[0];
  expect(entry.body).toMatchObject({ pick_batch_id: BATCH, reservation_allocation_id: ALLOC_A, pick_claim_generation: 'gen-7', quantity_confirmed: 1 });
  expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1, confirmedLocation: null } });
  expect(q.submitScanWithDetail).not.toHaveBeenCalled();
  expect(q.submitScan).not.toHaveBeenCalled();
  expect(q.enqueue).not.toHaveBeenCalled();
});

test('OS-02 connection lost: the item does not advance, nothing is queued, the paused state is shown once (no alert)', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  const view = await atProductScan();
  const result = await scan();
  expect(result).toMatch(/not recorded/i);
  expect(mockSession.persisted).toMatchObject({ phase: 'product_scan', phaseData: { currentIndex: 0 } });
  expect(view.getByText('Connection lost')).toBeTruthy();
  expect(view.getByText('Picking is paused. Your confirmed progress is saved.')).toBeTruthy();
  expect(view.getByText('Waiting for connection…')).toBeTruthy();
  expect(q.enqueue).not.toHaveBeenCalled();
  expect(q.submitScanWithDetail).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test('OS-03 while paused a scan is never sent or treated as confirmed', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  pickSession = async () => { throw new Error('Network Error'); };     // still disconnected
  await atProductScan();
  await scan();
  const again = await scan();
  expect(again).toMatch(/paused|connection/i);
  expect(q.submitScanOnline).toHaveBeenCalledTimes(1);
  expect(mockSession.persisted).toMatchObject({ phase: 'product_scan', phaseData: { currentIndex: 0 } });
});

test('OS-04 a barcode lookup with no answer also pauses Picking (scanner input is never confirmed offline)', async () => {
  const view = await atProductScan();
  post.mockImplementation(async (url: string) => { if (url.endsWith('/barcode/resolve')) throw new Error('Network Error'); return { data: {} }; });
  await scan();
  expect(view.getByText('Connection lost')).toBeTruthy();
  expect(q.submitScanOnline).not.toHaveBeenCalled();
});

test('OS-05 reconnect: ownership re-read (read-only), remaining work reloaded, resume at a fresh location scan', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  pickSession = async () => { throw new Error('Network Error'); };
  const view = await atProductScan();
  await scan();
  await foreground();                                                     // still down: stays paused
  expect(view.getByText('Connection lost')).toBeTruthy();

  // Back online. The lost scan WAS committed: the server no longer lists task A.
  pickSession = async () => ({ data: { pick_claim_generation: 'gen-7' } });
  lineItems = [itemB];
  await foreground();
  await waitFor(() => expect(view.queryByText('Connection lost')).toBeNull());
  expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 0, confirmedLocation: null, generation: 'gen-7' } });
  expect(post.mock.calls.filter(([u]) => String(u).endsWith('/claim'))).toHaveLength(0);   // never claims
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at bin barcode'));
});

test('OS-06 ownership changed while disconnected: reconnect shows "Batch reassigned", clears the session, never takes the batch back', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  await atProductScan();
  await scan();
  pickSession = async () => { throw { response: { status: 409, data: { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' } } }; };
  await foreground();
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === 'Batch reassigned')).toBe(true));
  expect(mockSession.clears).toBe(1);
  expect(mockSession.persisted).toBeNull();
  expect(post.mock.calls.filter(([u]) => String(u).endsWith('/claim'))).toHaveLength(0);
});

test('OS-07 lost response retried on the same task reuses its scan identity and advances only on the server answer', async () => {
  q.submitScanOnline.mockResolvedValueOnce({ status: 503, code: null, error: 'Service unavailable' });   // answer, not a disconnect
  await atProductScan();
  expect(await scan()).toMatch(/Service unavailable/);
  expect(mockSession.persisted).toMatchObject({ phase: 'product_scan', phaseData: { currentIndex: 0 } });
  q.submitScanOnline.mockResolvedValueOnce(undefined);                   // e.g. ALREADY_RECORDED for me → confirmed
  expect(await scan()).toBeUndefined();
  const [first, second] = q.submitScanOnline.mock.calls.map(([e]) => e);
  expect(second.deviceEventId).toBe(first.deviceEventId);
  expect(second.body.device_event_id).toBe(first.body.device_event_id);
  expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } });
});

test('OS-08 rapid duplicate scans send one confirmation and advance once', async () => {
  let release: (v?: unknown) => void = () => {};
  q.submitScanOnline.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  await atProductScan();
  let a: Promise<string | void> = Promise.resolve();
  let b: Promise<string | void> = Promise.resolve();
  await act(async () => {
    a = mockDock.onResolve!('EAN-v1');
    b = mockDock.onResolve!('EAN-v1');
    await Promise.resolve();
  });
  await act(async () => { release(undefined); await a; await b; });
  expect(q.submitScanOnline).toHaveBeenCalledTimes(1);
  expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { currentIndex: 1 } });
});
