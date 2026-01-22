# 🧱 Inventory FT2 — 4‑Layer Architecture

**Module:** Inventory
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium‑Sealed

---

## 0. Purpose of This Document

This document defines the **mandatory four‑layer architecture** for the Inventory FT2 module.

It exists to:

* Prevent semantic leakage
* Enforce epistemic discipline
* Guarantee deterministic, auditable truth exposure

If any layer is skipped, merged, or bypassed, **Inventory FT2 is invalid**.

---

## 1. Canonical FT2 Layering (Non‑Negotiable)

```
Persistence
   ↓
Layer 1 — Inventory Facts
   ↓
Layer 2 — Inventory Intelligence (INTERNAL)
   ↓
Layer 3 — Inventory FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Inventory FT2 API
```

**Absolute invariants:**

* Data flows strictly downward
* No upward mutation
* No sideways enrichment
* Only Layer 3 may decide exposure

---

## 2. Persistence Layer (Pre‑FT2)

### Role

Store **raw inventory observations** and **movement records** from upstream systems.

### Characteristics

* Append‑only or snapshot‑based
* No interpretation
* No joins for meaning
* No thresholds

### Typical Inputs (Illustrative)

* Inventory snapshots per SKU / location
* Stock movement events (in / out)
* Warehouse location references

> Persistence is **not truth**. It is **potential truth**.

---

## 3. Layer 1 — Inventory Facts

### Role

Expose **observable inventory reality** as raw, nullable facts.

Facts answer:

> *“What can be observed to exist?”*

### Properties

* Primitive values only
* Nullable everywhere
* No inference
* No aggregation for meaning

### Fact Categories

#### Presence Facts

* inventoryObserved
* inventoryRecordsPresent

#### Structural Facts

* skusWithInventoryCount
* skusWithoutInventoryCount
* locationsObserved

#### Coverage Facts

* inventoryCoveragePct | null
* skuCoveragePct | null

#### Cross‑Domain Input Facts

* ordersReferencingMissingStockPresent
* productsWithoutInventorySignalPresent
* fulfillmentWithoutStockSignalPresent

### Hard Rules

* Counts may exist internally
* Counts must **never** be exposed
* Absence ≠ zero ≠ false

---

## 4. Layer 2 — Inventory Intelligence (Internal Only)

### Role

Classify **structural meaning** from facts without exposing it.

Intelligence answers:

> *“What is structurally true, if facts are trusted?”*

### Allowed Internal Dimensions

* inventory.visibility
* inventory.coherence.orders
* inventory.coherence.products
* inventory.coherence.fulfillment

### Allowed Values

* sufficient / insufficient / unknown
* coherent / incoherent / unknown

### Prohibitions

* No persistence
* No UI access
* No API exposure
* No cross‑dimension inference

> Intelligence may decide. Intelligence may never speak.

---

## 5. Layer 3 — Inventory FTEP (Truth Exposure Policy)

### Role

Act as the **truth firewall**.

This is the **only layer** allowed to decide:

* what is exposed
* how it is downgraded
* when silence is required

### Inputs

* Inventory Facts
* Inventory Intelligence
* Trust / Coverage eligibility

### Mandatory Downgrade Rules

* unknown → null
* insufficient → null
* no partial upgrades

### FT2‑Allowed Output Surface

* inventoryPresence
* inventoryVisibility
* inventoryCoverage
* ordersInventoryCoherence
* productsInventoryCoherence
* fulfillmentInventoryCoherence

No other fields may pass.

---

## 6. Layer 4 — Inventory FT2 API

### Role

Expose **read‑only, deterministic FT2 truth** to consumers.

### Properties

* Read‑only
* Versioned
* Deterministic
* FTEP‑enforced
* No lifecycle logic

### Example Endpoint (Illustrative)

```
GET /api/v1/inventory/ft2
```

Lifecycle state affects **availability**, never **truth**.

---

## 7. Adapter & UI Boundary (Post‑FT2)

### Adapter Rules

* Pure functions only
* undefined → null
* No defaults
* No reshaping

### UI Rules

* Observational only
* Equal visual weight
* No prioritization
* No alerts

---

## 8. Architectural Failure Modes (Explicit)

Inventory FT2 is **invalid** if:

* Facts are interpreted directly
* Intelligence leaks
* UI infers meaning
* Counts are exposed
* FTEP is bypassed

Violation requires rollback, not iteration.

---

## 🔐 Final Seal

This four‑layer architecture is **mandatory** for Inventory FT2.

It ensures:

* Truth is observable
* Meaning is contained
* Blindness is explicit

Inventory FT2 remains **boring, factual, and trustworthy** — by design.