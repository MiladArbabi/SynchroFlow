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
//   /settings/notifications→ Notifications (📋 placeholder — push prefs, alert routing)
//   /settings/integrations → Integrations  (📋 placeholder — non-carrier third-party)

import { Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import ShopSettingsGeneralPage      from './ShopSettingsGeneralPage';
import ShopSettingsCarriersPage     from './ShopSettingsCarriersPage';
import ShopSettingsWarehousePage    from './ShopSettingsWarehousePage';
import ShopSettingsFinancePage      from './ShopSettingsFinancePage';
import BillingSettings              from '../account-settings/BillingSettings';
import ShopSettingsReportsPage      from './ShopSettingsReportsPage';
import { PlaceholderTab }           from './ShopSettingsShared';
import LocalizationSettings         from '../account-settings/LocalizationSettings';
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
        <Route path="/notifications" element={
          <PlaceholderTab
            title="Notifications"
            description="Push notification preferences, alert thresholds, and email routing — coming soon."
          />
        } />
        <Route path="/integrations"  element={
          <PlaceholderTab
            title="Integrations"
            description="Third-party connections (accounting, ERP, and more) — coming soon."
          />
        } />
        {/* Billing — plan, usage meters, upgrade/downgrade (UX-02) */}
        <Route path="/billing" element={<BillingSettings />} />
        {/* Reports Hub — export templates + history (GH #1014 Sprint 2) */}
        <Route path="/reports" element={<ShopSettingsReportsPage />} />
      </Routes>
    </Box>
  );
}
