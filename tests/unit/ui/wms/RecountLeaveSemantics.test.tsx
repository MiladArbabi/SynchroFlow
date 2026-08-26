// RECOUNT-LEAVE-SEMANTICS-138
//
// Regression contract for "Leave count" in the recount counting session.
// Renders CountingSessionPage directly with controlled props — it makes no
// direct HTTP calls (every side effect is an injected callback prop) and
// only uses MUI's useTheme(), which resolves to the default theme without
// a <ThemeProvider> wrapper (same precedent as WmsCtaTierConsistency.test.tsx
// and tests/unit/ui/customers/CustomersModuleFT2.test.tsx).
//
// CTA-tier/styling coverage for "Leave count" is already owned by
// tests/unit/ui/wms/WmsCtaTierConsistency.test.tsx (CONTRACT-WMS-CTA-03) —
// not duplicated here (CONTRACT-LEAVE-05).
import { fireEvent, render, screen } from '@testing-library/react';
import CountingSessionPage, {
  type CountingLine,
  type CountingTask,
} from '../../../../modules/wms/src/ui/pages/CountingSessionPage';

const TASK_ID = 'task-138';
const LINE_ID = 'line-138';
const LOCATION_CODE = 'A-1';

const TALLY_STORAGE_KEY = `recount-scan-tally-${TASK_ID}`;
const VERIFIED_LOCATION_STORAGE_KEY = `recount-verified-location-${TASK_ID}`;
const SEEDED_TALLY_JSON = JSON.stringify({ [LINE_ID]: 3 });

const task: CountingTask = {
  recount_task_id: TASK_ID,
  label: 'CNT-1-0001',
  status: 'counting',
  scope: 'suggested',
  blind: true,
  assigned_to: null,
  claimed_by: 7,
  created_at: '2026-08-26T00:00:00.000Z',
  claimed_at: '2026-08-26T00:00:00.000Z',
  line_count: 1,
  counted_count: 0,
};

const unresolvedLine: CountingLine = {
  recount_line_id: LINE_ID,
  lasyncro_variant_id: 'variant-138',
  location_code: LOCATION_CODE,
  counted_quantity: null,
  count_method: null,
  scan_count: null,
  counted_at: null,
  skip_reason: null,
  skipped_at: null,
  product_title: 'Recount fixture product',
  variant_title: null,
  sku: 'SKU-138',
  image_url: null,
};

function buildCallbacks() {
  return {
    onComplete: jest.fn(),
    onFetchLines: jest.fn().mockResolvedValue([unresolvedLine]),
    onFetchFindings: jest.fn().mockResolvedValue([]),
    onCreateFinding: jest.fn(),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue(null),
    onRecordCount: jest.fn().mockResolvedValue(undefined),
    onSkipLine: jest.fn().mockResolvedValue(undefined),
    onCloseTask: jest.fn().mockResolvedValue(undefined),
  };
}

/** Seeds sessionStorage so the session resumes directly into the counting
 * phase for LOCATION_CODE — same resume path a real "Continue" click uses. */
function seedPersistedState() {
  sessionStorage.setItem(TALLY_STORAGE_KEY, SEEDED_TALLY_JSON);
  sessionStorage.setItem(VERIFIED_LOCATION_STORAGE_KEY, LOCATION_CODE);
}

async function renderAtCountPhase() {
  const callbacks = buildCallbacks();
  render(<CountingSessionPage task={task} {...callbacks} />);
  // Confirms the fixture actually reached phase 'bin' (not 'location'),
  // not just that render() didn't throw. LOCATION_CODE itself renders in
  // more than one place on this phase (header + line rows), so it isn't a
  // reliable single-match locator — "Leave count" only exists in this phase.
  await screen.findByText('Leave count');
  return callbacks;
}

beforeEach(() => {
  sessionStorage.clear();
  seedPersistedState();
});

describe('CONTRACT-LEAVE-01 — Leave calls onComplete() with zero arguments, no mutation callback', () => {
  it('calls onComplete once with zero arguments and calls no mutation callback', async () => {
    const callbacks = await renderAtCountPhase();

    fireEvent.click(screen.getByText('Leave count'));

    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onComplete.mock.calls[0]).toHaveLength(0);
    expect(callbacks.onCloseTask).not.toHaveBeenCalled();
    expect(callbacks.onRecordCount).not.toHaveBeenCalled();
    expect(callbacks.onSkipLine).not.toHaveBeenCalled();
    expect(callbacks.onCreateFinding).not.toHaveBeenCalled();
  });
});

describe('CONTRACT-LEAVE-02 — Leave does not clear provisional tally or verified-location state', () => {
  it('leaves both sessionStorage keys byte-for-byte unchanged after the click', async () => {
    await renderAtCountPhase();

    // Snapshot after mount/restore, before the click — the resume loader
    // re-persists the restored tally on mount (normalize round-trip); for
    // this single, already-normalized entry that round-trip is a no-op, so
    // this should equal the original seed.
    const tallyBeforeClick = sessionStorage.getItem(TALLY_STORAGE_KEY);
    const verifiedLocationBeforeClick = sessionStorage.getItem(
      VERIFIED_LOCATION_STORAGE_KEY
    );
    expect(tallyBeforeClick).toBe(SEEDED_TALLY_JSON);
    expect(verifiedLocationBeforeClick).toBe(LOCATION_CODE);

    fireEvent.click(screen.getByText('Leave count'));

    expect(sessionStorage.getItem(TALLY_STORAGE_KEY)).toBe(tallyBeforeClick);
    expect(sessionStorage.getItem(VERIFIED_LOCATION_STORAGE_KEY)).toBe(
      verifiedLocationBeforeClick
    );
  });
});

describe('CONTRACT-LEAVE-03 — reassurance copy is visible on the active counting surface', () => {
  it('shows "Progress is saved automatically." near Leave count', async () => {
    await renderAtCountPhase();

    expect(
      screen.getByText('Progress is saved automatically.')
    ).toBeInTheDocument();
  });
});

describe('CONTRACT-LEAVE-04 — no destructive confirmation', () => {
  it('shows no dialog and no discard/unsaved-progress language before or after the click', async () => {
    await renderAtCountPhase();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/discard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Leave count'));

    // onComplete fires on the single click — no intermediate confirm state.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/discard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
  });
});
