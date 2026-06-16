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
//   /settings/localization → Localization  (📋 placeholder — display currency, locale)
//   /settings/notifications→ Notifications (📋 placeholder — push prefs, alert routing)
//   /settings/integrations → Integrations  (📋 placeholder — non-carrier third-party)

import { Routes, Route } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import ShopSettingsGeneralPage      from './ShopSettingsGeneralPage';
import ShopSettingsCarriersPage     from './ShopSettingsCarriersPage';
import ShopSettingsWarehousePage    from './ShopSettingsWarehousePage';
import ShopSettingsFinancePage      from './ShopSettingsFinancePage';
import BillingSettings              from '../account-settings/BillingSettings';
import { PlaceholderTab }           from './ShopSettingsShared';

const SETTINGS_TABS = [
  { id: 'general',       label: 'General',       path: '/settings'               },
  { id: 'carriers',      label: 'Carriers',       path: '/settings/carriers'      },
  { id: 'warehouse',     label: 'Warehouse',      path: '/settings/warehouse'     },
  { id: 'finance',       label: 'Finance',        path: '/settings/finance'       },
  { id: 'localization',  label: 'Localization',   path: '/settings/localization'  },
  { id: 'notifications', label: 'Notifications',  path: '/settings/notifications' },
  { id: 'integrations',  label: 'Integrations',   path: '/settings/integrations'  },
  { id: 'billing',       label: 'Billing',        path: '/settings/billing'       },
];

export default function ShopSettingsPage() {
  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 0 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
          Shop Settings
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '2px', mb: 1.5 }}>
          Operational configuration for your shop.
        </Typography>
      </Box>

      <ModuleTabBar tabs={SETTINGS_TABS} />

      <Routes>
        <Route path="/"              element={<ShopSettingsGeneralPage />}   />
        <Route path="/carriers"      element={<ShopSettingsCarriersPage />}  />
        <Route path="/warehouse"     element={<ShopSettingsWarehousePage />} />
        <Route path="/finance"       element={<ShopSettingsFinancePage />}   />
        <Route path="/localization"  element={
          <PlaceholderTab
            title="Localization"
            description="Display currency, date format, and locale preferences — coming soon."
          />
        } />
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
      </Routes>
    </Box>
  );
}
