# Receive Job Process — Blueprint & Playbook

**LaSyncro | Sprint 4 | May 25, 2026**
**Status: Production-ready core. Scan mode in development.**

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
- Is claimed and executed by a warehouse operator on mobile
- Produces inventory movements, inventory truth updates, barcode print jobs,
  and stow tasks on close
- Is the ONLY authorised path for writing `inbound_purchase` inventory movements

A receive job NEVER:

- Writes inventory without inspection completion on all lines
- Closes with uninspected lines remaining
- Bypasses the problem center for physical exceptions

---

## 2. PO Lifecycle (context)

draft → ordered → confirmed → shipped → received | partially_received

- `shipped` = supplier has dispatched goods toward the shop owner's warehouse.
  This is when carton labels can be printed in the Suppliers portal.
- `received` = all PO line items fully received (quantity_received >= quantity_ordered)
- `partially_received` = at least one unit received, not all

A receive job can only be created when PO status is `shipped` or `partially_received`.
One active receive job per PO at a time (enforced by backend guard).

---

## 3. Receive Job Lifecycle

pending → in_progress → closed

- `pending` = created, not yet claimed by an operator
- `in_progress` = operator has claimed the job, inspection underway
- `closed` = all lines inspected, job closed, inventory credited

Status transitions:

- `pending → in_progress`: operator claims via mobile (POST /claim)
- `in_progress → closed`: operator closes after all lines inspected (POST /close)

Claim rules:

- Any operator can claim a pending job
- Re-claim by same operator is idempotent
- Different operator cannot claim a job already claimed by another

---

## 4. Inspection Flow

Each PO line item becomes one `receive_job_line`. Each line must reach
`inspection_complete = true` before the job can close.

**Per-line inspection decision:**

1. Operator counts accepted units
2. If count matches expected → line confirmed, no exception
3. If count is short (shortfall > 0):
   - Shortfall modal opens
   - Operator selects exception type for each unaccounted unit
   - Exception reported → `receive_exceptions` row created
   - Problem Center task created → PROB label generated
   - Operator directed to place item in PROBLEM BIN before continuing
   - Remaining shortfall can have multiple exception types (iterative)
4. Line marked `inspection_complete = true`

**Exception types (receive context):**

| Type | Meaning |
|---|---|
| `defect` | Unit is physically damaged |
| `packaging_damage` | Unit OK but packaging damaged |
| `wrong_item` | Item received does not match ordered variant |
| `wrong_variant` | Correct product, wrong size/colour/variant |
| `wrong_quantity` | Quantity in box doesn't match box label |
| `barcode_mismatch` | Scanned barcode doesn't match expected SKU (notes required) |
| `other` | Catch-all (notes required) |

**Miscount path:**
If operator believes their count was wrong (not a real shortfall), they can
tap "I miscounted" → line accepted at full expected quantity, no exception filed.

---

## 5. What Happens on Close

`closeReceiveJob()` executes atomically in a single transaction:

1. **PO line items updated** — `quantity_received` incremented by `quantity_accepted` per line
2. **PO status advanced** — `received` (fully) or `partially_received` (partial)
3. **Delivery date recorded** — `actual_delivery_date` written to PO if provided
4. **Cost backfill** — `variants.unit_cost` updated from `purchase_order_line_items.unit_cost_cents`
   for variants where unit_cost was 0 (never overwrites real costs)
5. **Supplier rating recomputed** — `on_time_rate`, `fill_rate`, `avg_delivery_days`, `total_pos`
6. **Supplier defect rate recomputed** — from `receive_exceptions` (defect type only)
7. **Inventory movements written** — one `inbound_purchase` movement per accepted line
   (deterministic UUID via uuidv5 — idempotent on replay)
8. **Inventory truth upserted** — `on_hand_quantity` and `available_quantity` incremented
   at `WH-{shopId}-ROOT` location
9. **Barcode print jobs created** — one per accepted variant
   (barcode_value = SKU if available, else short variant UUID)
10. **Stow tasks created** — one per accepted line, routed to ROOT location pending stow

Everything above is all-or-nothing. If any step fails, the entire close rolls back.
The job remains open and can be retried.

---

## 6. Barcode System

### Product barcodes — three sources

| Source | How | When available |
|---|---|---|
| **Manufacturer barcode (EAN/UPC)** | Synced from Shopify variant barcode field via `external_product_identity_map` | Immediately after Shopify sync |
| **LaSyncro-generated barcode** | Created by `closeReceiveJob()` → `barcode_print_jobs` → printed and applied | After first successful receive |
| **Manual barcode assignment** | Owner assigns via Floor Planning → Barcodes tab → `PATCH /floor-planning/products/:id/barcode` | Any time |

### Barcode resolution order (POST /api/v1/wms/barcode/resolve)

1. `external_product_identity_map.barcode` (manufacturer EAN/UPC from Shopify)
2. `external_product_identity_map.external_sku` (SKU match)
3. `barcode_print_jobs.barcode_value` (LaSyncro-generated barcodes)

### Universal scan resolution (POST /api/v1/wms/scan/resolve)

Resolves any scanned value against three entity types in order:

1. **Location** — `warehouse_locations.barcode` or `location_code`
2. **Product** — `external_product_identity_map.barcode/sku` or `barcode_print_jobs.barcode_value`
3. **Order** — `external_order_identity_map.external_order_id`

Returns full warehouse context (inventory, active operations, stage).

### Barcode types supported (expo-camera)

`qr`, `ean13`, `ean8`, `code128`, `code39`, `upc_a`, `upc_e`

### Products without barcodes

