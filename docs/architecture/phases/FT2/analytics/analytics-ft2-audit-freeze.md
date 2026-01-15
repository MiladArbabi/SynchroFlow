# 📊 FT2 AUDIT REPORT — ANALYTICS MODULE (insightCore)

**Audit Type:** Truth Audit (Read-Only)
**Scope:** Analytics module across backend + frontend FT2 surface
**Method:** Scan-driven, zero assumptions, zero code changes
**Status:** **COMPLETE & CLOSED**

---

## 1. Audit Scope & Coverage

### In-Scope

* Analytics Facts (Layer 1)
* Analytics Intelligence (Layer 2)
* Analytics FTEP (Layer 3)
* Analytics FT2 Provider (backend boundary)
* Analytics FT2 Snapshot (frontend)
* Analytics FT2 Adapter
* Analytics FT2 UI Module & Page

### Out-of-Scope (by design)

* FT1 Analytics
* Other modules’ FT2 logic
* Any refactor, fix, or enhancement proposal

---

## 2. Reference Architecture — VERIFIED

The Analytics module **fully conforms** to the mandated 4-layer FT2 architecture:

```
Canonical DB
   ↓
Layer 1 — Facts (analytics-facts)
   ↓
Layer 2 — Intelligence (analytics-intelligence)
   ↓
Layer 3 — FTEP (analytics-ftep)
   ↓
Layer 4 — FT2 UI (AnalyticsModuleFT2)
```

No layer collapse. No leakage. No shortcuts.

---

## 3. Layer 1 — Facts (Ground Truth)

### Location

```
apps/backend/src/services/analytics-facts/
```

### Entry Point

```ts
getAnalyticsFacts(input)
```

### Canonical DB Access

* **Table:** `order_fulfillment_status`
* **Filter:** `shop_id`
* **Aggregation:** `COUNT(*)`
* **Grouping:** `status`

### Facts Extracted

| Fact                      | Type          | Source                          |
| ------------------------- | ------------- | ------------------------------- |
| ordersObserved.processing | number | null | count where status = processing |
| ordersObserved.delivered  | number | null | count where status = delivered  |
| ordersObserved.in_transit | number | null | count where status = in_transit |

### Null Semantics (Explicit)

* If **no rows returned** → all values `null`
* If **status missing** → corresponding value remains `null`
* `null ≠ 0` strictly preserved

### Guarantees (Code-Proven)

* No joins
* No derived metrics
* No money
* No intelligence
* No defaults
* No coercion

✅ **Layer 1 Verdict:**
Facts are **minimal, raw, canonical, and null-honest**.

---

## 4. Layer 2 — Intelligence (Classification Only)

### Location

```
apps/backend/src/services/analytics-intelligence/
```

### Entry Point

```ts
buildAnalyticsIntelligence(facts)
```

### Inputs Used

* `ordersObserved.processing`
* `ordersObserved.delivered`
* `ordersObserved.in_transit`

### Intelligence Outputs

```ts
outcome.status: 'positive' | 'negative' | 'unknown'
trend.direction: 'unknown'
```

### Classification Rules (Locked)

| Condition         | Outcome    |
| ----------------- | ---------- |
| All values `null` | `unknown`  |
| All values `0`    | `negative` |
| Any value > 0     | `positive` |

### Inert Intelligence

* `trend.direction` is **always `'unknown'`**
* No code path mutates it

### Constraints (Proven)

* No DB access
* No ratios
* No time comparison
* No memory
* No cross-module reads

⚠️ **Observed Inconsistency (Factual, Non-Speculative):**

* Comment references `revenueObserved`, which **does not exist** in Analytics facts

✅ **Layer 2 Verdict:**
Intelligence is **conservative, deterministic, and partially inert**.

---

## 5. Layer 3 — FTEP (Truth Exposure Policy)

### Location

```
apps/backend/src/services/analytics-ftep/
```

### Entry Point

```ts
buildAnalyticsFtep({ facts, intelligence })
```

