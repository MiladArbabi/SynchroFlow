/**
 * SF-PICK-ASSIGN-01 C012 (FINAL-CLOSURE, LOW-2) — PickBriefScreen: when the
 * phone's own storage fails during a dismissal (for example the server
 * recorded the review but removing the scan locally failed — a
 * QueueStorageError, which carries no review `kind`), the operator is told the
 * scan is still on the phone and the phone could not finish — never that the
 * review was not recorded, and never to re-scan.
 * Harness identical to pick-outcome-integrity-screen-c012 (MS-*).
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
const storageError = () => Object.assign(new Error('Offline queue write failed'), { name: 'QueueStorageError', op: 'write' });

async function failureAlert() {
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === 'Scan kept on this phone')).toBe(true));
  expect(alert.mock.calls.find(([t]) => t === 'Review not recorded')).toBeUndefined();
  return String(alert.mock.calls.find(([t]) => t === 'Scan kept on this phone')![1]);
}

test('MS-L1 a local storage failure says the scan is kept and the phone could not finish — not "review not recorded", no re-scan', async () => {
  q.dismissRejected.mockRejectedValueOnce(storageError());
  const { call } = await openReview([exhausted]);
  pressDismiss(call);
  const message = await failureAlert();
  expect(message).toMatch(/kept on this phone/);
  expect(message).toMatch(/could not finish/);
  expect(message).toMatch(/supervisor/);
  expect(message).toMatch(/Do not re-scan/);
  expect(message).not.toMatch(/review (was not|could not be) recorded/i);
  expect(message).not.toMatch(/scan (the item|it) again/i);
});

test('MS-L2 a local failure part-way says how many were removed and how many are kept', async () => {
  q.dismissRejected.mockResolvedValueOnce(undefined).mockRejectedValueOnce(storageError());
  const { call } = await openReview([stale, exhausted]);
  pressDismiss(call);
  const message = await failureAlert();
  expect(message).toMatch(/1 of 2.*removed/s);
  expect(message).toMatch(/other 1.*kept on this phone/s);
});
