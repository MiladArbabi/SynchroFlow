# Barcode Identity Resolution & Progressive Labelling (WM-02, WM-46)

Status: established 2026-07-16, following a full audit of existing
infrastructure. This document is the canonical reference for how
LaSyncro resolves scanned barcodes to variant/unit identity, and how
shops can run their existing barcode workflows in parallel with
LaSyncro's LSU-/LSO- system during migration. Read this before
touching any scan-resolution code — most of what looks like a gap has
already been built once; check here first.

---

## 1. The core product principle

LaSyncro does not require a shop to abandon their existing barcode
workflow to adopt LaSyncro's WMS. Shops can scan whatever they
already use — Shopify barcodes, UPC/EAN, their own SKU labels — at
every scan surface (receive, stow, pick, pack, returns), fully in
parallel with LaSyncro's own LSU-/LSO- codes, for as long as they
need. Migration to full LSU-/LSO- coverage is gradual and
shop-controlled, not a hard cutover.

Internally this is referred to as "BYO barcode" or "legacy barcode
fallback" interchangeably. Both terms mean the same thing: the same
identity-resolution system described below.

---

## 2. Identity model

Every physical unit has (at least) one, and potentially several,
scannable identities:

- **LSU-{8char}** — LaSyncro's own unit barcode, printed at receive
  time, unique per physical unit. The authoritative identity once
  present.
- **LSO-{8char}** — LaSyncro's invoice/order barcode, scanned at pack
  time to identify which order a packed unit belongs to. Not a
  variant/unit identity — resolved separately, rejected early by the
  variant resolver if encountered there.
- **Legacy barcode** (EAN/UPC/Shopify barcode), **external SKU**, or
  **external variant ID** — whatever a shop already used before
  adopting LaSyncro, sourced from `external_product_identity_map`
  (auto-populated from platform sync, e.g. Shopify).

A single physical unit may be identifiable by an LSU- code (once
printed and attached) AND by its original legacy barcode
simultaneously — both resolve to the same `lasyncro_variant_id`, and
where applicable, the same `inventory_units` row.

---

## 3. Resolution chain

Canonical implementation: `apps/backend/src/services/wms/barcodeResolution.service.ts`,
function `resolveBarcode(trx, shopId, scannedValue)`.

Priority order, checked in sequence:

1. **`LSU-` prefix** → direct `inventory_units` lookup via
   `resolveUnitBarcode()`. Fastest, most precise path — resolves
   directly to a specific physical unit, not just a variant.
2. **`LSO-` prefix** → rejected immediately. This is an invoice
   barcode, not a variant/unit scan; the caller (`httpScanResolve`)
   handles it via a separate path.
3. **Legacy fallback**, gated by `shop_wms_settings.legacy_barcode_fallback_enabled`
   (see §4). If disabled, legacy scans are rejected outright — the
   shop has fully migrated and this is intentional.
   - 3a. **Direct barcode match** against
     `external_product_identity_map.barcode` — the primary physical
     scan resolution key.
   - 3b. **External SKU** fallback, for variants without a barcode on
     file.
   - 3c. **External variant ID**, last resort platform-ID match.

For any legacy-path match (3a/3b/3c), the resolver additionally
attempts to find an associated `inventory_units` row via
`pickLegacyUnit()` — searching `received` then `stowed` status units
for that variant — so downstream stow/pick confirm endpoints still
have a unit to thread through even when the scan itself wasn't an
LSU- code. Returns unit fields as `undefined` if none found; callers
must handle that gracefully (not every legacy-resolved scan will have
a matching physical unit yet).

All lookups are tenant-scoped via `shop_id`. Callers must have
`SET LOCAL "app.current_tenant"` active before calling `resolveBarcode`
— it does not set tenant context itself.

**Current callers**, confirmed live:
- `apps/backend/src/api/wms/wms.controller.ts` — general WMS scan
  resolution.
- `apps/backend/src/services/returns/returnJobs.service.ts` — returns
  intake scanning.

Any new scan surface added to the product should call through this
resolver rather than reimplementing barcode lookup logic — that
is the whole point of centralizing it here.

---

## 4. Configuration: `shop_wms_settings`

