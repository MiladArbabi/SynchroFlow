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
Foundation** has been implemented, verified and deployed
(**CLOSED / VERIFIED / DEPLOYED**, commit
`41060ca8d3292e70796186bb2dbdef61620642bf`):

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
  the generic Supplier Preferences administration block — was suppressed in
  targeted mode and, at the time Slice 1A shipped, preserved unchanged in
  generic mode. Slice 2 (below) subsequently replaced generic mode's own
  default content.

What is unchanged by Slice 1A, and remains as observed above: navigation still
does not resolve the constraint, and no PO or reorder request is created
automatically. Slice 1A is a read/understanding surface; targeted recovery
*actions* are Slice 1B.

Current authoritative semantics live in `docs/blueprints/SuppliersModule.md` §6
and in `docs/playbooks/sourcing-recommendation-playbook.md` §13. This playbook
records the historical decision-engine observation only.

**Update — 2026-09-03.** Slice 1B (targeted recovery actions) and Slice 2 (the
Unified Sourcing Worklist) are now also **CLOSED / VERIFIED** — see
`sourcing-recommendation-playbook.md` §13.10 and §13.19–13.21. The umbrella
issue SOURCING-UX-COGNITIVE-01 is CLOSED / VERIFIED; there is no Slice 3. The
Sourcing architecture was reduced to two levels on 2026-09-03 — a Unified
Sourcing Worklist ("where do I need to act?") and the Product/Variant Sourcing
Detail ("how do I resolve this exact SKU?") — so **no separate Sourcing
Overview screen remains planned**. Orders → *Source this item* continues to
bypass the worklist and open the detail level directly.

Multi-variant live browser check: **NOT AVAILABLE** — no deterministic
multi-variant inventory-block fixture exists (see
`docs/blueprints/OrdersModule.md`, ORD-FIXTURE-INVMULTI-01). This is a
verification-fixture gap, **not** an untested product contract:
INV-RED-08 (multiple blocked variants independently actionable) is
permanently protected by the automated frontend test.

---

## 8. Session 7 (2026-09-05) — ORD-DECISION-01 Slice 3: Fulfillment SLA

**Product contract:** Fulfillment SLA is an urgency/prioritization signal, not
an operational blocker and not an independently resolvable Decision Engine
condition.

The canonical breach truth remains
`order_age_snapshot.is_shipping_sla_breached`, derived from paid age against
the merchant-configured `fulfillment_sla_hours`, and only while the order is
unfulfilled.

### What must NOT happen

`operational/sla_breach` constraints must not be created or resurrected.

An SLA breach alone must never:

- create an `order_constraints` blocker;
- generate a synthetic `Resolve SLA` action;
- auto-release an order;
- create a pick batch;
- advance fulfillment state;
- override a real inventory, customer, or Returns blocker.

If another real blocker is active, that blocker continues to own the merchant
action. Verified live with order `#900016`: the order was SLA-breached and had
`operational:returned_undelivered`; Order Flow kept it in Blocked Orders,
displayed `Package returned`, and retained the Returns-owned `Review return`
action.

### Order Pool contract

An otherwise releasable SLA-breached order remains in the normal Order Pool.

Release remains explicitly merchant-controlled through the existing batch
release flow. SLA changes urgency/order only; it does not cause release.

Server-side Order Pool and release selection preserve:

```text
is_priority_flagged DESC
→ is_shipping_sla_breached DESC
→ order_created_at ASC
```

Live verification proved that selecting one SLA-breached order and clicking
`Release 1 order` created exactly one batch, removed only that selected order
from the pool, and left the remaining SLA-breached orders unreleased.

### Frontend ordering correction

Live UI verification exposed a separate wiring defect: `OrderFlowPage` took
the correctly ranked backend rows and re-sorted them only by the operator's
selected table field, allowing Age/Value/Lines/Units sorting to destroy the
server's Priority/SLA ordering.

The frontend now preserves:

```text
Priority
→ SLA breached
→ operator-selected sort field/direction
```

Operator sorting therefore applies only within the same Priority/SLA tier.

The extracted pure comparator lives in:

```text
apps/frontend/src/pages/ft2-pages/orderPoolSorting.ts
```

and is consumed by `OrderFlowPage.tsx`.

### Permanent regression protection

Backend integration:

```text
tests/integration/wms/sla-decision-contract.test.ts
```

protects:

