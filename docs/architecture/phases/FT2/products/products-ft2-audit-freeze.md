# 📦 Products / SKU-OS — FT2 Contract Audit (LOCKED)

## Audit Status

* **Module:** Products / SKU-OS
* **Surface:** FT2
* **Audit Type:** Truth, Exposure & Conversion Spine Integrity
* **State:** **FROZEN / SEALED**
* **Evidence Basis:** Repository scans + implemented FT2 surfaces only
* **Last Action:** Dependency blast radius exposed (single-KPI, FT2-safe)

---

## 1. Canonical Architecture Confirmation

Products / SKU-OS strictly implements the **FT2 4-Layer Architecture** with **independent reality domains**.

```
Persistence (canonical tables)
→ Layer 1: Facts
→ Layer 2: Intelligence
→ Layer 3: FTEP (Truth Exposure Policy)
→ Layer 4: FT2 UI
```

There are:

* ❌ no lifecycle control
* ❌ no optimization logic
* ❌ no entitlement inference
* ❌ no cross-layer leakage

All domains adhere to the same pipeline.

---

## 2. Implemented Product Reality Domains (FINAL)

| Domain                     | Question Answered                 | Status            |
| -------------------------- | --------------------------------- | ----------------- |
| **Structural**             | Does the product + variants exist correctly? | ✅ Implemented |
| **Operational**            | Can it flow without breaking?     | ✅ Implemented     |
| **Cost**                   | Is money observable?              | ✅ Implemented     |
| **Supply**                 | Can it be replenished?            | ✅ Implemented     |
| **Freshness**              | Can this data be trusted *now*?   | ✅ Implemented     |
| **Dependency**             | What breaks if it changes?        | ✅ Implemented     |
| **Cross-Domain Alignment** | Do realities agree?               | ✅ Implemented (evidence-gated) |
| Compliance                 | Is it allowed to exist?           | ⛔ Not implemented |
| Lifecycle Presence         | Is it actually alive?             | ⛔ Not implemented |

> **Structural Domain Definition (Clarified):**
>
> Structural truth requires:
> - a canonical product row **and**
> - ≥1 canonical variant row
>
> Products without variants are treated as **structurally incomplete**
> and suppressed at exposure time.

Only implemented domains are exposed.
No placeholders exist.

---

## 3. Layer 1 — Facts (Canonical Truth)

### 3.1 Sources of Truth (Read-Only)

| Domain                     | Tables / Inputs                                  |
| -------------------------- | ------------------------------------------------ |
| Structural                 | `canonical_products`, `canonical_variants`       |
| Inventory                  | `inventory_truth`                                |
| Sales                      | `historical_sales`                               |
| Fulfillment                | `order_fulfillment_status`                       |
| Cost                       | `product_costs`                                  |
| Cross-Domain Alignment     | Derived presence facts (no joins, no inference)  |

> **Canonical Identity Rule (FT2, Enforced):**
>
> Product existence is defined by the **product–variant composite**, not products alone.
> A product is only structurally valid in FT2 if at least one canonical variant
> is present and anchored.
>
> This prevents:
>
> * orphan SKUs
> * non-orderable products
> * false-positive product counts

* Joins allowed **only inside Facts**
  - and **only between canonical tables**
* No inferred relationships
* No synthetic rows

> Platform tables (`orders`, `order_line_items`, etc.)  
> are **never** joined into product facts.
>
> Canonical products are insulated from platform volatility by design.

---

### 3.2 Null Semantics (Global, Locked)

* **No rows → ALL facts = null**
* `null` means **no observable truth**
* `null ≠ 0` enforced everywhere
* Facts are **complete-or-null**
* Cross-domain alignment facts additionally require **explicit evidence presence**
* Product presence without variants → **Structural facts = null**

This ensures that:
- dormant catalog entries
- draft-only products
- ingestion-incomplete products

do not contaminate FT2 exposure.

---

## 4. Layer 2 — Intelligence (Internal Only)

### 4.1 Role

