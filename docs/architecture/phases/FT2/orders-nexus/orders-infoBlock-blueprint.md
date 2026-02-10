# 📘 Orders Module — InfoBlock Blueprint (North Star)

## Global Principles (Apply to ALL InfoBlocks)

> Canonical truth is the only admissible truth.
> Platform records do not imply eligibility, completeness, or exposure.

These rules are non-negotiable:

1. **One infoBlock = one primary question**
2. **Rows represent system truths, not interpretations**
3. **Numbers must be explainable without tooltips**
4. **Action emerges from structure, not instructions**
5. **No duplicate semantics across blocks**
6. **Only canonical orders may appear in FT2**

If two rows answer the same SMB question → one of them is wrong.

---

## 1️⃣ InfoBlock #1 — **Orders Overview**

### Purpose

> Establish **canonical order obligations** and execution presence at a glance.

This block answers:

> “How many promises exist, and where do they stand broadly?”

### This block is **count-based**, not monetary

---

### Rows (Authoritative)

| Row                    | System Truth                                      | SMB Question Answered         |
| ---------------------- | ------------------------------------------------- | ----------------------------- |
| **Fulfilled Orders**   | Count of canonical orders with execution complete | “How many promises are done?” |
| **Unfulfilled Orders** | Count of canonical orders still representing obligations | “How many promises remain?” |
| **Orders Added**       | Canonical orders created inside the FT2 date window | “Did new work get added?” |

> **Eligibility Rule (Locked):**
>
> Orders appear here **only if**:
>
> - canonical identity exists
> - product + variant anchoring is resolved
>
> Platform orders that fail identity resolution are intentionally excluded.
---

### Footer / Status Line (Meta, not data)

> **ORDER OBLIGATIONS SHOWN**
> **VALUE AND EXECUTION DETAILED ELSEWHERE**

This explicitly prevents users from over-interpreting this block.

---

## 2️⃣ InfoBlock #2 — **Revenue Overview**

### Purpose

> Establish *sales value availability* within a selected period.

This block answers:

This block answers:

> “How much **canonical sales value** exists, is earned, or still pending in this period?”

---

### Rows (Non-Negotiable)

| Row                | System Truth                                                                 | SMB Question Answered                          |
| ------------------ | ---------------------------------------------------------------------------- | --------------------------------------------- |
| **Total Sales**    | Sum of order value created within the FT2 date window                         | “How much sales value was generated?”         |
| **Completed Value** | Portion of Total Sales with execution complete                                | “What value is already resolved?”             |
| **Value in Progress**| Portion of Total Sales not yet execution-complete **and unconstrained**      | “What value should still move forward?”       |
| **Constrained Value**| Portion of Total Sales explicitly constrained by execution blockers           | “What value is structurally prevented?”       |

**Rules (Hard):**

* Earned, Pending, and Blocked are **mutually exclusive**
* `pending + blocked = total unfulfilled`
* Visibility is explicitly gated by **canonical execution coverage**
* No inference, no attribution, no explanation
* Platform orders with no canonical counterpart contribute **zero value**

---

### Optional (Later / Conditional)

| Row                | When Introduced                      |
| ------------------ | ------------------------------------ |
| **Collected Cash** | When payout / settlement data exists |

---

### Hard Rules

* No execution stages or workflow detail
* No customer, SKU, or obligation breakdowns
* **Blocked or constrained value MUST NOT appear here**

---

## 3️⃣ InfoBlock #3 — **Refunds Overview**

### Purpose

> Surface *recognized canonical item revenue that has been refunded*

This block answers:

> “How much item-level revenue has been refunded?”

---

### Rows (3 rows)

| Row                          | System Truth                                      | SMB Question Answered                 |
| ---------------------------- | ------------------------------------------------- | ------------------------------------ |
| **Refunded Item Revenue**    | SKU-level revenue units refunded                  | “How much sales value was refunded?” |
| **Refunded Units**           | Total refunded item quantity                      | “How many items were refunded?”      |
| **Orders Affected**          | Canonical orders with at least one refunded unit  | “Which orders were impacted?”        |


---

### Notes

* This block models **refunds only**, not returns.
* Shopify “returns” are not a reliable or complete truth source.
* Tax, shipping, duties, rounding, and payment settlement are explicitly excluded.
* All values are derived from refunded **canonical item-level revenue units only**.
* If no refunds exist, all rows render as epistemic absence (`—`).

> Platform refund events without canonical line items are ignored by design.

---

## 4️⃣ InfoBlock #4 — **Revenue Risk**

### Purpose

> Expose *fragility*, not performance.

This block answers:

> “If something breaks, how bad is it?”

---

### Rows (Risk Topology)

