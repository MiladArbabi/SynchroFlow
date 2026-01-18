# 🔒 Order-Nexus FT2 Contract Audit (AS-IS)

**Status:** ✅ COMPLETE / SEALED
**Scope:** Order-Nexus FT2 — Backend + Frontend
**Standard:** Truth-only · Scan-verified · Read-only
**Audit Type:** Structural + Semantic Contract Audit

---

## 0. Contract Definition — What “Orders FT2” Is (Precisely)

**Orders FT2** is a **read-only observability surface** composed of:

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
* inference

FT2 answers **“what is visible”**, never **“what to do”**.

---

## 1. Proven Architectural Flow

```
Canonical Database
   ↓
Layer 1 — Order Facts
   ↓
Layer 2 — Order Intelligence
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
> FT2-adjacent analytical surfaces intentionally **bypass** the snapshot pipeline and are not governed by FTEP.

This bifurcation is **by design**, not an inconsistency.

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
* Counts, sums, and coverage are **not conflated**

`null` is treated as **epistemic absence**, not failure.

---

## 3. Layer 2 — Order Intelligence (Structurally Present, Behaviorally Inert)

### Declared Intelligence Fields

| Field               | Type                                            | As-Is Behavior     |
| ------------------- | ----------------------------------------------- | ------------------ |
| `ordersObserved`    | `number \| null`                                | Passthrough        |
| `margin.averagePct` | `number \| null`                                | Always `null`      |
| `margin.status`     | `'healthy' \| 'at_risk' \| 'loss' \| 'unknown'` | Always `'unknown'` |
| `loss.exists`       | `boolean \| null`                               | Always `null`      |
| `trend.direction`   | `'up' \| 'down' \| 'flat' \| 'unknown'`         | Always `'unknown'` |
| `dataCoveragePct`   | `number \| null`                                | Passthrough        |

### Properties

* No DB access
* No thresholds
* No branching
* No state transitions
* Intelligence exists **only as a structural placeholder**

This layer is **explicitly dormant** and produces no actionable signal.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### Exposure Object

`OrderNexusFT2Exposure`

---

### Context

| Field            | Source       |
| ---------------- | ------------ |
| `period`         | Facts        |
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
  * otherwise → `{ status: 'positive' }`

> **Critical Rule:**
> Although the type allows `'unknown'`, FTEP **never emits it**.
> Unknown intelligence is downgraded to **absence (`null`)**.

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

### Guarantees

* No intelligence leaks
* Deterministic downgrade
* `null` is the **hard epistemic boundary**
* No interpretive enrichment

---

## 5. Orders FT2 Snapshot (Backend Output)

The FT2 snapshot contains **exactly**:

* `context`
* `totals`
* `outcome | null`
* `trend | null`
* `dataCoverage`

No derived fields.
No hidden metadata.
No conditional enrichment.

---

## 6. FT2-Adjacent Analytical Surfaces (Explicitly Out-of-Contract)

These surfaces are rendered inside FT2 **but are not part of the snapshot contract**.

They intentionally bypass Facts → Intelligence → FTEP.

---

### 6.1 Time Series Surface

**Signals**

* `date`
* `ordersObserved`
* `revenueTotal`

**Behavior**

* Direct DB reads (`canonical_orders`)
* Grouped by date
* Missing days are **explicitly zero-filled**

| Case               | Representation |
| ------------------ | -------------- |
| No orders on a day | `0`            |
| No rows at all     | `series: []`   |

> This is **explicit fabrication**, not null-preserving truth.
> It is allowed only because this surface is **analytical**, not canonical.

---

### 6.2 Distribution Surface

**Signals**

* `totalOrders`
* `minOrderValue`
* `medianOrderValue`
* `maxOrderValue`
* `histogram[]` (5 deterministic buckets)

**Behavior**

* Derived analytics
* No reuse of Facts or Intelligence
* If no orders:

  * totals → `0`
  * min / median / max → `null`
  * histogram → `[]`

---

### 6.3 Coverage Surface

**Signals**

* `totalLineItems`
* `presentCost`
* `missingCost`
* `completenessPct`

**Behavior**

* DB-only
* Duplicates completeness logic from Facts
* Numeric defaults (`0`) except `completenessPct`

---

## 7. Frontend Snapshot Consumption

### Snapshot Hook

* Fetches `/api/v1/modules/order-nexus/ft2`
* No parameters
* No transformation
* Period is backend-owned and authoritative

---

## 8. Frontend Adapters — Critical Truth Gate

### Snapshot Adapter (`mapOrdersFt2Props`)

**Rules**

* `undefined → null`
* Shape stabilization only
* No computation
* No inference
* No backfilling

> Adapters are **pipes**, not brains.

### Analytical Surface Adapters

* Time series: pass-through
* Distribution: pass-through
* Coverage: pass-through

All enforce `undefined → null` only.

---

## 9. OrdersModuleFT2 (UI)

### Behavior

* Observational only
* No hooks
* No fetching
* No state
* No interpretation

### Null Rendering Rules

* All nulls rendered as `'—'`
* Percent formatting only when value exists
* Outcome and trend shown **only if exposed**

### Guarantees

* UI never compensates
* UI never upgrades truth
* UI never infers
* UI never explains

---

## 10. Alignment Matrix (Final)

| Surface      | Facts | Intelligence | FTEP | Adapter | UI            |
| ------------ | ----- | ------------ | ---- | ------- | ------------- |
| Snapshot     | Yes   | Inert        | Yes  | Pure    | Observational |
| Time Series  | DB    | None         | None | Pure    | Observational |
| Distribution | DB    | None         | None | Pure    | Observational |
| Coverage     | DB    | None         | None | Pure    | Observational |

---

## 11. Intentional Gaps (Confirmed)

* Margin intelligence inactive
* Loss detection inactive
* Trend derivation inactive
* Cost unavailable at order level
* Currency unavailable at order level
* Unknown intelligence downgraded to `null`

These are **deliberate**, not missing work.

---

## 12. Accidental Gaps

**None detected.**

Every `null`, `0`, suppression, and downgrade is:

* Explicit in code
* Deterministic
* Consistent across layers

---

## 13. Final Seal

* All Orders FT2 fields enumerated
* All execution paths scan-verified
* No hidden logic
* No leaky abstractions
* No unscanned surfaces

🔐 **Order-Nexus FT2 Contract is fully audited, locked, and sealed — AS-IS.**

---