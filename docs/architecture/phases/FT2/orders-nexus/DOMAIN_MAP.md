# 🔒 FT2 Orders-Nexus — DOMAIN_MAP

**CURRENT · ACTIVE · SEALED (v2)**

**Status:** ✅ UPDATED / SEALED
**Applies to:** Orders-Nexus FT2 (Orders, Fulfillment, Revenue, Returns)
**Scope:** Observable domains + alignment planes
**Apex Rule:** **FT2 is terminal. No FT3.**

---

## 0. Purpose (Re-stated)

This document defines **all observable domains** and **alignment planes** participating in **Orders-Nexus FT2**, structured explicitly to support:

* **InfoBlock-based narrative**
* **SMB cognitive scanning**
* **Truth-only exposure**
* **Cross-module consistency** (Orders ↔ Fulfillment ↔ Revenue ↔ Returns)

Each **domain** answers **exactly one factual question**.
Each **alignment plane** classifies **structural coherence only**.

No domain:

* explains
* recommends
* prioritizes
* predicts

---

## 1. Global FT2 Rules (Non-Negotiable)

* No analytics
* No causality
* No recommendations
* No prioritization
* Deterministic outputs
* Fail-closed semantics (`null` / `unknown`)
* Visibility gates everything
* **InfoBlock is the only narrative primitive**

---

## 2. Layering Model (CANONICAL)

| Layer    | Meaning                                      |
| -------- | -------------------------------------------- |
| **L1**   | Presence & factual observation               |
| **L1½**  | Time-scoped comparison / continuity          |
| **L2**   | Classification (intelligence, internal only) |
| **FT2**  | Downgraded exposure                          |
| **META** | Epistemic gating                             |

---

## 3. DOMAIN MAP — ORDERS-NEXUS (v2)

Domains are grouped by **InfoBlock responsibility**, not by storage or services.

---

## 🧭 A. SYSTEM GROUNDING REALITY (FOUNDATIONAL · SHARED)

> Answers: **“Is this system anchored in reality?”**
> Rendered primarily via **Orders Overview** and reused by other InfoBlocks.

| Domain                          | Layer | Question Answered                        | Status |
| ------------------------------- | ----- | ---------------------------------------- | ------ |
| **Order Presence Reality**      | L1    | Do orders exist in this period?          | ✅      |
| **Revenue Presence Reality**    | L1    | Does any revenue exist at all?           | ✅      |
| **Ingestion Presence Reality**  | L1    | Did LaSyncro observe data flowing?       | ✅      |
| **Temporal Freshness Reality**  | L1    | Is observed data recent or stale?        | ✅      |
| **Revenue Continuity Reality**  | L1½   | Is revenue isolated or continuous?       | ✅      |
| **Data Coverage Reality**       | L1    | Is source data structurally complete?    | ✅      |
| **Economic Visibility Reality** | L2    | Is interpretation epistemically allowed? | ✅      |
| **Temporal Scope Reality**      | META  | What time window applies?                | ✅      |

**Notes (LOCKED)**

* Ingestion ≠ platform health
* Freshness ≠ SLA
* Continuity ≠ trend
* Visibility ≠ quality judgment

---

## 📦 B. ORDERS OPERATIONAL REALITY

**Primary InfoBlock: *Orders Overview***

> Answers: **“What is the state of my order obligations?”**

| Domain                         | Layer | Question Answered              | Status |
| ------------------------------ | ----- | ------------------------------ | ------ |
| **Orders Total Reality**       | L1    | How many orders exist?         | ✅      |
| **Fulfilled Orders Reality**   | L1    | How many orders are fulfilled? | ✅      |
| **Unfulfilled Orders Reality** | L1    | How many orders remain open?   | ✅      |
| **Incoming Orders Reality**    | L1½   | Are new orders arriving?       | ✅      |

**Notes**

* Incoming orders = canonical window count (L1½)
* No SLA, no aging, no urgency semantics

---

## 🚚 C. FULFILLMENT & EXECUTION REALITY

**Primary InfoBlock: *Fulfillment Overview* (FT2-Paid / WMS-Lite)**

> Answers: **“Are orders operationally executable?”**

| Domain                              | Layer | Question Answered                  | Status |
| ----------------------------------- | ----- | ---------------------------------- | ------ |
| **Fulfillment Presence Reality**    | L1    | Do fulfillment records exist?      | ✅      |
| **Fulfillment Status Reality**      | L1    | Fulfilled / partial / unfulfilled? | ✅      |
| **Fulfillment Operational Reality** | L2    | Is execution structurally real?    | ✅      |
| **Receiving / Storing Reality**     | L1    | Are orders entering storage?       | ⏳      |
| **Picking / Packing Reality**       | L1    | Are orders being prepared?         | ⏳      |
| **Shipping Execution Reality**      | L1    | Are shipments occurring?           | ✅      |

