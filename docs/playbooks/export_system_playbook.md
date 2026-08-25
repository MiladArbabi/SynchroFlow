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
| Returns | `Export →` | CSV | Core+ |
| Finances | _(suppressed — module disabled, EXP-FINANCES-ORPHANED-139)_ | CSV | Core+ |
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

- **2026-08-20** — EXP-CTA-RETURNS: wired the Returns Overview `Export →`
  CTA to the canonical `ExportDrawer`, scoped to `reportIds={['returns']}`.
  Placement follows §6: top-right page header, Tier 2 ghost pill beside
  the primary `Scan a return` action. No backend changes; existing
  `POST /api/v1/exports/returns` remains the export engine.

- **2026-08-20** — EXP-BLOCKED-REMOVE: removed the pre-built Blocked
  Revenue report from `QUICK_REPORTS` and the Orders export drawer. It
  duplicated the All Orders export plus filters and did not justify a
  separate curated report. The backend synthetic `status: ['blocked']`
  filter remains supported and unchanged.

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

- **2026-06-24** — Overview's `Export brief →` CTA now opens `ExportDrawer` (page-level fixed slide-in, per §6 CTA Placement Rule) instead of hardcoding the PDF brief download. Drawer offers Brief (PDF), All Orders / Returns (CSV). **Superseded 2026-08-25: Overview has no ExportDrawer call site at all — see EXP-FINANCES-ORPHANED-139 §Verification** — reuses existing Sprint 1 endpoints, no new backend work. Canonical report list moved from `ShopSettingsReportsPage.tsx` to `apps/frontend/src/config/exportReports.ts` (single source, both surfaces import it). True `.xlsx` still not implemented — tracked separately.
- **2026-06-30** — Orders module's `Export →` CTA (ORDM-01) fixed: was a
  hardcoded blob-download bypassing the drawer entirely, despite §6
  specifying the standard drawer pattern. Now opens `ExportDrawer` with
  `reportIds={['orders-all', 'orders-blocked']}` at the time. The
  `orders-blocked` pre-built report was retired on 2026-08-20; the
  canonical backend `status: ['blocked']` filter remains supported.
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

## Unlocated sales (INV-SALE-LOCATION-19)

Shopify reports that a unit sold but never which shelf it left. The
reconciliation worker therefore books `sale` movements at the warehouse root
with `triggered_by = 'reconciliation_unlocated'`.

A negative root balance is expected, not a defect. It is reconciliation debt:
stock that left the building without a recorded bin.

Query outstanding debt:

    SET app.current_tenant = '<shop_id>';
    SELECT location_code, SUM(quantity_delta) AS unassigned_debt
    FROM inventory_movements
    WHERE triggered_by = 'reconciliation_unlocated'
    GROUP BY 1;

Do NOT resolve this by guessing a bin. Assigning the wrong bin makes two bins
wrong instead of one and sends a physical count to two wrong shelves. Count
sessions (INV-PHYSICAL-COUNT-13) resolve it — the operator supplies the bin.

Rows written before this marker keep `triggered_by = NULL`; movements are
immutable (BEFORE UPDATE/DELETE triggers RAISE), so they cannot be relabelled.
Any export column exposing bin-level stock must treat root rows as
"unassigned", never as a shelf location.

## Inventory in the deterministic rebuild (INV-REBUILD-COVERAGE-17)

`inventory_truth` is included in `computeStateHash` but is deliberately NOT in
`projectionTables` (the truncate registry) in `rebuild-from-events.ts`.

Rebuild therefore OBSERVES inventory state without reconstructing it. This is
intentional: `stow.service.ts` writes `inventory_truth` synchronously alongside
its movements, so an authoritative truncate+replay could overwrite real stock
if any writer produced state the ledger cannot reproduce.

`last_evaluated_at`, `updated_at`, and `created_at` are excluded from the hash —
they are runtime clocks and would change it on every run, detecting nothing.
Same rule as `orders.last_reconciled_at`.

Baseline hash on the dev fixture (31 rows / 183 on hand):

    4ee2fac720a1551d1ccae3953c17330ba8f051311b4f707b53990d59a83d8633

INV-REBUILD-REPLAY-21 (shipped): inventory_truth IS now truncated and replayed.
rebuildInventoryForAllShops() runs after replayEvents() and before the hash,
using a fixed epoch anchor (1970-01-01) rather than new Date() so two rebuilds
of the same events produce identical rows.

The ledger is therefore authoritative for inventory. Any writer that puts state
in inventory_truth which the movements cannot reproduce will now be silently
overwritten by rebuild — that writer is the bug (see INV-LEDGER-BYPASS-16).

Replay is NOT expected to reproduce the row set exactly as live writers left it:
sales carrying triggered_by='reconciliation_unlocated' contribute 0 to on_hand
(the CASE only counts sale when triggered_by='pick_scan'), so warehouse-root
groups materialise as zero-quantity rows. 14 rows became 31 on the dev fixture.
The invariant that matters is SUM(on_hand_quantity), not row count.

