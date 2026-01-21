# 🔒 Order-Nexus FT2 Contract Audit (CURRENT · ACTIVE)

**Status:** ✅ COMPLETE / SEALED
**Scope:** Order-Nexus FT2 — Backend + Frontend
**Standard:** Truth-only · Scan-verified · Read-only
**Audit Type:** Structural + Semantic Contract Audit

---

## 0. Contract Definition — What “Orders FT2” Is (Precisely)

**Orders FT2** is a **read-only economic orientation surface** composed of:

1. **FT2 Snapshot (Authoritative, Downgraded Truth)**
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
* forecasting

FT2 answers **“what is visible and directionally true”**,
never **“what to do.”**

---

## 0.1 Domains & Alignment Planes (ACTIVE FT2 SCOPE)

Orders FT2 is a **multi-domain reality surface**.
Each domain answers exactly **one observable question**.

### Active Domains

| Domain | Layer | Question Answered |
|------|------|------------------|
| Order Presence Reality | L1 | Do orders exist in this period? |
| Revenue Presence Reality | L1 | Does revenue exist? |
| Economic Outcome Reality | L2 | Are orders economically positive or negative? |
| Order Volume Direction Reality | L1½ | Is order volume up / down / flat? |
| Data Coverage Reality | L1 | Is data complete enough to interpret? |
| Economic Visibility Reality | L2 | Is economic orientation epistemically allowed? |
| Fulfillment Presence Reality | L1 | Do fulfillment signals exist? |
| Fulfillment Reality | L2 | Are orders operationally real or unreal? |

Domains:

* Do not compute
* Do not infer
* Do not explain
* Fail closed (`null` / `unknown`)

---

### Alignment Planes (Cross-Domain Classification)

Alignment planes **classify consistency** between domains.
They never create truth.

| Plane | Participating Domains | Status |
|----|----------------------|--------|
| Cross-Domain Trust (META) | All domains | ✅ Implemented |
| Demand Reality | Customers ↔ Orders | ✅ Implemented |
| Engagement ↔ Revenue | Customers ↔ Orders ↔ Finance | ✅ Implemented |
| Operational ↔ Economic | Orders ↔ Fulfillment | ✅ Implemented |

Alignment planes:

* Execute after FTEP
* Are read-only
* Fail closed
* Never explain or advise

---

## 1. Proven Architectural Flow

```
Canonical Database
   ↓
Layer 1 — Order & Fulfillment Facts
Layer 1½ — Temporal Facts (Directional Inputs)
Layer 2 — Order & Fulfillment Intelligence (ACTIVE, INTERNAL)
Layer 3 — FTEP (Truth Exposure Policy)
Layer 4 — Alignment Planes (Read-only)
Order-Nexus FT2 Snapshot (Backend)
```

* Alignment planes do not feed intelligence.
* They operate strictly on exposed truth.

> **Important:**
> FT2-adjacent analytical surfaces intentionally **bypass** the snapshot pipeline and are not governed by FTEP.

This bifurcation is **intentional and enforced**.

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
* No interpretation
* No intelligence
* Coverage and revenue are **never conflated**

`null` represents **epistemic absence**, not failure.

---

## 3. Layer 2 — Order Intelligence (ACTIVE, INTERNAL)

### Purpose

Convert **facts → deterministic orientation signals**,
**strictly for internal use**.

This layer **may think**,
but **may never speak directly**.

---

### Declared Intelligence Fields (CURRENT)

| Field               | Type                                          | Behavior                     |
| ------------------- | --------------------------------------------- | ---------------------------- |
| `ordersObserved`    | `number \| null`                              | passthrough                  |
| `margin.averagePct` | `null`                                        | intentionally inactive       |
| `margin.status`     | `'healthy' \| 'loss' \| 'unknown'`            | **ACTIVE**                   |
| `loss.exists`       | `boolean \| null`                             | **ACTIVE (downgraded form)** |
| `trend.direction`   | `'up' \| 'down' \| 'flat' \| 'unknown'`       | **ACTIVE**                   |
| `dataCoveragePct`   | `number \| null`                              | passthrough                  |
| `visibility.status` | `'sufficient' \| 'insufficient' \| 'unknown'` | **ACTIVE**                   |

---

### Intelligence Activation Gate (Hard Boundary)

All intelligence **requires epistemically usable data**.

**Data usability rule:**

* `null` coverage → unusable
* `< 80%` coverage → unusable
* `≥ 80%` coverage → usable

No signal is allowed to activate without passing this gate.

---

### Active Intelligence Semantics

#### Margin Status (Directional, Not Accounting)

| Condition      | Result    |
| -------------- | --------- |
| Data unusable  | `unknown` |
| Revenue `null` | `unknown` |
| Revenue `<= 0` | `loss`    |
| Revenue `> 0`  | `healthy` |

This is **economic orientation**, not margin calculation.

---

#### Trend Direction

