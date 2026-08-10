# INV-BLOCK-10c — cancellation resolves order constraints

**Date:** 2026-08-10 · **Status:** CLOSED · **Depends on:** INV-BLOCK-10a

## Defect

`projectOrderConstraints` read `order_fulfillment_status` but used it only as an
existence check (`if (!ofs) return`). The status value was ignored. When
INV-BLOCK-10a added `orders/cancelled` to `isOrderEntityEvent`, the cancellation
event triggered the full orchestration —
`projectOrderAge -> evaluateOrderConstraints -> projectOrderConstraints` — and the
evaluator re-affirmed the order's inventory block, stamping a fresh `started_at`
equal to the cancellation's own event time.

Result on the operator surface (`/orders/flow`):

3 blocked · $179.85 held
OUT OF STOCK · 3 -> 
#800002 "Not enough stock to fulfill" (cancelled)


`blocker.aggregates.ts` and `orderExecutionQueueResolver.ts` both read
`order_constraints` as canonical blocker truth, so one stale row corrupts the
blocked list, the unbatched count, and held revenue simultaneously.

## Scope correction made during audit

An intermediate hypothesis — that a cancelled order's `order_revenue_units`
inflate variant demand and can block *other* orders — was **withdrawn**. The
demand subquery is `.where('lasyncro_order_id', orderId)`
(`inventoryConstraintEvaluator.ts:49`): evaluation is per-order, grouped by
variant. Blast radius is the cancelled order alone. `order_revenue_units` and its
~49 consumers are untouched.

## Change

One file, one block: `projections/orderConstraintProjection.ts`, inserted after
the `!ofs` guard.

When `ofs.status === 'cancelled'`, resolve every active constraint via the
existing dual-write shape and return, ignoring `evaluations`:

| Table | Write |
|---|---|
| `order_constraints` | `is_active false`, `resolved_at eventAnchor`, `write_source 'orderConstraintProjection:cancelled'` |
| `order_constraint_events` | `is_active false`, `resolved_at`, `evaluated_at`, `aggregate_version`, `updated_at` |

The dual write is mandatory (BL-16-UX-BLK-01): canonical and bridge lifecycle
state must transition together or downstream readers observe contradictory
blocker state. The audit confirmed the bridge carried the same stale rows.

`write_source` distinguishes terminal-status resolution from normal lifecycle
resolution.

Scope is `cancelled` only. `fulfilled` resolves through the normal evaluation
path and must not be short-circuited. `failed` has no producer.

This is lifecycle materialization, not evaluation, so it respects the file's
stated architectural contract.

## Runtime proof

Forward path — `orders/cancelled` webhook for 800001 with the fix in place, and
retroactive path — `orders/constraints_reevaluated` (BL-01a) emitted for both
already-stale orders:

800001 cancelled is_active f resolved_at 20:38:26 orderConstraintProjection:cancelled
800002 cancelled is_active f resolved_at 20:38:26 orderConstraintProjection:cancelled
800003 pending is_active t (control, untouched)

order_constraint_events: 800001 + 800002 resolved, 800003 active
cursor 18 -> 20
health 200 / orders 200 / alerts 200


Re-emitting a repair event produced no duplicate rows.

## Retroactive repair recipe

For orders already cancelled with stale constraints, emit the BL-01a
re-evaluation event — the payload carries the **external** order id, since
`extractExternalOrderId` falls through to `payload.id`:

```sql
BEGIN;
SET LOCAL app.current_tenant = '<shop_id>';
INSERT INTO domain_events
  (shop_id, event_type, event_payload, event_time, event_version, external_event_id, created_at)
VALUES
  (<shop_id>, 'orders/constraints_reevaluated', '{"id":"<external_order_id>"}'::jsonb,
   now(), 1, 'system:inv-block-10c:<external_order_id>-repair', now());
COMMIT;
```

## Not in scope — INV-BLOCK-10b

Reservation release, `order_cancelled_mid_pick` stow task, batch cardinality
adjustment, cancellation `movement_type`.
