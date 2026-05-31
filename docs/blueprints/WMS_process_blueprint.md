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
| `defect_rate`       | % of received units flagged as defective (WMS pick exceptions)                         | FEAT‑004 — not yet live|
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

**When PO marked `shipped` [PLANNED — FEAT‑004]**  

- System generates an alert/task in Alerts module: `wms:receive:arrived:{poId}`  
- Alert links to WMS Receive Session screen  
- Operator processes each package: scans, labels, checks quality, flags defects  
- On session complete: updates `purchase_order_line_items.quantity_received`, triggers supplier rating recompute, updates PO status  

---

### 1.2 RECEIVE JOB  [PLANNED — FEAT‑004]  

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

### 1.3 INSPECTION PROCESS  [PLANNED — FEAT‑004]  

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
- **Confirm Stow** → `inventory_movements` (`inbound_purchase`) written  
- Stow alert auto‑resolves → `inventory_truth` projection updated  

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

---

### 2.3 BATCH ASSEMBLY & RELEASE  [LIVE]  

✅ Manual and auto‑release implemented. `pick_batches` + `pick_batch_orders` tables live.

- Full orders only — no split orders across batches  
- Assembly strategy: `fifo` or `optimized` (location‑grouped)  
- Release triggers: manual (owner/admin) or auto (worker polling)  
- On release: alert `wms:batch:released:{batchId}` fired, push dispatched  

---

### 2.4 PICK EXECUTION  [LIVE]  

✅ Full pick session implemented. Offline resilience via IndexedDB + Background Sync. Pick exceptions live.

**Pick Session Lifecycle**  
`pending → picking → pick_complete`

**Pick Flow — per line item**  

- Operator arrives at location shown on screen  
- Optional: scans location barcode to confirm correct bin (WM‑28, configurable)  
- Scans product barcode — camera or manual input  
- **Match** → green flash → **Confirm Pick** → `pick_scan_log` written, `inventory_movements` sale delta written  
- **Mismatch** → full‑screen red flash → auto‑return after 2.5s → re‑scan  
- **Problem** → exception dialog → `pick_exceptions` written → alert fired → push to owner/admin  
- **Offline**: scans queued in IndexedDB → Background Sync flushes on reconnect → `device_event_id` prevents double‑write  

---

### 2.5 PACK EXECUTION  [LIVE]  

✅ Pack session implemented. Pack exceptions live. Pack decision request pattern shipped (WM‑33 ✅ — see wms_pack_decision_playbook.md).

**Pack Session Lifecycle**  
`pick_complete → packing → pack_complete`

**Pack Flow — per order**  

- Packer claims batch (separate from picker — enforced at service layer)  
- **Single‑item order**: scan item → scan invoice → pack confirmed  
- **Multi‑item order**: scan all items → all confirmed → scan invoice → pack confirmed  
- **Problem** → `pack_exceptions` written → alert fired → push to owner/admin  
- **Blocking exceptions** (`item_missing`, `short_pick`): raises `PackDecisionRequest` → pack pauses → owner notified (push + alert) → owner approves/rejects → packer advances ✅  
- **Non-blocking exceptions** (`product_defect`, `packaging_defect`, `wrong_item`): problem bin → advance immediately ✅  

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
| `receive_jobs`                  | —         | 🔴 PLANNED    | FEAT‑004                                                           |
| `receive_job_lines`             | —         | 🔴 PLANNED    | FEAT‑004                                                           |
| `receive_exceptions`            | —         | 🔴 PLANNED    | FEAT‑004                                                           |
| `barcode_print_jobs`            | —         | 🔴 PLANNED    | FEAT‑004                                                           |
| `pack_decision_requests`        | 0111      | ✅ LIVE       | WM‑33 — replaced pack_exception_threads pattern                    |
| `variant_location_assignments`  | —         | 🔴 PLANNED    | WM‑36                                                              |

---

## PART 5 — ALERT & NOTIFICATION REGISTER

| Alert Key                                        | Type                       | Severity | Target       | Trigger                               | Status        |
|--------------------------------------------------|----------------------------|----------|--------------|---------------------------------------|---------------|
| `wms:receive:arrived:{poId}`                     | `wms_receive_arrived`      | info     | operators    | PO marked `shipped`                   | 🔴 FEAT‑004   |
| `wms:receive:exception:{jobId}`                  | `wms_receive_exception`    | warning  | owner/admin  | Inspection problem found              | 🔴 FEAT‑004   |
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
inventory_movements (inbound_purchase) written
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
                    Per‑order scan + invoice/label print
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
| FEAT‑004   | P1       | 📋 PLANNED      | WMS Receive Sessions — alert on PO shipped, operator receive flow, inspection, barcode print, supplier rating update |
| WM‑31      | P1       | ✅ DONE         | Role/Entitlement Management UI — member management, role changes                            |
| WM‑32      | P1       | 📋 PLANNED      | Receive Job — full inbound pipeline (PO → inspection → barcode → stow)                      |
| WM‑33      | P1       | 📋 PLANNED      | Pack Problem Centre — exception threads, resolution flow, partial ship                       |
| WM‑34      | P1       | 📋 PLANNED      | Invoice + shipping label print on pack claim                                                |
| WM‑35      | P2       | 📋 PLANNED      | Batch Management Settings UI — configurable release parameters                              |
| WM‑36      | P2       | 📋 PLANNED      | Location suggestion engine — home location, proximity, empty bin                             |
| WM‑37      | P2       | 📋 PLANNED      | Partial order re‑release — unshipped line items re‑queued                                    |
| WM‑27      | P2       | 🔄 PARTIAL      | Barcode generation + bulk print — schema live, print UI planned                              |
| WM‑28      | P2       | 🔄 PARTIAL      | Location barcode scan during stow/pick — configurable, stow implemented, pick optional       |
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
