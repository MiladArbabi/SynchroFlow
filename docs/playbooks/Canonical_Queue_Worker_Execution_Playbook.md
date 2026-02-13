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
* Canonical identity includes **product and variant resolution**, not just orders

---

### 1.2 Single-Writer Rule (Expanded)

Every stateful table has one and only one logical writer.

Exception:
- Database constraints and indexes may enforce invariants
- But may never substitute for application-level identity resolution

| Table                        | Authorized Writer                     |
| ---------------------------- | ------------------------------------- |
| `integration_webhook_events` | Webhook Ledger Service                |
| `canonical_orders`           | Canonical Ingestion Service           |
| `canonical_order_line_items` | Canonical Commerce Ingestion Service  |
| `canonical_products`         | Product Ingestion Worker              |
| `canonical_variants`         | Product Ingestion Worker              |
| `order_fulfillment_status`   | **Fulfillment Reconciliation System** |

> **Important update:**
> “Observed” and “synthetic” executions are still written by the **same system**.

No other service may touch execution state.

---

### 1.3 Fail-Closed (Clarified)

| Condition                                 | Action           |
| ----------------------------------------- | ---------------- |
| Missing canonical order ID                | Retry            |
| Missing canonical product / variant | Block FT2 AND execution attribution |
| Missing execution                         | **Synthesize**   |
| Invariant breach                          | Fail + DLQ       |
| Duplicate                                 | No-op            |

**Absence is not allowed to leak to users.**

---

## 2. End-to-End Pipeline (Actual)

External Platform
   ↓
GraphQL / REST Sync
   ↓
Product Ingestion Queue
   ↓
Product Ingestion Worker
   ↓
canonical_products + canonical_variants
   ↓
Canonical Commerce Ingestion
   ↓
canonical_orders + canonical_order_line_items
   ↓
integration_webhook_events  ← ledger
   ↓
Reconciliation Queue
   ↓
Reconciliation Consumer
   ↓
order_fulfillment_status
   ↓
Facts → FT2 → UI

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

### 4.4 Product Ingestion Queue (NEW · ENFORCED)

Queue:
product_ingestion

Message shape:

```json
{
  "shopId": 2,
  "platform": "shopify",
  "rawProduct": { ... }
}
Rules:

Product ingestion is fire-and-forget
No retries at FT2 level
Identity errors block downstream eligibility
Product ingestion must complete AND commit canonical identity
before:
- Canonical commerce ingestion
- FT2 evaluation
- Any execution attribution

Queue receipt is NOT sufficient.
Transaction commit with canonical identity is required.

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

⚠️ Synthetic execution does NOT:

* Create canonical products
* Create canonical variants
* Repair order → product joins
* Backfill canonical identity

Synthetic execution only ensures execution completeness.
Identity completeness is a separate, mandatory prerequisite.

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

### Obligation Flags (L2)

Stored on `order_fulfillment_status`:

| Column | Meaning |
|------|--------|
| `has_inventory_block` | Inventory prevents fulfillment |
| `has_customer_block` | Customer action required |
| `has_operational_block` | Internal ops required |
| `has_other_block` | Reserved / future |

Semantics:

* TRUE  → obligation exists
* FALSE → obligation evaluated and cleared
* NULL  → not yet evaluated (epistemic unknown)

⚠️ Obligation flags do NOT affect execution state.
They annotate execution with unblockable causes.

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

Explicitly does NOT:

* Resolve product identity
* Resolve variant identity
* Mutate canonical_order_line_items

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

### Partial Index Safety Rule (NEW)

PostgreSQL rules enforced by incident:

- UNIQUE INDEX ≠ UNIQUE CONSTRAINT
- Partial uniqueness (WHERE ...) CANNOT be promoted to a constraint
- ON CONFLICT ON CONSTRAINT will FAIL silently in ORMs
- ORMs do NOT introspect partial indexes

Therefore:
- Partial identity MUST be expressed explicitly in queries
- Conflict predicates MUST match index predicates exactly
- All partial identity assumptions MUST be proven with raw SQL

Violation of this rule causes:
- Silent rollbacks
- Missing ingestion events
- False FT2 blockers

---

## 9. Revenue & Metrics Implication (Why This Matters)

Because of reconciliation:

```sql
SUM(fulfilled) + SUM(unfulfilled) = SUM(total)
```

Important dependency:

Revenue correctness requires **identity correctness**.

If canonical_order_line_items lack lasyncro_product_id:

* Revenue units may exist
* Execution may be complete
* FT2 must still block

Revenue truth is meaningless without identity truth.

This is now **always true** under execution coverage.

This unlocks:

* Revenue Overview
* Cash-at-risk
* Pipeline value
* Monetizable dashboards

### Obligation Coverage vs Classification

Coverage answers:
> “Did we evaluate this obligation?”

Classification answers:
> “Do we know which obligation it is?”

It is valid (and expected) to have:

* 100% coverage
* 0% classification

This is epistemic honesty, not system failure.

---

## 10. Acceptance Criteria (Unchanged, Now Achieved)

A pipeline is valid only if:

* Queue drains
* Consumer active
* Ledger processed
* Execution rows complete
* Synthetic accounted for
* No NULL leaks to FT2
* No orphaned canonical_order_line_items
* Product ingestion completed before FT2 evaluation

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