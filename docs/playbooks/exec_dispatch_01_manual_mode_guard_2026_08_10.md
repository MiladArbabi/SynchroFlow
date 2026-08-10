# EXEC-DISPATCH-01 — restore the dispatcher manual-mode guard

**Date:** 2026-08-10 · **Status:** CLOSED · **Depends on:** WORKER-ALS-01

## Defect

`execution.dispatcher.worker.ts` polls `decision_execution_queue WHERE status =
'pending'` with no awareness of `execution_mode`. `pending` is overloaded: it
means both "ready for automatic dispatch" and "waiting for an explicit manual
trigger."

The guard that separated them was commented out — including its `continue` —
because the skip log fired once per pending manual decision per 1s poll with
nothing changing between ticks. Every dev decision is `execution_mode: 'manual'`
from `source: 'safe_fallback'` (DECISION-SAFE-01), so three decisions produced
~180 unchanging log lines per minute.

Two failures follow from the missing guard:

**Clobber.** `commands.consumer.ts` owns manual execution: `pending →
in_progress → success`, with an idempotency check on `success`/`in_progress`
(`:122`). The dispatcher has **no such check** — it reads `pending`, does its
work, then writes `dispatched` unconditionally (`:168`). A `success` completing
in that window is silently overwritten.

**Loop.** `execution.worker.ts:293` skips manual jobs and re-inserts a `pending`
queue row (`:314`). So the dispatcher enqueues a manual decision, the worker
skips it and restores `pending`, and the dispatcher picks it up again —
indefinitely, visible only as `[EXECUTION_DUPLICATE_DETECTED]` when the
re-insert hits 23505.

Dormant until now: dispatch itself was broken by WORKER-ALS-01, so nothing was
ever enqueued. Fixing that made this reachable, confirmed live — the
WORKER-ALS-01 fixture row went to `dispatched` while its decision was still
`pending`/`manual`.

## Change

One file. The guard is restored **silently** — no log. Skipping a manual
decision is the expected steady state, not an exception, and the row's own
status already records the truth. `continue` became `return`, since
WORKER-ALS-01 made the per-row body a `runWithTenantContext` callback.

## Runtime proof

manual 7fcdd6d3… pending -> pending (20 poll cycles, was flipping in 1)
automated 7fde141a… pending -> success
health 200 / orders 200 / alerts 200


The automated control reached `success`, not merely `dispatched` — the full
bridge (dispatcher → execution.jobs.v1 → execution.worker → executeJob) ran end
to end for the first time. Before WORKER-ALS-01 no job had ever been delivered.

## Test-data note

`7fde141a-e688-0f82-b558-51182ca009c5` was mutated to `execution_mode:
'automated'` in the dev DB to serve as the positive control, and executed for
real. Dev fixture only.

## Registered, not fixed

**EXEC-STATUS-01** — `decision_execution_queue.status` is a plain varchar with
no CHECK and five writers using six values: `pending`, `dispatched`,
`in_progress`, `success` (commands.consumer), `executed` (manualExecution),
`failed`. `executed` and `success` appear to mean the same thing. Needs an
audit of its own.

Schema note: `decisions.id` is uuid, `decision_execution_queue.decision_id` is
varchar — joins between them need `d.id::text`.
