/**
 * SF-PICK-ASSIGN-01 — mobile Pick ownership UX on the real PickBriefScreen.
 * The session shell is a stateful stand-in that records what the screen would
 * persist, so "stale session/location cleared" is asserted on the persisted
 * snapshot itself. Network and offline queue are the mocked boundary.
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
const line = { lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_order_id: 'o1', sku: 'S1', title: 'Widget', quantity: 1, location_code: 'A-1' };

function serve(batch: Record<string, unknown>) {
  get.mockImplementation(async (url: string) =>
    url.includes('/line-items')
      ? { data: { line_items: [line, { ...line, lasyncro_line_item_id: 'l2', location_code: 'B-2' }] } }
      : { data: { batches: [{ pick_batch_id: BATCH, ...batch }] } });
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

test('MP-01 revocation blocks the session, clears the stored session and location, and keeps rejected scans', async () => {
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1', generation: 'gen-1' } };
  mockSession.persisted = { ...mockSession.initial };
  serve({ status: 'picking', picked_by: ME });
  q.getRejected.mockResolvedValue([{ deviceEventId: 'old', url: '/api/v1/wms/pick/scan', body: { pick_batch_id: BATCH }, status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator', rejectedAt: 1 }]);
  post.mockResolvedValue({ data: { lasyncro_variant_id: 'v1' } });            // barcode resolve
  q.submitScanOnline.mockResolvedValue({ status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' });

  const view = render(<PickBriefScreen />);
  expect(await view.findByText('1 scan needs review — tap to review')).toBeTruthy();
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at product barcode'));

  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!('EAN-v1'); });
  expect(result).toBeUndefined();                                              // no inline retry prompt
  const [scanBody] = q.submitScanOnline.mock.calls[0];
  expect(scanBody.body.pick_claim_generation).toBe('gen-1');

  expect(mockSession.clears).toBe(1);
  expect(mockSession.persisted).toBeNull();                                    // stale session + confirmedLocation gone
  const [title, , buttons] = alert.mock.calls.find(([t]) => t === 'Batch reassigned')!;
  expect(title).toBe('Batch reassigned');
  expect(buttons).toHaveLength(1);                                             // blocking: the only way on is out
  buttons[0].onPress();
  expect(mockNav.goBack).toHaveBeenCalled();
  expect(q.dismissRejected).not.toHaveBeenCalled();                            // rejected scans retained
});

test('MP-02 takeover requires custody acknowledgement before a fresh location scan', async () => {
  serve({ status: 'picking', picked_by: OTHER, picker_name: 'Elin', recovery_eligible: true, units_picked: 2 });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('/claim')) return { data: { pick_claim_generation: 'gen-2', custody_ack_required: true, units_picked: 2 } };
    return { data: {} };
  });
  const view = render(<PickBriefScreen />);
  fireEvent.press(await view.findByText('Take over from Elin'));

  expect(await view.findByText('Confirm picked items')).toBeTruthy();
  expect(view.getByText(/2 units were already picked/)).toBeTruthy();
  expect(mockDock.onResolve).toBeNull();                                       // no scanner before acknowledgement
  expect(post.mock.calls.map((c) => c[0])).toEqual([`/api/v1/wms/batch/${BATCH}/claim`]);

  fireEvent.press(view.getByText('I have the picked items'));
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at bin barcode'));
  expect(post).toHaveBeenCalledWith(`/api/v1/wms/batch/${BATCH}/custody-ack`, { pick_claim_generation: 'gen-2' });
  expect(mockSession.persisted).toMatchObject({ phase: 'location_scan', phaseData: { confirmedLocation: null, generation: 'gen-2' } });
});

test('MP-03 an operator cannot enter another operator\'s active Pick session', async () => {
  serve({ status: 'picking', picked_by: OTHER, picker_name: 'Elin', recovery_eligible: false });
  const view = render(<PickBriefScreen />);
  expect(await view.findByText('Being picked by Elin')).toBeTruthy();
  expect(view.queryByText('Continue picking')).toBeNull();
  expect(view.queryByText(/Take over/)).toBeNull();
  expect(view.queryByText(/Claim & start picking/)).toBeNull();
  expect(post).not.toHaveBeenCalled();
  expect(mockDock.onResolve).toBeNull();
});

test('MP-04 rejected-scan review tells ownership loss, server refusal and exhausted server retries apart (C005 LOW-3)', async () => {
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1', generation: 'gen-1' } };
  mockSession.persisted = { ...mockSession.initial };
  serve({ status: 'picking', picked_by: ME });
  const base = { url: '/api/v1/wms/pick/scan', body: { pick_batch_id: BATCH }, rejectedAt: 1 };
  q.getRejected.mockResolvedValue([
    { ...base, deviceEventId: 'own', status: 409, code: 'PICK_GENERATION_STALE', error: 'stale', reason: 'refused' },
    { ...base, deviceEventId: 'ref', status: 409, code: null, error: 'Not enough stock remains', reason: 'refused' },
    { ...base, deviceEventId: 'srv', status: 503, code: null, error: 'Service unavailable', reason: 'server_error_retries_exhausted' },
  ]);
  const view = render(<PickBriefScreen />);
  fireEvent.press(await view.findByText('3 scans need review — tap to review'));
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === '3 scans need review')).toBe(true));
  const [, message, buttons] = alert.mock.calls.find(([t]) => t === '3 scans need review')!;
  const lines = String(message).split('\n').filter((l: string) => l.startsWith('•'));
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(/batch reassigned — do not re-scan/);
  expect(lines[1]).toMatch(/refused by the server \(Not enough stock remains\) — review it with your supervisor/);
  expect(lines[2]).toMatch(/did not answer for over 10 minutes, so it may already be recorded — do not re-scan\. Ask your supervisor to check the batch/);
  expect(lines[2]).not.toMatch(/scan (the item|it) again/i);
  expect(q.dismissRejected).not.toHaveBeenCalled();
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Later', 'Reviewed — dismiss']);
});

// ── C006 (REVIEW-004) — truthful offline-queue feedback ─────────────────────

const scanPhase = () => {
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1', generation: 'gen-1' } };
  mockSession.persisted = { ...mockSession.initial };
  serve({ status: 'picking', picked_by: ME });
};

test('MP-05 a scan that could not be saved on the device is shown as an error and the picker does not advance', async () => {
  scanPhase();
  post.mockResolvedValue({ data: { lasyncro_variant_id: 'v1' } });
  q.submitScanOnline.mockResolvedValue({ status: 0, code: 'OFFLINE_QUEUE_WRITE_FAILED', error: 'This scan was not saved on the device. Keep the item and scan it again when the connection returns.' });
  render(<PickBriefScreen />);
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at product barcode'));
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!('EAN-v1'); });
  expect(result).toMatch(/not saved on the device/);
  expect(mockSession.persisted).toMatchObject({ phase: 'product_scan', phaseData: { currentIndex: 0 } }); // not advanced
  expect(alert.mock.calls.find(([t]) => t === 'Batch reassigned')).toBeUndefined();
});

test('MP-06 storage failure and paused sign-in are shown truthfully; "will sync" is not claimed while paused', async () => {
  scanPhase();
  let listener: ((...a: unknown[]) => void) | null = null;
  q.subscribe.mockImplementation((fn: (...a: unknown[]) => void) => { listener = fn; return () => {}; });
  const view = render(<PickBriefScreen />);
  await waitFor(() => expect(listener).not.toBeNull());

  act(() => listener!(2, true, 0, { storageError: 'OFFLINE_QUEUE_STORAGE_WRITE_FAILED', authPaused: false }));
  expect(await view.findByText(/Scans can't be saved on this phone right now/)).toBeTruthy();

  act(() => listener!(2, true, 0, { storageError: null, authPaused: true }));
  expect(await view.findByText('Sign in again to sync 2 saved scans — they are kept on this phone')).toBeTruthy();
  expect(view.queryByText(/will sync when online/)).toBeNull();
  expect(view.queryByText(/Scans can't be saved/)).toBeNull();
});

test('MP-07 review explains already-recorded and uncertain outcomes without asking for a re-scan; unreadable records are reported', async () => {
  scanPhase();
  const base = { url: '/api/v1/wms/pick/scan', body: { pick_batch_id: BATCH }, rejectedAt: 1, status: 409 };
  q.getRejected.mockResolvedValue([
    { ...base, deviceEventId: 'o', code: 'PICK_SCAN_ALREADY_RECORDED', error: 'x', reason: 'already_recorded_by_other' },
    { ...base, deviceEventId: 'u', code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'y', reason: 'outcome_uncertain' },
  ]);
  const view = render(<PickBriefScreen />);
  fireEvent.press(await view.findByText('2 scans need review — tap to review'));
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === '2 scans need review')).toBe(true));
  const [, message] = alert.mock.calls.find(([t]) => t === '2 scans need review')!;
  const lines = String(message).split('\n').filter((l: string) => l.startsWith('•'));
  expect(lines[0]).toMatch(/already recorded by another picker — do not re-scan/);
  expect(lines[1]).toMatch(/may already be recorded — do not re-scan/);
  expect(lines.join(' ')).not.toMatch(/scan the item again/);

  q.getRejected.mockRejectedValueOnce(new Error('OFFLINE_QUEUE_STORAGE_READ_FAILED'));
  fireEvent.press(view.getByText('2 scans need review — tap to review'));
  await waitFor(() => expect(alert.mock.calls.some(([t]) => t === 'Scan records unavailable')).toBe(true));
});
