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

- **LSP-{8char}** — LaSyncro-owned product/variant catalog identity.
  Every Shopify-backed variant must have one stable LSP. It is distinct
  from `variants.barcode` and must never be written into or treated as
  an EAN/UPC/GTIN.
- **LSU-{8char}** — LaSyncro's own unit identity, unique per physical
  unit. Every accepted inbound physical unit receives one LSU record.
  For barcode-less stock, that LSU must also be physically established
  and acknowledged before the stock may become Stow-ready.
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
3. **`LSP-` prefix** → direct tenant-scoped lookup against
   `variants.lasyncro_barcode`. This is LaSyncro catalog/variant
   identity, not physical-unit evidence. An unknown LSP returns no
   match and must never fall through into legacy resolution.
4. **Legacy fallback**, gated by `shop_wms_settings.legacy_barcode_fallback_enabled`
   (see §4). If disabled, legacy scans are rejected outright — the
   shop has fully migrated and this is intentional.
   - 4a. **Direct barcode match** against
     `external_product_identity_map.barcode` — the primary external
     physical scan resolution key.
   - 4b. **External SKU** fallback, for variants without a barcode on
     file.
   - 4c. **External variant ID**, last resort platform-ID match.

For any legacy-path match (4a/4b/4c), the resolver additionally
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
- `inventory_units.label_printed_at` is the authoritative acknowledgement
  that an LSU physical label has been established for a unit.
- `barcode_print_jobs` remains a shared legacy/general print-job table used
  by other workflows. Receive-close rows in that table are NOT authoritative
  LSU physical-label evidence and must not authorize Stow or Pick release.

If a future audit or handover note again describes "BYO barcode" as
unscoped or pending, check this document and the files listed above
first — as of 2026-07-16 the core capability was already fully live,
just undocumented.

## 7. Confirmed gaps — scoped, not yet built

### 7a. Manual toggle — DONE (2026-07-16)

Closed the gap between the UI's "...can be disabled" copy and the
actual absence of any control. No new route was needed — extended the
existing `PATCH /api/v1/wms/settings` (`httpPatchWmsSettings` in
`wms.controller.ts`), which already handled the sibling
`include_return_label` boolean via the same partial-update pattern.
`GET /api/v1/wms/settings` already returned the full
`shop_wms_settings` row, so no read-side change was needed either.

