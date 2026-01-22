# 🔒 Inventory FT2 — Canonical Blueprint (LaSyncro)

**Module:** Inventory
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed
**Applies to:** Backend · Architecture · Product · UI · Monetization

---

## 0. Prime Intent (Non-Negotiable)

Inventory FT2 exists to expose **physical stock reality** as it *can be known*, not as it is wished to be.

Inventory FT2:

* ❌ does not optimize stock
* ❌ does not forecast demand
* ❌ does not recommend replenishment
* ❌ does not explain shortages

Inventory FT2 **only** answers:

> **“Does inventory exist, is it observable, and does it agree with the rest of reality?”**

FT2 is the ceiling. There is no FT3.

---

## 1. Truth Ownership (Locked)

### Inventory FT2 Owns Truth About

* Stock presence (existence only)
* Inventory observability
* Coverage sufficiency
* Structural coherence with:

  * Orders
  * Products / SKU-OS
  * Fulfillment
  * Returns (when paid)

### Inventory FT2 Explicitly Does NOT Own

* Reorder points
* Safety stock
* Demand signals
* Turnover metrics
* Aging analysis
* Warehouse efficiency

---

## 2. Canonical 4-Layer FT2 Architecture

```
Persistence (inventory snapshots, movements)
   ↓
Layer 1 — Inventory Facts
   ↓
Layer 2 — Inventory Intelligence (internal only)
   ↓
Layer 3 — Inventory FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Inventory FT2 API
   ↓
Adapters (pure)
   ↓
Observational UI
```

**Invariants:**

* No layer may be skipped
* No layer may enrich another
* Intelligence never leaks
* FTEP is the sole exposure gate

---

## 3. Layer 1 — Inventory Facts (Observable Truth)

Facts are **raw, dumb, nullable**.
They describe existence, not meaning.

### Core Facts

* `inventoryObserved`
* `inventoryRecordsPresent`
* `skusWithInventoryCount`
* `skusWithoutInventoryCount`
* `locationsObserved`

### Coverage Facts

* `inventoryCoveragePct | null`
* `skuCoveragePct | null`

### Coherence Input Facts (No Judgment)

* `ordersReferencingMissingStockPresent`
* `productsWithoutInventorySignalPresent`
* `fulfillmentWithoutStockSignalPresent`

**Rules:**

* No ratios exposed
* No thresholds
* `null` means no observable truth

---

## 4. Layer 2 — Inventory Intelligence (Internal Only)

### Purpose

Classify **structural meaning** internally across independent dimensions.

### Allowed Internal Classifications

* `inventory.visibility`: `sufficient | insufficient | unknown`
* `inventory.coherence.orders`: `coherent | incoherent | unknown`
* `inventory.coherence.products`: `coherent | incoherent | unknown`
* `inventory.coherence.fulfillment`: `coherent | incoherent | unknown`

### Hard Rules

* Intelligence is never exposed
* Missing facts collapse to `unknown`
* No cross-dimension inference

---

## 5. Layer 3 — Inventory FTEP (Truth Exposure Policy)

### Purpose

Downgrade internal intelligence into **FT2-safe exposure**.

### Exposed FT2 Signals (Only)

* `inventoryPresence: boolean | null`
* `inventoryVisibility: sufficient | insufficient | null`
* `inventoryCoverage: number | null`
* `ordersInventoryCoherence: aligned | divergent | null`
* `productsInventoryCoherence: aligned | divergent | null`
* `fulfillmentInventoryCoherence: aligned | divergent | null`

### Mandatory Downgrades

* `unknown → null`
* No intelligence enums exposed directly

---

## 6. Inventory FT2 — Free vs Paid

### FT2 Free

* Inventory presence
* Inventory visibility (downgraded)
* Explicit blindness (`null`)
* Short time window

### FT2 Paid

* Longer historical window
* Higher coverage eligibility
* Alignment surfaces enabled

**Paid removes blindness. Paid never adds truth.**

---

## 7. Alignment Planes (Post-FTEP)

Alignment planes classify **structural agreement only**.

### Active Planes

* Inventory ↔ Orders
* Inventory ↔ Products
* Inventory ↔ Fulfillment
* Inventory ↔ Returns (paid)
* Cross-Domain Trust (META)

**Rules:**

* Deterministic
* Read-only
* Fail closed
* No explanation

---

## 8. UI Contract (Inventory FT2)

* Observational only
* Null-safe everywhere
* No prioritization
* No alerts
* No recommendations

Render states:

* `null` → `—`
* `unknown` → `—`
* `insufficient` → literal string

---

## 9. Explicit Non-Capabilities (Sealed)

Inventory FT2 contains **no**:

* Stock optimization
* Reorder logic
* Forecasting
* KPI scoring
* Efficiency metrics
* Action triggers

---

## 🔐 Final Seal

Inventory FT2 completes **physical reality observability** inside LaSyncro.

It does not tell SMBs how to manage stock.
It makes **stock-related self-deception impossible**.

This blueprint is **canonical and locked**.
Any deviation requires explicit RFC and consortium review.