// apps/frontend/src/pages/ft2-pages/settingsTabs.ts
//
// Shared tab config for Shop Settings surfaces.
// Extracted from ShopSettingsPage.tsx (ISS-052) because co-locating a
// plain-value export with a component export breaks
// react-refresh/only-export-components. Consumed by:
//   - ShopSettingsPage.tsx  (renders the /settings/* subtree)
//   - MembersPage.tsx       (renders /team, outside that subtree —
//                             see ISS-048/ISS-051, product-structure.md §4/§5)
export const SETTINGS_TABS = [
  { id: 'general',       label: 'General',       path: '/settings'      },
  { id: 'carriers',      label: 'Carriers',       path: '/settings/carriers'      },
  { id: 'warehouse',     label: 'Warehouse',      path: '/settings/warehouse'     },
  { id: 'finance',       label: 'Finance',        path: '/settings/finance'       },
  { id: 'localization',  label: 'Localization',   path: '/settings/localization'  },
  { id: 'notifications', label: 'Notifications',  path: '/settings/notifications' },
  { id: 'integrations',  label: 'Integrations',   path: '/settings/integrations'  },
  { id: 'billing',       label: 'Billing',        path: '/settings/billing'       },
  { id: 'reports',       label: 'Reports',        path: '/settings/reports'       },
  { id: 'team',          label: 'Team',           path: '/team'                   },
];