* Deterministic classification
* Per-domain isolation
* Never exposed
* Used **only** to decide downgrade/suppression

---

### 4.2 Missing-Facts Collapse Rule (GLOBAL)

Structural Intelligence additionally collapses to `unknown` if:
- canonical_variants = 0 for the product

If **any required fact** for a domain is `null`  
—or if required **alignment evidence is absent**:

→ That **entire domain intelligence = `unknown`**

No partial states.
No borrowing across domains.

---

## 5. Layer 3 — FTEP (Truth Exposure Policy)

### 5.1 Role

FTEP is the **sole downgrade boundary**.

It decides:

* what survives
* what is suppressed
* what is downgraded

Nothing else may.

---

### 5.2 Products FT2 Exposure (FINAL)

```ts
ProductsFT2Exposure {
  context: {
    period: { from: string; to: string }
    productsObserved: number | null // counts only products with ≥1 canonical variant
  }

  > **productsObserved Semantics (Locked):**
  > This value reflects the number of **order-capable products**.
  > Catalog entries without variants are intentionally excluded.

  outcome | null
  trend | null

  // Structural integrity
  productDataIntegrity | null

  // Operational visibility
  operational | null

  // Supply & replenishment
  supply | null

  // Data freshness
  dataFreshness | null

  // Dependency reality
  dependency: {
    surface: 'isolated' | 'coupled' | 'unknown'
    blastRadius: 'contained' | 'wide' | 'unknown'
  } | null

> **Dependency Grounding Rule:**
>
> Dependency surface and blast radius are evaluated **only**
> from canonical product ↔ variant ↔ order participation.
> Platform catalog relationships are ignored.


  // Cross-domain agreement (evidence-gated)
  alignment: {
    alignment: 'aligned' | 'misaligned' | 'unknown'
  } | null
}
```

---

### 5.3 Downgrade Rules (Strict)

* Intelligence = `unknown` → exposure = `null`
* Exposure is **lossy by design**
* Raw facts and ratios never cross this boundary

---

### 5.4 Meaning of `null` (Reconfirmed)

`null` means:

> Truth exists but is **intentionally withheld** due to insufficient certainty, missing facts, or missing alignment evidence.

This is **not missing data**.

---

## 6. Layer 4 — FT2 UI (FINAL)

### 6.1 Rendering Rules

* KPI-only surfaces
* `null → '—'`
* No narrative
* No explanation
* No severity coloring
* No ranking

---

### 6.2 Conversion Spine (LOCKED)

Order of exposure is intentional:

1. Products detected
2. Structural integrity
3. Operational visibility
4. Supply observability
5. Data freshness
6. Dependency surface & blast radius
7. Cross-domain alignment (evidence-gated)
8. Economic observability

Nothing is explained.
Users infer cost of blindness themselves.

---

## 7. Visual Semantics Audit (PASSED)

Confirmed absence of:

* ❌ recommendations
* ❌ risk language
* ❌ advice
* ❌ optimization framing
* ❌ lifecycle triggers

UI remains **observational only**.

---

## 8. Forward-Compatibility Guarantee

This FT2 contract supports future expansion via:

* constraint lifting
* deeper time windows
* higher resolution facts

**No refactor required.**

---

## 9. Explicit Non-Goals (LOCKED)

Products FT2 does **not**:

* define visuals
* define entitlements
* define pricing
* suggest actions
* optimize outcomes
* infer causes
* retroactively "fix" products missing variants

Those are separate systems.

---

## 🔒 FINAL VERDICT

* Products / SKU-OS FT2 is **complete**
* Products / SKU-OS FT2 is **complete and canonically bounded**
* All implemented domains are **orthogonal & sealed**
* Conversion spine is **structural, not persuasive**
* Dependency (surface + blast radius) is FT2-safe
* Silent drift is now forbidden

---

## 🔐 STATUS: **LOCKED · SEALED · AUTHORITATIVE**

Any future change requires:

1. new repository scan
2. explicit diff
3. declared scope
4. non-retroactive amendment

No exceptions.
