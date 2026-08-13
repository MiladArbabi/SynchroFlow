# REFUND-MOVEMENT-CONFLICT-01 — refund restock never reached the ledger

**Date:** 2026-08-13
**Severity:** P0
**File:** `apps/backend/src/api/shopify/handlers/handleRefundCreated.ts`
**Migration:** none

---

## Defect

The `refunds/create` handler guarded its `refund_return` insert with a
five-column `ON CONFLICT` target:

shop_id, reference_type, reference_id, lasyncro_variant_id, location_code


The only matching index has six:

CREATE UNIQUE INDEX inventory_movements_shop_ref_unique ON inventory_movements
USING btree (shop_id, reference_type, reference_id,
lasyncro_variant_id, location_code, movement_type)


`movement_type` was missing, so Postgres raised *"there is no unique or
exclusion constraint matching the ON CONFLICT specification"* on every refund.

## Why it was worse than a failed insert

The error aborted the surrounding transaction. The handler's `try/catch`
logged `[REFUND_RETURN_MOVEMENT_FAILED]` and continued the loop, but a caught
error does not un-abort a Postgres transaction — every subsequent statement
failed, including the `integration_webhook_events` write:

current transaction is aborted, commands ignored until end of transaction block


Consequences, all confirmed against the live database before the fix:

- `SELECT count(*) FROM inventory_movements WHERE movement_type='refund_return'`
  -> **0**, shop-wide, all time. Refunded stock never re-entered the ledger.
- `SELECT count(*) FROM integration_webhook_events WHERE event_type='refunds/create'`
  -> **0**. The event left no trace at all: no dead-letter row, no
  `processing_error`, nothing to replay from. Only transient console output.
- The `domain_events` row written earlier in the handler was rolled back too.
- `shopify.webhook.ts:169` correctly returns 500 on handler failure so Shopify
  retries — so Shopify retried forever. Observed 6+ deliveries for the same two
  event ids during the INV-BLOCK-10b run.

## Scope

Isolated. All 17 files that write to `inventory_movements` were checked
directly. Three peers already name all six columns —
`cancellationUnwind.service.ts:149`, `batchReservation.service.ts:395`,
`pickScan.service.ts:314` — and every other writer targets
`['device_event_id']`, a valid unique constraint. This handler sets
`device_event_id: null`, so the six-column index is its only correct guard.

## Change
.onConflict(['shop_id', 'reference_type', 'reference_id',
         'lasyncro_variant_id', 'location_code'])
.onConflict([
'shop_id', 'reference_type', 'reference_id',
'lasyncro_variant_id', 'location_code', 'movement_type',
])

Column order matches the index definition, as the three peers do. `.ignore()`
and the insert body are unchanged.

This also restores the guarantee RT2-AUD-22 was written for. That change
replaced `randomUUID()` with a deterministic sha1-derived `reference_id`
(`refund_return:{refundId}:{externalVariantId}:{quantity}`) specifically so a
replayed refund webhook would collide rather than double-restock — a defect
that had produced a confirmed 200% restock. The deterministic id was useless
while the conflict target could not match an index.

## Runtime verification

Real Shopify order, paid, then refunded with restock. Shopify delivered
`refunds/create` **twice**.

[REFUND_RETURN_MOVEMENT_WRITTEN] quantity: 1 restockType: 'cancel' (x2)


No `[REFUND_RETURN_MOVEMENT_FAILED]`, no transaction abort, no
`[SHOPIFY_WEBHOOK_HANDLER_FAILED]`.

| Check | Before | After |
|---|---|---|
| `refund_return` movements | 0 | 1 — `+1` at `WH-1-ROOT`, `ref_type=refund_execution` |
| Rows per `reference_id` | n/a | **1** from two deliveries — replay safety proven |
| `refunds/create` webhook events | 0 rows | 2 rows, both `processed`, `verified=t`, no error |
| `domain_events` | rolled back | 448, 449 persisted, reached the projection worker |

The two-delivery case is the useful one: domain-event dedupe is per-delivery
(distinct `external_event_id`), while movement dedupe is per-refund-content
(deterministic `reference_id`). Two events correctly produced one movement.

## Related

**WEBHOOK-TRX-POISON-01 (P2, resolved 2026-08-13).** The shared
`WebhookRouter` now protects registered handler execution with a PostgreSQL
savepoint. An unhandled handler DB error rolls back to that savepoint before
the webhook ledger is marked `failed`, so the failed ledger state can commit
before the error is rethrown to the caller.

Shopify handlers that intentionally tolerate database errors now use their
own local savepoints around those writes. They roll back and release the
local savepoint before `return` or `continue`, preserving the handler's
existing duplicate/optional-write semantics without leaving the shared
transaction aborted. The same recovery rule applies to duplicate
`domain_events` inserts and optional inventory-movement writes.

The unsupported-event optional `domain_events` persistence path is also
isolated with a savepoint, so failure of that optional write does not undo
the already-recorded `ignored` webhook ledger state.

Runtime proof covered four cases: unhandled DB failure → `failed`; swallowed
DB failure without local recovery → router backstop `failed`; locally
recovered tolerated DB failure → `processed`; normal success → `processed`.
All synthetic proof ledger rows were removed afterwards.

**ORDER-PAID-ORDERING-01 (P3, observed).** `[ORDER_PAID_DEFER_EXHAUSTED]` for
external order `17053031858546`: `orders/paid` arrived before `orders/create`
and exhausted three deferrals before the identity resolved. The order did
resolve afterwards, so no data was lost, but the defer budget was consumed by
delivery ordering rather than a real fault.

**SHOPIFY-RECEIVE-INV-SYNC-01 (P1).** Four more `reconciliation_correction`
rows landed on `WH-1-ROOT` during this run, chasing Shopify's figure
(`-8, -8, +10, -1`). Unrelated to this fix; the bins were untouched.
