Good instinct. This is exactly the right moment to **freeze the pattern into doctrine** before entropy creeps in.

Below is a **module-agnostic, copy-pasteable reference document** that other modules (Customers, Products, Finances, Analytics, etc.) can follow **identically**.
It reflects what you *actually built*, not a theoretical architecture.

No fluff. No metaphors. This is operational law.

---

# 📐 FT2 Four-Layer Architecture

**Canonical Module Implementation Guide**

> This document defines the **only approved way** to surface FT2 data for any module in the system.
> Deviation is not allowed without architectural review.

---

## 🎯 Objective

Provide **FT2 observability** for a module while guaranteeing:

* No intelligence leakage
* No causation or explanation
* No recommendations
* No UI coupling
* Deterministic, testable behavior

FT2 is **read-only truth exposure**, not insight.

---

## 🧱 The Four Layers (Non-Negotiable)

Persistence
   ↓
Layer 1 — Facts
   ↓
Layer 2 — Intelligence
   ↓
Layer 3 — FTEP (Truth Exposure Policy)
   ↓
Lifecycle Resolver → Frontend FT2 Adapter

Each layer has:

* A single responsibility
* A strict input/output contract
* Hard prohibitions

---

# 1️⃣ Layer 1 — Facts

**Raw truth, zero meaning**

### Purpose

Extract **raw, interpretation-free facts** from persistence.

### What it MAY do

* Query database
* Aggregate counts and totals
* Preserve nulls exactly
* Return timestamps

### What it MUST NOT do

* Classify (good/bad)
* Compute percentages unless stored
* Detect trends
* Use words like *healthy*, *risk*, *loss*

---

### Files (example: OrderNexus)

apps/backend/src/services/<module>-facts/
├── <module>Facts.service.ts
├── <module>Facts.types.ts
└── index.ts

### Types (example)

ts
export interface ModuleFacts {
  shopId: number;
  period: { from: string; to: string };

  itemsObserved: number | null;

  totals: {
    valueA: number | null;
    valueB: number | null;
    currency: string | null;
  };

  dataCoverage: {
    completenessPct: number | null;
  };

  extractedAt: string;
}

### Tests (required)

* Returns raw values
* Preserves nulls
* Does not emit derived fields

---

# 2️⃣ Layer 2 — Intelligence

**Classification, nothing more**

### Purpose

Convert facts into **internal intelligence signals**.

### What it MAY do

* Classify (positive / negative / unknown)
* Derive directions (up / down / flat)
* Use thresholds

### What it MUST NOT do

* Access database
* Explain causality
* Recommend actions
* Format for UI
* Leak to frontend directly

---

### Files

apps/backend/src/services/<module>-intelligence/
├── <module>Intelligence.service.ts
└── index.ts

### Input

ts
facts: ModuleFacts

### Output

ts
export interface ModuleIntelligence {
  itemsObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  dataCoveragePct: number | null;
}

### Tests (required)

* Deterministic output
* Unknown when facts missing
* No persistence access

---

# 3️⃣ Layer 3 — FTEP (Truth Exposure Policy)

**Downgrade intelligence → observability**

> This layer exists solely to **prevent leaks**.

### Purpose

Expose **only what FT2 is allowed to see**.

### What it MAY do

* Drop fields
* Downgrade intelligence
* Convert internal signals → neutral observability

### What it MUST NOT do

* Explain *why*
* Expose percentages if forbidden
* Expose raw intelligence structures
* Introduce new semantics

---

### Files

apps/backend/src/services/<module>-ftep/
├── <module>Ftep.service.ts
├── <module>Ftep.types.ts
└── index.ts

### Input

ts
{
  facts: ModuleFacts;
  intelligence: ModuleIntelligence;
}

### Output (FT2 Exposure)

ts
export interface ModuleFT2Exposure {
  context: {
    period: { from: string; to: string };
    itemsObserved: number | null;
  };

  totals: {
    valueA: number | null;
    valueB: number | null;
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

---

### Leak-Prevention Tests (MANDATORY)

Every module **must** include tests that assert:

* ❌ No intelligence objects exposed
* ❌ No percentages if forbidden
* ❌ No words like:

  * because
  * due to
  * reason
  * driver
  * caused
* ❌ No recommendation language

These tests are **architectural guards**, not business tests.

---

# 4️⃣ Lifecycle & Transport Integration

**Lifecycle owns availability. Transport owns delivery.**

### Rule

Modules **may expose FT2 via dedicated HTTP endpoints**, provided that:

* The endpoint is **read-only**
* The endpoint returns **FTEP output only**
* No lifecycle mutation occurs
* No intelligence or explanations are exposed

Lifecycle **does not care how FT2 is transported** — only **when FT2 is considered active and usable**.

---

### Pattern

FT2 HTTP Controller
 └── calls <Module>Ft2Pipeline
       ├── Facts
       ├── Intelligence
       └── FTEP

Lifecycle Resolver
 └── decides:
       * Whether FT2 is active
       * Whether FT2 is rendered in UI
       * Whether FT2 is persisted or latched

---

### Locations

**FT2 Pipeline**
apps/backend/src/services/<module>-facts
apps/backend/src/services/<module>-intelligence
apps/backend/src/services/<module>-ftep

**FT2 Transport (optional but allowed)**
apps/backend/src/api/<module>/<module>.ft2.controller.ts

**Lifecycle Authority**
apps/backend/src/services/lifecycle.resolver.ts

---

### Hard Invariants

* Transport **must not**:
  * Gate lifecycle
  * Write state
  * Explain data
* Lifecycle **must not**:
  * Transform FT2 data
  * Inject semantics
  * Bypass FTEP

Lifecycle controls **timing and eligibility**.  
FTEP controls **truth exposure**.

# 🎨 Frontend Adapter (Read-Only)

Frontend adapters:

* Normalize `undefined → null`
* Preserve shape
* Never infer
* Never compute

They assume the backend has already enforced FTEP.

---

## 🧠 Final Laws (Memorize These)

1. **Facts ≠ Intelligence**
2. **Intelligence ≠ Exposure**
3. **Exposure ≠ Insight**
4. **Lifecycle owns timing**
5. **FTEP is the security boundary**
6. **If a test can’t prove non-leakage, the layer is incomplete**

---

## ✅ Status

This document now defines:

* The **canonical FT2 architecture**
* The **migration path** for every module
* The **guardrails** that prevent regression