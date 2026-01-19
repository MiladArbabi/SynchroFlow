# 🔒 Order-Nexus FT2 Contract Audit (CURRENT / SEALED)

**Status:** ✅ COMPLETE / SEALED
**Scope:** Order-Nexus FT2 — Backend + Frontend
**Standard:** Truth-only · Scan-verified · Read-only
**Audit Type:** Structural + Semantic Contract Audit

---

## 0. Contract Definition — What “Orders FT2” Is (Precisely)

**Orders FT2** is a **read-only economic orientation surface** whose sole role is to:

> Ground the business in **factual**, **directional**, and **epistemically safe** order reality —
> without explanation, causation, or advice.

It is composed of:

1. **FT2 Snapshot (Authoritative Truth Window)**
2. **FT2-Adjacent Analytical Surfaces**

   * Time series
   * Distribution
   * Coverage
3. **Strict Frontend Consumption Path**

   * Snapshot hook
   * Pure adapters
   * Observational UI primitives only

### Explicit Non-Capabilities

Orders FT2 contains **no**:

* lifecycle mutation
* remediation logic
* recommendations
* explanations
* causation
* prediction

FT2 answers **“what is economically visible”**, never **“what to do”**.

---

## 1. Proven Architectural Flow

```
Canonical Database
   ↓
Layer 1 — Order Facts (Truth)
   ↓
Layer 2 — Order Intelligence (Classification & Direction)
   ↓
Layer 3 — FTEP (Truth Exposure Policy)
   ↓
Order-Nexus FT2 Snapshot (Backend)
   ↓
Frontend Adapters (undefined → null only)
   ↓
OrdersModuleFT2 (Observational UI)
```

> **Important:**
> FT2-adjacent analytical surfaces intentionally **bypass** the snapshot pipeline
> and are **not governed by FTEP**.

This bifurcation is **intentional** and **architecturally enforced**.

---

## 2. Layer 1 — Order Facts (Canonical Truth)

### Source of Truth

**Tables**

* `canonical_orders`
* `canonical_order_line_items`

### Extracted Facts (Exact Contract)

| Field                          | Type             | Null Semantics                      |
| ------------------------------ | ---------------- | ----------------------------------- |
| `ordersObserved`               | `number \| null` | `null` if no rows                   |
| `totals.revenueTotal`          | `number \| null` | `null` if DB sum is null            |
| `totals.costTotal`             | `null`           | **Always null** (non-existent fact) |
| `totals.currency`              | `null`           | Not derivable                       |
| `dataCoverage.completenessPct` | `number \| null` | `null` if no line items             |
| `period.from / to`             | `string`         | Always present                      |
| `extractedAt`                  | `string (ISO)`   | Always present                      |

### Guarantees

* DB-only reads
* No derived defaults
* No intelligence
* No interpretation
* Counts, sums, and coverage are **never conflated**

`null` represents **epistemic absence**, not failure.

---

## 3. Layer 2 — Order Intelligence (Deterministic & Gated)

### Purpose

Layer 2 **classifies and orients** raw order facts **only when epistemically safe**.

It **does not explain**, recommend, or infer causality.

---

### Intelligence Thresholds (Internal, Fixed)

| Constant                  | Value | Purpose                                |
| ------------------------- | ----- | -------------------------------------- |
| `COVERAGE_MIN_USABLE_PCT` | 80%   | Minimum data completeness for judgment |
| `TREND_WINDOW_DAYS`       | 7     | Fixed comparison window                |
| `TREND_DELTA_THRESHOLD`   | 5%    | Directional significance threshold     |

These are:

* Not configurable
* Not exposed
* Not advisory

---

### Declared Intelligence Fields (CURRENT)

| Field               | Type                                          | Behavior (Now Active)              |
| ------------------- | --------------------------------------------- | ---------------------------------- |
| `ordersObserved`    | `number \| null`                              | Passthrough                        |
| `margin.averagePct` | `number \| null`                              | Always `null` (inactive by design) |
| `margin.status`     | `'healthy' \| 'loss' \| 'unknown'`            | **Deterministically classified**   |
| `loss.exists`       | `boolean \| null`                             | Derived from margin status         |
| `trend.direction`   | `'up' \| 'down' \| 'flat' \| 'unknown'`       | **Deterministically classified**   |
| `dataCoveragePct`   | `number \| null`                              | Passthrough                        |
| `visibility.status` | `'sufficient' \| 'insufficient' \| 'unknown'` | Derived from data usability        |

---

### Intelligence Semantics

#### Data Usability (Internal Gate)

| Completeness | Result   |
| ------------ | -------- |
| `null`       | unusable |
| `< 80%`      | unusable |
| `≥ 80%`      | usable   |

No intelligence may be derived unless data is **usable**.

---

#### Margin Status (Directional, Not Profit)

| Condition      | Status    |
| -------------- | --------- |
| Data unusable  | `unknown` |
| Revenue `null` | `unknown` |
| Revenue `<= 0` | `loss`    |
| Revenue `> 0`  | `healthy` |

> This is **economic orientation**, not accounting.

---

#### Trend Direction

Computed using **two consecutive fixed windows**.

