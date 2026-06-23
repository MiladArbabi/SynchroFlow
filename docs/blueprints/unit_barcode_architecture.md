# LaSyncro — Per-Unit Barcode Architecture
**Version:** 1.0
**Date:** June 3, 2026
**Status:** ✅ Locked — approved for implementation
**Sprint:** WM-46 (backend) + WEB-RECEIVE-UNIT-01 (webapp)
**Author:** Derived from workshop session, June 3, 2026

---

## 1. Purpose & Problem Statement

All existing WMS workflows (Receive → Stow → Pick → Pack) rely on **variant-level barcodes synced from Shopify** (EAN, UPC, Shopify barcode field) to resolve physical items to system records. This model has four structural weaknesses:

1. **Missing barcodes** — many SMB suppliers ship products without any barcode. Scan fails silently.
2. **Duplicate barcodes** — two variants sharing an EAN causes wrong resolution.
3. **No unit-level identity** — the system cannot distinguish between two physically separate units of the same variant.
4. **Label destruction** — damaged or missing labels make a unit unresolvable with no recovery path.

The per-unit barcode system resolves all four by assigning a LaSyncro-owned `LSU-` identifier to every physical unit at the moment it enters the warehouse. From that moment, the same barcode is the single source of truth across stow → pick → pack → ship.

---

## 2. Locked Decisions

### Decision 1 — `receive_sequence` assignment model: Batch-confirm

When a PO line quantity is confirmed at receive, the system assigns `receive_sequence` values 1–N in bulk and prints all labels at once. Sequences are assigned administratively rather than tied to physical handling order. This is faster and appropriate for SMB warehouse throughput.

Implication: `receive_sequence` uniquely identifies each unit within its PO line (or receive session for no-PO receives) but does not encode the physical handling order of individual units.

### Decision 2 — No-PO receive fallback anchor: `receive_session_id`

The deterministic hash uses `po_line_id` as an anchor when a PO exists. When a receive happens without a PO (direct supplier drops, samples, replacements, transfers), `po_line_id` is null. In this case, `receive_session_id` replaces it as the anchor. The hash function degrades gracefully — same algorithm, different input.

```
With PO:    LSU-{SHA256(shop_id + variant_id + po_line_id + receive_sequence)[0:8]}
Without PO: LSU-{SHA256(shop_id + variant_id + receive_session_id + receive_sequence)[0:8]}
```

### Decision 3 — Backfill approach: Progressive labelling with natural stock rotation

No mandatory stocktake is required to go live. The system launches with a dual-namespace resolver. Legacy stock rotates out naturally under FIFO. New inbound units are labelled automatically at receive. Coverage climbs without operator intervention. Full architecture detailed in §6.

---

## 3. Unit Identity Model

### The LSU identifier

```
lasyncro_unit_id = LSU-{8 hex chars}

Examples:
  LSU-a3f72c1d
  LSU-009b4e82
```

The `LSU-` prefix is reserved and must never be used by any other barcode namespace in the system. Existing namespaces:
- `LSO-{8char}` — order invoice barcodes (WM-34)
- `TEST-{N}` — dev/test barcodes
- Raw EAN/UPC — legacy Shopify-synced variant barcodes

### Deterministic hash guarantee

The same physical unit will always produce the same `lasyncro_unit_id` as long as the receive facts exist in the database. Re-printing is retrieval, not regeneration. The ID is written once at receive and is immutable for the lifetime of the unit record.

### Two product classes

**Class A — Products arriving WITH EAN/UPC/standard barcodes**

EAN/UPC is variant-level (many units share it). At receive, a unique `LSU-` ID is generated and the EAN/UPC is stored alongside as a coupling field. Re-print path: operator scans EAN/UPC → system finds all units with that code in this shop → narrows by current location → if one match, reprints → if multiple, short disambiguation list (receive date, receive batch sequence).

**Class B — Products arriving WITHOUT any barcode**

No secondary identifier exists on the physical object. The only anchors are the variant identity, the location, and the `receive_sequence`. Re-print path: operator triggers reprint workflow → scans shelf/bin barcode (WM-28, see §8) → selects variant from list of what's expected at that location→ system narrows to units of that variant in that bin → if one match, reprints → if multiple, short disambiguation list (receive date, batch sequence).

