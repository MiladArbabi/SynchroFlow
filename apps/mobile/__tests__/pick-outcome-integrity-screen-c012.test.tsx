/**
 * SF-PICK-ASSIGN-01 C012 (OUTCOME-INTEGRITY) — PickBriefScreen review copy.
 *   - a scan whose 5xx retries ran out may already be recorded: the operator is
 *     never told to scan it again, and is pointed to the supervisor;
 *   - a review that fails part-way says how many were removed and how many are
 *     kept (never "the scans are kept" after some were removed);
 *   - a repeated server failure says when the supervisor must step in.
 * The offline queue is the mocked boundary (same harness as MR-* / MP-*).
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { apiClient, offlineQueue } from '@lasyncro/mobile-core';
import PickBriefScreen from '../src/screens/PickBriefScreen';

const BATCH = 'pick0001-0000-4000-8000-000000000001';

const mockNav = { goBack: jest.fn(), navigate: jest.fn() };
const mockSession = {
  initial: { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1', generation: 'gen-1' } as Record<string, unknown> },
};

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
      setPhase: async (p: string, d: Record<string, unknown> = {}) => { setPhaseState(p); setPhaseData(d); },
      clearSession: async () => {},
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
    ScanDock: ({ hint }: any) => React.createElement(Text, null, `dock:${hint}`),
  };
});

const get = apiClient.get as jest.Mock;
const q = offlineQueue as unknown as Record<string, jest.Mock>;
const line = { lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1', sku: 'S1', title: 'Widget', quantity: 1, location_code: 'A-1' };
const base = { url: '/api/v1/wms/pick/scan', body: { pick_batch_id: BATCH }, rejectedAt: 1 };
const exhausted = { ...base, deviceEventId: 'srv', status: 503, code: null, error: 'Service unavailable', reason: 'server_error_retries_exhausted' };
const stale = { ...base, deviceEventId: 'stale', status: 409, code: 'PICK_GENERATION_STALE', error: 'x', reason: 'refused' };

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation(async (url: string) =>
    url.includes('/line-items')
      ? { data: { line_items: [line] } }
      : { data: { batches: [{ pick_batch_id: BATCH, status: 'picking', picked_by: 7 }] } });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

async function openReview(entries: unknown[]) {
  q.getRejected.mockResolvedValue(entries);
  const n = entries.length;
  const title = `${n} scan${n > 1 ? 's need' : ' needs'} review`;
  const view = render(<PickBriefScreen />);
  fireEvent.press(await view.findByText(`${title} — tap to review`));
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === title)).toBe(true));
  return { view, call: alert.mock.calls.find(([t]) => t === title)! };
}
const pressDismiss = (call: unknown[]) =>
  (call[2] as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === 'Reviewed — dismiss')!.onPress!();
const failure = (kind: string) => Object.assign(new Error('review failed'), { code: 'PICK_REVIEW_NOT_RECORDED', kind });

test('MS-01 a scan whose server retries ran out is never re-scanned: it may already be recorded; the supervisor checks it', async () => {
  const { call } = await openReview([exhausted]);
  const lines = String(call[1]).split('\n').filter((l: string) => l.startsWith('•'));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/may already be recorded/);
  expect(lines[0]).toMatch(/do not re-scan/i);
  expect(lines[0]).toMatch(/supervisor/);
  expect(String(call[1])).not.toMatch(/scan (the item|it) again/i);
});

test('MS-02 a review that fails part-way says how many were removed and how many are kept', async () => {
  q.dismissRejected.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure('offline'));
  const { call } = await openReview([stale, exhausted]);
  q.getRejected.mockResolvedValue([exhausted]);
  pressDismiss(call);
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === 'Review not recorded')).toBe(true));
  const [, message] = alert.mock.calls.find(([t]) => t === 'Review not recorded')!;
  expect(String(message)).toMatch(/1 of 2.*removed/s);
  expect(String(message)).toMatch(/other 1.*kept on this phone/s);
  expect(String(message)).not.toMatch(/the scans are kept/i);
  expect(q.dismissRejected.mock.calls.map(([id]) => id)).toEqual(['stale', 'srv']);
});

test('MS-03 a server-side review failure tells the operator when to involve the supervisor', async () => {
  q.dismissRejected.mockRejectedValueOnce(failure('server'));
  const { call } = await openReview([exhausted]);
  pressDismiss(call);
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === 'Review not recorded')).toBe(true));
  const [, message] = alert.mock.calls.find(([t]) => t === 'Review not recorded')!;
  expect(String(message)).toMatch(/kept on this phone/);
  expect(String(message)).toMatch(/keeps failing.*supervisor/s);
});
