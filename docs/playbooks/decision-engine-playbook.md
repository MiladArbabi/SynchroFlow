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

# 1035 (closed) for the full investigation trail.

## 6. Session 5 (2026-07-04) — ISS-07: safe-fulfillment gate had zero fulfillment-status awareness

**Trigger:** found live during the Outbound module audit — order #900008
(confirmed `order_fulfillment_status.status = 'fulfilled'`) still showed
a "Proceed to Ship" recommended action in its detail modal, wired to
`proceed_fulfillment.handler.ts`, which calls Shopify's `fulfillmentCreate`
mutation directly — no tracking, no pick/pack step, would have falsely
triggered a customer shipping-notification email for an order already
shipped.

**Root cause:** the safe-fulfillment gate (`decision.engine.ts`,
`isSafeToFulfill`) only checked `order_health_score` + the three
constraint flags (`is_inventory_blocked`/`is_customer_blocked`/
`is_operational_blocked`). It never checked whether the order was
already fulfilled — `proceed_fulfillment` is generated whenever
`decisions.length === 0` (no active blocker), which is exactly the state
of an already-fulfilled order with nothing left to block it. Not a
partial/edge-case bug — every constraint-free order, fulfilled or not,
hit this gate with zero fulfillment awareness.

**Fix, shipped:**
- `DecisionSignals` type + `mapToDecisionSignals()` (`decision.engine.ts`)
  gained a new `is_already_fulfilled: boolean` field.
- Gate updated: `isSafeToFulfill` now also requires
  `!signals.is_already_fulfilled`.
- `reconciliation.handlers.ts` fetches `order_fulfillment_status` for the
  order (separately from `order_risk_snapshot`, since fulfillment status
  is a different projection table with its own lifecycle) and computes
  `isAlreadyFulfilled`, threaded through the `RECONCILIATION_RUN` command
  payload → `commands.consumer.ts` → merged onto `riskSnapshot` before
  calling `generateDecisions()` (required because `generateDecisions`'s
  signature only accepts a single `riskSnapshot` param, no separate
  field).
- `CommandRow.payload` type (`commands.consumer.ts`) updated to include
  `isAlreadyFulfilled?: boolean` — missed on the first pass, caught by
  a live TS error (same class of self-caught mistake as §5 above: grep
  each piece of a multi-part diff separately, not one confirmation grep).

