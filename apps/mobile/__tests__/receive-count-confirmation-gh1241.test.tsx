// GH-1241 / S3-A1 — mobile Receive count-evidence safety.
//
// The backend accepts units only against the operator's persisted physical
// count (POST …/lines/:lineId/confirm-count). Mobile must confirm exactly the
// typed or physically scanned quantity before inspect, never inspect when the
// confirmation fails, and "I miscounted" must never accept the expected
// quantity without a count. Same harness pattern as the auth-session-01 suites.
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { apiClient } from '@lasyncro/mobile-core';
import ReceiveJobScreen from '../src/screens/ReceiveJobScreen';

const JOB_ID = 'job-gh1241';
const LINE_ID = 'line-gh1241';
const VARIANT_ID = 'variant-gh1241';
const CONFIRM_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/lines/${LINE_ID}/confirm-count`;
const INSPECT_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/inspect`;

const mockScanner: { onScan: ((event: { data: string }) => Promise<string | void>) | null } = { onScan: null };

jest.mock('@lasyncro/mobile-core', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ userId: 7 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { task: { id: 'job-gh1241' } } }),
}));
jest.mock('../src/ui', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  const Container = ({ children }: any) => React.createElement(View, null, children);
  let eventCounter = 0;
  return {
    Screen: Container,
    Card: Container,
    Row: Container,
    Divider: () => null,
    AppHeader: () => null,
    Badge: ({ label }: any) => React.createElement(Text, null, label),
    Button: ({ label, onPress, disabled }: any) =>
      React.createElement(TouchableOpacity, { onPress, disabled }, React.createElement(Text, null, label)),
    SessionShell: Container,
    useSession: () => ({
      newEventId: () => {
        eventCounter += 1;
        return `00000000-0000-4000-8000-${String(eventCounter).padStart(12, '0')}`;
      },
    }),
    BarcodeScannerView: ({ onScan, overlay }: any) => {
      mockScanner.onScan = onScan;
      return React.createElement(View, null, overlay);
    },
  };
});

const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;

function loadJob(quantityExpected = 2) {
  get.mockResolvedValue({
    data: {
      job: {
        receive_job_id: JOB_ID, status: 'in_progress', assigned_operator_id: 7,
        supplier_name: 'GH1241 Supplier', total_variants: 1, total_units: quantityExpected,
      },
      lines: [{
        receive_job_line_id: LINE_ID, lasyncro_variant_id: VARIANT_ID, sku: 'GH1241-SKU',
        variant_title: 'Default Title', description: null, quantity_expected: quantityExpected,
        quantity_accepted: 0, quantity_rejected: 0, quantity_sellable_provisional: null,
        reported_problems: [], inspection_complete: false,
      }],
    },
  });
}

function postedRoutes(): string[] {
  return post.mock.calls.map((call) => String(call[0]));
}

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockScanner.onScan = null;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

async function startCounting(view: ReturnType<typeof render>) {
  fireEvent.press(await view.findByText(/Resume Receive · Count by hand/));
}

test('typed count: the typed quantity is confirmed before inspect, and inspect carries exactly it', async () => {
  loadJob(2);
  post.mockResolvedValue({ data: {} });
  const view = render(<ReceiveJobScreen />);
  await startCounting(view);

  fireEvent.changeText(await view.findByPlaceholderText('2'), '2');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });

  await waitFor(() => expect(postedRoutes()).toEqual([CONFIRM_ROUTE, INSPECT_ROUTE]));
  expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({ quantity_confirmed: 2, device_event_id: expect.any(String) }));
  expect(post.mock.calls[1][1]).toEqual(expect.objectContaining({ receive_job_line_id: LINE_ID, quantity_accepted: 2 }));
});

test('scanned count: the number of physically scanned units is confirmed before inspect', async () => {
  loadJob(2);
  post.mockImplementation(async (url: string) => (
    url === '/api/v1/wms/barcode/resolve' ? { data: { lasyncro_variant_id: VARIANT_ID } } : { data: {} }
  ));
  const view = render(<ReceiveJobScreen />);
  fireEvent.press(await view.findByText(/Resume Receive · Scan items/));
  await waitFor(() => expect(mockScanner.onScan).toBeTruthy());

  await act(async () => { await mockScanner.onScan!({ data: '5012345678900' }); });
  expect(postedRoutes()).not.toContain(CONFIRM_ROUTE);
  await act(async () => { await mockScanner.onScan!({ data: '5012345678900' }); });

  await waitFor(() => expect(postedRoutes()).toContain(INSPECT_ROUTE));
  const receiveCalls = post.mock.calls.filter((call) => call[0] !== '/api/v1/wms/barcode/resolve');
  expect(receiveCalls.map((call) => call[0])).toEqual([CONFIRM_ROUTE, INSPECT_ROUTE]);
  expect(receiveCalls[0][1]).toEqual(expect.objectContaining({ quantity_confirmed: 2 }));
  expect(receiveCalls[1][1]).toEqual(expect.objectContaining({ quantity_accepted: 2 }));
});

