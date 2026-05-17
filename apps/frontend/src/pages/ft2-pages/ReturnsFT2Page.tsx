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
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import ReturnsOverviewPage from './ReturnsOverviewPage';
import ReturnsItemsPage from './ReturnsItemsPage';
import ReturnsSuppliersPage from './ReturnsSuppliersPage';

export default function ReturnsFT2Page() {
  return (
    <>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <Routes>
        <Route path="/"          element={<ReturnsOverviewPage />} />
        <Route path="/items"     element={<ReturnsItemsPage />} />
        <Route path="/suppliers" element={<ReturnsSuppliersPage />} />
      </Routes>
    </>
  );
}