# Receive Job Process — Blueprint & Playbook

**LaSyncro | Sprint 4 | May 26, 2026**
**Status: Production-ready — both mobile and webapp paths verified end-to-end.**

> ⚠️ CHANGE CONTROL: Any modification to the receive job flow, barcode system,
> inventory movement writes, or problem center routing REQUIRES explicit approval
> before implementation. This document is the source of truth.

---

## 1. What a Receive Job Is

A receive job is the formal process of accepting inbound stock from a supplier
against a Purchase Order. It is the bridge between "stock ordered" and
"stock available to pick."

A receive job:

- Is created from a PO that has status `shipped` or `partially_received`
- Can be executed by any authenticated user (owner, admin, or operator) on mobile
- Can be executed by the owner via the WMS webapp (Warehouse → Operations)
- Produces inventory movements, inventory truth updates, barcode print jobs,
  and stow tasks on close
- Is the ONLY authorised path for writing `inbound_purchase` inventory movements

A receive job NEVER:

- Writes inventory without inspection completion on all lines
- Closes with uninspected lines remaining
- Bypasses the problem center for physical exceptions

---

## 2. PO Lifecycle

```
draft → ordered → shipped → received | partially_received
```

**UI-facing stages (simplified from backend statuses):**

| UI Label | Backend Status(es) | Meaning |
|---|---|---|
| Draft | `draft` | PO created, not yet sent to supplier |
| On the way | `ordered`, `confirmed`, `in_production` | Sent to supplier, in transit |
| Arrived | `shipped` | Stock at dock, ready to receive |
| Receiving | `partially_received` | Receive job in progress |
| Received | `received` | All units received |

**Transition buttons (Suppliers portal):**

- Draft → "Mark as sent" → sets `ordered`
- On the way → "Mark as arrived" → sets `shipped`
- Arrived → "Receive via WMS" → creates receive job, navigates to WMS session

A receive job can only be created when PO status is `shipped` or `partially_received`.
One active receive job per PO at a time (enforced by backend guard).
409 on create = active job exists → navigate to existing job (handled gracefully).

---

## 3. Receive Job Lifecycle

```
pending → in_progress → closed
```

- `pending` = created, not yet claimed
- `in_progress` = claimed, inspection underway
- `closed` = all lines inspected, inventory credited

**Claim rules:**

- Any authenticated user (owner, admin, operator) can claim a pending job
- Re-claim by same user is idempotent
- Different user cannot claim a job already claimed by another

---

## 4. Inspection Flow — Two Paths

### Path A — Count by hand (always available)

1. Operator sees one card per PO line, types accepted count
2. If count matches expected → line confirmed
3. If count is short → shortfall modal → exception type selection → PROBLEM BIN routing
4. "I miscounted" path → accepts full expected quantity, no exception

### Path B — Scan mode ✅ LIVE on webapp May 31, 2026 (available when barcodes exist in Shopify)

1. Operator selects "Scan items" on brief screen
2. Full-screen camera viewfinder with dynamic bounds overlay
3. Each scan → barcode resolve → PO line match → count increment
4. Line reaches expected count → auto-confirms
5. Overcount → confirmation sheet (add / report exception)
6. Mismatch → inline error → exception cascade
7. Lines without barcodes → keyboard icon in HUD → inline count entry

Both paths produce identical data — `quantity_accepted` + `quantity_rejected` per line.
Paths can be switched mid-job via "Switch to count" / "Switch to scan" links.

### Exception types

| Type | Meaning |
|---|---|
| `defect` | Unit physically damaged |
| `packaging_damage` | Unit OK, packaging damaged |
| `wrong_item` | Item doesn't match ordered variant |
| `wrong_variant` | Correct product, wrong size/colour/variant |
| `wrong_quantity` | Quantity doesn't match box label |
| `barcode_mismatch` | Scanned barcode doesn't match expected SKU (notes required) |
| `other` | Catch-all (notes required) |

### Unlinked PO lines (free-text description, no variant)

PO lines created via free-text (no variant selected from autocomplete) have
`lasyncro_variant_id = null`. These lines:

- Show the `description` field as the item name (not "Unknown item")
- Cannot be scanned (no barcode to resolve against)
- Are inspected via count entry only
- Do NOT generate inventory movements, barcodes, or stow tasks on close
- DO update `quantity_received` on the PO line item

To enable full inventory tracking, use the variant autocomplete when creating PO lines.

---

## 5. What Happens on Close

`closeReceiveJob()` executes atomically in a single transaction:

