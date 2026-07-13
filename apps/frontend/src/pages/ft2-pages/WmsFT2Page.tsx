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
import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import PlanGate from '../../components/PlanGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { WAREHOUSE_MODULE_TABS } from './warehouseModuleTabs';

const WmsOperationsPage = lazy(() => import('./WmsOperationsPage'));
const WmsAnalyticsPage  = lazy(() => import('./WmsAnalyticsPage'));

export default function WmsFT2Page() {
  return (
    <PlanGate feature="wms.pick_batches">
      <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />
      <Routes>
        <Route path="/"          element={<Suspense fallback={null}><WmsOperationsPage /></Suspense>} />
        <Route path="/analytics" element={<Suspense fallback={null}><WmsAnalyticsPage /></Suspense>} />
        <Route path="*"          element={<Navigate to="/wms" replace />} />
      </Routes>
    </PlanGate>
  );
}
