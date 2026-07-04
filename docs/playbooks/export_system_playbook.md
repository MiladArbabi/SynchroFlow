# LaSyncro — Export System Playbook

> **Scope:** Unified data export across all operator-facing modules.
> **GH Issue:** #1014
> **Last updated:** 2026-06-16
> **Sprint:** Export System — Sprint 1

---

## 1. Vision

SMB commerce operators (1–20 operators, own warehouse, $100K–$50M/yr, high SKU complexity) suffer daily from:

- Excel chaos — data lives in 5 different spreadsheets
- Data silos — Shopify, WMS, returns, finances never in one place
- Manual extraction — screenshot → paste → format → send → repeat
- Accountant bottleneck — month-end CSV dump takes 3 days to clean

LaSyncro's export system eliminates this by making every operational dataset instantly exportable, formatted, and deliverable — from inside the module where the operator already is.

---

## 2. Architecture

### Two Entry Points, One Engine

```
Module-level CTA               Reports Hub (/settings/reports)
(Export → per page)       →    (Cross-module, scheduled,
                                saved templates)
         ↓                              ↓
    POST /api/v1/exports/:resource
         ↓
    Sync stream (Sprint 1) → Async queue (Sprint 3)
         ↓
    Download / Email / Webhook
```

### Sync Stream (Sprint 1)
Request → generate → stream file directly. Suitable for SMB volumes (<10K rows).

### Async Queue (Sprint 3, scheduled delivery)
Request → enqueue job → worker generates → ready signal → download/email.

---

## 3. API Design

### Sprint 1 Endpoints

```
POST /api/v1/exports/orders
POST /api/v1/exports/returns
POST /api/v1/exports/finances
POST /api/v1/exports/brief
```

### Request Body (shared shape)
```json
{
  "format": "csv" | "pdf",
  "filters": {
    "date_from": "2025-01-01",
    "date_to": "2025-12-31",
    "status": ["fulfilled", "cancelled"],
    "payment_state": ["paid"]
  },
  "columns": ["order_id", "created_at", "total"]
}
```

### Response
Direct file stream with appropriate `Content-Type` and `Content-Disposition` headers.

---

## 4. Tier Gating

| Tier    | Format     | Date Range  | Column Selection       | Scheduled |
|---------|------------|-------------|------------------------|-----------|
| Starter | None       | —           | —                      | —         |
| Core    | CSV only   | 12 months   | Fixed set              | —         |
| Growth  | CSV + PDF  | Unlimited   | Full column picker     | —         |
| Scale   | CSV + PDF  | Unlimited   | Full + scheduled       | Daily/Weekly/Monthly |

### Date Window Enforcement
```ts
// Core: 12-month rolling window
const tierDataWindowSince = (tier: Tier): Date | null => {
  if (tier === 'core') {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  return null; // growth/scale = unlimited
};
```

---

## 5. Available Columns

### Orders
`order_id`, `created_at`, `total_price`, `currency`, `payment_state`,
`fulfillment_status`, `channel`, `sku_count`, `shipping_country`, `tags`

### Returns
`return_id`, `created_at`, `order_id`, `variant_title`, `sku`,
`units_returned`, `return_reason`, `decision`, `supplier_name`, `return_rate_pct`

### Finances
`order_id`, `created_at`, `total_price`, `cost_of_goods`, `gross_margin`,
`gross_margin_pct`, `currency`, `channel`

### Morning Brief (PDF only)
Operational snapshot: decisions needed, revenue at risk, fulfillment pulse,
blocked orders, SLA breaches, top alerts.

---

## 6. Module-Level Export Touch Points

| Module / Submodule | CTA Label | Format | Tier Gate |
|---|---|---|---|
| Overview | `Export brief →` | PDF | Growth+ |
| Orders / Overview | `Export →` | CSV | Core+ |
| Orders / Blocked | `Export →` | CSV | Core+ |
| Returns | `Export →` | CSV | Core+ |
| Finances | `Export →` | CSV | Core+ |
| Inventory (Sprint 2) | `Export →` | CSV | Core+ |
| WMS Analytics (Sprint 2) | `Export →` | CSV | Core+ |
| Orders / Outbound | `Export →` | CSV | Core+ |

### CTA Placement Rule
- Always a **Tier 2 ghost pill** (per CTA playbook §2)
- Placed top-right of page header, alongside any existing action buttons
- Pre-filtered to current view (date range, status filters applied)
- Opens a lightweight **drawer** (not modal) with format picker

---

## 7. Reports Hub — `/settings/reports`

New tab in `ShopSettingsPage` alongside General, Carriers, Warehouse, Finance, Billing.