- `SLA-DEC-01` — SLA breach creates no `operational/sla_breach` constraint;
- `SLA-DEC-02` — SLA-breached releasable orders receive release priority;
- `SLA-DEC-03` — SLA alone causes zero automatic release side effects;
- `SLA-DEC-04` — real blockers remain authoritative when SLA is also breached;
- `SLA-DEC-05` — fulfilled orders leave the active Fulfillment-SLA population.

Frontend unit protection:

```text
tests/unit/frontend/orderPoolSorting.test.ts
```

protects:

- `SLA-DEC-02-UI-A` — SLA-only remains ahead of calm orders regardless of
  operator sort direction;
- `SLA-DEC-02-UI-B` — Priority outranks SLA-only;
- `SLA-DEC-02-UI-C` — operator sorting still works within an urgency tier.

Automated verification: backend SLA contract suite `5/5` passed; frontend
ordering suite `3/3` passed; Jest ownership remained `UNOWNED=0`,
`MULTI_OWNED=0`; touched-surface TypeScript error count was zero.

### Live verification boundary

Browser verification covered:

- SLA-only orders remain in the normal Order Pool;
- SLA alone does not appear as a blocker;
- manual release creates the batch only after explicit merchant action;
- Returns remains authoritative when SLA and `returned_undelivered` coexist;
- frontend Priority → SLA → operator-sort ordering is preserved visually.

For the decisive ordering browser check, order `#900017` was temporarily
given an append-only higher-version age snapshot with
`is_shipping_sla_breached=false`. On the real development runtime
(`localhost:5173`), the browser showed `#900017` without an SLA badge and kept
it below all SLA-breached orders under Age-ascending sorting, even though
`#900017` was the oldest order. This discriminates the corrected comparator
from the former frontend behavior, which allowed operator sorting to override
SLA priority.

The fixture was then restored append-only at aggregate version `12` with
`is_shipping_sla_breached=true`; no snapshot row was updated or deleted.

**ORD-DECISION-01 Slice 3 — Fulfillment SLA: IMPLEMENTED / AUTOMATED VERIFIED /
LIVE VERIFIED.**

---

## 9. Session 8 (2026-09-06) — ORD-DECISION-01 Slice 4: Address & Customer

### Product contract

- laSyncro operationally ingests **paid** Shopify orders.
- `awaiting_payment` is **not** a valid customer blocker.
- The canonical customer blocker is `customer/incomplete_address`.
- Required address fields: `address1`, `city`, `zip`, `country_code`.
- Constraints are truth; decisions are enrichment.

### Merchant action

- Blocker label: **Address Issue**
- Problem sentence: **Shipping address incomplete**
- CTA: **Correct shipping address**
- The generic `resolve_customer_block` execution handler is a documented manual
  no-op and is deliberately bypassed by the real address-correction UX. Routing
  an operator to it would be a dead end, so it is never the operative CTA.

### Resolution path

`PATCH /api/v1/orders/:orderId/shipping-address`

- persists the complete address;
- advances `aggregate_version` exactly once;
- writes an `order_reconciliation_intents` row;
- writes an `address_corrected` `order_fulfillment_history` entry;
- emits `orders/shipping_address_corrected`;
- the real projection path re-evaluates constraints;
- `customer/incomplete_address` resolves **only** after server-confirmed
  projection — never optimistically;
- the UI shows "Address updated — rechecking order…" while waiting and does not
  optimistically clear the blocker.

### Implementation cleanup

- deleted `apps/backend/src/projections/orderCustomerConstraintProjection.ts`;
- removed its `projectionExecutionOrder.ts` entry;
- removed its `projectionDependencies.ts` entry;
- removed the `customer/awaiting_payment` reconciliation priority case;
- the live `customerConstraintEvaluator.ts` remains **unchanged**;
- no shipping-address flow or Decision Engine generation behaviour changed.

### Permanent regression

Backend — `tests/integration/orders/address-customer-decision-contract.test.ts`
ADDR-DEC-01..05 — **5/5 PASS**.

Frontend — `tests/unit/ui/orders/OrderDetailModalBody.customer-address.test.tsx`
ADDR-UI-01..04 — **4/4 PASS**.

Verification:

- backend integration 5/5 PASS on the correct integration worktree;
- frontend 4/4 PASS;
- `UNOWNED=0` / `MULTI_OWNED=0`;
- test TSC `TARGET_ERROR_COUNT=0`;
- backend TSC `TSC_ERROR_COUNT=3 / TARGET_ERROR_COUNT=0`;
- all three backend errors were unrelated pre-existing baseline:
  `handleSubscriptionUpsert.ts` has the existing missing `TIER_ORDER` export,
  and `require-entitlement.middleware.ts` has two existing
  `@lasyncro/commercial-policy` module-resolution errors;
