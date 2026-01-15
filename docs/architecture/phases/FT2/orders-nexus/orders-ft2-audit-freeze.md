# 🔒 Order-Nexus FT2 Contract Audit (As-Is)

**Status:** COMPLETE
**Scope:** Entire Orders FT2 surface — backend + frontend
**Standard:** Truth-only, scan-verified, read-only

---

## 0. Contract Definition (What “Orders FT2” Is)

**Orders FT2** is a **read-only observability surface** composed of:

1. **FT2 Snapshot (Authoritative Truth Window)**
2. **Adjunct Analytical Surfaces**

   * Timeseries
   * Distribution
   * Coverage
3. **Strict Frontend Consumption Path**

   * Snapshot hook
   * Pure adapters
   * Observational UI only

There is **no lifecycle**, **no remediation**, **no recommendation**, and **no inference** anywhere in this surface.

---

## 1. Architectural Flow (Proven)

```
Canonical DB
   ↓
Order Facts (Layer 1)
   ↓
Order Intelligence (Layer 2)
   ↓
Order FTEP (Layer 3)
   ↓
Order-Nexus FT2 Snapshot
   ↓
Frontend Adapters (undefined → null only)
   ↓
OrdersModuleFT2 (Observational UI)
```

Adjunct analytical surfaces **bypass** this chain by design.

---

## 2. Layer 1 — Order Facts (Canonical Truth)

### Source

* Tables:

  * `canonical_orders`
  * `canonical_order_line_items`

### Extracted Facts (Exact)

| Field                          | Type             | Null Rule                          |
| ------------------------------ | ---------------- | ---------------------------------- |
| `ordersObserved`               | `number \| null` | `null` if no row                   |
| `totals.revenueTotal`          | `number \| null` | `null` if DB sum null              |
| `totals.costTotal`             | `null`           | **Always null** (nonexistent fact) |
| `totals.currency`              | `null`           | Not derivable                      |
| `dataCoverage.completenessPct` | `number \| null` | `null` if no line items            |
| `period.from / to`             | `string`         | Always present                     |
| `extractedAt`                  | `string (ISO)`   | Always present                     |

### Guarantees

* DB-only reads
* No defaults except null normalization
* No intelligence
* No interpretation
* Counts, sums, and presence metrics are **explicitly separated**

---

## 3. Layer 2 — Order Intelligence (Dormant by Design)

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
* No conditionals
* No thresholds
* No state transitions
* Intelligence layer is **structurally present but behaviorally inert**

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### Exposure Object: `OrderNexusFT2Exposure`

#### Context

| Field            | Source                     |
| ---------------- | -------------------------- |
| `period`         | Facts                      |
| `ordersObserved` | Intelligence (passthrough) |

#### Totals

| Field          | Source |
| -------------- | ------ |
| `revenueTotal` | Facts  |
| `costTotal`    | Facts  |
| `currency`     | Facts  |

#### Outcome (Suppressed Intelligence)

* If `margin.status === 'unknown'` → `outcome = null`
* Else:

  * `'loss'` → `{ status: 'negative' }`
  * otherwise → `{ status: 'positive' }`

> **Important:**
> Although types allow `'unknown'`, FTEP **never emits it**.
> Unknown intelligence is **downgraded to null**.

#### Trend (Suppressed Intelligence)

* If `trend.direction === 'unknown'` → `null`
* Else → `{ direction }`

#### Data Coverage

| Field             | Source                             |
| ----------------- | ---------------------------------- |
| `completenessPct` | Intelligence (passthrough or null) |

### Guarantees

* No intelligence leaks
* Deterministic downgrade only
* Null used as **epistemic boundary**

---

## 5. Orders FT2 Snapshot (Backend Output)

**Snapshot contains exactly:**

* `context`
* `totals`
* `outcome | null`
* `trend | null`
* `dataCoverage`

No more. No less.

---

## 6. Adjunct Analytical Surfaces (FT2-Adjacent)

These are **not part of the snapshot contract** but are rendered inside FT2.

---

### 6.1 Timeseries Surface

**Signals**

* `date`
* `ordersObserved`
* `revenueTotal`

**Behavior**

* Direct DB access (`canonical_orders`)
* Groups by date
* Missing days are **explicitly zero-filled**

| Missing Data       | Representation |
| ------------------ | -------------- |
| No orders on a day | `0`            |
| No rows at all     | `series: []`   |

> This is **explicit fabrication**, not null-preserving truth.

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
* No Facts / Intelligence reuse
* If no orders:

  * totals = `0`
  * min / median / max = `null`
  * histogram = `[]`

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
* No params
* No transformation
* Backend-owned period

---

## 8. Frontend Adapters (Critical Truth Gate)

### Snapshot Adapter (`mapOrdersFt2Props`)

**Rules enforced**

* `undefined → null`
* Shape stabilization
* No computation
* No inference
* No backfilling

> Adapter is a **pipe**, not a brain.

### Timeseries Adapter

* `undefined → null`
* Pass-through only

### Distribution Adapter

* `undefined → null`
* Pass-through only

---

## 9. OrdersModuleFT2 (UI)

### Behavior

* Observational only
* No hooks
* No fetching
* No state
* No inference

### Null Representation

* All nulls rendered as `'—'`
* Percent formatting only when value exists
* Outcome & trend shown **only if exposed**

### Guarantees

* UI never compensates
* UI never upgrades truth
* UI never infers

---

## 10. Alignment Matrix (Final)

| Surface      | Facts | Intelligence | FTEP | Adapter | UI            |
| ------------ | ----- | ------------ | ---- | ------- | ------------- |
| Snapshot     | Yes   | Inert        | Yes  | Pure    | Observational |
| Timeseries   | DB    | None         | None | Pure    | Observational |
| Distribution | DB    | None         | None | Pure    | Observational |
| Coverage     | DB    | None         | None | Pure    | Observational |

---

## 11. Intentional Gaps (Confirmed)

* Margin intelligence inactive
* Loss detection inactive
* Trend derivation inactive
* Cost unavailable at order level
* Currency unavailable at order level
* Unknown intelligence suppressed to `null`

---

## 12. Accidental Gaps

**None detected.**

Every null, zero, suppression, and derivation is:

* Explicit in code
* Deterministic
* Consistent across layers

---

## 13. Final Seal

* All Orders FT2 fields and signals are enumerated
* All paths are scan-verified
* No hidden logic
* No leaky abstractions
* No unscanned surfaces

**🔐 Order-Nexus FT2 Contract is fully audited, locked, and sealed — AS-IS.**