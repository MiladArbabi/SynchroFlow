# EXEC-STATUS-01 — constrain decision_execution_queue.status

**Date:** 2026-08-10 · **Status:** CLOSED · **Migration:** 0145

## Finding

`decision_execution_queue.status` was a bare varchar — no CHECK, no enum, no
default — written by four live paths:

| Value | Live writers |
|---|---|
| `pending` | orders.execute.controller, execution.worker (manual-skip re-insert), reconciliation.handlers |
| `dispatched` | execution.dispatcher.worker |
| `in_progress` | commands.consumer |
| `success` | commands.consumer, execution.worker |
| `failure` | execution.worker |

A sixth value, `failed`, existed only in `manualExecution.service.ts`. The live
reader (`execution.guard.ts`) matches `failure`, so nothing was broken — but a
future reader written against `failed` would have silently matched zero rows,
with nothing at the database objecting.

### Two premises corrected during the audit

The issue was registered on the belief that `success` and `executed` were live
synonyms. Both were wrong:

- `manualExecution.service.ts` throws `MANUAL_EXECUTION_DISABLED` on the first
  statement of its only exported function. Its remaining ~130 lines were
  unreachable, so `executed` had no live writer.
- The live failure spelling is `failure`, not `failed`; writer and reader agree.

## Change

**Migration 0145** — `CHECK (status IN ('pending','dispatched','in_progress',
'success','failure'))`.

**Deleted `apps/backend/src/services/execution/manualExecution.service.ts`.**
Zero importers. Its disable comment said it was "intentionally disabled until
reintroduced through Command Bus as a proper command" — that reintroduction had
already shipped as `EXECUTE_DECISION` in `commands.consumer.ts`, which
`orders.execute.controller.ts:27` and `commands.consumer.ts:79` both record.
Deleting it removes `failed` and a second stale vocabulary (`executed`,
`MANUAL_EXECUTION_INVALID_STATE`) in one move.

Precedent: INV-BLOCK-13 deleted `reservationLedger.writer.ts` on the same
reasoning — a zero-caller abstraction is a future engineer's trap.

## Runtime proof

migration 0145 applied, batch 2, RLS release gate passed (86 tables)
NEGATIVE status = 'failed' -> ERROR violates check constraint
POSITIVE dispatched / in_progress / failure -> UPDATE 1 each
both transactions rolled back; fixture rows unchanged


## Registered, not fixed — EXEC-STALL-01

`dispatched` and `in_progress` are terminal by accident. The locator
(`public.list_pending_decision_executions`, SECURITY DEFINER) selects
`WHERE status = 'pending'` only, and `execution.guard.ts` blocks on `success`
and `failure` only. So a row stranded in either state by a worker restart,
RabbitMQ redelivery or DLQ is invisible to the dispatcher, unblocked by the
guard, and unrecoverable without manual intervention. There is no reaper.

Needs its own design: a reaper worker with a staleness threshold, or making the
guard treat `dispatched` as re-executable.
