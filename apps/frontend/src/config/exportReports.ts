// apps/frontend/src/config/exportReports.ts
//
// CANONICAL EXPORT REPORT DEFINITIONS (GH #1014)
// Single source of truth — used by ShopSettingsReportsPage (Reports Hub)
// and ExportDrawer (module-level CTA). Never duplicate this list elsewhere.

export type ExportFormat = 'csv' | 'pdf';

export interface QuickReport {
  id: string;
  title: string;
  description: string;
  format: ExportFormat;
  tier: 'core' | 'growth';
  endpoint: string;
  body?: Record<string, unknown>;
  filename: string;
}

export const QUICK_REPORTS: QuickReport[] = [
  {
    id: 'brief',
    title: 'Daily Operations Brief',
    description: 'Decisions needed, revenue at risk, fulfillment pulse.',
    format: 'pdf',
    tier: 'growth',
    endpoint: '/api/v1/exports/brief',
    filename: 'lasyncro-brief',
  },
  {
    id: 'orders-all',
    title: 'All Orders',
    description: 'Full order list with status, value, channel, and country.',
    format: 'csv',
    tier: 'core',
    endpoint: '/api/v1/exports/orders',
    filename: 'lasyncro-orders',
  },
  {
    id: 'orders-blocked',
    title: 'Blocked Revenue Report',
    description: 'Orders with SLA breaches and revenue held.',
    format: 'csv',
    tier: 'core',
    endpoint: '/api/v1/exports/orders',
    body: { filters: { payment_state: ['paid'], status: ['blocked'] } },
    filename: 'lasyncro-blocked-orders',
  },
  {
    id: 'returns',
    title: 'Returns Analysis',
    description: 'Refunds, return reasons, and units returned per SKU.',
    format: 'csv',
    tier: 'core',
    endpoint: '/api/v1/exports/returns',
    filename: 'lasyncro-returns',
  },
  {
    id: 'finances',
    title: 'Finances & Margin',
    description: 'Order-level gross revenue, cost, and margin percentage.',
    format: 'csv',
    tier: 'core',
    endpoint: '/api/v1/exports/finances',
    filename: 'lasyncro-finances',
  },
];

export const TIER_ORDER: Record<string, number> = {
  starter: 0, core: 1, growth: 2, scale: 3,
};

export function isTierSufficient(userTier: string, required: 'core' | 'growth'): boolean {
  return (TIER_ORDER[userTier] ?? 0) >= TIER_ORDER[required];
}

export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  pdf: 'application/pdf',
};
