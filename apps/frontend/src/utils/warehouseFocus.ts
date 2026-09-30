// apps/frontend/src/utils/warehouseFocus.ts
//
// WAREHOUSE-FOCUS-SHELL-01A/B — URL-backed execution-focus truth.
//
// Single pure predicate over URL search params, shared by every surface
// that needs to know "is the operator actively executing a Stow/Receive
// session right now" — no React context, no separate/duplicated session
// state. AppLayout (apps/frontend/src/layouts/AppLayout/index.tsx) derives
// its own topnav/sidenav visibility inline against the same URL contract;
// this helper exists so a second consumer (WmsFT2Page's module tab bar)
// reads the identical rule without re-deriving it ad hoc and risking drift.
//
// Contract:
//   warehouseFocus=stow    requires a present stowTaskId
//   warehouseFocus=receive requires a present receiveJobId
//   warehouseFocus=count   requires a present countTaskId
// Anything else (no warehouseFocus, or warehouseFocus naming a session
// whose matching identity param is absent — a stale/edited URL) is NOT
// focused.
export function isWarehouseExecutionFocused(
  searchParams: URLSearchParams
): boolean {
  const warehouseFocus = searchParams.get('warehouseFocus');
  if (warehouseFocus === 'stow') return Boolean(searchParams.get('stowTaskId'));
  if (warehouseFocus === 'receive') return Boolean(searchParams.get('receiveJobId'));
  if (warehouseFocus === 'count') return Boolean(searchParams.get('countTaskId'));
  return false;
}
