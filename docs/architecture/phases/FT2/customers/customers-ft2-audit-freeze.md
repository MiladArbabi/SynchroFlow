# 🔒 FT2 Customers / Specter Contract Audit

**Status:** Sealed · Evidence-Backed · As-Is
**Scope:** Facts → Intelligence → FTEP → FT2 Provider → Adapter → UI
**Guarantee:** Nothing here relies on intent, expectation, or future design.

---

## I. Canonical Scope Definition

### Audited Pipelines

* **Customers FT2 pipeline** — complete, end-to-end
* **Specter FT2 pipeline** — complete, end-to-end
* **Cross-module interaction** — explicitly verified absent

### Explicit Exclusions

* FT1 behavior (documented only to prove isolation)
* Any lifecycle, onboarding, or entitlement logic
* Any hypothetical or future fields

---

## II. Customers FT2 — Full Contract Ledger

### A. Layer 1 — Facts (Persistence → Extraction)

**Source**

```
apps/backend/src/services/customers-facts/customersFacts.service.ts
```

**Canonical Table**

* `customers`

**Extracted Fields**

| Field               | Type          | Null Rule             |
| ------------------- | ------------- | --------------------- |
| `shopId`            | number        | never null            |
| `period.from`       | string        | never null            |
| `period.to`         | string        | never null            |
| `customersObserved` | number | null | `null` if count === 0 |
| `extractedAt`       | ISO string    | never null            |

**Key Truths**

* Count is **downgraded to null**, not zero
* Absence of customers is treated as **absence of fact**
* No semantics, no thresholds, no trendability

---

### B. Layer 2 — Intelligence (Pure Classification)

**Source**

```
apps/backend/src/services/customers-intelligence/customersIntelligence.service.ts
```

**Input**

* `CustomersFacts.customersObserved`

**Derived Fields**

| Field             | Values                              | Rule      |
| ----------------- | ----------------------------------- | --------- |
| `outcome.status`  | `positive` | `negative` | `unknown` | see below |
| `trend.direction` | `unknown`                           | constant  |

**Classification Rules**

* `customersObserved === null` → `unknown`
* `customersObserved > 0` → `positive`
* `customersObserved === 0` → `negative` *(theoretical only; never produced by facts)*

**Key Truths**

* Intelligence is **binary + unknown**
* Trend exists **structurally**, not informationally
* No time comparison, no persistence, no confidence

---

### C. Layer 3 — FTEP (Truth Exposure Policy)

**Source**

```
apps/backend/src/services/customers-ftep/customersFtep.service.ts
```

**Exposure Rules**

| Field                       | Condition            | Exposure     |
| --------------------------- | -------------------- | ------------ |
| `context.period`            | always               | pass-through |
| `context.customersObserved` | always               | pass-through |
| `outcome`                   | `status === unknown` | `null`       |
| `trend`                     | `status === unknown` | `null`       |

**Resulting Exposure Shape**

```ts
{
  context: {
    period,
    customersObserved
  },
  outcome: { status } | null,
  trend: { direction } | null
}
```

**Key Truths**

* FTEP is **downgrade-only**
* Unknown intelligence is **fully suppressed**
* No partial leakage of intelligence

---

### D. Layer 4 — FT2 Provider (Backend API Contract)

**Source**

```
apps/backend/src/services/customers-ft2.provider.ts
```

**Behavior**

* Deterministic orchestration:

  ```
  Facts → Intelligence → FTEP
  ```

* No enrichment
* No reshaping
* No lifecycle logic

**Guaranteed Output**

* Exactly `CustomersFT2Exposure`
* No additional fields
* No omissions

---

### E. Frontend Adapter Contract

**Source**

```
apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts
```

**Expected Snapshot Shape**

| Field                      | Backend Source |
| -------------------------- | -------------- |
| `context.sessionsObserved` | ❌ none         |
| `systemState`              | ❌ none         |
| `timeSignal`               | ❌ none         |

**Adapter Rules**

* Pure
* `undefined → null`
* No computed fields
* No inference

**Critical Truth**

* Adapter **does not consume**:

  * `customersObserved`
  * `outcome`
  * `trend`

This is not a bug claim — this is **contractual silence**.

---

### F. FT2 UI (CustomersModuleFT2)

**Source**

```
modules/customers/src/ui/pages/CustomersModuleFT2.tsx
```

**Rendered Fields**

| UI Surface | Field             | Value |
| ---------- | ----------------- | ----- |
| KPI        | Period            | shown |
| KPI        | Sessions observed | `—`   |
| KPI        | System status     | `—`   |
| KPI        | Confidence        | `—`   |
| KPI        | Trend             | `—`   |
| Support    | Reason            | `—`   |

**UI Rules (Observed)**

* `null → '—'`
* No fallback logic
* No inference
* No cross-field synthesis

---

## III. Specter FT2 — Full Contract Ledger

### A. Facts

**Fields**

| Field                | Type           | Null Rule      |
| -------------------- | -------------- | -------------- |
| `sessionsObserved`   | number | null  | null if none   |
| `exitIntentSessions` | number | null  | null if absent |
| `funnelsDetected`    | boolean | null | null if absent |

---

### B. Intelligence

**Derived**

| Field               | Values                        |
| ------------------- | ----------------------------- |
| `engagement.status` | positive | negative | unknown |
| `behavior.trend`    | stable | volatile | unknown   |

**Unknown Rule**

* Any required fact null → full unknown

---

### C. FTEP

**Exposure**

| Field                          | Rule                       |
| ------------------------------ | -------------------------- |
| `outcome`                      | null if engagement unknown |
| `signals.funnelsDetected`      | pass-through               |
| `dataCoverage.sessionsPresent` | derived boolean            |

---

### D. FT2 Provider

* Emits full SpecterFT2Exposure
* Deterministic
* Complete

---

### E. Consumption by Customers

| Stage     | Status         |
| --------- | -------------- |
| Adapter   | ❌ not consumed |
| UI        | ❌ not rendered |
| Inference | ❌ none         |

---

## IV. Global FT2 Integrity Assertions (Provable)

These statements are **true and defensible**:

1. No FT2 surface invents data
2. No intelligence leaks without FTEP approval
3. All `—` values correspond to actual `null`
4. Customers FT2 currently exposes **facts only**
5. Specter FT2 is fully isolated
6. All mismatches are **silent, not compensatory**

---

## V. Final Sealed Contract Summary

### Customers FT2 exposes

* **Context only**
* **No outcomes**
* **No trends**
* **No health**
* **No signals**

### Specter FT2 exposes

* Outcomes, signals, coverage
* **But not consumed by Customers**

---

## 🔐 Seal Statement

This audit represents the **complete and immutable FT2 truth contract** for Customers and Specter **as of this scan**.

Nothing is missing *unless proven absent by code*.
Nothing exists *unless observed*.
