# Canonical Products Playbook

**Location:** `docs/playbooks/canonical-products.md`

---

## Purpose

This document defines the **canonical product architecture** used across the SynchroFlow platform.

It exists to ensure that:

* Orders, line items, products, and variants are **consistently joinable**
* FT2 eligibility is **deterministic and enforceable**
* No engineer introduces **silent identity corruption**
* All ingestion, reconciliation, and evaluation layers operate on the **same canonical truth**

This is not an overview.
This is a **contract**.

---

## Core Principles (Non-Negotiable)

1. **Products are anchors, variants are edges**
   (anchors are enforced via `canonical_product_anchor_id`)
2. **Variants never exist without products**
3. **Orders join to products ONLY via variants**
4. **Canonical identity is resolved at ingestion time**
5. **No inference, no synthesis, no late binding**
6. **Canonical Variant Code (CVC) is the only SKU-level identifier**
7. **CVC is written once at ingestion and never inferred or mutated**

8. **Product ingestion participates in the Canonical Queue & Worker Execution Contract**

Product identity is not considered valid unless:
- The product ingestion worker executed
- The transaction committed
- Canonical rows exist in the database

Queue receipt, logs, or handler execution alone are insufficient.

See:
→ Canonical Queue & Worker Execution Playbook, §4.4 Product Ingestion Queue
→ Canonical Queue & Worker Execution Playbook, §10 Acceptance Criteria

If any of these are violated, downstream systems (FT2, revenue units, trust modules) **must fail**.

---

0. Verify product ingestion execution path:

Confirm:
- product_ingestion queue received messages
- Product Ingestion Worker started
- Handler entered
- Transaction committed
- canonical_products rows exist

If any step is missing:
STOP — do not debug joins, FT2, or revenue.

See:
→ Canonical Queue & Worker Execution Playbook, §2 Transport & Execution Scan
→ Canonical Queue & Worker Execution Playbook, §10 Acceptance Criteria

---

0.1 Verify product anchor uniqueness is enforced correctly:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'canonical_products';

Confirm:

A UNIQUE INDEX exists

It includes WHERE platform_variant_id IS NULL

If not present or mismatched → STOP.
Product ingestion cannot work.
This would have caught the issue immediately.

---

## Canonical Tables Overview

### 1. `canonical_products`

**Purpose:**
Represents the *product-level anchor* for all commerce activity.

**Schema highlights:**

| Column                 | Meaning                           |          |           |
| ---------------------- | --------------------------------- | -------- | --------- |
| `canonical_product_id` | Internal numeric PK (DB-assigned) |          |           |
| `shop_id`              | Tenant boundary                   |          |           |
| `platform`             | Source platform (`shopify`)       |          |           |
| `platform_product_id`  | Platform product GID              |          |           |
| `platform_variant_id`  | **NULL for product rows**         |          |           |
| `sku`                  | Optional                          |          |           |
| `title`                | Required                          |          |           |
| `status`               | `active                           | inactive | archived` |

**Invariants:**

* Exactly **one product anchor row per**:
  `(shop_id, platform, platform_product_id)`
  **WHERE `platform_variant_id IS NULL`**
* `platform_variant_id MUST be NULL`
* This table is the **only product anchor** used by FT2

⚠️ PostgreSQL NOTE (ENFORCED):

This invariant is enforced via a **PARTIAL UNIQUE INDEX**, not a constraint.

Implications:
- `UNIQUE INDEX ≠ UNIQUE CONSTRAINT`
- `ON CONFLICT ON CONSTRAINT` is INVALID
- ORMs (Knex included) do NOT detect partial indexes
- Conflict targets MUST include the exact predicate:
  `WHERE platform_variant_id IS NULL`

Failure to do this results in:
- Silent transaction rollbacks
- Zero canonical_products rows
- Downstream ingestion starvation

---

### 2. `canonical_variants`

**Purpose:**
Bridges **order line items → canonical products**.

**Schema highlights:**

| Column                 | Meaning              |
| ---------------------- | -------------------- |
| `shop_id`              | Tenant boundary      |
| `canonical_variant_id` | Platform variant GID |
| `canonical_product_id`        | Platform product GID (source identity) |
| `canonical_product_anchor_id`| Canonical product anchor (DB-enforced) |
| `sku`                  | Optional             |
| `title`                | Optional             |
| `canonical_variant_code` | LaSyncro-owned SKU-level identifier (CVC) |

