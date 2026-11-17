/**
 * SF-PICK-ASSIGN-01 C011 (NEW-1) — PickBriefScreen review of historical scans.
 * Uncertain scans (fence refusal, pre-generation, server-reported uncertain)
 * are never described as "not recorded"; dismissing goes through the queue's
 * audited review and a failed review keeps the scans and says what to do.
 * The offline queue is the mocked boundary (same harness as MP-*).
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
const base = { url: '/api/v1/wms/pick/scan', body: { pick_batch_id: BATCH }, rejectedAt: 1, status: 409, error: 'x' };
const uncertain = [
  { ...base, deviceEventId: 'stale', code: 'PICK_GENERATION_STALE', reason: 'refused' },
  { ...base, deviceEventId: 'old', status: 0, code: 'PICK_SCAN_UNCONFIRMED_HISTORICAL', reason: 'outcome_uncertain' },
];

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation(async (url: string) =>
    url.includes('/line-items')
      ? { data: { line_items: [line] } }
      : { data: { batches: [{ pick_batch_id: BATCH, status: 'picking', picked_by: 7 }] } });
  q.getRejected.mockResolvedValue(uncertain);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

async function openReview() {
  const view = render(<PickBriefScreen />);
  fireEvent.press(await view.findByText('2 scans need review — tap to review'));
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === '2 scans need review')).toBe(true));
  return { view, call: alert.mock.calls.find(([t]) => t === '2 scans need review')! };
}

test('MR-01 uncertain historical scans are never described as "not recorded"', async () => {
  const { view, call } = await openReview();
  const [title, message] = call;
  expect(`${title}\n${message}`).not.toMatch(/not recorded/i);
  const lines = String(message).split('\n').filter((l: string) => l.startsWith('•'));
  expect(lines).toHaveLength(2);
  for (const l of lines) {
    expect(l).toMatch(/may already be recorded/);
    expect(l).toMatch(/do not re-scan/);
  }
  expect(view.queryByText(/not recorded/i)).toBeNull();
});

test('MR-02 "Reviewed — dismiss" removes each scan through the queue (which audits it first)', async () => {
  const { call } = await openReview();
  const buttons = call[2] as Array<{ text: string; onPress?: () => void }>;
  q.getRejected.mockResolvedValue([]);
  buttons.find((b) => b.text === 'Reviewed — dismiss')!.onPress!();
  await waitFor(() => expect(q.dismissRejected).toHaveBeenCalledTimes(2));
  expect(q.dismissRejected.mock.calls.map(([id]) => id)).toEqual(['stale', 'old']);
  expect(alert.mock.calls.find(([t]) => t === 'Review not recorded')).toBeUndefined();
});

test('MR-03 a review that cannot be recorded keeps the scans and tells the operator what to do', async () => {
  for (const [kind, expected] of [
    ['offline', /No connection.*kept on this phone.*Try again when connected/s],
    ['auth', /Sign in again.*kept on this phone/s],
    ['server', /could not be recorded.*kept on this phone.*Try again/s],
  ] as const) {
    alert.mockClear();
    q.dismissRejected.mockReset();
    q.dismissRejected.mockRejectedValueOnce(Object.assign(new Error('review failed'), { code: 'PICK_REVIEW_NOT_RECORDED', kind }));
    const { view, call } = await openReview();
    (call[2] as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === 'Reviewed — dismiss')!.onPress!();
    await waitFor(() => expect(alert.mock.calls.some(([t]) => t === 'Review not recorded')).toBe(true));
    const [, message] = alert.mock.calls.find(([t]) => t === 'Review not recorded')!;
    expect(String(message)).toMatch(expected);
    expect(q.dismissRejected).toHaveBeenCalledTimes(1);        // stopped at the first failure
    view.unmount();
  }
});
