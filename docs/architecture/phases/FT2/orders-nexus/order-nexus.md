# Order-Nexus — FT2 Architecture & Implementation

**Status:** Active / Canonical  
**Phase:** FT2 (Truth-Limited Observability)  
**Module:** Order-Nexus  
**First module to implement full 4-layer FT2 architecture**

---

## 1. Purpose

Order-Nexus is the **reference implementation** of the FT2 4-layer architecture.

Its purpose is to:

- Establish a **strict separation** between raw truth, intelligence, and UI exposure
- Prevent intelligence leakage into the frontend
- Enable FT2 observability without explanations, causation, or recommendations
- Serve as the **canonical blueprint** for all future FT2 modules

This implementation is intentionally conservative and restrictive.

---

## 2. Architectural Overview

Order-Nexus FT2 follows the **mandatory 4-layer pipeline**:

Database
↓
Layer 1 — Order Facts
↓
Layer 2 — Order Intelligence
↓
Layer 3 — FTEP (Truth Exposure Policy)
↓
Layer 4 — Transport (HTTP)
↓
Frontend FT2 Adapter (Pure Pipe)

Each layer has **exclusive responsibilities** and **hard prohibitions**.

---

## 3. Layer 1 — Order Facts (Canonical Truth)

### Location

apps/backend/src/services/order-facts/

`

### Files

- `orderFacts.service.ts`
- `orderFacts.types.ts`
- `index.ts`

### Purpose
Extract **raw, interpretation-free order truth** from persistence.

This is the **only layer allowed to touch the database**.

### Characteristics

- Uses canonical tables (`canonical_orders`, `canonical_order_line_items`)
- Performs aggregation only (COUNT, SUM)
- Preserves nulls exactly
- Applies time windows
- Emits no intelligence

### Canonical Type

export interface OrderFacts {
  shopId: number;
  period: { from: string; to: string };

  ordersObserved: number | null;

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  dataCoverage: {
    completenessPct: number | null;
  };

  extractedAt: string;
}
`

### Invariants

- `null` ≠ `0`
- No percentages beyond raw aggregates
- No statuses
- No trends
- No comparisons

---

## 4. Layer 2 — Order Intelligence (Internal Classification)

### Location

apps/backend/src/services/order-intelligence/

### File

- `orderIntelligence.service.ts`

### Purpose

Convert **facts → classified intelligence**.

This layer:

- **Does not** access the database
- **Does not** expose output externally
- Exists purely to make internal decisions

### Input

OrderFacts

### Output

OrderNexusIntelligence

### Intelligence Shape

export interface OrderNexusIntelligence {
  ordersObserved: number | null;

  margin: {
    averagePct: number | null;
    status: 'healthy' | 'at_risk' | 'loss' | 'unknown';
  };

  loss: {
    exists: boolean | null;
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  dataCoveragePct: number | null;
}

### Guarantees

- Deterministic
- Null-safe
- No explanations
- No causation
- No recommendations

---

## 5. Layer 3 — FTEP (Truth Exposure Policy)

### Location

apps/backend/src/services/order-ftep/

### Files

- `orderFtep.types.ts`
- `orderFtep.service.ts`
- `index.ts`

### Purpose

**Downgrade intelligence into FT2-safe observability.**

This is the **critical boundary** that prevents intelligence leakage.

### Input Contract

export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}

### Output Contract (FT2 Exposure)

export interface OrderNexusFT2Exposure {
  context: {
    period: { from: string; to: string };
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };
}

### Downgrade Rules

| Intelligence   | FT2 Exposure                  |
| -------------- | ----------------------------- |
| margin %       | ❌ never exposed               |
| health status  | positive / negative / unknown |
| loss existence | indirect via outcome only     |
| trend delta    | direction only                |
| explanations   | ❌ never                       |
| reasons        | ❌ never                       |

---

## 6. Leak-Prevention Tests (Mandatory)

### Location

tests/unit/backend/order-nexus/orderFtep.service.test.ts

### Test Categories

#### 1. Positive Exposure

Verifies allowed FT2 fields are present.

#### 2. Intelligence Leak Prevention

Ensures intelligence internals are not exposed.

expect(result.margin).toBeUndefined();
expect(result.loss).toBeUndefined();

#### 3. Serialization Scan

Ensures no forbidden language appears.

expect(JSON.stringify(result)).not.toMatch(/percent|avg|because|reason/i);

#### 4. Null Safety

Ensures unknown intelligence produces null exposure.

These tests are **non-optional**.

---

## 7. Frontend FT2 Adapter

### Location

apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts

### Role

A **pure adapter** that:

- Normalizes `undefined → null`
- Preserves backend semantics
- Performs zero inference
- Applies zero defaults

The adapter is a **pipe, not a brain**.

---

## 8. Lifecycle Integration (FT2)

Order-Nexus FT2 exposure is:

- **Lifecycle-gated**
- Only available when user phase is `FT2`
- Never mutates lifecycle state

Lifecycle resolution remains authoritative in:

apps/backend/src/services/lifecycle.*

---

## 9. Why Order-Nexus Is Canonical

Order-Nexus is the **first and reference** FT2 module because it demonstrates:

- Complete 4-layer separation
- Correct intelligence containment
- Strict exposure downgrade
- Proven leak-prevention tests
- UI safety guarantees

All future FT2 modules **must replicate this architecture identically**.

---

## 10. Replication Rule

Any module that claims FT2 compliance **must**:

- Implement all 4 layers
- Include FTEP leak-prevention tests
- Provide a pure frontend adapter
- Respect lifecycle gating

If any layer is missing, the module is **not FT2-compliant**.

---

## 11. Status

🔒 **LOCKED**

Order-Nexus FT2 architecture is now canonical and immutable.

Changes require:

- Explicit architectural review
- Cross-module impact assessment

---