Verification: run the rebuild twice, redirecting to a file rather than piping
(a pipe truncates output and masks the exit code), and confirm the
inventory_truth hash is identical across runs.

## Inventory recount tasks (INV-PHYSICAL-COUNT-13)

Migration 0153 + service + HTTP surface shipped. Warehouse operator execution
UI is now shipped; printable count sheet remains future work.

The Warehouse surface owns physical execution only: `dispatched`, `claimed`, and
`counting` tasks are actionable there. `manual_review` belongs to the owner/admin
decision surface and is intentionally excluded from the floor list and Work tally.

Task-first, mirroring stow_tasks (0084). An owner/admin creates a recount task
and either assigns it (`assigned_to` set — only that operator may claim) or
dispatches it (`assigned_to` null, status `dispatched` — first claim wins).
One operator owns it at a time via `claimed_by`.

Lifecycle:

    draft -> dispatched -> claimed -> counting -> manual_review -> committed
                                              \-> (zero variance) -> committed

`manual_review` matches house vocabulary but is a DISTINCT mechanism from the
orders-domain `manual_review` (`order_constraints.constraint_type`, surfaced as
`queue_manual_review`). A recount session in `manual_review` must never feed
that metric, or the Orders module's Manual Review count silently starts
including inventory counts.

Two enforced invariants:

1. BLIND — operator counting is structurally blind. `POST /recount-tasks`
   rejects `blind=false`, `createRecountTask()` always persists `blind=true`,
   and `getOperatorLines()` never selects `expected_quantity`, including for
   legacy/non-blind rows. This is a server invariant, not a UI convention.
   Receive's auto-confirm-at-expected behaviour must NOT be copied here because
   that would reveal the expected quantity through behaviour.

2. DEFERRED CORRECTION (INV-PC-01) — `recordCount()` and `closeCount()` never
   write stock. Non-zero variance goes to `manual_review`; owner/admin accepts
   with a `variance_reason`, requests a recount (new line with
   `recount_of_line_id`), or escalates to `problem_center_tasks` with
   `source='count'` and `exception_type='recount_variance'`. Escalation
   transfers correction ownership to Problem Center, so `commitRecount()`
   excludes those lines. Only non-escalated accepted lines become
   `reconciliation_correction` movements.

`expected_quantity` is snapshotted when the line is created and never re-read.
Inventory movements occurring during a physical count therefore do not silently
change the quantity the operator is being compared against.

### Recount service (step 2, shipped)

`apps/backend/src/services/wms/inventoryRecount.service.ts` exports:

    selectSuggestedLines
    createRecountTask
    claimRecountTask
    getOperatorLines
    recordCount
    closeCount
    reviewLine
    commitRecount
    createRecountFinding
    listRecountFindings

Suggested scope keeps recounts short by selecting only inventory the ledger has
reason to distrust: negative on_hand, variants carrying unlocated sale debt,
and stock with no movement in 60 days. Warehouse-root rows are excluded because
there is no physical shelf for an operator to count.

`commitRecount()` is the runtime writer for `reconciliation_correction`.
Movement ids are deterministic UUIDv5 values derived from the recount line and
use `onConflict(device_event_id).ignore()`, preventing a retry from
double-correcting stock. It writes ledger movements and calls
`rebuildInventoryProjectionForVariants()`; it never writes `inventory_truth`
directly (INV-LEDGER-BYPASS-16).

### Recount HTTP surface (step 3, shipped 2026-08-21)

Controller:

`apps/backend/src/api/wms/inventoryRecount.controller.ts`

Routes are mounted beneath `/api/v1/wms` and use the standard chain:

    authenticateToken -> requireFt2 -> requireTier('core') -> requireAction(...)

Endpoints:

    POST /recount-tasks
      wms:recount:create
      Create a full/location/variant_set/suggested task.

    GET /recount-tasks/:taskId/lines
      wms:recount:read
      Returns operator lines. expected_quantity is never exposed during counting.

    GET /recount-tasks/:taskId/findings
      wms:recount:read
      Returns persisted physical findings for the recount task.

    POST /recount-tasks/:taskId/findings
      wms:recount:count
      Persists unexpected-item or defect evidence without changing inventory.
      client_event_id provides DB-enforced idempotency.

    POST /recount-tasks/:taskId/claim
      wms:recount:claim
      Claims an eligible dispatched task.

    POST /recount-tasks/:taskId/lines/:lineId/count
      wms:recount:count
      Records the observed quantity only; writes no inventory movement.

    POST /recount-tasks/:taskId/close
      wms:recount:count
      Zero variance -> committed. Any variance -> manual_review.

    POST /recount-tasks/:taskId/lines/:lineId/review
      wms:recount:review
      Owner/admin chooses accept, recount, or escalate.

    POST /recount-tasks/:taskId/commit
      wms:recount:commit
      Writes accepted reconciliation corrections and rebuilds affected truth.

