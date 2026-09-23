// apps/frontend/src/pages/ft2-pages/ShopSettingsPage.tsx
//
// SHOP SETTINGS PAGE — /settings
// --------------------------------
// Thin tab router. ModuleTabBar owns navigation.
// Each tab is a self-contained page component.
//
// Tab taxonomy:
//   /settings              → General       (Fulfillment SLA)
//   /settings/carriers     → Carriers      (CPT + Carrier Integration WM-38)
//   /settings/warehouse    → Warehouse     (Floor Display; future: batch/auto-release WM-35)
//   /settings/finance      → Finance       (Cash Flow Inputs)
//   /settings/localization → Localization  (display currency preference — ISS-124, 2026-07-09)
//   /settings/alerts       → Alerts        (shared AlertsSettingsPanel — same UI as /alerts/settings, GH-1147)
//   /settings/billing      → Billing
//   /settings/reports      → Reports
//
// Retired (GH-1147) — legacy URLs canonicalize to Alerts, no placeholder content:
//   /settings/notifications→ /settings/alerts
//   /settings/integrations → /settings/alerts

import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
import ShopSettingsGeneralPage      from './ShopSettingsGeneralPage';
import ShopSettingsCarriersPage     from './ShopSettingsCarriersPage';
import ShopSettingsWarehousePage    from './ShopSettingsWarehousePage';
import ShopSettingsFinancePage      from './ShopSettingsFinancePage';
import BillingSettings              from '../account-settings/BillingSettings';
import ShopSettingsReportsPage      from './ShopSettingsReportsPage';
import LocalizationSettings         from '../account-settings/LocalizationSettings';
import AlertsSettingsPanel          from '../alerts/AlertsSettingsPanel';
import { SettingsPageWrapper }      from './ShopSettingsShared';
import { SettingsShellHeader } from './SettingsShellHeader';

export default function ShopSettingsPage() {
  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <SettingsShellHeader />

      <Routes>
        <Route path="/"              element={<ShopSettingsGeneralPage />}   />
        <Route path="/carriers"      element={<ShopSettingsCarriersPage />}  />
        <Route path="/warehouse"     element={<ShopSettingsWarehousePage />} />
        <Route path="/finance"       element={<ShopSettingsFinancePage />}   />
        <Route path="/localization"  element={<LocalizationSettings />} />
        <Route path="/alerts"        element={
          <SettingsPageWrapper>
            <AlertsSettingsPanel />
          </SettingsPageWrapper>
        } />
        <Route path="/notifications" element={<Navigate to="/settings/alerts" replace />} />
        <Route path="/integrations"  element={<Navigate to="/settings/alerts" replace />} />
        {/* Billing — plan, usage meters, upgrade/downgrade (UX-02) */}
        <Route path="/billing" element={<BillingSettings />} />
        {/* Reports Hub — export templates + history (GH #1014 Sprint 2) */}
        <Route path="/reports" element={<ShopSettingsReportsPage />} />
      </Routes>
    </Box>
  );
}
