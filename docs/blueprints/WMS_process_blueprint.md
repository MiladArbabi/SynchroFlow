# LaSyncro WMS‑Lite  

## Complete Process Blueprint & System Contract  

**Version:** 2.0  
**Date:** April 17, 2026  
**Status:** Living Document — Updated Against Implementation  

> ⚠️ This document reflects verified implementation state as of **April 17, 2026**.  
> Sections marked **[LIVE]** are implemented and deployed.  
> Sections marked **[PLANNED]** are designed but not yet built.

---

## PART 1 — INBOUND: PRODUCTS & RECEIVING

### 1.1 SUPPLIER & PURCHASE ORDER  [LIVE — FEAT‑001]

**Status**  
✅ Suppliers Portal module live. PO management implemented. Schema migrated.

**Actors**  

- **Owner / Admin** — creates and manages suppliers and POs  
- **Operator** — executes physical receive and stow tasks  

**Implemented Data Model**

| Table                         | Migration | Status | Notes                                                                                      |
|-------------------------------|-----------|--------|--------------------------------------------------------------------------------------------|
| `suppliers`                   | 0094      | ✅ LIVE | `name`, `contact`, `on_time_rate`, `fill_rate`, `defect_rate`, `avg_delivery_days`, `total_pos` |
| `purchase_orders`             | 0095      | ✅ LIVE | `id` (uuid), `shop_id`, `supplier_id`, `status` (enum), expected/actual delivery dates, `receive_notes`, `document_url`, `parent_po_id` |
| `purchase_order_line_items`   | 0096      | ✅ LIVE | `po_id`, `lasyncro_variant_id` (nullable), `description`, `quantity_ordered`, `quantity_received`, `unit_cost_cents` |

**PO Status Lifecycle [LIVE]**  
Implemented enum on `purchase_orders.status`:  
`draft → ordered → confirmed → in_production → shipped → partially_received → received → cancelled`

**Notes:**  

- `in_production` and `shipped` are skippable via force‑advance buttons in the UI.  
- `partially_received`: PO stays open — multiple receive actions allowed until fully received.  
- Auto‑transitions to `received` when all line items reach `quantity_ordered == quantity_received`.  
- `parent_po_id` column exists for future split‑shipment dependent POs (unused in v1).  

**Supplier Rating — Auto‑Computed [LIVE]**

| Field               | Formula                                                                              | Trigger                |
|---------------------|--------------------------------------------------------------------------------------|------------------------|
| `on_time_rate`      | % of received POs where `actual_delivery_date ≤ expected_delivery_date`               | Every receive action   |
| `fill_rate`         | `total quantity_received / total quantity_ordered × 100`                              | Every receive action   |
| `avg_delivery_days` | Mean of `(actual − expected)` in days. Negative = early, positive = late.             | Every receive action   |
| `defect_rate`       | % of received units flagged as defective (WMS pick exceptions)                         | ✅ LIVE — FEAT‑004      |
| `total_pos`         | Lifetime count of fully received POs                                                  | On status → `received` |

**API Endpoints [LIVE]**

| Method | Path                                                          | Description                                            |
|--------|---------------------------------------------------------------|--------------------------------------------------------|
| GET    | `/api/v1/suppliers`                                           | All suppliers with open PO count                       |
| POST   | `/api/v1/suppliers`                                           | Create supplier                                        |
| GET    | `/api/v1/suppliers/purchase-orders`                           | All POs with supplier info + line item counts          |
| POST   | `/api/v1/suppliers/purchase-orders`                           | Create PO with line items                              |
| GET    | `/api/v1/suppliers/purchase-orders/:poId/line-items`          | Line items for a PO                                    |
| PATCH  | `/api/v1/suppliers/purchase-orders/:poId/status`              | Advance PO status                                      |
| POST   | `/api/v1/suppliers/purchase-orders/:poId/receive`             | Record received quantities (FEAT‑004 will call this)   |

**When PO marked `shipped` [LIVE — FEAT‑004 ✅]**

- System generates an alert/task in Alerts module: `wms:receive:arrived:{poId}`  
- Alert links to WMS Receive Session screen  
- Operator processes each package: scans, labels, checks quality, flags defects  
- On session complete: updates `purchase_order_line_items.quantity_received`, triggers supplier rating recompute, updates PO status  

---

### 1.2 RECEIVE JOB  [LIVE — FEAT‑004 ✅]

⚠️ Designed. Not yet implemented. Alert trigger from Suppliers Portal is the integration point.

**Trigger**  
PO transitions to `shipped` → system creates `receive_jobs` record linked to PO + fires alert `wms:receive:arrived:{poId}`

**Receive Job Lifecycle**  
`pending → in_progress → inspection → barcode_assignment → stow_ready → closed`

**Planned Data Model — `receive_jobs`**

| Column                | Type                  | Notes                                                       |
|-----------------------|-----------------------|-------------------------------------------------------------|
| `receive_job_id`      | uuid PK               |                                                             |
| `shop_id`             | int FK                |                                                             |
| `po_id`               | uuid FK `purchase_orders` |                                                         |
| `status`              | enum                  | `pending`, `in_progress`, `inspection`, `barcode_assignment`, `stow_ready`, `closed` |
| `assigned_operator_id`| int nullable FK `users`|                                                            |
| `total_variants`      | int                   |                                                             |
| `total_units`         | int                   |                                                             |
| `units_inspected`     | int default 0         |                                                             |
| `units_accepted`      | int default 0         |                                                             |
| `units_rejected`      | int default 0         |                                                             |
| `created_at` / `updated_at` | timestamp       |                                                             |

---

### 1.3 INSPECTION PROCESS  [LIVE — FEAT‑004 ✅]

⚠️ Designed. Not yet implemented.

**UI — Receive/Inspection Screen (Mobile, per variant group)**

```

┌─────────────────────────────────────┐
│  ZONE 1 — VARIANT IDENTITY          │
│  Product title                      │
│  Variant: Blue / XL                 │
│  Expected qty: 13                   │
├─────────────────────────────────────┤
│  ZONE 2 — INSPECTION COUNTER        │
│  [✓ Accepted: 0] [✗ Rejected: 0]   │
│  Tap + for each accepted unit       │
│  Tap ✗ to report a problem unit     │
├─────────────────────────────────────┤
│  ZONE 3 — ACTION                    │
│  [Report Problem] [Confirm Batch]   │
└─────────────────────────────────────┘

```

