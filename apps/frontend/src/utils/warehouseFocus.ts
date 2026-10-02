// apps/frontend/src/utils/warehouseFocus.ts
//
// WAREHOUSE-FOCUS-SHELL-01A/B — URL-backed execution-focus truth.
//
// Single pure predicate over URL search params, shared by every surface
// that needs to know "is the operator inside a focused warehouse task
// session right now" — no React context, no separate/duplicated session
// state. AppLayout (apps/frontend/src/layouts/AppLayout/index.tsx) and
// WmsFT2Page's module tab bar both read this one rule, so the shell's
// chrome cannot drift between them.
//
// Contract:
//   warehouseFocus=stow    requires a present stowTaskId
//   warehouseFocus=receive requires a present receiveJobId
//   warehouseFocus=count   requires a present countTaskId
//   warehouseFocus=pick    requires a present batchId
//                          (WAREHOUSE-SESSION-FOCUS-02A — focused from the
//                          Pick Brief onward)
// Anything else (no warehouseFocus, or warehouseFocus naming a session
// whose matching identity param is absent — a stale/edited URL) is NOT
// focused.
export type WarehouseFocusSession = 'stow' | 'receive' | 'count' | 'pick';

export function getWarehouseFocusSession(
  searchParams: URLSearchParams
): WarehouseFocusSession | null {
  const warehouseFocus = searchParams.get('warehouseFocus');
  if (warehouseFocus === 'stow') return searchParams.get('stowTaskId') ? 'stow' : null;
  if (warehouseFocus === 'receive') return searchParams.get('receiveJobId') ? 'receive' : null;
  if (warehouseFocus === 'count') return searchParams.get('countTaskId') ? 'count' : null;
  if (warehouseFocus === 'pick') return searchParams.get('batchId') ? 'pick' : null;
  return null;
}

export function isWarehouseExecutionFocused(
  searchParams: URLSearchParams
): boolean {
  return getWarehouseFocusSession(searchParams) !== null;
}
