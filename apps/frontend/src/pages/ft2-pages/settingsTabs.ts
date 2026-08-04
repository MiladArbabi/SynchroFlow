// apps/frontend/src/pages/ft2-pages/settingsTabs.ts
//
// Shared navigation contract for the searchable settings modal.
// Route paths remain unchanged because banners, operational CTAs, billing
// redirects, and Team details already deep-link into these destinations.
// Kept separate from the component to satisfy react-refresh boundaries.
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