// apps/frontend/src/pages/ft2-pages/WmsFT2Page.tsx
//
// WmsFT2Page — Warehouse module shell
// ------------------------------------
// Gate + tab router. Mirrors ProductsFT2Page pattern.
// ModuleTabBar lives here — children never render their own.
// PlanGate lives here — children never re-gate.
//
// Children:
//   /wms            → WmsOperationsPage
//   /wms/analytics  → WmsAnalyticsPage
//
// Floor Planning (/floor-planning) and Problem Center (/problem-center)
// remain at escaped paths (K — ISS-234). ModuleTabBar links there correctly.
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { CommercialGate } from '../../components/CommercialGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { WAREHOUSE_MODULE_TABS } from './warehouseModuleTabs';
import { isWarehouseExecutionFocused } from '../../utils/warehouseFocus';

const WmsOperationsPage = lazy(() => import('./WmsOperationsPage'));
const WmsAnalyticsPage  = lazy(() => import('./WmsAnalyticsPage'));

// COMMERCIAL-ACCESS-ARCH-01 P0-A2B: warehouse.operations (Starter+) gates this
// subtree. /wms/analytics carries its OWN independent warehouse.analytics
// (Growth+) gate inside WmsAnalyticsPage — this outer gate must never imply
// analytics access.
export default function WmsFT2Page() {
  // WAREHOUSE-FOCUS-SHELL-01B — the same URL-backed warehouseFocus truth
  // AppLayout reads for topnav/sidenav also gates this module's own
  // Operations/Floor Planning/Analytics/Problem Center tab bar: unrelated
  // navigation during physical execution, hidden the same way. Brief
  // (warehouseFocus absent, or present but not naming this exact session)
  // keeps the tab bar; only the active-execution URL hides it. The actual
  // routed content below is untouched either way — this slice hides
  // navigation only, never the execution page itself.
  const [searchParams] = useSearchParams();
  const isExecutionFocused = isWarehouseExecutionFocused(searchParams);

  return (
    <CommercialGate capabilityId="warehouse.operations">
      {!isExecutionFocused && <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />}
      <Routes>
        <Route path="/"          element={<Suspense fallback={null}><WmsOperationsPage /></Suspense>} />
        <Route path="/analytics" element={<Suspense fallback={null}><WmsAnalyticsPage /></Suspense>} />
        <Route path="*"          element={<Navigate to="/wms" replace />} />
      </Routes>
    </CommercialGate>
  );
}