**Explicit exclusions**

* No SLA
* No duration
* No blame
* No worker performance

---

## 💰 D. REVENUE & ECONOMIC REALITY

**Primary InfoBlock: *Revenue Overview***

> Answers: **“Is money structurally present and flowing?”**

| Domain                          | Layer | Question Answered          | Status |
| ------------------------------- | ----- | -------------------------- | ------ |
| **Revenue Presence Reality**    | L1    | Does revenue exist?        | ✅      |
| **Revenue Continuity Reality**  | L1½   | Is revenue persistent?     | ✅      |
| **Economic Outcome Reality**    | L2    | Positive / negative?       | ✅      |
| **Economic Visibility Reality** | L2    | Is interpretation allowed? | ✅      |

**Out-of-scope (by design)**

* Profit
* Margin explanation
* Fees
* Cash timing

---

## 🔁 E. RETURNS & REVERSAL REALITY

**Primary InfoBlock: *Returns Overview***

> Answers: **“Is value flowing back or leaking?”**

| Domain                             | Layer | Question Answered              | Status |
| ---------------------------------- | ----- | ------------------------------ | ------ |
| **Returns Presence Reality**       | L1    | Do returns exist?              | ⏳      |
| **Return Volume Reality**          | L1    | How many orders returned?      | ⏳      |
| **Return Velocity Reality**        | L1½   | Are returns accelerating?      | ⏳      |
| **Return Economic Impact Reality** | L2    | Is value reversing materially? | ⏳      |

**Notes**

* No blame
* No cause
* No recommendations

---

## 4. ALIGNMENT PLANES — ORDERS-NEXUS FT2

Alignment planes classify **structural coherence only**.

---

### 🔒 META PLANE

| Plane                  | Domains            | Status |
| ---------------------- | ------------------ | ------ |
| **Cross-Domain Trust** | All active domains | ✅      |

---

### 🧭 COMMERCIAL & ECONOMIC PLANES

| Plane                      | Domains                       | Status |
| -------------------------- | ----------------------------- | ------ |
| **Demand Reality**         | Customers ↔ Orders            | ✅      |
| **Engagement ↔ Revenue**   | Engagement ↔ Orders ↔ Revenue | ✅      |
| **Operational ↔ Economic** | Orders ↔ Fulfillment          | ✅      |

---

### 🚚 EXECUTION & LOGISTICS PLANES

| Plane                                 | Domains                    | Status |
| ------------------------------------- | -------------------------- | ------ |
| **Order Velocity ↔ Fulfillment**      | Velocity ↔ Execution       | ✅      |
| **Shipping ↔ Fulfillment Coherence**  | Shipping ↔ Fulfillment     | ✅      |
| **Sales ↔ Operations**                | Velocity ↔ Status          | ✅      |
| **Orders ↔ Shipping Carrier**         | Orders ↔ Shipping Presence | ✅      |
| **Shipping Delay ↔ Fulfillment**      | Delay ↔ Execution          | ✅      |
| **Shipping Delay ↔ Customer Promise** | Delay ↔ Promise            | ✅      |

**Invariant:**

> Alignment = consistency, not performance, not explanation.

---

## 5. Design Constraints (LOCKED)

* One domain → one question
* One InfoBlock → one cognitive scan
* Unknown propagates aggressively
* Visibility gates everything
* No UI-driven semantics
* No cross-plane inference

---

## 6. What This Enables (Without Analytics)

* “Do I have orders?”
* “Is money present and continuous?”
* “Are things getting executed?”
* “Is value reversing via returns?”
* “Is the system coherent enough to trust?”

All **without**:

* dashboards
* scores
* alerts
* recommendations
* AI narratives

---

## 🔐 FINAL SEAL (v2)

* DOMAIN_MAP now InfoBlock-aligned
* Fulfillment, Revenue, Returns formally integrated
* Future WMS-Lite domains pre-scaffolded (⏳)
* No scope leakage into FT3 fantasies
* Matches **actual resolver + UI architecture**

🔒 **FT2 Orders-Nexus DOMAIN_MAP v2 is current, aligned, and sealed.**

---

If you want next, we can:

* generate **one canonical InfoBlock per domain group** (Orders / Fulfillment / Revenue / Returns), or
* extract a **cross-product FT2 domain taxonomy** so Inventory, Customers, and Finance snap in cleanly.