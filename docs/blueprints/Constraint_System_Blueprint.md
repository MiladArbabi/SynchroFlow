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

constraint_id = uuidv5(`${type}:${orderId}:${targetId}`, NAMESPACE)

---

### 3. One Active Constraint Per Type

Enforced by DB:

UNIQUE (lasyncro_order_id, constraint_type, target_id)
WHERE is_active = true

Implication:

- Multiple historical records allowed
- Only ONE active per type PER TARGET — variant-scoped types (inventory) can have several simultaneous active constraints across different `target_id` values on the same order; order-level types (customer, operational) use `target_id = null`, so still effectively one active row.

**Corrected 2026-06-26:** this section previously described a stricter single-active-per-type model the schema doesn't enforce (see migration `20260320124601_0070_create_order_constraints.ts`, `uniq_active_constraint_per_scope`). Real schema drift, not a simplification.

---

### 4. No Lifecycle Diffing in Code

Do NOT:

- compare previous vs next state
- track transitions manually

Instead:

- rely on `is_active`
- use `started_at` / `resolved_at` as simple timestamps

---

### 5. Read Model Consistency

ALL reads must use:

order_constraints

NEVER:

- `order_fulfillment_status.*_block_type`
- derived booleans from legacy fields

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

- Source: inventory projection
- Example block types:

  - `oversell`
  - `allocation_pending`

---

### Customer

- Source: `orders.shipping_address1` / `shipping_city` / `shipping_zip` / `shipping_country_code` completeness
- Example block types:

  - `incomplete_address`

**Corrected 2026-06-25:** this section previously said "order/payment state" with example `awaiting_payment`. That's not achievable in this system — laSyncro only ever receives the Shopify `orders/paid` webhook; draft (pre-payment) orders are never visible here, so there is no payment-pending state to detect. The evaluator was also found to still read the forbidden legacy field `ofs.customer_block_type` (see "❌ Legacy Reads" below) — fixed in `customerConstraintEvaluator.ts` the same day. Address completeness is the correct, durable, derivable signal for this constraint type.

**Known limitation:** no `requires_shipping`/pickup-order concept exists anywhere in this codebase. A genuine Shopify local-pickup order (no shipping address by design) would currently be misflagged as `incomplete_address`. Not fixed — flagged honestly pending a real signal if/when pickup orders become relevant.

---

### Operational

- Source: unresolved `pick_exceptions` rows joined via `order_line_items` — physical pick/pack blockers (item missing, short pick, product/packaging defect, wrong item)
- Example block types:

  - `pick_item_missing`
  - `pick_short`
  - `product_defect`
  - `packaging_defect`
  - `pick_wrong_item`

**Corrected 2026-06-26:** previously said `sla_breach`. The evaluator's own comment explicitly forbids this — shipping-SLA breach is a TIME signal owned exclusively by `order_age_snapshot.is_shipping_sla_breached`; re-deriving it here would create two identical signals on the same orders. Operational is a PHYSICAL-blocker signal, orthogonal to age. See `operationalConstraintEvaluator.ts`.

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
    target_id: targetId, // null for order-level types; required for variant-scoped types — corrected 2026-06-26, previously omitted
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

// NOTE (corrected 2026-06-26): for variant-scoped types (inventory), this
// generic example returns only ONE of potentially several active rows
// across different target_id values — add target_id to the where() when
// checking a specific variant. For order-level types (customer,
// operational), target_id is always null and this example is complete.
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

- `order_constraints`
- `order_fulfillment_status`

---

### ❌ Legacy Reads

ofs.inventory_block_type
ofs.customer_block_type

---

### ❌ Recomputing Constraints Outside Projections

- No duplication of logic in workers/services
- Evaluators must be read-only or minimal

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

- `[CONSTRAINT_ACTIVE]`
- `[CONSTRAINT_RESOLVED]` (optional)
- `[PRIORITY_ORDER]`
- `[PRIORITY_BREAKDOWN]`

---

## Migration Guarantees (Achieved)

- No legacy column reads
- No legacy column writes
- Deterministic rebuild
- Idempotent projections
- Consistent prioritization

---

## Future Work (Optional)

- Drop `*_block_type` columns from DB
- Remove `order_fulfillment_status` entirely
- Add constraint analytics (duration, frequency)
- Multi-constraint prioritization tuning

---

## Final Truth

This system works because:

> **Constraints are no longer implicit behavior — they are explicit data**

Break that principle, and the system will drift again.
