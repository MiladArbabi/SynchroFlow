# FT2 Visual Primitives

This directory contains the **FT2 visual primitive catalog** — the lowest-level, domain-agnostic visual building blocks of LaSyncro’s FT2 (Central Nervous System) layer.

These primitives are **not widgets**, **not dashboards**, and **not insight generators**.
They are the *nervous system*: they transmit facts exactly as given.

---

## Core Principles (Non-Negotiable)

### 1. Truth-Only Rendering

* Primitives **render facts**.
* They **never interpret**, score, rank, assess health, or recommend.
* If a value is unknown, it must be rendered as unknown (`null` → safe empty state).

### 2. Deterministic Output

* Same props → same DOM output.
* No randomness, no time-based behavior, no hidden state.

### 3. Null Is a First-Class State

* `null` is **expected**, not exceptional.
* All primitives must render safely when all inputs are `null`.

### 4. Domain Agnostic

* No product, order, finance, or business semantics.
* Naming must remain generic (`value`, `date`, `left/right`, `bucket`).

### 5. Visuals Are Passive

* No actions
* No clicks
* No tooltips with meaning
* No colors that encode judgment

---

## What Lives Here

Only **visual primitives** that can be reused across:

* Products
* Orders
* Analytics
* Finances
* Dashboards

If a visual cannot be reused across modules, it does **not** belong here.

---

## Current Primitive Catalog

| Primitive           | Purpose                              |
| ------------------- | ------------------------------------ |
| `FT2Stat`           | Single factual value                 |
| `FT2Ratio`          | A vs B (coverage / completeness)     |
| `FT2Distribution`   | Buckets of counts or quantities      |
| `FT2TimeSeries`     | One metric over time                 |
| `FT2DualTimeSeries` | Two related metrics over time        |
| `FT2Scatter`        | Relationship between two values      |
| `FT2ImpactMatrix`   | Density / interaction surface        |
| `FT2EmptyState`     | Explicit truth-unavailable rendering |

---

## What Explicitly Does NOT Belong Here

❌ Health indicators
❌ Scores
❌ Status badges
❌ Risk levels
❌ Gauges
❌ Insights
❌ Recommendations
❌ Domain-named visuals (e.g. `InventoryChart`, `RevenueGraph`)

Those belong to:

* Backend intelligence
* FTEP layers
* Higher narrative surfaces

---

## Testing & Governance

All primitives in this directory are governed by the **FT2 invariant test suite**:

* Null safety enforced
* Deterministic rendering enforced
* Interpretation vocabulary leakage prevented

Any change to a primitive contract **must** be reflected in:

```
/tests/unit/ui/ft2/invariants
```

If invariants fail, the change is invalid.

---

## Design Intent (Mental Model)

Think of each primitive as a **neuron**, not a dashboard.

* It receives signals
* It displays them faithfully
* It does not decide what they mean

> **FT2 visuals are the nervous system, not the brain.**

---

## If You’re Unsure

Ask yourself:

> *Could this visual be reused unchanged in another module with different data?*

If the answer is no — it does not belong here.

---

🔒 This directory is a **governed surface**.
Changes here affect the entire CNS.