1. **PO line items updated** — `quantity_received` incremented by `quantity_accepted`
2. **PO status advanced** — `received` or `partially_received`
3. **Delivery date recorded** — `actual_delivery_date` written to PO
4. **Cost backfill** — `variants.unit_cost` updated from PO line `unit_cost_cents`
   (only fills zero-placeholder, never overwrites real cost)
5. **Supplier rating recomputed** — `on_time_rate`, `fill_rate`, `avg_delivery_days`, `total_pos`
6. **Supplier defect rate recomputed** — from `receive_exceptions` (defect type only)

For variant-linked lines only (steps 7–10 skipped for unlinked lines):

1. **Inventory movements written** — one `inbound_purchase` movement per accepted line
   (deterministic UUID via uuidv5 — idempotent on replay)
2. **Inventory truth upserted** — `on_hand_quantity` and `available_quantity` incremented
   at `WH-{shopId}-ROOT`
3. **Barcode print jobs created** — one per accepted variant
4. **Stow tasks created** — one per accepted line at ROOT location

All-or-nothing. Failure rolls back entire close. Job remains open and retryable.

---

## 6. Barcode System

### Product barcodes — three sources

| Source | How | When available |
|---|---|---|
| Manufacturer barcode (EAN/UPC) | Shopify variant barcode via `external_product_identity_map` | After Shopify sync |
| LaSyncro-generated barcode | `closeReceiveJob()` → `barcode_print_jobs` | After first receive |
| Manual assignment | Floor Planning → Barcodes tab | Any time |

### Barcode resolution order (`POST /api/v1/wms/barcode/resolve`)

1. `external_product_identity_map.barcode`
2. `external_product_identity_map.external_sku`
3. `barcode_print_jobs.barcode_value`

### Universal scan resolution (`POST /api/v1/wms/scan/resolve`)

1. Location — `warehouse_locations.barcode` or `location_code`
2. Product — identity map or barcode print jobs
3. Order — `external_order_identity_map.external_order_id`

### Barcode types supported

`qr`, `ean13`, `ean8`, `code128`, `code39`, `upc_a`, `upc_e`

---

## 7. PROBLEM BIN Routing

On exception report:

1. `POST /api/v1/wms/problem-center` called
2. `prob_label_sequence` atomically incremented
3. Label generated: `PROB-{shopId}-{seq:0000}`
4. `problem_center_tasks` row created (status: `open`, source: `receive`)
5. `barcode_print_jobs` row created for PROB label
6. Mobile/webapp alerts operator: "Label PROB-1-0001 — place in [PROBLEM BIN]"
7. Operator physically moves item before continuing

**PROBLEM BIN location:** `shop_wms_settings.problem_bin_location`
Defaults to `WH-{shopId}-PROBLEM` if not configured.

**PROBLEM vs Quarantine vs Returns:**

- `problem` zone — product defects during warehouse ops (zone_type = `problem`)
- `quarantine` — regulatory/health hold (workflow deferred)
- Returns — customer order returns (separate module)

---

## 8. PO Line Item Variant Linking

PO creation form supports both linked and unlinked line items:

- **Linked** — operator searches by SKU/title via autocomplete, selects variant
  → `lasyncro_variant_id` stored → full inventory tracking on receive
- **Free-text** — operator types description without selecting variant
  → `lasyncro_variant_id = null` → count-only, no inventory movement

Variant search endpoint: `GET /api/v1/suppliers/variants/search?q=...`

- Returns variants with non-null SKU only (filters out Shopify "Default Title" variants)
- Limit 30, ordered by SKU
- Pre-fills unit cost when variant selected

---

## 9. Carton Label System (Planned)

When PO status → `shipped`, Suppliers portal will offer "Print carton labels".
Owner specifies carton count per line → LaSyncro generates printable PDF with QR codes.

Label encodes: `{"po_id":"...","variant_id":"...","expected_qty":N,"carton":M}`

Status: Not yet built. Backend endpoint required:
`GET /api/v1/suppliers/purchase-orders/:poId/carton-labels`

---

