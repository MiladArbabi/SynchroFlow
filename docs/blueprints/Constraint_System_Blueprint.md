# Constraint System Blueprint (v2 — Unified Model)

## Overview

The constraint system is the **single source of truth** for all blocking conditions affecting order processing.

It replaces:

- `*_block_type` columns
- scattered evaluator logic
- implicit business rules in projections

All constraints are now:
> **explicit, normalized, deterministic, and replay-safe**

---

## Core Principles

### 1. Single Source of Truth

All constraints MUST be stored in:



order_constraints

No other table is allowed to:

- store constraint state
- derive constraint truth
- act as fallback

---

### 2. Deterministic Writes

All projections must:

- compute constraint state deterministically
- write using **idempotent upsert pattern**

**Pattern:**

update → insert if missing
`

**Constraint identity:**


constraint_id = uuidv5(`${type}:${orderId}`, NAMESPACE)


---

### 3. One Active Constraint Per Type

Enforced by DB:


UNIQUE (lasyncro_order_id, constraint_type)
WHERE is_active = true


Implication:

* Multiple historical records allowed
* Only ONE active per type

---

### 4. No Lifecycle Diffing in Code

Do NOT:

* compare previous vs next state
* track transitions manually

Instead:

* rely on `is_active`
* use `started_at` / `resolved_at` as simple timestamps

---

### 5. Read Model Consistency

ALL reads must use:


order_constraints


NEVER:

* `order_fulfillment_status.*_block_type`
* derived booleans from legacy fields

---

## Data Model

### Table: `order_constraints`

| Column            | Description                                            |
| ----------------- | ------------------------------------------------------ |
| constraint_id     | deterministic UUID (v5)                                |
| lasyncro_order_id | order identifier                                       |
| constraint_type   | `inventory`, `customer`, `operational`, ...            |
| block_type        | specific reason (`oversell`, `awaiting_payment`, etc.) |
| is_active         | boolean                                                |
| started_at        | when activated                                         |
| resolved_at       | when resolved                                          |
| created_at        | insert timestamp                                       |

---

## Constraint Types

### Inventory

* Source: inventory projection
* Example block types:

  * `oversell`
  * `allocation_pending`

---

### Customer

* Source: order/payment state
* Example block types:

  * `awaiting_payment`

---

### Operational

* Source: SLA evaluator
* Example block types:

  * `sla_breach`

---

## Write Contract (MANDATORY)

Every constraint projection MUST:

### 1. Compute block type


let blockType: string | null = ...


---

### 2. Perform update


await trx('order_constraints')
  .where({ lasyncro_order_id, constraint_type })
  .update({
    block_type: blockType,
    is_active: !!blockType,
    resolved_at: blockType ? null : new Date()
  });


---

### 3. Insert if missing


if (updated === 0) {
  await trx('order_constraints').insert({
    constraint_id,
    lasyncro_order_id,
    constraint_type,
    block_type: blockType,
    started_at: blockType ? new Date() : null,
    resolved_at: blockType ? null : new Date(),
    is_active: !!blockType,
    created_at: new Date()
  });
}


---

### 4. Logging (optional, non-authoritative)


if (blockType) {
  console.debug('[CONSTRAINT_ACTIVE]', { orderId, blockType });
}


---

## Read Contract (MANDATORY)

All consumers MUST read like this:


const constraint = await trx('order_constraints')
  .where({
    lasyncro_order_id: orderId,
    constraint_type: 'inventory',
    is_active: true
  })
  .first();


Derived:


isBlocked = !!constraint
blockType = constraint?.block_type ?? null


---

## Priority Model

Priority is computed **dynamically**, not stored.

Example:

sql
CASE
  WHEN operational:sla_breach THEN 0
  WHEN inventory:oversell THEN 1
  WHEN customer:awaiting_payment THEN 2
  ELSE 99
END

---

## Dispatcher Contract

Dispatcher MUST:

1. Lock intents WITHOUT joins
2. Join constraints AFTER locking
3. Compute priority via `order_constraints`
4. Never rely on legacy fields

---

## Forbidden Patterns

### ❌ Dual Writes

Writing to both:

* `order_constraints`
* `order_fulfillment_status`

---

### ❌ Legacy Reads


ofs.inventory_block_type
ofs.customer_block_type


---

### ❌ Recomputing Constraints Outside Projections

* No duplication of logic in workers/services
* Evaluators must be read-only or minimal

---

### ❌ Lifecycle Diffing


if (!prev && next) ...


This is obsolete.

---

## Allowed Extensions

To add a new constraint:

1. Define new `constraint_type`
2. Add projection
3. Follow write contract
4. Update priority mapping if needed

No schema changes required.

---

## Observability

Recommended logs:

* `[CONSTRAINT_ACTIVE]`
* `[CONSTRAINT_RESOLVED]` (optional)
* `[PRIORITY_ORDER]`
* `[PRIORITY_BREAKDOWN]`

---

## Migration Guarantees (Achieved)

* No legacy column reads
* No legacy column writes
* Deterministic rebuild
* Idempotent projections
* Consistent prioritization

---

## Future Work (Optional)

* Drop `*_block_type` columns from DB
* Remove `order_fulfillment_status` entirely
* Add constraint analytics (duration, frequency)
* Multi-constraint prioritization tuning

---

## Final Truth

This system works because:

> **Constraints are no longer implicit behavior — they are explicit data**

Break that principle, and the system will drift again.