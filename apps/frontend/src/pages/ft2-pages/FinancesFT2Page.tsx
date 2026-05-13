// apps/frontend/src/pages/ft2-pages/FinancesFT2Page.tsx
//
// FinancesFT2Page
// ---------------
// Gate + tab router for the Finances module.
// Mirrors ProductsFT2Page pattern — ModuleTabBar owns navigation,
// child pages own their own data fetching.
//
// Tabs:
//   /finances            → Intelligence (daily pulse — net margin, blocked revenue at margin, SKU alerts)
//   /finances/margin     → Margin       (per-order + per-SKU margin breakdown)
//   /products/costs      → Cost Health  (missing costs, coverage %, bulk fix)

import { Routes, Route } from 'react-router-dom';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { PlanGate } from '../../components/PlanGate';
import FinancesIntelligencePage from './FinancesIntelligencePage';
import FinancesMarginPage from './FinancesMarginPage';

export default function FinancesFT2Page() {
  return (
    <PlanGate feature="finances.overview">
      <>
        <ModuleTabBar tabs={[
          { id: 'intelligence', label: 'Intelligence', path: '/finances' },
          { id: 'margin',       label: 'Margin',       path: '/finances/margin' },
        ]} />
        <Routes>
          <Route path="/"        element={<FinancesIntelligencePage />} />
          <Route path="/margin"  element={<FinancesMarginPage />} />
        </Routes>
      </>
    </PlanGate>
  );
}