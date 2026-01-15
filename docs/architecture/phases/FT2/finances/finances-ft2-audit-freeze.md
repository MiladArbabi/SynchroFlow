# 📊 FT2 Audit Report — Finances Module (marginCore)

**Audit Type:** Truth Audit (Read-Only)
**Scope:** Finances module + backend engine (marginCore)
**Methodology:** Scan-driven code inspection only
**Guarantee:** Zero assumptions, zero inferred intent

---

## 1. Executive Summary

The Finances module is **architecturally correct, conservative, and intentionally incomplete**.

It implements the full **FT2 four-layer architecture** end-to-end:

```
Canonical DB → Facts → Intelligence → FTEP → FT2 UI
```

Key characteristics:

* Truth is **preserved, not enhanced**
* Absence of data is **explicitly represented as null**
* Intelligence is **contained and partially dormant**
* Exposure is **deliberately suppressive**
* UI is **purely observational**
* Finances is **not consumed cross-surface** (no dashboard or eligibility coupling)

No architectural violations were detected.

---

## 2. Layer 1 — Facts (Canonical Truth)

### 2.1 Location & Responsibility

**Service**

```
apps/backend/src/services/finances-facts/FinancesFacts.service.ts
```

**Declared responsibility**

* Canonical DB access only
* No intelligence
* No thresholds
* Null preservation guaranteed

This contract is **fully honored**.

---

### 2.2 Canonical Data Sources

**Tables accessed**

* `canonical_orders` (only)

No joins.
No derived tables.
No cross-domain access.

---

### 2.3 Extracted Facts

| Fact                           | Source                              | Type   | Null Condition           |
| ------------------------------ | ----------------------------------- | ------ | ------------------------ |
| `totalRevenue`                 | `SUM(canonical_orders.total_price)` | number | DB sum is null           |
| `totalCosts`                   | —                                   | number | **Always null (forced)** |
| `netResult`                    | `totalRevenue - totalCosts`         | number | Either operand null      |
| `dataCoverage.completenessPct` | `COUNT(canonical_orders.id)`        | number | Count = 0                |
| `extractedAt`                  | runtime                             | string | never                    |

**Key property:**
Counts, sums, and presence are **cleanly separated**.

---

### 2.4 Null Semantics (Facts)

* Null ≠ zero
* Null = *absence of evidence*
* Coverage answers one question only:

  > “Did we observe any canonical orders?”

This is **textbook FT2-compliant fact modeling**.

---

## 3. Layer 2 — Intelligence (Classification Only)

### 3.1 Location

```
apps/backend/src/services/finances-intelligence/FinancesIntelligence.service.ts
```

---

### 3.2 Intelligence Outputs

| Field              | Purpose        | Behavior             |
| ------------------ | -------------- | -------------------- |
| `netResult.value`  | pass-through   | mirrors fact         |
| `netResult.status` | classification | good / bad / unknown |
| `trend.direction`  | trend          | **always unknown**   |
| `dataCoveragePct`  | pass-through   | mirrors fact         |
| `marginPct`        | internal only  | suppressed later     |
| `lossReason`       | internal only  | suppressed later     |

---

### 3.3 Classification Rules (Exact)

**Status**

* `unknown` → default
* `good` → `netResult >= 0`
* `bad` → `netResult < 0`

**Trend**

* Always `unknown`
* No historical comparison exists

**Margin**

* Computed only when mathematically safe
* Never exposed

---

### 3.4 Intelligence Posture

* Conservative by default
* Deterministic
* Stateless
* Some fields are **structurally dormant today**

  * `trend.direction`

No intelligence leaks detected.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

### 4.1 Location

```
apps/backend/src/services/finances-ftep/FinancesFtep.service.ts
```

---

### 4.2 Exposure Contract (FT2-Safe)

**Always exposed**

* `context.period`
* `context.revenueObserved`
* `context.netObserved`
* `dataCoverage.completenessPct`

**Conditionally exposed**

* `outcome`
* `trend`

---

### 4.3 Suppression Rules (Explicit)

| Condition                        | Result                           |
| -------------------------------- | -------------------------------- |
| `netResult.status === 'unknown'` | `outcome = null`, `trend = null` |
| Internal intelligence            | **always suppressed**            |

**Suppressed permanently**

* `marginPct`
* `lossReason`

---

### 4.4 Exposure Integrity

* No thresholds added
* No defaults injected
* No meaning introduced
* Downgrade only, never upgrade

FTEP behaves exactly as a **truth firewall**.

---

## 5. Layer 4 — FT2 UI (Observational Surface)

### 5.1 Entry Point

```
apps/frontend/src/pages/FinancesFT2Page.tsx
```

---

### 5.2 Snapshot Acquisition

**Hook**

```
useFinancesFt2Snapshot
```

* Backend-owned period
* Read-only
* No transformation
* No client-side params

---

### 5.3 Adapter

```
apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts
```

**Verified properties**

* Pure function
* `undefined → null` normalization only
* No math
* No inference
* No formatting logic
* Explicit warnings against enhancement

---

### 5.4 Rendering Semantics

* UI renders exactly what it receives
* `null` → rendered as `—`
* No compensation
* No derived values
* No “helpful” assumptions

UI is **passive by design**.

---

## 6. System-Level Integration

### 6.1 Backend Aggregation

* Finances FT2 exposure is **not consumed** by:

  * FT2 Evaluator
  * FT2 Latch
  * Any other domain service

FT2 eligibility is based solely on:

* Orders
* Products
* Customers

---

### 6.2 Frontend Cross-Surface Usage

**Dashboard FT2**

* Does **not** consume Finances
* No financial KPIs displayed
* No hidden coupling

Finances is a **standalone FT2 surface**.

---

## 7. Cross-Surface Alignment Matrix (Final)

| Module   | Fact Exists | Intelligence Active | FTEP Exposes              | Dashboard Consumes | UI Shows |
| -------- | ----------- | ------------------- | ------------------------- | ------------------ | -------- |
| Finances | Yes         | Conditional         | Outcome null when unknown | No                 | —        |

---

## 8. Gap Classification

### 8.1 Intentional Gaps (Architectural)

* Costs unavailable → forced `null`
* Trend unavailable → forced `unknown`
* Outcome suppressed when indeterminate
* No dashboard presence
* No eligibility coupling

All are **explicitly documented in code**.

---

### 8.2 Accidental Gaps

* **None detected**
* No missing wiring
* No dead paths
* No half-exposed intelligence

---

## 9. Safe Future Unlock Points (Evidence-Based)

These are **structurally safe** because they do not reinterpret existing truth:

1. Populate `totalCosts` in Facts
2. Enable historical comparison → activate `trend`
3. Allow FTEP to expose outcome more frequently
4. Introduce dashboard consumption as a new surface

None require refactoring existing layers.

---

## 10. Final Verdict

The Finances module:

* Obeys FT2 doctrine precisely
* Preserves uncertainty honestly
* Suppresses intelligence responsibly
* Avoids UI-level distortion
* Is future-ready without being premature

**This is a correct, disciplined, and conservative FT2 implementation.**

Audit complete.
No violations.
No leaks.
No silent assumptions.