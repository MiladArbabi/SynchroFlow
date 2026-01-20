# 🔍 LaSyncro FT2 Canonical Blueprint

**Specter · Customers · Products (SKU-OS)**

**Scope:** FT2 Scoped → FT2 Paid
**Audience:** Architecture · Product · Trust · Monetization
**Status:** **Canonical · Locked**

---

# Core FT2 Law (Applies to All Modules)

FT2 is **not insight**.
FT2 is **not optimization**.
FT2 is **not advice**.

FT2 is:

> **Permissioned exposure to observable reality — downgraded by policy.**

Every FT2 module must implement:

```
Facts → Intelligence → FTEP → FT2 UI
```

If any layer is skipped, merged, or compensated for,
the surface is **not FT2**.

---

# PART I — PRODUCTS / SKU-OS FT2 (NEW · CANONICAL)

## 1. Products Truth Domain (Locked)

| Module            | Owns Truth About                                                                     |
| ----------------- | ------------------------------------------------------------------------------------ |
| Products / SKU-OS | **Product existence, structure, operational visibility, and economic observability** |

Products **does not** own:

* optimization
* pricing strategy
* demand planning
* replenishment advice
* margin recommendations

It owns **what is observably true** about products as they exist across systems.

---

## 2. Products FT2 — The Only Questions It Answers

> *“What products exist, how cleanly they exist, and what is observably visible about how they operate?”*

It does **not** answer:

* what to fix
* what to optimize
* what actions to take
* whether performance is “good”

---

## 3. Products FT2 — Layered Architecture (Expanded)

```
Persistence
(canonical_products, inventory, orders, costs)
   ↓
ProductsFacts
ProductOperationalFacts
   ↓
ProductsIntelligence
OperationalIntelligence
   ↓
ProductsFTEP
OperationalFTEP
   ↓
Products FT2 Provider
   ↓
Products FT2 API / UI
```

Each layer:

* has one responsibility
* is independently testable
* may not leak upward or sideways

---

## 4. Layer 1 — ProductsFacts (Structural Truth)

### Owns Raw Structural Reality Only

Examples:

* `productsObserved`
* `productsWithSkuCount`
* `productsWithoutSkuCount`
* `variantsObserved`
* `productsWithVariantsCount`
* `statusCounts`

Rules:

* No inference
* No ratios
* No thresholds
* No interpretation
* All values may be `null`

> `null` means **no observable truth**, not zero.

---

## 5. Layer 1b — ProductOperationalFacts (Operational Truth)

### Owns Raw Operational Reality Only

Examples:

* `productsWithInventoryCount`
* `productsWhereSalesExceedStockCount`
* `productsWithFulfillmentSignalsCount`
* `systemsTouchedPerProductAvg`

Rules:

* Joins allowed only here
* No semantic labels
* No “risk” language
* All facts are **counts or aggregates**

---

## 6. Layer 2 — Products & Operational Intelligence (Internal Only)

### Purpose

Translate facts into **internal-only classifications** across **independent dimensions**:

* Structural integrity
* Duplication presence
* Inventory visibility
* Fulfillment visibility
* Operational stability

Rules:

* Intelligence never escapes
* Missing facts collapse dimensions to `unknown`
* No cross-dimension inference

---

## 7. Layer 3 — Products & Operational FTEP (Truth Exposure Policy)

### What Products FT2 Is Allowed to Expose

Users may see:

* Whether product structure is observably consistent
* Whether duplication appears present
* Whether inventory is observably visible
* Whether fulfillment signals exist
* Whether operational stability is observable
* Where economic data is missing

### What Is Explicitly Hidden

❌ Raw facts
❌ Intelligence internals
❌ Explanations
❌ Recommendations

Uncertainty is rendered as `null`.

---

## 8. Products FT2 — Free vs Paid (Canonical Alignment)

### FT2 Scoped (Free)

* Snapshot only
* Structural integrity signals
* Operational exposure signals
* Explicit blind spots
* Short time horizon

