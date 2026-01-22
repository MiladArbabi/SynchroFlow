# 🧱 SKU Integrity FT2 — 4-Layer Architecture

**Module:** Products / SKU-OS
**Submodule:** SKU Integrity (Gaps & Deviations)
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed

---

## 0. Purpose of This Document

This document defines the **mandatory four-layer architecture** for the SKU Integrity FT2 submodule.

Its purpose is to:

* Enforce SKU-level observability without remediation
* Prevent issue-tracking, ranking, or workflow semantics
* Guarantee deterministic, policy-safe exposure of structural deviation

If any layer is skipped, merged, or bypassed, **SKU Integrity FT2 is invalid**.

---

## 1. Canonical FT2 Layering (Non-Negotiable)

```
Persistence
   ↓
Layer 1 — SKU Integrity Facts
   ↓
Layer 2 — SKU Integrity Intelligence (INTERNAL)
   ↓
Layer 3 — SKU Integrity FTEP (Truth Exposure Policy)
   ↓
Layer 4 — SKU Integrity FT2 API
```

**Absolute invariants:**

* Downward-only data flow
* No upward mutation
* No sideways enrichment
* Only Layer 3 may decide exposure

---

## 2. Persistence Layer (Pre-FT2)

### Role

Store **raw product-, SKU-, inventory-, order-, and fulfillment-level observations**.

### Characteristics

* Read-only snapshots or append-only events
* No interpretation
* No ranking
* No lifecycle logic

### Typical Inputs (Illustrative)

* Product master records
* SKU definitions
* Inventory snapshots
* Order line items
* Fulfillment records

> Persistence is **not truth**. It is **potential truth**.

---

## 3. Layer 1 — SKU Integrity Facts

### Role

Expose **observable SKU-level deviation signals** as raw, nullable facts.

Facts answer:

> *“Do structural or operational deviations exist at SKU level?”*

### Properties

* Presence-only
* Primitive values
* Nullable everywhere
* No severity semantics

### Fact Categories

#### Structural Facts

* structuralInconsistenciesPresent
* skusReferencedWithoutProductPresent

#### Inventory Facts

* inventoryMismatchPresent
* inventoryRecordsWithoutSkuReferencePresent

#### Fulfillment Facts

* fulfillmentConflictPresent
* fulfilledSkusWithoutInventoryReferencePresent

#### Economic Observability Facts

* costVisibilityGapPresent
* skusWithRevenueButNoCostPresent

### Hard Rules

* No counts exposed
* No ratios
* Absence ≠ false ≠ zero

---

## 4. Layer 2 — SKU Integrity Intelligence (Internal Only)

### Role

Classify **structural coherence** across SKU dimensions.

Intelligence answers:

> *“Are SKU realities structurally coherent across domains?”*

### Allowed Internal Dimensions

* sku.structure.coherence
* sku.inventory.coherence
* sku.fulfillment.coherence
* sku.cost.visibility

### Allowed Values

* coherent / incoherent / unknown
* sufficient / insufficient / unknown

### Prohibitions

* No prioritization
* No remediation logic
* No persistence
* No UI exposure

> Intelligence may decide. Intelligence may never speak.

---

## 5. Layer 3 — SKU Integrity FTEP (Truth Exposure Policy)

### Role

Act as the **truth firewall** for SKU deviation reality.

### Inputs

* SKU Integrity Facts
* SKU Integrity Intelligence
* Trust / Coverage eligibility

### Mandatory Downgrade Rules

* unknown → null
* insufficient → null
* partial coherence → null

### FT2-Allowed Output Surface

* structuralDeviationPresent
* inventoryDeviationPresent
* fulfillmentDeviationPresent
* costVisibilityGapPresent
* skuCoverageSufficient

No other fields may pass.

---

## 6. Layer 4 — SKU Integrity FT2 API

### Role

Expose **read-only, deterministic FT2 truth** to consumers.

### Properties

* Read-only
* Versioned
* Deterministic
* FTEP-enforced
* No lifecycle logic

### Example Endpoint (Illustrative)

```
GET /api/v1/products/sku-integrity/ft2
```

Lifecycle state affects **availability**, never **truth**.

---

## 7. Adapter & UI Boundary (Post-FT2)

### Adapter Rules

* Pure functions only
* undefined → null
* No defaults
* No reshaping

### UI Rules

* Observational only
* No ranking
* No CTAs
* No remediation language

---

## 8. Architectural Failure Modes (Explicit)

SKU Integrity FT2 is **invalid** if:

* Issues are ranked or sorted by severity
* Ownership or responsibility is implied
* UI suggests actions
* FTEP is bypassed

Violation requires rollback, not iteration.

---

## 🔐 Final Seal

This four-layer architecture locks SKU deviation into **pure observability**.

It preserves product truth by refusing to convert gaps into tasks.

SKU Integrity FT2 remains silent, factual, and trustworthy — by design.
