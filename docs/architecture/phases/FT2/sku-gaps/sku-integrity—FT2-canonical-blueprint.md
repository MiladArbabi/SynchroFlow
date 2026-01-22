# 🔒 SKU Integrity FT2 — Canonical Blueprint (Products Submodule)

**Module:** Products / SKU-OS
**Submodule:** SKU Integrity (Gaps & Deviations)
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed
**Entitlement:** Paid-only (removes blindness)

---

## 0. Prime Intent (Non-Negotiable)

SKU Integrity FT2 exists to expose **structural and operational deviations at SKU level** as they are observable — without diagnosing causes or recommending fixes.

SKU Integrity FT2:

* ❌ does not rank problems
* ❌ does not assign ownership
* ❌ does not recommend remediation
* ❌ does not score severity

SKU Integrity FT2 answers only:

> **“Do SKU-level structural or operational deviations exist, and are they coherent with product, inventory, fulfillment, and economic reality?”**

FT2 is the ceiling. There is no FT3.

---

## 1. Truth Ownership (Locked)

### SKU Integrity FT2 Owns Truth About

* Structural inconsistencies at SKU level
* Inventory mismatches at SKU level
* Fulfillment conflicts involving SKUs
* Cost visibility gaps per SKU
* Coverage sufficiency of SKU data
* Structural coherence with:

  * Products
  * Inventory
  * Orders
  * Fulfillment

### SKU Integrity FT2 Explicitly Does NOT Own

* Root causes
* Severity ordering
* Responsibility assignment
* Optimization logic
* Workflow orchestration

---

## 2. Canonical 4-Layer FT2 Architecture

```
Persistence (product, sku, inventory, order joins)
   ↓
Layer 1 — SKU Integrity Facts
   ↓
Layer 2 — SKU Integrity Intelligence (INTERNAL)
   ↓
Layer 3 — SKU Integrity FTEP (Truth Exposure Policy)
   ↓
Layer 4 — SKU Integrity FT2 API
   ↓
Adapters (pure)
   ↓
Observational UI
```

**Invariants:**

* No layer may be skipped
* Intelligence never leaks
* FTEP is the sole exposure gate

---

## 3. Layer 1 — SKU Integrity Facts (Observable Truth)

Facts are **existence-only**, **nullable**, and **non-semantic**.

### Core Facts

* `structuralInconsistenciesPresent`
* `inventoryMismatchPresent`
* `fulfillmentConflictPresent`
* `costVisibilityGapPresent`
* `skuCoverageInsufficient`

### Cross-Domain Input Facts

* `skusReferencedByOrdersWithoutProductRecordPresent`
* `inventoryRecordsWithoutSkuReferencePresent`
* `fulfilledSkusWithoutInventoryReferencePresent`
* `skusWithRevenueButNoCostPresent`

**Rules:**

* No counts exposed
* No ratios
* Absence ≠ zero ≠ false

---

## 4. Layer 2 — SKU Integrity Intelligence (Internal Only)

### Purpose

Classify **structural coherence** of SKU reality.

### Allowed Internal Classifications

* `sku.structure.coherence`: `coherent | incoherent | unknown`
* `sku.inventory.coherence`: `coherent | incoherent | unknown`
* `sku.fulfillment.coherence`: `coherent | incoherent | unknown`
* `sku.cost.visibility`: `sufficient | insufficient | unknown`

### Hard Rules

* Intelligence never exposed
* Missing facts collapse to `unknown`
* No cross-dimension inference

---

## 5. Layer 3 — SKU Integrity FTEP (Truth Exposure Policy)

### Purpose

Downgrade internal classifications into **FT2-safe exposure**.

### Exposed FT2 Signals (Only)

* `structuralDeviationPresent: boolean | null`
* `inventoryDeviationPresent: boolean | null`
* `fulfillmentDeviationPresent: boolean | null`
* `costVisibilityGapPresent: boolean | null`
* `skuCoverageSufficient: boolean | null`

### Mandatory Downgrades

* `unknown → null`
* Partial coherence → `null`

---

## 6. SKU Integrity FT2 — Entitlement Rules

SKU Integrity FT2 is **paid-only**.

### Rationale

* Requires cross-domain joins
* Exposes uncomfortable structural truth
* Removes blindness without prescribing action

Free tier renders all SKU integrity signals as `null`.

---

## 7. Alignment Planes (Post-FTEP)

Alignment planes classify **structural agreement only**.

### Active Planes

* SKU ↔ Products
* SKU ↔ Inventory
* SKU ↔ Orders
* SKU ↔ Fulfillment
* Cross-Domain Trust (META)

---

## 8. UI Contract (SKU Integrity FT2)

* Observational only
* No ranking
* No severity
* No CTAs
* No remediation language

Render states:

* `null` → `—`
* `unknown` → `—`
* `insufficient` → literal string

---

## 9. Explicit Non-Capabilities (Sealed)

SKU Integrity FT2 contains **no**:

* Issue lists
* Priority queues
* Fix recommendations
* Ownership assignment
* Alerting

---

## 🔐 Final Seal

SKU Integrity FT2 exposes **structural deviation without interpretation**.

It prevents SMBs from acting on false assumptions about product integrity.

This blueprint is **canonical and locked**.
Any deviation requires explicit RFC and consortium review.