`GET /recount-tasks` is the operator/owner task-list contract. The Warehouse
surface uses it for executable counting work, with privilege filtering enforced
server-side: operators see only work they may claim or already own, while
owner/admin responses may additionally include `variance_count`.

The remaining HTTP contract exposes the workflow actions required by the
operator/count UI.

### Recount permissions

`ACTION_ROLE_MAP`:

    wms:recount:create   owner, admin
    wms:recount:read     owner, admin, operator
    wms:recount:claim    owner, admin, operator
    wms:recount:count    owner, admin, operator
    wms:recount:review   owner, admin
    wms:recount:commit   owner, admin

Matching human-readable labels are registered in
`permissionSettings.service.ts` under the Warehouse domain.

### Recount audit trail

Controller/service wiring records:

    recount_create
    recount_claim
    recount_close
    recount_line_review
    recount_commit

`recount_commit` remains written by the service because the correction movement
and its audit record must share the same transaction. Create, claim, close, and
line review are written at the authenticated HTTP boundary where `req.user` is
available.

### Step 3 verification — 2026-08-21

Verified against a clean `DEV_SEED_MODE=full_data` fixture:

- fixture: 10 inventory ledger rows, 10 inventory_truth rows, 596 units;
- authenticated `/api/v1/wms/batches` remained HTTP 200;
- POST `/api/v1/wms/recount-tasks` reached the controller instead of Express
  404;
- blind A-1 task returned no `expected_quantity`;
- A-1 expected 88 / counted 88 / variance 0 auto-committed with no correction;
- A-2 expected 51 / counted 50 / variance -1 entered `manual_review`;
- owner accepted A-2 with reason `shrinkage`;
- commit wrote exactly one `reconciliation_correction` movement of -1 at A-2;
- `inventory_truth` rebuilt from A-2=51 to A-2=50;
- audit rows were present for create, claim, close, review, and commit.

The deterministic full rebuild command separately exposed a pre-existing
`FULFILLMENT_PHYSICAL_REMOVAL LOCATION_NOT_FOUND` failure while replaying an
`orders/fulfilled` event. That rebuild defect is outside the recount Step 3
scope and must be handled as a separate issue; it was not used to qualify the
recount implementation.

### Remaining recount work

- owner/admin variance review surface;
- printable Inventory Count Sheet.

The Warehouse counting session is shipped, including bin-batched blind
execution, skip handling, refresh/resume positioning, and physical finding
capture for unexpected items and defective stock.

Recount remains Core-tier inventory correctness functionality, not a Growth
analytics feature.


### RECOUNT-AUDIT-TYPE-23 — recount_line audit entity type

`inventoryRecount.controller.ts` audits at two grains: task-level actions
(`recount_create`, `recount_claim`, `recount_close`, `recount_commit`) against
`entityType: 'recount_task'`, and `reviewLine` against `'recount_line'` so a
variance decision is attributable to the specific SKU/bin corrected.

`'recount_line'` was missing from `AuditEntityType` in
`operatorAudit.service.ts`, shipping a typecheck failure in `4e010bdd`.
`operator_audit_log.entity_type` is varchar with no enum/check constraint, so
runtime rows were always written correctly — the defect was type-level only and
no migration was required.

**Contributing cause:** `apps/backend/package.json` `build:dev` ends in
`|| true`, so `tsc` failures do not fail the dev build. Run
`npx tsc --project apps/backend/tsconfig.json --noEmit` before committing.

### PROJ-CONTRACT-24 — rebuild skips canonical contract violations

Rebuild halted on the first event whose payload failed the canonical order
contract, so `npm run rebuild` could not complete and the ledger's
authoritativeness (INV-REBUILD-REPLAY-21) was unverifiable.

**Split by error class.** `CanonicalContractError`
(`services/mappers/canonicalContractError.ts`) carries a `tag` and is thrown by
all six contract violations in `shopify-to-canonical-order.ts` (id missing,
invalid id, currency, total, subtotal, tax). Rebuild skips ONLY this class,
matched by `instanceof` — never by message string. Everything else stays fatal,
including `FULFILLMENT_PHYSICAL_REMOVAL LOCATION_NOT_FOUND`: skipping an
inventory contract violation would complete a rebuild with knowingly-wrong
stock, which defeats the point.

**The runtime worker is unchanged.** `projection.engine.ts` still rethrows on
CANONICAL_NORMALIZATION_FAILED_FATAL. Live ingestion must never silently
tolerate a malformed producer. Rebuild is different: it replays events already
accepted and stored, where halting protects nothing.