| Condition            | Direction |
| -------------------- | --------- |
| Data unusable        | `unknown` |
| Insufficient history | `unknown` |
| Increase > 5%        | `up`      |
| Decrease > 5%        | `down`    |
| Otherwise            | `flat`    |

* Deterministic
* Non-predictive
* Non-explanatory

---

#### Economic Visibility (Internal Signal)

| Data Usable | Visibility     |
| ----------- | -------------- |
| `null`      | `unknown`      |
| `false`     | `insufficient` |
| `true`      | `sufficient`   |

This is **not advice** — it is a **constraint made visible**.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### Core Rule

> **No intelligence ever leaks directly.**
> Unknown intelligence is downgraded to **absence (`null`)**.

---

### Exposure Object

`OrderNexusFT2Exposure`

---

### Context

| Field            | Source       |
| ---------------- | ------------ |
| `ordersObserved` | Intelligence |

---

### Totals

| Field          | Source |
| -------------- | ------ |
| `revenueTotal` | Facts  |
| `costTotal`    | Facts  |
| `currency`     | Facts  |

---

### Outcome (Downgraded Intelligence)

Rules:

* If `margin.status === 'unknown'` → `outcome = null`
* Else:

  * `'loss'` → `{ status: 'negative' }`
  * `'healthy'` → `{ status: 'positive' }`

> Although the type allows `'unknown'`, **FTEP never emits it**.

---

### Trend (Downgraded Intelligence)

* If `trend.direction === 'unknown'` → `null`
* Else → `{ direction }`

---

### Data Coverage

| Field             | Source       |
| ----------------- | ------------ |
| `completenessPct` | Intelligence |

---

### Visibility

* If `visibility.status === 'unknown'` → `null`
* Else → `{ status }`

---

### Guarantees

* Deterministic downgrade only
* `null` is the hard epistemic boundary
* No explanation or causation
* No hidden metadata

---

## 5. Orders FT2 Snapshot (Backend Output)

The FT2 snapshot contains **exactly**:

* `context`
* `totals`
* `outcome | null`
* `trend | null`
* `dataCoverage`
* `visibility | null`

No derived fields.
No enrichment.
No side channels.

---

## 6. FT2-Adjacent Analytical Surfaces (Explicitly Out-of-Contract)

These surfaces are **analytical**, not canonical.

They intentionally bypass:

* Intelligence
* FTEP
* Snapshot constraints

---

### 6.1 Time Series Surface

**Signals**

* `date`
* `ordersObserved`
* `revenueTotal`

**Behavior**

* DB-only
* Missing days are **zero-filled**

| Case               | Representation |
| ------------------ | -------------- |
| No orders on a day | `0`            |
| No rows at all     | `series: []`   |

This is **intentional fabrication** for analytical continuity.

---

### 6.2 Distribution Surface

**Signals**

* `totalOrders`
* `minOrderValue`
* `medianOrderValue`
* `maxOrderValue`
* `histogram[]` (5 fixed buckets)

**Behavior**

* Deterministic
* No reuse of Facts or Intelligence
* No orders → safe numeric defaults

---

### 6.3 Coverage Surface

**Signals**

* `totalLineItems`
* `presentCost`
* `missingCost`
* `completenessPct`

**Behavior**

* DB-only
* Numeric defaults allowed
* Semantically aligned with Facts coverage

---

## 7. Frontend Snapshot Consumption

### Snapshot Hook

* Fetches `/api/v1/modules/order-nexus/ft2`
* Backend-owned range
* No transformation
* No params beyond lifecycle scope

---

## 8. Frontend Adapters — Truth Gate

### Snapshot Adapter (`mapOrdersFt2Props`)

Rules:

* `undefined → null`
* Shape stabilization only
* No computation
* No inference
* No backfilling

Adapters are **pipes, not brains**.

---

## 9. OrdersModuleFT2 (UI)

### Behavior

* Observational only
* No fetching
* No state
* No explanation

### Null Rendering

* All `null` → `'—'`
* Percent formatting only when value exists
* Outcome & trend shown **only if exposed**

The UI **never compensates for missing truth**.

---

## 10. Alignment Matrix (FINAL)

| Surface      | Facts | Intelligence | FTEP | Adapter | UI            |
| ------------ | ----- | ------------ | ---- | ------- | ------------- |
| Snapshot     | Yes   | Active       | Yes  | Pure    | Observational |
| Time Series  | DB    | None         | None | Pure    | Observational |
| Distribution | DB    | None         | None | Pure    | Observational |
| Coverage     | DB    | None         | None | Pure    | Observational |

---

## 11. Intentional Constraints (Confirmed)

* No profit computation
* No cost attribution
* No causation
* No recommendation
* No prediction

Orientation without advice is **non-negotiable**.

---

## 12. Accidental Gaps

**None detected.**

All behavior is:

* Explicit in code
* Deterministic
* Gated
* Scan-verified

---

## 13. Final Seal

Orders FT2 now:

* Grounds economic reality
* Creates Stage-3 tension
* Preserves epistemic integrity
* Avoids advisory contamination

🔐 **Order-Nexus FT2 Contract is fully audited, updated, and sealed — CURRENT STATE.**

---