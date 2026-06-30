# LaSyncro — Decision Engine Playbook

> **Created:** 2026-06-29. **Status:** Foundational gap confirmed; fix designed, not implemented.

## 1. The Finding — DECISION-ENGINE-01

`generateDecisions()` (`decision.engine.ts`) is fully built — weighted priority scoring, decision-type derivation, validation, deterministic ID generation. `DecisionRepository` is fully built — `create`, `markStarted/Success/Failure`, `getByShop`. The execution worker (`execution.worker.ts`) is fully built — consumes and executes decisions correctly.

**Nobody calls `generateDecisions()`.** Confirmed via exhaustive grep: the only match for `generateDecisions(` in the entire codebase is its own definition. `decisions` table: 0 rows, system-wide — not a seeded-data artifact, a real absence. `orders.priority.controller.ts` already anticipated this — it explicitly returns `503 Decision engine not initialized` when the table is empty, rather than silently falling back to broken behavior.

This is the root cause of ORDM-03 (empty order-detail modal) and, before reframing, of what looked like ORDM-02 (Release dead-ending) — both modules were waiting on decisions that never get created.

## 2. The Decision — Option A (🔵 decided, not built)

Reconciliation (`reconciliation.handlers.ts`) explicitly forbids calling `generateDecisions` directly or persisting decisions outside the Command Bus — a written architectural rule, not an oversight:

> *"Reconciliation MUST NOT: import decision.engine, call generateDecisions, persist decisions directly. All decision creation MUST go through Command Bus."*

**Option A, chosen over a scheduled sweep or on-demand read-time generation:** dispatch a command via the bus after constraint evaluation (inside reconciliation), with a new command handler that calls `generateDecisions()` + `DecisionRepository.create()`. This is the only option that respects the existing rule rather than working around it.

**Not yet built:** the new command, its handler, and the dispatch call site. `decision.repository.ts:245` also has an unrelated, unexamined `TODO` — parked separately.

## 3. Session 2 (2026-06-29, cont'd) — Fixes Applied + New Foundational Finding

**Applied:**
- `DecisionRepository.create()` now takes `trx` as first param (was using pooled `db`, unscoped — would have failed RLS on first real call, since this method had zero prior call sites outside dead code).
- Call site in `reconciliation.handlers.ts` updated to pass `trx`.

**New finding — Thread A-2 (open, not yet scoped):**
`reconcileOrderFulfillment()` is only reachable from `processDomainEvent.ts`, which is only called from the `rebuild-from-events` CLI — and rebuild mode explicitly suppresses `dispatchCommand` (`REBUILD_MODE` guard, reconciliation.handlers.ts:319). The live server's event path (`projection.db.worker.ts` → `projectDomainEventCore`) has no call chain into `reconcileOrderFulfillment` at all. Confirmed via export-level trace of both files, not inferred.

**Implication:** decisions cannot be created from live traffic today, regardless of whether the commands-consumer (this playbook's Option A) gets built. The consumer and this gap are both required before DECISION-ENGINE-01 is actually fixed end-to-end.

**Not yet decided:** whether Thread A-2 is its own ticket or folds into this one.
