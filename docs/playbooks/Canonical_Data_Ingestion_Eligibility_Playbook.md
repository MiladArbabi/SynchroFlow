# 📘 Canonical Data Ingestion & Eligibility Playbook

**(FT0 → FT2-Safe, Execution-Aware, Transport-Correct, Phase-Aligned)**

---

## 0. Core Principle (Non-Negotiable)

> **Never design ingestion from what you *wish* the data looked like.
> Never debug ingestion from what you *assume* executed.
> Design and debug only from what you can *prove* happened.**

This applies equally to:

* Source payloads
* Canonical storage
* **Transport execution paths**
* Identity resolution paths

Everything else in this document enforces that rule.

This rule applies equally to **identity resolution**.

If canonical identity is incomplete or missing:

* execution truth is invalid
* eligibility signals are unreliable
* SKU-level attribution is disallowed
* FT2 must fail closed

Identity gaps are ingestion failures, not evaluator bugs.

---

## 1. Always Start With a HARD SCAN (No Code Changes)

### 1.1 Scan the Source (Platform Reality)

Before touching any code:

* Inspect **actual API responses**
* Log **real payloads** (not docs)
* Identify:

  * Fields that are **always present**
  * Fields that are **sometimes present**
  * Fields that are **conditionally protected**
  * Fields that are **never present without escalation**

📌 Output artifact:

```md
Source Field Matrix:
- guaranteed
- optional
- gated
- forbidden
```

If you skip this → **your ingestion will lie**.

---

### 1.2 Scan the Canonical DB (Storage Reality)

Inspect:

```sql
\d canonical_<domain>
\d canonical_<domain>_line_items
SELECT * FROM information_schema.columns WHERE table_name = '...';
```

Identify:

* NOT NULL constraints
* UNIQUE constraints
* Foreign keys
* Temporal expectations

📌 Output artifact:

```md
Canonical Storage Contract:
- must-have
- nullable
- derived later
```

⚠️ Column Names Are Canonical Truth

Never assume logical names like:

* order_id
* product_id
* variant_id

Always use actual schema names:

canonical_order_id
lasyncro_product_id
canonical_variant_id

If code references a column that does not exist:

* That is an ingestion bug
* Not a typing issue
* Not a mapper issue

If storage requires something the source cannot guarantee → **storage is wrong** (not the mapper).

---

### 1.3 Scan Eligibility Logic (Consumer Reality)

Search:

```bash
grep -R "<domain>" ft*-evaluator
grep -R "canonical_<domain>" services/
```

Answer:

* What unlocks phases?
* What is counted?
* What is advisory vs blocking?

📌 Output artifact:

```md
Eligibility Contract:
- Phase gates
- Minimum viable signals
- Advisory signals
```

### 1.4 Scan Canonical Joins (Identity Reality) 🆕

Before touching code, prove joins exist:

```sql
SELECT COUNT(*) FROM canonical_<child>
WHERE canonical_<parent>_id IS NULL;

Examples:

SELECT COUNT(*)
FROM canonical_order_line_items
WHERE lasyncro_product_id IS NULL;

Additional invariant scan (SKU identity):

```sql
SELECT COUNT(*)
FROM canonical_order_line_items li
JOIN canonical_variants v
  ON li.shop_id = v.shop_id
 AND li.canonical_variant_id = v.canonical_variant_id
