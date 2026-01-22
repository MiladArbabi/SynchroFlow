# 🔒 Inventory FT2 — DOMAIN_MAP (Canonical)

**Module:** Inventory
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed
**Scope:** Observable physical stock reality only

---

## 0. Purpose (Read First)

This document defines **all allowed Inventory FT2 domains**.

Each domain:

* answers **exactly one factual question**
* is presence-first
* is independently observable
* may fail closed (`null` / `unknown`)

No other Inventory domains may exist.

---

## 1. Inventory FT2 Layering Reference

| Layer | Meaning                                |
| ----- | -------------------------------------- |
| L1    | Presence & raw observation             |
| L2    | Internal classification (intelligence) |
| FT2   | Downgraded exposure only               |
| META  | Epistemic gating & trust               |

---

## 2. Canonical Inventory Domains (LOCKED)

### 🧱 Core Physical Reality

### **Domain 1 — Inventory Presence Reality (L1)**

**Question:** Does any inventory exist?
**Owns:** Physical stock existence
**FT2 Signal:** `inventoryPresence: boolean | null`

---

### **Domain 2 — Inventory Observability Reality (L1)**

**Question:** Is inventory observable in this system?
**Owns:** Visibility of stock records
**FT2 Signal:** `inventoryVisibility: sufficient | insufficient | null`

---

### **Domain 3 — Inventory Coverage Reality (L1)**

**Question:** Is inventory coverage sufficient to interpret reality?
**Owns:** Coverage sufficiency
**FT2 Signal:** `inventoryCoverage: number | null`

---

### 🔗 Cross-Domain Coherence

### **Domain 4 — Inventory ↔ Orders Coherence Reality (L2 → FT2)**

**Question:** Does inventory agree with order reality?
**Owns:** Structural agreement with orders
**FT2 Signal:** `ordersInventoryCoherence: aligned | divergent | null`

---

### **Domain 5 — Inventory ↔ Products Coherence Reality (L2 → FT2)**

**Question:** Does inventory agree with product structure?
**Owns:** Structural agreement with products / SKUs
**FT2 Signal:** `productsInventoryCoherence: aligned | divergent | null`

---

### **Domain 6 — Inventory ↔ Fulfillment Coherence Reality (L2 → FT2)**

**Question:** Does inventory agree with fulfillment reality?
**Owns:** Structural agreement with fulfillment signals
**FT2 Signal:** `fulfillmentInventoryCoherence: aligned | divergent | null`

---

### **Domain 7 — Inventory ↔ Returns Coherence Reality (L2 → FT2)**

**Question:** Does inventory agree with return reality?
**Owns:** Structural agreement with returns (paid-only)
**FT2 Signal:** `returnsInventoryCoherence: aligned | divergent | null`

---

## 3. META Domains (Epistemic Gates)

### **Domain 8 — Inventory Trust Eligibility Reality (META)**

**Question:** Is inventory truth epistemically eligible for exposure?
**Owns:** Trust gating across facts
**FT2 Signal:** `inventoryTrustEligible: boolean | null`

Failure collapses all other domains to `null`.

---

## 4. Explicit Non-Domains (Forbidden)

Inventory FT2 explicitly forbids:

* Stock aging reality
* Reorder point reality
* Safety stock reality
* Inventory turnover reality
* Warehouse performance reality
* Shrinkage analysis

These are **optimizations**, not observability.

---

## 5. Domain Design Laws (Non-Negotiable)

All Inventory domains must:

1. Answer one question
2. Be presence-first
3. Fail closed
4. Expose downgraded truth only
5. Never recommend, explain, or optimize

Violation invalidates FT2 compliance.

---

## 🔐 Final Seal

This DOMAIN_MAP defines the **complete and final** Inventory FT2 reality surface.

No additions.
No merges.
No silent expansion.

Inventory FT2 is now **fully locked**.