### UI naming canon (locked June 2026 — WMS-FP-04)
Four distinct barcode systems exist. They must NEVER be co-mingled, summed, or share a count/label in any UI surface:

| System | UI name | What it is | Generated at | Owning surface |
|--------|---------|-----------|--------------|----------------|
| `LSU-` | **Unit labels (LSU)** | Per-unit identity, single source of truth stow→pick→pack→ship | Receiving | Settings → Warehouse (coverage) + WMS scan surfaces |
| `LSO-` | **Order codes (LSO)** | Invoice barcode, pack→ship confirmation | Pack (invoice PDF) | WMS pack flow |
| Shelf/bin (WM-28) | **Location codes** | Bin, shelf & zone labels — scanned to locate stock | Floor setup | Floor Planning → Barcodes (Location codes) |
| EAN/UPC | **Product codes** | Shopify variant barcode — camera-scan fallback / re-print lookup coupling field | Synced from Shopify | Floor Planning → Barcodes (Product codes) |

Floor Planning's "Barcodes" tab owns **Location codes** and **Product codes** only. Its badge counts **missing location codes** (the to-do signal) — never a sum across systems. LSU coverage is an integration milestone, surfaced in Settings → Warehouse, with a teaching pointer from the Barcodes tab

---

## 4. Data Model

### `inventory_units` table

```sql
inventory_units (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lasyncro_unit_id           text NOT NULL UNIQUE,  -- LSU-{8char deterministic hash}
  shop_id                    int NOT NULL REFERENCES shops(id),

  -- Variant identity
  lasyncro_variant_id        text NOT NULL,

  -- External barcode coupling (Class A — nullable for Class B)
  ean                        text nullable,
  upc                        text nullable,
  shopify_barcode            text nullable,

  -- Receive anchors — immutable after creation
receive_job_line_id        uuid NOT NULL REFERENCES receive_job_lines(receive_job_line_id),
  -- Note: actual implementation uses receive_job_line_id, not receive_session_id + po_line_id
  receive_sequence           int NOT NULL,           -- position within PO line or session, IMMUTABLE

  -- Provenance
  source                     text NOT NULL           -- enum: 'lasyncro_receive' | 'legacy_stocktake' | 'manual_entry'
                             CHECK (source IN ('lasyncro_receive', 'legacy_stocktake', 'manual_entry')),

  -- Label state
  label_printed_at           timestamptz nullable,
  label_last_reprinted_at    timestamptz nullable,
  reprint_count              int NOT NULL DEFAULT 0,

  -- Lifecycle status
  status                     text NOT NULL DEFAULT 'received'
                             CHECK (status IN ('received', 'stowed', 'picked', 'packed', 'shipped', 'returned', 'lost')),
  current_location_code      varchar(255) nullable,  -- references warehouse_locations.location_code

  -- Timestamps
  received_at                timestamptz NOT NULL DEFAULT NOW(),
  created_at                 timestamptz NOT NULL DEFAULT NOW(),
  updated_at                 timestamptz NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE (shop_id, receive_session_id, lasyncro_variant_id, receive_sequence),
  FOREIGN KEY (shop_id) REFERENCES shops(id)
)
```

RLS: `shop_id = current_setting('app.current_tenant')::int` enforced on all operations.

### `shop_wms_settings` additions

Two new columns added to the existing table:

```sql
legacy_barcode_fallback_enabled  boolean NOT NULL DEFAULT true,
  -- true  = variant barcodes (EAN/UPC/Shopify) accepted at scan points
  -- false = only LSU- barcodes accepted; legacy path retired
  -- auto-disabled when unit_label_coverage_pct reaches coverage_sunset_threshold

coverage_sunset_threshold        int NOT NULL DEFAULT 100
  -- percentage at which legacy_barcode_fallback_enabled auto-disables
  -- configurable by owner/admin; default 100 means manual sunset only
```

---

## 5. Barcode Resolver — Dual Namespace

