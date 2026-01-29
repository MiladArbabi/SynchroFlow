# 🧭 Canonical Queue & Worker Execution Playbook

**Source of Truth — v1.1 (Enforced)**

---

## 0. Why This Exists (Blunt Version)

SMBs don’t pay for epistemic purity.
They pay for **answers that line up with reality**.

This playbook ensures:

* No silent gaps
* No misleading zeros
* No broken metrics
* No “why is this empty?” moments

Truth may be **observed or assumed**, but it is **never missing**.

---

## 1. Core Principles (Locked)

### 1.1 Canonical-First Truth (Unchanged)

* No execution without canonical identity
* Canonical identity is resolved **before** execution
* Canonical identity is never inferred downstream

---

### 1.2 Single-Writer Rule (Expanded)

Every stateful table has **one and only one writer**.

| Table                        | Authorized Writer                     |
| ---------------------------- | ------------------------------------- |
| `integration_webhook_events` | Webhook Ledger Service                |
| `canonical_orders`           | Canonical Ingestion Workers           |
| `order_fulfillment_status`   | **Fulfillment Reconciliation System** |

> **Important update:**
> “Observed” and “synthetic” executions are still written by the **same system**.

No other service may touch execution state.

---

### 1.3 Fail-Closed (Clarified)

| Condition            | Action         |
| -------------------- | -------------- |
| Missing canonical ID | Retry          |
| Missing execution    | **Synthesize** |
| Invariant breach     | Fail + DLQ     |
| Duplicate            | No-op          |

**Absence is not allowed to leak to users.**

---

## 2. End-to-End Pipeline (Actual)

```
External Platform
   ↓
Webhook Handler (NO domain writes)
   ↓
integration_webhook_events  ← ledger
   ↓
Queue (durable boundary)
   ↓
Reconciliation Consumer
   ↓
order_fulfillment_status
   ↓
Facts → FT2 → UI
```

**Synthetic execution lives here intentionally.**

---

## 3. Ledger: `integration_webhook_events`

*No change — this part is solid.*

Key reminder:

* Ledger ≠ execution
* Ledger is replayable forever
* Ledger proves what happened

---

## 4. Queue Contract (Enforced)

### 4.1 Queue Naming

Queues describe **intent**, not payload:

```
fulfillment.reconciliation
```

---

### 4.2 Message Shape (Final)

```json
{
  "canonicalOrderId": "gid://shopify/Order/123"
}
```

* IDs only
* No payload duplication
* Idempotent by design

---

### 4.3 Retry Rules

* Retry = same message
* Max attempts configurable
* Poisoned messages → DLQ
* Consumer must be safe to replay

---

## 5. Fulfillment Reconciliation System (Reference Standard)

This is now the **canonical pattern**.

### 5.1 What This System Owns

* Execution completeness
* Synthetic backfill
* Consistency guarantees

It does **not**:

* Interpret business meaning
* Decide “success”
* Modify canonical data

---

## 6. Synthetic Execution (Critical Addition)

### 6.1 Why Synthetic Execution Exists

Reality:

* Platforms do not guarantee fulfillment events
* SMBs still expect revenue to add up
* Missing rows destroy trust and monetization

Therefore:

> **Every canonical order must have exactly one execution row.**

---

### 6.2 Execution Classification Model

Stored on `order_fulfillment_status`:

| Column                 | Meaning                  |
| ---------------------- | ------------------------ |
| `execution_source`     | `observed` | `synthetic` |
| `execution_confidence` | `certain` | `assumed`    |
| `synthetic_reason`     | Why assumption exists    |
| `synthetic_created_at` | When it was synthesized  |

This preserves honesty **without breaking UX**.

---

### 6.3 Execution States (DB-Enforced)

Synthetic rows must use **valid platform states**:

* `processing` (default synthetic)
* `fulfilled`
* `delivered`

🚫 Never invent new states.

---

## 7. Reconciliation Worker (Final Contract)

### 7.1 Responsibilities (Exact)

For **each canonical order**:

1. Check execution row
2. If observed → noop
3. If synthetic → replace if needed
4. If missing → insert synthetic
5. Enforce DB invariants

That’s it.

---

### 7.2 Handler (Authoritative Logic)

```ts
reconcileOrderFulfillment(canonicalOrderId)
```

Rules:

* Observed beats synthetic
* Synthetic beats null
* Null is forbidden

---

### 7.3 Batch Worker

Used for:

* Backfill
* Migrations
* Repair jobs

```ts
runFulfillmentReconciliationBatch(limit)
```

Runs serially by design.

---

### 7.4 Queue Consumer

* Prefetch capped (DB safety)
* Idempotent
* Ack only on success
* DLQ on invariant breach

---

## 8. Database Is the Final Judge

### 8.1 Mandatory Constraints

```sql
canonical_order_id NOT NULL
UNIQUE (canonical_order_id)
CHECK (execution_source IN ('observed','synthetic'))
CHECK (execution_confidence IN ('certain','assumed'))
```

If the DB allows bad state → the system is lying.

---

### 8.2 Migration Rule (Reinforced)

* Backfill first
* Enforce second
* Never weaken constraints for convenience

Your failed migrations were **correct behavior**.

---

## 9. Revenue & Metrics Implication (Why This Matters)

Because of reconciliation:

```sql
SUM(fulfilled) + SUM(unfulfilled) = SUM(total)
```

This is now **always true** under execution coverage.

This unlocks:

* Revenue Overview
* Cash-at-risk
* Pipeline value
* Monetizable dashboards

---

## 10. Acceptance Criteria (Unchanged, Now Achieved)

A pipeline is valid only if:

* Queue drains
* Consumer active
* Ledger processed
* Execution rows complete
* Synthetic accounted for
* No NULL leaks to FT2

You verified all of these.

---

## 11. Final Rule (Very Important)

If a future engineer says:

> “But this is only synthetic…”

They are missing the point.

**Synthetic execution is not a lie.
Missing execution is.**

---

## Status

✅ Reconciliation system
✅ Queue wired
✅ Consumer live
✅ DB enforced
✅ UI consistent
✅ Revenue reconciles

**Lock this playbook. Use it everywhere.**