If a variant has no barcode in any source, it cannot be scanned.
Receive job falls back to manual count entry for that line.
After the first receive job closes, a LaSyncro barcode is generated and
subsequent deliveries of the same SKU can be scanned.

---

## 7. PROBLEM BIN Routing

When a receive exception is reported:

1. Backend calls `POST /api/v1/wms/problem-center` with:
   - `lasyncro_variant_id`, `quantity`, `exception_type`, `source: 'receive'`
2. Backend atomically increments `shop_wms_settings.prob_label_sequence`
3. Generates label: `PROB-{shopId}-{seq:0000}` (e.g. PROB-1-0001)
4. Creates `problem_center_tasks` row (status: `open`, source: `receive`)
5. Creates `barcode_print_jobs` row for the PROB label
6. Returns `prob_label` and `problem_bin` to mobile
7. Mobile shows alert: *"Label PROB-1-0001 — place in [PROBLEM BIN]"*
8. Operator physically moves item before continuing

**PROBLEM BIN location:** Configured in `shop_wms_settings.problem_bin_location`.
Currently empty string on clean seed — defaults to `WH-{shopId}-PROBLEM`.
Must be set by owner in warehouse settings pointing to the actual PROBLEM bin
location code from `warehouse_locations`.

**Physical setup:** One or more physical bins labelled PROBLEM-BIN (or any name
the operator chooses). For larger warehouses, zone-specific bins are supported:
PROBLEM-BIN-RECEIVE, PROBLEM-BIN-PACK etc. Zone names are dynamic — any
`warehouse_location` can serve as a problem bin.

**PROBLEM vs Quarantine vs Returns** — three distinct concepts, never conflated:

- PROBLEM bin: product-side defects discovered during warehouse operations
- Quarantine: physical hold zone (workflow undesigned — deferred)
- Returns: customer-side order returns (separate module entirely)

---

## 8. Scan Mode (In Development)

### Continuous scan mode

A new receive phase (`scan`) alongside existing count entry (`inspect`).
Operator chooses mode on the brief screen. Can mix: scan capable lines,
count entry for lines without barcodes.

**Scan flow per unit:**

1. Camera live viewfinder (full screen)
2. Operator points at product barcode
3. `/api/v1/wms/barcode/resolve` called
4. Match found → vibrate success → increment line count → HUD updates
5. Line reaches expected count → auto-confirms → vibrate double-success
6. Overcount detected → pause → confirmation sheet (add / report exception)
7. Mismatch → vibrate error → exception cascade → PROBLEM BIN routing

**HUD (heads-up display):**
Progress bar across all lines visible while scanning. Lines without barcodes
show keyboard icon — tap to open inline count entry modal.

**Manual entry fallback:**
Bottom sheet with text input — operator types SKU or barcode value.
Routes through same resolution path.

### Carton label system (planned)

When PO status transitions to `shipped`, Suppliers portal offers
"Print carton labels" per line item. Owner specifies carton count.
LaSyncro generates printable PDF labels (QR + human-readable).

Label encodes: `{"po_id":"...","variant_id":"...","expected_qty":N,"carton":M}`

Two attachment paths:

- Supplier attaches before shipping (requires coordination)
- Shop owner/operator attaches at dock on arrival (no supplier coordination)

Scanning a carton QR during receive job:

1. Jumps directly to matching line
2. Pre-announces expected contents
3. Operator scans individual items OR switches to count entry

**Status:** Not yet built. Backend endpoint required:
`GET /api/v1/suppliers/purchase-orders/:poId/carton-labels`

---

## 9. API Reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/suppliers/purchase-orders/:poId/receive-jobs` | Create receive job |
| GET | `/api/v1/suppliers/receive-jobs` | List jobs (role-filtered) |
| GET | `/api/v1/suppliers/receive-jobs/:jobId` | Get job + lines |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/claim` | Claim job |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/inspect` | Inspect one line |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/exception` | Report exception |
| POST | `/api/v1/suppliers/receive-jobs/:jobId/close` | Close job |
| POST | `/api/v1/wms/barcode/resolve` | Resolve barcode → variant |
| POST | `/api/v1/wms/scan/resolve` | Universal scan resolver |
| POST | `/api/v1/wms/problem-center` | Create PROB task + label |

---

## 10. Key Files

| File | Role |
|---|---|
| `apps/backend/src/services/wms/receiveJob.service.ts` | All receive job business logic |
| `apps/backend/src/api/suppliers/receiveJob.controller.ts` | HTTP handlers |
| `apps/backend/src/api/suppliers/suppliers.routes.ts` | Route registration |
| `apps/backend/src/api/wms/wms.controller.ts` | Barcode resolve, scan resolve, problem center |
| `apps/mobile/src/screens/ReceiveJobScreen.tsx` | Full receive job mobile UI |
| `apps/mobile/src/screens/ScannerScreen.tsx` | Reusable camera + barcode resolution UI |
| `packages/backend-core/src/services/webhook-ledger.service.ts` | Webhook ledger |

---

## 11. Change Control

**Any change to the following requires explicit written approval before implementation:**

- `closeReceiveJob()` — any modification to the atomic close transaction
- `inventory_movements` write logic — movement types, quantities, idempotency keys
- `inventory_truth` upsert logic
- Barcode resolution order or sources
- PROBLEM bin routing or label generation
- Receive job status transitions or claim logic
- Exception types (adding, removing, renaming)

**Rationale:** These are inventory accuracy primitives. A bug here creates ghost
inventory or missing stock that takes hours to diagnose and may be undetectable
without a full physical count.