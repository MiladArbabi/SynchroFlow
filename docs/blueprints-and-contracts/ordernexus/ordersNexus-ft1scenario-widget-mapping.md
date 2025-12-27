# **Orders Nexus — FT1 Scenario → Widget Mapping (v1.0 LOCKED)**

## Scope

Applies to:

* `/orders` FT1 view
* Orders section inside global Dashboard (aggregated variant)

This mapping decides **what the merchant sees**, not how it looks.

---

## 🔑 Signals Used (Authoritative)

From readiness + OrderNexus providers:

* `ordersIngested: number`
* `hasNegativeMarginOrder: boolean`
* `missingCostCount: number`
* `profitabilityActive: boolean`
* `ft1Sealed: boolean` (lifecycle only, not UX logic)

---

## 🧭 Scenario Resolution (Exclusive, Ordered)

Exactly **one** scenario is active at a time.

```ts
if (ordersIngested === 0) → SCENARIO_A
else if (hasNegativeMarginOrder === true) → SCENARIO_B
else if (missingCostCount > 0) → SCENARIO_C
else → SCENARIO_D
```

No fallthrough. No blending.

---

# 🅰️ SCENARIO A — “No Orders Yet”

### Condition

```
ordersIngested === 0
```

### Narrative

> “We can’t analyze profit until at least one real order exists.”

This is **FT1**, not FT0.
No empty dashboards. No FT0 resurrection.

---

### 🧱 Layout Mapping

#### **Row 1 — Orientation (3 Cards)**

| Card            | Content       |
| --------------- | ------------- |
| Orders Analyzed | `0`           |
| Net Margin      | `—`           |
| Profit Risk     | `No data yet` |

---

#### **Row 2 — Hero (Large Diagram)**

**Hero Surface**

* Placeholder Profit Autopsy (disabled state)

**Message**

> “Your first order unlocks profit insights.”

**Visual**

* Greyed waterfall
* Labels only (Revenue → Costs → Profit)

---

#### **Row 3 — Actions (2 Cards)**

| Card               | Content                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| What happens next? | “Once your first order arrives, we’ll break down where the money actually goes.” |
| How to get data    | “Connect channels or wait for your first sale.”                                  |

No CTAs to upgrade.
No pressure. Pure orientation.

---

#### **Row 4 — Insights**

* Hidden (not empty, not rendered)

---

# 🅱️ SCENARIO B — “Loss Narrative” (🔥 Highest Priority)

### Condition

```
ordersIngested > 0
AND hasNegativeMarginOrder === true
```

### Narrative

> “Some orders are actively losing you money.”

This is the **conversion-critical** scenario.

---

### 🧱 Layout Mapping

#### **Row 1 — Orientation**

| Card               | Content                 |
| ------------------ | ----------------------- |
| Orders Analyzed    | `N orders`              |
| Avg Net Margin     | `X%`                    |
| Loss-Making Orders | `Y orders` (red accent) |

---

#### **Row 2 — Hero**

**Hero Surface**

* **Profit Autopsy — Loss-Making Order**

**Selection Rule**

* Most recent negative-margin order

**Diagram Emphasis**

* Cost component that caused loss (highlighted)
* Net profit < 0 clearly labeled

---

#### **Row 3 — Actions**

| Left (Diagnostic)              | Right (Action)                             |
| ------------------------------ | ------------------------------------------ |
| “Why this order lost money”    | “Review loss-making orders”                |
| Cost breakdown + primary cause | CTA → Orders table filtered to loss orders |

**Paywall Rule**

* Viewing **one** loss order is free
* Bulk analysis / trends = paid

---

#### **Row 4 — Insights (Default)**

* Bleed Feed (last 5 loss orders)
* Basic profit trendline

---

# 🅲 SCENARIO C — “Uncertainty Narrative” (Missing Costs)

### Condition

```
ordersIngested > 0
AND hasNegativeMarginOrder === false
AND missingCostCount > 0
```

### Narrative

> “Your profit looks okay — but parts of it are guesses.”

This is about **trust**, not fear.

---

### 🧱 Layout Mapping

#### **Row 1 — Orientation**

| Card            | Content          |
| --------------- | ---------------- |
| Orders Analyzed | `N orders`       |
| Avg Net Margin  | `X% (estimated)` |
| Missing Costs   | `Z orders`       |

---

#### **Row 2 — Hero**

**Hero Surface**

* **Profit Autopsy — Incomplete Order**

**Visual Treatment**

* Missing cost segments shown as dashed / muted
* Tooltip: “Assumed = 0”

---

#### **Row 3 — Actions**

| Left (Diagnostic)     | Right (Action)       |
| --------------------- | -------------------- |
| “What’s missing”      | “Fix missing costs”  |
| Count + affected SKUs | CTA → SKU cost setup |

---

#### **Row 4 — Insights (Default)**

* Missing cost counter
* Estimated vs confirmed margin trendline

---

# 🅳 SCENARIO D — “Verified Profitability” (Healthy State)

### Condition

```
ordersIngested > 0
AND hasNegativeMarginOrder === false
AND missingCostCount === 0
```

### Narrative

> “Your profitability is real — now optimize it.”

This is where **upsell becomes elegant**.

---

### 🧱 Layout Mapping

#### **Row 1 — Orientation**

| Card            | Content           |
| --------------- | ----------------- |
| Orders Analyzed | `N orders`        |
| Avg Net Margin  | `X%`              |
| Profit Status   | `Healthy` (green) |

---

#### **Row 2 — Hero**

**Hero Surface**

* **Profit Autopsy — High-Confidence Order**

**Visual**

* Clean waterfall
* Confidence badge (“High data confidence”)

---

#### **Row 3 — Actions**

| Left (Insight)            | Right (Expansion)                        |
| ------------------------- | ---------------------------------------- |
| “Where margin comes from” | “Explore profitability drivers”          |
| Simple cost share         | CTA → Profitability Explorer (paywalled) |

---

#### **Row 4 — Insights (Default)**

* Profit trendline
* Top profitable SKUs snapshot
* Channel margin summary (lite)

---

## 🧷 Hard Locks (Non-Negotiable)

* FT1 **never** shows:

  * Empty dashboards
  * FT0 empty states
  * Random widgets
* Exactly **one narrative** at a time
* Hero diagram always present
* Actions always resolve to a next step

---

## 📌 Why This Works

* Merchants with problems feel *seen*
* Merchants without problems feel *curious*
* No fear-based upsell
* No dead ends
* Clear progression from **truth → trust → optimization**

---