Two relevant columns, defined in migration `0087_create_shop_wms_settings.ts`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `legacy_barcode_fallback_enabled` | boolean | `true` | Master on/off switch for the entire legacy resolution path (§3, steps 3a–3c). **On by default for every shop** — no action required for a shop to get parallel-workflow support. |
| `coverage_sunset_threshold` | integer | `100` | Intended: the coverage percentage (§5) at which legacy fallback should auto-disable. Default `100` means "never auto-disable unless explicitly configured lower." |

**Confirmed via audit (2026-07-16): `coverage_sunset_threshold` is
written by the migration default but read by zero application code.**
No worker, cron, or inline check ever compares live coverage against
this threshold or writes to `legacy_barcode_fallback_enabled`. The
column exists, is documented in the migration's own comment block as
if the auto-trigger were implemented, but the auto-trigger does not
exist. This is the primary gap addressed by this playbook (§7).

There is currently no UI control anywhere to manually flip
`legacy_barcode_fallback_enabled`. This is the secondary gap (§7).

---

## 5. Coverage computation

Canonical implementation: `apps/backend/src/services/wms/inventoryUnit.service.ts`,
function `computeCoverage(trx, shopId)`. Confirmed correct via audit.

- **Denominator** — total physical stock on hand across all locations,
  from `inventory_truth` (`on_hand_quantity > 0`, summed). This is the
  source of truth for what's physically present, including legacy
  (non-LSU) stock tracked only at variant-level quantity, with no
  per-unit row.
- **Numerator** — count of active `inventory_units` rows (excluding
  `shipped`/`lost` status) — each one represents one physically
  present, LSU-labelled unit.
- Result is clamped (`labelled` can never exceed `totalPhysical`,
  guards against truth/unit-count drift) and returned as
  `{ labelled_units, total_active_units, unlabelled_in_circulation, coverage_pct }`.

Exposed via `GET /api/v1/wms/coverage`
(`httpGetUnitLabelCoverage` in `wms.controller.ts`), consumed by the
`UnitLabelCoverageSection` component on
`/settings/warehouse` (`ShopSettingsWarehousePage.tsx`). This endpoint
and UI are confirmed live and accurate — no work needed here.

The UI already displays copy implying manual control exists at 100%
coverage ("Full coverage — legacy barcode fallback can be disabled"),
which is presently aspirational — see §7.

---

## 6. What's already fully built (do not rebuild)

- Legacy barcode/SKU/external-ID resolution at every scan surface,
  live by default.
- Coverage computation, accurate and tenant-scoped.
- Coverage visibility UI on the Warehouse settings tab.
- `barcode_print_jobs` lifecycle for tracking LSU- label print/attach
  state per unit (see `0100_create_barcode_print_jobs.ts` if extending
  print-side logic).

If a future audit or handover note again describes "BYO barcode" as
unscoped or pending, check this document and the files listed above
first — as of 2026-07-16 the core capability was already fully live,
just undocumented.

## 7. Confirmed gaps — scoped, not yet built

### 7a. Manual toggle (next up)
A control on `/settings/warehouse`'s `UnitLabelCoverageSection` (or
adjacent) to manually enable/disable `legacy_barcode_fallback_enabled`
via a new settings endpoint (likely `PATCH /api/v1/wms/settings` or
similar — check for an existing settings PATCH route before adding a
new one). Closes the gap between the UI's existing "...can be
disabled" copy and the actual absence of any control.

### 7b. Auto-sunset (follow-up)
Needs a design decision before implementation on *what* checks
coverage against `coverage_sunset_threshold` and flips the flag:
- **Worker/cron poll** — periodic job across all shops. More robust
  (fires even if nobody views the settings page), requires new
  scheduled-job infrastructure.
- **Inline check** — triggered from `computeCoverage` or the coverage
  endpoint itself. Simpler, but only fires when someone happens to
  load the page.

Recommendation, pending your product call at implementation time:
inline-first (cheap, ships fast, matches the "manual sunset only by
default" framing already in the migration comment), with a worker-poll
upgrade path if shops need it to fire without a page visit.

---

## 8. Related, out of scope for this playbook

- `members.controller.ts` sets tenant context via plain string
  interpolation (`SET app.current_tenant = '${shopId}'`) rather than
  `SET LOCAL` + parameterized binding — same pattern class as
  `ISS-SEC1` (see `monetization_billing_playbook.md` §15), though
  lower risk since `shopId` originates from a trusted JWT claim.
  Flagged for a future dedicated pass, not part of barcode resolution
  work.
