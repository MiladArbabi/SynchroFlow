# 🔐 Analytics Module — FT2 Features & Offerings Blueprint

**(Free-Tier vs Paid, FT2 as the Apex)**

---

## 0. Analytics Prime Directive (Module-Specific)

> **Analytics owns time, continuity, and comparison semantics — nothing else.**

Analytics does **not** own:

* Profitability
* Efficiency
* Performance quality
* Optimization
* Decision-making

It owns **how truth behaves across time** — and how much of that behavior is permitted to be seen.

---

## 1. Analytics Truth Domain (What It Owns)

From the global Truth Ownership Model:

| Module    | Owns Truth About                               |
| --------- | ---------------------------------------------- |
| Analytics | **Time, continuity, and comparison semantics** |

This means Analytics is allowed to:

* Observe snapshots
* Observe sequences of snapshots
* Observe directional change
* Enforce temporal exposure rules

Analytics is **not allowed** to:

* Judge
* Explain
* Optimize
* Recommend

---

## 2. Analytics Facts (What Exists, Period)

Analytics Facts are **strictly raw temporal observations**, sourced only from modules that already own the underlying truth.

### Canonical Facts Surface (As Built)

```ts
AnalyticsFacts {
  revenueObserved: number | null
  cogsObserved: number | null
  ordersObserved: {
    processing: number | null
    delivered: number | null
    in_transit: number | null
  }
  period: { from, to }
  extractedAt
}
```

No ratios.
No rollups beyond aggregation.
No “health”.
No derived efficiency.

This is the **entire universe** Analytics operates on.

---

## 3. Analytics Intelligence (Internal Only)

Analytics Intelligence exists **only to support safe downgrading**.

### What Intelligence May Do

* Classify existence (`positive | negative | unknown`)
* Classify direction (`up | down | flat | unknown`)
* Degrade gracefully when data is missing

### What It May Never Do

* Compute percentages
* Attribute cause
* Compare against ideals
* Store or expose reasoning

Intelligence exists **solely** so FTEP can decide **what not to show**.

---

## 4. Analytics FTEP — The Commercial Boundary

**All monetization happens here.**
Not by adding intelligence — by **widening exposure permissions**.

---

# 5. FT2-Free Analytics Offering

**“Existence Without Comfort”**

FT2-Free answers one question:

> *Does reality exist — and can I trust what I’m seeing?*

### 5.1 Allowed Exposure (FT2-Free)

#### Revenue Presence

* `revenueObserved`
* `outcome.status` → positive / negative / unknown

No scale.
No comparison.
No success framing.

#### Order Flow Snapshot

* Raw counts by state
* No ratios
* No SLAs
* No bottleneck inference

#### Single Time Window

* Exactly one `{ from, to }`
* No historical context
* No trend computation

Nulls are **visible and respected**.

---

### 5.2 Explicitly Withheld (FT2-Free)

* Trends
* Comparisons
* Continuity
* Historical depth
* Cross-module aggregation

Not because they are “advanced” —
but because they **create false certainty too early**.

---

### 5.3 FT2-Free User Experience Intent

FT2-Free Analytics should feel:

* Calm
* Sparse
* Slightly uncomfortable
* Honest about uncertainty

If a free user feels “in control”, **you’ve overexposed**.

---

# 6. FT2-Paid Analytics Offering

**“Continuity Without Interpretation”**

Paid Analytics does **not** make Analytics smarter.

It makes **reality harder to ignore**.

---

## 6.1 What Paid Unlocks (Exactly)

### A. Temporal Continuity (Core Value)

Paid unlocks **multiple FT2 snapshots across time**.

This enables:

* Directional trend exposure
* Sequence awareness
* Pattern visibility

Still:

* No deltas
* No percentages
* No rates
* No thresholds

Trend is exposed only as:

```
up | down | flat | unknown
```

Nothing else.

---

### B. Multi-Window Comparison (Self Only)

Paid allows:

* This period vs previous period
* This month vs last month

Paid **never allows**:

* Industry benchmarks
* Peer comparisons
* “Ideal” states

Why:
Benchmarks fabricate authority Analytics does not own.

---

### C. Broader Metric Surface (Still Raw)

Paid may expose:

* More raw metrics
* Across more time windows
* With the same downgrade rules

Depth increases.
Semantics do not.

---

### D. Extended Memory

Paid increases:

* Retention window
* Historical reach
* Time horizon

This reinforces the core paid value:

> *You cannot escape your own history.*

---

## 6.2 What Paid Still Does NOT Get

Even at FT2-Paid:

❌ Margin %
❌ Profit
❌ Cost efficiency
❌ Perfect order %
❌ Inventory health
❌ “Why” explanations
❌ Recommendations
❌ Prescriptive language

If a paid user asks:

> “So what should I do?”

The correct answer remains:

> *Analytics does not tell you that.*

---

## 7. Cross-Module Analytics Rules (Strict)

Analytics may **only** expose combined truth when:

* Analytics FT2 entitlement exists
* AND the other module’s FT2 entitlement exists

Examples:

| Scenario                    | Result                      |
| --------------------------- | --------------------------- |
| Analytics paid, Orders free | No trend                    |
| Analytics + Orders paid     | Trends allowed              |
| Analytics + Finances paid   | Economic continuity allowed |
| Analytics paid alone        | Snapshot only               |

Truth requires **mutual ownership**.

---

## 8. UI & Language Constraints (Critical)

Analytics UI — Free or Paid — must:

* Avoid “success” language
* Avoid “performance” framing
* Avoid celebration
* Avoid CTAs that imply decisions

Correct tone:

* Observational
* Neutral
* Slightly unsettling
* Responsibility-preserving

Analytics **shows**.
It never **assures**.

---

## 9. Monetization Truth (Uncomfortable but Real)

You do **not** sell Analytics by:

* Making it smarter
* Making it friendlier
* Making it more confident

You sell Analytics by:

* Removing the ability to lie to oneself over time

FT2-Free:

* *Reality exists.*

FT2-Paid:

* *Reality persists.*

That is the upgrade.

---

## 10. Final Lock — Analytics FT2 Doctrine

> Analytics does not help users win.
> It prevents them from pretending.

> FT2 is the product.
> Time is the leverage.
> Permission is the price.

This blueprint is now **canonical for Analytics**.