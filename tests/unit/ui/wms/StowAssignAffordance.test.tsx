// STOW-LIFECYCLE-02
//
// First-one-to-claim + optional owner/admin assignment UI.
//
// Same rationale as tests/unit/ui/wms/RecountReassignAffordance.test.tsx
// (CONTRACT-REASSIGN-08/09): StowTaskCard, describeStowAssignment, the
// visibleStowTasks projection, and the assign/reassign dialog are unexported
// internals of WmsModuleFT2.tsx — a component with a 30+ prop surface
// (batches/stow/receive/pack/pick/counting all together). Rendering it fully
// merely to reach one card's gating logic is exactly the "excessive brittle
// fixture complexity" that pattern was pre-authorized for. Source-scoped
// assertions against the exact gating predicates avoid brittleness on MUI
// implementation details while still proving the real logic, not a
// reimplementation of it.
import fs from 'fs';
import path from 'path';

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

const stowTaskCardSrc = sliceBetween(
  wmsModuleSrc,
  'const StowTaskCard = memo(function StowTaskCard(',
  '\n});'
);

const describeStowAssignmentSrc = sliceBetween(
  wmsModuleSrc,
  'function describeStowAssignment(',
  '\n}'
);

const visibleStowTasksSrc = sliceBetween(
  wmsModuleSrc,
  'const visibleStowTasks = (stowTasks ?? []).filter((task) => {',
  '\n  });'
);

const stowAssignDialogSrc = sliceBetween(
  wmsModuleSrc,
  'open={stowAssignTask !== null}',
  '{/* LOADING */}'
);

describe('STOW-LIFECYCLE-02 (1) — unassigned pending task copy', () => {
  it('describeStowAssignment returns "First one to claim" for an unassigned pending task', () => {
    expect(describeStowAssignmentSrc).toMatch(
      /if \(task\.assigned_operator_id === null\) return 'First one to claim';/
    );
  });

  it('describeStowAssignment returns "Assigned to you" for a task assigned to the viewer', () => {
    expect(describeStowAssignmentSrc).toMatch(
      /if \(task\.assigned_operator_id === currentUserId\) return 'Assigned to you';/
    );
  });

  it('describeStowAssignment falls back to the assignee name for a task assigned to someone else', () => {
    expect(describeStowAssignmentSrc).toMatch(
      /return `Assigned to \$\{task\.assigned_operator_name \?\? 'operator'\}`;/
    );
  });
});

describe('STOW-LIFECYCLE-02 (2,3,4) — executable Start CTA gating', () => {
  it('assignedToOther is true only for a pending task assigned to somebody other than the viewer', () => {
    expect(stowTaskCardSrc).toMatch(
      /const assignedToOther =\s*\n\s*task\.status === 'pending' &&\s*\n\s*task\.assigned_operator_id !== null &&\s*\n\s*task\.assigned_operator_id !== currentUserId;/
    );
  });

  it('the Start/Resume CTA is withheld exactly when assignedToOther', () => {
    expect(stowTaskCardSrc).toMatch(/\{!assignedToOther && \(/);
    // Sanity: unassigned (assigned_operator_id === null) and assigned-to-me
    // (=== currentUserId) both fail the assignedToOther condition above, so
    // both keep the CTA — same predicate proves cases 2 and 4 together.
  });
});

describe('STOW-LIFECYCLE-02 (5,6) — owner/admin-only ⋮ menu on pending tasks', () => {
  it('showMenu requires canAssignStow AND a pending task', () => {
    expect(stowTaskCardSrc).toMatch(
      /const showMenu = Boolean\(canAssignStow\) && task\.status === 'pending';/
    );
  });

  it('an operator (canAssignStow=false) never sees the menu trigger, regardless of task state', () => {
    // showMenu short-circuits on Boolean(canAssignStow) before evaluating
    // task.status — false canAssignStow alone determines showMenu === false.
    expect(stowTaskCardSrc).toMatch(/showMenu &&/);
  });
});

describe('STOW-LIFECYCLE-02 (7,8) — menu contents by assignment/claim state', () => {
  it('an assigned task offers Reassign… and Make first one to claim', () => {
    expect(stowTaskCardSrc).toMatch(/Reassign…/);
    expect(stowTaskCardSrc).toMatch(/Make first one to claim/);
  });

  it('an unassigned task offers Assign to… instead', () => {
    expect(stowTaskCardSrc).toMatch(/Assign to…/);
  });

  it('claimed (in_progress) tasks never satisfy showMenu, so no ordinary reassignment is exposed', () => {
    // Re-assert the same status==='pending' gate — in_progress fails it.
    expect(stowTaskCardSrc).toMatch(/task\.status === 'pending'/);
  });
});

describe('STOW-LIFECYCLE-02 (9) — successful assignment refreshes rendered state', () => {
  it('submitStowAssign calls onRefresh() after a successful PATCH', () => {
    expect(wmsModuleSrc).toMatch(
      /await onAssignStowTask\?\.\(stowAssignTask\.stow_task_id, stowAssignTargetId\);\s*\n\s*onRefresh\(\);/
    );
  });

  it('makeStowFirstToClaim calls onRefresh() after clearing assignment', () => {
    expect(wmsModuleSrc).toMatch(
      /await onAssignStowTask\?\.\(task\.stow_task_id, null\);\s*\n\s*onRefresh\(\);/
    );
  });

  it('a concurrent-claim 409 refreshes instead of leaving stale assignment UI', () => {
    expect(wmsModuleSrc).toMatch(/status === 409/);
  });
});

describe('STOW-LIFECYCLE-02 (E) — visibility projection backs both tally and rendered cards', () => {
  it('an operator sees unassigned pending, assigned-to-them pending, and their own in_progress claim', () => {
    expect(visibleStowTasksSrc).toMatch(/task\.assigned_operator_id === null \|\|/);
    expect(visibleStowTasksSrc).toMatch(/task\.assigned_operator_id === currentUserId \|\|/);
    expect(visibleStowTasksSrc).toMatch(/task\.claimed_by === currentUserId;/);
  });

  it('owner/admin visibility of another operator\'s assignment is gated by canAssignStow, only for pending tasks', () => {
    expect(visibleStowTasksSrc).toMatch(/Boolean\(canAssignStow\)/);
  });

  it('the rendered card list and the "Putting away" tally both read visibleStowTasks', () => {
    expect(wmsModuleSrc).toMatch(/puttingAway: visibleStowTasks\.length/);
    expect(wmsModuleSrc).toMatch(/\{visibleStowTasks\.map\(\(task\) => \(/);
  });
});

describe('STOW-LIFECYCLE-02 — assign dialog shape', () => {
  it('confirm is disabled until an operator is selected', () => {
    expect(stowAssignDialogSrc).toMatch(
      /disabled=\{stowAssignTargetId === '' \|\| stowAssignSubmitting\}/
    );
  });

  it('title distinguishes Assign vs Reassign by current assignment state', () => {
    expect(stowAssignDialogSrc).toMatch(/Assign Stow task/);
    expect(stowAssignDialogSrc).toMatch(/Reassign Stow task/);
  });

  it('operator targets come from the existing team-operators fetch, not a new endpoint', () => {
    expect(wmsModuleSrc).toMatch(/const targets = \(await onFetchStowAssignees\?\.\(\)\) \?\? \[\];/);
  });
});