### FT2 Paid

* Longer historical window
* Wider coverage
* Correlation surfaces (Products × Orders × Inventory)
* Still **no recommendations**

Paid FT2 **removes blindness**, not responsibility.

---

## 9. Why Users Pay for Products FT2

Users upgrade because:

> **They are already making product decisions with incomplete or misleading visibility.**

Paid Products FT2:

* Removes false confidence
* Exposes hidden duplication
* Reveals inventory blind zones
* Surfaces economic gaps

It does **not** optimize.
It **prevents self-deception**.

---

# PART II — SPECTER FT2 (UNCHANGED · ALIGNED)

## 10. Specter Truth Domain (Locked)

| Module  | Owns Truth About                           |
| ------- | ------------------------------------------ |
| Specter | **User interaction & behavioral presence** |

Specter is **not analytics**, **not attribution**, **not funnels**.

---

## 11. Specter FT2 — The Only Question It Answers

> *“Is user interaction observably occurring in this system?”*

Everything else is out of scope.

---

## 12. Specter FT2 — Layered Architecture

```
Persistence (events, sessions, signals)
   ↓
SpecterFacts
   ↓
SpecterIntelligence
   ↓
SpecterFTEP
   ↓
Specter FT2 Provider
   ↓
Specter FT2 API / UI
```

Identical doctrine to Products.

---

## 13. Why Users Pay for Specter FT2

Users upgrade because:

> **They cannot trust decisions made on behavior they cannot confirm exists.**

Paid Specter FT2:

* Exposes broken instrumentation
* Reveals silent inactivity
* Prevents analytics illusion

---

# PART III — CUSTOMERS FT2 (UNCHANGED · ALIGNED)

## 14. Customers Truth Domain (Locked)

| Module    | Owns Truth About                           |
| --------- | ------------------------------------------ |
| Customers | **Customer identity & relationship state** |

Customers does **not** own value, revenue, or behavior.

---

## 15. Customers FT2 — The Only Question It Answers

> *“Who exists, and in what relationship state?”*

---

## 16. Why Users Pay for Customers FT2

Users upgrade because:

> **They cannot manage relationships they cannot see clearly.**

Paid Customers FT2 removes identity blindness — nothing more.

---

# PART IV — Cross-Module FT2 (Paid Only)

## 17. Allowed Correlations (No Causation)

When paid entitlements exist:

* Products × Orders
* Products × Inventory
* Products × Customers
* Specter × Customers

Rules:

* Correlation only
* No explanation
* No scoring
* No advice

> **Correlation is allowed. Causation is forbidden.**

---

## 18. Why This Architecture Monetizes Cleanly

FT2 Scoped shows **that reality exists**.
FT2 Paid removes **blind zones**.

Downgrading feels like choosing ignorance.

LaSyncro does **not** sell:

❌ Insights
❌ Growth hacks
❌ Optimization tricks

LaSyncro sells:

> **Permissioned access to reality.**

---

## 19. Global FT2 Guarantees (Reconfirmed)

Across **Products, Specter, and Customers**:

* No inference
* No advice
* No semantic drift
* No hidden intelligence
* No lifecycle coupling
* No trust debt

---

## 🔒 FINAL STATEMENT (UPDATED)

> **Products FT2 shows what exists and what is structurally, operationally, and economically visible.
> Specter FT2 shows whether users act.
> Customers FT2 shows who exists and in what state.
> Paid FT2 removes blindness — not responsibility.**

This blueprint is **canonical**.

Any deviation requires:

1. fresh scans
2. explicit diffs
3. architectural review

---

### Where this leaves us

You now have:

1. **Products / SKU-OS FT2** — sealed & expanded
2. **Specter FT2** — aligned
3. **Customers FT2** — aligned
4. A unified FT2 doctrine that:

   * scales horizontally
   * monetizes vertically
   * preserves trust absolutely

This is a **CNS-ready foundation**.