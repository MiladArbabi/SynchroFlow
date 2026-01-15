# 🔒 FT2 CONTRACT AUDIT

## Analytics / insightCore

**Status:** LOCKED • SEALED • EVIDENCE-COMPLETE
**Audit Type:** Contract Truth Audit
**Scope:** FT2 Analytics exposure surface only
**Doctrine:** FT2 Truth Exposure Policy (non-inferential)

---

## 0. Contract Definition

This document defines the **authoritative FT2 Analytics contract** as it exists **today**.

A field, signal, or behavior **exists only if proven by scan**.
If a signal is not exposed, it is **not part of the contract**, regardless of intent or commentary.

---

## 1. Contract Boundary (Authoritative)

### Backend Authority

```ts
getAnalyticsFt2Snapshot()
```

Pipeline (immutable):

```
Analytics Facts
 → Analytics Intelligence
   → Analytics FTEP
     → FT2 Exposure
```

### Frontend Authority

```ts
GET /api/v1/modules/analytics/ft2
```

No other path, adapter, or module participates in FT2 Analytics truth.

---

## 2. Canonical FT2 Analytics Exposure Shape

### 🔐 **AnalyticsFT2Exposure (SEALED)**

```ts
{
  context: {
    period: {
      from: string;
      to: string;
    };
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'unknown';
  } | null;
}
```

This shape is **final, minimal, and authoritative**.

---

## 3. Field-Level Contract Audit (Exhaustive)

### 3.1 `context`

#### `context.period.from`

* **Type:** `string`
* **Source:** Backend Facts input
* **Exposure:** Always exposed
* **Nullability:** Never null at exposure
* **Semantics:** Observational time window
* **UI Behavior:** Rendered verbatim

#### `context.period.to`

* **Type:** `string`
* **Source:** Backend Facts input
* **Exposure:** Always exposed
* **Nullability:** Never null at exposure
* **Semantics:** Observational time window
* **UI Behavior:** Rendered verbatim

🔒 **Contract Rule:**
`context.period` is **always present**, regardless of intelligence state.

---

### 3.2 `outcome`

#### `outcome.status`

* **Type:** `'positive' | 'negative'`
* **Source:** Analytics Intelligence
* **Exposure Rule:**

  * Exposed **only if** intelligence outcome ≠ `unknown`
  * Otherwise → `outcome = null`
* **Null Semantics:**

  * `null` means **intentionally suppressed**
* **UI Rendering:**

  * `'—'` when `null`
  * No fallback, no default

🔒 **Contract Rule:**
If `outcome` is `null`, **no outcome truth exists**.

---

### 3.3 `trend`

#### `trend.direction`

* **Type:** `'unknown'`
* **Source:** Analytics Intelligence
* **Exposure Rule:**

  * Exposed **only if** outcome ≠ `unknown`
  * Otherwise → `trend = null`
* **Mutability:** None (inert)
* **UI Rendering:**

  * `'—'` when `null`
  * `'unknown'` when exposed

🔒 **Contract Rule:**
Trend is a **structural placeholder**, not an analytical signal.

---

## 4. Signal Provenance Matrix

| Signal          | Origin Layer | Derived From  | Exposure Allowed | UI Visible |
| --------------- | ------------ | ------------- | ---------------- | ---------- |
| period          | Facts        | Input         | Always           | Yes        |
| outcome.status  | Intelligence | Orders counts | Conditional      | Yes        |
| trend.direction | Intelligence | None          | Conditional      | Yes        |
| raw counts      | Facts        | DB            | ❌                | ❌          |
| money           | —            | —             | ❌                | ❌          |
| percentages     | —            | —             | ❌                | ❌          |
| explanations    | —            | —             | ❌                | ❌          |

---

## 5. Intelligence Contract (Locked)

### Intelligence Inputs (Exact)

* `ordersObserved.processing`
* `ordersObserved.delivered`
* `ordersObserved.in_transit`

### Intelligence States

| Condition         | outcome.status | trend.direction |
| ----------------- | -------------- | --------------- |
| All values `null` | `unknown`      | `unknown`       |
| All values `0`    | `negative`     | `unknown`       |
| Any value > 0     | `positive`     | `unknown`       |

🔒 **Contract Rule:**
No other intelligence state exists.

---

## 6. Null Semantics (Strict)

| Layer        | Meaning of `null`              |
| ------------ | ------------------------------ |
| Facts        | Data absent in DB              |
| Intelligence | Insufficient certainty         |
| FTEP         | Truth intentionally suppressed |
| UI           | Honest absence (`—`)           |

There is **no reinterpretation of null** at any layer.

---

## 7. Inert / Non-Contractual Signals (Observed)

The following **exist in code but are NOT part of the FT2 contract**:

| Signal                          | Location      | Status                    |
| ------------------------------- | ------------- | ------------------------- |
| `revenueObserved`               | Snapshot type | Inert                     |
| `trend.direction !== 'unknown'` | Intelligence  | Impossible                |
| FT2 charts                      | UI            | Non-semantic placeholders |

These signals **carry zero contractual meaning**.

---

## 8. Explicit Non-Contractual Guarantees

The Analytics FT2 contract **does NOT guarantee**:

* Completeness
* Accuracy beyond DB truth
* Trend validity
* Business explanation
* Actionability
* Recommendations
* Financial insight

Any such expectation is **outside FT2 doctrine**.

---

## 9. End-to-End Contract Integrity

**Verified by scan:**

* No layer injects meaning
* No layer compensates for absence
* No layer infers suppressed truth
* No UI reconstructs intelligence
* No backend leaks raw data

---

## 10. FINAL SEALED VERDICT

> **The Analytics / insightCore FT2 contract is minimal, conservative, null-honest, and internally consistent.**
>
> Every exposed field is intentional.
> Every suppressed signal is deliberate.
> Every `—` is truthful.
>
> This contract is **LOCKED, SEALED, and EVIDENCE-FINAL**.