# 🔒 Order-Nexus FT2 Contract Audit (CURRENT · ACTIVE)

**Status:** ✅ COMPLETE / SEALED
**Scope:** Order-Nexus FT2 — Backend + Frontend
**Standard:** Truth-only · Scan-verified · Read-only
**Audit Type:** Structural + Semantic Contract Audit
**Apex Rule:** **FT2 is the final product layer. There is no FT3.**

---

## 0. Contract Definition — What “Orders FT2” Is (Precisely)

**Orders FT2** is a **read-only economic & operational orientation surface** for SMBs, designed to answer:

> **“Is my system real, flowing, coherent, and directionally stable right now?”**

It is composed of:

1. **Authoritative FT2 Snapshot (downgraded truth only)**
2. **Two Core Orientation Surfaces**

   * System Grounding & Economic Reality
   * Direction & System Coherence
3. **FT2-Adjacent Exploratory Surfaces**

   * Time series
   * Distribution
4. **Cross-Domain Alignment Planes**
5. **Strict Frontend Consumption Path**

   * Snapshot hooks
   * Pure adapters
   * Observational UI primitives only

FT2 **never** answers:

> “Why”, “what to do”, “what will happen”, or “what matters most”.

---

### Explicit Non-Capabilities (Hard-Locked)

Orders FT2 contains **no**:

* lifecycle mutation
* remediation logic
* recommendations
* explanations
* causation
* forecasting
* prioritization
* user instruction
* escalation logic

If any of the above appear, the contract is broken.

---

## 0.1 Active Domains (UPDATED · CURRENT)

Orders FT2 now exposes **three classes of domains**, explicitly grouped and surfaced.

---

### 🧭 A. System Grounding Domains (FOUNDATIONAL · L1)

These answer a single prerequisite question:

> **“Is this system anchored in reality?”**

| Domain                     | Layer | Question Answered                            |
| -------------------------- | ----- | -------------------------------------------- |
| Order Presence Reality     | L1    | Do any orders exist in this period?          |
| Revenue Presence Reality   | L1    | Does revenue exist at all?                   |
| Ingestion Presence Reality | L1    | Did LaSyncro observe data flowing?           |
| Temporal Freshness Reality | L1    | Is the observed data recent or stale?        |
| Revenue Continuity Reality | L1½   | Is revenue isolated or continuous over time? |
| Data Coverage Reality      | L1    | Is source data structurally complete?        |
| Economic Visibility Gate   | L2    | Is interpretation epistemically allowed?     |

**Rules (non-negotiable):**

* Presence-only unless stated
* No inference
* No explanation
* Fail closed (`null` / `unknown`)
* Absence ≠ zero ≠ false

These domains are surfaced together as **Core Surface A**.

---

### 🧭 B. Direction & Coherence Domains (POST-GROUNDING · L1½ / L2)

These only become meaningful **after grounding is satisfied**.

| Domain                   | Layer | Question Answered                             |
| ------------------------ | ----- | --------------------------------------------- |
| Economic Outcome Reality | L2    | Are orders economically positive or negative? |
| Order Velocity Reality   | L1½   | Is order volume up / down / flat?             |
| Market Coherence Reality | L-X   | Are demand & revenue structurally aligned?    |
| Execution Coherence      | L-X   | Are operations & economics aligned?           |

These domains are surfaced together as **Core Surface B**.

---

### 🧭 C. Fulfillment & Logistics Domains (L1 / L2)

These domains **exist in the snapshot and alignment planes**, but are **not rendered directly** in OrdersModuleFT2 UI:

* Fulfillment Presence
* Fulfillment Status
* Fulfillment Operational Reality
* Shipping Presence
* Shipping Delay Presence
* Customer Promise Presence

They participate **only through alignment planes**.

---

## 0.2 Alignment Planes (ACTIVE · UNCHANGED)

Alignment planes classify **structural coherence only**.
They never create truth.

| Plane                                  | Participating Domains         | Status |
| -------------------------------------- | ----------------------------- | ------ |
| Cross-Domain Trust (META)              | All domains                   | ✅      |
| Demand Reality                         | Customers ↔ Orders            | ✅      |
| Engagement ↔ Revenue                   | Engagement ↔ Orders ↔ Finance | ✅      |
| Operational ↔ Economic                 | Orders ↔ Fulfillment          | ✅      |
| Order Velocity ↔ Fulfillment           | Orders ↔ Fulfillment          | ✅      |
| Shipping ↔ Fulfillment Coherence       | Shipping ↔ Fulfillment        | ✅      |
| Sales ↔ Operations                     | Velocity ↔ Fulfillment Status | ✅      |
| Orders ↔ Shipping Carrier              | Orders ↔ Shipping Presence    | ✅      |
| Shipping Delay ↔ Fulfillment Coherence | Shipping Delay ↔ Fulfillment  | ✅      |
| Shipping Delay ↔ Customer Promise      | Shipping Delay ↔ Promise      | ✅      |

**Alignment invariants:**

* Execute **after FTEP**
* Deterministic
* Read-only
* Fail closed (`unknown`)
* No causality
* No remediation
* No narrative

---

