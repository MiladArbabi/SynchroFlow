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

### Path B — Continuous scan mode (available when barcodes exist)

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

7. **Inventory movements written** — one `inbound_purchase` movement per accepted line
   (deterministic UUID via uuidv5 — idempotent on replay)
8. **Inventory truth upserted** — `on_hand_quantity` and `available_quantity` incremented
   at `WH-{shopId}-ROOT`
9. **Barcode print jobs created** — one per accepted variant
10. **Stow tasks created** — one per accepted line at ROOT location

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
inventory or missing stock that may be undetectable without a full physical count.