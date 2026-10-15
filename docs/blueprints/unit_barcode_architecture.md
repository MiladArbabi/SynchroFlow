# LaSyncro — Per-Unit Barcode Architecture
**Version:** 1.0
**Date:** June 3, 2026
**Status:** ✅ Locked — approved for implementation
**Amended:** October 14, 2026 — GH-1255 LSU-IDENTITY-01 (new-unit identity, label geometry; see Decision 4, §3, §8, §11)
**Amended:** October 15, 2026 — GH-1254 S4-B held-unit source anchor (dark, not deployed; see §4, §6, §10, §11, §12)
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

> **Superseded by Decision 4 (GH-1255).** The formula above was the workshop design and never matched the code. From WM-46 (3e19ca92) until GH-1255, the implementation was `LSU-` + `SHA256("{shop_id}:{anchor_id}:{receive_sequence}")[0:8]`, where the anchor is `receive_job_line_id` (Receive) or `recount_line_id` (Reconcile). That derivation is retained only to verify units already issued with it. It no longer mints identities.

### Decision 3 — Backfill approach: Progressive labelling with natural stock rotation

No mandatory stocktake is required to go live. The system launches with a dual-namespace resolver. Legacy stock rotates out naturally under FIFO. New inbound units are labelled automatically at receive. Coverage climbs without operator intervention. Full architecture detailed in §6.

### Decision 4 — New-unit identity: one global, noncycling sequence (GH-1255, ratified October 14, 2026)

The 8-hex hash space (2³² values) cannot guarantee global uniqueness. New units now take their identity from one PostgreSQL sequence:

```
lasyncro_unit_id = 'LSU-' + 10 zero-padded decimal digits   (14 characters)
source           = public.inventory_unit_lsu_seq             (migration 0212)
                   bigint, START 1, MINVALUE 1, MAXVALUE 9999999999, NO CYCLE
```

- **Global, not per shop.** One sequence serves every tenant. `UNIQUE (lasyncro_unit_id)` stays global.
- **Persisted, never derived.** The identity is written once at issuance and read back afterwards. A committed retry for the same `(shop, source line, receive_sequence)` returns the stored unit; it never re-mints one.
- **Gaps are valid.** A rolled-back issuance may consume sequence values. Numbers are not contiguous and never encode quantity, order or time.
- **Exhaustion fails closed.** Value 9999999999 is the last one. After it, issuance refuses with `INVENTORY_UNIT_LSU_SEQUENCE_EXHAUSTED` (PostgreSQL `2200H`). Nothing is reissued.
- **Least privilege.** The runtime role `sf_app` holds `USAGE` only on the sequence. It can call `nextval()` but cannot read it (`SELECT`) or rewind it (`setval`).
- Legacy identities are unchanged. See §3 for every identity format that remains valid.

---

## 3. Unit Identity Model

### The LSU identifier

```
New units (GH-1255):  lasyncro_unit_id = LSU-{10 digits}    e.g. LSU-0000000001, LSU-0012345678
Legacy units:         lasyncro_unit_id = LSU-{8 hex chars}  e.g. LSU-a3f72c1d, LSU-009b4e82
```

Persisted identity formats that remain valid:

| Format | Origin | Issued today? | Replay rule |
|---|---|---|---|
| `LSU-{10 digits}` | `inventory_unit_lsu_seq` (Decision 4) | **Yes**, the only format minted for new Receive and Reconcile units | Returned exactly as stored |
| `LSU-{8 lowercase hex}` | Legacy hash, WM-46 through GH-1255 | No | Must equal the legacy derivation of its own lineage (shop, anchor, `receive_sequence`), otherwise replay refuses |
| `LSU-{6 uppercase hex}-{n}` | `apps/backend/src/scripts/seed_reviewer_activity.ts` (reviewer demo seed; applied to production shop 1 on 2026-08-03) | No; it is **not** an issuance format | Kept for historical compatibility only, returned unchanged on Receive replay |

The two current shapes cannot collide. `LSU-12345678` (8 characters, legacy hex) and `LSU-0012345678` (10 digits) are different lengths. Resolution is an exact match, never a prefix match, and only within the scanning tenant.