**Inspection Flow — per variant**  

- Operator sees variant details and expected quantity  
- For each unit: good → tap `+` (accepted counter); problem → tap `✗` → problem dialog  
- Problem types: `defect | packaging_damage | wrong_item | wrong_variant | wrong_quantity | other`  
- Problem logged to `receive_exceptions` table  
- When all units inspected → **Confirm Batch** → move to next variant  

---

### 1.4 BARCODE ASSIGNMENT  [PARTIALLY LIVE]  

✅ Floor Planning module live. `warehouse_locations.barcode` column added (migration 0048). Product barcodes read from `external_product_identity_map`.

**Barcode Model — Confirmed & Live**  

- **Location barcodes**: system‑generated, stored on `warehouse_locations.barcode` (e.g. `LOC-A01-03-B`)  
- **Product barcodes**: supplier barcodes (UPC/EAN) from `external_product_identity_map.barcode` — resolve to `lasyncro_variant_id`  
- `lasyncro_variant_id` is the authoritative system identity — platform‑agnostic  
- Floor Planning UI shows both: location barcodes + product barcodes table (assigned/unassigned)  

**Barcode Assignment Rules**  

- Variants with existing barcode (synced from Shopify) → skip generation, proceed to print  
- Variants without barcode → system generates LaSyncro barcode: `LS-{shop_id}-{lasyncro_variant_id_short}`  
- Stored on `external_product_identity_map.barcode`  

**Planned — `barcode_print_jobs` [FEAT‑004]**

| Column                | Type                  | Notes                                               |
|-----------------------|-----------------------|-----------------------------------------------------|
| `print_job_id`        | uuid PK               |                                                     |
| `shop_id`             | int FK                |                                                     |
| `receive_job_id`      | uuid FK nullable      |                                                     |
| `lasyncro_variant_id` | uuid FK               |                                                     |
| `quantity`            | int                   |                                                     |
| `barcode_value`       | text                  |                                                     |
| `status`              | enum                  | `pending`, `printing`, `printed`, `attached`        |
| `printed_at` / `attached_at` | timestamp nullable |                                                     |

---

### 1.5 STOW TASK CREATION  [LIVE — migration 0084]  

✅ `stow_tasks` table exists. Stow execution implemented in WMS module.

**Trigger**  
All accepted units barcoded and confirmed → receive job transitions to `stow_ready` → system creates `stow_tasks` per variant group.

**Location Suggestion [PLANNED — WM‑36]**  

1. **Home location (priority 1)**: variant has designated home location → suggest if empty  
2. **Product family proximity (priority 2)**: same family stowed nearby → suggest adjacent bin  
3. **Empty location (priority 3)**: nearest empty bin to receiving dock  
4. **Overflow (priority 4)**: flag for owner/admin manual assignment  

**Location Suggestion Mode [`shop_wms_settings`]**  

- `suggest` — system shows top 3, operator chooses  
- `pre_select` — system pre‑selects best, operator confirms or overrides  

---

### 1.6 STOW EXECUTION  [LIVE]  

✅ Stow execution implemented in WMS module. Location scan optional (configurable).

**Stow Flow**  

- Operator claims stow task  
- Screen shows product, quantity, suggested location  
- Operator carries units to location, scans location barcode (WM‑28) or manually confirms  
- **Confirm Stow** → two `inventory_movements` records written: `location_transfer` debit at `WH-{n}-ROOT` (stock leaves staging) and `location_transfer` credit at destination bin (stock arrives). `stow_tasks.inventory_movement_id` linked to credit movement. See `docs/blueprints/inventory_movement_audit_trail.md`.  
- Stow alert auto‑resolves → `inventory_truth` projection updated  
- **Unit status update (both paths):** Confirm Stow must flip `inventory_units` → `status='stowed'` + `current_location_code` on **both** scan paths: (a) scanned-LSU path updates the scanned unit + qty-1 siblings from the same receive job line; (b) web task-confirm path (no LSU) resolves the variant's oldest `received` units FIFO, limited to qty.

> **Known bug fixed (June 2026) — WMS-OPS-01:** the no-LSU branch and the bin-capacity check were mistakenly nested *inside* `if (lasyncroUnitId)` in `confirmStow` (`stow.service.ts`). On the web task-confirm path (`lasyncroUnitId` undefined) the whole block was skipped — task completed and `inventory_movements`/`inventory_truth` updated, but units stayed `received`, so picking could never locate the stock. Fix: the LSU and no-LSU branches must be **siblings** of `if (lasyncroUnitId)`, and the capacity check must sit **outside** the branch so it runs for both. Prior service-level patches failed because they edited logic inside the unreachable block.

> **Dual-track principle — WMS-OPS-02 (June 2026):** LaSyncro runs **both** LSU-tracked and non-LSU (legacy) stock through the *same* lifecycle (receive → stow → pick → pack → ship) so merchants adopt **without** re-labelling existing stock or halting operations. Non-LSU stock has no `inventory_units` rows — it lives only as variant-level `inventory_truth` quantities. Both paths are proven end-to-end. LSU coverage grows progressively as new stock is received.

> **Known bug fixed (June 2026) — WMS-OPS-02b (coverage metric):** `computeCoverage` (`inventoryUnit.service.ts`) measured `inventory_units` against itself (denominator = unit-row count), so non-LSU stock was invisible — it would report ~100% while hundreds of units sat unlabelled. **Correct definition:** denominator = total physical stock = SUM(`inventory_truth.on_hand_quantity`) where qty > 0 (all locations incl. WH-{n}-ROOT staging — a unit in staging is physically present and unlabelled); numerator = active `inventory_units` (status NOT IN shipped/lost). Result adds `unlabelled_in_circulation` (= physical − labelled), surfaced in the Settings → Warehouse coverage strip as the actionable adoption gap. Verified: 4 / 624 → 1%, 620 unlabelled.

> **Known bug fixed (June 2026) — WMS-OPS-03 (pick-complete):** the `order_warehouse_status` UPDATE in pick-complete (`wms.controller.ts`) filtered by `shop_id` — a column that table does **not** have (tenant isolation is via RLS on the order subquery) — and by the wrong source status. It threw
---