Computed from **two fixed 7-day windows**.

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

#### Economic Visibility (Internal Constraint)

| Data Usable | Visibility     |
| ----------- | -------------- |
| `null`      | `unknown`      |
| `false`     | `insufficient` |
| `true`      | `sufficient`   |

This expresses **whether the business is allowed to orient**,
not whether it is doing well.

---

### Fulfillment Intelligence (ACTIVE, INTERNAL)

Classifies whether economic order outcomes
are grounded in operational reality.

| Field | Type | Meaning |
|----|----|--------|
| `operationalReality` | `'real' \| 'unreal' \| 'unknown'` | Grounded in fulfillment signals |
| `visibility` | `'sufficient' \| 'unknown'` | Epistemic usability |

Rules:

* Presence-only
* No SLA or performance semantics
* Unknown propagates aggressively

---

### Forbidden (Still Enforced)

* ❌ Explanations
* ❌ Causes or drivers
* ❌ Recommendations
* ❌ Forecasting
* ❌ Cross-domain inference

If intelligence becomes **narrative**, the layer is broken.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### Purpose

Define **what truth may leave the backend**.

This is the **security boundary**.

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

> **Critical:**
> `'unknown'` is **never emitted**.
> Unknown intelligence is downgraded to **absence (`null`)**.

---

### Trend (Downgraded Intelligence)

* `'unknown'` → `null`
* otherwise → `{ direction }`

---

### Visibility (Downgraded Constraint)

* `'unknown'` → `null`
* otherwise → `{ status: 'sufficient' | 'insufficient' }`

Visibility communicates **whether orientation is trustworthy**,
not advice.

---

### Guarantees

* No intelligence leaks
* Deterministic downgrade only
* `null` is a **hard epistemic boundary**
* No enrichment, no explanation

---

## 5. Orders FT2 Snapshot (Backend Output)

The snapshot contains **exactly**:

* `context`
* `totals`
* `outcome | null`
* `trend | null`
* `dataCoverage`
* `visibility | null`
* `alignment (optional, read-only)`

Nothing else.

Alignment never alters snapshot values.
It is observational only.
No hidden metadata.
No internal flags.
No partial upgrades.

---

## 5.1 Alignment Planes (FT2)

Alignment planes classify **cross-domain coherence**.

They:
- Run after FTEP
- Never mutate facts or intelligence
- Fail closed (`unknown`)
- Are deterministic

### Active Planes

| Plane | Meaning |
|----|--------|
| Demand Reality | Customer demand ↔ observed orders |
| Engagement ↔ Revenue | Engagement trend ↔ economic outcome |
| Operational ↔ Economic | Order outcome ↔ fulfillment reality |
| Cross-Domain Trust | Epistemic comparability gate |

Alignment is **directional**, not explanatory.

---

## 6. FT2-Adjacent Analytical Surfaces (Out-of-Contract by Design)

These surfaces **bypass** Facts → Intelligence → FTEP.

They are **analytical**, not canonical.

---

### 6.1 Time Series

* Zero-filled missing days
* Empty series when no rows
* Explicit fabrication allowed

---

### 6.2 Distribution

* Derived analytics
* Deterministic buckets
* No reuse of intelligence

---

### 6.3 Coverage

* DB-only
* Numeric defaults
* Completeness preserved

---

## 7. Frontend Snapshot Consumption

* Backend-owned range
* Snapshot hook is read-only
* No transformation
* No inference

---

## 8. Frontend Adapters — Truth Gate

**Rules**

* `undefined → null`
* Shape stabilization only
* Zero computation

Adapters are **pipes**, not brains.

---

## 9. OrdersModuleFT2 (UI)

### Guarantees

* Observational only
* Null-safe everywhere
* No compensation
* No interpretation
* No explanation

UI **cannot upgrade truth**.

---

## 10. Alignment Matrix (FINAL)

| Surface | Facts | Intelligence | FTEP | Alignment | Adapter | UI |
|-------|------|-------------|------|----------|--------|----|
| Snapshot | Yes | Active | Yes | Yes | Pure | Observational |
| Time Series | DB | None | None | None | Pure | Observational |
| Distribution | DB | None | None | None | Pure | Observational |
| Coverage | DB | None | None | None | Pure | Observational |

---

## 11. Intentional Gaps (CONFIRMED)

* No cost-based margin
* No profit calculation
* No currency inference
* No forecasting
* No causation

These are **architectural constraints**, not missing work.

---

## 12. Accidental Gaps

**None detected.**

Every downgrade, threshold, and `null` is:

* Explicit
* Deterministic
* Scan-verified

---

## 13. Final Seal

* Multi-domain orientation achieved without advice
* Intelligence active but contained
* Visibility elevated to first-class signal
* Stage-3 tension possible without narration

🔐 **Order-Nexus FT2 Contract is fully audited, aligned, and sealed — CURRENT STATE.**

---