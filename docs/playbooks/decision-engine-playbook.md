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

## 4. Session 3 (2026-06-30) — WORKING END TO END, FIRST TIME EVER

**Status: 🟢 Decisions are now created live, automatically, from real
domain events.** Verified live: 18/18 commands processed, 18/18 real
decision rows created, zero manual intervention, full pipeline:
domain event → projection.db.worker.ts (Step 3)
→ order_reconciliation_intents row created (orders.create.ts /
wms.controller.ts, now carries shop_id)
→ projection.db.worker.ts Step 4 drains intents, calls
reconcileOrderFulfillment(..., knownShopId)
→ constraint evaluation → dispatchCommand('RECONCILIATION_RUN')
→ commands row persisted (tenant-scoped)
→ commands.consumer.ts (NEW) polls pending commands
→ generateDecisions() → DecisionRepository.create()
→ real row in decisions

### 4a. The architecture, as built

**`apps/backend/src/workers/commands.consumer.ts`** (new file) — the
piece this playbook always said was missing. Polls `commands` where
`status = 'pending'` (cross-tenant, `systemQuery()` — safe here because
`commands` now has a split policy, see §4c below), hydrates payload
(`shopId`, `orderId`, `aggregateVersion`, `riskSnapshot` — already
present, already correctly typed, no parsing needed), calls
`generateDecisions()`, persists each result via
`DecisionRepository.create(trx, decision)` inside a
`SET LOCAL app.current_tenant`-scoped transaction, marks the command
`processed`. Registered in `bootstrap/workers.ts` alongside
`execution.dispatcher.worker.ts`, same `import → check → start → push
stop fn` convention as every other worker in that file.

### 4b. Thread A-2 resolved — the live reconciliation gap

The gap documented in §3 (`reconcileOrderFulfillment` unreachable from
live traffic, only from `rebuild-from-events`) is now closed.
`projection.db.worker.ts` Step 4 calls `reconcileOrderFulfillment`
directly, every poll cycle, unconditional on whether a new event
arrived that cycle — see inline comments in that file for the full
reasoning (A2-BUG-01 fix).

### 4c. RLS fixes required to get here (full list, for the next person)

Every one of these was found by something *working* (no crash, no
error) but silently doing nothing — the genuinely hard part of tonight
wasn't writing fixes, it was noticing each successive silent failure.

1. `DecisionRepository.create()` — took bare `db`, now takes `trx` first
   param.
2. `order_reconciliation_intents` — had **zero RLS policy at all**
   (not exempt, just never given one). Added `shop_id` column
   (base migration `0037`) + split policy (permissive SELECT for the
   cross-tenant Step 4 scan, strict write).
3. `order_reconciliation_intents` INSERT sites (`orders.create.ts`,
   `wms.controller.ts`) — needed `shop_id` added to their insert objects
   once the column existed; nothing wrote it initially.
4. Step 4's `orderRow` lookup — `systemQuery()` misuse (see
   RLS_blueprint.md §7, "systemQuery() does not bypass RLS"). Fixed by
   tenant-scoping via `intent.shop_id`.
5. Step 4's `FOR UPDATE` on the intent poll — see RLS_blueprint.md §7,
   "FOR UPDATE silently returns zero rows". Removed; not needed for this
   single-threaded sequential worker.
6. `reconcileOrderFulfillment()` — had no tenant bootstrap at all (only
   ever ran via `rebuild-from-events`, whose `systemDb` role has
   `BYPASSRLS`, masking the gap entirely). Added optional `knownShopId`
   param so callers who already know it (Step 4) skip the broken
   cross-tenant lookup.
7. `command.bus.ts`'s `dispatchCommand()` — the **original** Thread A
   finding from session 1, never actually fixed until tonight. Bare
   `db('commands').insert(...)`, no tenant context, ever.
8. `commands` table — same as #2: standard strict policy, no permissive
   carve-out, would have made the new consumer's poll silently return
   empty. Added split policy (`0078` migration) alongside building the
   consumer, not after — this one was caught before shipping broken.

### 4d. A real, separate, unrelated bug found along the way

**Seed data collision** (now fixed): `dev_seed.ts`'s QA orders and
`seed_overview.sql`'s cohort A both started their external order ID
range at `900001`. Two unrelated orders collided in
`external_order_identity_map` (last-seed-script-wins), causing
`reconcileOrderFulfillment` to throw `EVENT_ANCHOR_INVARIANT` for a
real order while resolving to a *different* real order's identity
mapping. Took a full deterministic-hash verification (recomputing the
order UUID by hand, ruling out namespace drift, ruling out every other
writer of that table) to prove it wasn't a code bug. Fixed: QA orders
now use `800001+`.

### 4e. Still open, not fixed tonight