test('a failed confirmation blocks inspect and surfaces the error', async () => {
  loadJob(2);
  post.mockImplementation(async (url: string) => {
    if (url === CONFIRM_ROUTE) {
      throw Object.assign(new Error('409'), { response: { data: { error: 'RECEIVE_COUNT_CONFIRM_FAILED' } } });
    }
    return { data: {} };
  });
  const view = render(<ReceiveJobScreen />);
  await startCounting(view);

  fireEvent.changeText(await view.findByPlaceholderText('2'), '2');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });

  await waitFor(() => expect(alert).toHaveBeenCalledWith('Error', 'RECEIVE_COUNT_CONFIRM_FAILED'));
  expect(postedRoutes()).toEqual([CONFIRM_ROUTE]);
  expect(postedRoutes()).not.toContain(INSPECT_ROUTE);
});

test('"I miscounted — recount" never confirms or inspects the expected quantity', async () => {
  loadJob(2);
  post.mockResolvedValue({ data: {} });
  const view = render(<ReceiveJobScreen />);
  await startCounting(view);

  fireEvent.changeText(await view.findByPlaceholderText('2'), '1');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await act(async () => { fireEvent.press(await view.findByText(/I miscounted — recount/)); });

  expect(alert).toHaveBeenCalledWith('Recount', expect.stringMatching(/physically counted/i));
  expect(postedRoutes()).not.toContain(INSPECT_ROUTE);
  expect(post.mock.calls.some((call) => call[0] === CONFIRM_ROUTE && call[1]?.quantity_confirmed === 2)).toBe(false);
});

// GH-1241 S3-A1 G1 — an event ID belongs to ONE pending count confirmation.
// The backend permanently refuses a consumed event once it is no longer the
// line's active confirmation, so a recount must confirm with a NEW event,
// while a network retry of the same pending confirmation keeps its event.
function confirmEvents(): Array<{ quantity: number; event: string }> {
  return post.mock.calls
    .filter((call) => call[0] === CONFIRM_ROUTE)
    .map((call) => ({ quantity: call[1].quantity_confirmed, event: call[1].device_event_id }));
}

test('G1 — confirm 8, recount 7, recount 8: every new count intent is a new confirmation event', async () => {
  loadJob(8);
  const patch = apiClient.patch as jest.Mock;
  patch.mockResolvedValue({ data: {} });
  let inspectAttempts = 0;
  post.mockImplementation(async (url: string) => {
    if (url === INSPECT_ROUTE && ++inspectAttempts <= 2) {
      throw Object.assign(new Error('409'), { response: { status: 409, data: { error: 'inspect refused' } } });
    }
    return { data: {} };
  });
  const view = render(<ReceiveJobScreen />);
  await startCounting(view);

  // 1. Count 8 → confirmed (E1); inspection fails, the line stays open.
  fireEvent.changeText(await view.findByPlaceholderText('8'), '8');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Error', 'inspect refused'));

  // 2–3. Recount 7 (1 later delivery) → confirmed (E2); inspection fails again.
  fireEvent.changeText(view.getByPlaceholderText('8'), '7');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await act(async () => { fireEvent.press(await view.findByText('Later delivery')); });
  await act(async () => { fireEvent.press(view.getByText('Report & confirm')); });
  await waitFor(() => expect(inspectAttempts).toBe(2));
  await act(async () => { fireEvent.press(view.getByText(/I miscounted — recount/)); });

  // 4–5. Recount 8 → a legitimate new confirmation (E3), then inspection.
  fireEvent.changeText(view.getByPlaceholderText('8'), '8');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await waitFor(() => expect(inspectAttempts).toBe(3));

  const confirms = confirmEvents();
  expect(confirms.map((c) => c.quantity)).toEqual([8, 7, 8]);
  expect(new Set(confirms.map((c) => c.event)).size).toBe(3);
});

test('G1 — a network retry of the same pending confirmation keeps its event; a definitive refusal releases it', async () => {
  loadJob(2);
  let confirmAttempts = 0;
  post.mockImplementation(async (url: string) => {
    if (url === CONFIRM_ROUTE) {
      confirmAttempts += 1;
      if (confirmAttempts === 1) throw new Error('Network Error');
      if (confirmAttempts === 2) {
        throw Object.assign(new Error('409'), {
          response: { status: 409, data: { error: 'RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT' } },
        });
      }
    }
    return { data: {} };
  });
  const view = render(<ReceiveJobScreen />);
  await startCounting(view);

  fireEvent.changeText(await view.findByPlaceholderText('2'), '2');
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await act(async () => { fireEvent.press(view.getByText('Confirm')); });
  await waitFor(() => expect(postedRoutes()).toContain(INSPECT_ROUTE));

  const [lost, retry, afterRefusal] = confirmEvents().map((c) => c.event);
  expect(retry).toBe(lost);
  expect(afterRefusal).not.toBe(lost);
  // A failed confirmation never triggered inspection.
  expect(postedRoutes().filter((r) => r === INSPECT_ROUTE)).toHaveLength(1);
});