- disposable DB cleanup PASS (`TEST_DB_DROPPED` each run, zero
  `synchroflow_test_*` orphans, development `PGDATABASE` intact);
- dead-path grep leaves only explanatory `awaiting_payment` text in
  `customerConstraintEvaluator.ts`.

### Live verification

Recorded from the lead's live browser/DB session; not re-executed by the
implementation agent.

Fixture:

- external order `940051788700087657`
- canonical order `6e8d8e9a-f3ce-3847-e90f-a7fe79243e8b`

Before correction:

- `paid=true`
- `aggregate_version=2`
- exactly one active blocker: `customer/incomplete_address`
- browser showed **Address Issue → Correct shipping address**

Correction submitted: London / NW1 6XE / GB. Browser showed
"Address updated — rechecking order…".

After server confirmation:

- `aggregate_version=3`
- `customer/incomplete_address` `is_active=false`
- `resolved_at` populated
- exactly one `orders/shipping_address_corrected` event, `id=94`
- browser showed **In pool / No open issues**
- Address Issue count 3 → 2
- Order Pool count 7 → 8
- the fixture appeared in the normal Order Pool

Separate multi-blocker fixture: external order `940041788699857417` carried both
`customer/incomplete_address` and `inventory/oversell`. It was **not** resolved
live — it is retained only as supporting evidence for coexisting-blocker
behaviour. ADDR-DEC-04 provides the permanent automated contract for that case.

### Known limitation

No `requires_shipping`/`delivery_method` truth exists anywhere in the codebase.
A genuine Shopify local-pickup order — which legitimately has no shipping
address — would currently be misclassified as `incomplete_address`. Unchanged by
this slice and flagged honestly pending a real signal.

**ORD-DECISION-01 Slice 4 — Address & Customer: IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED.**

---

## 10. Forward Work — Decision Treatment & Automation

### ORD-DECISION-AUTO-01 — Decision Treatment & Automation Framework | OPEN

**Approved 2026-09-06.**

Decision Engine coverage is not complete merely because a constraint can be
detected and surfaced with a CTA.

Every Decision Engine pair must also define its **resolution treatment and
automation policy**:

```text
Constraint
→ Evidence
→ Possible treatments
→ Risk
→ Automation level
→ Human/customer confirmation
→ Execution
→ Verification
→ Audit trail
```

Treatment levels:

1. **Inform** — explain the problem and required action.
2. **Assist** — gather relevant evidence and recommend a resolution.
3. **Confirm & execute** — laSyncro prepares the resolution; an operator,
   merchant, or customer explicitly approves it.
4. **Auto-resolve** — only for deterministic, low-risk actions whose result can
   be verified and fully audited.

**Core rule:** automation level is decided per treatment, not per constraint.

A single constraint may have several possible treatments with different safety
requirements. laSyncro must automate evidence gathering aggressively while
automating consequential state changes conservatively.

No Decision Engine treatment may infer or invent merchant/customer intent where
the evidence is insufficient.

### Existing pairs to revisit

The following completed Decision Engine pairs remain closed for their current
contracts, but require a dedicated Automation & Treatment workshop under
ORD-DECISION-AUTO-01:

- `inventory/oversell`
- Fulfillment SLA urgency/prioritization treatment
- `customer/incomplete_address`

Revisiting these pairs does **not** reopen their completed slices unless the
workshop produces an approved implementation change.

### Address/customer automation direction

For `customer/incomplete_address`:

- the current order remains the authoritative starting point;
- deterministic normalization that does not change destination intent may be
  eligible for automatic treatment;
- Shopify customer/default-address data may be used as a **candidate** source,
  but differing destination data requires confirmation;
- previous fulfilled-order addresses may provide investigation context only and
  must never independently justify replacing the current order destination;
- conflicting addresses require confirmation;
- when no trustworthy resolution exists, customer confirmation is preferred
  over warehouse-operator detective work;
- manual editing remains the safe fallback.

Target progression:

```text
Detect
→ explain missing/conflicting fields
→ gather connected evidence
→ classify confidence and risk
→ recommend safest treatment
→ confirm when required
→ execute
→ re-project canonical constraint truth
→ verify resolution
→ record provenance and audit trail
```

### Roadmap rule going forward

From the next Decision Engine pair onward, the WORKSHOP phase must explicitly
cover:

- evidence sources;
- treatment options;
- risk of each treatment;
- automation level;
- confirmation authority;
- execution mechanism;
- verification contract;
- audit/provenance requirements;
- manual fallback.

