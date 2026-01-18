# 🔒 FT2 Customers / Specter Contract Audit

**Status:** Sealed · Evidence-Backed · As-Is
**Scope:** Facts → Intelligence → FTEP → FT2 Provider → Adapter → UI
**Guarantee:** Nothing here relies on intent, expectation, or future design.

---

## I. Canonical Scope Definition

### Audited Pipelines

* **Customers FT2 pipeline** — complete, end-to-end
* **Specter FT2 pipeline** — complete, end-to-end
* **Cross-module interaction** — explicitly verified and bounded

### Explicit Exclusions

* FT1 behavior (documented only to prove isolation)
* Any lifecycle, onboarding, or activation logic
* Any hypothetical, planned, or future fields
* OpsConsole (explicitly non-existent at contract level; see Section VII)

---

## II. Customers FT2 — Full Contract Ledger

> **Important:** Customers FT2 is structurally capable but currently **truth-minimal by design**.

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

* Counts are **downgraded to null**, never zero
* Absence of customers = **absence of fact**
* No aggregation semantics, no thresholds, no trendability

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
* `customersObserved === 0` → `negative` *(theoretical only; never produced by Facts)*

**Key Truths**

* Intelligence is **binary + unknown**
* Trend exists **structurally**, not informationally
* No temporal comparison, no persistence, no confidence scoring

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

* FTEP is **strictly downgrade-only**
* Unknown intelligence is **fully suppressed**
* No partial leakage or shadow exposure

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

* No lifecycle or entitlement logic

**Guaranteed Output**

* Exactly `CustomersFT2Exposure`
* No additional fields
* No inferred defaults

---

### E. Frontend Adapter Contract

**Source**

```
apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts
```

**Observed Behavior**

* Adapter receives FT2 snapshot
* Adapter **does not consume** intelligence-derived fields

**Explicit Non-Consumption**

| Field               | Status    |
| ------------------- | --------- |
| `customersObserved` | ❌ ignored |
| `outcome`           | ❌ ignored |
| `trend`             | ❌ ignored |

This is **contractual silence**, not a defect.

**Adapter Rules**

* Pure
* `undefined → null`
* No computed fields
* No inference
* No cross-field synthesis

---

### F. FT2 UI (CustomersModuleFT2)

**Source**

```
modules/customers/src/ui/pages/CustomersModuleFT2.tsx
```

**Rendered Reality**

| Surface | Field      | Behavior |
| ------- | ---------- | -------- |
| Context | Period     | rendered |
| Metrics | Any truth  | ❌ none   |
| Signals | Any signal | ❌ none   |

**UI Rules (Observed)**

* `null → '—'`
* No fallback logic
* No inference
* No cross-field synthesis

**Key Truth**

> Customers FT2 currently exposes **context only**, despite upstream capability.

---

## III. Specter FT2 — Full Contract Ledger

### A. Layer 1 — Facts (Observed & Extended)

**Source**

```
apps/backend/src/services/specter-facts/specterFacts.service.ts
```

**Extracted Fields**

| Field                           | Type           | Null Rule            |
| ------------------------------- | -------------- | -------------------- |
| `sessionsObserved`              | number | null  | null if none         |
| `exitIntentSessions`            | number | null  | null if absent       |
| `funnelsDetected`               | boolean | null | null if absent       |
| `multiStepSessionsPresent`      | boolean | null | null if undetermined |
| `surfaceBreadthPresent`         | boolean | null | null if undetermined |
| `returningSessionsPresent`      | boolean | null | null if undetermined |
| `exitWithoutInteractionPresent` | boolean | null | null if undetermined |
| `averageSessionDepthPresent`    | boolean | null | null if undetermined |

**Key Truths**

* All behavioral signals are **existence-only**
* No ratios, no averages, no thresholds exposed
* All signals degrade cleanly to `null`

---

### B. Layer 2 — Intelligence

**Derived**

| Field                | Values                              |
| -------------------- | ----------------------------------- |
| `engagement.status`  | `positive` | `negative` | `unknown` |
| `behavior.direction` | `up` | `down` | `flat` | `unknown`  |
| `behavior.trend`     | `stable` | `volatile` | `unknown`   |

**Unknown Rule**

* Any required fact null → **full unknown**

**Important Constraint**

* Intelligence does **not** consume:

  * `averageSessionDepthPresent`
  * `exitWithoutInteractionPresent`
* These remain **Facts-only signals**

---

### C. Layer 3 — FTEP (Specter)

**Exposure Rules**

| Field               | Rule                          |
| ------------------- | ----------------------------- |
| `activityDirection` | CTR ≥ 1                       |
| `signals.*`         | CTR ≥ 1                       |
| `dataCoverage`      | derived from session presence |

**Signals Exposed**

* `exitIntentDetected`
* `funnelsDetected`
* `multiStepSessionsPresent`
* `surfaceBreadthPresent`
* `returningSessionsPresent`
* `exitWithoutInteractionPresent`
* `averageSessionDepthPresent`

All are:

* Boolean
* Existence-only
* No magnitude
* No inference

---

### D. Layer 4 — FT2 Provider

**Source**

```
apps/backend/src/services/specter-ft2.provider.ts
```

**Behavior**

* Deterministic
* Complete
* No filtering
* No interpretation

---

### E. Customers Consumption of Specter FT2

| Stage     | Status     |
| --------- | ---------- |
| Adapter   | ✅ consumes |
| UI        | ✅ renders  |
| Inference | ❌ none     |

**Rendered Surfaces (9 Total)**

1. Activity Direction
2. Multi-step Sessions
3. Surface Breadth
4. Returning Sessions
5. Exit Without Interaction
6. Average Session Depth
7. Exit Intent
8. Funnels / Structured Journeys
9. Data Coverage

---

## IV. Global FT2 Integrity Assertions (Provable)

The following statements are **true and defensible**:

1. No FT2 surface invents data
2. No intelligence leaks without FTEP approval
3. All rendered values correspond to factual or downgraded truth
4. All `null` values originate upstream (not UI-generated)
5. Specter and Customers are **strictly isolated**
6. FT2 contains **no escalation path**

---

## V. OpsConsole — Explicit Non-Existence (Important)

* OpsConsole is **not part of FT2**
* OpsConsole has:

  * ❌ no Facts
  * ❌ no Intelligence
  * ❌ no FTEP rules
  * ❌ no Provider contract
* Any OpsConsole surface would constitute a **new contract**

Until introduced formally, OpsConsole is **out of scope by definition**.

---

## 🔐 Final Seal Statement

This audit represents the **complete and immutable FT2 truth contract** for Customers and Specter **as implemented**.

Nothing exists unless observed.
Nothing is implied.
Nothing is promised.
Nothing escalates beyond FT2.

**This contract is sealed.**

---