**Invariants:**

* One row per `(shop_id, canonical_variant_id)`
* `canonical_product_id` is **REQUIRED** (source reference)
* `canonical_product_anchor_id` is **REQUIRED** and FK-enforced
* `canonical_variant_code` is **REQUIRED** and NOT NULL
* Canonical Variant Code is:
  * Deterministic at ingestion
  * Stable for the lifetime of the variant
* Variants are **never authoritative** — they only point to products


---

### 3. `canonical_order_line_items`

**Purpose:**
Represents the atomic commercial unit of an order.

**Relevant identity columns:**

| Column                   | Meaning                   |
| ------------------------ | ------------------------- |
| `canonical_variant_id`   | Variant join key          |
| `canonical_product_anchor_id` | **Must be populated (FK)** |
| `canonical_line_item_id` | Stable line item identity |
| `canonical_variant_code` | MUST match variant’s CVC |

**Critical invariants (LOCKED):**

> If `canonical_variant_id` is present:
>
> * `canonical_product_anchor_id MUST be present`
> * `canonical_variant_code MUST be present`
> * `canonical_variant_code MUST exactly match canonical_variants.canonical_variant_code`

This is not optional.

---

## Data Flow (A → Z)

### A. Shopify Sync (Raw Ingestion)

* Products are fetched via Shopify GraphQL
* Orders + line items are fetched separately
* Raw entities are **not canonical**

No canonical writes happen here.

---

### B. Product Ingestion Worker

**File:**
`apps/backend/src/workers/product-worker.ts`

⚠️ Transport & Execution Contract

This worker is governed by the Canonical Queue & Worker Execution Playbook.

Specifically:
- Fire-and-forget semantics apply
- No retries at FT2 level
- Eligibility relies on committed DB state only
- Partial execution is treated as non-execution

See:
→ Canonical Queue & Worker Execution Playbook, §4.4 Product Ingestion Queue
→ Canonical Queue & Worker Execution Playbook, §1.1 Canonical-First Truth

**Responsibilities:**

1. Normalize product into `canonical_products`
2. Normalize variants into `canonical_variants`
3. Commit both in a single transaction

**Key guarantees:**

* Every variant written **always has a product**
* Every variant written **always has a Canonical Variant Code (CVC)**
* Canonical Variant Code (CVC) is derived deterministically at ingestion time:
  * From canonical variant identity
  * NEVER inferred from SKU
  * NEVER regenerated downstream
* Variant → product mapping is persisted **before** orders rely on it
* No order ingestion may proceed until product ingestion has
  **successfully COMMITTED canonical identity**

  Rationale:
- SKUs are mutable, optional, and non-unique
- Canonical Variant Code must be stable for life
- SKU may be stored as metadata, never as identity

Queue receipt, logs, or worker execution
do NOT constitute successful ingestion.
Only committed rows count.

---

### C. Canonical Order Ingestion

**File:**
`apps/backend/src/services/canonical-commerce-ingestion.service.ts`

**Responsibilities:**

1. Insert canonical order
2. Insert canonical order line items

**Hard invariant enforced here:**

> A line item with a variant **must also include a product**.

This is enforced via a **hard failure**, not a warning.

```ts
if (li.canonical_variant_id && !li.canonical_product_anchor_id) {
  throw new Error('[CANONICAL_IDENTITY_VIOLATION] missing product anchor');
}
```
Note:
`canonical_product_id` (platform GID) is NOT sufficient.

FT2, reconciliation, and revenue units rely exclusively on:
`canonical_product_anchor_id` (numeric PK).

This reflects the actual spine of our system.

This prevents silent corruption and enforces the Canonical-First Truth rule.

Orders MUST NOT rely on product identity unless product ingestion
has successfully committed canonical anchors.

See:
→ Canonical Queue & Worker Execution Playbook, §1.1 Canonical-First Truth
→ Canonical Queue & Worker Execution Playbook, §2 End-to-End Pipeline

This is aligned with the Reconciliation System contract:

Reconciliation:
- Guarantees execution completeness
- MAY synthesize execution rows
- MUST NOT repair canonical identity
- MUST NOT infer or backfill product anchors or CVCs

See:
→ Canonical Queue & Worker Execution Playbook, §6 Synthetic Execution
→ Canonical Queue & Worker Execution Playbook, §7 Reconciliation Worker

---

### D. Why This Guardrail Exists

This guardrail exists because:

* FT2 requires **order ↔ product joinability**
* Joinability depends on `canonical_product_anchor_id`
* Variant → product mapping **already exists** in `canonical_variants`
* Allowing NULL product IDs causes:

  * FT2 ineligibility
  * Orphaned line items
  * Broken revenue attribution

Failing early is the **only safe option**.

---

### E. Reconciliation & Revenue Units

**Files:**

* `reconciliation.handlers.ts`
* `revenue-units.writer.ts`

These systems **assume canonical identity and CVC correctness**.

They **must not**:

* Backfill product IDs
* Infer missing relationships
* Repair ingestion mistakes
* Infer or regenerate Canonical Variant Codes (CVC)

If canonical identity is wrong here, the bug is **upstream**.

---

### F. FT2 Evaluation

**File:**
`apps/backend/src/services/ft2-evaluator.service.ts`

**FT2 rule (simplified):**

* All order line items must join to products
* Any orphaned line item blocks eligibility

This is intentional and correct.

FT2 is a **trust gate**, not a data fixer.
This FT2 behavior is REQUIRED by the execution pipeline.

FT2 blocking on missing product identity is not a product rule alone —
it is a system-wide invariant enforced across:

- Product ingestion
- Order ingestion
- Execution reconciliation

See:
→ Canonical Queue & Worker Execution Playbook, §1.3 Fail-Closed
→ Canonical Queue & Worker Execution Playbook, §9 Revenue & Metrics Implication

---

## What Is Explicitly Forbidden

❌ Writing `canonical_order_line_items` with:

* `canonical_variant_id` present
* `canonical_product_id` NULL

❌ Backfilling product IDs in:

* Reconciliation
* FT2 evaluator
* Analytics layers

❌ Inferring product IDs without canonical evidence

❌ Allowing ingestion to “succeed” with broken identity

❌ Promoting partial unique indexes to constraints

PostgreSQL does NOT support:
`UNIQUE (...) WHERE ...` as a constraint.

Any attempt to rely on constraint-based conflict resolution
for partial identity is invalid by definition.
This is a hard-earned rule, not theory.

---

## Operational Debug Checklist

If FT2 reports:

> `Order line items reference missing products`

Run **only these checks** (in order):

1. `SELECT COUNT(*) FROM canonical_products WHERE shop_id = ?`
2. `SELECT COUNT(*) FROM canonical_variants WHERE shop_id = ?`
3. Check joinability:

   ```sql
   SELECT COUNT(*)
  FROM canonical_order_line_items
  WHERE shop_id = ?
    AND canonical_product_anchor_id IS NULL;
   ```
4. Check NULL products:

   ```sql
   SELECT COUNT(*)
   FROM canonical_order_line_items
   WHERE shop_id = ?
     AND canonical_product_id IS NULL;
   ```

If step 4 > 0 → **ingestion invariant was violated**.

---

## Final Statement (Read This Twice)

Canonical products are not a convenience layer.
They are the **identity spine** of the platform.

Once written (and anchor-linked):

* Downstream systems assume correctness
* Trust modules enforce strictness
* No later stage is allowed to “fix” mistakes

**If canonical identity is wrong, the system must stop.**

This contract is inseparable from the Canonical Queue & Worker Execution Playbook.

Product identity, execution truth, and eligibility gates
are enforced as a single system.

Any change to one playbook
MUST be evaluated against the other.

That is by design.

---

3.5. Check Canonical Variant Code integrity:

```sql
SELECT COUNT(*)
FROM canonical_order_line_items li
JOIN canonical_variants v
  ON li.shop_id = v.shop_id
 AND li.canonical_variant_id = v.canonical_variant_id
WHERE li.canonical_variant_code <> v.canonical_variant_code;

Result MUST be 0.