The existing barcode resolver (`wms.controller.ts` `httpScanResolve`, `barcodeResolve.service.ts`) must be extended to route by prefix/namespace before attempting any lookup.

### Resolution priority

```
Scan input received:
  1. Starts with 'LSU-'?
       → Unit barcode path
       → Look up inventory_units.lasyncro_unit_id
       → Return: unit_id, variant_id, order context (if in active pack batch),
                 location (if in active stow/pick)

  2. Starts with 'LSO-'?
       → Invoice barcode path (existing — WM-34)
       → No change to existing logic

  3. Known EAN/UPC/Shopify barcode?
       → Check shop_wms_settings.legacy_barcode_fallback_enabled
       → If true:  legacy path — resolve to variant, return variant context
       → If false: reject — "Unit barcode required. Legacy barcodes are disabled for this shop."

  4. Unknown format?
       → Reject — clear error, not a silent failure
```

### Context-awareness

The resolver always knows which workflow context the scan is happening in (receive, stow, pick, pack) from the request payload. This determines what additional context is returned alongside the resolved unit.

---

## 6. Progressive Labelling & Backfill Strategy

### Principle

No mandatory stocktake is required at onboarding. The warehouse labels itself through normal operations. The system maintains two explicitly distinct barcode lanes and retires the legacy lane automatically as coverage rises.

### How coverage is computed

```sql
SELECT
  COUNT(*) FILTER (WHERE source IN ('lasyncro_receive', 'legacy_stocktake')) AS labelled_units,
  COUNT(*) AS total_active_units,
  ROUND(
    100.0
    * COUNT(*) FILTER (WHERE source IN ('lasyncro_receive', 'legacy_stocktake'))
    / NULLIF(COUNT(*), 0)
  ) AS coverage_pct
FROM inventory_units
WHERE shop_id = $shopId
  AND status NOT IN ('shipped', 'lost');
```

This metric is surfaced in the WMS dashboard and settings page as **Unit Label Coverage**.

### The coverage metric UI

```
Unit Label Coverage: 34% ↑
127 of 374 active units carry LaSyncro unit barcodes.
48 units received this week — all labelled automatically.
[Run targeted stocktake →]
```

### Targeted stocktake (optional, opt-in)

For merchants who want to accelerate coverage before a peak period. System surfaces the top N SKUs by pick volume — the 20% of SKUs that drive 80%+ of daily picks — and generates a stocktake task. Operator works through those shelf locations, scans each unit (or confirms quantity per bin), prints labels. Source set to `legacy_stocktake` on resulting records.

This is never required. It is surfaced as an available action, not a blocker.

### Legacy lane sunset

When `coverage_sunset_threshold` is reached (default: 100%), `legacy_barcode_fallback_enabled` is auto-set to `false`. The legacy resolver path is retired. The system notifies the owner. From this point, all scan surfaces require `LSU-` barcodes — the WMS is fully on per-unit traceability.

Owners/admins can also manually disable the legacy fallback at any coverage level if they prefer a faster cutover.

---

## 7. Return Unit Identity

When a returned unit arrives at the warehouse, it **reclaims its original `lasyncro_unit_id`**. The physical unit never stopped existing. Status transitions back to `returned` on the existing record. A new inbound movement event is written referencing the same `inventory_units.id`. A receive job is pre-created by WM-40 (carrier tracking webhooks) before the parcel arrives.

Re-print on return: same path as any reprint — unit record is found by `lasyncro_unit_id` (if label survived) or by the disambiguation flow (if damaged). Reprint count incremented. No new unit record created.

This model ensures a unit's full lifecycle — inbound → stow → pick → pack → ship → return → restow — is traceable on a single record.

---

## 8. Label Format & Print Pipeline

Unit labels are a **separate concern** from invoice PDFs (WM-34). They must not share the same print pipeline.

|  | Invoice (WM-34) | Unit label (WM-46) |
|---|---|---|
| Format | A4 PDF | Thermal label (50×25mm or configurable) |
| Library | `pdf-lib` | `bwip-js` (barcode only) + thermal layout |
| Trigger | Pack claim / first pack scan | Batch-confirm at receive (all labels for the line) |
| Printer | Standard printer / browser print | Thermal printer (Zebra, Dymo, Brother) |
| Barcode | Code128, `LSO-{8char}` | Code128, `LSU-{8char}` |

