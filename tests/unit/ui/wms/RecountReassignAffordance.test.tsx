// RECOUNT-CLAIM-ABANDONED-131
//
// CONTRACT-REASSIGN-08/09 (privileged affordance + dialog shape) are proven
// via scoped source-text checks against WmsModuleFT2.tsx: CountingTaskCard
// and the reassignment dialog are unexported internals of a component with a
// 30+ prop surface (batches/stow/receive/pack/pick/counting all together) —
// rendering it fully purely to reach one card's gating logic is exactly the
// "excessive brittle fixture complexity" the approved test strategy
// pre-authorized this fallback for (same pattern as
// tests/unit/ui/wms/WmsCtaTierConsistency.test.tsx's ctaBlock helper).
//
// CONTRACT-REASSIGN-10/11 (claim-generation storage isolation, stale-session
// copy) render CountingSessionPage directly with controlled props — proven
// viable and already used by tests/unit/ui/wms/RecountLeaveSemantics.test.tsx.
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CountingSessionPage, {
  type CountingLine,
  type CountingTask,
} from '../../../../modules/wms/src/ui/pages/CountingSessionPage';

const wmsModuleSrc = fs.readFileSync(
  path.resolve(__dirname, '../../../../modules/wms/src/ui/pages/WmsModuleFT2.tsx'),
  'utf8'
);

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`end marker not found after start: ${endMarker}`);
  return src.slice(start, end);
}

const countingTaskCardSrc = sliceBetween(
  wmsModuleSrc,
  'const CountingTaskCard = memo(function CountingTaskCard(',
  '\n});'
);

const reassignDialogSrc = sliceBetween(
  wmsModuleSrc,
  'open={reassignTask !== null}',
  '{/* LOADING */}'
);

describe('CONTRACT-REASSIGN-08 — privileged affordance (source-scoped)', () => {
  it('CountingTaskCard gates the reassign action on canReassignCount AND claimedByOther', () => {
    expect(countingTaskCardSrc).toMatch(
      /showReassign = Boolean\(canReassignCount\) && claimedByOther/
    );
  });

  it('claimedByOther already excludes dispatched, own task, manual_review, and committed', () => {
    // claimedByOther = continuing (claimed/counting only) && claimed_by set
    // && claimed_by !== currentUserId — so showReassign inherits all four
    // exclusions from this single existing predicate; not re-derived here.
    expect(countingTaskCardSrc).toMatch(/const continuing =\s*\n?\s*task\.status === 'claimed' \|\| task\.status === 'counting'/);
    expect(countingTaskCardSrc).toMatch(/const claimedByOther =\s*\n\s*continuing &&\s*\n\s*task\.claimed_by !== null &&\s*\n\s*task\.claimed_by !== currentUserId/);
  });

  it('the reassign button is Tier-2 styled (not WMS_TIER1_ACTION_SX)', () => {
    const buttonBlock = countingTaskCardSrc.slice(countingTaskCardSrc.indexOf('showReassign && ('));
    expect(buttonBlock).toMatch(/Reassign count/);
    expect(buttonBlock).not.toMatch(/WMS_TIER1_ACTION_SX/);
  });
});

describe('CONTRACT-REASSIGN-09 — dialog shape (source-scoped)', () => {
  it('confirm is disabled until a target is selected', () => {
    expect(reassignDialogSrc).toMatch(
      /disabled=\{reassignTargetId === '' \|\| reassignSubmitting\}/
    );
  });

  it('cancel closes the dialog without a mutation call', () => {
    const cancelBlock = sliceBetween(reassignDialogSrc, 'onClick={closeReassignDialog}', 'Cancel');
    expect(cancelBlock).not.toMatch(/onReassignCountingTask/);
  });

  it('confirm calls the reassignment callback via submitReassign', () => {
    expect(wmsModuleSrc).toMatch(/await onReassignCountingTask\?\.\(reassignTask\.recount_task_id, reassignTargetId\)/);
  });

  it('target list is populated from the existing team-operators fetch, not a new endpoint', () => {
    expect(wmsModuleSrc).toMatch(/const targets = await onFetchCountingAssignees\(\)/);
  });

  it('current claimant is shown in the dialog copy', () => {
    expect(reassignDialogSrc).toMatch(/is currently claimed by another operator/);
  });
});

