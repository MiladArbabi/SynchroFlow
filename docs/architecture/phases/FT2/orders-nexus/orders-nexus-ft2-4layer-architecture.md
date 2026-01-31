# 🔒 Order-Nexus FT2 — Layered Architecture Blueprint

**CURRENT · ACTIVE · SEALED (v2)**

**Status:** ✅ Canonical · Enforced · Leak-Safe
**Applies To:** Orders-Nexus FT2 (Orders · Fulfillment · Revenue · Returns)
**Reference Implementation:** Order-Nexus
**Apex Rule:** **FT2 is terminal. There is no FT3.**

---

## 0. Why This Architecture Exists (Re-stated)

Order-Nexus handles the **highest-risk economic truth** in LaSyncro:

* order presence
* revenue presence
* fulfillment execution reality
* return & reversal presence
* epistemic usability of data
* system grounding (is data even flowing?)

A single semantic leak here:

* corrupts Trust FT2,
* contaminates Analytics,
* poisons Echo Hub reasoning,
* breaks cross-module coherence.

Therefore, Order-Nexus is implemented using **strict, one-way epistemic layers**.

> **FT2 is the maximum resolution of truth allowed to leave the backend.**
> Orientation without advice. Reality without interpretation.

---

## 1. Architectural Overview (LOCKED · UPDATED)

```
Canonical Persistence
        ↓
Layer 1   — Canonical Facts              (What exists)
Layer 1½  — Temporal Facts               (How presence behaves over time)
        ↓
Layer 2   — Intelligence (INTERNAL)      (What it means, silently)
        ↓
Layer 3   — FTEP (Truth Exposure Policy) (What may be shown)
        ↓
Layer 4   — FT2 UI                       (What the user can observe)
```

### Inviolable Rules

* Data flows **downward only**
* Each layer **destroys information**
* No layer compensates for missing truth
* No layer upgrades epistemic certainty
* UI must render correctly with **`null` everywhere**

Violation = **architecture breach**.

---

## 2. Layer 1 — Canonical Facts (L1)

**Truth Without Interpretation**

---

### Purpose

Extract **raw, presence-only facts** directly from canonical persistence.

This is the **only layer allowed to read the database**.

---

### What This Layer Is

* Deterministic
* Auditable
* Recomputable
* Stateless (except DB reads)

---

### What This Layer Is NOT

* ❌ Intelligent
* ❌ Explanatory
* ❌ User-facing
* ❌ Opinionated

---

### 2.1 Location (UPDATED)

```
apps/backend/src/services/order-facts/
├── orderFacts.service.ts
├── orderTrendFacts.service.ts
├── orderFulfillmentFacts.service.ts
├── orderShippingFacts.service.ts
├── orderCustomerPromiseFacts.service.ts
└── *.types.ts
```

---

### 2.2 Canonical Fact Types (CURRENT)

```ts
export interface OrderFacts {
  shopId: number;

  ordersObserved: number | null;

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;     // always null (non-existent fact)
  };

  dataCoverage: {
    completenessPct: number | null;
  };

  ingestion: {
    status: 'present' | 'absent';
  } | null;

  freshness: {
    status: 'recent' | 'stale' | 'unknown';
  } | null;

  extractedAt: string;
}
```

---

### 2.3 Temporal Facts (L1½)

```ts
export interface OrderTrendFacts {
  previousWindowOrders: number | null;
  currentWindowOrders: number | null;

  revenueContinuity:
    | 'isolated'
    | 'continuous'
    | null;
}
```

**Key correction:**
Revenue continuity is **L1½**, not L2 intelligence.

---

### 2.4 Hard Constraints (LOCKED)

* ❌ No percentages
* ❌ No statuses like “healthy”
* ❌ No booleans
* ❌ No thresholds
* ❌ No defaults except `null`
* ✅ Absence must remain explicit

`null` = **epistemic absence**, not failure.

---

## 3. Layer 2 — Intelligence (L2 · INTERNAL ONLY)

**Meaning Without Voice**

---

### Purpose

Convert **facts → classified orientation signals** for internal use only.

This layer may **think**.
It must **never speak directly**.

Important distinction (LOCKED):

* **Evaluation** = determining whether a fact can be assessed
* **Attribution** = determining which cause applies

Layer 2 may evaluate without attributing.
Coverage may be complete while classification remains unknown.

---

### 3.1 Location

```
apps/backend/src/services/order-intelligence/
├── orderIntelligence.service.ts
├── orderFulfillmentIntelligence.service.ts
├── orderVelocityIntelligence.service.ts
```

---

### 3.2 Intelligence Outputs (Internal Only)

```ts
export interface OrderNexusIntelligence {
  margin: {
    status: 'healthy' | 'loss' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  visibility: {
    status: 'sufficient' | 'insufficient' | 'unknown';
  };

  coverage: {
    evaluatedPct: number | null;     // epistemic coverage
    classifiedPct: number | null;    // attribution completeness
  };
}
```