**Cleanup (existing bad data, not prevented by the above):** 10 decision
rows found live with `recommended_action.type = 'proceed_fulfillment'`,
`status IN ('pending','in_progress')`, joined against
`order_fulfillment_status.status = 'fulfilled'` — all 10 from the same
seed batch (matches Outbound's "10 shipped" total exactly). Set to
`status = 'dismissed'` (non-destructive, matches this table's append-
only/audit-preserving convention elsewhere) rather than deleted. This
fix only prevents *new* bad decisions — pre-existing ones needed this
one-time cleanup query, documented here in case the same class of bad
decision needs finding again later:

```sql
UPDATE decisions
SET status = 'dismissed'
WHERE id IN (
  SELECT d.id
  FROM decisions d
  JOIN order_fulfillment_status ofs ON ofs.lasyncro_order_id = d.entity_id::uuid
  WHERE d.recommended_action->>'type' = 'proceed_fulfillment'
    AND d.status IN ('pending','in_progress')
    AND ofs.status = 'fulfilled'
);
```

**Separate, related, NOT the same bug — ISS-07b (documented in
`entity-detail-modal-playbook.md`):** the modal's "Pipeline status" pill
independently showed stale "In pool" for the same fulfilled orders, for
an unrelated reason (`order_warehouse_status` has no row for orders
fulfilled outside LaSyncro's own pick/pack pipeline — legitimate for
Shopify-side-fulfilled/seed orders, not a data bug). Confirmed as two
separate defects with two separate fixes, not one shared root cause —
see that playbook's entry for the display-layer fix.

---

## 7. Session 6 (2026-09-02) — ORD-DECISION-01 Slice 2: inventory/oversell

Shipped behaviour is described canonically in
`docs/blueprints/Constraint_System_Blueprint.md` → *Constraint Types →
Inventory*. This entry records the decisions, the limits, and the
evidence.

### 7a. What changed

1. **One shortage definition.** `resolve_inventory_block.handler.ts` no
   longer carries its own shortage query; it calls
   `evaluateInventoryConstraint`. The removed query used original
   ordered quantity, joined `inventory_truth` per-location without
   grouping, and ignored pickability — so a variant with 0 at root and 7
   in bin `A-1` read as short.
2. **Stale-decision defence.** `POST /orders/:orderId/execute` now
   elects a decision through the same action → required-active-constraint
   map as the GET path
   (`domain/decision/decisionConstraintRequirements.ts`, new file). The
   map was previously local to
   `orders.decision-by-order.controller.ts`, which is why the write path
   could queue what the read path already refused.
3. **Truthful inventory UX.** `OrderDetailModalBody` derives inventory
   actions from **active constraints**, not from the elected decision
   payload.

### 7b. Legacy action retained — deliberately

`resolve_inventory_block` was **NOT** replaced globally by a neutral
`open_sourcing` action. Do not describe it as replaced.

The workshop concept was ratified conditionally — "IF compatible with
existing decision action typing/wiring without broad architecture
change". Audit showed it is not. `resolve_inventory_block` is
load-bearing in at least six places:

- `bootstrap/workers.ts:158,160,187` — handler registration + action list
- `api/orders/orders.constrained.controller.ts:152` — SQL `CASE`
  mapping `'inventory' → 'resolve_inventory_block'`
- `workers/reconciliation/reconciliation.handlers.ts:536` —
  `activeActionTypes`
- `api/orders/orders.decision-by-order.controller.ts` — staleness map
- `tests/unit/ui/orders/OrderDetailModalBody.returned-undelivered.test.tsx`
  (4 sites) — existing protected regression

The handler is therefore **retained as a defensive path** for stored
historical decisions, and behaves as follows:

- canonical remaining demand genuinely covered → normal fulfillment may
  proceed (delegates to `proceed_fulfillment`, full idempotency
  pipeline);
- still short → does **not** fulfill, does **not** manually clear the
  constraint, does **not** invent sourcing side effects (the existing
  SRC-18c critical-only alerting path is unchanged).

The truthful-UX outcome is delivered instead by the UI deriving actions
from active constraints, which is why this limitation does not block the
slice.

**Follow-up — INV-ACTION-ARCH-01 | OPEN**
Decouple inventory workflow navigation from legacy
`resolve_inventory_block` machine execution through a neutral workflow
action such as `open_sourcing`. Requires coordinated worker /
reconciliation / controller changes; out of scope for Slice 2.

### 7c. Verification

Targeted:

| Suite | Result |
|---|---|
| `tests/integration/orders/inventory-decision-contract.test.ts` | 7/7 PASS |
| `tests/unit/ui/orders/OrderDetailModalBody.inventory-sourcing.test.tsx` | 3/3 PASS |

Regression:

| Check | Result |
|---|---|
| returned-undelivered backend integration | 10/10 PASS |
| returned-undelivered frontend | 10/10 PASS |
| backend TSC | `TSC_ERROR_COUNT=0`, `TARGET_ERROR_COUNT=0` |
| frontend TSC | `TARGET_ERROR_COUNT=0`; 19 pre-existing baseline errors in untouched files |
| test ownership (`npm run test:config`) | `UNOWNED=0`, `MULTI_OWNED=0` |
| disposable test DB | created → migrated → runtime-verified → dropped; no `synchroflow_test_*` orphans; dev DB untouched |

Full backend-integration project: **11 failed suites / 23 passed**,
**2 failed tests / 162 passed**. All failures are pre-existing baseline,
unrelated to this slice:

- 10 suites fail at load with
  `Could not locate module api-src/middleware/auth.middleware`. That file
  does not exist at `HEAD` —
  `git cat-file -e HEAD:apps/backend/src/middleware/auth.middleware.ts`
  returns *does not exist in 'HEAD'*.
- `tests/integration/auth/register-creates-membership.test.ts`
  ("creates a shop, an OWNER membership, and issues auth tokens";
  expected users length 1, received 0) was **independently reproduced at
  untouched `25841c83b6dcabbbd6edf3b75678fb84fc68f86b`** in a separate
  clean worktree containing none of this slice.
  **PROVEN PRE-EXISTING.**

### 7d. Live browser evidence (2026-09-02)

Runtime served from the Slice 2 worktree — verified by process CWD, not
assumed:

```text
frontend  /private/tmp/synchroflow-ord-decision-push/apps/frontend
backend   /private/tmp/synchroflow-ord-decision-push/apps/backend
```

Route used: `/orders/flow?constraint=inventory` → order `#800001`
(`eea5bc08-d706-0ff9-62e9-cd08f9c05d4d`).

Note: Orders Overview "Needs a decision" could **not** be used — see
ORD-OVERVIEW-INVENTORY-01 in `docs/blueprints/OrdersModule.md`.
`/orders/flow` reaches the same orders because it applies its SLA filter
only when `?urgency=sla_breach` is present.

Observed:

- "Out of Stock" issue visible
- "Source this item" visible
- navigates to
  `/suppliers-portal/sourcing?variantId=cb3592bc-1951-4c0b-aa39-306c5d6ef0dd`
- correct Sourcing context loaded
- constraint **remained blocked** after returning — navigation does not
  resolve it
- **no automatic PO or reorder request created**

**Routing passed technically, but the downstream Sourcing UX exposed
SOURCING-UX-COGNITIVE-01** (`docs/blueprints/SuppliersModule.md` §6):
the merchant arrives at the correct variant, but the screen's cognitive
load and weak decision hierarchy make it hard to tell what is blocked,
what is already covered, and whether *Add to queue* or *Create PO*
actually unblocks the order. Slice 2's routing contract is verified and
closed; that is open follow-up work with its own brief.

#### Subsequent resolution — 2026-09-03

The observation above is preserved exactly as recorded on 2026-09-02, including
the `variantId`-only route seen at that time. It explains how the defect was
discovered and is deliberately **not** rewritten to match current behaviour.

Since then, **SOURCING-UX-COGNITIVE-01 Slice 1A — Targeted Recovery
Foundation** has been implemented and verified:

- The order-originated route now carries the canonical `variantId` **and** an
  optional canonical `orderId`
  (`/suppliers-portal/sourcing?variantId=<canonical_variant_id>&orderId=<canonical_order_id>`).
  The `orderId` is context only — it names which order sent the merchant there
  and takes no part in any calculation.
- Targeted Sourcing now presents, in this order: product/variant **identity**,
  **purchasing truth** (available, open demand, committed inbound, short now,
  still to source), **blocking/originating order context**, then **supplier
  candidates**.
- Portfolio-only Sourcing content — Never Ordered Before, Sourcing Pulse, and
  the generic Supplier Preferences administration block — is suppressed in
  targeted mode and preserved unchanged in generic mode.

What is unchanged by Slice 1A, and remains as observed above: navigation still
does not resolve the constraint, and no PO or reorder request is created
automatically. Slice 1A is a read/understanding surface; targeted recovery
*actions* are Slice 1B.

Current authoritative semantics live in `docs/blueprints/SuppliersModule.md` §6
and in the Slice 1A section of
`docs/playbooks/sourcing-recommendation-playbook.md`. This playbook records the
historical decision-engine observation only.

The umbrella issue remains **IN PROGRESS** for Slice 1B, L2 and L1.

Multi-variant live browser check: **NOT AVAILABLE** — no deterministic
multi-variant inventory-block fixture exists (see
`docs/blueprints/OrdersModule.md`, ORD-FIXTURE-INVMULTI-01). This is a
verification-fixture gap, **not** an untested product contract:
INV-RED-08 (multiple blocked variants independently actionable) is
permanently protected by the automated frontend test.