## PART 2 — OUTBOUND: ORDERS & FULFILLMENT

### 2.1 ORDER INGESTION & CONSTRAINT CHECK  [LIVE]  

✅ Shopify webhook ingestion live. Constraint engine live. Order pool live.

| Blocker Type        | Description                                      | Source                            |
|---------------------|--------------------------------------------------|-----------------------------------|
| `customer_blocked`  | Customer flagged (fraud, chargeback history)      | `customers` table flag            |
| `inventory_blocked` | Insufficient stock to fulfil order                | `inventory_truth` projection      |
| `operational_block` | Manual hold placed by owner/admin                 | `order_constraints` table         |
| `payment_block`     | Payment not confirmed                             | Shopify payment status            |
| `address_block`     | Shipping address invalid                          | Address validation (future)       |

---

### 2.2 BATCH MANAGEMENT SETTINGS  [LIVE — migration 0087]  

✅ `shop_wms_settings` table exists with all configurable fields.

| Setting                            | Description                                      | Default   |
|------------------------------------|--------------------------------------------------|-----------|
| `max_batch_line_items`             | Maximum line items per batch                     | 108       |
| `auto_release_enabled`             | Whether batches release automatically            | false     |
| `auto_release_interval_minutes`    | How frequently auto‑release fires                | 30        |
| `min_orders_to_release`            | Minimum orders before auto‑release fires         | 1         |
| `release_strategy`                 | `fifo` (oldest first) or `optimized` (location‑grouped) | `fifo`    |
| `idle_alert_threshold_minutes`     | Idle operator alert threshold                    | 20        |
| `default_broadcast_on_release`     | Notify all operators on batch release            | true      |
| `require_location_scan_on_stow`    | Enforce location barcode scan during stow        | false     |
| `stow_auto_assign`                 | Auto‑assign stow tasks to specific operator      | false     |
| `location_suggestion_mode`         | `suggest` or `pre_select`                        | `suggest` |

### 2.3 BATCH ASSEMBLY & RELEASE  [LIVE — INV-RES-01 ✅ 2026-08-10]  

✅ Manual and auto-release implemented. `pick_batches` + `pick_batch_orders` tables live.  
✅ INV-RES-01 adds persisted physical reservation ownership through `pick_reservation_allocations`.

- Full orders only — no split orders across batches.
- A single order line **may** be split across multiple physical inventory locations when one location cannot satisfy the full quantity.
- Assembly strategy: `fifo` or `optimized` (location-grouped).
- Release triggers: manual (owner/admin) or auto (worker polling).
- On release: alert `wms:batch:released:{batchId}` fired, push dispatched.

**Reservation model — INV-RES-01**

The batch is the workflow container; it is not the final owner of reserved inventory.

Reservation ownership is persisted as:

```text
batch
  → order
    → order line
      → variant
        → location
          → quantity
```

`reserveBatchInventory()` still computes the authoritative aggregate allocation of inventory by variant + location and writes the normal `reservation_hold` ledger movements.

INV-RES-01 additionally maps that aggregate reservation back to its owning order lines and persists each physical reservation task in:

```text
pick_reservation_allocations
```

Each row records:

```text
allocation_id
shop_id
pick_batch_id
lasyncro_order_id
lasyncro_line_item_id
lasyncro_variant_id
location_code
quantity
```

This means one commerce/order line may legally produce multiple physical pick tasks.

Example:

```text
Order line quantity = 6

A-4 available = 3
C-1 available = 5

Persisted physical allocations:

A-4 → qty 3
C-1 → qty 3
```

The aggregate reservation remains represented in `inventory_movements`; `pick_reservation_allocations` provides deterministic physical ownership and settlement identity.

---

### 2.4 PICK EXECUTION  [LIVE — INV-RES-01 ✅ 2026-08-10]  

✅ Full pick session implemented.  
✅ Split-location reservation tasks implemented and runtime-verified.  
✅ Allocation-backed pick settlement is atomic and location-specific.

**Pick Session Lifecycle**  
`pending → picking → pick_complete`

### Pick task contract

For batches containing `pick_reservation_allocations`, the picker does not receive one synthetic task per order line.

The read model emits one unresolved physical task per reservation allocation:

```text
reservation_allocation_id
+ order line
+ variant
+ exact location
+ exact quantity
```

Historical batches with zero reservation-allocation rows continue through the legacy line-item read path.

### Pick Flow — per physical allocation

1. Operator arrives at the exact allocation location.
2. Operator scans/confirms the location.
3. Operator scans the expected product.
4. For quantities greater than one, operator confirms the required quantity.
5. UI submits the exact `reservation_allocation_id`.
6. Backend validates allocation identity and physical inventory before mutation.
7. Successful confirmation atomically settles inventory and reservation truth.

### Barcode identity rule

Generic product identifiers such as:

```text
EAN
UPC
SKU
Shopify/external variant barcode
```

prove **variant identity** only.

They do not prove that a particular `inventory_units` row was physically scanned.

Therefore a generic product scan does not forward an arbitrary resolver-returned `lasyncro_unit_id`.

Only an explicit:

```text
LSU-*
```

scan is treated as tracked physical-unit evidence.

When an LSU is explicitly supplied, the backend requires that the unit:

- matches the expected variant;
- is `stowed`;
- is currently at the exact reservation-allocation location.

### Atomic allocation settlement

A successful allocation-backed pick transaction writes:

```text
confirmed allocation scan
        ↓
sale inventory movement
        ↓
reservation_release inventory movement
        ↓
inventory_truth.on_hand_quantity decrement
        ↓
inventory_truth.reserved_quantity decrement
        ↓
pick_scan_log.reservation_allocation_id
```

The `sale` and `reservation_release` movements use deterministic identities derived from the reservation allocation so split tasks remain independently replay-safe.

### Line completion

For allocation-backed lines:

```text
confirmed allocation count
==
persisted allocation count
```

is required before `order_line_item_warehouse_status.status` becomes:

```text
picked
```

Therefore one confirmed allocation of a two-location line does **not** mark the line picked.

### Batch completion

Allocation-backed batches complete according to physical reservation-task cardinality:

```text
required =
COUNT(pick_reservation_allocations)

resolved =
SUM(accounted allocation outcomes)
```

For each allocation, GH-1049 defines:

```text
accounted =
  confirmed physical quantity
  + (exception.quantity_required - exception.quantity_found)
```

The batch cannot transition to `pick_complete` while any allocation has:

```text
accounted != allocation.quantity
```

Historical zero-allocation batches preserve the legacy completion contract:

```text
confirmed scans
+ distinct pick exception lines
>= total_line_items
```

### Allocation-backed exceptions — GH-1049 LIVE

Allocation-backed Pick exceptions are supported.

The reporting allocation remains immutable and remains part of the batch.
Normal Pick and exception reporting serialize on the allocation row.

`item_missing` records the incident without fabricating physical movement.

`short_pick` records the physically found quantity and its Pick-time
`pick_removal` / partial `reservation_release` atomically, while the missing
remainder remains represented by the exception and linked Problem Center task.

Pick completion is quantity-accounted; an exception never pretends missing
units were physically picked.

Residual reservation disposition and Problem Bin custody remain downstream
contracts. The Pack fulfillment gate is now implemented by GH-1086 / PACK-GATE-01:
a recorded Pick deficit makes only the affected order non-packable unless explicit
commercial authorization permits a quantity-correct partial shipment.

See `docs/playbooks/pick_exception_workflow.md`.

---

### 2.5 PACK EXECUTION  [LIVE — WEB-PACK-01 ✅ | WEB-PACK-02 ✅ RESOLVED June 5, 2026]

✅ Pack session implemented. Pack exceptions live. Pack decision request pattern shipped (WM‑33 ✅ — see wms_pack_decision_playbook.md).
✅ WEB-PACK-02 RESOLVED June 5, 2026 — Item-centric free-scan pack surface live. POST /wms/pack/free-scan routes LSU- (unit resolve + auto-claim + auto-print + pack scan confirm) and LSO- (ship confirm + batch auto-complete). Operations page pack mode panel always-on with NodeTrack pulse. PackSessionPage fully rewritten — no Brief, no Summary, no Order Complete screen. See wms_webapp_workflow_playbook.md §WEB-PACK-02.

**Pack Session Lifecycle**  
`pick_complete → packing → pack_complete`

**Pick-deficit Pack gate — GH-1086 / PACK-GATE-01 [LIVE]**

- A post-Pick `item_missing` / `short_pick` remains a **Problem Center** concern.
  It does not return the order to Order Pool or Blocked Orders.
- The affected order remains attached to its Pick batch and warehouse history.
- Healthy sibling orders in the same batch remain independently packable.
- Operational Problem Center resolution (`re_stow`, `discard`, `write_off`,
  `quarantine`, `find_replacement`) does not by itself authorize shipment.
- Full Pack requires no recorded fulfillment deficit plus sufficient physical
  fulfillment evidence.
- Partial Pack requires explicit owner/admin `partial_shipment=true` approval and
  cannot exceed physically picked evidence.
- Hold/reject means the order remains in its batch and stays non-packable; it is
  never detached or requeued.
- A batch cannot reach `pack_complete` while a member order still carries an
  unauthorized fulfillment deficit.

**Current Pack Flow — order-centric [WEB-PACK-01 ✅]**

- Packer claims batch (separate from picker — enforced at service layer)
- Orders presented sequentially. Per order: packer scans each line item barcode → verified → ship confirmation tapped → advance to next order
- **Blocking exceptions** (`item_missing`, `short_pick`): raises `PackDecisionRequest` → pack pauses → owner notified (push + alert) → owner approves/rejects → packer advances ✅
- **Non-blocking exceptions** (`product_defect`, `packaging_defect`, `wrong_item`): problem bin → advance immediately ✅

**Production Pack Flow — item-centric free-scan [WEB-PACK-02 ✅ RESOLVED June 5, 2026]**

Operational reality: picked items arrive at packing station in a roller bin in no particular order. Packer grabs whatever is on top and scans it. UI is item-centric, not order-centric.
Packer scans any LSU- unit barcode (USB/BT/MDE scanner or manual)
→ POST /wms/pack/free-scan resolves unit → batch auto-claimed if first scan (pick_complete → packing)
→ Screen shows: variant image, product name, variant, SKU, order number, customer, shipping address
→ If multi-item order: sibling thumbnail strip with confirmed/pending indicators
→ Invoice (A4) + shipping label auto-print on session open (non-blocking on printer failure)
→ Packer places item(s) in box, inserts invoice
→ [WM-34] Packer scans invoice barcode → ship confirmed + Shopify writeback
→ Green flash → screen clears → ready for next scan
→ Batch auto-completes when all items confirmed — no manual pack-complete tap

**Blocked on:**

- ~~WM-34: Invoice barcode generation + print-on-scan infrastructure~~ ✅ RESOLVED
- ~~WM-38: Carrier integration~~ ✅ RESOLVED

**Pack Decision Request [LIVE — WM‑33 ✅ — Migration 0111]**  
`pack_exception_threads` pattern retired. Replaced by `pack_decision_requests` table:  
`id`, `shop_id`, `pick_batch_id`, `lasyncro_order_id`, `lasyncro_line_item_id`, `exception_type`, `question`, `status` (`pending|approved|rejected`), `partial_shipment`, `raised_by`, `raised_at`, `resolved_by`, `resolved_at`, `note`  
See full contract: `docs/playbooks/wms_pack_decision_playbook.md`

**Pack Decision Request [LIVE — WM‑33 ✅ — Migration 0111]**  
`pack_exception_threads` pattern retired. Replaced by `pack_decision_requests` table:  
`id`, `shop_id`, `pick_batch_id`, `lasyncro_order_id`, `lasyncro_line_item_id`, `exception_type`, `question`, `status` (`pending|approved|rejected`), `partial_shipment`, `raised_by`, `raised_at`, `resolved_by`, `resolved_at`, `note`  
See full contract: `docs/playbooks/wms_pack_decision_playbook.md`

---

### 2.6 SHIP CONFIRMATION  [LIVE]  

✅ Ship confirmation implemented. Shopify `fulfillmentCreate` integration live.

- **Full ship**: `order_warehouse_status` → `shipped`, Shopify `fulfillmentCreate` fired, customer notified  
- **Partial ship**: unshipped line items re‑queued into next batch release (WM‑18/WM‑37)  

---

## PART 3 — WAREHOUSE LOCATIONS & FLOOR PLANNING