## 10. API Reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/suppliers/purchase-orders` | Create PO with line items |
| PATCH | `/api/v1/suppliers/purchase-orders/:poId/status` | Advance PO status |
| POST | `/api/v1/suppliers/purchase-orders/:poId/receive-jobs` | Create receive job |
| GET | `/api/v1/suppliers/receive-jobs` | List jobs (role-filtered) |
| GET | `/api/v1/suppliers/receive-jobs/:jobId` | Get job + lines (incl. description) |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/claim` | Claim job |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/inspect` | Inspect line (by variant_id or line_id) |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/exception` | Report exception |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/close` | Close job |
| GET | `/api/v1/suppliers/variants/search?q=` | Variant autocomplete for PO form |
| POST | `/api/v1/wms/barcode/resolve` | Resolve barcode → variant |
| POST | `/api/v1/wms/scan/resolve` | Universal scan resolver |
| POST | `/api/v1/wms/problem-center` | Create PROB task + label |

---

## 11. Key Files

| File | Role |
|---|---|
| `apps/backend/src/services/wms/receiveJob.service.ts` | All receive job business logic |
| `apps/backend/src/api/suppliers/receiveJob.controller.ts` | HTTP handlers |
| `apps/backend/src/api/suppliers/suppliers.controller.ts` | PO CRUD + variant search |
| `apps/backend/src/api/suppliers/suppliers.routes.ts` | Route registration |
| `apps/backend/src/api/wms/wms.controller.ts` | Barcode resolve, scan resolve, problem center |
| `apps/mobile/src/screens/ReceiveJobScreen.tsx` | Full mobile receive UI (count + scan) |
| `apps/mobile/src/ui/BarcodeScannerView.tsx` | Shared camera component (all scan surfaces) |
| `apps/mobile/src/screens/ScannerScreen.tsx` | Universal scanner tab |
| `modules/wms/src/ui/pages/ReceiveSessionPage.tsx` | Webapp receive session UI |
| `modules/wms/src/ui/pages/WmsModuleFT2.tsx` | WMS module — session routing |
| `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx` | PO management + variant autocomplete |

---

## 12. Change Control

**Requires explicit written approval before implementation:**

- `closeReceiveJob()` — any modification to the atomic close transaction
- `inventory_movements` write logic
- `inventory_truth` upsert logic
- Barcode resolution order or sources
- PROBLEM bin routing or label generation
- Receive job status transitions or claim logic
- Exception types (adding, removing, renaming)
- `receive_job_lines` schema changes

**Rationale:** These are inventory accuracy primitives. A bug here creates ghost
inventory or missing stock that may be undetectable without a full physical count
---

## 13. Session Log

### May 31, 2026 — Receive Workflow UI Simulation & Audit

**Session type:** Full UI simulation + backend audit
**Conducted by:** Owner (Milad) + Claude
**Scope:** Receive workflow end-to-end on webapp — PO creation → receive job → inspection → close → stow tasks

---

#### Changes Applied

**RECEIVE-FIX-01 — Blocked unlinked PO line items at submission**

- **Problem:** PO creation modal allowed free-text line items with no `lasyncro_variant_id`. These passed validation and were saved. On receive close, `receiveJob.service.ts:286` silently skipped these lines — no inventory movement, no stow task, no error. 25 accepted units vanished.
- **Root cause:** `handleSubmit` in `CreatePoDialog` had no variant-link validation. Backend guard at line 286 (`if (!line.lasyncro_variant_id) continue`) is correct by design but was never surfaced to the operator.
- **Fix:** Added validation in `CreatePoDialog.handleSubmit` — any line item without `lasyncro_variant_id` blocks submission with a descriptive error message naming the unlinked item.
- **File:** `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx`
- **Status:** ✅ Applied and verified

**RECEIVE-FIX-02 — Tooltip and Shopify link on unlinked line items**

- **Problem:** When operator types a product name that doesn't match any catalog entry, no feedback was shown.
- **Fix:** TextField shows red error state + helperText: "Not linked to Shopify catalog — [create the product in Shopify first →](https://admin.shopify.com/store/products/new) Then re-sync." Link opens Shopify admin products/new in new tab.
- **File:** `modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2.tsx`
- **Status:** ✅ Applied and verified

**RECEIVE-FIX-03 — Camera opens on webapp stow session (BUG-02)**

- **Problem:** `StowSessionPage.tsx` used `BarcodeScanSurface` (mobile camera component) for both `location_scan` and `product_scan` phases. On webapp, this unconditionally opened the PC webcam — wrong UX for desktop, alarming for real users.
- **Root cause:** `StowSessionPage` was built reusing the mobile component without a desktop-appropriate alternative.
- **Fix:** Created `ScanInput` component (text field, autofocus, submits on Enter) inline in `StowSessionPage.tsx`. Replaced both `BarcodeScanSurface` instances. Accepts typed location/barcode codes and USB/Bluetooth scanner input (fires as keyboard events).
- **File:** `modules/wms/src/ui/pages/StowSessionPage.tsx`
- **Status:** ✅ Applied and verified

