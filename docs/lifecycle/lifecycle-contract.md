# LIFECYCLE ARCHITECTURE BLUEPRINT

**SynchroFlow — Canonical Lifecycle Contract (v3)**

---

# 1. PURPOSE

Lifecycle represents **proven system state**, not intent.

It answers:

> What level of system maturity has this shop demonstrably reached?

Lifecycle must be:

* Deterministic
* Replay-safe
* Append-only
* Event-driven
* Causally correct
* Transactionally safe
* Projection-independent for preconditions

---

# 2. PHASE MODEL

```text
FT_MINUS_ONE → FT0 → FT1 → FT2
```

| Phase        | Meaning                      | Source of Truth         |
| ------------ | ---------------------------- | ----------------------- |
| FT_MINUS_ONE | Default state (no readiness) | Absence of events       |
| FT0          | Commerce pipeline proven     | lifecycle/ft0_completed |
| FT1          | System readiness achieved    | system_readiness_state  |
| FT2          | User-confirmed activation    | lifecycle/ft2_confirmed |

Lifecycle is:

* Shop-scoped for durability facts
* Snapshot projected per shop (unique by shop_id)
* Audited per transition

---

# 3. CANONICAL EVENT CONTRACT

All lifecycle advancement must originate from immutable domain events.

## Valid Lifecycle Events

| Event Type                        | Emitted By           | Meaning                            |
| --------------------------------- | -------------------- | ---------------------------------- |
| lifecycle/first_insight_delivered | FirstInsightService  | First insight event fact           |
| lifecycle/ft0_completed           | FT0CompletionService | Commerce → Insight pipeline proven |
| lifecycle/ft2_confirmed           | Lifecycle controller | Explicit user confirmation         |

No other component may emit lifecycle events.

---

# 4. HARD WRITE AUTHORITY RULE

Lifecycle mutation allowed ONLY from:

1. FT0CompletionService
2. FT2 Confirm endpoint

Forbidden layers:

* OAuth
* Webhooks
* Sync ingestion
* Controllers (except FT2)
* Background ingestion
* Projections
* External events

Violation corrupts onboarding invariants.

---

# 5. FT0 CONTRACT (System Readiness Gate)

## FT0 Preconditions (ALL REQUIRED)

1. Integration exists
2. Integration sync_status = COMPLETED
3. Orders count ≥ 1
4. `domain_events` contains lifecycle/first_insight_delivered

**Critical Rule**

FT0 must depend on canonical event log — never on projected state.

Correct:

```sql
SELECT id
FROM domain_events
WHERE shop_id = ?
AND event_type = 'lifecycle/first_insight_delivered';
```

Forbidden:

```sql
shops.first_insight_delivered
```

Reason:
Projection is asynchronous.
Lifecycle must not depend on projection latency.

---

# 6. TRANSITION CONTRACT

Allowed transitions ONLY:

```
FT_MINUS_ONE → FT0
FT0 → FT1
FT1 → FT2
```

Enforced by:

```ts
const AUDITABLE_TRANSITIONS = new Set([
  'FT_MINUS_ONE->FT0',
  'FT0->FT1',
  'FT1->FT2',
]);
```

Any other transition:

* Throws
* Logs
* Hard fails

No silent repair.
No implicit jumps.
No downgrade allowed.

---

# 7. WRITE PATH

All lifecycle transitions go through:

```
LifecycleTransitionService.auditIfTransitioned()
```

Atomic writes inside transaction:

1. lifecycle_audit_events (ledger)
2. lifecycle_events (v2 backbone)
3. user_lifecycle_snapshot (projection)

---

# 8. LEDGER TABLES

## lifecycle_audit_events (immutable ledger)

Tracks transitions.

Columns:

* event_id
* shop_id
* user_id
* from_phase
* to_phase
* occurred_at

Uniqueness:

```
(shop_id, from_phase, to_phase)
```

Prevents duplicate transitions.

---

## lifecycle_events (v2 backbone)

Append-only lifecycle log.

Purpose:
Future-proof read switch.
Supports layered model.

---

## user_lifecycle_snapshot (projection)

Projection of current lifecycle phase.

Uniqueness boundary:

```
shop_id
```

Snapshot must NEVER be written directly.

Only via LifecycleTransitionService.

---

# 9. PROJECTION RULES

Lifecycle projection must:

* Run inside transaction
* Lock projection cursor
* Enforce monotonicity
* Advance cursor atomically
* Fail hard on regression

Cursor isolation:

```
orders_projection
lifecycle_projection
```

They must NEVER share a cursor.

---

# 10. CAUSALITY RULES

Event → Projection → Snapshot

Never:

Projection → Event → Snapshot

Never:

Read projected state to gate synchronous event emission.

FT0 fix enforced this invariant.

---

# 11. MEMBERSHIP PROJECTION

When a new user joins a shop:

LifecycleProjectionService:

1. Read shop durability state
2. Replay sequential transitions:

   * FT0
   * FT1
   * FT2 (if eligible)

Must:

* Run inside existing transaction
* Use LifecycleTransitionService
* Be idempotent
* Never infer state

---

# 12. IDEMPOTENCY RULES

Every emission must check canonical event log before emitting.

Example:

```ts
const existingEvent = await db('domain_events')
  .where({ shop_id, event_type })
  .first();
```

Never rely on projection flags for idempotency.

---

# 13. FAILURE HANDLING

Projection errors:

* MUST NOT be swallowed
* MUST throw
* MUST nack message
* MUST halt replay

Lifecycle must be deterministic under full rebuild.

---

# 14. REPLAY SAFETY

Full rebuild from domain_events must produce identical:

* lifecycle_audit_events
* lifecycle_events
* user_lifecycle_snapshot

No external state allowed.

No time-based logic.
Only domain_events.event_time.

---

# 15. OPERATIONAL SIGNALS

Every blocked FT0 must log:

```
[FT0][BLOCKED][REASON]
```

Every invalid transition must log:

```
[LIFECYCLE][INVALID_TRANSITION]
```

No silent blocking.

---

# 16. WHAT IS FORBIDDEN

* Direct snapshot mutation
* Lifecycle repair scripts
* Conditional phase jumps
* Multiple cursors per stream
* Shared cursors between projections
* Projection-based gating
* Runtime DB patches instead of migration fixes

---

# 17. DETERMINISTIC FLOW (FINAL STATE)

Correct lifecycle progression:

1. orders/sync → order written
2. FirstInsightService emits lifecycle/first_insight_delivered
3. FT0CompletionService checks canonical event log
4. Emits lifecycle/ft0_completed
5. Projection applies FT_MINUS_ONE → FT0 → FT1
6. User confirms → lifecycle/ft2_confirmed
7. Projection applies FT1 → FT2

Final snapshot:


shop_id | phase
--------|------
   X    | FT2

---

# 18. CORE PRINCIPLE

Lifecycle must reflect:

> Proven durability facts emitted as immutable events.

Never projections.
Never flags.
Never assumptions.
Never inferred readiness.

Events are truth.
Projection is view.

---

Lifecycle contract is now causally correct, replay-safe, and deterministic.
