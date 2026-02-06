## 🔒 Refunds Overview — FT2 InfoBlock Blueprint

**STATUS:** ✅ SEALED · LOCKED
**APPLIES TO:** Orders-Nexus FT2
**LAYER:** FT2 (Read-only observability)
**OWNERSHIP:** Financial regression only
**APEX RULE:** Refunds ≠ Returns

---

## 1. Purpose (LOCKED)

The **Refunds Overview** InfoBlock surfaces **confirmed item-level revenue that has exited the system via refunds**.

It answers exactly one question:

> **“How much item revenue has already been refunded?”**

It does **not** describe customer intent, logistics, or operational workflow.

---

## 2. Domain Definition (SEALED)

**Refunds** in FT2 mean:

> **Platform-confirmed financial reversals of item-level revenue.**

They are **post-execution regressions**, not risk, not obligations, not blockers.

---

## 3. Truth Source (NON-NEGOTIABLE)

**Single source of truth:**

```
order_revenue_units.returned_quantity
order_revenue_units.unit_revenue
```

**Explicit exclusions:**

* Taxes
* Shipping
* Duties
* Fees
* Payment settlement timing
* Platform “returns” objects

If refunded value is not represented as **refunded item revenue units**, it **does not exist** for FT2.

---

## 4. Rows (LOCKED · CANONICAL)

| Row                       | Definition                                      | Semantics                  |
| ------------------------- | ----------------------------------------------- | -------------------------- |
| **Refunded Item Revenue** | Σ (returned_quantity × unit_revenue)            | Money already gone         |
| **Refunded Units**        | Σ returned_quantity                             | Physical quantity reversed |
| **Orders Affected**       | Count of canonical orders with ≥1 refunded unit | Scope of impact            |

**Hard rules:**

* All rows are **aggregate-only**
* No SKU, customer, or reason breakdowns
* No lifecycle states
* No percentages
* No trends

---

## 5. Null Semantics (CRITICAL)

| Condition                  | FT2 Output                       |
| -------------------------- | -------------------------------- |
| No refunded units observed | All rows = `null`                |
| Partial refund data        | Only computable aggregates shown |
| Non-finite values          | Row suppressed                   |

`null` = epistemic absence, **not zero**.

---

## 6. Temporal Semantics (LOCKED)

* Refunds are **lifetime-observed**, not window-scoped.
* FT2 date range **does not filter refunds**.
* Reason: refund execution timestamps are not economically comparable to order creation windows.

---

## 7. Relationship to Other InfoBlocks

### Revenue Overview

* Refunds **do not subtract** from Total Sales
* Refunds **do not alter** Earned / Pending / Blocked partitions
* Refunds are a **separate regression lens**

### Obligation Overview

* Refunds are **not constraints**
* Refunds do **not** affect eligibility
* Refunds never imply fault or cause

---

## 8. Platform Reality (SEALED)

* Shopify “returns” APIs are **advisory and incomplete**
* Refund truth is **financial**, not logistical
* FT2 aligns to **accounting-grade finality**, not workflow intent

Mismatch between Shopify UI and FT2 values is expected when Shopify includes:

* Taxes
* Shipping
* Adjustments
* Rounding
* Non-item refunds

FT2 intentionally excludes these.

---

## 9. Forbidden Semantics (HARD FAIL)

Refunds Overview must **never** include:

* “At risk”
* “Pending refunds”
* “Expected refunds”
* “Return requested / received”
* Customer behavior interpretation
* Operational blame
* Recommendations

Violation = contract breach.

---

## 10. Final Contract Seal

✔ Refunds ≠ Returns
✔ Financial regression only
✔ Item-level truth, aggregate exposure
✔ No lifecycle, no causation
✔ Platform-agnostic and replay-safe

🔒 **Refunds Overview FT2 Blueprint is SEALED and NON-EXTENSIBLE.**

---
