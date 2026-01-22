# 🔒 SKU Integrity FT2 — DOMAIN_MAP (Canonical)

**Module:** Products / SKU-OS
**Submodule:** SKU Integrity (Gaps & Deviations)
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed
**Scope:** Observable SKU-level structural & operational deviation only

---

## 0. Purpose (Read First)

This document defines **all allowed SKU Integrity FT2 domains**.

Each domain:

* answers **exactly one factual question**
* is presence-first
* is independently observable
* may fail closed (`null` / `unknown`)

No other SKU Integrity domains may exist.

---

## 1. FT2 Layering Reference

| Layer | Meaning                                |
| ----- | -------------------------------------- |
| L1    | Presence & raw observation             |
| L2    | Internal classification (intelligence) |
| FT2   | Downgraded exposure only               |
| META  | Epistemic gating & trust               |

---

## 2. Canonical SKU Integrity Domains (LOCKED)

### 🧩 Structural Reality

### **Domain 1 — SKU Structural Consistency Reality (L1)**

**Question:** Do SKUs exist consistently within product structure?
**Owns:** SKU ↔ Product referential integrity
**FT2 Signal:** `structuralDeviationPresent: boolean | null`

---

### 📦 Inventory Reality

### **Domain 2 — SKU ↔ Inventory Consistency Reality (L2 → FT2)**

**Question:** Do SKU inventory records structurally agree with SKU definitions?
**Owns:** SKU–inventory agreement
**FT2 Signal:** `inventoryDeviationPresent: boolean | null`

---

### 🚚 Fulfillment Reality

### **Domain 3 — SKU ↔ Fulfillment Consistency Reality (L2 → FT2)**

**Question:** Do fulfillment events structurally agree with SKU reality?
**Owns:** SKU–fulfillment agreement
**FT2 Signal:** `fulfillmentDeviationPresent: boolean | null`

---

### 💰 Economic Observability Reality

### **Domain 4 — SKU Cost Visibility Reality (L1)**

**Question:** Is SKU-level cost information observable?
**Owns:** Cost visibility presence
**FT2 Signal:** `costVisibilityGapPresent: boolean | null`

---

### 📡 Coverage & Sufficiency

### **Domain 5 — SKU Coverage Sufficiency Reality (L1)**

**Question:** Is SKU data coverage sufficient to interpret reality?
**Owns:** Coverage sufficiency
**FT2 Signal:** `skuCoverageSufficient: boolean | null`

---

## 3. META Domain (Epistemic Gate)

### **Domain 6 — SKU Integrity Trust Eligibility Reality (META)**

**Question:** Is SKU integrity truth epistemically eligible for exposure?
**Owns:** Trust gating across SKU deviation facts
**FT2 Signal:** `skuIntegrityTrustEligible: boolean | null`

Failure collapses all other SKU Integrity domains to `null`.

---

## 4. Explicit Non-Domains (Forbidden)

SKU Integrity FT2 explicitly forbids:

* Severity ranking reality
* Issue prioritization reality
* Root cause reality
* Ownership assignment reality
* Remediation effectiveness reality

These introduce **judgment, workflow, or optimization**.

---

## 5. Domain Design Laws (Non-Negotiable)

All SKU Integrity domains must:

1. Answer one question
2. Be presence-first
3. Fail closed
4. Expose downgraded truth only
5. Never explain, recommend, or optimize

Violation invalidates FT2 compliance.

---

## 🔐 Final Seal

This DOMAIN_MAP defines the **complete and final** SKU Integrity FT2 reality surface.

SKU deviations are **signals of misalignment**, not problems to be solved by the system.

No additions.
No merges.
No silent expansion.

SKU Integrity FT2 is now **fully locked**.