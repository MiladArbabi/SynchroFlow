/**
 * SF-PICK-ASSIGN-01 Correction 003 (REVIEW-001 M2) — mobile Pick writes never
 * claim. A restored session without a generation re-reads it through the
 * read-only GET pick-session; offline it refuses visibly; unrelated refusals
 * keep the generation. Harness copied from pick-ownership-ux-sf-pick-assign-01.
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

const claimCalls = () => post.mock.calls.filter(([url]) => String(url).endsWith('/claim'));
const sessionCalls = () => get.mock.calls.filter(([url]) => String(url).endsWith('/pick-session'));

/** Restored mid-session (product_scan, confirmed location) persisted before a generation existed. */
function restoreWithoutGeneration(pickSession: (url: string) => Promise<unknown>) {
  mockSession.initial = { phase: 'product_scan', phaseData: { currentIndex: 0, confirmedLocation: 'A-1' } };
  mockSession.persisted = { ...mockSession.initial };
  serve({ status: 'picking', picked_by: ME });
  const batches = get.getMockImplementation()!;
  get.mockImplementation(async (url: string) => (url.endsWith('/pick-session') ? pickSession(url) : batches(url)));
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('/claim')) return { data: { pick_claim_generation: 'gen-CLAIMED' } };
    return { data: { lasyncro_variant_id: 'v1' } };                            // barcode resolve
  });
}

async function scanProduct() {
  await waitFor(() => expect(mockDock.hint).toBe('Point camera at product barcode'));
  let result: string | void = 'unset';
  await act(async () => { result = await mockDock.onResolve!('EAN-v1'); });
  return result;
}

// C010 (REVIEW-006 F1) supersedes the C003 contract "resumes read-only":
// a session without a held generation must not adopt the server's.
test('MG-01 a restored session without a generation never adopts one and never claims', async () => {
  restoreWithoutGeneration(async () => ({ data: { pick_claim_generation: 'gen-RESUMED' } }));
  render(<PickBriefScreen />);
  await scanProduct();
  expect(claimCalls()).toHaveLength(0);
  expect(sessionCalls()).toHaveLength(1);
  expect(q.submitScanOnline).not.toHaveBeenCalled();
  expect(mockSession.clears).toBe(1);
});

test('MG-02 a restored session whose batch was taken over is revoked, not taken back', async () => {
  restoreWithoutGeneration(async () => {
    throw { response: { status: 409, data: { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' } } };
  });
  render(<PickBriefScreen />);
  await scanProduct();
  expect(claimCalls()).toHaveLength(0);
  expect(q.submitScanOnline).not.toHaveBeenCalled();
  expect(mockSession.clears).toBe(1);
  expect(mockSession.persisted).toBeNull();
  expect(alert.mock.calls.some(([t]) => t === 'Batch reassigned')).toBe(true);
});

test('MG-03 offline with no generation: the scan is refused visibly, nothing claimed, queued or cleared', async () => {
  restoreWithoutGeneration(async () => { throw new Error('Network Error'); });
  render(<PickBriefScreen />);
  const result = await scanProduct();
  expect(result).toMatch(/Reconnect to resume this batch/);
  expect(claimCalls()).toHaveLength(0);
  expect(q.submitScanOnline).not.toHaveBeenCalled();
  expect(mockSession.clears).toBe(0);
});

test('MG-04 an unrelated 409 keeps the generation: the next scan neither re-reads nor claims', async () => {
  restoreWithoutGeneration(async () => ({ data: { pick_claim_generation: 'gen-RESUMED' } }));
  // C010 (F1): the session holds its generation (it can no longer be adopted from pick-session).
  mockSession.initial = { ...mockSession.initial, phaseData: { ...mockSession.initial.phaseData, generation: 'gen-RESUMED' } };
  mockSession.persisted = { ...mockSession.initial };
  q.submitScanOnline
    .mockResolvedValueOnce({ status: 409, code: null, error: 'Not enough stock remains at this location.' })
    .mockResolvedValueOnce(undefined);
  render(<PickBriefScreen />);
  expect(await scanProduct()).toMatch(/Not enough stock/);
  let second: string | void = 'unset';
  await act(async () => { second = await mockDock.onResolve!('EAN-v1'); });
  expect(second).toBeUndefined();
  expect(sessionCalls()).toHaveLength(0);
  expect(claimCalls()).toHaveLength(0);
  expect(q.submitScanOnline.mock.calls[1][0].body.pick_claim_generation).toBe('gen-RESUMED');
});
