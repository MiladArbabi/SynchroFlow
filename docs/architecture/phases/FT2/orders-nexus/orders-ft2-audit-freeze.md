# 🔒 Order-Nexus FT2 Contract Audit

**CURRENT · ACTIVE · SEALED (REV C.1 — Blocked Revenue Clarified / L2-Downgrade Explicit)**

**Status:** ✅ COMPLETE / SEALED  
**Scope:** Order-Nexus FT2 — Backend + Frontend  
**Standard:** Truth-only · Scan-verified · Read-only  
**Audit Type:** Structural + Semantic Contract Audit  
**Apex Rule:** **FT2 is the final product layer. There is no FT3.**

---

## 0. Contract Definition — What “Orders FT2” Is (RE-AFFIRMED)

**Orders FT2** is a **read-only economic & operational orientation system**, answering exactly one class of questions:

> **“What obligations, value, and risk exist in my order system right now — and where do they sit?”**

Orders FT2 **never** answers:

* Why something happened
* What to do
* What matters most
* What will happen
* How to fix anything

This definition is **unchanged**.

---

## 0.0 Composition of Orders FT2 (UPDATED · INFOBLOCK-COMPLETE)

Orders FT2 is composed of:

1. **Authoritative FT2 Snapshot**  
    *(downgraded, scan-verified truth only)*
2. **Narrative InfoBlocks (FT2 primitives)**  
    **LOCKED SET (v1):**
    1. Orders Overview
    2. Revenue Overview
    3. Refunds Overview *(gated)*
    4. Revenue Risk *(gated)*
    5. Operational Flow (CPT Lens) *(gated)*
    6. Execution Health *(gated)*
3. **FT2-Adjacent Exploratory Surfaces**
    * Orders over time
    * Order size distribution
4. **Cross-Domain Alignment Planes**
5. **Strict Frontend Consumption Path**
    * Snapshot hooks only
    * Pure adapters
    * Observational UI primitives

> 🔒 **InfoBlock remains the only FT2 narrative primitive.**  
> FT2Surface is **structural scaffolding only**.

---

## 0.1 Explicit Non-Capabilities (RE-SEALED)

Orders FT2 contains **no**:

* Lifecycle mutation
* Remediation logic
* Recommendations
* Explanations
* Causation
* Forecasting
* Prioritization
* Semantic interpretation inside InfoBlocks
* Accounting semantics (paid, settled, net, margin)
* Execution inference whatsoever
  * Execution truth may surface **only** via:
        1. Observed execution (platform-confirmed), or
        2. Synthetic placeholders explicitly marked as assumed
  * L2 classification may downgrade execution *visibility*, never invent execution
* SKU inference, backfilling, or reconstruction

If any of the above appear, the contract is broken.

---

## 0.2 Domain Taxonomy (UPDATED · INFOBLOCK-OWNED)

Orders FT2 exposes **four domain classes**, each owned by a single InfoBlock.

### 🧭 A. System Grounding Domains (FOUNDATIONAL · L1)

**Answer:**  
> **“Is this system anchored in observable reality?”**

| Domain | Layer | Question Answered |
| :--- | :--- | :--- |
| Order Presence Reality | L1 | Do any orders exist in this period? |
| Revenue Presence Reality | L1 | Does any sales value exist at all? |
| Ingestion Presence Reality | L1 | Did data flow into the system? |
| Temporal Freshness Reality | L1 | Is the data recent or stale? |
| Revenue Continuity Reality | L1½ | Is sales activity isolated or ongoing? |
| Data Coverage Reality | L1 | Is source data structurally complete? |
| Economic Visibility Gate | L2 | Is interpretation epistemically allowed? |

📌 These domains surface across FT2 InfoBlocks according to ownership.  
📌 Orders Overview owns **order-state grounding only**.  
📌 Revenue, execution, and risk grounding are owned by their respective InfoBlocks.
📌 Revenue Overview may display blocked value only as an aggregate partition of sales availability.
📌 Obligation Overview is the exclusive FT2 surface allowed to explain constraint structure.

---

## Canonical Identifiers (Truth Ownership Clarification)

Orders FT2 operates on LaSyncro-owned canonical identifiers, not platform identifiers.

**Definitions:**

* **Canonical Order ID** — LaSyncro-stable order identity (already established)
* **Canonical Variant Code (CVC)** — LaSyncro-owned SKU-level identifier