WHERE li.canonical_variant_code <> v.canonical_variant_code;
```

If count > 0:

Eligibility must block

FT2 is correct

Ingestion is incomplete

Do not debug evaluators until joins are clean
---

## 2. 🚨 Transport & Execution Scan (NEW – HARD-LEARNED)

> **Before assuming “ingestion is broken,” prove the correct handler executed,
committed identity, AND survived a full transaction boundary.**

This thread exposed a critical rule:

> A verified webhook that returns `200 OK` **does not mean** domain logic ran.

### 2.1 Prove the Runtime Path

Required evidence:

[ROUTE HIT]
[WEBHOOK VERIFY]
[WEBHOOK DISPATCH]
[DOMAIN HANDLER ENTERED]

✱ Strengthened rule:

A webhook that verifies and returns 200 OK
may still have failed to execute domain logic.

If any checkpoint is missing:

Stop immediately

* Do not inspect DB
* Do not change mappers
* Do not reason about eligibility
* You are debugging fiction, not execution.

---

### 2.2 Eliminate Build Artifacts as a Variable

If you are running compiled JS:

* Confirm **which file is executed**
* Confirm edits land in **runtime artifacts**
* Assume nothing about `dist/`

Rules:

* If a log doesn’t show → that code didn’t run
* If a handler “should” run → prove it did

> **No execution proof = no debugging rights**

---

### 2.3 Queue Consumers Must Prove Commit, Not Receipt (NEW)

A queue message being:

* received
* logged
* acked

does NOT mean ingestion succeeded.

Required proof:

* Transaction COMMIT reached
* Canonical rows exist
* Ingestion event written

If you see:

* logs without rows
* rows without ingestion events
* retries without growth

You are debugging a rolled-back transaction.

---

## 3. Define the PHASE CONTRACT (Before Writing Code)

Every domain **must** be phase-scoped.

### Example: Revenue / Orders

| Phase | Required          | Forbidden            |
| ----- | ----------------- | -------------------- |
| FT0   | existence         | economics            |
| FT1   | counts + totals   | per-item attribution |
| FT2   | currency + totals | margins              |
| FT3+  | line economics    | guesses              |

### Example: Products / Variants (NEW · REQUIRED)

| Phase | Required                         | Forbidden                     |
| ----- | -------------------------------- | ----------------------------- |
| FT0   | product existence                | order joins                   |
| FT1   | variant presence                 | revenue attribution           |
| FT2   | canonical product + variant IDs + CVC | SKU inference, backfills |
| FT2   | cost, margin, performance        | guessing                      |

FT2 eligibility **requires canonical product identity**, not SKU strings.

📌 Write this **before** coding.

> If you can’t explain what the domain looks like at FT2 **in one paragraph**, you are not ready to ingest it.

---

## 4. Canonical Model Rules (Still Saved You)

### 4.1 Canonical ≠ Complete

Canonical means:

* **Truthful**
* **Non-fabricated**
* **Phase-appropriate**

❌ Never:

* Default missing money to `0`
* Invent currency
* Backfill prices without proof

✅ Always:

* Use `null`
* Mark advisory gaps
* Enrich later

---

### 4.2 Split Header Truth vs Detail Truth

**Pattern that worked (reuse everywhere):**

```ts
CanonicalEntity {
  // Tier 1: Phase-critical
  id
  shopId
  createdAt
  currency
  total

  // Tier 2: Enrichable
  lineItems[]
  costs
  attribution
}
```

Eligibility must **only** depend on Tier 1.

---

### 4.3 Canonical Identity Is the Spine (NEW – NON-NEGOTIABLE)

Execution data without canonical identity is not execution truth.
It is **structurally invalid** and must never reach FT2.

Every execution-level record must satisfy:

### Canonical Product Identity (CRITICAL)

Canonical products MUST satisfy **exactly one row per product-level identity**:

(shop_id, platform, platform_product_id)
WHERE platform_variant_id IS NULL

This identity:

* MUST be enforced via a PARTIAL UNIQUE INDEX
* MUST be targeted explicitly during upsert
* MUST NOT be inferred via SKU or variant rows

❌ Forbidden:

* Assuming a UNIQUE CONSTRAINT exists when only a UNIQUE INDEX exists
* Using ON CONFLICT without matching the partial index predicate
* Referencing index names as columns
* Removing platform_variant_id from conflict keys without compensating logic

✅ Required:

* Use `ON CONFLICT (cols) WHERE predicate` when partial uniqueness is intended
* Verify conflict behavior with raw SQL before trusting ORM behavior

---

## 5. Mapper Design Rules (Expanded)

### 5.1 Mapper Is a Translator, Not a Fixer

Mapper rules:

* 1 source field → 1 canonical field
* No math
* No defaults
* No inference

```ts
totalPrice =
  node.totalPriceSet?.shopMoney?.amount != null
    ? Number(node.totalPriceSet.shopMoney.amount)
    : null;