### Sprint 1 — Quick Reports panel
One-click pre-built templates:
- Daily Operations Brief (PDF) — Growth+
- Blocked Revenue Report (CSV)
- Returns Analysis (CSV)
- Inventory Health (CSV) — Sprint 2
- Cash Flow Summary (CSV) — Growth+
- Fulfillment SLA Report (CSV)

### Sprint 2 — Report History
- Last 30 exports, 7-day file retention
- Re-download links
- Export metadata (resource, format, date range, generated at)

### Sprint 3 — Custom Report Builder + Scheduled Delivery
- Resource picker
- Column selector (tier-gated)
- Date range (tier-gated window)
- Filters: status, channel, SKU, supplier
- Format: CSV / PDF
- Delivery: Download / Email / Scheduled (Scale)

---

## 8. Backend File Structure

```
apps/backend/src/api/exports/
  exports.controller.ts     — handlers for each resource
  exports.routes.ts         — route declarations + tier gating
```

### Packages
- `fast-csv@^5.0.7` — CSV generation (streaming)
- `pdfkit@^0.19.1` — PDF generation
- `@types/pdfkit@^0.17.6` — TypeScript types

---

## 9. PDF Brief Format

```
┌─────────────────────────────────────────┐
│  LaSyncro                    [date/time] │
│  Daily Operations Brief                  │
│  {shop name}                             │
├─────────────────────────────────────────┤
│  NEEDS A DECISION              {count}   │
│  • {signal title} — ${revenue}           │
├─────────────────────────────────────────┤
│  TODAY'S FLOW                            │
│  Ready to ship    {n}                    │
│  Blocked          {n}                    │
│  Breached 72h+    {n}                    │
├─────────────────────────────────────────┤
│  ALERTS                        {count}   │
│  • {alert title}                         │
└─────────────────────────────────────────┘
```

---

## 10. Sprint Roadmap

| Sprint | Scope |
|--------|-------|
| **Sprint 1** (current) | Backend engine, CSV for Orders + Returns + Finances, PDF brief, download-only, Core+ gating. Wire Overview Export brief. Ghost pill CTAs on key pages. Quick Reports tab stub. |
| **Sprint 2** | Report History, Inventory + WMS export, Export drawer UI with column picker. |
| **Sprint 3** | Email delivery (Resend), async queue, PDF for all modules. |
| **Sprint 4** | Scheduled delivery (Scale tier), Custom Report Builder. |

---

## 11. Rules for Future Engineers

1. All export endpoints live under `/api/v1/exports/` — never scatter into module routes.
2. Always gate with `requireTier('core')` minimum — Starter gets nothing.
3. Enforce `tierDataWindowSince()` for date range — never trust client-supplied dates blindly.
4. Stream directly — never buffer entire dataset in memory.
5. Content-Disposition header must always be `attachment` — never `inline`.
6. CSV: use `fast-csv` write stream piped to `res`.
7. PDF: use `pdfkit` doc piped to `res`.
8. Frontend CTAs: always Tier 2 ghost pill, always pre-filtered to current view.
9. Never duplicate column definitions — canonical list lives in `exports.controller.ts`.

## 12. Changelog

- **2026-06-24** — Overview's `Export brief →` CTA now opens `ExportDrawer` (page-level fixed slide-in, per §6 CTA Placement Rule) instead of hardcoding the PDF brief download. Drawer offers Brief (PDF), All Orders / Returns / Finances (CSV) — reuses existing Sprint 1 endpoints, no new backend work. Canonical report list moved from `ShopSettingsReportsPage.tsx` to `apps/frontend/src/config/exportReports.ts` (single source, both surfaces import it). True `.xlsx` still not implemented — tracked separately.
- **2026-06-30** — Orders module's `Export →` CTA (ORDM-01) fixed: was a
  hardcoded blob-download bypassing the drawer entirely, despite §6
  specifying the standard drawer pattern. Now opens `ExportDrawer` with
  `reportIds={['orders-all', 'orders-blocked']}` — both report IDs
  already existed in `exportReports.ts`, unused until now. No backend
  work needed.
- **2026-07-04** — Orders/Outbound's `Export →` CTA (ISS-03) fixed: same
  bug class as ORDM-01, never applied here — `handleExportOutbound` was
  a hardcoded `axiosInstance.post(..., { responseType: 'blob' })` +
  synthetic `<a>` click, bypassing the drawer entirely. Added a new
  `orders-outbound` report to `QUICK_REPORTS` (`exportReports.ts`) —
  `{ filters: { status: ['fulfilled'] } }`, since no existing report ID
  matched Outbound's fulfilled-only filter shape. Button's `onClick`
  now just opens `ExportDrawer` with `reportIds={['orders-outbound']}`;
  visual styling was already correct Tier 2 ghost pill, untouched.