**Rules:**

* Platform SKUs are advisory only.
* Platform variant IDs are inputs, not identifiers.
* All SKU-level truth in FT2 is anchored to Canonical Variant Code (CVC).

**Canonical Variant Code (CVC):**

* Stable
* Deterministic
* Shop-scoped
* Printable / scannable
* Safe for MDEs, barcode systems, and warehouse workflows

**Format (v1):**

```
cvc:v1:{shop_id}:{platform_variant_id}
```

FT2 never reasons over raw platform SKUs.

If CVC is absent, SKU-level revenue and obligations are not addressable. In this state:

* SKU-level attribution is suppressed.
* Revenue may surface **only as aggregate totals**.
* FT2 may remain eligible **only if canonical product linkage exists**.

This is intentional and epistemically strict.

### Canonical Identity Enforcement (NEW · HARD GATE)

Orders FT2 eligibility requires **full canonical identity resolution** at ingestion time.

**Hard Requirements:**

* Every `canonical_order_line_items` row **MUST** satisfy:
  * `canonical_variant_id IS NOT NULL`
  * `canonical_product_id IS NOT NULL`
* Variant → Product linkage is **resolved before FT2 evaluation**.
* FT2 **never** infers, repairs, or backfills canonical identity.

If any order line item lacks a canonical product reference:

* Orders FT2 is **blocked**.
* Revenue aggregation is **disallowed**.
* Execution-aware domains are **suppressed**.

## Execution Ledger Ownership (NEW · SEALED)

Orders FT2 owns **no execution logic**, but it owns **execution truth visibility**.

**Source of truth:** `order_fulfillment_status`

**Guarantees:**

* Exactly one execution row per canonical order.
* Canonical order is the primary key for execution truth.
* Platform order IDs are auxiliary references only.
* Observed execution always overrides synthetic execution.
* Execution state is replay-safe and restart-safe.

FT2 consumes execution truth. It never derives, mutates, or repairs it.

This behavior is intentional and non-recoverable inside FT2.

### Canonical Fulfillment Determination (NEW · HARD DEFINITION)

Fulfilled / Unfulfilled in Orders FT2 is determined exclusively by the execution ledger.

**Definitions:**

**Fulfilled Order**
A canonical order that has an execution row with:

* `status IN ('fulfilled', 'delivered')`
* `execution_source = 'observed'`

**Unfulfilled Order**
A canonical order whose execution row is either:

* `status = 'processing'`, or
* `execution_source = 'synthetic'`, or
* Missing an observed execution

**Hard Rules:**

* Platform order fields (e.g., `orders.fulfillment_status`) are never consumed directly.
* Platform data may only influence fulfillment via reconciliation.
* Synthetic execution is treated as unfulfilled by FT2.
* Observed execution always supersedes synthetic execution.

📌 Orders Overview reads exclusively from `order_fulfillment_status`.  
📌 No inference, fallback, or dual-read paths exist.

---

### 💰 B. Revenue Availability Domains (PRIMARY · L1)

**Owned by: Revenue Overview (sales availability partitioning)  
Constraint topology owned by: Obligation Overview**

**Answer:**  
> **“Where does the money exist right now?”**

| Domain | Layer | Question Answered |
| :--- | :--- | :--- |
| Total Sales Reality | L1 | How much sales value exists in this period? |
| Earned Revenue Reality | L1 | How much value has completed execution? |
| Pending Revenue Reality | L1 | How much value is unfulfilled but unconstrained? |
| Blocked Revenue Reality | L1 | How much value is unfulfilled and explicitly constrained? |

**Pending Revenue** includes:

* Revenue tied to canonical orders whose execution is:
  * Not yet observed
  * AND not constrained by any obligation flag

Pending does **not** imply failure, delay, or risk. It reflects absence of confirmed execution only.

**Hard Rules (LOCKED):**

* Revenue here is **availability-based**, not accounting-based.
* No payment, settlement, or margin semantics.
* No recommendations or prioritization.
* No execution diagnosis.

### Blocked Revenue Reality (FT2 · Aggregate Partition)

Blocked Revenue represents **unfulfilled revenue with explicit execution constraints**.

**Definition:**
Revenue tied to canonical orders whose execution is blocked by at least one evaluated obligation flag.

**Rules (LOCKED):**

