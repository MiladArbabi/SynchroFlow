Good instinct. This is exactly the right moment to **freeze knowledge into a durable contract** before entropy creeps back in.

Below is a **production-grade playbook** you can drop directly into
`docs/playbooks/canonical-products.md`.

It is written to be:

* **Authoritative** (states invariants, not suggestions)
* **End-to-end** (A → Z, no gaps)
* **Non-hand-wavy** (every rule is justified by failure modes you just lived through)
* **Enforceable** (engineers can reason about correctness, not vibes)

---

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
2. **Variants never exist without products**
3. **Orders join to products ONLY via variants**
4. **Canonical identity is resolved at ingestion time**
5. **No inference, no synthesis, no late binding**

If any of these are violated, downstream systems (FT2, revenue units, trust modules) **must fail**.

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

* Exactly **one row per** `(shop_id, platform, platform_product_id, platform_variant_id)`
* `platform_variant_id MUST be NULL`
* This table is the **only product anchor** used by FT2

---

### 2. `canonical_variants`

**Purpose:**
Bridges **order line items → canonical products**.

**Schema highlights:**

| Column                 | Meaning              |
| ---------------------- | -------------------- |
| `shop_id`              | Tenant boundary      |
| `canonical_variant_id` | Platform variant GID |
| `canonical_product_id` | Platform product GID |
| `sku`                  | Optional             |
| `title`                | Optional             |

**Invariants:**

* One row per `(shop_id, canonical_variant_id)`
* `canonical_product_id` is **REQUIRED**
* Variants are **never authoritative** — they only point to products

---

### 3. `canonical_order_line_items`

**Purpose:**
Represents the atomic commercial unit of an order.

**Relevant identity columns:**

| Column                   | Meaning                   |
| ------------------------ | ------------------------- |
| `canonical_variant_id`   | Variant join key          |
| `canonical_product_id`   | **Must be populated**     |
| `canonical_line_item_id` | Stable line item identity |

**Critical invariant:**

> If `canonical_variant_id` is present,
> `canonical_product_id MUST also be present`.

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

**Responsibilities:**

1. Normalize product into `canonical_products`
2. Normalize variants into `canonical_variants`
3. Commit both in a single transaction

**Key guarantees:**

* Every variant written **always has a product**
* Variant → product mapping is persisted **before** orders rely on it
* No order ingestion should precede successful product ingestion

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
if (li.variantId && !li.productId) {
  throw new Error('[CANONICAL_IDENTITY_VIOLATION] ...');
}
```

This prevents silent corruption.

---

### D. Why This Guardrail Exists

This guardrail exists because:

* FT2 requires **order ↔ product joinability**
* Joinability depends on `canonical_product_id`
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

These systems **assume canonical identity is correct**.

They **must not**:

* Backfill product IDs
* Infer missing relationships
* Repair ingestion mistakes

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
   FROM canonical_order_line_items li
   JOIN canonical_variants v
     ON li.canonical_variant_id = v.canonical_variant_id
   WHERE li.shop_id = ?
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

Once written:

* Downstream systems assume correctness
* Trust modules enforce strictness
* No later stage is allowed to “fix” mistakes

**If canonical identity is wrong, the system must stop.**

That is by design.

---

If you want, next we can:

* Add a **second playbook** for canonical orders
* Write a **“Why FT2 blocks” explainer**
* Or turn this into an **ADR** with historical context

Just say the word.