`ORD-DECISION-AUTO-01` is a cross-cutting roadmap requirement. It is not a
reason to pause baseline Decision Engine coverage or reopen already-closed
slices by default.

### Existing related follow-up

`INV-ACTION-ARCH-01` is **COMPLETED / VERIFIED** — see §11.6.

New inventory decisions use the neutral workflow action `open_sourcing`.
It is navigation-only, non-executable, and remains bound to active canonical
inventory constraint truth.

### Next Decision Engine pair

`SLA-TREAT-01` is **IMPLEMENTED / AUTOMATED VERIFIED** — see §11.9.

This slice extends the Decision Engine from constraint-specific treatment into
time-sensitive operational assistance while preserving the governing rule:

**constraint determines WHAT must be resolved; SLA determines HOW URGENTLY.**

Customer-delivery promise, carrier/service normalization and full pickup-policy
reasoning remain deliberately deferred to `SHIP-INTENT-01`,
`CARRIER-NORM-01`, `CPT-POLICY-01` and `PROMISE-01`.


---

## 11. ORD-DECISION-AUTO-01 — Approved Treatment Workshops

The three treatment workshops below were **approved on 2026-09-06**. This
section records the ratified product contract together with the bounded
implementation slices completed underneath that framework.

### 11.1 inventory / oversell

Ratified principles:

- Oversell is an operational failure event laSyncro should increasingly
  **prevent**, not something an operator manually marks resolved.
- laSyncro should automatically assemble evidence: shortage quantity;
  available / reserved / committed stock; other locations; inbound POs;
  supplier context; affected orders; SLA/priority context; and inventory-data
  conflicts where available.
- Legitimate treatment families:
  - hold for confirmed inbound;
  - source additional stock;
  - transfer stock;
  - merchant-confirmed reallocation;
  - investigate inventory discrepancy;
  - merchant-confirmed customer/order outcome changes.
- Sourcing is **one treatment**, not a synonym for oversell resolution.
- `INV-ACTION-ARCH-01` remains the first architectural follow-up: replace the
  misleading generic `resolve_inventory_block` workflow navigation with neutral
  treatment/workflow semantics such as `open_sourcing`.
- Analysis and evidence gathering **may** be automatic.
- Purchasing, transferring, reallocating customer inventory, substitutions,
  cancellations and other consequential actions **require confirmation**
  initially.
- Creating a PO, transfer or sourcing request does **not** clear oversell.
- Canonical inventory truth determines when the shortage condition disappears.
- Never count inbound stock as available before receiving.
- Never silently steal allocation from another order.
- Never silently change fulfillment location or customer commitment.

**Outcome concept.** Distinguish three separate measures:

- oversell events detected;
- oversell risks prevented;
- attributable value protected.

Only claim prevention or value when evidence proves a laSyncro intervention
prevented the operational failure.

### 11.2 Fulfillment SLA

Ratified principles:

- SLA remains **urgency/prioritisation only**, never a blocker.
- SLA may influence **priority**, never **permission**.
- Existing SLA-breached priority labeling is already a valid Decision Engine
  treatment.
- laSyncro cannot automate physical pick/pack/ship without hardware/robotics.
- Useful automation is **coordination**: SLA calculation, priority ordering,
  queue orchestration, stalled-work detection, notifications/escalation.
- Never auto-release because of SLA.
- Never bypass blockers, quality controls, fulfillment controls or customer
  commitments.
- Future pre-breach prediction is useful only when supported by trustworthy
  timing data.
- Do not create architecture merely to make SLA appear more automated.

**Outcome concept.** Measure SLA performance, prioritisation, and
evidence-backed prevented breaches. Do not invent monetary savings.

### 11.3 customer / incomplete_address

Ratified principles:

- Current order data is authoritative.
- Historical fulfilled-order addresses are **context only** and must NEVER
  independently justify changing the current destination.
- Deterministic normalisation that preserves destination intent may eventually
  be automated.
- Shopify customer / default-address data is **candidate evidence only**.
- Data supplied from another source normally requires confirmation.
- Materially conflicting addresses require operator or customer confirmation.
- No AI or system component may **invent** a missing destination.
- Preferred future fallback when evidence is insufficient: **customer
  self-service confirmation**, rather than warehouse-operator detective work.
- Manual editing remains available but should cease being the primary treatment.
- Correction submission does not itself resolve the constraint.
- Server-confirmed canonical constraint truth remains authoritative.
- Every correction requires provenance / audit evidence.