const TASK_ID = 'task-reassign-138';
const LINE_ID = 'line-reassign-138';
const LOCATION_CODE = 'A-1';

const baseLine: CountingLine = {
  recount_line_id: LINE_ID,
  lasyncro_variant_id: 'variant-138',
  location_code: LOCATION_CODE,
  counted_quantity: null,
  count_method: null,
  scan_count: null,
  counted_at: null,
  skip_reason: null,
  skipped_at: null,
  product_title: 'Reassign fixture product',
  variant_title: null,
  sku: 'SKU-138',
  image_url: null,
};

function buildTask(claimGeneration: string | null): CountingTask {
  return {
    recount_task_id: TASK_ID,
    label: 'CNT-1-0138',
    status: 'counting',
    scope: 'suggested',
    blind: true,
    assigned_to: null,
    claimed_by: 7,
    created_at: '2026-08-26T00:00:00.000Z',
    claimed_at: '2026-08-26T00:00:00.000Z',
    claim_generation: claimGeneration,
    line_count: 1,
    counted_count: 0,
  };
}

function buildCallbacks(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    onComplete: jest.fn(),
    onFetchLines: jest.fn().mockResolvedValue([baseLine]),
    onFetchFindings: jest.fn().mockResolvedValue([]),
    onCreateFinding: jest.fn(),
    onClaimTask: jest.fn().mockResolvedValue(undefined),
    onResolveBarcode: jest.fn().mockResolvedValue(null),
    onRecordCount: jest.fn().mockResolvedValue(undefined),
    onSkipLine: jest.fn().mockResolvedValue(undefined),
    onCloseTask: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function renderAtCountPhase(claimGeneration: string | null, overrides: Partial<Record<string, jest.Mock>> = {}) {
  const callbacks = buildCallbacks(overrides);
  render(<CountingSessionPage task={buildTask(claimGeneration)} {...(callbacks as any)} />);
  await screen.findByText('Leave count');
  return callbacks;
}

/** Waits for loading to finish without assuming which phase (location vs
 * bin) the session resumed into — used when the test's own point is which
 * phase it resumed into. */
async function renderCountingSession(claimGeneration: string | null) {
  const callbacks = buildCallbacks();
  render(<CountingSessionPage task={buildTask(claimGeneration)} {...(callbacks as any)} />);
  await waitFor(() => {
    expect(
      screen.queryByText('Leave count') ?? screen.queryByText('Confirm bin')
    ).not.toBeNull();
  });
  return callbacks;
}

const tallyKey = (gen: string) => `recount-scan-tally-${TASK_ID}-${gen}`;
const verifiedLocationKey = (gen: string) => `recount-verified-location-${TASK_ID}-${gen}`;

beforeEach(() => {
  sessionStorage.clear();
});

describe('CONTRACT-REASSIGN-10 — claim-generation storage isolation', () => {
  it('same claim generation restores the same tally and verified location', async () => {
    sessionStorage.setItem(tallyKey('gen-A'), JSON.stringify({ [LINE_ID]: 2 }));
    sessionStorage.setItem(verifiedLocationKey('gen-A'), LOCATION_CODE);

    // Resume restored verified-location -> phase 'bin' directly (no
    // location-confirmation step), proven by renderAtCountPhase itself only
    // resolving once 'Leave count' (bin-phase-only text) is present.
    await renderAtCountPhase('gen-A');

    expect(sessionStorage.getItem(tallyKey('gen-A'))).toBe(JSON.stringify({ [LINE_ID]: 2 }));
  });

  it('a new claim generation does not read the previous generation\'s tally', async () => {
    sessionStorage.setItem(tallyKey('gen-A'), JSON.stringify({ [LINE_ID]: 2 }));
    sessionStorage.setItem(verifiedLocationKey('gen-A'), LOCATION_CODE);

    await renderCountingSession('gen-B');

    // gen-B has no seeded verified-location, so it resumes at the location
    // confirmation phase rather than 'bin' — proving gen-A's state was not read.
    expect(screen.getByText('Confirm bin')).toBeInTheDocument();
    expect(sessionStorage.getItem(tallyKey('gen-B'))).toBeNull();
  });

  it('A -> B -> A does not collide: a fresh gen-A session after gen-B does not see gen-B state', async () => {
    sessionStorage.setItem(tallyKey('gen-A'), JSON.stringify({ [LINE_ID]: 1 }));
    sessionStorage.setItem(verifiedLocationKey('gen-A'), LOCATION_CODE);
    sessionStorage.setItem(tallyKey('gen-B'), JSON.stringify({ [LINE_ID]: 99 }));
    sessionStorage.setItem(verifiedLocationKey('gen-B'), 'Z-9');

    await renderAtCountPhase('gen-A');

    expect(sessionStorage.getItem(tallyKey('gen-A'))).toBe(JSON.stringify({ [LINE_ID]: 1 }));
    expect(sessionStorage.getItem(tallyKey('gen-B'))).toBe(JSON.stringify({ [LINE_ID]: 99 }));
  });

  it('legacy null claim_generation still resumes its own state (transitional "legacy" bucket)', async () => {
    sessionStorage.setItem(`recount-scan-tally-${TASK_ID}-legacy`, JSON.stringify({ [LINE_ID]: 3 }));
    sessionStorage.setItem(`recount-verified-location-${TASK_ID}-legacy`, LOCATION_CODE);

    // Reaching bin phase (Leave count only renders there) proves the
    // 'legacy' bucket's verified-location was read for a null-generation task.
    await renderAtCountPhase(null);
  });

  it('existing Leave behavior still works within the same generation', async () => {
    sessionStorage.setItem(tallyKey('gen-A'), JSON.stringify({ [LINE_ID]: 2 }));
    sessionStorage.setItem(verifiedLocationKey('gen-A'), LOCATION_CODE);

    const callbacks = await renderAtCountPhase('gen-A');
    fireEvent.click(screen.getByText('Leave count'));

    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(tallyKey('gen-A'))).toBe(JSON.stringify({ [LINE_ID]: 2 }));
    expect(sessionStorage.getItem(verifiedLocationKey('gen-A'))).toBe(LOCATION_CODE);
  });
});

