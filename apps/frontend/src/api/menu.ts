// apps/frontend/src/api/menu.ts
import { useMemo } from 'react';
import useConfig from 'hooks/useConfig';

// This is our new "getter" that replaces useGetMenuMaster
// It hooks into our *existing* ConfigContext.
export function useGetMenuMaster() {
  const { state } = useConfig();

  // We are aliasing `miniDrawer` to `isDashboardDrawerOpened`
  // so we don't have to refactor all the Nav components.
  const memoizedValue = useMemo(
    () => ({
      menuMaster: {
        isDashboardDrawerOpened: state.miniDrawer
      },
      menuMasterLoading: false
    }),
    [state.miniDrawer]
  );

  return memoizedValue;
}

// This is our new "setter" that replaces handlerDrawerOpen
// It dispatches an action to our *existing* ConfigContext.
export function handlerDrawerOpen(isDashboardDrawerOpened: boolean) {
  // This is a bit of a hack, but we need to dispatch.
  // We'll get the dispatch from the context where we call this,
  // or we'll enhance this hook later.
  // For now, let's just log it.
  console.log(`[menu.ts] Request to set drawer open: ${isDashboardDrawerOpened}`);
  
  // A proper implementation would be:
  // const { dispatch } = useConfig();
  // dispatch({ type: 'SET_MINI_DRAWER', payload: isDashboardDrawerOpened });
  // But we can't call a hook inside a non-hook function.
  // We'll fix this in the NavItem component itself.
}

// This is the old SWR-based menu fetch. We'll stub it out for now.
// We'll replace this with our routes.tsx data later.
export function useGetMenu() {
  const memoizedValue = useMemo(
    () => ({
      menu: { items: [] }, // Return an empty menu
      menuLoading: false,
      menuError: null,
      menuValidating: false,
      menuEmpty: true
    }),
    []
  );

  return memoizedValue;
}