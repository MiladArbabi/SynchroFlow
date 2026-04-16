// apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx
import { SuppliersPortalModuleFT2 } from '@lasyncro/suppliers-portal';
import { useSuppliersPortal } from '../suppliers-portal/useSuppliersPortal';

/**
 * SUPPLIERS PORTAL GATE PAGE
 * ---------------------------
 * Thin wrapper — data fetching via useSuppliersPortal hook,
 * injected as props into the dumb SuppliersPortalPage module component.
 *
 * All HTTP calls live here — module stays decoupled.
 */
export default function SuppliersPortalPage() {
  const { data, isLoading, isError, refetch } = useSuppliersPortal();

  return (
    <SuppliersPortalModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onRefresh={refetch}
    />
  );
}