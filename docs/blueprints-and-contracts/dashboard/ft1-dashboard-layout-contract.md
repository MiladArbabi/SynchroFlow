# **FT1 Dashboard Layout Contract (v1.0 — LOCKED)**

**Applies to:**

* DashboardPage (global)
* Orders FT1
* Customers FT1
* Products FT1
* Analytics FT1
* Finances FT1

This is a **structural layout invariant**, not a styling preference.

---

## 1. High-Level Principle

> **Orientation → Explanation → Action → Expansion**

Your layout preference maps perfectly to how humans process business truth:

1. **Top row:** quick orientation (status + tension)
2. **Center:** causal explanation (the “why”)
3. **Bottom:** actionable levers
4. **Extension:** user-chosen insights (customizable)

Anything else increases cognitive load and kills conversion.

---

## 2. Canonical FT1 Layout Grid

### **Row 1 — Orientation Layer (3 Small Cards)**

**Format**

* 3 equal-width `Paper` cards
* Always visible
* Zero scrolling required

**Purpose**

* Answer: *“Am I okay?”* in under 3 seconds

**Orders Module – Default Content**

| Card                 | Meaning      | Example                                        |
| -------------------- | ------------ | ---------------------------------------------- |
| **Orders Processed** | Scale anchor | `124 orders analyzed`                          |
| **Net Margin (Avg)** | Outcome      | `18.4% avg margin`                             |
| **Risk Indicator**   | Tension      | `2 loss-making orders` OR `No losses detected` |

**Rules**

* No charts here
* No deep interaction
* Numbers must be **stable, rounded, trustable**

---

### **Row 2 — Explanation Layer (1 Large Diagram)**

**Format**

* Full-width (or dominant-width) `Paper`
* Visually central
* The **hero surface**

**Purpose**

* Answer: *“Why is this happening?”*

**Orders Module – Locked Hero**

> **Profit Autopsy Diagram**

This is **non-negotiable** for Orders.

**Characteristics**

* Waterfall or stacked bar
* Revenue → Costs → Net Profit
* Single representative order (context-dependent)

**Scenario Binding**

* Loss Narrative → loss-making order
* Uncertainty Narrative → order with missing costs
* Verified Profitability → clean profitable order

**Rules**

* One diagram only
* No toggling by default
* Deep exploration is a **paid affordance**

---

### **Row 3 — Action Layer (2 Equal Cards)**

**Format**

* 2 equal-width `Paper` cards
* Horizontally aligned
* Directly under hero diagram

**Purpose**

* Answer: *“What should I do next?”*

**Orders Module – Default Pair**

#### Left Card — Diagnostic Action

Examples:

* “Top causes of margin loss”
* “Missing cost breakdown”
* “Most expensive cost component”

#### Right Card — Forward Action

Examples:

* “Fix missing costs”
* “Review loss-making orders”
* “Compare margin by channel” (paywalled affordance)

**Rules**

* Each card = one job
* Each card = one CTA
* One may be paywalled, never both

---

### **Row 4 — Insight Extension Layer (Customizable)**

**Format**

* User-configurable grid
* Optional
* Persisted per user

**Purpose**

* Answer: *“What do I personally care about?”*

**Examples**

* Recent bleed feed
* Profit trendline
* Channel snapshot
* SKU-level summary

**Rules**

* Never empty by default
* Defaults provided per module
* User can add/remove/reorder

---

## 3. Cross-Module Consistency Rule

Every FT1 module **must respect this exact vertical rhythm**:

```
[ 3 Orientation Cards ]
[ 1 Hero Explanation ]
[ 2 Action Cards ]
[ Custom Insights Grid ]
```

Only **content changes**, never structure.

This creates:

* Muscle memory
* Predictability
* Faster insight uptake
* Easier onboarding across modules

---

## 4. How This Drives Conversion (Important)

This layout **naturally creates upgrade pressure** without dark patterns:

* Top row shows **tension**
* Hero proves **truth**
* Bottom right card offers **depth**
* Depth is paywalled

The user never feels blocked — only **curious**.

---

## 5. What This Explicitly Prevents

❌ Random card grids
❌ “Analytics soup” dashboards
❌ Empty states in FT1
❌ Multiple hero charts
❌ Feature-driven layouts

---

## 6. DashboardPage vs Module Pages

### **DashboardPage (Global)**

* Same structure
* Aggregated signals across modules
* Hero = “Business Health Summary”

### **Module Pages**

* Same structure
* Module-specific hero + actions
* Same mental model

---

## 7. Lock Statement

This layout is now:

* **Canonical**
* **Reusable**
* **Non-negotiable**

If a future screen deviates, it must:

1. Declare itself experimental, or
2. Version the layout contract

Otherwise, it’s a regression.

---