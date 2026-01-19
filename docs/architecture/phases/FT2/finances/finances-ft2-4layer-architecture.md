# 🔐 Finances Module — Canonical 4-Layer Architecture Blueprint

> **Purpose:**
> To expose **financial observability** safely, honestly, and evolvably—without leaking intelligence, freezing assumptions, or misleading users.

FT2 is the **top tier**.
That does **not** mean “dump all intelligence.”
It means “expose only what is epistemically safe.”

---

## 0. First Principles (Non-Negotiable)

The Finances module exists to answer **one question only**:

> *“What do we know about the financial state of this business, and how confident are we in that knowledge?”*

It does **not** exist to:

* estimate profit without costs
* infer causality
* explain *why* something is happening
* expose model internals

Those belong **inside** the system, not in the contract.

---

## 1. High-Level Data Flow

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

Each arrow is **one-directional**.
Each layer has **exclusive authority**.

---

## 2. Layer 1 — FinancesFacts (Canonical Truth)

### 📍 Location

```
apps/backend/src/services/finances-facts/
```

### 🎯 Responsibility

Extract **raw, interpretation-free financial facts** from persistence.

This is the **only layer** allowed to touch the database.

---

### ✅ Allowed

* SQL / Knex
* Sums and counts
* Time windows
* Joins
* `null` for missing data
* Coverage metrics

### ❌ Forbidden

* Profitability conclusions
* Margins
* Percentages
* Thresholds
* “Good / bad”
* Trends
* Explanations
* Defaults

---

### Canonical Facts Shape (Today)

```ts
export interface FinancesFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  totalRevenue: number | null;      // may exist from orders
  totalCosts: number | null;        // null until cost ingestion exists
  netResult: number | null;         // null if costs are missing

  dataCoverage: {
    completenessPct: number | null;
  };

  extractedAt: string;
}
```

> **Invariant:**
> `null` means *unknown*, not zero.

If costs are missing, `netResult` **must be null**—even if revenue exists.

---

### What Facts Represent at Different Lifecycle Stages

| Stage         | Facts Look Like                 |
| ------------- | ------------------------------- |
| Post-Shopify  | revenue present, costs null     |
| Partial costs | some costs present, net null    |
| Full costs    | net populated                   |
| Degraded data | coverage < 100%, net maybe null |

Facts never lie.
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
* Directional reasoning
* Threshold checks
* Boolean reasoning
* Internal helper fields

### ❌ Forbidden

* DB access
* API exposure
* Copywriting
* UI semantics
* Serialization
* Trust claims

---

### Canonical Intelligence Shape

```ts
export interface FinancesIntelligence {
  netResult: {
    value: number | null;
    status: 'good' | 'bad' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoveragePct: number | null;

  // INTERNAL ONLY — NEVER EXPOSED
  marginPct?: number;
  lossReason?: string | null;
}
```

> Intelligence may be **wrong**.
> That’s why it’s never exposed directly.

---

## 4. Layer 3 — FTEP (Financial Truth Exposure Policy)

### 📍 Location

```
apps/backend/src/services/finances-ftep/
```

### 🎯 Responsibility

Downgrade intelligence into **FT2-safe observability**.

This is the **most critical layer**.

---

### Core Rule

> **FTEP may remove information, but may never add meaning.**

---

### Allowed

* Mapping intelligence → observability
* Dropping sensitive fields
* Returning `null`
* Coarsening signals

### Forbidden

* Re-interpretation
* Explanations
* Percentages
* Reasons
* Thresholds
* “Because…”

---

### Canonical FT2 Exposure

```ts
export interface FinancesFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    netObserved: number | null;
  };

  outcome:
    | { status: 'positive' | 'negative' | 'unknown' }
    | null;

  trend:
    | { direction: 'up' | 'down' | 'flat' | 'unknown' }
    | null;

  dataCoverage:
    | { completenessPct: number | null }
    | null;
}
```

---

### Mapping Rules (Locked)

| Internal Intelligence | FT2 Exposure          |
| --------------------- | --------------------- |
| `good / bad`          | `positive / negative` |
| margin %              | ❌ never               |
| loss reason           | ❌ never               |
| trend delta           | `direction only`      |
| unknown               | `null`                |

If something is not **safe**, it becomes **null**.

---

## 5. Layer 4 — FT2 Transport (HTTP)

### 📍 Location

```
apps/backend/src/api/finances/finances.ft2.controller.ts
```

### 🎯 Responsibility

Expose **FT2 snapshot only**, under lifecycle control.

---

### Responsibilities

1. Authenticate user
2. Resolve shopId
3. Validate period
4. Call:

   ```
   Facts → Intelligence → FTEP
   ```
5. Return JSON

### Forbidden

* Business logic
* Aggregation
* Intelligence
* Defaults
* Mutation

---

### Route

```
GET /api/v1/finances/ft2
```

If FT2 is not enabled → `403`.

---

## 6. Frontend FT2 Adapter (Dumb Pipe)

### 📍 Location

```
apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts
```

### 🎯 Responsibility

Normalize backend FT2 snapshot into **UI props**.

---

### Rules (Strict)

* `undefined → null`
* Preserve semantics
* No inference
* No defaults
* No logic

---

### Adapter Output = UI Contract

Matches **exactly**:

```ts
FinancesModuleFT2Props
```

No additional fields allowed.

---

## 7. FinancesModuleFT2 UI (Observability Only)

### 📍 Location

```
modules/finances/src/ui/pages/FinancesModuleFT2.tsx
```

### 🎯 Responsibility

Render **what is known**, and **explicitly show what is unknown**.

---

### UI Rules

* Show placeholders (`—`) for nulls
* Never hide uncertainty
* Never infer meaning
* Never explain causality
* Never compute values

If this UI ever feels “smart”, it is a bug.

---

## 8. What the User Sees at Each Stage

### Immediately After Shopify Connection

| Field         | Value   |
| ------------- | ------- |
| Period        | ✅       |
| Net observed  | `—`     |
| Outcome       | `—`     |
| Trend         | `—`     |
| Data coverage | partial |

This is **correct**.

---

### After Cost Ingestion Exists

| Field        | Value               |
| ------------ | ------------------- |
| Net observed | populated           |
| Outcome      | positive / negative |
| Trend        | directional         |
| Coverage     | higher              |

Same contract.
More truth flows in.

---

## 9. Why This Architecture Matters

This architecture ensures:

* You never lie when data is incomplete
* You never freeze intelligence prematurely
* You can evolve cost models freely
* UI stays stable
* Trust compounds instead of erodes

Most financial dashboards fake certainty.

This one **earns it**.

---

## 🔒 Final Status

* Finances FT2 is **canonical**
* Contract is **sealed**
* Tests enforce doctrine
* Backend and frontend are aligned
* Evolution is safe

This blueprint can now be **replicated verbatim** for:

* Products
* Customers
* Orders
* Any future financial surface