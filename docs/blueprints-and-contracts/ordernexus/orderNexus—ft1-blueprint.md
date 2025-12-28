# OrderNexus — FT1 Blueprint (System-Level Truth)

## 1. Purpose of FT1

FT1 is the **first moment of trust** for OrderNexus.

Its sole purpose is to answer, truthfully and conservatively:

> *What is the current observable state of my orders?*

FT1 is **diagnostic**, **read-only**, and **configuration-free**. It exists to prove that the system understands the merchant’s data before any dashboards, insights, or recommendations are unlocked.

---

## 2. What FT1 Is (Non‑Negotiable)

FT1 **is**:

* A diagnostic gate between data ingestion (FT0) and onboarding / dashboards
* A declaration of observable truth, even when incomplete
* A confidence‑building phase
* Deterministic and test‑enforced

FT1 **is not**:

* Optimization
* Forecasting
* Recommendations
* Storytelling
* Persuasion
* A dashboard

If FT1 guesses, over‑promises, or hides uncertainty, **trust is permanently damaged**.

---

## 3. FT1 Architecture — Single Truth Path

FT1 follows a strict, one‑way truth path:

1. **Database (Canonical Tables)**

   * Ground truth only
   * Absence of data ≠ zero
   * Unknown states must be representable (`null`)

2. **Backend Provider (Signals Only)**

   * Reads canonical data
   * Emits *facts*, never interpretation
   * Explicitly declares knowledge (e.g. `ordersKnown = true`)

3. **Readiness Aggregation**

   * Aggregates signals verbatim
   * Performs no coercion or inference

4. **Frontend Adapter (Pure Mapping)**

   * Maps readiness → module props
   * Preserves `null` vs `0`
   * No hooks, no logic, no fallbacks

5. **Scenario Resolution (Single Authority)**

   * Deterministic classification
   * Depends only on mapped props

6. **UI Rendering (FT1 Surface)**

   * Renders exactly one diagnostic message
   * Switches only on scenario output
   * No data inspection

---

## 4. FT1 Signals (OrderNexus)

The OrderNexus provider emits the following FT1 signals:

* `orderNexus.ordersKnown: boolean`
* `orderNexus.ordersIngested: number`
* `orderNexus.missingCostCount: number`
* `orderNexus.hasNegativeMarginOrder: boolean`

Rules:

* `ordersKnown` is the only authority on readiness
* Numeric values must never be inferred
* `hasNegativeMarginOrder` is **boolean only** in FT1

---

## 5. FT1 Scenarios (Locked)

Exactly **one** scenario must be true at all times.

```ts
if (ordersIngested === null) return 'LOADING'
if (ordersIngested === 0) return 'NO_ORDERS'
if (hasNegativeMarginOrder) return 'LOSS'
if (missingCostCount > 0) return 'UNCERTAIN'
return 'HEALTHY'
```

Scenario precedence is intentional and must not be changed.

---

## 6. FT1 UI Contract (OrderNexus)

FT1 UI:

* Owns the entire OrderNexus module surface while unresolved
* Renders one diagnostic message
* Does not show dashboards, widgets, or charts

Each scenario communicates **only observable truth**:

| Scenario  | Meaning Communicated                                           |
| --------- | -------------------------------------------------------------- |
| LOADING   | Data is still being read                                       |
| NO_ORDERS | No business activity detected                                  |
| LOSS      | At least one order has a negative margin based on current data |
| UNCERTAIN | Profitability cannot be determined yet                         |
| HEALTHY   | No negative margins detected in available data                 |

Language must remain **neutral and diagnostic**.

---

## 7. Testing Requirements (Mandatory)

OrderNexus FT1 is considered complete only when all of the following exist:

* Provider DB → signal tests
* Adapter mapping tests (`null` vs `0` preserved)
* Scenario resolution tests
* **UI scenario tests that assert diagnostic copy**

UI tests intentionally assert copy to prevent semantic drift.

---

## 8. Instrumentation Rules

Allowed:

* Debug logging of FT1 inputs and resolved scenario

Forbidden:

* Analytics events
* Funnel tracking
* Conversion metrics

FT1 observes state — it does not optimize behavior.

---

## 9. Relationship to Onboarding and Dashboards

FT1 is a **diagnostic gate**.

* FT1_Discovery: declares truth
* FT1_Onboarding: responds to truth (checklists, gating)
* FT_Final: unlocks dashboards

FT1 must be able to stand alone, even if the user refuses to act.

---

## 10. Final Principle

> **FT1 is where trust is earned or lost.**

If the merchant believes OrderNexus here, they will follow it everywhere else.

This contract is **locked**. Any deviation requires an explicit version change.

---

## 10.FT1_Onboarding Gate (Frontend Infra)

* Owner: ModuleContentHost
* Trigger: readiness.ft1.isComplete === false
* Scope: blockingModules[]
* Effect: suppress <moduleId>-core