### 3.1 LOCATION HIERARCHY  [LIVE — migration 0048]  

✅ `warehouse_locations` table live. `barcode` column added to migration 0048.

**Hierarchy:** Warehouse → Lane → Shelf → Bin  
**Location type enum:** `warehouse | lane | shelf | bin`  
**Location code format:** `{Zone}-{Lane}-{Shelf}-{Bin}`  e.g. `A-1-3-7`  
**Barcode format:** `LOC-{location_code}`  e.g. `LOC-A-1-3-7`

**Floor Planning Module [LIVE — FEAT‑002]**  

- List/table interface for admin/owner — operator read‑only  
- **Locations tab**: warehouse zones/shelves/bins with system barcodes  
- **Products tab**: variants + supplier barcodes from `external_product_identity_map`, unassigned collapsed  
- Client‑side filter on SKU/barcode for assigned products  
- Barcode generation for new locations: system‑generated, stored on `warehouse_locations.barcode`

---

### 3.2 LOCATION STATES  [PLANNED — WM‑36]

| State      | Description                  |
|------------|------------------------------|
| `empty`    | No stock assigned            |
| `occupied` | Stock stowed                 |
| `reserved` | Reserved for incoming stow   |
| `blocked`  | Physically blocked, not usable |

---

### 3.3 VARIANT‑TO‑LOCATION ASSIGNMENT  [PLANNED — WM‑36]  

- Each variant can have a **home location** — default stow and pick location  
- Home location assignment done in Floor Planning module by owner/admin  
- During stow: system suggests home location first  
- During pick: assigned location shown on screen  

**Requires:** `variant_location_assignments` table (not yet created)

---

## PART 4 — FULL DATA MODEL STATUS

| Table                           | Migration | Status        | Notes                                                              |
|---------------------------------|-----------|---------------|--------------------------------------------------------------------|
| `warehouse_locations`           | 0048      | ✅ LIVE       | `barcode` column added in 0048                                     |
| `shop_wms_settings`             | 0087      | ✅ LIVE       | all configurable fields present                                    |
| `pick_batches`                  | 0081      | ✅ LIVE       |                                                                    |
| `pick_batch_orders`             | 0082      | ✅ LIVE       |                                                                    |
| `pick_exceptions`               | 0083      | ✅ LIVE       |                                                                    |
| `stow_tasks`                    | 0084      | ✅ LIVE       |                                                                    |
| `pick_scan_log`                 | 0085      | ✅ LIVE       |                                                                    |
| `pack_scan_log`                 | 0086      | ✅ LIVE       |                                                                    |
| `suppliers`                     | 0094      | ✅ LIVE       | `on_time_rate`, `fill_rate`, `avg_delivery_days`, `defect_rate`, `total_pos` |
| `purchase_orders`               | 0095      | ✅ LIVE       | full status enum, `receive_notes`, `parent_po_id`                  |
| `purchase_order_line_items`     | 0096      | ✅ LIVE       | `description`, `quantity_ordered`, `quantity_received`, `unit_cost_cents` |
| `receive_jobs`                  | 0097      | ✅ LIVE       | FEAT‑004                                                           |
| `receive_job_lines`             | 0098      | ✅ LIVE       | FEAT‑004                                                           |
| `receive_exceptions`            | 0099      | ✅ LIVE       | FEAT‑004                                                           |
| `barcode_print_jobs`            | 0100      | ✅ LIVE       | FEAT‑004                                                           |
| `pack_decision_requests`        | 0111      | ✅ LIVE       | WM‑33 — replaced pack_exception_threads pattern                    |
| `inventory_units`               | 0115      | ✅ LIVE       | Per-unit LSU- barcode records. WM-46. |
| `inventory_movement_type` enum  | 0116      | ✅ LIVE       | Added `location_transfer` value + updated `inventory_movement_sign_check` constraint. Requires `transaction: false`. |
| `variant_location_assignments`  | —         | 🔴 PLANNED    | WM‑36                                                              |

---

## PART 5 — ALERT & NOTIFICATION REGISTER

| Alert Key                                        | Type                       | Severity | Target       | Trigger                               | Status        |
|--------------------------------------------------|----------------------------|----------|--------------|---------------------------------------|---------------|
| `wms:receive:arrived:{poId}`                     | `wms_receive_arrived`      | info     | operators    | PO marked `shipped`                   | ✅ LIVE       |
| `wms:receive:exception:{jobId}`                  | `wms_receive_exception`    | warning  | owner/admin  | Inspection problem found              | ✅ LIVE       |
| `wms:barcode:print:{jobId}`                      | `wms_barcode_print`        | info     | operator     | Barcode print job ready               | 🔴 FEAT‑004   |
| `wms:stow:pending:{taskId}`                      | `wms_stow_pending`         | info     | operators    | Stow task created                     | ✅ LIVE       |
| `wms:batch:released:{batchId}`                   | `wms_batch_released`       | info     | operators    | Batch released from pool              | ✅ LIVE       |
| `wms:exception:pick:{batchId}`                   | `wms_pick_exception`       | warning  | owner/admin  | Pick exception reported               | ✅ LIVE       |
| `wms:batch:ready_to_pack:{batchId}`              | `wms_batch_ready_to_pack`  | info     | operators    | Pick complete                         | ✅ LIVE       |
| `wms:exception:pack:{batchId}`                   | `wms_pack_exception`       | warning  | owner/admin  | Pack exception reported               | ✅ LIVE       |
| `wms:pack:decision_resolved:{requestId}`         | `wms_pack_decision_resolved`| info    | packer       | Owner approved/rejected pack decision | ✅ LIVE       |
| `wms:batch:ready_to_ship:{batchId}`              | `wms_batch_ready_to_ship`  | info     | owner/admin  | Pack complete                         | ✅ LIVE       |
| `wms:idle:pick:{userId}`                         | `wms_operator_idle`        | warning  | owner/admin  | Picker idle > threshold               | ✅ LIVE       |
| `wms:idle:pack:{userId}`                         | `wms_operator_idle`        | warning  | owner/admin  | Packer idle > threshold               | ✅ LIVE       |

---

## PART 6 — WMS LIFECYCLE DIAGRAM

### Inbound (Products)