**Important correction:**
Revenue continuity is **not** intelligence.
It is downgraded from L1½ facts.

---

### 3.3 Intelligence Gates (NON-NEGOTIABLE)

| Condition       | Result   |
| --------------- | -------- |
| Coverage `null` | unusable |
| Coverage < 80%  | unusable |
| Coverage ≥ 80%  | usable   |

Unusable → `unknown`.

No bypass allowed.

---

### 3.4 Forbidden Operations

* ❌ Explanations
* ❌ Causes
* ❌ Recommendations
* ❌ Forecasting
* ❌ UI shaping
* ❌ Cross-module enrichment

If intelligence becomes narrative, **the layer is broken**.

---

## 4. Layer 3 — FTEP (Truth Exposure Policy)

**Epistemic Security Boundary**

---

This is the **hardest and most critical layer**.

FTEP defines **what truth is allowed to leave the backend**.

---

### 4.1 Location

```
apps/backend/src/services/order-ftep/
├── orderFtep.service.ts
├── orderFtep.types.ts
```

---

### 4.2 Core Principle (LOCKED)

> **All intelligence must be downgraded.**

No raw intelligence may cross this boundary.

---

### 4.3 Input Contract

```ts
export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}
```

---

### 4.4 FT2 Snapshot Exposure (CURRENT)

```ts
export interface OrderNexusFT2Exposure {
  context: {
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
  };

  outcome: { status: 'positive' | 'negative' } | null;

  trend: { direction: 'up' | 'down' | 'flat' } | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;
}
```

---

### 4.5 Downgrade Rules (SEALED)

| Internal    | FT2         |
| ----------- | ----------- |
| `unknown`   | `null`      |
| Percentages | ❌ stripped  |
| Thresholds  | ❌ stripped  |
| Causes      | ❌ forbidden |
| Advice      | ❌ forbidden |

**Invariant:**
`unknown` is never emitted.
Unknown → **absence (`null`)**.

**Coverage semantics:**

* Evaluation coverage → ❌ stripped
* Classification coverage → ❌ stripped

FT2 may reflect *effects* of coverage,
but never exposes coverage metrics directly.

---

## 5. Layer 4 — FT2 UI (APEX)

**Read-Only Observability Layer**

---

### Purpose

Render **only what FTEP allows**, through **InfoBlocks**.

The UI **reveals truth**.
It does **not guide behavior**.

---

### 5.1 Locations

```
modules/order-nexus/src/ui/
apps/frontend/src/pages/orders/
```

---

### 5.2 Narrative Primitive (LOCKED)

> **InfoBlock is the only FT2 narrative unit.**

* Groups related domains
* Preserves downgraded truth
* Enforces scan order
* Reduces cognitive load **without adding meaning**

`FT2Surface` is **structural only**.

Blocked Revenue rendering rule:

* FT2 may show blocked totals
* FT2 must not imply cause visibility
* Absence of attribution must remain visually neutral

---

### 5.3 Adapter Contract (CRITICAL)

Adapters must:

* Normalize `undefined → null`
* Preserve backend semantics
* Perform **zero computation**
* Never infer or enrich

Adapters are **pipes, not brains**.

---

### 5.4 FT2-Adjacent Context (NEW · FORMALIZED)

Comparative values (percent deltas):

* are computed **backend-side**
* are **FT2-adjacent**, not intelligence
* default to `null` aggressively
* **do not align to presets yet** (by design)

They **never affect outcome, trend, or visibility**.

---

### 5.5 Trust FT2 (META)

* Not a domain
* Not intelligence
* Not persisted
* Not interpreted server-side

Used **only** as a UI boundary signal.

---

## 6. Time Ownership (LOCKED)

* Time is resolved **outside FT2**
* FT2 receives a range, never authority
* Intelligence never owns time

This prevents retroactive truth mutation.

---

## 7. Replication Rules (ALL FT2 MODULES)

To be FT2-compliant, a module must:

1. Implement L1 facts
2. Implement L1½ temporal facts (if applicable)
3. Implement L2 intelligence
4. Enforce L3 FTEP
5. Render read-only FT2 UI
6. Integrate Trust FT2 as META

If **Layer 3 is missing → module is rejected**.

---

## 8. Why This Is Non-Negotiable

Because:

* Trust is the product
* Analytics depends on clean truth
* Echo Hub depends on clean truth
* Cross-module reasoning collapses without discipline

Order-Nexus is the **keystone**.

If it leaks, everything lies.

---

## 🔐 Final Seal (v2)

* Layering corrected and clarified
* Revenue continuity placed correctly at L1½
* FT2-adjacent comparisons formalized
* InfoBlock elevated as narrative primitive
* Fulfillment / Revenue / Returns accommodated
* FT2 confirmed as terminal layer

🔒 **Order-Nexus FT2 Architecture v2 is current, enforced, and sealed.**

---