// RECOUNT-CLAIM-ABANDONED-131 correction: legacy (pre-generation-column)
// task-only keys must migrate into the new "-legacy" bucket exactly once,
// only for claim_generation === null, and never leak into a real (UUID)
// generation.
const OLD_TALLY_KEY = `recount-scan-tally-${TASK_ID}`;
const OLD_VERIFIED_LOCATION_KEY = `recount-verified-location-${TASK_ID}`;
const legacyTallyKey = () => tallyKey('legacy');
const legacyVerifiedLocationKey = () => verifiedLocationKey('legacy');

describe('CONTRACT-REASSIGN-10b — legacy task-only key migration', () => {
  it('(A) a pre-deployment old tally key resumes under the same legacy claim', async () => {
    sessionStorage.setItem(OLD_TALLY_KEY, JSON.stringify({ [LINE_ID]: 4 }));
    sessionStorage.setItem(OLD_VERIFIED_LOCATION_KEY, LOCATION_CODE);

    await renderAtCountPhase(null);

    expect(sessionStorage.getItem(legacyTallyKey())).toBe(JSON.stringify({ [LINE_ID]: 4 }));
  });

  it('(B) a pre-deployment old verified-location key resumes (reaches bin phase directly)', async () => {
    sessionStorage.setItem(OLD_VERIFIED_LOCATION_KEY, LOCATION_CODE);

    // renderAtCountPhase only resolves once 'Leave count' (bin-phase-only
    // text) appears — reaching it proves the old verified-location key was
    // read and honored for this null-generation task.
    await renderAtCountPhase(null);

    expect(sessionStorage.getItem(legacyVerifiedLocationKey())).toBe(LOCATION_CODE);
  });

  it('(C) migration produces the new "-legacy" key', async () => {
    sessionStorage.setItem(OLD_TALLY_KEY, JSON.stringify({ [LINE_ID]: 5 }));
    sessionStorage.setItem(OLD_VERIFIED_LOCATION_KEY, LOCATION_CODE);

    await renderAtCountPhase(null);

    expect(sessionStorage.getItem(legacyTallyKey())).not.toBeNull();
    expect(sessionStorage.getItem(legacyVerifiedLocationKey())).not.toBeNull();
  });

  it('(D) the old task-only key is removed after successful migration', async () => {
    sessionStorage.setItem(OLD_TALLY_KEY, JSON.stringify({ [LINE_ID]: 6 }));
    sessionStorage.setItem(OLD_VERIFIED_LOCATION_KEY, LOCATION_CODE);

    await renderAtCountPhase(null);

    expect(sessionStorage.getItem(OLD_TALLY_KEY)).toBeNull();
    expect(sessionStorage.getItem(OLD_VERIFIED_LOCATION_KEY)).toBeNull();
  });

  it('(E) a real (UUID) claim_generation never reads or touches the old task-only key', async () => {
    sessionStorage.setItem(OLD_TALLY_KEY, JSON.stringify({ [LINE_ID]: 7 }));
    sessionStorage.setItem(OLD_VERIFIED_LOCATION_KEY, LOCATION_CODE);

    // No verified-location seeded for gen-A itself, so if the old key were
    // consulted this would reach bin phase; it must NOT.
    await renderCountingSession('gen-A');

    expect(screen.getByText('Confirm bin')).toBeInTheDocument();
    // Old key must be left completely untouched — not migrated, not removed —
    // since migration is gated strictly on claim_generation === null.
    expect(sessionStorage.getItem(OLD_TALLY_KEY)).toBe(JSON.stringify({ [LINE_ID]: 7 }));
    expect(sessionStorage.getItem(OLD_VERIFIED_LOCATION_KEY)).toBe(LOCATION_CODE);
    expect(sessionStorage.getItem(tallyKey('gen-A'))).toBeNull();
  });

  it('(F) reassignment (a fresh UUID generation) still isolates the new claimant from old legacy progress', async () => {
    // Simulates the exact sequence a real reassignment produces: an old
    // legacy (null-generation) claim with real local progress, then the
    // same task re-rendered with the fresh generation reassignment writes.
    sessionStorage.setItem(OLD_TALLY_KEY, JSON.stringify({ [LINE_ID]: 8 }));
    sessionStorage.setItem(OLD_VERIFIED_LOCATION_KEY, LOCATION_CODE);
    await renderAtCountPhase(null);
    expect(sessionStorage.getItem(legacyTallyKey())).toBe(JSON.stringify({ [LINE_ID]: 8 }));

    await renderCountingSession('new-reassignment-generation');

    expect(screen.getByText('Confirm bin')).toBeInTheDocument();
    expect(sessionStorage.getItem(tallyKey('new-reassignment-generation'))).toBeNull();
  });
});

describe('CONTRACT-REASSIGN-11 — stale-session ownership-loss message', () => {
  it('shows the stable reassignment copy when a mutation rejects with RECOUNT_OWNERSHIP_CHANGED', async () => {
    const rejection = {
      response: { data: { error: 'Task owned by a different operator', code: 'RECOUNT_OWNERSHIP_CHANGED' } },
    };
    const onRecordCount = jest.fn().mockRejectedValue(rejection);

    sessionStorage.setItem(verifiedLocationKey('gen-A'), LOCATION_CODE);
    await renderAtCountPhase('gen-A', { onRecordCount });

    fireEvent.click(screen.getByText('None here'));

    await waitFor(() => {
      expect(
        screen.getByText('This count was reassigned. Your session is no longer active.')
      ).toBeInTheDocument();
    });

    // Must not imply the tally was committed or discarded.
    expect(screen.queryByText(/discarded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/committed/i)).not.toBeInTheDocument();
  });
});
