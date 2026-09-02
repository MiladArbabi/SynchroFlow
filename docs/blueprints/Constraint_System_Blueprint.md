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

#### Inventory demand aggregation invariant — corrected 2026-08-10 / INV-RES-01 supporting fix

Order demand and physical inventory have different cardinalities.

An order may contain one demand row for a variant while
`inventory_truth` contains several rows for that same variant because
stock exists at multiple physical locations.

Demand must therefore be aggregated **before** joining location-level
inventory.

Canonical evaluation order:

```text
order_revenue_units
→ calculate remaining demand
→ aggregate remaining demand by lasyncro_variant_id
→ one demand row per variant
→ join inventory_truth
→ aggregate pickable available inventory across active locations
→ compare supply against demand
```

Forbidden pattern:

```text
raw demand rows
→ join every inventory_truth location
→ SUM(demand after join)
```

That pattern multiplies required quantity by inventory-location
cardinality.

Example:

```text
real remaining demand = 6
matching inventory_truth rows = 3

incorrect post-join SUM:
6 + 6 + 6 = 18
```

The required quantity must remain:

```text
6
```

regardless of whether the stock exists in one location or ten.

**Invariant:**

> The number of physical inventory locations must never change an
> order's required quantity.

This is particularly important for split-location reservation because
multi-location stock is a valid fulfillment source and must not create
a false `oversell` constraint.

#### Single shortage definition — ratified 2026-09-02 / ORD-DECISION-01 Slice 2

There is exactly **one** definition of "is this variant short?" in the
system: `evaluateInventoryConstraint`
(`apps/backend/src/services/constraints/evaluators/inventoryConstraintEvaluator.ts`).

Every consumer that needs a shortage verdict must call it. No caller may
restate the comparison in its own query.

The canonical contract is:

- demand is **remaining unfulfilled demand**
  (`SUM(quantity - fulfilled_quantity)`), never the original ordered
  quantity;
- supply is the **aggregate** `available_quantity` summed across
  canonical **pickable** locations only;
- **non-pickable stock cannot satisfy demand** — quarantine and other
  non-pick zones are excluded by the canonical
  `pickableLocationCondition` predicate;
- `isActive = available < remaining`, evaluated **per variant**, and the
  emitted constraint is variant-scoped via `target_id`.

**Legacy handler now reuses the evaluator.**
`resolve_inventory_block.handler.ts` previously carried its own shortage
query. That second definition was wrong on all three axes and is
removed:

| Axis | Old local query | Canonical evaluator |
|---|---|---|
| Demand | `order_line_items.quantity` (original) | remaining unfulfilled demand |
| Aggregation | one row **per inventory location**, ungrouped | `SUM` over pickable locations |
| Pickability | every `inventory_truth` row counted | pickable locations only |

Concretely, a variant holding 0 at the warehouse root and 7 in pick bin
`A-1` produced a row of `0` under the old query, which the shortage
filter read as a shortage while seven pickable units sat on the shelf.

**Invariant:**

> A second shortage definition is a defect, not an optimisation. If a
> caller needs a shortage verdict it calls `evaluateInventoryConstraint`.

#### Natural resolution — no manual dismissal

An inventory constraint is **never** manually cleared.

Resolution is a lifecycle outcome: when legitimate pickable stock
becomes sufficient, the next evaluation pass computes `isActive = false`
and `projectOrderConstraints` writes the resolution
(`is_active = false`, `resolved_at` set). Nothing else may resolve it.

In particular:

- navigating the merchant to Sourcing does **not** clear the constraint;
- returning from Sourcing does **not** clear the constraint;
- no UI action writes `order_constraints` directly.

The constraint clears when, and only when, the stock is really there.

#### Action → required active constraint (stale-decision defence)

`decisions` is enrichment; `order_constraints` is truth. A decision
recommending `resolve_{type}_block` is **stale** the moment its required
constraint type has no active rows for that order.

Both the read path and the write path resolve this through one shared
map,
`apps/backend/src/domain/decision/decisionConstraintRequirements.ts`:

| Action | Required active constraint |
|---|---|
| `resolve_inventory_block` | `inventory` |
| `resolve_customer_block` | `customer` |
| `resolve_operational_block` | `operational` |
| `open_return_job` | `operational` |

An action **absent** from this map has no prerequisite and is always
executable. That default is deliberate — it is what keeps
`proceed_fulfillment` and every other existing action unchanged.

Consumers:

- `GET /api/v1/orders/:orderId/decision` — elects the first non-stale
  candidate in priority order (behaviour unchanged; the map moved out of
  the controller);
- `POST /api/v1/orders/:orderId/execute` — same election, so a stale
  decision can no longer be queued. Previously this route took the
  top-priority pending decision unconditionally, so an order whose block
  had already cleared naturally could still be executed with `202` while
  the read model correctly refused to surface it.

**Invariant:**

> Read validity and execute validity answer the same question from the
> same map. Adding an action to that map makes it stale-checked on both
> paths at once.

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