**A dirty rebuild cannot pass as clean.** Three mechanisms:
- exit code 2 (not 0) whenever anything was skipped;
- `[REBUILD_INCOMPLETE]` summary listing every skipped event id and tag;
- skips folded into `REBUILD_STATE_HASH`, so baseline comparison catches an
  incomplete replay automatically.

`domain_event_projection_failures` (migration 0154) records each skip. It is
truncated at the start of every rebuild — it describes the CURRENT replay, not
history. `failed_at` is the epoch, not a wall clock, so repeated rebuilds of
identical events produce identical hashes. Forced RLS, standard tenant policy;
rebuild writes as sf_user (BYPASSRLS).

**Verified:** clean seeded fixture `dc219e32…` exit 0; same fixture with one
malformed `orders/create` `ad385e69…` exit 2, one skip recorded, 15 orders and
inventory still projected. Repeat run reproduced `ad385e69…` exactly.

**Not fixed here:** poison still enters at the webhook boundary —
`handleOrderCreated.ts:22,28` declare `subtotal_price` and `line_items`
optional while the mapper requires them. That is the next issue.

### CANONICAL-STRICTNESS-25 — investigated, mapper throws retained

**Question:** should the mapper reject orders missing subtotal or tax?

FT0CanonicalOrder declares currency/totalPrice/subtotalPrice/totalTax as
nullable, and orders.create.ts appeared to store null for subtotal and tax. On
that basis the throws looked stricter than the contract. They are not.

**All four columns are NOT NULL** (`0001_sovereign_baseline:115-118`). The
SCHEMA is the binding contract; the TypeScript type is the looser of the two
and is what is out of step. Relaxing the mapper was tried and only moved the
failure into the insert as a bare PG 23502 naming no event and no shop.

Both throws are therefore retained. Real Shopify orders always carry both
fields — this only ever surfaced via a hand-built test payload.

**Tax:** deliberately not a product-logic consideration in laSyncro. No margin,
valuation, or display decision reads total_tax; margin computes from
order_revenue_units x estimated_unit_cost. It is stored because the schema
requires it and periodic accounting needs it. Do not build product logic on it.

### PROJ-NULLGUARD-26 — named failure instead of raw PG 23502

`orders.create.ts` resolved subtotal_price and total_tax with `?? null` and
passed the result straight into NOT NULL columns. The mapper normally rejects
such payloads first, so the path never fired — but any producer bypassing
canonical normalization would have hit an unreadable driver-level constraint
error instead of a diagnosable one.

`requireMonetary(value, column)` now throws
`[ORDERS_CREATE] <column> is required (NOT NULL) but resolved to null`.

The guard should be unreachable in normal operation; if it fires, a producer
bypassed the mapper. Its runtime behaviour is deliberately unproven — it was
not worth contriving a payload for a path that should not exist. Compile-time
and structural verification only.

### RECOUNT-WALKORDER-27 — physical walk order + transient zone exclusion

**Ordering.** `selectSuggestedLines` and `getOperatorLines` both sorted by
`location_code`, which puts `A-10` before `A-2` once a lane exceeds nine bins.
Both now use `COALESCE(position_x, 9999), COALESCE(position_y, 9999),
location_code` — the same sort the pick path already uses
(`wms.controller.ts:232`, "operator walks shortest physical path"). One set of
muscle memory across picking and counting.

`getOperatorLines` matters more than the scope query: it is the order the
operator physically walks. It uses `leftJoin` so a line whose bin was deleted
still appears, sorted last, rather than vanishing.

**Zone exclusion, suggested scope only.** `pack`, `ship`, `receive`, `kitting`
hold stock mid-workflow by design; counting them books variance against a bin
the stock is legitimately passing through. Excluded.

`pick`, `storage`, `quarantine`, `returns`, `problem` ARE counted — stock rests
there awaiting disposition. Evidence: `wms.controller.ts:2703` moves quarantined
items to the PROBLEM bin and deliberately creates no stow task, so they sit
until an owner resolves them. That is exactly the stock a recount should verify.

NULL `zone_type` is counted, not dropped — a whitelist would silently hide that
bin from every recount, and hidden inventory is worse than an extra bin walked.

`scope='full'` is unfiltered. Full means full.

**On expected value:** for a 1-20 operator warehouse the walking-distance saving
is modest. The real wins are the A-10/A-2 correctness bug, consistency with the
pick path, and the accuracy gain from not counting transient staging.

**Verified** in a rolled-back transaction as `sf_app` with the tenant frame set:
negative on-hand planted in five zones returned
`['C-2','RETURNS-1','QUARANTINE-1','PROBLEM']` — PACK-1 and RECEIVE-1 correctly
absent, x-then-y ordering correct including the y tiebreak at x=7.0.

**Not addressed:** stow is free-scan (location sticks, scan LSU- units, next
bin), so a SKU scatters across bins by whatever was on the pallet. Walk order
optimises the path through that placement; it cannot improve the placement.
Directed putaway would be a separate track.