## 1. Proven Architectural Flow (SEALED)

```
Canonical Database
   ↓
Layer 1 — Canonical Facts
   ↓
Layer 1½ — Temporal Facts (Velocity, Continuity)
   ↓
Layer 2 — Intelligence (ACTIVE, INTERNAL ONLY)
   ↓
Layer 3 — FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Alignment Planes (Read-only)
   ↓
Order-Nexus FT2 Snapshot (Backend Output)
```

**Critical invariants:**

* Intelligence NEVER bypasses FTEP
* Alignment NEVER feeds intelligence
* FT2 is terminal

---

## 2. Layer 1 — Canonical Facts (Truth)

### Order Facts

**Tables**

* `canonical_orders`
* `canonical_order_line_items`

| Field             | Type          | Semantics             |
| ----------------- | ------------- | --------------------- |
| `ordersObserved`  | number | null | null if no rows       |
| `revenueTotal`    | number | null | DB sum                |
| `costTotal`       | null          | Non-existent fact     |
| `currency`        | null          | Not inferable in FT2  |
| `dataCoveragePct` | number | null | Null if no line items |
| `extractedAt`     | ISO string    | Snapshot timestamp    |

---

### Ingestion Presence Reality (NEW · FORMALIZED)

**Derived from:**

* `ordersObserved`
* existence of canonical rows in period

| Value   | Meaning                     |
| ------- | --------------------------- |
| present | ≥1 canonical fact observed  |
| absent  | no canonical facts observed |
| null    | not evaluable               |

---

### Temporal Freshness Reality (NEW · FORMALIZED)

**Derived from:**

* FT2 date range
* most recent `order_created_at`

| Value   | Meaning                  |
| ------- | ------------------------ |
| recent  | within freshness window  |
| stale   | outside freshness window |
| unknown | not evaluable            |

No SLA.
No duration.
No blame.

---

### Revenue Continuity Reality (NEW · FORMALIZED · L1½)

**Derived from:**

* OrderTrendFacts windowed counts

| Value      | Meaning                     |
| ---------- | --------------------------- |
| continuous | revenue present in sequence |
| isolated   | one-off / discontinuous     |
| null       | insufficient data           |

This is **not** a trend.

---

## 3. Layer 2 — Intelligence (INTERNAL ONLY)

Intelligence **may think**, but **may not speak directly**.

| Output              | Type                                |
| ------------------- | ----------------------------------- |
| `margin.status`     | healthy / loss / unknown            |
| `trend.direction`   | up / down / flat / unknown          |
| `visibility.status` | sufficient / insufficient / unknown |

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

**Mandatory downgrade rules:**

| Internal Signal | FT2 Exposure |
| --------------- | ------------ |
| `unknown`       | `null`       |
| active          | downgraded   |

No intelligence leaks. Ever.

---

## 5. FT2 Snapshot (Backend Output)

Snapshot contains **only**:

* `context`
* `totals`
* `outcome | null`
* `trend | null`
* `dataCoverage`
* `visibility | null`
* `shipping` (presence-only)
* `alignment` (read-only)

No currency.
No costs.
No upgrades.

---

## 6. Trust FT2 (ACTIVE · INTEGRATED)

Trust is a **boundary, not a message**.

**Source:** `/api/v1/modules/trust/ft2`

```ts
{ trustEligible: boolean | null }
```

### UI Interpretation (LOCKED)

| trustEligible | trustTone   |
| ------------- | ----------- |
| true          | trusted     |
| false         | blocked     |
| null          | constrained |
| trust null    | no bar      |

Applied uniformly to **all surfaces** in OrdersModuleFT2.

---

## 7. OrdersModuleFT2 — UI Composition (UPDATED)

### Core Surface A — System Grounding & Economic Reality

* Orders
* Revenue + Continuity
* Data Health (coverage + visibility)
* System Flow (ingestion + freshness)

### Core Surface B — Direction & System Coherence

* Outcome & Direction
* Market Coherence
* Execution Coherence

### Optional Surface C — Activity Shape (Exploratory)

* Orders over time
* Order size distribution

**No other surfaces exist.**

---

## 8. Frontend Consumption Contract (SEALED)

### Snapshot Hook

* Read-only
* Backend-authoritative
* Range-controlled

### Adapters

* Pure functions
* `undefined → null`
* No inference
* No lifecycle logic

Adapters are **pipes**, not brains.

---

## 9. FT2 UI Invariants (UNCHANGED)

* Observational only
* Null-safe everywhere
* No semantics
* No prioritization
* No explanations
* No recommendations

UI **cannot upgrade truth**.

---

## 10. Intentional Gaps (CONFIRMED)

* No SLA math
* No delay duration
* No profit
* No recommendations
* No causality
* No FT3

These are **design constraints**, not missing features.

---

## 11. Final Seal (UPDATED)

* System grounding formalized
* Revenue continuity introduced correctly
* Trust integrated per playbook
* Geometry simplified without semantic loss
* Cognitive load reduced without lying
* FT2 confirmed as apex

🔐 **Order-Nexus FT2 is fully audited, synchronized, and sealed — CURRENT STATE.**

---