**Outcome concept.** Measure: address issues detected; resolved without manual
re-entry; customer-confirmation completion; time to resolution.

### 11.4 Cross-pair target model

Ratified conceptually:

Constraint → Decision → Treatment → Action → Verification → Outcome

Definitions:

- **Constraint** — canonical operational truth.
- **Decision** — what should happen next, based on truth + evidence + context.
- **Treatment** — the meaningful resolution / intervention path.
- **Action** — a concrete executable step within a treatment.
- **Verification** — canonical proof that the expected state actually changed.
- **Outcome** — measured operational result attributable to the treatment.

Shared rules:

- Automation level belongs to the **treatment/action**, not the constraint.
- Automate investigation and evidence gathering more aggressively than
  consequential execution.
- Action completion is **never** equivalent to problem resolution.

No DB or schema architecture is created by this section. This is the target
**conceptual** model, pending implementation design.

### 11.5 Approved implementation priority

Approved ordering:

1. `INV-ACTION-ARCH-01` / inventory treatment architecture
2. Address assisted resolution
3. Inventory evidence + ranked treatment options
4. SLA enhancements only where evidence supports them
5. Outcome/value layer, after reliable attributable treatment events exist

Priority item 1 (`INV-ACTION-ARCH-01`) is **COMPLETED** — see §11.6.
Priority item 2 (`ADDR-ASSIST-01`) is **COMPLETED / LIVE VERIFIED** — see §11.7.
Priority item 3 (`INV-TREAT-01`) is **COMPLETED / LIVE VERIFIED** — see §11.8.
Items 4–5 remain not started.

**ORD-DECISION-AUTO-01 workshops: PRODUCT CONTRACT RATIFIED / FRAMEWORK OPEN — priority items 1–3 IMPLEMENTED AND LIVE VERIFIED; items 4–5 NOT STARTED.**


### 11.6 INV-ACTION-ARCH-01 — Inventory workflow-action correction

**Status: IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED — 2026-09-06.**

#### What changed

- New `inventory`/`oversell` decisions emit `open_sourcing`.
- `open_sourcing` is a **workflow/navigation action**, not a machine execution.
- It is mapped to the active `inventory` constraint for staleness / read-model
  correctness.
- It is explicitly classified **non-executable** and cannot enter
  `decision_execution_queue`.
- `POST /api/v1/orders/:orderId/execute` skips workflow-only actions and uses
  the existing no-actionable-decision error path — no new status code was
  introduced.
- Order Detail continues to derive Sourcing navigation from the active
  inventory constraint's `target_id`, **not** from the elected Decision
  payload.
- Multiple blocked variants remain independently actionable.
- Navigating to Sourcing does **not** clear oversell.
- Canonical inventory truth remains the only resolution authority.

#### Legacy compatibility

- `resolve_inventory_block` is no longer emitted for NEW inventory decisions.
- Its handler, registry entry and constraint mapping remain **temporarily** for
  backward compatibility with previously persisted decisions and jobs.
- No migration was required: a dev audit found zero persisted
  `resolve_inventory_block` decisions and zero queue rows tied to them.

#### Automated evidence

- inventory decision integration: **12/12 passed**
- frontend targeted suites: **19/19 passed**
- test ownership: `UNOWNED=0`, `MULTI_OWNED=0`
- backend TSC: 0 total / 0 target
- frontend TSC: 19 baseline / 0 target
- test TSC: 1 baseline / 0 target

#### Live browser evidence

- order `#800002` showed **Out of Stock / oversell**;
- CTA rendered as **Source this item**;
- navigation opened Sourcing for **QA Hoodie / QA-HOODIE-M**;
- source context preserved order `800002`;
- no generic **Take action** and no legacy **Go to sourcing** execution CTA;
- returning to Order Flow left the order blocked, because inventory truth had
  not changed.

### 11.7 ADDR-ASSIST-01 — Address assisted resolution

**Status: IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED — 2026-09-07.**

#### What changed

- Order Detail now exposes `addressAssist` for an active
  `customer/incomplete_address` constraint when trustworthy historical
  evidence exists.
- Evidence is limited to complete, fulfilled historical orders for the same
  tenant and the same persisted `customer_hashed_id`.
- The current order, other customers, other tenants, unfulfilled history and
  incomplete historical addresses are excluded.
- Equivalent historical destinations are grouped deterministically; ranking is
  by usage count, then most recent fulfilled use, then normalized fingerprint.
