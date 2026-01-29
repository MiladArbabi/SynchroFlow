# 📘 Orders Module — InfoBlock Blueprint (North Star)

## Global Principles (Apply to ALL InfoBlocks)

These rules are non-negotiable:

1. **One infoBlock = one primary question**
2. **Rows represent system truths, not interpretations**
3. **Numbers must be explainable without tooltips**
4. **Action emerges from structure, not instructions**
5. **No duplicate semantics across blocks**

If two rows answer the same SMB question → one of them is wrong.

---

## 1️⃣ InfoBlock #1 — **Orders Overview**

### Purpose

> Establish *order obligations* and execution exposure at a glance.

This block answers:

> “How many promises exist, and where do they stand broadly?”

### This block is **count-based**, not monetary.

---

### Rows (Authoritative)

| Row                    | System Truth                           | SMB Question Answered         |
| ---------------------- | -------------------------------------- | ----------------------------- |
| **Total Orders**       | Count of canonical orders in window    | “How many orders exist?”      |
| **Fulfilled Orders**   | Orders with fulfillment complete       | “How many promises are done?” |
| **Unfulfilled Orders** | Orders still requiring execution       | “How much work is left?”      |
| **Incoming Orders**    | Newly created orders not yet processed | “What just came in?”          |

---

### Footer / Status Line (Meta, not data)

> **ORDER OBLIGATIONS OBSERVED**
> **EXECUTION STATES SHOWN ELSEWHERE**

This explicitly prevents users from over-interpreting this block.

---

## 2️⃣ InfoBlock #2 — **Revenue Overview**

### Purpose

> Establish *where money exists* in principle.

This block answers:

> “Where is my money right now?”

This is the **financial backbone** of the order module.

---

### Rows (Non-Negotiable)

| Row                       | System Truth                                   | SMB Question Answered               |
| ------------------------- | ---------------------------------------------- | ----------------------------------- |
| **Total Sales**           | Sum of canonical order value                   | “How much money exists?”            |
| **Earned Revenue**        | Revenue tied to fulfilled orders               | “What have we actually earned?”     |
| **Pending Revenue** | Revenue tied to unfulfilled orders (availability-based, execution-agnostic) | “What money unlocks if we ship?”    |
| **Blocked Revenue**       | Revenue tied to orders blocked by issues       | “Why do I have orders but no cash?” |

* Pending revenue may include **synthetic execution**
* Synthetic execution exists to preserve availability truth
* Execution confidence is **never exposed in FT2**

---

### Optional (Later / Conditional)

| Row                | When Introduced                      |
| ------------------ | ------------------------------------ |
| **Collected Cash** | When payout / settlement data exists |

---

### Hard Rules

* No execution stages here
* No workflow detail
* No customer or SKU breakdowns

---

## 3️⃣ InfoBlock #3 — **Returns Overview**

### Purpose

> Surface *revenue erosion and liability*, not operational effort.

This block answers:

> “How much money is at risk of being reversed?”

---

### Rows (Top 4–5)

| Row                          | System Truth                      | SMB Question Answered            |
| ---------------------------- | --------------------------------- | -------------------------------- |
| **Returns Initiated**        | Orders with return requested      | “How many returns are in play?”  |
| **Return Value at Risk**     | Revenue tied to initiated returns | “How much money might we lose?”  |
| **Returns Received**         | Returned items physically back    | “What’s back in our hands?”      |
| **Refunds Issued**           | Completed refunds                 | “What money is already gone?”    |
| **Pending Refund Liability** | Returns received but not refunded | “What do I still owe customers?” |

---

### Notes

* This block is **liability-oriented**, not customer-service-oriented
* No blame, no reason codes here

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
* This block **never blocks FT2**, it informs it

---

## 5️⃣ InfoBlock #5 — **Operational Flow (CPT Lens)**

### Purpose

> Reveal *where value is sitting in operations*.

This block answers:

> “Where is my money stuck in the process?”

This is the **execution-leverage block**.

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

---

## 6️⃣ InfoBlock #6 — **Execution Health**

### Purpose

> Detect *system strain* before it becomes failure.

This block answers:

> “Is my operation keeping up, or degrading?”

This is your **early-warning system**.

---

### Rows (Health Signals)

| Row                          | System Truth                  | SMB Question Answered                 |
| ---------------------------- | ----------------------------- | ------------------------------------- |
| **Orders Past CPT**          | Orders exceeding cutoff time  | “Where are we late?”                  |
| **Blocked Orders Count**     | Orders blocked by issues      | “How widespread are problems?”        |
| **Aging Unfulfilled Orders** | Orders stuck beyond threshold | “What’s rotting?”                     |
| **Execution Velocity**       | Avg time from order → ship    | “Are we speeding up or slowing down?” |

---

### Why this block matters

This prevents SMBs from:

* Working harder instead of smarter
* Adding marketing when ops are broken
* Scaling chaos

---

## Final Structural Summary

| InfoBlock              | Core Question                |
| ---------------------- | ---------------------------- |
| Orders Overview        | “What promises exist?”       |
| Revenue Overview       | “Where is my money?”         |
| Returns Overview       | “What money is at risk?”     |
| Revenue Risk           | “How fragile is my revenue?” |
| Operational Flow (CPT) | “Where is value stuck?”      |
| Execution Health       | “Are we falling behind?”     |

---

## Why this blueprint works

* No semantic overlap
* Clear eligibility boundaries
* Scales to advanced merchants without confusing SMBs
* Every number maps to a *decision lever*

This **is** a north star.