```

If the mapper “fixes” data, **you will never know it was broken**.

---

### 5.2 Mapper Must Not Mask Execution Failures (NEW)

If a mapper isn’t running because the handler never executed:

* That is **not** a mapper bug
* That is a **transport failure**

Therefore:

* Mapper correctness is only evaluated **after execution is proven**

---

### 5.3 Mappers Must Preserve Joinability

Mappers must emit identifiers that allow **downstream joins**.

Forbidden patterns:

* Writing platform_variant_id without product linkage
* Writing line items without resolvable canonical_variant_id
* Assuming products will be resolved later

If a mapper cannot guarantee joinability or canonical SKU identity:

* Do not emit Canonical Variant Code
* Let eligibility block
* Fix ingestion, not evaluation

---

## 6. Ingestion Service Rules (Clarified)

### 6.1 Never Insert Partial Rows Blindly

* Insert **only** when phase requirements are met
* Skip (or defer) otherwise
* Log exactly why

Avoids:

* Corrupt canonical truth
* Silent FT2 blockers
* Debug hell

---

### 6.2 Line Items Must Be Optional by Default

Your work reinforced this:

> Line items are enrichment, not eligibility.

Therefore:

* `unit_price` nullable
* `total_price` nullable
* Costs nullable

**Never block ingestion on enrichment fields.**

---

6.3 Execution Ingestion Must Be Canonical-First

Execution ingestion is a two-step contract, not a single write.

Step 1 — Resolve Canonical Identity
platform payload
→ normalize IDs
→ lookup canonical entity

Step 2 — Write Execution Truth

Only after canonical resolution:

canonical_order_id present
→ execution row allowed

If Step 1 fails:

Defer
Retry
Log
Alert

❌ Never:

Write execution rows “optimistically”
Assume later joins will fix it
Allow NULL canonical references

---

### 6.4 Order Ingestion Depends on Product Identity

Canonical order ingestion may proceed **without enrichment**, but:

* FT2 eligibility requires product identity
* canonical_order_line_items MUST eventually link to canonical_products

Allowed:

* Insert orders
* Insert line items with NULL lasyncro_product_id (temporarily, FT0–FT1 only)
* Insert line items with NULL canonical_variant_code (temporarily, FT0–FT1 only)

Required before FT2:

* Backfill canonical_product_anchor_id
* Backfill canonical_variant_code (CVC)
* Verify joins and CVC consistency via SQL

---

### 6.5 Partial Unique Indexes Are NOT Constraints (NEW)

PostgreSQL rules:

* A UNIQUE INDEX ≠ UNIQUE CONSTRAINT
* Partial uniqueness (`WHERE ...`) CANNOT be expressed as a constraint
* `ON CONFLICT ON CONSTRAINT` WILL FAIL for partial indexes

Therefore:

❌ Invalid:
ON CONFLICT ON CONSTRAINT uq_canonical_products_identity

❌ Invalid:
ON CONFLICT (shop_id, platform, platform_product_id)

✅ Valid:
ON CONFLICT (shop_id, platform, platform_product_id)
WHERE platform_variant_id IS NULL

Knex-specific rule:

Knex does NOT auto-detect partial indexes.
You MUST express the predicate manually using `trx.raw(...)`.

Failure mode:

* Insert fails silently
* Transaction aborts
* No ingestion event is written
* Eligibility never flips

---

### 6.6 Canonical Product Ingestion Is Two-Tiered (NEW)

Canonical Products have TWO identities:

1) Logical Identity (Product-Level)
   (shop_id, platform, platform_product_id)
   WHERE platform_variant_id IS NULL

2) Physical Anchor
   lasyncro_product_id (numeric PK)

Rules:

* Variants MUST reference the numeric anchor
* Orders MUST ultimately reference the anchor
* Platform IDs are NOT anchors
* SKU is NOT identity

If anchor resolution fails:

* Variants MUST NOT be written
* Orders MUST defer product attribution
* FT2 MUST block

---

## 7. Eligibility Evaluator Rules (FT2 Stability)

### 7.1 Eligibility Must Be Binary and Explainable

FT2 logic must answer:

* Are orders present?
* Are totals present?
* Is currency present?

Not:

* Are margins correct?
* Are customers linked?
* Are costs known?

Those are **advisory**.

FT2 must block if:

* canonical_order_line_items exist
* AND any row has:
  * canonical_product_anchor_id IS NULL
  * OR canonical_variant_code IS NULL
  * OR canonical_variant_code mismatches canonical_variants

This is a CROSS_DOMAIN blocker:
ORDERS × PRODUCTS

The evaluator was correct to block.

This incident confirmed:

* FT2 correctly failed closed
* The evaluator surfaced ingestion faults
* The bug was upstream, not evaluative

---

### 7.2 Evidence > Boolean

Every evaluator must emit:

```ts
{
  eligible: boolean,
  blockers: [],
  evidence: { ... }
}
```

This is why debugging worked.

---

## 8. UI / Product Semantics (No Lying)

### 8.1 Counts Must Match Phase Truth

If:

* 10 platform orders
* 8 canonical orders (valid)

Then:

* Show **8**
* Explain exclusion of 2

Never inflate.

---

### 8.2 Advisory ≠ Error

Use:

* Warnings
* Tooltips
* Badges

Do not:

* Block dashboards
* Throw errors
* Hide progress

---

## 9. Operational Safety Checklist (Expanded)

Before declaring a domain “wired”:

* [ ] Route hit confirmed
* [ ] Verification passed
* [ ] Dispatch entered
* [ ] Handler entered
* [ ] Canonical table populated
* [ ] Eligibility flips correctly
* [ ] DB constraints match mapper reality
* [ ] No fabricated defaults
* [ ] Restart-safe (cold boot works)
* [ ] Partial data does not crash pipeline
* [ ] Advisory gaps surfaced, not hidden
* [ ] Canonical identity present on all execution rows
* [ ] Canonical product identity present on all order line items
* [ ] No execution rows with NULL foreign keys
* [ ] No order line items with NULL lasyncro_product_id
* [ ] Execution joins verified by direct SQL
* [ ] Canonical Variant Code (CVC) present on all variants
* [ ] Canonical Variant Code matches between:
      canonical_variants ↔ canonical_order_line_items
* [ ] No SKU-level execution without CVC
* [ ] Partial unique indexes verified with raw SQL
* [ ] ON CONFLICT clauses proven against live schema

If **any box is unchecked** → **stop**.

```typescript
SELECT COUNT(*)
FROM order_fulfillment_status
WHERE canonical_order_id IS NULL;
```

If count > 0 → stop.

---

## 10. How to Apply This to Any New Domain

Repeat **exact same steps** for:

* Customers
* Refunds
* Payouts
* Costs
* Attribution
* **Fulfillment**
* Inventory movements

Change **only**:

* Source scan
* Canonical schema
* Phase contract

Transport + execution rules stay fixed.

* For domains with execution semantics (fulfillment, refunds, payouts, inventory):

Canonical-first identity resolution is mandatory.
No exceptions.

---

### 11. The Meta Rule (Final, Now Complete)

Eligibility gates are not about perfection.
They are about provable execution, stable identity, and safe progress.

What failed was not math, UI, or FT2 logic.
What failed was assuming database semantics instead of proving them.

Specifically:

* Partial uniqueness was misunderstood
* ORM abstractions were trusted blindly
* Execution was inferred instead of proven

The system recovered when:

* Canonical identity was enforced
* Partial indexes were respected
* Ingestion truth was proven end-to-end

That is not debugging.
That is enforcing reality in distributed systems.

---