### RECOUNT-SELLABLE-30 — suggested scope is sellable stock only (supersedes -27's zone split)

**The axis was wrong in -27.** That change asked "does stock rest in this bin"
and counted quarantine/returns/problem on the grounds that it does. The right
question is "can this stock be oversold". Recount exists to prevent overselling
and phantom stock; both are risks against SELLABLE inventory. Stock held in
quarantine, returns, or the problem bin is deliberately out of the sellable
path, so counting it cannot reduce the risk the recount addresses.

Suggested scope is now a whitelist: `zone_type IN ('pick', 'storage')`.

**Why `storage` is in it.** `storage` is not a meaningful category — it is the
column DEFAULT (migration `0108:105`, `floor-planning.controller.ts:653`,
described in `0108:27` as "general storage (default)"). It has no behavioural
meaning anywhere in the backend. A merchant who never opens the floor planner
has EVERY bin defaulted to it, so excluding it would return an empty suggested
scope for exactly the user most likely to have phantom stock.

No NULL branch is needed: `zone_type` has a DB default, so a bin cannot exist
without one. (-27's NULL handling was defending against an impossible state.)

`scope='full'` remains unfiltered.

### RECOUNT-WALKORDER-27b — lane-grouped sequencing

-27 sorted by `(position_x, position_y)`, copied from the pick path for
consistency. On a floor plan with horizontal lanes (A at y=1, B at y=5, C at
y=9, bins advancing along x) that returns A-1, B-1, C-1 — the front of every
lane, forcing the operator to traverse all three lanes once per column.

Both `selectSuggestedLines` and `getOperatorLines` now order by
`(lane.position_y, lane.position_x, bin.position_x, bin.position_y,
location_code)`, grouping bins under their `parent_location_code` lane first.
Layout-independent: works whether lanes run along x or y.

**The pick path (`wms.controller.ts:232, :311`) still uses the raw
`(position_x, position_y)` sort and likely has the same problem.** Not verified,
not changed here — worth its own audit.

**Verified** in a rolled-back transaction as `sf_app` with the tenant frame set:
all ten lane bins made suspect plus negative stock planted in QUARANTINE-1,
RETURNS-1, PROBLEM and PACK-1 returned
`['A-1','A-2','A-3','A-4','B-1','B-2','B-3','B-4','C-1','C-2']` — clean lane
sweep, all four non-sellable bins excluded. PROBLEM is the sharpest case: it
parents to lane A, so a failed whitelist would have placed it mid-sweep.

### RECOUNT-ROLE-29 — operator permissions verified

`4e010bdd`'s E2E ran on the owner token only. Verified live against
localhost:3000 with both dev tokens:

| Route | Operator | Owner |
|---|---|---|
| create | 403 | 200 |
| read | 200 | 200 |
| claim | 200 | — |
| review | 403 | — |
| commit | 403 | — |

The blind rule also holds over HTTP for an operator: `GET .../lines` returned no
`expected_quantity` field. That is the case the rule exists for and was
previously only checked on an owner token.

**Incidental finding, unfixed:** a malformed (non-UUID) `:taskId` returns 500,
not 400 — same class as `EXP-DATEFILTER-07`.

### RECOUNT-LIST-28 — task discovery endpoint

`GET /api/v1/wms/recount-tasks` — `wms:recount:read`, Core tier, standard chain
(`authenticateToken → requireFt2 → requireTier → requireAction`).

Every other recount route is `:taskId`-scoped, so a dispatched task was
unreachable without already knowing its UUID. This is the Step 4 UI's entry
point.

**Visibility.** Owner/admin see every task. An operator sees only what they can
act on: unassigned tasks, tasks assigned to them, and tasks they claimed.
Surfacing another operator's assigned task would advertise a claim that
`claimRecountTask` (service `:264`) is guaranteed to reject. This implements the
dispatch model stated at service `:200-202` — `assigned_to` set means only that
operator may claim; null means first claim wins.

**`variance_count` is owner/admin only.** On a blind task, "3 variances" tells
the counting operator their numbers disagreed with the system — the expected
quantity leaking through an aggregate rather than a field. Privilege comes from
`req.user.roles`, never a client parameter. `line_count` and `counted_count` are
safe for anyone: neither reveals what the system expected.

**Terminal tasks excluded by default.** Returns draft/dispatched/claimed/
counting/manual_review; `?status=committed,cancelled` widens it. Otherwise the
operator's list grows without bound.

**Verified live** against localhost:3000 with both dev tokens: owner payload
carries `variance_count`, operator payload ends at `counted_count`; a task
assigned to user 1 appeared for the owner and was correctly absent from operator
2's list; `?status=committed` returned empty; `GET /wms/batches` still 200.

### Warehouse counting execution

The operator session is deliberately and structurally blind.
`getOperatorLines()` exposes safe identity and navigation context only:
location code, product title, variant title, SKU, image, and the operator's own
count/skip state. It never exposes `expected_quantity`, `variance`,
`window_delta`, or contested state during operator counting.

Execution flow:

    Warehouse -> Counts -> Start/Continue
      -> confirm location
      -> confirm product
      -> enter physical quantity or skip with reason
      -> repeat unresolved lines
      -> Finish count only when every line is resolved

A recount line is write-once during operator counting. Once resolved by either
a physical count or an explicit skip, both count and skip endpoints reject any
second resolution with HTTP 409. Corrections must use the deliberate
review/recount path; normal operator actions never overwrite prior count or skip
history (RECOUNT-RECOUNT-OVERWRITE-74).

Quantity `0` is valid and means the location was physically checked and empty.
Skipped lines remain distinct from counted lines. The task card therefore does
not infer remaining work from `counted_count`; exact resolved progress is derived
inside the session from the line payload.

Product confirmation resolves through the existing WMS barcode/SKU resolver and
must match the line's `lasyncro_variant_id`. The session preserves
`countTaskId` in the URL. Reopening a `claimed` or `counting` task owned by the
current user restores directly to the first unresolved bin's location-confirmation
step instead of restarting at the brief screen. Persisted line resolutions remain
authoritative across refreshes (RECOUNT-RESUME-POSITION-72).

Resume is ownership-aware: an operator may only continue a task where
`claimed_by` matches the authenticated user. A dispatched task assigned to a
different user and an in-progress task claimed by a different user are disabled
in the Counts list and are not auto-restored from a forced `countTaskId` URL.
Owner/admin takeover is intentionally not implicit; explicit reassignment/takeover
is tracked separately as RECOUNT-TAKEOVER-85.

Closing the operator session does not imply that inventory was corrected.
`recordCount()` and `closeCount()` still write no stock. Any required owner
decision remains downstream of the blind operator workflow.

Verified live on localhost:5173 against localhost:3000: executable Counts list
rendered, the session opened, safe product identity displayed, location and
product gates passed, quantity entry was reached, blind fields/copy did not
leak, claimant-owned `countTaskId` resumed at the unresolved bin after refresh,
a different claimant's task remained disabled and could not be forced open by
URL, and persisted count-line state remained unchanged.

**Note for future handlers:** `req.user` is typed and camelCase —
`shopId`, `userId`, `roles`. Not `shop_id`/`user_id`/`shop_roles`; those are the
raw JWT claim names, which `authenticateToken` maps. No `as any` cast needed.

**Still missing for Step 4:** no warehouse-listing endpoint exists (floor
planning exposes `/layout` only), so the UI has no source for the
`warehouse_id` that `POST /recount-tasks` requires.

### RECOUNT-WAREHOUSE-31 — warehouse_id optional, resolves to default

`POST /api/v1/wms/recount-tasks` required an explicit `warehouse_id`, but no
frontend surface has one: `WmsOperationsPage.tsx` makes 40+ API calls and none
touch warehouses, `modules/wms/src` has zero references to the field, and
floor-planning's `/layout` returns location codes and `warehouse_name` without
the id. Requiring it would mean building a listing endpoint purely so the UI
could look up a value a single-warehouse shop never chooses between.

The field is now optional. When omitted, `resolveDefaultWarehouseId()` reads
`warehouses` where `is_default AND active` — the same fallback
`floor-planning.controller.ts:687` already uses for zone creation.

**It throws rather than picking one.** A recount run against the wrong
warehouse produces variance on every line, so a named 400 is far cheaper than a
silent mismatch. The thrown message deliberately contains the word "requires":
`recountErrorStatus()` maps `.includes('requires')` to 400, so different wording
would report a client error as a 500.

Resolution happens before `nextRecountLabel()` — a label allocated against an
unresolvable warehouse would burn a sequence number for nothing.

**Multi-warehouse dependency.** This resolves to the DEFAULT warehouse. A shop
with several will silently count the default until a selector supplies the id
explicitly (the API already accepts it). Recount therefore joins the surfaces
affected by GitHub issue #1002 (`feat: dynamic warehouse naming &
multi-warehouse architecture`) and `WH-MULTI-NAMING-20`, alongside receive,
stow, floor planning, and Overview's existing "Main warehouse" affordance. See
also `docs/blueprints/product-structure.md` §9. When #1002 is picked up, the
recount creation surface needs the same warehouse selector as the others.

**Verified live:** `{"scope":"full"}` with no warehouse_id created CNT-1-0002
(10 lines); an explicit id created CNT-1-0003; a non-string id returned 400.
Test tasks were removed afterwards.

## Inventory/Products export CTA — EXP-CTA-INVENTORY-99, 2026-08-23

Wired the existing `products` export to `/inventory` (Intelligence tab).
No backend change: the route, the 9-column `EXPORT_COLUMNS.products`
registry entry, and the `Inventory Valuation` QUICK_REPORTS card all
already existed and were already reachable from the Reports page. The
only thing missing was reaching them *in context* — a merchant looking
at suspect stock had to leave for Settings to pull the sheet they were
about to reconcile against.

**Pattern (identical to Orders, now confirmed canonical for module CTAs):**

```text
module package renders a prop-gated ghost pill
    {onExport && (<Box onClick={onExport}>Export →</Box>)}
        ↓
ft2-page owns drawer state and mounts ExportDrawer
    reportIds={['products']}   — pre-filtered per §7
```

The callback prop is not stylistic. `modules/products/tsconfig.json`
scopes `rootDir`/`include` to `src/**/*`, so a module-side file cannot
import `ExportDrawer` from `apps/frontend` — see modules-ux-playbook §14.
Threading a handler down is the only thing that compiles.

CTA is Tier 2 ghost pill per CTA playbook §2: it opens a drawer, it
commits nothing.

**Header restructure:** ProductsModuleFT2's header was a single unbroken
column with no action slot. Wrapped title + action in a `space-between`
row using breakpoint-based direction (`{ xs: 'column', sm: 'row' }`) per
modules-ux-playbook §18 — a flat `flexWrap: 'wrap'` squeezes the title
toward its flex-basis floor before the action wraps.

**Verified live 2026-08-23:** desktop and mid-width render clean, drawer
opens with one card, picker exposes 9 columns, both a full and a 3-column
download round-trip `filters.columns` correctly. CSV reconciled exactly
against the ledger: 17 rows for 17 variants, Σ on_hand = 183 = the
inventory_truth total. `reconciliation_correction` count 0 before and
after — an export must never write an inventory correction.

**Known, registered, not fixed here:** `EXP-LOCATIONS-ROOT-106` (every
row carries a useless `WH-1-ROOT=0` suffix), `EXP-DRAWER-PILL-100`
(expanded picker overhangs the card in the ~400px drawer),
`ENT-COLSELECT-BYPASS-96` (the Growth gate on column selection exists
only in the frontend PLAN_FEATURES map; `GET /exports/columns` is
requireTier('core') and no backend check enforces column_selection).

**Withdrawn during this work:** the two open items the prior handover
carried for Export are both already done. `orders-blocked` no longer
exists in exportReports.ts and no call site references it. The Reports
page consolidation shipped — ShopSettingsReportsPage imports the same
QUICK_REPORTS as ExportDrawer, and the config header declares it single
source. Do not re-scope either.

## PRODUCTS-PULSE-STOCKOUT-105 — never key a Map on variant id alone, 2026-08-24

`inventory_truth` is keyed `(shop_id, lasyncro_variant_id, location_code)` —
**one row per variant PER LOCATION.** Any code that selects raw rows and folds
them into `new Map()` keyed on variant id alone is last-write-wins, and the PK
btree orders `location_code` last, so the 0-unit `WH-1-ROOT` row arrives last
and silently clobbers real stock.

`/inventory` reported **17 of 17 stocked out while the ledger held 183 units
across 12 bins.** It typechecked cleanly and ran for months.

**Rule: aggregate in SQL before the Map, or key on the composite.**
Both patterns already existed and were correct:

    exports.controller.ts:523        COALESCE(SUM(it.on_hand_quantity), 0)  → 183 correct
    demandIntelligence.service.ts    SUM(it.available_quantity), groupBy    → correct
    inventoryRecount.service.ts:253  Map keyed `${variant_id}:${location_code}` → correct
    ProductsOperatorFacts.service.ts:115  raw rows, Map on variant id       → THE BUG

Blast radius audited: five Map-builders over `inventory_truth`, four cleared
with quoted source. This was the only instance.

**Which column gates which signal — MIXED BY DESIGN.**
The prior comment said "classify by TRUE on_hand (not clamped sellable)". That
concern is preserved, not discarded: `sellable_quantity` is
`generated always as (available_quantity) stored` and cannot represent a
negative, so **phantom must keep reading summed `on_hand`** or a recorded
contradiction would be hidden. What it did not anticipate is that the same
field also gated stocked-out, where clamping is correct behaviour:

    on_hand < 0    → PHANTOM       physical-integrity signal
    sellable == 0  → STOCKED OUT   "can this be sold" — the axis
                                   RECOUNT-SELLABLE-30 settled for the codebase
    otherwise      → READY TO SELL

Closes `PRODUCTS-SELLABLE-COLUMN-108`: the file header always documented
`sellable_quantity` as the source and the gate never read it.

**A SUMMED on_hand can go negative where a single row cannot**, so the phantom
branch is now reachable where it previously never fired. Proven with a planted
`-999` in a rolled-back transaction: `ready 12→11, phantom 0→1`.

**`WH-1-ROOT` needed no special-casing.** All 17 root rows are `on_hand = 0`, so
they contribute nothing to a SUM. Recount already excludes warehouse-root rows
from suggested scope "because there is no physical shelf for an operator to
count" (RECOUNT-SELLABLE-30). Its presentation suffix in CSVs remains
`EXP-LOCATIONS-ROOT-106`.

**Verified live 2026-08-24** on localhost:5173: headline `17 stocked out` →
`5 stocked out`; pulse rail `Ready to sell 0 of 17` → `12 of 17`, `Stocked out
17` → `5`, `Phantom 0` unchanged. Dead capital `$842` and the non-moving-stock
action unchanged, confirming they run off `demandIntelligence`'s correct
aggregation and were never downstream of this bug.

**Registered, not fixed here:**
- `PULSE-COMMITTED-RAIL-113` (Med) — fully-reserved stock (`on_hand 1,
  sellable 0`, SKU `HOM-79602-2754`) now reads *stocked out*: true but
  incomplete. A three-state rail (Ready to sell / Committed / Stocked out)
  resolves it and `PRODUCTS-RESERVED-SEMANTICS-109`. Needs a frame approved;
  touches the module package, so it carries a `dist` rebuild.
- `PRODUCTS-STOCKOUT-DUAL-114` (Med) — two independent stockout counts reach
  `/inventory`. `demandIntelligence` filters `product_type='physical'`,
  `p.status='active'`, `v.status='active'`; this service does not. The PO card
  reads "3 stocked-out SKUs" against the rail's 5. Expected, not a regression.
- `FACTS-MAPMISS-112` — **withdrawn.** The `!` at the `inventoryMap.get` call
  is guarded by an explicit `.has()` check that `continue`s first.

**Baseline for this area:** `apps/backend` tsc is **exit 0, zero errors**.
Capture it before backend work — `build:dev` ends in `|| true`, so tsc failures
do not fail the dev build (RECOUNT-AUDIT-TYPE-23).


## Finances export suppressed — EXP-FINANCES-ORPHANED-139, 2026-08-25

Finances and its submodules (Intelligence, margin, cashflow) are disabled by
product decision. Finances is suppressed at **three** surfaces, all commented
rather than deleted so restoration is one coherent uncomment:

```text
apps/frontend/src/lifecycle/LifecycleRouteHost.tsx:281   route
apps/frontend/src/runtime/navBootstrap.ts:130-144        nav item
apps/frontend/src/config/exportReports.ts:49-57          quick report
```

The backend is deliberately untouched: `/api/v1/exports/finances`
(`exports.routes.ts:55-61`) and `FINANCES_COLUMNS`
(`exports.controller.ts:168-176`) remain live and Core-gated. §5's Finances
column list is still accurate.

### QuickReport has no module-availability field

`QuickReport` (`exportReports.ts`) gates on `tier` only. There is no
`moduleId`/`requiredModuleId` field, so a report for a disabled module cannot
be filtered automatically — suppression is manual. Tracked as
`EXP-MODULE-AVAILABILITY-140`.

### Trap — module gating is not testable in DEV

`apps/frontend/src/navigation/resolveNavVisibility.ts:62`:

```ts
if (import.meta.env.DEV) return 'enabled';
```

The module-entitlement gate returns `enabled` unconditionally in development,
*before* `requiredModuleId` is ever checked. Any module-gating fix is therefore
unverifiable locally, and a local "it renders correctly" observation proves
nothing about production. This is why suppression here is a comment rather than
a `requiredModuleId` entry. Tracked as `NAV-MODULEGATE-DEV-BYPASS-141`.

### Export CTA scope rule

Every `ExportDrawer` call site passes an explicit single-report `reportIds`:

```text
ProductsFT2Page:82      ['products']
OrdersFT2Page:111       ['orders-all']
ReturnsOverviewPage:278 ['returns']
OrdersOutboundPage:1158 ['orders-outbound']
```

**A module drawer exports that module's own data.** The full report set is
offered only at `/settings/reports`. Overview has no `ExportDrawer` call site
and is not getting one — it holds no data of its own, so an export there could
only mean "all reports", which is the Reports page by another name. A pointer
to Reports is tracked as `OVERVIEW-REPORTS-POINTER-142`.

### Withdrawn

`EXP-CTA-FINANCES-110` — no CTA can be wired into a disabled module. Reopens
only if Finances is restored.

### Verification

Reports page (`/settings/reports`) live-verified: four quick reports render
(All Orders, Shipped Orders, Returns Analysis, Inventory Valuation), Finances
absent, remaining entries unchanged. The four `ExportDrawer` call sites were
proven by grep to pass explicit `reportIds` excluding `finances`; Overview was
proven to have no call site. `apps/frontend` tsc held at its 19-error baseline
with zero errors in the touched file.
