/**
 * SF-PICK-ASSIGN-01 C010 (REVIEW-006 F1, R4) — mobile Pick recovery
 * (PickBriefScreen). Harness copied from pick-online-only-screen-c008.
 * Recovery sends the generation this device HOLDS (X-Pick-Claim-Generation);
 * a refusal or a different generation ends the session; nothing is adopted,
 * nothing is claimed. Custody acknowledgement pending survives reconnect.
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


const sessionGets = () => get.mock.calls.filter(([url]) => String(url).endsWith('/pick-session'));
const held = (call: unknown[]) => (call[1] as { headers?: Record<string, string> } | undefined)?.headers?.['X-Pick-Claim-Generation'];
const claims = () => post.mock.calls.filter(([u]) => String(u).endsWith('/claim'));

test('MF1-01 reconnect after A→B→A (B picked nothing): the held generation is refused, session cleared, never taken back', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  await atProductScan();
  await scan();
  pickSession = async () => { throw { response: { status: 409, data: { code: 'PICK_GENERATION_STALE', error: 'stale' } } }; };
  await foreground();
  await waitFor(() => expect(mockSession.clears).toBe(1));
  expect(held(sessionGets()[0])).toBe('gen-7');
  expect(mockSession.persisted).toBeNull();
  expect(claims()).toHaveLength(0);
});

test('MF1-02 same-generation recovery resumes at a fresh location scan with the held generation', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  await atProductScan();
  await scan();
  await foreground();
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at bin barcode'));
  expect(held(sessionGets()[0])).toBe('gen-7');
  expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { generation: 'gen-7' } });
});

test('MF1-03 a 200 carrying a different generation is never adopted', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  await atProductScan();
  await scan();
  pickSession = async () => ({ data: { pick_claim_generation: 'gen-OTHER' } });
  await foreground();
  await waitFor(() => expect(mockSession.clears).toBe(1));
  expect(mockSession.persisted).toBeNull();
  expect(claims()).toHaveLength(0);
});

test('MF1-04 restored session without a held generation cannot adopt one; nothing claimed', async () => {
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1' } };
  mockSession.persisted = { ...mockSession.initial };
  pickSession = async () => ({ data: { pick_claim_generation: 'gen-NEW' } });   // an old server would answer
  await atProductScan();
  await scan();
  expect(q.submitScanOnline).not.toHaveBeenCalled();
  await waitFor(() => expect(mockSession.clears).toBe(1));
  expect(claims()).toHaveLength(0);
});

test('MR4-01 reconnect with custody acknowledgement pending returns to the custody step with the held generation', async () => {
  q.submitScanOnline.mockResolvedValueOnce(LOST);
  await atProductScan();
  await scan();
  pickSession = async () => ({ data: { pick_claim_generation: 'gen-7', custody_ack_required: true } });
  await foreground();
  await waitFor(() => expect(mockSession.persisted?.phase).toBe('custody_ack'));
  expect(mockSession.persisted?.phaseData).toMatchObject({ generation: 'gen-7', confirmedLocation: null });
  expect(claims()).toHaveLength(0);
});