| Row                               | System Truth                             | SMB Question Answered                 |
| --------------------------------- | ---------------------------------------- | ------------------------------------- |
| **Revenue Concentration**         | % of revenue from top N orders/customers | “How dependent am I on a few things?” |
| **Top Order Exposure**            | Value of single largest order            | “What if this one fails?”             |
| **Customer Dependency**           | Revenue from top customer                | “What if they disappear?”             |
| **Single-Day Revenue Clustering** | % revenue tied to a single day           | “Am I spiky or stable?”               |

---

### Rules

* No counts
* No execution states
This block **never blocks FT2**, it informs it  
(based solely on canonical revenue distribution)

---

## 5️⃣ InfoBlock #5 — **Operational Flow (CPT Lens)**

### Purpose

> Reveal *where value is sitting in operations*.

This block answers:

> “Where is my money stuck in the process?”

This is the **canonical execution-leverage block**.

---

### Rows (Workflow-Aligned)

| Row           | System Truth                 | SMB Question Answered               |
| ------------- | ---------------------------- | ----------------------------------- |
| **Receiving** | Orders/items awaiting intake | “What just arrived?”                |
| **Stored**    | Inventory waiting for action | “What’s idle?”                      |
| **Picking**   | Orders actively being picked | “What’s in motion?”                 |
| **Packing**   | Orders being packaged        | “What’s almost done?”               |
| **Shipping**  | Orders handed to carrier     | “What should convert to cash next?” |

Each row can show:

* Order count
* Total value
* Avg time in stage (later)

---

### Hard Rules

* No revenue totals here
* No fulfillment success metrics
* This is **flow, not outcome**
* Orders without canonical identity never appear in this block

---

## 6️⃣ InfoBlock #6 — **Obligation Overview**

Visibility Gate (NON-NEGOTIABLE):

This block renders only when:
• Obligation evaluation coverage ≥ threshold
• Canonical order identity coverage ≥ threshold

If coverage is insufficient:
• Block is hidden entirely
• No partial rows are shown

### Purpose

> Purpose
Surface how much value is currently constrained by unresolved obligations, grouped by constraint class.

> Non-Purpose
Explain causes, suggest actions, imply urgency, or recommend prioritization.

Core Question (Locked)

“How much value is currently constrained — and by what class of constraint?”

Nothing about what to do.

---

### Rows (Health Signals)

| Row                                 | Constraint Class | System Meaning                                                            |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| **Inventory-constrained value**     | Inventory        | Value tied to orders that cannot progress due to inventory unavailability |
| **Customer-constrained value**      | Customer         | Value tied to orders awaiting required customer-side completion           |
| **Operationally-constrained value** | Operational      | Value constrained within internal execution flow                          |
| **Other-constrained value**         | Other            | Value constrained by uncategorized or residual blockers                   |

> VALUE SHOWN IS CURRENTLY CONSTRAINED
> NO ACTIONS OR OUTCOMES ARE IMPLIED

Phase note (v1):

• Inventory constraints are evaluated first
• Other constraint classes may be present but unclassified
• Uncategorized value remains intentionally opaque

---

## Relationship to Revenue Overview

| Revenue Overview                     | Obligation Overview                              |
| ------------------------------------ | ----------------------------------------------- |
| Sales value partitioning             | Constraint topology                              |
| Earned / Pending / Blocked           | Inventory / Customer / Operational / Other      |
| Temporal (window-based)              | Lifetime (state-based)                           |
| Aggregate-only, execution-gated      | Aggregate-only, obligation-coverage-gated       |
| Answers “where is value?”            | Answers “what is constraining value?”           |

### Why this block matters

This prevents SMBs from:

* Working harder instead of smarter
* Focusing on wrong things and mis-prioritizing tasks
* Scaling chaos

Blocked Revenue notes (LOCKED):

* Derived from explicit obligation evaluation flags
* Downgraded to aggregate value only
* No blocker categories exposed here
* Absence of Blocked Revenue ≠ absence of constraints  
* Absence of rows may also indicate unresolved canonical identity

---

## Final Structural Summary

| InfoBlock                | Core Question                |
| ----------------------   | ---------------------------- |
| Orders Overview          | “What **canonical** order obligations exist?” |
| Revenue Overview         | “What sales value is earned, pending, or blocked in this period?” |
| Refunds Overview         | “What item revenue was refunded?” |
| Revenue Risk             | “How fragile is my revenue?” |
| Operational Flow (CPT)   | “Where is value stuck?”      |
| Obligation Overview | “What is constraining value right now?” |

---

## Canonical Guardrail (LOCKED)

FT2 Order surfaces:

* do not reconcile platform inconsistencies
* do not “fill gaps” in missing identity
* do not explain why orders are absent

Silence is intentional.

## Why this blueprint works

* No semantic overlap
* Clear eligibility boundaries
* Scales to advanced merchants without confusing SMBs
* Every number maps to a *decision lever*

This **is** a north star.
