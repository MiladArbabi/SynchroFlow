# 🧭 Cross-Module FT2 Entitlement & Suppression Matrix — **Finances Module**

> **Purpose**
> To define **exactly who may see Finances FT2**, **when**, and **what must be suppressed**—
> regardless of data availability, intelligence maturity, or UI temptation.

This matrix prevents:

* silent coupling
* accidental leakage
* “helpful” but unsafe reuse
* FT2 tier inflation

---

## 1. Core Rule (Non-Negotiable)

> **Finances FT2 is a closed surface.**
> It exists **only** for the Finances module UI.

No other module may:

* depend on it
* consume it
* infer from it
* gate behavior on it

---

## 2. FT2 Consumer Entitlement Matrix

| Consumer / Module           | Access to Finances FT2 | Notes                      |
| --------------------------- | ---------------------- | -------------------------- |
| **FinancesModuleFT2 UI**    | ✅ **ALLOWED**          | Primary and sole consumer  |
| Dashboard FT2               | ❌ **DENIED**           | No aggregation allowed     |
| Products FT2                | ❌ **DENIED**           | No cross-domain reasoning  |
| Orders FT2                  | ❌ **DENIED**           | Orders ≠ finances          |
| Customers FT2               | ❌ **DENIED**           | No profitability inference |
| FT2 Evaluator               | ❌ **DENIED**           | Finances never gates FT2   |
| FT2 Latch / Eligibility     | ❌ **DENIED**           | Must remain independent    |
| Analytics / Insight Modules | ❌ **DENIED**           | Intelligence is internal   |
| External APIs / Webhooks    | ❌ **DENIED**           | FT2 is UI-only             |

**Invariant**

> If a module needs financial truth, it must build **its own facts**.
> Finances FT2 is **not a shared substrate**.

---

## 3. Signal-Level Exposure Matrix (FT2)

This table defines **what may exist in FT2**, and **what must never escape**.

### 3.1 Always Suppressed (Hard Ban)

| Signal / Concept       | Status  | Reason                                 |
| ---------------------- | ------- | -------------------------------------- |
| `marginPct`            | ❌ Never | Misleading without full cost certainty |
| `lossReason`           | ❌ Never | Interpretive, causal                   |
| Raw confidence math    | ❌ Never | Internal epistemics                    |
| Bucket counts          | ❌ Never | Enables inference                      |
| Cost breakdowns        | ❌ Never | Incomplete domain                      |
| Refund amounts         | ❌ Never | Partial ingestion                      |
| Trend calculations     | ❌ Never | Unsafe without continuity              |
| Percentages (any kind) | ❌ Never | False precision                        |

If any of these appear in FT2:

> **It is a contract violation.**

---

### 3.2 Conditionally Exposed (Downgraded Only)

| Internal Signal      | FT2 Exposure                         | Rule            |
| -------------------- | ------------------------------------ | --------------- |
| Net status           | `positive / negative / null`         | Null if unknown |
| Temporal sufficiency | `history: sufficient / insufficient` | No counts       |
| Decision safety      | `safe / unsafe / unknown`            | No reasons      |
| Profit readiness     | `ready / not_ready`                  | Gated only      |
| Refund existence     | `known / unknown`                    | No magnitude    |

FTEP may **only collapse**, never enrich.

---

## 4. Lifecycle-Based Suppression Rules

Finances FT2 **must degrade gracefully** as truth matures.

### 4.1 Immediately After Shopify Connection

| Signal              | Value                   |
| ------------------- | ----------------------- |
| Revenue observed    | ✅                       |
| Net observed        | `—`                     |
| Financial readiness | `Partial`               |
| Decision safety     | `Unsafe / Unknown`      |
| Profit validity     | `Not ready`             |
| Refund visibility   | `Unknown`               |
| Blind spots         | Costs, Refunds, History |

This is **correct behavior**, not a deficiency.

---

### 4.2 Partial History / Sparse Data

* Timeline may exist
* Trend **must not**
* Confidence remains suppressed
* Decision safety likely `unsafe`

---

### 4.3 Full Preconditions Met

Even when everything is available:

* FT2 **still does not explain**
* FT2 **still does not advise**
* FT2 **still does not compute**

FT2 remains **observational**, not prescriptive.

---

## 5. Cross-Module Suppression Guarantees

### Finances FT2 **must not**:

* Unlock features in other modules
* Block features in other modules
* Influence onboarding tier
* Influence lifecycle phase
* Influence pricing or plan logic
* Influence alerts or automation

> Finances observes reality.
> It does **not** control the system.

---

## 6. UI-Level Enforcement Rules

The Finances FT2 UI must:

* Render `null` explicitly as `—`
* Show “unknown” states without apology
* Never substitute labels like:

  * “Low”
  * “Probably”
  * “Estimated”
* Never add helper copy that implies causality

If a designer asks for:

> “Can we explain this a bit?”

The answer is:

> **No. That’s a different tier.**

---

## 7. Violation Detection Checklist

Any of the following is a **hard stop**:

* Another module importing `FinancesFT2Exposure`
* A selector reading finances state outside Finances UI
* UI logic branching on financial signals
* FT2 gating based on profitability
* Percentages shown anywhere in Finances FT2
* Refund amounts exposed
* Costs defaulted to zero
* “Profit” shown without preconditions

---

## 8. Final Seal

**Status:** 🔒 **LOCKED**
**Scope:** Finances FT2 only
**Cross-Module Coupling:** ❌ Forbidden
**Expansion:** ❌ Only via new FT2 version
**Interpretation:** ❌ None

This matrix is **binding policy**, not guidance.

If a future feature feels blocked by this document:

> That is **intentional**.

FT2 is not where ambition lives.
It is where **truth survives**.