```

Supplier PO Created (Suppliers Portal)
    ↓
PO: draft → ordered → confirmed → in_production → shipped
    ↓ (on shipped)
Alert: wms:receive:arrived:{poId} → operator notified  [FEAT‑004]
    ↓
Receive Session in WMS — operator processes each package
    ↓ accepted units          ↓ rejected units
Barcode Assignment         Receive Exception logged  [FEAT‑004]
    ↓
Bulk Label Print (Floor Planning module)
    ↓
Stow Task Created → Location suggested → Push to operator
    ↓
Operator claims stow → Carries to location → Scans bin → Confirms
    ↓
RECEIVE CLOSE: inventory_movements (inbound_purchase, +qty, WH-ROOT) written
    ↓
STOW CONFIRM: inventory_movements (location_transfer −qty WH-ROOT, +qty bin) written
    ↓
inventory_truth updated → Units available for pick

```

### Outbound (Orders)

Shopify Order Webhook
    ↓
Domain Event → Projection Engine
    ↓
Constraint Evaluation
    ↓ no blockers             ↓ blockers
Order Pool               Constraint Queue
    ↓
Batch Management (manual or auto‑release)
    ↓
Batch Released → push to operator(s)
    ↓
Operator claims pick → Single‑item‑per‑screen
    ↓
Scan → Match → Confirm (inventory_movements sale written)
    ↓ exception               ↓ all items picked
Pick Exception            Pick Complete
    ↓                          ↓
SKU Gaps                  Push to packer(s)
                              ↓
                    Packer claims pack
                              ↓
                    Item-centric free-scan (WEB-PACK-02)
                    [current: per-order scan WEB-PACK-01]
                              ↓
                    Problem? → Problem Centre (WM‑33)
                              ↓
                    Pack Complete → Push to owner/admin
                              ↓
                    Ship Confirmation (owner/admin)
                              ↓
                    Shopify writeback → Customer notified

---

## PART 7 — IMPLEMENTATION REGISTER

