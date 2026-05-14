// apps/frontend/src/pages/ft2-pages/ReturnsFT2Page.tsx
//
// ReturnsFT2Page
// --------------
// Gate + tab router for the Returns module.
// Mirrors FinancesFT2Page pattern — ModuleTabBar owns navigation,
// child pages own their own data fetching.
//
// Tabs:
//   /returns            → Overview   (owner pulse — return rate, leakage, reasons, calendar)
//   /returns/items      → Returned Items (operator — items back in warehouse needing a decision)
//   /returns/suppliers  → Suppliers  (growth tier — supplier return rate scorecard + batch drill-down)

import { Routes, Route } from 'react-router-dom';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import ReturnsOverviewPage from './ReturnsOverviewPage';
import ReturnsItemsPage from './ReturnsItemsPage';
import ReturnsSuppliersPage from './ReturnsSuppliersPage';

export default function ReturnsFT2Page() {
  return (
    <>
      <ModuleTabBar tabs={[
        { id: 'overview',   label: 'Overview',        path: '/returns' },
        { id: 'items',      label: 'Returned Items',  path: '/returns/items' },
        {
          id: 'suppliers',
          label: 'Suppliers',
          path: '/returns/suppliers',
          // Growth tier — supplier scorecard requires returns.analysis entitlement
          feature: 'returns.analysis',
          requiredTier: 'growth',
        },
      ]} />
      <Routes>
        <Route path="/"          element={<ReturnsOverviewPage />} />
        <Route path="/items"     element={<ReturnsItemsPage />} />
        <Route path="/suppliers" element={<ReturnsSuppliersPage />} />
      </Routes>
    </>
  );
}