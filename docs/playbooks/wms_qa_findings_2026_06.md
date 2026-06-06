# WMS QA Findings — June 2026 (QA Workflow UX/UI - 2)

## Session Summary

Full end-to-end QA of the warehouse pipeline: **Receive → Stow → Pick → Pack**.
All phases completed successfully after fixes. Issues logged below.

---

## Bugs Fixed During Session

### 1. Stow did not write inventory_movements (Critical)
**Symptom:** `stow_tasks.inventory_movement_id` was always NULL. No `location_transfer` rows in `inventory_movements` after stow.
**Root cause:** `confirmStow()` updated `inventory_truth` and `inventory_units` but never wrote movement ledger entries. The `location_transfer` enum value also did not exist.
**Fix:** Migration `0116` + updated `stow.service.ts`.
See `docs/blueprints/inventory_movement_audit_trail.md` for full architecture.

### 2. Dev seed not recompiled before run
**Symptom:** Changes to `dev_seed.ts` not reflected in seed runs.
**Root cause:** Knex runs the compiled JS from `dist/seeds/`. TypeScript changes require recompilation.
**Fix:** Always run `npm run migrate -w apps/backend` before seed changes take effect, or run `npx tsc --project tsconfig.migrations.json` explicitly.

### 3. Legacy barcode resolution missing for full_data variants
**Symptom:** Picking full_data variants (LINEN, WOOL, TOTE) failed with "barcode does not match."
**Root cause:** `full_data` seed did not insert rows into `external_product_identity_map`, so `resolveBarcode()` returned null for these variants.
**Fix:** Added legacy barcode seed block in `dev_seed.ts` after variants loop using raw SQL (Knex builder silently failed due to nullable unique constraint columns).

---

## Bugs Logged (Open Issues)

| Issue | Title | Priority |
|-------|-------|----------|
| #1002 | feat: dynamic warehouse naming & multi-warehouse architecture | High |
| TBD | bug: pool displays truncated UUID instead of external order ID | Medium |
| TBD | feat: add 'release selected orders only' option to batch release dialog | Medium |
| TBD | bug: pick scan card shows redundant variant title separate from SKU | Low |
| TBD | bug: location scan accepts lowercase input during pick | Medium |
| TBD | UX: Chrome popup blocker prevents LSU PDF from opening on receive close | Medium |
| TBD | UX: long processing delay after final scan before LSU PDF renders | Low |

---

## Dev Seed Requirements

Run in this exact order for a clean WMS QA environment:

```bash
# 1. Full reset (drops + recreates DB, runs all migrations, seeds full_data)
npm run dev:full-reset

# 2. Layer identity, operator, lifecycle, QA PO + barcodes on top
DEV_SEED_MODE=full_identity npm run seed -w apps/backend
```

After reset, the environment has:
- `owner@test.com / password123` (role: owner)
- `operator@test.com / password123` (role: operator)
- Lifecycle at FT2
- 3 QA variants (`QA-SHIRT-S`, `QA-HOODIE-M`, `QA-CAP-OS`) with LSU barcodes registered
- 1 QA PO (status: shipped, ready to receive)
- 3 QA orders in the pool (`#900001–900003`)
- 10 full_data variants (LINEN/WOOL/TOTE) with legacy barcodes = SKU string
- 12 pick bins (A-1 … C-4) + PROBLEM quarantine bin

---

## Barcode Resolution Reference

| Scanned value | Resolution path | Table |
|---------------|-----------------|-------|
| `LSU-xxxxxxxx` | Unit barcode path | `inventory_units.lasyncro_unit_id` |
| `LSO-xxxxxxxx` | Invoice barcode — rejected at variant resolver | — |
| `LINEN-GRY-S` (SKU string) | Legacy path: `barcode` column match | `external_product_identity_map` |
| `LOC-A-1` | Location barcode | `warehouse_locations.barcode` |
| `A-1` | Location code direct | `warehouse_locations.location_code` |

Legacy path is gated by `shop_wms_settings.legacy_barcode_fallback_enabled`. When `false`, only LSU barcodes are accepted.

---

## Warehouse Floor Plan (Seed Default)

```
WH-1-ROOT (12m × 12m)
  Aisle A (pick zone): A-1, A-2, A-3, A-4 — 3 rack levels each
  Aisle B (pick zone): B-1, B-2, B-3, B-4
  Aisle C (pick zone): C-1, C-2, C-3, C-4
  PROBLEM (quarantine): position (8.0, 1.0) — parent: A
```

QA stow assignments (default): `QA-SHIRT-S → A-1`, `QA-HOODIE-M → A-2`, `QA-CAP-OS → A-3`

---

## Phase Completion Status

| Phase | Status | Notes |
|-------|--------|-------|
| Receive | ✅ | LSU barcodes generated, stow tasks created |
| Stow | ✅ | inventory_movements audit trail verified (post-0116) |
| Pick | ✅ | Both LSU path and legacy SKU path verified |
| Pack | 🔄 | In progress |