| ID         | Priority | Status          | Description                                                                                |
|------------|----------|-----------------|--------------------------------------------------------------------------------------------|
| FEAT‑001   | P1       | ✅ DONE         | Suppliers Portal — suppliers, POs, line items, rating auto‑compute                          |
| FEAT‑002   | P1       | ✅ DONE         | Floor Planning module — location management, barcode display                                |
| FEAT‑003   | P2       | 📋 PLANNED      | Manpower Module — operator roster, shift scheduling, task notifications, workforce financials |
| FEAT‑004   | P1       | ✅ LIVE         | WMS Receive Sessions — alert on PO shipped, operator receive flow, inspection, barcode print, supplier rating update. Migrations 0097–0100. |
| WM‑31      | P1       | ✅ DONE         | Role/Entitlement Management UI — member management, role changes                            |
| WM‑32      | P1       | ✅ LIVE         | Receive Job — full inbound pipeline (PO → inspection → barcode → stow). Migrations 0097–0100. |
| WM‑33      | P1       | ✅ LIVE         | Pack Decision Requests — replaces pack_exception_threads. Migration 0111. See wms_pack_decision_playbook.md |
| WM-34      | P1       | ✅ RESOLVED June 3, 2026 — LSO-{8char} wms_barcode generated per order at batch release. Invoice print jobs created at pack claim. GET /orders/:orderId/invoice generates A4 PDF via pdf-lib + bwip-js (Code128). Blob URL opens PDF in pack session. httpScanResolve wired for invoice_scan type. Shipping address captured from Shopify GraphQL query. Prerequisite for WEB-PACK-02 met. |
| WM‑38      | P1       | ✅ RESOLVED June 3, 2026 — Adapter pattern (ICarrierProvider). Sendcloud implementation: request_label:true, merchant credentials encrypted at rest. shop_carrier_settings + order_shipment_tracking tables (migration 0113). include_return_label toggle on shop_wms_settings. shipConfirmation step 5.5 feeds tracking into Shopify writeback. PUT/GET/DELETE /carrier-settings + POST /orders/:orderId/generate-label endpoints. WEB-PACK-02 blocker cleared. |
| WM-39      | P1       | ✅ RESOLVED June 3, 2026 — Shipping cost ingestion. Migration 0114: shipping_cost_excl_vat + currency + carrier_zone on order_shipment_tracking; carrier_shipping_cost + true_margin + true_margin_pct on order_margin_snapshot. Sendcloud parcel.price captured at label generation. computeOrderMargin joins order_shipment_tracking — true_margin = gross_margin − carrier_shipping_cost. order_revenue_units immutability preserved. |
| WEB-PACK-02 | P1      | � IN PROGRESS June 5, 2026 | Item-centric free-scan pack surface. Pack mode panel on /wms/operations: NodeTrack pulse + always-on ScanInput listening for LSU- barcodes. LSU- → POST /wms/pack/resolve-unit → order context (variant image, title, order #, customer, shipping address, sibling thumbnails). Auto-print invoice + carrier label on first LSU- scan per order. Sibling LSU- scans mark each unit confirmed. LSO- scan → ship confirmation → mode returns to listening. Batch auto-completes on last LSO- (toast only, no screen). Sad path: inline error auto-dismissed 3.5s (not-yet-picked, already-packed, unknown unit, wrong-shop). Multi-item guard: LSO- blocked until all siblings scanned. Print failure non-blocking (warning banner, packer proceeds). Problem Center escape hatch on session (missing_item, product_defect, packaging_defect). Back-nav guard on partial multi-item session. LSO- mismatch rejection. No Brief, Summary, Order Complete screens. |
| WEB-STOW-UNIT-01 | P1 | ✅ RESOLVED June 4, 2026 — Stow scan surface migrated to LSU- barcodes. Item-first Option B flow (scan item → scan location → confirm qty). NodeTrack UI matching pick pattern. Bulk inventory_units update (scanned unit + siblings by job line up to qty). current_location_code written on confirm. Soft bin capacity check — bin_over_capacity fires problem_center_tasks when max_capacity exceeded. unit_ids returned by stow tasks API for operator display. Legacy EAN/UPC fallback respected. WEB-PICK-UNIT-01 unblocked. |
| WEB-PICK-UNIT-01 | P1  | ✅ RESOLVED June 4, 2026 — Pick scan surface migrated to LSU- barcodes. ConfirmScanParams extended with lasyncro_unit_id. Resolver return type extended with lasyncro_unit_id. resolvedUnitIdRef carries unit ID from product_scan into qty_confirm path, cleared between items. Bulk inventory_units update (scanned unit + siblings by receive_job_line_id up to qty). current_location_code nulled on pick. Legacy EAN/UPC fallback retained. WEB-PACK-02 unblocked. |
| WM‑35      | P2       | 📋 PLANNED      | Batch Management Settings UI — configurable release parameters                              |
| WM‑36      | P2       | 📋 PLANNED      | Location suggestion engine — home location, proximity, empty bin                             |
| WM‑37      | P2       | 📋 PLANNED      | Partial order re‑release — unshipped line items re‑queued                                    |
| WM‑27      | P2       | 🔄 PARTIAL      | Barcode generation + bulk print — schema live, print UI planned                              |
| WM‑28      | P2       | 🔴 OPEN         | Location barcode scan during stow/pick — non-blocking for WEB-RECEIVE-UNIT-01. Elevates Class B unit label reprint flow and stow UX. Schedule after WEB-RECEIVE-UNIT-01. |
| WM-46      | P1       | ✅ RESOLVED June 4, 2026 — Per-unit barcode system. `inventory_units` table (migration 0115): LSU-{8hex} deterministic hash per unit, `inventory_unit_lifecycle_status` + `inventory_unit_provenance` enums, RLS enforced. `shop_wms_settings` extended with `legacy_barcode_fallback_enabled` + `coverage_sunset_threshold` (migration 0087). `inventoryUnit.service.ts`: batchConfirmUnits, markLabelsPrinted, reprintLabel, resolveUnitBarcode, computeCoverage, generateLsuId. `barcodeResolution.service.ts` extended with dual-namespace router: LSU- → unit path, LSO- → early reject, legacy EAN/UPC gated by fallback flag. `receiveJob.service.ts` calls batchConfirmUnits after every inspect. GH-998 superseded. See docs/blueprints/unit_barcode_architecture.md. **GH-1255 (2026-10-14):** the LSU-{8hex} hash no longer mints identities. New units get `LSU-{10 digits}` from the global sequence `inventory_unit_lsu_seq` (migration 0212). Legacy IDs are immutable and replay returns persisted identities. See unit_barcode_architecture.md Decision 4. |
| WEB-STOW-UNIT-01 | P1 | ✅ RESOLVED June 4, 2026 — Stow scan surface migrated to LSU- barcodes. Item-first Option B flow (scan item → scan location → confirm qty). NodeTrack UI matching pick pattern. Bulk inventory_units update (scanned unit + siblings by job line up to qty). current_location_code written on confirm. Soft bin capacity — bin_over_capacity fires problem_center_tasks when max_capacity exceeded. unit_ids returned by stow tasks API. Legacy EAN/UPC fallback respected. WEB-PICK-UNIT-01 unblocked. |
| WM-50 | P2 | 🔴 OPEN | Warehouse grid live-data wiring — 2D/3D canvas in wms/ must reflect real-time inventory_units.current_location_code across all workflows (stow, pick, pack). Locations light up as units are stowed/picked. Blocked on WEB-STOW-UNIT-01 ✅. |
| WEB-RECEIVE-UNIT-01 | P1 | ✅ RESOLVED June 4, 2026 — Unit label PDF generation at inspect. `unitLabelPdf.service.ts`: 50×25mm thermal PDF, one page per LSU- unit, Code128 barcode + LSU- id + SKU/variant text. `GET /wms/receive-job-lines/:lineId/unit-labels` returns PDF blob. `GET /wms/coverage` returns labelled_units + total_active_units + coverage_pct. `ReceiveSessionPage`: `onPrintUnitLabels` prop, `inspectAndPrint` wrapper fires print after every inspect — non-blocking on failure. `ShopSettingsWarehousePage`: UnitLabelCoverageSection with progress bar, colour-coded by threshold, 60s refresh. Verified: PDF 200 + 3.6KB, coverage 100% after inspect. |
| WM-47      | P1       | ✅ RESOLVED June 4, 2026 — Print dispatch + printer registry + QZ Tray onboarding. Migration 0106: `printer_role` enum (unit_label, invoice, problem_label, general) + `os_printer_name` column. `printers.controller.ts`: CRUD + default-by-role. is_default enforced per role. `qzPrint.ts`: QZ Tray dispatch via localhost:8182, fetches default printer for role, prints PDF base64 silently, returns false → caller falls back to browser tab. `QzTrayOnboardingPrompt`: fixed bottom-right, shown once per device on first fallback print, localStorage-dismissed. `ShopSettingsWarehousePage` Printers section: QZ Tray status, add printer form, role/connection/OS name, default toggle, soft-delete. |
| 26‑011     | P2       | 📋 PLANNED      | Load/stress test — synthetic multi‑shop event flood, projection throughput                   |
| 26‑012     | P2       | ✅ DONE         | specter tsconfig — switched from `tsc -p` to `tsc -b` with composite                         |
| INFRA‑001  | P3       | 📋 PLANNED      | Migrate `console.*` + `debugLog` to Pino structured logging                                 |
| INFRA‑002  | P3       | 📋 PLANNED      | Replace `shop_snapshot_jobs` polling with pg‑boss job queue                                 |
| INFRA‑003  | P3       | 📋 PLANNED      | Wire OpenTelemetry trace IDs through projection pipeline                                    |

---

## PART 8 — STRICT ENGINEERING DIRECTIVES

- **AUDIT FIRST** — Before any code changes, produce a full end‑to‑end audit via `grep`/`sed`/`cat`. Never assume the handover is complete.  
- **Migration policy**: In development, fix base migrations directly. Never create patch migrations for active development. Only new migrations for genuinely new schema additions.  
- **Currency conversion** is display‑only — never convert values in DB queries. All monetary fields stored in `base_currency` only.  
- **Module transport rules** — Modules in `/modules/*` cannot import from `apps/frontend/src/` or other modules. All shared utilities via `@lasyncro/shared`.  
- **`DEBUG_PROJECTION=1`** — Set to re‑enable per‑order projection trace logs. Never remove `debugLog` calls — only gate them.  
- **Exchange rates** are best‑effort — stale fallback serves last available rates. Monitor `[exchange-rate-worker] fetch failed` in production.  
- **Never weaken RLS policies** on `warehouse_locations`, `purchase_orders`, `suppliers`, or any tenant‑scoped table.  
- **`PATCH /me/currency`** is not backend role‑restricted — do not remove frontend gate without adding backend enforcement.  
- **Receive quantities** are recorded by operator after physical inspection — never pre‑filled or assumed from PO ordered quantities.  
- **`lasyncro_variant_id`** is the authoritative product identity across all platforms. Never use external IDs as keys in domain logic.

### Cross-references

**Cross-references:** OrderPool.md — pool feeds batch release. WarehouseGrid.md — spatial pick route uses floor coordinates. constraint_system_blueprint.md — constraint resolution gates pool entry.

---

## PARITY GAP REGISTER — Updated May 31, 2026

| ID | Surface | Gap | Priority |
|----|---------|-----|----------|

| WEB-STOW-01 | Web WMS | ✅ RESOLVED — `StowSessionPage` built and verified May 31, 2026. 5 phases (summary → location_scan → product_scan → qty_confirm → complete), partial stow, shortfall exception dialog with multi-exception support, miscount escape hatch. inventory_truth verified via SQL after confirm. | P2 |

| WEB-RECEIVE-01 | Web Suppliers Portal | ✅ RESOLVED May 31, 2026 — Unlinked PO line items (free-text, no variant) blocked at PO creation modal submit. Error names the unlinked item. Tooltip + Shopify admin link + re-sync instruction shown inline when text is typed without selecting from catalog. `receiveJob.service.ts:286` guard is now correct by design, not silent failure. | P1 |

| WEB-RECEIVE-02 | Web WMS Receive Session | ✅ RESOLVED May 31, 2026 — Shortfall modal implemented mirroring mobile. Multi-exception loop, Problem Center routing, miscount escape hatch hidden after first exception committed, inline qty validation, UX playbook compliant buttons. Phase 2 (scan path) remains backlog. | P1 |

| WEB-STOW-02 | Web WMS Stow Session | ✅ RESOLVED May 31, 2026 — `StowSessionPage` used `BarcodeScanSurface` (mobile camera component) for location_scan and product_scan phases, opening the PC webcam on webapp. Fixed by creating inline `ScanInput` component (TextField, autofocus, Enter-to-submit). Accepts typed input and USB/BT scanner events. Both phases updated. | P1 |

| WEBHOOK-01 | Backend / Shopify Integration | ✅ RESOLVED June 2, 2026 — products/create + products/update registered. Dual-secret HMAC verification (admin + app secrets). REST payload normalizer to GQL edge format. Token decryption fixed. End-to-end verified. GitHub #996. | P1 |

| UX-RESYNC-01 | Web Top Nav | ✅ RESOLVED June 2, 2026 — Live pill opens Catalog Sync popover with status, product/variant/order counts, recently synced products list, ghost-orange resync CTA. GitHub #997 closed. #999 + #1000 filed for expansion + stability. | P2 |

| WEB-RECEIVE-03 | Web WMS Receive Session | ✅ RESOLVED May 31, 2026 — Path B (scan mode) implemented on webapp. Free-scan pattern: operator scans any unit, system resolves barcode to PO line, increments count, green flash on hit, auto-confirms at expected qty, overcount dialog, session persistence via URL param + sessionStorage, resume banner for lost mid-scan progress. See `docs/playbooks/wms_webapp_workflow_playbook.md` for full scan pattern contract. | P1 |
| WEB-RECEIVE-04 | Web Suppliers Portal | ✅ RESOLVED May 31, 2026 — Unit cost field: type="text", inputMode="decimal", regex validation, auto-format to 2dp on blur, $ adornment. Qty field: type="number", inline error on invalid. Variant dropdown onBlur clears options with 150ms delay to prevent overlay blocking adjacent fields. | P2 |

| WEB-STOW-03 | Web WMS Stow Session | ✅ RESOLVED June 1, 2026 — Full Playbook-compliant Stow workflow implemented and UI-simulated. Phase renamed `summary` → `brief`. New `summary` phase added between `qty_confirm` and `complete`. 15 bugs resolved (scan error swallowing, modal bypass, pre-filled qty, miscount hatch, ScanInput inline button, re-focus after error, LinearProgress, session persistence via URL param Option B, chip label mismatches, step orientation banners, fontWeight violations, alpha tinting, back navigation). All five simulation tests passed (wrong barcode, wrong product, refresh recovery, back nav, error states). Build clean. See `docs/playbooks/wms_webapp_workflow_playbook.md` §12 for full findings register. | P1 |

| WEB-PICK-01 | Web WMS Pick Session | ✅ RESOLVED June 1, 2026 — Brief screen added to PickSessionPage. Shows batch ID, line item count, total units, optimized route instruction. Start Picking CTA transitions to location_scan phase. | P1 |
| WEB-PICK-02 | Web WMS Pick Session | ✅ RESOLVED June 1, 2026 — Camera/BarcodeScanSurface removed. Replaced with two-scan ScanInput pattern per Playbook §2: location scan (client-side match against location_code) then product scan (onResolveBarcode). USB/BT scanner + manual Enter supported. Auto-focus and re-focus after error wired on both phases. | P1 |
| WEB-PICK-03 | Web WMS Pick Session | ✅ RESOLVED June 1, 2026 — Summary screen added. Shows per-line results (picked vs exception), exception count warning, Confirm Pick Complete CTA. Problem Center called on every exception alongside /batch/:id/exception endpoint. Session persistence via ?batchId= URL param (pendingPickBatchId prop pattern, matching Stow). product_title + variant_title added to line-items API response (products join). Full backend verification passed: scan → inventory_movements(sale/-1), exception → PROB label, pick-complete guard enforced. | P1 |
| WEB-PACK-01 | Web WMS Pack Session | ✅ RESOLVED June 2, 2026 — Full Playbook-compliant Pack workflow implemented. 17 audit issues resolved. Brief + Summary screens added. ScanInput replaces BarcodeScanSurface. Session persistence via ?packBatchId= URL param. LinearProgress + step banner added. Problem Center wired on every exception. wrong_item added to exception taxonomy. product_title + variant_title split on backend (products join on /batch/:id/orders). Backend smoke test passed: single-item + multi-item orders, ship confirmation, pack-complete. See docs/playbooks/wms_webapp_workflow_playbook.md §14. | P1 |