The `LSU-` prefix is reserved and must never be used by any other barcode namespace in the system. Existing namespaces:
- `LSO-{8char}` — order invoice barcodes (WM-34)
- `TEST-{N}` — dev/test barcodes
- Raw EAN/UPC — legacy Shopify-synced variant barcodes

### Persisted identity guarantee (replaces "Deterministic hash guarantee", GH-1255)

The persisted row is the identity. Re-printing is retrieval, not regeneration. The ID is written once at issuance and is immutable for the lifetime of the unit record. Issuance (`batchConfirmUnits` for Receive, `issueReconciledUnits` for Reconcile) behaves as follows:

- It locks the source line (`FOR UPDATE`), scoped to the shop. It refuses a line that is missing or belongs to another shop, and a variant that is not the line's own.
- A committed retry returns the persisted units without consuming a sequence value. For Receive that includes legacy and reviewer-seed rows; for Reconcile, legacy rows.
- It **never tops up** missing units. If the persisted unit count differs from the requested quantity, issuance refuses (`*_ISSUANCE_MISMATCH`).
- It refuses if the persisted lineage disagrees: wrong sequence, variant, source anchor or provenance, or a legacy-shaped ID that is not its own derivation (`*_ISSUANCE_INVARIANT`).
- Code prefixes: Receive uses `INVENTORY_UNIT_RECEIVE_ISSUANCE_*`; Reconcile uses `INVENTORY_UNIT_RECOUNT_ISSUANCE_*`.
- On the Receive inspect route, both refusals are **HTTP 409** with the code in `code`. The whole inspection rolls back, so the job, line, PO, units, movements, truth and Stow tasks are untouched.
- Inserts have no conflict clause. A global identity collision or an unexpected lineage conflict aborts the transaction instead of being swallowed.
- Concurrent issuers for the same line serialize on the line lock and return one canonical set of identities.

### Two product classes

**Class A — Products arriving WITH EAN/UPC/standard barcodes**

EAN/UPC is variant-level (many units share it). At receive, a unique `LSU-` ID is generated and the EAN/UPC is stored alongside as a coupling field. Re-print path: operator scans EAN/UPC → system finds all units with that code in this shop → narrows by current location → if one match, reprints → if multiple, short disambiguation list (receive date, receive batch sequence).

**Class B — Products arriving WITHOUT any barcode**

No secondary identifier exists on the physical object. The only anchors are the variant identity, the location, and the `receive_sequence`. Re-print path: operator triggers reprint workflow → scans shelf/bin barcode (WM-28, see §8) → selects variant from list of what's expected at that location→ system narrows to units of that variant in that bin → if one match, reprints → if multiple, short disambiguation list (receive date, batch sequence).

### UI naming canon (WMS-FP-04; ownership synchronized October 6, 2026)
Four distinct barcode systems exist. They must NEVER be co-mingled, summed, or share a count/label in any UI surface:

| System | UI name | What it is | Generated at | Owning surface |
|--------|---------|-----------|--------------|----------------|
| `LSU-` | **Unit labels (LSU)** | Per-unit identity, single source of truth stow→pick→pack→ship | Receiving | Settings → Warehouse (coverage) + WMS scan surfaces |
| `LSO-` | **Order codes (LSO)** | Invoice barcode, pack→ship confirmation | Pack (invoice PDF) | WMS pack flow |
| Shelf/bin (WM-28) | **Location codes / location labels** | Physical-location identity and labels — scanned to locate stock | Floor Planning | Floor Planning — contextual and batch location labels |
| EAN/UPC | **Product codes** | Product/variant identity — legacy camera-scan fallback / re-print lookup coupling field | Synced from Shopify | Items / product identity; WMS scanning may retain legacy resolver compatibility |

Floor Planning owns physical-location codes/labels through the canonical Inspect workspace and explicit Edit layout. Its former permanent barcode-management UI and product-code ownership are retired. Product/variant identity, including EAN/UPC, belongs to Items; retained compatibility APIs and WMS legacy resolver paths do not confer UI ownership on Floor Planning.

