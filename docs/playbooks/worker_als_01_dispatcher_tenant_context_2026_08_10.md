# WORKER-ALS-01 — execution dispatcher tenant context

**Date:** 2026-08-10 · **Status:** CLOSED · **Unblocks:** EXEC-DISPATCH-01

## Defect

`execution.dispatcher.worker.ts` scoped its two DB touches with raw
`SET LOCAL app.current_tenant` inside separate `db.transaction` blocks. That
populates the Postgres GUC but **not AsyncLocalStorage**.

`enqueueExecutionJob` (`queues/execution.queue.ts`) runs between those two
transactions and reads `decision_execution_queue` through the global `db`
singleton — no transaction, no GUC. That path's guard
(`packages/backend-core/dist/db.js:25`, a `queryBuilder.then` interceptor)
resolves tenant from ALS, found it empty, and threw.

[UNHANDLED_REJECTION] contained, worker kept alive:
Error: TENANT_CONTEXT_MISSING: app.current_tenant is missing or zero. Query blocked.
at queryBuilder.then (packages/backend-core/dist/db.js:25:19)


The throw is **off-chain**, so the dispatcher's own per-row `catch` never saw
it — `[EXECUTION_DISPATCH_FAILED]` never printed. Before WORKER-CRASH-01 this
killed the worker process; after it, the fault merely repeated every 1s poll
while the queue row stayed `pending` forever. No decision was ever dispatched.

## Change

One file. `runWithTenantContext(row.shop_id, ...)` now frames the entire
per-row body, so every DB touch inside it — including the enqueue — resolves
the same tenant. Both raw `SET LOCAL` transactions became `withTenant`.

Because the body is now a callback, the two early exits changed from
`continue` to `return`. The commented-out manual guard's `continue` must also
become `return` when EXEC-DISPATCH-01 restores it.

The unused default `db` import was dropped.

## Runtime proof

The dev queue was empty all session, so the fault could not fire. Fixture:

```sql
INSERT INTO decision_execution_queue (decision_id, status, shop_id)
VALUES ('<decision uuid>', 'pending', 1);
```

BEFORE row stays 'pending' indefinitely
[UNHANDLED_REJECTION] TENANT_CONTEXT_MISSING every poll
no [EXECUTION_DISPATCHED]

AFTER row -> 'dispatched', error NULL, executed_at NULL
no rejection
health 200 / orders 200 / alerts 200


`decisions.status` correctly remains `pending`: dispatch is not execution, and
this decision is `execution_mode: 'manual'`, which `execution.worker.ts` skips.

## Follow-on — EXEC-DISPATCH-01 is now reachable

With dispatch working, manual-mode decisions reach `execution.jobs.v1` for the
first time. That is precisely the race the commented-out guard was written to
prevent: `EXECUTE_DECISION` (commands.consumer.ts) and this dispatcher both
acting on the same row. Restoring the guard is now the priority, and it must
solve the log noise that caused it to be commented out — every dev decision is
`execution_mode: 'manual'` from `source: 'safe_fallback'`, so the skip log
fired once per decision per second.

## Environment note

`withTenant` / `runWithTenantContext` are exported from
`@lasyncro/backend-core/db.js`, which resolves to `packages/backend-core` —
**not** `modules/`. Two greps in this audit came back empty for that reason.
