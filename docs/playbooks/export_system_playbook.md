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
POST /api/v1/exports/products
```

### Request Body (shared shape)
```json
{
  "format": "csv",
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
| Core    | CSV only   | 6 months    | Fixed set              | —         |
| Growth  | CSV only   | Unlimited   | Full column picker     | —         |
| Scale   | CSV only   | Unlimited   | Full + scheduled       | Daily/Weekly/Monthly |

### Date Window Enforcement
```ts
// Core: 6-month rolling window
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
`fulfillment_status`, `blocker_type`, `channel`, `sku_count`, `shipping_country`, `tags`

**Synthetic filter value:** `filters.status` accepts `'blocked'`, which resolves
against `order_constraints` (canonical blocker truth), not the
`fulfillment_status_type` enum. Unknown values return `400 INVALID_STATUS_FILTER`.

### Returns
`return_id`, `created_at`, `order_id`, `item_title`, `sku`,
`units_returned`, `return_reason`, `total_refund_amount`

### Products
`sku`, `title`, `status`, `unit_cost`, `on_hand`, `available`, `reserved`,
`extended_value`, `locations`

Variant grain: quantities summed across locations, bins rolled into one
cell (`A-1=6; B-3=4`). LEFT JOIN `inventory_truth` so SKUs with no stock
row still appear at zero - an accountant needs the complete SKU list.
`filters.status` is a plain `whereIn` against a varchar column; no
hardcoded whitelist. No date filtering - products are not a time series.

### Finances
`order_id`, `created_at`, `total_price`, `cost_of_goods`, `gross_margin`,
`gross_margin_pct`, `currency`, `channel`

---

## 6. Module-Level Export Touch Points

| Module / Submodule | CTA Label | Format | Tier Gate |
|---|---|---|---|
| Orders / Overview | `Export →` | CSV | Core+ |
| Orders / Blocked | `Export →` | CSV | Core+ |
| Returns | `Export →` | CSV | Core+ |
| Finances | `Export →` | CSV | Core+ |
| Products / Inventory Valuation | `Export ->` | CSV | Core+ |
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

---

## 9. Export Design Principle

Exports exist to move reusable operational data outside LaSyncro for analysis,
accounting, reconciliation, and sharing. Do not create exports that merely
duplicate summaries already available inside the product.

## 10. Sprint Roadmap

| Sprint | Scope |
|--------|-------|
| **Sprint 1** (current) | Backend engine, CSV for Orders + Returns + Finances, download-only, Core+ gating. Ghost pill CTAs on key pages. Quick Reports tab stub. |
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
7. Frontend CTAs: always Tier 2 ghost pill, always pre-filtered to current view.
8. Never duplicate column definitions - canonical lists live in
   `exports.controller.ts` (ORDERS_/RETURNS_/FINANCES_/PRODUCTS_COLUMNS).
9. NEVER `COALESCE` an enum column against a string literal. Postgres
   resolves COALESCE argument types at parse time, so a non-member literal
   throws before a single row is read. Cast first:
   `COALESCE(col::text, '-')`. This shipped twice (EXP-BLOCKED-02,
   EXP-RETURNS-06) and both reports 500d for months.
10. Validate every client-supplied filter value BEFORE it reaches Knex.
    Bad input is a 400, never a 500. Extend `InvalidFilterError` so each
    catch needs one `instanceof` check, and add the 400 branch to EVERY
    handler - not just the one you are editing.
11. Every export must emit a header line on zero rows. `headers: true`
    infers columns from row one and emits NOTHING when there are none;
    use an explicit array plus `alwaysWriteHeaders`. Fresh tenants and
    quiet days are the normal case, not an edge case.
12. Log the Postgres error `code` via `pgErrorInfo()` on every failure.
    Response bodies stay generic; operators need the code in logs.
13. Timestamps: `to_char(col AT TIME ZONE shops.timezone,
    'YYYY-MM-DD HH24:MI:SS')`. Space-separated, not ISO 8601 - Excel
    parses the former as a date and the latter as text. ORDER BY the raw
    timestamptz, never the formatted string.

## 12. Changelog

- **2026-08-20** — EXP-PRODUCTS-11: added the Products export
  (`POST /api/v1/exports/products`), delivering the inventory valuation
  (`unit_cost x on_hand`) that section 6 scheduled for Sprint 2 and that never
  shipped. Merchants previously had no way to produce the one artifact an
  accountant asks for every month-end. Variant grain, LEFT JOIN
  `inventory_truth` so the 3-of-17 SKUs with no stock row still appear at
  zero rather than silently vanishing from the valuation. Verified: 17 rows,
  183 units, $35,661.60, recomputed from the emitted CSV; no cross-tenant
  leakage against a 4-shop local DB.

- **2026-08-20** — EXP-DATEFILTER-07: `filters.date_from`/`date_to` went
  through bare `new Date()` into Knex. Malformed input became
  `0NaN-NaN-NaNTNaN...`, hit Postgres as garbage (22007) and returned 500.
  Only `exportOrders` had a 400 branch, so Returns and Finances would have
  surfaced even a correct validation throw as a server error. Added
  `InvalidFilterError` base class, `parseDateFilter()`, and the 400 branch to
  all three handlers. Semantics deliberately unvalidated - `date_from >
  date_to` is a legitimate zero-row query.

- **2026-08-20** — EXP-EMPTY-08: zero-row exports downloaded a 0-byte file.
  `headers: true` infers columns from the first written row, so with no rows
  nothing was emitted at all. This was the default outcome on a fresh Shopify
  tenant and on any quiet day. Added explicit column arrays plus
  `alwaysWriteHeaders` (which throws without a real array - `true` does not
  satisfy it).

- **2026-08-20** — EXP-RETURNS-06: `/exports/returns` 500d on every call.
  `COALESCE(re.return_reason, '-')` targeted enum `return_reason_type`;
  Postgres failed at parse time regardless of row count. Fixed with `::text`,
  same cast applied to the latent `ofs.status` instance. Added `pgErrorInfo()`
  so the PG code reaches the logs - both prior 500s were invisible for months
  because only `err.message` was captured.

- **2026-08-20** — EXP-DATE-03: timestamps exported as
  `Wed Aug 19 2026 14:40:03 GMT+0200 (...)`, which Excel imports as text.
  Now formatted in SQL to the merchant's own timezone via a `shops` join.

- **2026-08-19** — EXP-BLOCKED-02: the Blocked Revenue Report returned
  HTTP 500 on every click since it was added. `filters.status: ['blocked']`
  was passed into `whereIn('ofs.status', ...)` against enum
  `fulfillment_status_type`, which has no `blocked` member — Postgres threw,
  and the generic catch masked it as `EXPORT_FAILED`. `'blocked'` is now
  intercepted before the enum comparison and resolved via `EXISTS` against
  `order_constraints` (EXISTS, not JOIN — a JOIN fans an order out into one
  row per constraint, inflating both row count and summed revenue). Added
  `blocker_type` column (aggregated `constraint_type`). Unknown status values
  now throw `InvalidStatusFilterError` → `400 INVALID_STATUS_FILTER` instead
  of surfacing as a raw DB error. Report description corrected from "SLA
  breaches and revenue held" to constraint-based wording — the SLA card
  (4 orders / $740) and constraint truth (3 orders / $179.85) are different
  sets; splitting them is tracked as EXP-SEMANTIC-04.

- **2026-08-19** — Removed the Daily Operations Brief PDF from the export
  system. The report duplicated Overview information without providing
  reusable operational data. Removed the Overview export CTA, `/exports/brief`
  endpoint, `brief_exported` activation milestone, and the now-unused `pdfkit`
  dependency. Historical `brief_exported` audit rows remain untouched.

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
- **2026-07-17** — Core-tier date window updated from 12 months to 6
  months, matching a broader Starter/Core window revision (see
  `monetization_billing_playbook.md`). Also fixed: this controller had
  its own private, hardcoded `tierDataWindowSince()` duplicate instead
  of importing the shared `@lasyncro/backend-core/utils/tierDataWindow.js`
  utility — meant it had silently drifted out of sync and was still
  enforcing the old 12-month window even after the canonical constant
  changed. Replaced with an import; §4 table and inline code comment
  both updated to reflect 6 months.