* Blocked Revenue is a **subset of unfulfilled revenue**
* `pending + blocked = total unfulfilled`
* Derived directly from:
  * `order_fulfillment_status.has_*_block = true`
* Requires obligation evaluation freshness
* Downgraded to **aggregate totals only**
* Never explains causes or classes here
* Attribution lives exclusively in Obligation Overview

##### Obligation Coverage vs Attribution (NEW · HARD GATE)

Blocked Revenue is derived from **execution rows that are obligation-evaluable**.

**Important distinction:**

* **Coverage** answers: “Was this order evaluated for this obligation?”
* **Classification** answers: “Do we know which obligation caused the block?”

It is valid and expected for FT2 to surface:

* 100% obligation coverage
* 0% obligation attribution

This reflects epistemic honesty. FT2 must prefer absence over fabrication.

Coverage without attribution is valid.  
Attribution without coverage is forbidden.

---

### 🔁 C. Refund & Revenue Reversal Domains (PRIMARY · L1)

⚠️ **Important semantic boundary (SEALED):**

Orders FT2 does **not** model “returns” as a logistics concept.

* Shopify “returns” are not a first-class or reliable data source.
* Orders FT2 operates **exclusively on refunds**.
* All values in this domain are derived from **refunded item revenue only**.
* Tax, shipping, adjustments, rounding, and payment semantics are explicitly excluded.

If a platform exposes returns without refunds, this domain remains epistemically absent (`null`).

**Owned exclusively by: Refunds Overview**

**Answer:**  
> **“Has previously recognized item revenue been refunded?”**

| Domain | Layer | Question Answered |
| :--- | :--- | :--- |
| Refund Presence Reality | L1 | Do refunds exist? |
| Refunded Orders Reality | L1 | How many canonical orders were refunded? |
| Refunded Item Revenue Reality | L1 | How much item-level revenue was refunded? |
| Refund Exposure Reality | L1 | How much recognized revenue has been reversed? |

---

### ⚠️ D. Revenue Risk Domains (PRIMARY · L1)

**Owned exclusively by: Revenue Risk**

**Answer:**  
> **“How fragile is my revenue shape?”**

| Domain | Layer | Question Answered |
| :--- | :--- | :--- |
| Revenue Concentration Reality | L1 | Is revenue tied to few orders/customers? |
| Top-Order Exposure Reality | L1 | What is the largest single-order dependency? |
| Customer Dependency Reality | L1 | Is revenue customer-concentrated? |
| Temporal Clustering Reality | L1½ | Is revenue time-clustered? |

---

### 🚚 E. Operational Flow Domains (PRIMARY · L1)

**Owned exclusively by: Operational Flow (CPT Lens)**

**Answer:**  
> **“Where is value sitting in the workflow?”**

| Domain | Layer | Question Answered |
| :--- | :--- | :--- |
| Receiving Reality | L1 | What value has entered ops? |
| Stored Value Reality | L1 | What value is idle? |
| Picking Reality | L1 | What value is in motion? |
| Packing Reality | L1 | What value is near completion? |
| Shipping Handoff Reality | L1 | What value should convert next? |

---

### 🧠 F. Execution Health Domains (PRIMARY · L1 / L1½)

**Owned exclusively by: Execution Health**

**Answer:**  
> **“Is the system keeping up?”**

| Domain | Layer | Question Answered |
| :--- | :--- | :--- |
| CPT Breach Reality | L1 | Are orders past cutoff? |
| Blocked Orders Reality | L1 | How many orders are execution-obstructed (cause-agnostic)? |
| Aging Orders Reality | L1½ | Are orders stagnating? |
| Execution Velocity Reality | L1½ | Is throughput changing? |

---

## 0.3 Alignment Planes (CONFIRMED · UNCHANGED)

Alignment planes remain:

* Deterministic
* Read-only
* Fail-closed
* Post-FTEP
* **Non-narrative**

Revenue execution **never bypasses** FTEP.

---

## 1. Proven Architectural Flow (RE-SEALED)

```
Canonical Database
   ↓
Layer 1 — Canonical Facts
   ↓
Layer 1½ — Temporal Facts
   ↓
Layer 2 — Intelligence (INTERNAL ONLY)
   ↓
Layer 3 — FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Alignment Planes
   ↓
Order-Nexus FT2 Snapshot
```