### Exposed Fields

| Field           | Exposure Rule                 |
| --------------- | ----------------------------- |
| context.period  | Always exposed                |
| outcome.status  | Exposed only if not `unknown` |
| trend.direction | Exposed only if not `unknown` |

### Suppression Rules

* If `intelligence.outcome.status === 'unknown'`:

  * `outcome = null`
  * `trend = null`

### Suppressed by Design

* Raw facts
* Counts
* Money
* Percentages
* Reasons
* Explanations

### Exposure Characteristics

* **Binary exposure** (present or fully nulled)
* No partial leakage
* No degradation

✅ **Layer 3 Verdict:**
FTEP is **strict, binary, and null-faithful**.

---

## 6. FT2 Provider — Backend Boundary (Authoritative)

### Location

```
apps/backend/src/services/analytics-ft2.provider.ts
```

### Pipeline (Exact)

```
getAnalyticsFacts
 → buildAnalyticsIntelligence
   → buildAnalyticsFtep
```

### Properties

* Deterministic
* No enrichment
* No persistence
* No lifecycle logic
* No cross-module data

✅ **Provider Verdict:**
This is the **single authoritative FT2 exposure boundary**.

---

## 7. FT2 Snapshot — Frontend Consumption

### Location

```
apps/frontend/src/pages/analytics/useAnalyticsFt2Snapshot.ts
```

### Endpoint

```
GET /api/v1/modules/analytics/ft2
```

### Behavior

* No params
* No transformation
* No defaults
* Returns exposure verbatim

### Observed Inert Field

* `context.revenueObserved` exists in type but is:

  * Not exposed by backend
  * Not consumed by adapter or UI

✅ **Snapshot Verdict:**
Snapshot hook is **pure, passive, and read-only**.

---

## 8. FT2 Adapter — Normalization Only

### Location

```
apps/frontend/src/pages/analytics/useAnalyticsFt2Adapter.ts
```

### Behavior

* Undefined → null normalization
* Shape-stable output
* No inference
* No computation

### Notable Exception (Explicit)

* `context.period` defaults to `{ from: '', to: '' }`

  * Presentation fallback only
  * No semantic impact on outcome/trend

✅ **Adapter Verdict:**
Adapter is **doctrine-compliant and non-semantic**.

---

## 9. FT2 UI — Observational Surface

### Locations

* `AnalyticsFT2Page.tsx`
* `AnalyticsModuleFT2.tsx`

### Rendering Semantics

* Optional chaining only
* `'—'` used as **explicit null marker**
* No inference
* No compensation
* No hidden defaults

### Proven Absences

* No intelligence reconstruction
* No UI-side computation
* No fallback truth

✅ **UI Verdict:**
UI is **observational, null-honest, and exposure-faithful**.

---

## 10. Cross-Surface Alignment Matrix (Filled)

| Module    | Fact Exists | Intelligence Active | FTEP Exposes          | Dashboard Consumes | UI Shows     |
| --------- | ----------- | ------------------- | --------------------- | ------------------ | ------------ |
| Analytics | Yes         | Conditional         | outcome/trend or null | Yes                | value or `—` |

---

## 11. Intentional vs Accidental Gaps

### Intentional (Proven by Code)

* No money metrics
* No trends
* No percentages
* No explanations
* Suppression on `unknown`

### Accidental / Inert (Observed)

* `trend.direction` never mutates
* `revenueObserved` referenced in comments/types but unused

(No fixes proposed.)

---

## 12. Final Audit Verdict

* ✅ All FT2 Analytics surfaces scanned
* ✅ Architecture respected end-to-end
* ✅ No intelligence leakage
* ✅ No UI compensation
* ✅ Null semantics preserved
* ❌ No speculative conclusions made

---

## 🧾 FINAL STATEMENT

> **The Analytics FT2 module is architecturally correct, truth-faithful, and evidence-locked.**
> All observed gaps are either intentional or inert.
> No contradictions exist between layers.
> This audit is **complete and closed**.
