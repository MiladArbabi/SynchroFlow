// apps/frontend/src/config/exportReports.ts
//
// CANONICAL EXPORT REPORT DEFINITIONS (GH #1014)
// Single source of truth — used by ShopSettingsReportsPage (Reports Hub)
// and ExportDrawer (module-level CTA). Never duplicate this list elsewhere.
//
// COMMERCIAL-ACCESS-ARCH-01 P0-A3-1: this file owns NO commercial tier
// authority. Every active report is a standard export, gated by the single
// canonical `exports.core` capability (packages/commercial-policy). Callers
// (ExportDrawer, ShopSettingsReportsPage) resolve the AccessDecision for
// `report.capabilityId` via `useCommercialAccess()` — never a private
// tier-rank map or a report-local eligibility helper.

export type ExportFormat = 'csv' | 'pdf';

export interface QuickReport {
  id: string;
  title: string;
  description: string;
  format: ExportFormat;
  /** Canonical commercial capability — @lasyncro/commercial-policy owns its requirement (currently exports.core, Core+). */
  capabilityId: 'exports.core';
  endpoint: string;
  body?: Record<string, unknown>;
  filename: string;
}

export const QUICK_REPORTS: QuickReport[] = [
  {
    id: 'orders-all',
    title: 'All Orders',
    description: 'Full order list with status, value, channel, and country.',
    format: 'csv',
    capabilityId: 'exports.core',
    endpoint: '/api/v1/exports/orders',
    filename: 'lasyncro-orders',
  },
  {
    id: 'orders-outbound',
    title: 'Shipped Orders',
    description: 'Physically shipped orders with ship date, tracking, carrier, and live status.',
    format: 'csv',
    capabilityId: 'exports.core',
    endpoint: '/api/v1/exports/orders/outbound',
    filename: 'lasyncro-outbound-orders',
  },
  {
    id: 'returns',
    title: 'Returns Analysis',
    description: 'Refunds, return reasons, and units returned per SKU.',
    format: 'csv',
    capabilityId: 'exports.core',
    endpoint: '/api/v1/exports/returns',
    filename: 'lasyncro-returns',
  },
  /* FINANCES — module disabled (EXP-FINANCES-ORPHANED-139).
     Restore together with the route and nav entry. */
  /* {
    id: 'finances',
    title: 'Finances & Margin',
    description: 'Order-level gross revenue, cost, and margin percentage.',
    format: 'csv',
    capabilityId: 'exports.core',
    endpoint: '/api/v1/exports/finances',
    filename: 'lasyncro-finances',
  }, */
  {
    id: 'products',
    title: 'Inventory Valuation',
    description: 'On-hand units, unit cost, extended value, and locations per SKU.',
    format: 'csv',
    capabilityId: 'exports.core',
    endpoint: '/api/v1/exports/products',
    filename: 'lasyncro-products',
  },
];

export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  pdf: 'application/pdf',
};