🚨 Execution-aware revenue enters **only at Layer 2** and may surface at L1 **only after explicit downgrade (e.g., Blocked Revenue totals).**

---

## 2. Revenue Semantics in FT2 (RE-CLARIFIED)

### Revenue in FT2 **is**

* Observable
* Availability-based
* Execution-aware only via downgraded L2 aggregates
* Derived from SKU-level revenue units

**Truth Source:**  
`order_revenue_units` is the sole revenue truth source for FT2.

**Precondition:**  
Revenue units are valid **only if canonical identity is complete**:

* `canonical_variant_id` present
* `canonical_product_id` present
* Variant → Product join proven

If this precondition fails, revenue units may exist internally but are **not exposable** to FT2.

Revenue units are materialized, not inferred.  
Each unit represents factual SKU-level value and is the **sole basis for refund exposure in FT2**.

If revenue units do not exist, FT2 must show zero, not estimates.

### Revenue in FT2 **is not**

* Paid
* Settled
* Net
* Profit
* Margin
* Collectible

---

## 3. Frontend Narrative Contract (UPDATED · SMB-LEGIBLE)

### InfoBlock: Orders Overview

**Rows (LOCKED · CANONICAL):**

1. **Fulfilled orders**  
    Lifetime count of canonical orders with observed execution (execution ledger backed, date-range invariant).
2. **Unfulfilled orders**  
    Lifetime count of canonical orders without observed execution (includes synthetic and in-progress execution).
3. **Orders added**  
    Canonical orders created within the selected FT2 date window (temporal inflow, execution-agnostic).

📌 Platform order states are not read.  
📌 Synthetic execution is treated as unfulfilled.  
📌 Counts are mutually exclusive and ledger-backed.

**Footer Rail (LOCKED):**
> **ORDER STATE AND INFLOW SHOWN**  
> **VALUE, EXECUTION, AND RISK DETAILED ELSEWHERE**

### Orders Overview — Comparison Policy (SEALED)

Comparative percentage change is permitted **only** on:

* **Orders added**

Comparisons are **forbidden** on:

* Fulfilled orders
* Unfulfilled orders

**Rationale:**

* Fulfilled and unfulfilled orders are **state-based** and date-range invariant.
* Orders added is the **only temporal inflow metric**.

**Comparison rules:**

* Percentage only
* Fail-closed (`null → —`)
* Computed from canonical fixed windows (Layer 1½)
* Not relative to user-selected date range
* No interpretation or labeling

This policy is non-negotiable.

---

### InfoBlock: Revenue Overview

**Rows (LOCKED):**

* Total sales
* Earned revenue
* Pending revenue
* Blocked revenue

**Footer Rail (LOCKED):**
> SALES VALUE SHOWN — CURRENT EXECUTION STATE  
> PAYMENT AND PROFIT NOT EVALUATED  
> BLOCKED VALUE IS PARTITIONED — CAUSES SHOWN ELSEWHERE  
> SKU-LEVEL DETAIL REQUIRES CANONICAL VARIANT CODES (CVC)
> **MISSING CANONICAL IDENTIFIERS RESULT IN AGGREGATE-ONLY VISIBILITY**

---

## 4. Intentional Gaps (RE-CONFIRMED)

Orders FT2 intentionally excludes:

* Profit
* Margin math
* Payment status
* Accounting timelines
* Recommendations
* Causality
* Prioritization
* FT3

These are **constraints**, not backlog items.

---

## FT2 Eligibility Gate (CLARIFIED · NON-NEGOTIABLE)

Orders FT2 eligibility requires:

1. Canonical products present
2. Canonical variants present
3. All order line items joined to canonical products
4. No orphaned canonical order line items

Failure of any condition results in:

* `eligible = false`
* `status = BLOCKED`
* Cross-domain blocker: `ORDERS × PRODUCTS`

FT2 does not degrade gracefully under identity failure. It fails closed by design.

## 🔐 FINAL SEAL — REV C.1

✔ InfoBlocks fully enumerated and owned  
✔ Revenue framed as *availability*, not jargon  
✔ SMB cognitive load respected  
✔ Phase 6 cleanly isolated  
✔ No semantic leakage  
✔ FT2 remains terminal  

🔒 **Order-Nexus FT2 Contract Audit — REV C.2 is current, aligned, and sealed.**

---