- Historical address data is **evidence only**, never destination authority.
- The existing **Correct shipping address** dialog shows the strongest
  **Previously used address** candidate with usage and recency provenance.
- **Use this address** only pre-fills destination fields in local form state.
  It does not save, execute a Decision, emit an event or clear a constraint.
- Current-order recipient name and phone remain unchanged when evidence is
  applied.
- The merchant can review and edit the pre-filled address before saving.
- The existing shipping-address PATCH remains the **only write path**.
- Canonical constraint reevaluation remains the **only resolution authority**.
- No Shopify customer/default-address API, `customers` table lookup,
  `CustomerResolutionService`, migration, Decision Engine schema change or
  new route/controller was introduced.

#### Automated evidence

- address/customer backend integration: **16/16 passed**
- address/customer frontend unit: **7/7 passed**
- test ownership: `UNOWNED=0`, `MULTI_OWNED=0`
- backend TSC: **0 total / 0 target**
- frontend TSC: **486 total observed / 2 pre-existing target-file errors / 0 new target errors**
- test TSC: **1 pre-existing baseline / 0 target**
- `git diff --check`: clean
- production scope: exactly
  `orders.service.ts`, `useOrderDetail.ts`,
  `OrderDetailModalBody.tsx`
- regression scope: exactly the existing address backend integration and
  frontend unit contract files
- the historical-address test fixture was corrected from `province` to
  Shopify GraphQL's real `provinceCode` ingestion shape; this did not weaken
  the behavior contract.

#### Live browser evidence

- target blocked order: `721b4dcd-f4ac-ca85-3562-c19a3276e589`
  (`Slice 4 Address Only`);
- Order Detail showed **Address Issue → Correct shipping address**;
- correction dialog showed **Previously used address** with
  `1500 Market St`, `Philadelphia`, `19103`, `PA`, `US`;
- provenance showed one fulfilled historical use, last used 2026-06-15;
- **Use this address** was corrected during live verification to the canonical
  Tier-2 ghost-pill CTA required by the Modules UX Playbook;
- clicking **Use this address** pre-filled the form only; the dialog remained
  open and **Save address** remained the separate Tier-1 commit action;
- pre-filled fields remained editable before save;
- no automatic write, Decision execution or constraint resolution occurred;
- live verification used `http://127.0.0.1:5173` because `localhost:5173`
  resolved to an unrelated IPv6 Vite server from another worktree;
- the temporary browser fixture changed only the blocked order's
  `customer_hashed_id` and was restored to `NULL` after verification.

**ADDR-ASSIST-01: IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED.**

### 11.8 INV-TREAT-01 — Inventory evidence + ranked treatment options

**Status: IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED — 2026-09-08.**

#### Purpose

An active `inventory/oversell` blocker no longer stops at a generic
**Source this item** instruction when trustworthy evidence can explain the
shortage and recommend a safer next treatment.

The implementation is advisory and read-only. It does not create stock,
change allocations, create purchasing work, execute a Decision Engine action,
or clear the inventory constraint.

#### Canonical authority

`constraints[]` remains blocker truth.

`inventoryAssist` is fresh read-time enrichment only. It may explain and
recommend against an active inventory target, but it may never create,
replace, hide or clear canonical blocker truth.

For each active inventory target:

- current-order demand is remaining unfulfilled `order_revenue_units`;
- available stock is aggregated from `inventory_truth` using the canonical
  `pickableLocationCondition`;
- `shortageQty = max(orderRemainingQty - pickableAvailableQty, 0)`;
- the active constraint `target_id` determines which variant may receive a
  treatment;
- stale assist data for a non-active variant is ignored;
- if an active blocked variant has no assist data, it safely falls back to
  **Source this item**.

No migration or constraint-row evidence snapshot was introduced.

#### Purchasing evidence

The assist read path also assembles:

- variant-wide open demand;
- committed inbound quantity;
- pending purchasing queue quantity;
- draft PO quantity;
- supplier option count.

These quantities have deliberately different meanings:

- committed inbound is **future supply**, not current availability;
- pending queue and draft PO quantities are **workflow state**, not stock;
- none of them may alter the canonical oversell verdict.

Shared purchasing-evidence helpers are also consumed by targeted Sourcing so
Order Detail and Sourcing do not independently redefine these quantities.

#### Ranked treatment contract

v1 returns exactly **one ranked treatment per assisted blocked variant**.

`rank=1` is best and `treatments[0]` is the recommendation presented to the
merchant.

