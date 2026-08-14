# INV-SALE-BACKFILL-01 — compensating the pre-0147 pick sales

**Date:** 2026-08-14
**Script:** `apps/backend/src/scripts/backfill-pick-sale-corrections.ts`
**Parent:** `INV-SALE-DOUBLE-01` (fixed, migration 0147)

## Problem

Migration 0147 stopped `pickScan` writing `sale`. Rows written BEFORE it kept
that type, so any ledger replay still double-subtracted them.

Correction set, verified: **5 rows, -9 units, shop 2 only**.

Selector is `movement_type='sale' AND triggered_by='pick_scan'`.
`reference_type` is NOT usable — the INV-SALE-REFTYPE-01 fix applied to new
writes only, so these five still read `order_revenue_unit`.

### Register correction

Earlier notes (including two playbooks written this session) claimed "26 rows
on shop 1". Wrong. Shop 1's 26 `sale` rows are all `triggered_by = NULL` —
legitimate ingestion sales. **Shop 1 has never picked anything**, so it has no
pick-written rows and needs no backfill.

Shop 1's separate 32-unit divergence is `INV-TRUTH-LEDGER-DRIFT-01` — a
`dev_seed` ordering artefact, unrelated.

## Why compensating movements

`inventory_movements` carries two triggers, both calling
`prevent_inventory_movements_mutation()`, which RAISEs unconditionally:

    inventory_movements_no_update  BEFORE UPDATE
    inventory_movements_no_delete  BEFORE DELETE

No GUC escape, unlike `order_constraints`' `projection_writer_guard`. In-place
type correction is impossible. Compensating rows are the only mechanism.

**Honest naming:** what we WANT is for those five rows to read `pick_removal`.
The append-only table forbids it, so the ledger instead reads sale -1,
sale -1, correction +1 — three rows describing one unit's movement. Chosen
because it is mechanically available, not because it is the clearest history.

## The correction row

`reconciliation_correction`, `+abs(quantity_delta)`. Sign check permits
`<> 0`; the type is summed into on-hand by every computation. Zero
`reconciliation_correction` rows existed before this, so the script defines
the convention:

    reference_type   'inventory_movement'
    reference_id     the source movement's id — self-referential, so every
                     correction is traceable to the row it offsets
    device_event_id  uuidv5(`${sourceId}:correction:device`, NS)
    triggered_by     'inv_sale_backfill_01'

## Script contract

    npx tsx apps/backend/src/scripts/backfill-pick-sale-corrections.ts --shop 2
    npx tsx ... --shop 2 --apply

- **Dry run by default.** `--apply` required to write.
- **Shop-scoped.** No cross-tenant sweep.
- **Idempotent** via `onConflict(['device_event_id']).ignore()`.
- Prints ledger-vs-truth before and after; exits 1 if drift remains.
- Uses `systemDb` (PGMIGRATION_USER) — admin operation, mirrors how
  rebuild and migrations enumerate.

### Env bootstrap

The script loads dotenv itself and imports `system-db.js` DYNAMICALLY, same
contract as `src/cli/rebuild-from-events.ts`. Static ESM imports are hoisted
and evaluated before the module body, so a static import constructs the pool
with undefined PG* vars and fails with
`SASL: client password must be a string`.

Do NOT work around this with `set -a; source .env` — it overwrites `HOST`
(visible as a changed shell prompt) and clobbers `PGPASSWORD` for child
processes.

## Verified — shop 2

    dry run        ledger 107 · truth 116 · drift 9 · 5 offenders · nothing written
    first apply    written 5 · skipped 0 · ledger 116 · truth 116 · drift 0
    SECOND apply   written 0 · skipped 5 · ledger 116 · drift 0
    ledger census  reconciliation_correction · inv_sale_backfill_01 · 5 rows · +9
    truth          55 / 37 / 24 — UNCHANGED. The backfill corrects the ledger only.

The second apply is the load-bearing test. On an append-only table a broken
conflict target would have written five more corrections and overshot to 125,
unrecoverably. Proven on five rows before pointing this at production.

## Production — NOT DONE

Prod carries picked batches (`8BEA7259` observed at Picking 4/12, 3 batches in
progress), so it almost certainly has pick-written `sale` rows. Count them
first, then run the same script with `--shop <id>`, dry run before `--apply`.

Deliberately not a migration: a migration writes ledger rows on every
environment at deploy time, and on an append-only table a wrong selector is
unrecoverable. Ledger mutation should require deliberate invocation.

## Effect

`rebuild-from-events` on shop 2 now lands on 116. That is the first tenant
where a replay agrees with truth. Hazard A of `REBUILD-UNSAFE-01` is closed
for shop 2; hazard B (the CLI truncates by design) is unchanged and its guard
is the next workshop.