Frontend: `UnitLabelCoverageSection` in `ShopSettingsWarehousePage.tsx`
gained a `useWmsSettings()` query and `usePatchLegacyFallback()`
mutation (same `useQuery`/`useMutation` + `axiosInstance` pattern as
the file's existing `useDisplayTokens`/`usePrinters` hooks). The
toggle button renders only inside the `pct === 100` branch — a shop
below full coverage is never nudged to disable their fallback safety
net.

Verified end-to-end via direct API calls: `GET` confirmed
`legacy_barcode_fallback_enabled: true` by default, `PATCH` correctly
flipped it to `false` with an updated `updated_at`, re-`PATCH`ed back
to `true` to avoid leaving a real behavioral change on the test shop.
Frontend page load confirmed clean (no console errors, non-100%
branch unaffected) — full visual confirmation of the toggle itself
was intentionally not pursued, since forcing coverage to 100% for a
one-time check was judged not worth the setup cost given the backend
round-trip already proved the underlying logic.

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

---

## 9. Pick-specific physical identity semantics — INV-RES-01

**Status:** ✅ LIVE — verified 2026-08-10

The shared resolver contract remains unchanged:

```text
legacy barcode / SKU / external variant ID
→ resolve variant
→ may also return a legacy inventory_units candidate
```

However, the meaning of that candidate is different from the meaning
of an explicit LSU scan.

### Generic product barcode

A generic identifier proves:

```text
"The scanned product resolves to this variant."
```

It does **not** prove:

```text
"This specific inventory unit was physically scanned."
```

`pickLegacyUnit()` is allowed to return any suitable tracked unit for
legacy downstream compatibility. That unit can therefore be at a
different physical location from the reservation allocation being
picked.

For the Pick workflow, the UI must therefore behave as:

```text
EAN / UPC / SKU / external barcode
→ resolve expected variant
→ reservation_allocation_id remains authoritative physical task
→ do NOT forward resolver-returned lasyncro_unit_id
```

### Explicit LSU

If the operator's actual scanned input begins with:

```text
LSU-
```

then the scan is explicit physical-unit evidence.

Pick may forward:

```text
lasyncro_unit_id
```

and the backend verifies that unit against:

```text
shop
+ expected variant
+ status = stowed
+ exact reservation allocation location
```

A tracked unit from another location is rejected.

### Locked rule

For picking:

```text
generic product barcode = variant evidence
LSU-* barcode            = physical-unit evidence
reservation_allocation_id = reservation ownership evidence
```

These identities must not be conflated.

The backend LSU location guard must remain strict. Caller semantics,
not the location guard, are responsible for preventing arbitrary
legacy resolver candidates from being treated as physically scanned
units.

---

## 10. BARCODE-LIFECYCLE-01 — catalog-to-Pick execution invariant

**Status:** ✅ IMPLEMENTED 2026-09-11 — GH-1085

GH-1085 closes the gap where inventory could reach Pick without ever having
acquired a practical physical scan path.

The locked lifecycle is:

```text
Shopify
→ catalog variant
→ stable LSP product identity
→ mapped PO line
→ Receive
→ one LSU identity per accepted physical unit
→ physical-label readiness when no usable external barcode exists
→ Stow exact physical unit
→ release only inventory with a practical Pick scan path
→ Pick
→ Pack / LSO
```

### 10.1 Identity namespaces are separate

```text
EAN / UPC / Shopify barcode / external SKU
    merchant/platform identity

LSP-*
    LaSyncro product/variant catalog identity

LSU-*
    LaSyncro exact physical-unit identity

LSO-*
    LaSyncro order/parcel identity
```

These namespaces must not be collapsed.

In particular:

- `variants.barcode` remains external merchant/platform barcode data.
- `variants.lasyncro_barcode` owns the LSP namespace.
- LSP generation must never fabricate a GTIN by writing into
  `variants.barcode`.
- LSU is physical-unit identity and is never interchangeable with LSP.

### 10.2 Catalog LSP invariant

Every Shopify-backed catalog variant must have one stable
`variants.lasyncro_barcode`.

New/updated Shopify product sync calls the canonical mint-once LSP generator.
Migration `0170_backfill_missing_product_barcode_identity` repairs historical
variants whose LSP was still null.

The historical repair:

- changes only `lasyncro_barcode IS NULL` rows;
- preserves every existing LSP byte-for-byte;
- preserves `variants.barcode`;
- retries unique collisions;
- is idempotent with respect to already-established identities.

### 10.3 Receive readiness

Every accepted inbound physical unit receives an `inventory_units` row and LSU
identity, including count-based Receive where the supplier item has no external
barcode.

A Receive line is allowed to leave receiving when either:

```text
usable external variants.barcode exists
```

or:

```text
every accepted physical unit has label_printed_at IS NOT NULL
```

An LSP alone does not satisfy physical-label readiness.

For barcode-less stock the UI therefore requires explicit LSU label
print/attachment acknowledgement before the Receive line becomes Stow-ready.

### 10.4 Stow invariant

For `stow_tasks.trigger = 'inbound_stock'`:

```text
one confirmation
= one explicit LSU
= quantity 1
= exactly one physical unit moved
```

The backend verifies the LSU belongs to:

```text
same shop
+ same task variant
+ status = received
+ current_location_code IS NULL
```

and locks that exact unit before mutation.

A single LSU scan must never bulk-stow FIFO sibling units.

Other Stow triggers retain their existing semantics; this strict rule is scoped
to normal inbound stock.

### 10.5 Release / Pick scan-readiness invariant

Before reservation writes, every computed Pick allocation is checked for a
practical physical scan path.

An allocation is Pick-ready when either:

```text
A. variants.barcode contains a usable external barcode
```

or:

```text
B. enough physically acknowledged LSU units exist at the allocation location
   to cover the allocation quantity
```

For a bin allocation, qualifying LSU units are:

```text
same shop
+ same variant
+ status = stowed
+ current_location_code = allocation location
+ label_printed_at IS NOT NULL
```

For warehouse-root inventory, qualifying LSU units are:

```text
same shop
+ same variant
+ status = received
+ current_location_code IS NULL
+ label_printed_at IS NOT NULL
```

The following do **not** independently authorize release:

- LSP / `variants.lasyncro_barcode`;
- SKU alone;
- `barcode_print_jobs`;
- LSU rows whose `label_printed_at` is null.

The readiness preflight runs after authoritative inventory rows are locked and
allocations are calculated, but before the first reservation hold, allocation
write, or inventory mutation. Failure is controlled and atomic.

### 10.6 Pick evidence remains intentionally asymmetric

The INV-RES-01 rule in §9 remains authoritative:

```text
EAN / UPC / SKU / external barcode / LSP
    = variant evidence

raw LSU-* scan
    = exact physical-unit evidence

reservation_allocation_id
    = reservation ownership evidence
```

A resolver-returned candidate LSU produced while resolving a generic product
identifier must not be promoted into exact-unit evidence.

### 10.7 Legacy `barcode_print_jobs`

Receive-close still writes a legacy variant-level `barcode_print_jobs` row for
older/general print workflows. That table also serves unrelated invoice and
Problem Center label flows.

For BARCODE-LIFECYCLE-01 it is explicitly **non-authoritative**:

```text
barcode_print_jobs row exists
≠ LSU label physically established
≠ Stow authorization
≠ Pick release authorization
```

The authoritative physical-label evidence is
`inventory_units.label_printed_at`.

Retiring the legacy Receive-close print-job artifact is a separate cleanup and
must not be combined with barcode execution authority.

### 10.8 Permanent regression contract

GH-1085 is protected at these boundaries:

- Shopify sync mints and preserves stable LSP identities.
- Migration 0170 repairs historical missing LSP identities.
- LSP resolver is tenant-scoped and precedes legacy fallback.
- Receive prevents barcode-less accepted stock from becoming Stow-ready without
  acknowledged physical LSU labels.
- inbound-stock Stow requires one exact LSU per confirmation.
- batch release refuses allocations with no practical physical scan path.
- Pick forwards exact LSU evidence only for a raw LSU scan.

Production/provider certification must additionally prove one real barcode-less
Shopify variant through Receive → LSU acknowledgement → Stow → Release → Pick.
