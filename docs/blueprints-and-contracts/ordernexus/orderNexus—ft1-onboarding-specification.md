# 📘 OrderNexus — FT1 Onboarding Specification (LOCKED)

**Module:** OrderNexus (Orders)
**Phase:** FT1 — First Trust
**Status:** Locked v1.0
**Audience:** Product, Frontend, Growth
**Non-goal:** Backend architecture, analytics depth, configuration
**Last-modified:** Dec, 27, 2025

---

## 1. Purpose of FT1 Orders Onboarding

FT1 Orders onboarding exists to **orient the merchant inside OrderNexus once FT1 is reached**, without:

* falling back to FT0 states
* showing empty or misleading surfaces
* over-educating or congratulating
* leaking paid functionality

FT1 onboarding must:

1. Establish **trust in profitability data**
2. Create a **clear narrative** about the merchant’s current profit reality
3. Funnel the merchant toward **action or monetization**, never confusion

---

## 2. Hard Invariants (Non-Negotiable)

1. **FT1 never renders FT0 UI**

   * No EmptyDashboardState
   * No FT0 loaders
   * No activation prompts

2. **FT1 onboarding is narrative-driven, not feature-driven**

   * The story comes first
   * Widgets support the story, never the opposite

3. **Exactly ONE onboarding narrative is active at a time**

   * No blended states
   * No fallback ambiguity

4. **All FT1 narratives must resolve into a next step**

   * Data completion
   * Investigation
   * Optimization
   * Upgrade

---

## 3. Source Signals (Authoritative Inputs)

FT1 Orders onboarding logic consumes only these signals:

| Signal                   | Source               | Meaning                                |
| ------------------------ | -------------------- | -------------------------------------- |
| `ordersIngested`         | OrderNexus readiness | Canonical orders count                 |
| `hasNegativeMarginOrder` | OrderNexus readiness | At least one order with net profit < 0 |
| `missingCostCount`       | OrderNexus readiness | Orders missing cost data               |
| `ft1Sealed`              | Lifecycle            | FT1 already achieved                   |
| `integrationExists`      | Integration          | Structural validity                    |

No UI heuristics.
No derived guesses.

---

## 4. The Locked 4-Scenario Model

FT1 Orders onboarding is governed by **exactly four mutually exclusive scenarios**.

### Decision Tree (Authoritative)

```ts
IF ordersIngested === 0
  → Scenario A: Pre-Insight

ELSE IF hasNegativeMarginOrder === true
  → Scenario B: Loss Narrative

ELSE IF missingCostCount > 0
  → Scenario C: Uncertainty Narrative

ELSE
  → Scenario D: Verified Profitability Narrative
```

This tree is **complete**.
No other FT1 Orders onboarding states may exist.

---

## 5. Scenario Specifications

---

### **Scenario A — Pre-Insight Narrative**

**Condition**

```
ordersIngested === 0
```

**Interpretation**
The merchant is structurally ready but lacks observable order data.

**Primary Message**

> “Once your first order is processed, OrderNexus will show real profit insights.”

**UI Requirements**

* FT1 shell only (no FT0 fallback)
* No charts with fake zeros
* No profitability claims

**Allowed Surfaces**

* Empty Profit Autopsy placeholder
* Clear explanation of *why* nothing is shown

**Primary CTA**

* Passive: “Orders will appear automatically”
* No urgency framing

**Monetization**

* None (too early)

---

### **Scenario B — Loss Narrative (Primary Conversion Driver)**

**Condition**

```
ordersIngested > 0
AND hasNegativeMarginOrder === true
```

**Interpretation**
The business is losing money on at least part of its operation.

**Primary Message**

> “Some orders are costing you money.”

**Hero Surface**

* **Bleed Feed** (loss-making orders)
* Single Profit Autopsy (negative example)

**Tone**

* Clinical
* Evidence-based
* No alarmism

**Primary CTA**

* “Investigate why this order lost money”

**Secondary CTA (Paid Hook)**

* “See profit drivers across all orders” (paywalled)

**Monetization Intent**

* Strong
* This is the **highest urgency upgrade path**

---

### **Scenario C — Uncertainty Narrative**

**Condition**

```
ordersIngested > 0
AND hasNegativeMarginOrder === false
AND missingCostCount > 0
```

**Interpretation**
Profitability appears positive, but confidence is low.

**Primary Message**

> “Your profit numbers are incomplete.”

**Hero Surface**

* Profit Autopsy with **confidence warning**
* Missing Costs Counter

**Tone**

* Neutral
* Trust-protective

**Primary CTA**

* “Fix missing costs to see real profit”

**Secondary CTA**

* “Why cost completeness matters”

**Monetization Intent**

* Medium
* Conversion via **data completion → trust → upsell**

---

### **Scenario D — Verified Profitability Narrative**

**Condition**

```
ordersIngested > 0
AND hasNegativeMarginOrder === false
AND missingCostCount === 0
```

**Interpretation**
The business is profitable with high confidence.

**Primary Message**

> “Your profit data is complete and stable.”

**Hero Surface**

* Profit Autopsy (positive example)
* Net margin summary

**Tone**

* Controlled confidence
* No celebration

**Primary CTA**

* “Find where you can improve margin”

**Secondary CTA (Paid Hook)**

* “Compare profit by channel / SKU / region”

**Monetization Intent**

* Optimization-driven
* Ideal for **mid-market conversion**

---

## 6. FT1 vs Paid Boundary (Enforced)

| Capability                  | FT1         | Paid     |
| --------------------------- | ----------- | -------- |
| Single Order Profit Autopsy | ✅           | ✅        |
| Bleed Feed (Top N)          | ✅ (limited) | ✅ (full) |
| Profit Trends (basic)       | ✅           | ✅        |
| Cohort Analysis             | ❌           | ✅        |
| Fee / Cost Treemap          | ❌           | ✅        |
| Simulation Sandbox          | ❌           | ✅        |

FT1 **shows proof**, not power.

---

## 7. Persistence & Stability Rules

1. FT1 Orders onboarding:

   * Re-evaluates on refresh
   * Never regresses to FT0
2. Narrative **may change** only if signals change
3. No time-based transitions

---

## 8. Versioning Policy

* This spec is **FT1 Orders Onboarding v1.0**
* Any new scenario, signal, or override:

  * Requires `v1.1+`
  * Requires explicit doc update

---

## 9. Explicitly Out of Scope (v1)

* Simulations
* Prescriptive pricing
* Automated rules
* Margin forecasting
* Cross-module insights

These belong to **paid tiers** or **Phase 2+**

---

## 10. Final Lock Statement

This document defines the **only valid FT1 Orders onboarding behavior**.

If the UI, backend, or product deviates from this without versioning,
it is **a bug, not a choice**.

---