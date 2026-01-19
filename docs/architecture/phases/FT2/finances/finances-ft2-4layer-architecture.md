# 🔐 Finances Module — Canonical 4-Layer Architecture Blueprint (FT2)

> **Purpose**
> To expose **financial observability** safely, honestly, and evolvably—
> without leaking intelligence, freezing assumptions, or manufacturing certainty.

FT2 is the **highest exposure tier**.
That does **not** mean “maximum information.”
It means **maximum epistemic safety**.

---

## 0. First Principles (Non-Negotiable)

The Finances module exists to answer **exactly one meta-question**:

> **“What do we know about the financial state of this business, and what are the limits of that knowledge?”**

It does **not** exist to:

* estimate profit without prerequisites
* infer causality
* explain *why* outcomes occur
* guide decisions
* expose internal reasoning

Those belong **inside the system**, not in the FT2 contract.

---

## 1. High-Level Data Flow (One-Way, Sealed)

```
Shopify / Integrations
        ↓
Canonical Ingestion Pipeline
        ↓
DATABASE
        ↓
[Layer 1] FinancesFacts
        ↓
[Layer 2] FinancesIntelligence
        ↓
[Layer 3] FinancesFTEP
        ↓
[Layer 4] FT2 HTTP Transport
        ↓
Frontend FT2 Adapter (dumb pipe)
        ↓
FinancesModuleFT2 UI (observability only)
```

**Invariants**

* Flow is strictly one-directional
* No layer may reach backward
* Each layer has **exclusive authority**

---

## 2. Layer 1 — FinancesFacts (Canonical Truth)

### 📍 Location

```
apps/backend/src/services/finances-facts/
```

### 🎯 Responsibility

Extract **raw, interpretation-free financial facts** from persistence.

This is the **only layer** allowed to access the database.

---

### ✅ Allowed

* SQL / Knex
* Sums and counts
* Time bucketing
* Date windows
* Deterministic grouping
* Explicit `null` for missing data
* Coverage signals

### ❌ Forbidden

* Profitability conclusions
* Margins or ratios
* Thresholds
* “Good / bad”
* Trends
* Confidence
* Defaults
* Explanations

---

### Canonical Facts Shape (Current)

```ts
export interface FinancesFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  totalRevenue: number | null;
  totalCosts: number | null;
  netResult: number | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  timeSeries: {
    bucket: 'day';
    points: Array<{
      from: string;
      to: string;
      revenueObserved: number | null;
      ordersCount: number | null;
      coveragePct: number | null;
    }>;
  };

  extractedAt: string;
}
```

### Core Invariant

> **`null` means “unknown”, never zero.**

If costs are missing, `netResult` **must be null**, even if revenue exists.

---

### Lifecycle Truthfulness

| Business State  | What Facts Look Like        |
| --------------- | --------------------------- |
| Shopify only    | revenue present, costs null |
| Partial history | timeSeries sparse           |
| Full ingestion  | netResult populated         |
| Data gaps       | coveragePct null or partial |

Facts **never lie**.
They only say **what exists**.

---

## 3. Layer 2 — FinancesIntelligence (Internal Reasoning)

### 📍 Location

```
apps/backend/src/services/finances-intelligence/
```

### 🎯 Responsibility

Convert **facts → internal classifications**.

This layer **decides**, but **never speaks**.

---

### ✅ Allowed

* Status classification
* Temporal sufficiency checks
* Boolean gating
* Risk classification
* Preconditions logic
* Internal confidence logic

### ❌ Forbidden

* DB access
* API exposure
* Serialization
* Copywriting
* UI semantics
* Trust guarantees

---

### Canonical Intelligence Shape (Internal)

```ts
export interface FinancesIntelligence {
  netResult: {
    value: number | null;
    status: 'good' | 'bad' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  dataCoveragePct: number | null;

  temporal: {
    bucketsObserved: number;
    continuity: 'complete' | 'partial' | 'sparse';
    sufficientForTrend: boolean;
  };

  confidence: {
    level: 'high' | 'medium' | 'low' | 'unknown';
  };

  blindSpots: {
    costsMissing: boolean;
    refundsMissing: boolean;
    historyInsufficient: boolean;
  };

  decisionSafety: {
    status: 'safe' | 'unsafe' | 'unknown';
  };

  profitPreconditions: {
    costsReady: boolean;
    refundsReady: boolean;
    historyReady: boolean;
    decisionSafe: boolean;
  };

  refundReality: {
    status: 'known' | 'unknown';
  };

  // INTERNAL ONLY — NEVER EXPOSED
  marginPct: number | null;
  lossReason: string | null;
}
```