LSU remains per-unit inventory identity owned by the WMS/unit-label architecture, with coverage surfaced in Settings → Warehouse. Barcode namespaces must never be co-mingled, summed, or share a count/label. This ownership synchronization does not change LSU generation, resolution, coverage, or print architecture.

---

## 4. Data Model

### `inventory_units` table

```sql
inventory_units (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lasyncro_unit_id           varchar(20) NOT NULL UNIQUE,  -- globally unique; LSU-{10 digits} (new) or legacy LSU-{8 hex} — see §3
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

### Held-unit source anchor (GH-1254 S4-B, migration 0213) — implemented, dark, not deployed

A unit now originates from exactly one of three anchors
(`inventory_units_source_anchor_xor`: `num_nonnulls(...) = 1`):

| Anchor | Source | Created by |
|---|---|---|
| `receive_job_line_id` | `lasyncro_receive` | accepted Receive stock (`batchConfirmUnits`) |
| `recount_line_id` | `opening_inventory_reconcile` | settled Reconcile (`issueReconciledUnits`) |
| `receive_held_capture_id` | `receive_held_recoverable` | recoverable held units (`issueHeldReceiveUnits`) |

- A held unit hangs off its `receive_held_captures` row, one row per recoverable
  defect or packaging-damage exception. It never hangs off the Receive line, so
  accepted-line replay, barcode readiness, line labels, label acknowledgement,
  inbound Stow and Pick never see it.
- Identity comes from the same global sequence (`LSU-{10 digits}`, Decision 4).
  `receive_sequence` is 1..N within the capture.
- Lifecycle: born `status = 'held'` with `current_location_code` NULL. The DB
  keeps it there (`inventory_units_held_state_check`): a held unit cannot leave
  `held` or gain a location, and no other unit can become `held`. S4-E will
  replace this check with a verified recovery-to-Stow transition.
- Provenance is FK-bound: the unit references its capture and the capture's
  variant. The capture references the finalization line, the exception link
  (`created`), the exception (same job, line, variant, type and `held_recoverable`
  role), the Receive line's variant and the shop's warehouse.
- Held labels are not printable yet (S4-C). Physical barcode certification
  (#1261) is still pending for numeric LSUs.

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

GH-1254 S4-B: `computeCoverage` also excludes `status = 'held'`. Held units are outside
`inventory_truth`, so counting them would inflate coverage and could trigger the legacy
sunset early.

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
| Barcode | Code128, `LSO-{8char}` | Code128, `LSU-{10 digits}` (new) or legacy `LSU-{8 hex}` (full ID printed under the bars) |

Printer configuration (thermal printer connection, label size, format) is added to `ShopSettingsWarehousePage`.

### Label geometry (GH-1255) — `apps/backend/src/services/wms/unitLabelPdf.service.ts`

- The page is 50 × 25 mm (141.73 × 70.87 pt), one label per unit.
- **Designed for 203 dpi.** Each Code128 module is a whole number of 203-dpi printer dots (at most 3; 2 in practice). Every canonical format renders at 2 dots per module, which is 0.25 mm (9.85 mil).
  - A 10-digit ID is 145 modules, so the barcode is about 36.3 mm wide.
  - A legacy 8-hex ID is at most 167 modules.
- Quiet zones are at least 10 modules on each side. The barcode is centred and its bars are 10 mm tall.
- The full ID is printed in text under the bars. Leading zeros are preserved.
- The SKU and title line is cut to fit within the margins.
- Digital checks only: the generated PNGs decode to the exact IDs, including leading zeros. **This is not proof of physical scannability.**

### Print-pipeline caveats and release gate

- **100% scale is assumed and is not enforced.** Whole-dot geometry only holds when the PDF reaches the printer unscaled.
  - QZ Tray (`qzPrint.ts`) creates its config with no options, so qz-tray 2.2.6 defaults apply: `scaleContent: true`, `size: null`, `interpolation: 'bicubic'`. If the driver's media or printable area differs from 50 × 25 mm, the label is rescaled and the bar edges are resampled.
  - The browser fallback depends on the operator choosing *Actual size / 100%*.
- **300 dpi is unverified.** A 0.25 mm module is about 2.96 dots at 300 dpi, so bars are resampled into a mix of 2- and 3-dot widths.
- **Physical acceptance is pending.** Production activation of the new labels is blocked until each supported printer and scanner combination passes a physical test. Record the printer model and DPI, the stock, the real QZ or browser pipeline, and the scanner model and type, and use the exact decoded value including leading zeros. The proposed criterion, pending lead ratification, is at least 99/100 first-pass exact reads and zero wrong reads. Any combination that fails blocks activation on that hardware.

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
| GH-1255 | P1 | ✅ Implemented on `feat/gh1255-lsu-identity` (988b37cb), October 14, 2026 · physical label acceptance pending | LSU-IDENTITY-01: new units get `LSU-{10 digits}` from the global sequence `inventory_unit_lsu_seq` (migration 0212). Identity is persisted, never derived. Legacy and reviewer-seed IDs are preserved. Issuance conflicts return HTTP 409. Labels use 203-dpi whole-dot geometry. See Decision 4, §3, §8, §11. |
| GH-1254 S4-B | P1 | 🔒 Implemented on `feat/gh1254-s4b-dark`, October 15, 2026 · dark (`RECEIVE_HELD_CAPTURE_ENABLED` OFF) · not merged or deployed | Held-unit source anchor (migration 0213): one held LSU and one recovery task per recoverable physical unit, never in sellable stock. Depends on unmerged GH-1255. S4-C/D/E/F (labels and UI, custody, recovery, enable) are not implemented. See §4, §6, §11, §12. |

---

## 11. Key Invariants (Must Never Be Violated)

1. `lasyncro_unit_id` is written once at receive and is **immutable** for the lifetime of the record.
2. `receive_sequence` is written once at receive and is **immutable**.
3. A returned unit **never gets a new `lasyncro_unit_id`**. It reclaims its original.
4. The `LSU-` prefix is **reserved** — no other barcode namespace may use it.
5. `legacy_barcode_fallback_enabled = false` is a **one-way gate** once crossed via auto-sunset. Manual re-enable requires owner/admin explicit confirmation.
6. `reprint_count` is **always incremented** on reprint, never decremented.
7. New identities come **only** from `inventory_unit_lsu_seq`. The sequence never cycles, and no identity is ever reissued (GH-1255).
8. No historical identity (legacy 8-hex or reviewer-seed) is ever renamed, regenerated or backfilled into the numeric format.
9. Issuance never tops up missing units and never swallows a conflict. A count or lineage mismatch refuses with zero mutation.
10. Migration 0212 cannot be rolled back once any `LSU-{10 digits}` unit exists. `down()` refuses with `INVENTORY_UNIT_LSU_SEQUENCE_ROLLBACK_BLOCKED`. Re-creating the sequence would restart at 1 and collide with issued labels.
11. A held unit (GH-1254 S4-B) is never credited, stowed, picked, packed or shipped. It writes no movement and no truth, and it gets no location until S4-E defines verified recovery. The DB check and `STOW_HELD_UNIT_REFUSED` enforce this.
12. Exactly one recovery task exists per held LSU (`pct_held_unit_unique`). It carries no copied `problem_bin_location`; custody is never inferred from that string.
13. Held units never share an anchor with accepted units. Accepted-unit counts per Receive line stay equal to `quantity_accepted`.

---

## 12. Inventory Movement Backing

Every LSU lifecycle status transition is backed by an `inventory_movements` ledger entry:

| Transition | Movement type | Written by |
|-----------|--------------|------------|
| `received` (initial) | `inbound_purchase` | `receiveJob.service.ts` |
| `received → stowed` | `location_transfer` (debit + credit pair) | `stow.service.ts` |
| `stowed → picked` | `sale` | `pickScan.service.ts` |
| `held` (initial, GH-1254 S4-B) | **none** — held units are outside `inventory_truth`; Receive Close credits accepted units only | `receiveReconciliation.service.ts` |

See full audit trail architecture: `docs/blueprints/inventory_movement_audit_trail.md`