Printer configuration (thermal printer connection, label size, format) is added to `ShopSettingsWarehousePage`.

---

## 9. Dependency on WM-28 (Shelf/Bin Barcodes)

The Class B reprint disambiguation flow — "scan shelf/bin, select variant, reprint" — requires shelf/bin barcodes to be present on warehouse locations. WM-28 (shelf/bin barcodes) is currently P2 / OPEN.

WM-28 is not a hard blocker for WEB-RECEIVE-UNIT-01 launch. The reprint flow falls back to manual location selection from a dropdown if no bin barcode is available. WM-28 elevates the reprint UX from acceptable to excellent and should be scheduled in the sprint immediately following WM-46 / WEB-RECEIVE-UNIT-01.

---

## 10. Implementation Register

| ID | Priority | Status | Description |
|---|---|---|---|
| WM-46 | P1 | ✅ RESOLVED June 4, 2026 | Per-unit barcode backend — `inventory_units` table (migration), deterministic `LSU-` ID generation, batch-confirm sequence assignment, dual-namespace barcode resolver extension, reprint endpoint, `legacy_barcode_fallback_enabled` + `coverage_sunset_threshold` on `shop_wms_settings`, coverage computation query. |
| WEB-RECEIVE-UNIT-01 | P1 | ✅ RESOLVED June 4, 2026 | Receive webapp — unit label generation at batch-confirm, thermal label print trigger, label reprint workflow (EAN/UPC path + bin-select path), Unit Label Coverage metric in WMS settings strip. Blocked on WM-46. |
| WEB-STOW-UNIT-01 | P1 | ✅ RESOLVED June 4, 2026 | Stow webapp — migrate scan surface to accept `LSU-` barcodes. Location confirmation via unit scan. Legacy fallback respected during transition. Blocked on WEB-RECEIVE-UNIT-01. |
| WEB-PICK-UNIT-01 | P1 | ✅ RESOLVED June 4, 2026 — Pick scan surface migrated to LSU- barcodes. Bulk inventory_units update stowed→picked. current_location_code nulled on pick. Legacy fallback retained. WEB-PACK-02 unblocked. |
| WEB-PACK-02 | P1 | 📋 PLANNED | Pack webapp redesign — item-centric free-scan. Resolver returns unit + order context on `LSU-` scan. Blocked on WEB-PICK-UNIT-01 (all upstream workflows must be on unit barcodes before pack free-scan is reliable). |
| GH-998 | — | 📋 SUPERSEDED | Per-unit barcode tracking (inventory_units table) — original ticket. Superseded by WM-46. |
| WM-28 | P2 | 🔴 OPEN | Shelf/bin barcodes — location barcode scan for bin confirmation. Elevates Class B reprint flow and stow UX. Schedule immediately after WEB-RECEIVE-UNIT-01. |

---

## 11. Key Invariants (Must Never Be Violated)

1. `lasyncro_unit_id` is written once at receive and is **immutable** for the lifetime of the record.
2. `receive_sequence` is written once at receive and is **immutable**.
3. A returned unit **never gets a new `lasyncro_unit_id`**. It reclaims its original.
4. The `LSU-` prefix is **reserved** — no other barcode namespace may use it.
5. `legacy_barcode_fallback_enabled = false` is a **one-way gate** once crossed via auto-sunset. Manual re-enable requires owner/admin explicit confirmation.
6. `reprint_count` is **always incremented** on reprint, never decremented.

---

## 12. Inventory Movement Backing

Every LSU lifecycle status transition is backed by an `inventory_movements` ledger entry:

| Transition | Movement type | Written by |
|-----------|--------------|------------|
| `received` (initial) | `inbound_purchase` | `receiveJob.service.ts` |
| `received → stowed` | `location_transfer` (debit + credit pair) | `stow.service.ts` |
| `stowed → picked` | `sale` | `pickScan.service.ts` |

See full audit trail architecture: `docs/blueprints/inventory_movement_audit_trail.md`