- **`MARGIN_COMPUTATION_FAILED`** — fires on nearly every order during
  live reconciliation (`order_margin_snapshot` rejects the write,
  `PROJECTION_WRITE_VIOLATION` guard — same class as the documented
  RLS_blueprint.md §7 entry, just triggered from a new call path).
  Marked non-fatal by existing code (`// Non-fatal — margin failure
  must not block reconciliation`), confirmed not to block anything
  tonight, but real margin data isn't being computed during live
  reconciliation. Needs its own fix.
  - **A2-BUG-02** — `decision_execution_queue` insert in
  `reconciliation.handlers.ts`'s `executionBuffer` drain loop, outside
  `trx` scope. **Still open, still dormant** — this is a distinct bug
  from the reuse-branch issue below and was NOT touched by that fix
  (2026-07-02). Only reachable via decision-reuse, now confirmed to
  actually fire in practice (see below) — no longer purely theoretical.
- **`execution.dispatcher.worker.ts`** — same `systemQuery()` exposure
  on `decision_execution_queue` / `decisions`, confirmed via direct
  policy read, never fixed. Will matter the moment a decision actually
  reaches execution.
- `inventory_blocked_revenue` decimal-as-string in
  `mapToDecisionSignals` — now visible in real payloads
  (`"blocked_revenue": "260.00"`, confirmed string-typed).
- ~~Reuse-branch double-push/double-create in `reconciliation.handlers.ts`~~
  **— ✅ FIXED 2026-07-02, see §5 below.** This entry's original framing
  was imprecise: the real bug wasn't a push/create defect *inside* the
  reuse branch — it was that the reuse branch's scope (per
  `aggregate_version`) was too narrow. An order's version can increment
  while its constraint state is genuinely unchanged, so the old
  per-version check correctly found "no existing decision for *this*
  version" and dispatched a fresh, functionally-duplicate one. This
  also confirms the prediction above was right: this was NOT
  purely dormant — GitHub issue #1035 shows it fired live, twice,
  ~36 hours after this entry was written.

See GitHub issues #1024–#1028 and the seed-collision issue created
2026-06-30 for individually tracked items. #1035 tracks the reuse-branch
fix (closed, see §5).

## 5. Session 4 (2026-07-02) — Reuse-branch cross-version duplicate, fixed

**Trigger:** found live during an Order Flow module UX audit (unrelated
starting point) — Blocked Orders list showed the same order twice.
Traced through `order_constraints` (one row, correct) → live API
response (two rows, duplicated) → `decisions` table (two `pending`
rows, same `entity_id`, same `type`, created 2.26s apart, `aggregate_version`
1 and 2 respectively).

**Root cause:** `reconcileOrderFulfillment`'s decision-reuse check
(`existingDecisions`) was scoped to `{ entity_id, aggregate_version }`.
This is correct for idempotency *within* one version, but an order's
`aggregate_version` can increment (any unrelated projection event) while
it sits in the exact same unresolved constraint state. Each version bump
then generates a genuinely distinct, correctly-formed idempotency key
(`reconciliation-{orderId}-{version}`) — so `command.bus.ts`'s
`.onConflict('idempotency_key').ignore()` (working exactly as designed)
has nothing to collide against, and dispatches a second command,
producing a second, functionally-identical decision.

**Fix, shipped:** the reuse check now compares the *set* of currently-
active constraint action types (derived from
`isInventoryBlocked`/`isCustomerBlocked`/`isOperationalBlocked`, already
computed earlier in the same function) against the *set* of action types
already `pending` for the entity — regardless of `aggregate_version`.
Matches `generateDecisions()`'s real behavior of producing one decision
per active constraint type, not a single decision. If the sets match,
existing pending decisions are reused and no new command is dispatched.

**Two self-caught mistakes during this fix, worth restating:** the first
draft (a) referenced a `riskSnapshot.recommended_action_type` field that
doesn't exist anywhere on that table, and (b) introduced an unbalanced
brace when wrapping the existing reuse-check block in a new `if/else`,
breaking compilation two ways at once. Both were caught only via live
TypeScript errors after applying, not before — this file's own §4c
already documents that "the genuinely hard part... wasn't writing fixes,
it was noticing each successive silent failure"; this session's mistakes
were at least *loud* failures (compile errors), not silent ones, but the
lesson holds: this function's real complexity (650+ lines, heavy
RLS/transaction sensitivity, several prior subtle bugs) warrants viewing
the full relevant scope before editing, not incremental grep-and-guess.

**Verified live:** existing duplicate decision rows cleaned up in dev,
API (`GET /api/v1/orders/constrained`) confirmed zero duplicates,
Order Flow UI screenshot confirmed correct (2 distinct orders in
"Address issue" category, not 1 order duplicated). See GitHub issue
#1035 (closed) for the full investigation trail.