| Treatment | Merchant label | Automation | Action |
|---|---|---|---|
| `wait_for_inbound` | Review incoming stock | Assist | `open_sourcing` |
| `continue_purchasing` | Continue purchasing | Assist | `open_sourcing` |
| `source_remaining` | Source N units | Assist | `open_sourcing` |
| `find_supplier` | Find a supplier | Assist | `open_sourcing` |
| `investigate_inventory` | Recheck inventory | Inform | none |

`open_sourcing` remains navigation-only and cannot enter Decision Engine
execution.

`investigate_inventory` is deliberately non-mutating. If fresh evidence no
longer agrees with a still-active blocker, the read path reports the mismatch
but does not reconcile or clear it.

#### v1 safety boundary

This slice does **not** perform or offer:

- automatic PO creation or reorder;
- inventory transfer;
- silent reallocation;
- substitution;
- cancellation;
- fulfillment-location changes;
- inventory movements or stock mutation.

Transfer is deliberately excluded from v1 treatment ranking because canonical
oversell availability already aggregates pickable stock shop-wide. Stock that
is already canonically usable is therefore already represented in the
shortage verdict.

#### Order Detail / GH-1053 integration

The scroll-free Order Detail modal keeps canonical truth and treatment
presentation separate:

- every active blocker remains visible in Plane C;
- matching inventory evidence appears beside the inventory blocker;
- evidence shows product / variant / SKU plus **Need / Available / Short**;
- treatment recommendation and action remain in the footer;
- multiple blocked variants remain independently actionable;
- customer-address remediation retains precedence over returned-package
  remediation, which retains precedence over inventory remediation;
- generic executable Decision Engine action remains the final fallback;
- Warehouse Status and Latest Activity remain visible.

#### Automated evidence

- inventory treatment assist integration: **10/10 passed**
- targeted Sourcing integration: **21/21 passed**
- existing inventory decision integration: **12/12 passed**
- inventory-specific frontend contract: **16/16 passed**
- GH-1053 + INV-TREAT frontend matrix: **4 suites / 50 tests passed**
- Jest ownership: `UNOWNED=0`, `MULTI_OWNED=0`
- backend production TSC: **0 total / 0 target**
- frontend production TSC: **19 pre-existing baseline / 0 target**
- test TSC: **1 pre-existing unrelated baseline / 0 target**
- static safety inspection found no inventory write, reconciliation, enqueue
  or Decision execution path in the assist services

#### Live browser evidence

The browser was certified with both frontend and backend running from the
`inv-treat-audit` worktree.

Order `#800002` showed:

- active **Out of Stock / oversell**;
- **Need 1 · Available 0 · Short 1**;
- **20 committed inbound**;
- recommended treatment **Review incoming stock**;
- Warehouse Status and Latest Activity visible without internal modal
  scrolling at the tested desktop size.

Selecting the recommendation opened targeted Sourcing with the blocked variant
and originating order preserved.

Sourcing still showed:

- open demand `1`;
- available `0`;
- inbound `20`;
- short now `1`;
- one order blocked.

Navigation therefore did not manufacture availability or resolve the
constraint.

Canonical inventory truth remains the sole resolution authority.

**INV-TREAT-01: IMPLEMENTED / AUTOMATED VERIFIED / LIVE VERIFIED.**


### 11.9 SLA-TREAT-01 — SLA urgency + execution treatment assistance

Implemented 2026-09-08.

#### Governing contract

`SLA-TREAT-01` combines four independent evidence families at read time:

- canonical fulfillment-SLA state;
- current warehouse execution state;
- active canonical blockers;
- truthful same-day carrier-pickup-time context.

The Decision Engine preserves these boundaries:

- a canonical constraint determines **what** must be resolved;
- SLA determines **how urgently** work should be attended to;
- CPT is contextual evidence only in this slice;
- merchant priority remains above SLA urgency;
- SLA or CPT can never release an order automatically;
- SLA or CPT can never bypass an active blocker;
- no treatment automatically claims work, scans inventory, completes packing,
  fulfills an order or performs carrier handoff.

#### Fresh fulfillment-SLA truth

Current SLA state is derived at read time rather than relying solely on a
persisted `order_age_snapshot`.

The canonical event-anchor precedence is:

1. `paid_at`;
2. `captured_at`;
3. `order_processed_at`;
4. `order_created_at`.

The existing shared SLA contract remains authoritative for thresholds:

- `normal`;
- `approaching`;
- `breached`.

`approaching` reuses the existing
`approachingFulfillmentSlaLeadSeconds()` / `isApproachingFulfillmentSla()`
semantics. No second SLA threshold was introduced.

