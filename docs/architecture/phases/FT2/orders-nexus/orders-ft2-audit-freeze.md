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

* why something happened
* what to do
* what matters most
* what will happen
* how to fix anything

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
   3. Returns Overview *(gated)*
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

* lifecycle mutation
* remediation logic
* recommendations
* explanations
* causation
* forecasting
* prioritization
* semantic interpretation inside InfoBlocks
* **accounting semantics (paid, settled, net, margin)**
* **execution inference unless explicitly downgraded via L2 classification**
* **SKU inference, backfilling, or reconstruction**

If any of the above appear, the contract is broken.

---

## 0.2 Domain Taxonomy (UPDATED · INFOBLOCK-OWNED)

Orders FT2 exposes **four domain classes**, each owned by a single InfoBlock.

### 🧭 A. System Grounding Domains (FOUNDATIONAL · L1)

Answer:
> **“Is this system anchored in observable reality?”**

| Domain                     | Layer | Question Answered                        |
|----------------------------|-------|------------------------------------------|
| Order Presence Reality     | L1    | Do any orders exist in this period?      |
| Revenue Presence Reality   | L1    | Does any sales value exist at all?       |
| Ingestion Presence Reality | L1    | Did data flow into the system?           |
| Temporal Freshness Reality | L1    | Is the data recent or stale?             |
| Revenue Continuity Reality | L1½   | Is sales activity isolated or ongoing?   |
| Data Coverage Reality      | L1    | Is source data structurally complete?    |
| Economic Visibility Gate   | L2    | Is interpretation epistemically allowed? |

📌 These domains surface **only** inside **Orders Overview**  
📌 They never re-appear elsewhere.

---

## Canonical Identifiers (Truth Ownership Clarification)

Orders FT2 operates on LaSyncro-owned canonical identifiers, not platform identifiers.

**Definitions:**

* **Canonical Order ID** — LaSyncro-stable order identity (already established)
* **Canonical Variant Code (CVC)** — LaSyncro-owned SKU-level identifier

**Rules:**

* Platform SKUs are advisory only
* Platform variant IDs are inputs, not identifiers
* All SKU-level truth in FT2 is anchored to Canonical Variant Code (CVC)

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

If CVC is absent, SKU-level revenue and obligations are not addressable.

In this state:

* SKU-level attribution is suppressed
* Revenue may surface **only as aggregate totals**
* FT2 may remain eligible **only if canonical product linkage exists**

This is intentional and epistemically strict.

### Canonical Identity Enforcement (NEW · HARD GATE)

Orders FT2 eligibility requires **full canonical identity resolution** at ingestion time.

**Hard Requirements:**

* Every `canonical_order_line_items` row **MUST** satisfy:
  * `canonical_variant_id IS NOT NULL`
  * `canonical_product_id IS NOT NULL`
* Variant → Product linkage is **resolved before FT2 evaluation**
* FT2 **never** infers, repairs, or backfills canonical identity

If any order line item lacks a canonical product reference:

* Orders FT2 is **blocked**
* Revenue aggregation is **disallowed**
* Execution-aware domains are **suppressed**

This behavior is intentional and non-recoverable inside FT2.

---

### 💰 B. Revenue Availability Domains (PRIMARY · L1)

**Owned exclusively by: Revenue Overview**

Answer:
> **“Where does the money exist right now?”**

| Domain                  | Layer | Question Answered                            |
|-------------------------|-------|----------------------------------------------|
| Total Sales Reality     | L1    | How much sales value exists in total?        |
| Earned Revenue Reality  | L1    | How much value is tied to fulfilled orders?  |
| Pending Revenue Reality | L1    | How much value is tied to open work?         |
| Blocked Revenue Reality | L1    | How much value is unavailable due to unresolved execution blockers? |

**Hard Rules (LOCKED):**

* Revenue here is **availability-based**, not accounting-based
* No payment, settlement, or margin semantics
* No recommendations or prioritization
* No execution diagnosis

#### Blocked Revenue Clarification (RE-SEALED)

Blocked Revenue represents **availability loss**, not failure.

**Definition:**
> Revenue tied to canonical orders that cannot progress toward fulfillment due to unresolved execution blockers, as determined by downgraded L2 classification.

**Rules:**

* Derived exclusively from evaluated SKU-level revenue units after:
  1. Canonical identity resolution
  2. L2 obligation classification
  3. Explicit downgrade to L1 aggregate
* Blocked Revenue cannot exist without:
  1. Revenue units
  2. Obligation evaluation
  3. Explicit downgrade to L1 aggregate
* If any layer is missing, Blocked Revenue must be zero or absent.
* Downgraded to L1 as **aggregate totals only**
* Never exposes blocker categories, causes, or actions
* May equal Pending Revenue in early or incomplete systems
* Decreases only when execution truth improves (not via UI logic)

Blocked Revenue is a **mirror of system readiness**, not a judgment.

Blocked Revenue in FT2 is a **downgraded signal**:

* Source: L2 obligation evaluation
* Exposure: L1 aggregate totals only
* Obligation categories are intentionally suppressed

FT2 never exposes *why* revenue is blocked — only *that* it is.

##### Obligation Coverage vs Attribution (NEW · HARD GATE)

Blocked Revenue is derived from **execution rows that are obligation-evaluable**.

**Important distinction:**

* **Coverage** answers: “Was this order evaluated for this obligation?”
* **Classification** answers: “Do we know which obligation caused the block?”

It is valid and expected for FT2 to surface:

* 100% obligation coverage
* 0% obligation attribution

This reflects epistemic honesty.

FT2 must prefer absence over fabrication.

Coverage without attribution is valid.  
Attribution without coverage is forbidden.

---

### 🔁 C. Reversal & Leakage Domains (PRIMARY · L1)

**Owned exclusively by: Returns Overview**

Answer:
> **“Is value flowing back or leaking?”**

| Domain                   | Layer | Question Answered                |
|--------------------------|-------|----------------------------------|
| Returns Presence Reality | L1    | Do returns exist?                |
| Returned Orders Reality  | L1    | How many orders reversed?        |
| Returned Value Reality   | L1    | How much value has exited?       |
| Return Exposure Reality  | L1    | How much value is still at risk? |

---

### ⚠️ D. Revenue Risk Domains (PRIMARY · L1)

**Owned exclusively by: Revenue Risk**

Answer:
> **“How fragile is my revenue shape?”**

| Domain                        | Layer | Question Answered                            |
|-------------------------------|-------|----------------------------------------------|
| Revenue Concentration Reality | L1    | Is revenue tied to few orders/customers?     |
| Top-Order Exposure Reality    | L1    | What is the largest single-order dependency? |
| Customer Dependency Reality   | L1    | Is revenue customer-concentrated?            |
| Temporal Clustering Reality   | L1½   | Is revenue time-clustered?                   |

---

### 🚚 E. Operational Flow Domains (PRIMARY · L1)

**Owned exclusively by: Operational Flow (CPT Lens)**

Answer:
> **“Where is value sitting in the workflow?”**

| Domain                   | Layer | Question Answered               |
|--------------------------|-------|---------------------------------|
| Receiving Reality        | L1    | What value has entered ops?     |
| Stored Value Reality     | L1    | What value is idle?             |
| Picking Reality          | L1    | What value is in motion?        |
| Packing Reality          | L1    | What value is near completion?  |
| Shipping Handoff Reality | L1    | What value should convert next? |

---

### 🧠 F. Execution Health Domains (PRIMARY · L1 / L1½)

**Owned exclusively by: Execution Health**

Answer:
> **“Is the system keeping up?”**

| Domain                     | Layer | Question Answered               |
|----------------------------|-------|---------------------------------|
| CPT Breach Reality         | L1    | Are orders past cutoff?         |
| Blocked Orders Reality     | L1    | How many orders are execution-obstructed (cause-agnostic)? |
| Aging Orders Reality       | L1½   | Are orders stagnating?          |
| Execution Velocity Reality | L1½   | Is throughput changing?         |

---

## 0.3 Alignment Planes (CONFIRMED · UNCHANGED)

Alignment planes remain:

* deterministic
* read-only
* fail-closed
* post-FTEP
* **non-narrative**

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

🚨 Execution-aware revenue enters **only at Layer 2** and may surface at L1 **only after explicit downgrade (e.g. Blocked Revenue totals).**

---

## 2. Revenue Semantics in FT2 (RE-CLARIFIED)

### Revenue in FT2 is

* observable
* availability-based
* execution-aware only via downgraded L2 aggregates
* derived from SKU-level revenue units

**Truth Source:**  
`order_revenue_units` is the sole revenue truth source for FT2.

**Precondition:**
Revenue units are valid **only if canonical identity is complete**:

* `canonical_variant_id` present
* `canonical_product_id` present
* Variant → Product join proven

If this precondition fails, revenue units may exist internally but are **not exposable** to FT2.

Revenue units are materialized, not inferred.  
Each unit represents factual SKU-level value.

If revenue units do not exist, FT2 must show zero, not estimates.

### Revenue in FT2 **is not**

* paid
* settled
* net
* profit
* margin
* collectible

---

## 3. Frontend Narrative Contract (UPDATED · SMB-LEGIBLE)

### InfoBlock: Orders Overview

**Rows (LOCKED):**

* Orders total
* Fulfilled orders
* Unfulfilled orders
* Incoming orders

**Footer Rail (LOCKED):**
> **ORDER OBLIGATIONS SHOWN — VALUE AND EXECUTION DETAILED ELSEWHERE**

---

### InfoBlock: Revenue Overview

**Rows (LOCKED):**

* Total sales
* Earned
* Pending
* Blocked *(if applicable)*

**Footer Rail (LOCKED):**
> **SALES VALUE SHOWN — EXECUTION AVAILABILITY ONLY**  
> **BLOCK CAUSES MAY BE UNATTRIBUTED**  
> **PAYMENT AND PROFIT NOT EVALUATED**  
> **SKU-LEVEL DETAIL REQUIRES CANONICAL VARIANT CODES (CVC)**  
> **MISSING CANONICAL IDENTIFIERS RESULT IN AGGREGATE-ONLY OR BLOCKED VISIBILITY**

---

## 4. Intentional Gaps (RE-CONFIRMED)

Orders FT2 intentionally excludes:

* profit
* margin math
* payment status
* accounting timelines
* recommendations
* causality
* prioritization
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

FT2 does not degrade gracefully under identity failure.
It fails closed by design.

## 🔐 FINAL SEAL — REV C

✔ InfoBlocks fully enumerated and owned  
✔ Revenue framed as *availability*, not jargon  
✔ SMB cognitive load respected  
✔ Phase 6 cleanly isolated  
✔ No semantic leakage  
✔ FT2 remains terminal  

🔒 **Order-Nexus FT2 Contract Audit — REV C.1 is current, aligned, and sealed.**

---