> Intelligence may be **wrong**.
> That is why it is **never exposed directly**.

---

## 4. Layer 3 — FinancesFTEP (Truth Exposure Policy)

### 📍 Location

```
apps/backend/src/services/finances-ftep/
```

### 🎯 Responsibility

Downgrade intelligence into **FT2-safe observability**.

This is the **critical trust boundary**.

---

### Core Rule

> **FTEP may remove information, but may never add meaning.**

---

### ✅ Allowed

* Mapping intelligence → coarse signals
* Dropping sensitive fields
* Returning `null`
* Binary or categorical exposure
* Structural silence

### ❌ Forbidden

* Re-interpretation
* Explanations
* Percentages
* Reasons
* Threshold disclosure
* Advice

---

### Canonical FT2 Exposure (Current, Locked)

```ts
export interface FinancesFT2Exposure {
  context: {
    revenueObserved: number | null;
    netObserved: number | null;
  };

  timeAwareness:
    | { history: 'sufficient' | 'insufficient' }
    | null;

  timeline:
    | {
        bucket: 'day';
        points: {
          from: string;
          to: string;
          revenueObserved: number | null;
        }[];
      }
    | null;

  blindSpots:
    | {
        costs: 'unknown' | 'known';
        refunds: 'unknown' | 'known';
        history: 'insufficient' | 'sufficient';
      }
    | null;

  decisionSafety:
    | { status: 'safe' | 'unsafe' | 'unknown' }
    | null;

  profitPreconditions:
    | { status: 'ready' | 'not_ready' }
    | null;

  refundReality:
    | { status: 'known' | 'unknown' }
    | null;
}
```

---

### Mapping Doctrine (Sealed)

| Internal Intelligence | FT2 Exposure      |
| --------------------- | ----------------- |
| marginPct             | ❌ never           |
| lossReason            | ❌ never           |
| bucket counts         | ❌ never           |
| confidence math       | ❌ never           |
| sufficientForTrend    | history only      |
| decision safety       | coarse status     |
| profit validity       | ready / not_ready |

If a signal is **not epistemically safe**, it becomes **null**.

---

## 5. Layer 4 — FT2 Transport (HTTP)

### 📍 Location

```
apps/backend/src/api/finances/finances.ft2.controller.ts
```

### 🎯 Responsibility

Expose **FT2 snapshot only**, under lifecycle and permission control.

---

### Responsibilities

1. Authenticate user
2. Resolve shopId
3. Validate period
4. Execute:

```
Facts → Intelligence → FTEP
```

5. Return JSON

### ❌ Forbidden

* Business logic
* Aggregation
* Defaults
* Intelligence exposure
* Mutation

---

## 6. Frontend FT2 Adapter (Dumb Pipe)

### 📍 Location

```
apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts
```

### 🎯 Responsibility

Normalize backend FT2 snapshot into **UI props only**.

---

### Rules (Strict)

* `undefined → null`
* Preserve semantics
* No inference
* No defaults
* No transformation

Adapter output **must exactly match** `FinancesModuleFT2Props`.

---

## 7. FinancesModuleFT2 UI (Observability Only)

### 📍 Location

```
modules/finances/src/ui/pages/FinancesModuleFT2.tsx
```

### 🎯 Responsibility

Render **what is known** and **explicitly show what is unknown**.

---

### UI Rules

* Render `null` as `—`
* Never hide uncertainty
* Never compute values
* Never infer meaning
* Never explain causality

If this UI ever feels “smart”, it is **a defect**.

---

## 8. Why This Architecture Matters

This architecture guarantees:

* No fake certainty
* No premature profit claims
* No frozen assumptions
* Safe evolution of cost and refund models
* Stable UI contracts
* Compounding trust instead of erosion

Most financial dashboards **pretend** to know.

This one **knows when it doesn’t**.

---

## 🔒 Final Status

* Finances FT2 is **canonical**
* Contract is **sealed**
* Exposure is **epistemically safe**
* Backend and frontend are aligned
* Architecture is **replicable across domains**

This blueprint is now the **reference pattern** for all future FT2 surfaces.

**End of Canonical Finances FT2 Architecture Blueprint.**