Fulfilled and cancelled orders receive no active fulfillment-SLA treatment.

Persisted age snapshots remain valid historical/projection evidence, but a
stale snapshot cannot prevent an order from crossing a current SLA boundary.

#### Queue ordering invariant

Order Pool, release-selection and constrained-order ordering now preserve:

**merchant priority > SLA urgency > existing age/operator ordering**

Within the same merchant-priority band:

1. breached SLA;
2. approaching SLA;
3. normal / not-applicable;
4. existing final tie-break ordering.

SLA urgency therefore escalates work without crossing merchant-priority bands.

CPT is not an ordering key.

#### Warehouse execution assessment

Execution state is derived from `pick_batch_orders`, `pick_batches` and the
merchant idle threshold:

- `pending` → `waiting_for_pick`;
- `picking` → `picking_active` or `picking_stalled`;
- `pick_complete` → `waiting_for_pack`;
- `packing` → `packing_active` or `packing_stalled`;
- `pack_complete` → `warehouse_complete`.

Picking uses `pick_last_activity_at`; packing uses
`pack_last_activity_at`. Activity from one stage is never substituted for
another.

Operational stall uses the merchant-configured
`idle_alert_threshold_minutes` semantics already established by WMS idle
alerts:

- exactly at the threshold is not stalled;
- elapsed inactivity strictly greater than the threshold is stalled.

Missing activity or threshold evidence produces unknown/incomplete assessment
rather than a fabricated fallback.

The legacy revenue-intelligence `stalled_execution` classifier is not used for
operational Decision Engine treatment.

#### Blocker precedence and assistance

Active `order_constraints` remain the canonical blocker truth.

No synthetic `blocked_waiting` execution state was added.

If a blocker is active, existing blocker-specific remediation remains the
treatment target even when SLA urgency or warehouse stalling is also present.

Contextual warehouse assistance is navigation/read-model assistance only:

- released + urgent → review warehouse work;
- stalled picking owned by the current operator → continue picking;
- stalled picking owned by another operator → review warehouse work;
- picked + urgent → open packing;
- stalled packing → open packing;
- active picking/packing → show urgency without an extra interruptive CTA;
- warehouse complete → no warehouse treatment.

Existing address, inventory-sourcing, returned-package and generic
Decision Engine remediation contracts remain authoritative.

#### CPT boundary for this slice

`daily_cpt_local` and the shop timezone are used only for truthful same-day
context:

- `not_configured`;
- `before_cutoff`;
- `cutoff_reached`;
- `unknown`.

This slice does not infer:

- tomorrow's pickup;
- weekends or carrier holidays;
- carrier-specific pickup schedules;
- transit time;
- delivery ETA;
- customer-delivery promise;
- a CPT-approaching threshold;
- per-order pickup commitment.

Existing Order Flow CPT buckets are not treated as canonical Decision Engine
pickup truth.

Full pickup-policy and customer-promise reasoning remain deferred to:

- `SHIP-INTENT-01` — canonical Shopify shipping-intent convergence;
- `CARRIER-NORM-01` — provider / physical-carrier / service normalization;
- `CPT-POLICY-01` — next valid pickup opportunity and policy hierarchy;
- `PROMISE-01` — latest-safe-dispatch and customer-promise risk.

#### Read model and refresh

The assessment is composed through the existing order-detail read path rather
than a new endpoint, worker or persisted workflow state.

Order Detail receives additive `slaTreatment` evidence and assistance.

Time-sensitive state remains server-authoritative. While Order Detail is open,
the frontend refreshes approximately every 30 seconds rather than recreating
SLA, stall or CPT rules client-side.

No schema migration was required.

#### Automated verification

Verified contracts include:

- backend SLA-treatment unit coverage: 6 passing tests;
- frontend SLA ordering, refresh and Order Detail behavior: 23 passing tests;
- real-DB `SLA-TREAT-01` integration coverage: 4 passing tests;
- neighboring SLA Decision Engine / consumer contracts: 7 passing tests;
- backend TypeScript: 0 errors;
- frontend TypeScript: existing 19-error baseline, 0 errors in modified
  `SLA-TREAT-01` target files.

The integration harness used disposable `synchroflow_test_*` databases and
confirmed cleanup after execution.

Known harness noise remains the existing Jest `--forceExit` /
post-test asynchronous logging behavior; it did not fail the verified suites.

**SLA-TREAT-01: IMPLEMENTED / AUTOMATED VERIFIED.**

Live browser / production certification is intentionally not claimed by this
entry.
