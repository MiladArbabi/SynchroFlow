# **Orders FT1 — UI Component Checklist (v1.0 LOCKED)**

## Global FT1 UI Invariants (Apply Everywhere)

These are **hard rules**:

* ❌ No FT0 empty states
* ❌ No loading skeletons after FT1_READY
* ❌ No conditional rendering based on timing
* ✅ Rendering is **signal-based only**
* ✅ Exactly **one scenario active**
* ✅ All components must accept **explicit props**, never infer state

---

# 🧱 PAGE STRUCTURE (Orders FT1)

```
OrdersPage
├── OrdersHeader
├── OrdersKpiRow        (Row 1)
├── OrdersHeroSection   (Row 2)
├── OrdersActionRow     (Row 3)
└── OrdersInsightsGrid  (Row 4)
```

Each block below is **mandatory** (even if content changes).

---

## 🧠 SCENARIO RESOLVER (NON-VISUAL)

**Component:** `useOrdersFt1Scenario()`

### Input

```ts
{
  ordersIngested: number
  hasNegativeMarginOrder: boolean
  missingCostCount: number
}
```

### Output (exclusive)

```ts
'type OrdersFt1Scenario =
  | "NO_ORDERS"
  | "LOSS"
  | "UNCERTAIN"
  | "HEALTHY"'
```

### Checklist

* ⛔ No UI logic allowed outside this hook
* ⛔ No overlapping scenarios
* ✅ Unit-tested

---

# 🟦 COMPONENT CHECKLISTS (BY ROW)

---

## 🔹 OrdersHeader

### Always Visible

* Module title: **Orders**
* Subtitle: scenario-aware

### Subtitle Rules

| Scenario  | Subtitle                       |
| --------- | ------------------------------ |
| NO_ORDERS | “Waiting for your first order” |
| LOSS      | “Some orders are losing money” |
| UNCERTAIN | “Profitability is estimated”   |
| HEALTHY   | “Profitability is confirmed”   |

### Checklist

* ⛔ No CTAs
* ⛔ No metrics
* ✅ Pure text

---

## 🔹 OrdersKpiRow (Row 1 — 3 Cards)

**Component:** `OrdersKpiRow`

### Props

```ts
{
  ordersIngested: number
  avgNetMargin?: number
  lossOrderCount?: number
  scenario: OrdersFt1Scenario
}
```

### Required Cards

Always render **3 cards**.

#### Card 1 — Orders Analyzed

* Value:

  * `0` if NO_ORDERS
  * `ordersIngested` otherwise

#### Card 2 — Net Margin

* NO_ORDERS → `—`
* UNCERTAIN → `X% (est.)`
* Others → `X%`

#### Card 3 — Risk / Status

| Scenario  | Content                |
| --------- | ---------------------- |
| NO_ORDERS | “No data yet”          |
| LOSS      | “Y loss-making orders” |
| UNCERTAIN | “Missing cost data”    |
| HEALTHY   | “Healthy”              |

### Checklist

* ⛔ No loading state
* ⛔ No click behavior
* ✅ Deterministic text

---

## 🔷 OrdersHeroSection (Row 2 — Large Diagram)

**Component:** `OrdersProfitAutopsyHero`

### Props

```ts
{
  orderId?: string
  mode: 'DISABLED' | 'LOSS' | 'INCOMPLETE' | 'CONFIRMED'
}
```

### Mode Mapping

| Scenario  | Mode       |
| --------- | ---------- |
| NO_ORDERS | DISABLED   |
| LOSS      | LOSS       |
| UNCERTAIN | INCOMPLETE |
| HEALTHY   | CONFIRMED  |

### Rendering Rules

* Always render container
* Never collapse height
* Never animate on FT1 load

### Checklist

* ⛔ No dropdowns
* ⛔ No scenario detection inside component
* ✅ Visual state driven by `mode` only

---

## 🔹 OrdersActionRow (Row 3 — 2 Cards)

**Component:** `OrdersActionRow`

### Left Card — Diagnostic

### Right Card — Action

### Props

```ts
{
  scenario: OrdersFt1Scenario
  missingCostCount?: number
}
```

### Content Matrix

| Scenario  | Left                        | Right                |
| --------- | --------------------------- | -------------------- |
| NO_ORDERS | “What happens next”         | “How to get data”    |
| LOSS      | “Why this order lost money” | “Review loss orders” |
| UNCERTAIN | “What’s missing”            | “Fix missing costs”  |
| HEALTHY   | “Where margin comes from”   | “Explore drivers”    |

### CTA Rules

* HEALTHY & LOSS → Paid CTA allowed
* UNCERTAIN → Fix data CTA only
* NO_ORDERS → No upgrade CTAs

### Checklist

* ⛔ No hidden cards
* ⛔ No inline upsell copy
* ✅ Clear next step always present

---

## 🔸 OrdersInsightsGrid (Row 4)

**Component:** `OrdersInsightsGrid`

### Props

```ts
{
  scenario: OrdersFt1Scenario
}
```

### Default Insights per Scenario

| Scenario  | Insights Rendered                     |
| --------- | ------------------------------------- |
| NO_ORDERS | none                                  |
| LOSS      | Bleed Feed, Profit Trend              |
| UNCERTAIN | Missing Cost List, Est. Trend         |
| HEALTHY   | Trendline, Top SKUs, Channel Snapshot |

### Rules

* Max 3 insights shown
* Each insight is a self-contained card
* Customization happens **later**, not in v1

### Checklist

* ⛔ No empty placeholders
* ⛔ No conditional fetches
* ✅ Static layout, dynamic content

---

# 🧪 REQUIRED TEST COVERAGE (UI)

You must have:

* Scenario resolver unit tests (4 cases)
* Snapshot test per scenario (structure only)
* Assert:

  * Hero always rendered
  * KPI row always has 3 cards
  * No FT0 components appear

---

## 🔒 LOCKED FT1 UI GUARANTEES

* FT1 feels intentional, not transitional
* Merchant always understands:

  * **What is happening**
  * **Why it matters**
  * **What to do next**
* No flicker
* No surprises
* No ambiguity

---