---

#### Bugs Found — Deferred / Pending

**RECEIVE-PENDING-01 — No shortfall guard on receive session (webapp)**

- **Problem:** Webapp `ReceiveSessionPage` allows confirming a line item with `accepted = 0` or any quantity less than expected without triggering exception reporting. Mobile `ReceiveJobScreen` has a full shortfall modal that intercepts any `accepted < expected` and forces exception type selection + Problem Center routing before allowing confirmation.
- **Impact:** Operators can close receive jobs with 0 accepted units silently. No stow tasks created, no inventory written, no alert. Confirmed in live test — two lines closed with 0 accepted, no stow tasks generated.
- **Required fix (Phase 1):** Mirror mobile shortfall modal in webapp — intercept on confirm, require exception type + qty for all shortfall units, loop until fully accounted, call Problem Center on each exception.
- **Required fix (Phase 2):** Add scan path to webapp receive session — mode selector (Count / Scan), `ScanInput`-based scan, barcode resolution per scan, auto-confirm on expected count, overcount dialog.
- **Status:** 🔴 PENDING — Phase 1 is next implementation task

**RECEIVE-PENDING-02 — No products/create webhook**

- **Problem:** When a new product is created in Shopify, LaSyncro does not pick it up automatically. No `products/create` webhook registered. Owner must trigger manual resync before the new product appears in PO variant search.
- **Workaround documented in UI:** Tooltip links to Shopify admin and says "Then re-sync."
- **GitHub issue:** #996
- **Status:** 🔴 PENDING

**RECEIVE-PENDING-03 — Live pill has no resync trigger**

- **Problem:** The Live pill in the top nav is a static indicator. There is no UI-accessible manual resync trigger. Owner must know to navigate to settings or use CLI.
- **GitHub issue:** Created (resync from Live pill)
- **Status:** 🔴 PENDING

---

#### Verified Working (May 31, 2026)

| Step | Result |
|------|--------|
| PO creation with new supplier | ✅ |
| PO creation with catalog-linked line items | ✅ |
| Unlinked line item blocked at submission | ✅ |
| Tooltip + Shopify link on unlinked input | ✅ |
| PO status: Draft → On the way → Arrived | ✅ |
| Receive Via WMS button on Arrived POs | ✅ |
| Navigation to WMS Operations on receive job create | ✅ |
| Line-by-line inspection with Set All shortcut | ✅ |
| Confirm Batch → Confirm & Finish on last line | ✅ |
| Close session modal with delivery date | ✅ |
| Stow tasks created after close (variant-linked lines only) | ✅ |
| Stow tasks visible in WMS Operations | ✅ |
| Webapp stow uses text input not camera | ✅ |
| PO status advances to `received` on close | ✅ |
| `quantity_accepted` written to `receive_job_lines` | ✅ |
| `inventory_movements` written on close | ✅ |
| `inventory_truth` updated on close | ✅ |

### RECEIVE-PENDING-01 — Webapp shortfall guard — ✅ RESOLVED May 31, 2026

**What was built:**

- `ReceiveSessionPage.tsx` — `handleConfirmBatch` now intercepts any `accepted < expected` and opens a shortfall modal instead of allowing silent confirmation
- Shortfall modal mirrors mobile `ReceiveJobScreen` exactly: exception type selection, qty input (always blank — operator must type), loops until `remainingShortfall = 0`
- Multi-exception support: operator can split shortfall across multiple exception types (e.g. 1 defect + 2 wrong quantity)
- Problem Center called on each exception chunk via `WmsPage.handleReportReceiveException` (added `POST /api/v1/wms/problem-center` call)
- "I miscounted" escape hatch — accepts full expected qty, no exception filed — hidden once any exception has been committed to prevent orphaned PROB tasks
- Dynamic description text updates remaining count as exceptions are reported
- Inline qty validation with error message — empty or over-max blocked with user-facing warning
- Confirm Exception button: accent orange per UX playbook (`var(--accent)`, `borderRadius: 6px`, `fontWeight: 600`)
- Miscount button: ghost pill per UX playbook (`var(--accent-border)`, `0.5px solid`)

**Files changed:**

- `modules/wms/src/ui/pages/ReceiveSessionPage.tsx`
- `apps/frontend/src/pages/ft2-pages/WmsPage.tsx`

**Verified via UI simulation May 31, 2026 ✅**
