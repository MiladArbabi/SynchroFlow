# 📘 Dashboard FT2 — Architecture & Contract (As‑Is)

**Status:** Canonical · Verified · Truth‑Preserving
**Lifecycle:** `FT2_READY` only
**Surface:** System‑level observability (read‑only)

---

## 1. Purpose (Locked)

`DashboardFT2` answers exactly one question:

> **“What does the system currently observe, with governed confidence?”**

It is **not**:

* a summary of modules
* an intelligence layer
* a recommendation surface
* a lifecycle driver

---

## 2. Data Ownership & Flow (End‑to‑End)

Canonical DB
   ↓
Facts (Layer 1)
   ↓
Intelligence (Layer 2)
   ↓
FTEP – Truth Exposure Policy (Layer 3)
   ↓
Dashboard Aggregation (FT2)
   ↓
UI Adapter
   ↓
DashboardFT2Page

**Hard rule:**
Dashboard FT2 consumes **only Layer‑3 (FTEP) outputs**.
No facts. No intelligence. No inference.

---

## 3. Backend Contract

### 3.1 Endpoint

GET /api/v1/dashboard/ft2

**Rules**

* Authenticated
* Shop‑scoped
* Read‑only
* Deterministic
* No lifecycle mutation

---

### 3.2 Response Shape (As‑Is)

ts
{
  observationWindow: {
    from: string;
    to: string;
  };

  coverage: {
    ordersObserved: number | null;
    productsObserved: number | null;
    sessionsObserved: number | null;
  };

  systemHealth: null; // intentionally undeclared at backend level (for now)
}

---

### 3.3 Observation Window

* Source: `getFt2Period()`
* Backend‑owned
* UTC
* Deterministic
* Currently: rolling 30 days

**No frontend control. No params.**

---

### 3.4 Coverage Aggregation (Implemented)

**Source inputs**

* `OrderNexusFT2Exposure.context.ordersObserved`
* `ProductsFT2Exposure.context.productsObserved`

**Rules**

* Undefined → null
* No recomputation
* No inference
* Sessions intentionally `null`

ts
buildDashboardFt2Coverage({
  orders: OrderNexusFT2Exposure | null,
  products: ProductsFT2Exposure | null,
})

---

## 4. Why System Health Shows `—` (Critical Truth)

### Orders

* `deriveOrderIntelligence` **never sets** `margin.status`
* Defaults to `'unknown'`
* FTEP converts `'unknown' → null`
* Dashboard correctly renders `—`

➡️ **Outcome is intentionally suppressed.**

---

### Products

* If any facts are `null` → intelligence outcome = `'unknown'`
* FTEP converts `'unknown' → null`
* Dashboard correctly renders `—`

➡️ **Outcome is fact‑incomplete, not broken.**

---

## 5. Frontend Contract

### 5.1 Snapshot Adapter

ts
mapDashboardFt2Snapshot(snapshot)

**Rules**

* Pure
* Undefined → null only
* No aggregation
* No interpretation
* No defaults

---

### 5.2 UI Rendering Semantics

* `null` → rendered as `—`
* No CTAs
* No guidance
* No explanations
* No lifecycle messaging

**Current UI (Correct)**

System Overview
Observation window
<from>
<to>

System Health
Orders outcome      —
Products outcome    —

Coverage
Orders observed     1
Products observed   17
Sessions observed   —

This is **truthful observability**, not incompleteness.

---

## 6. What Is Explicitly NOT Implemented (By Design)

* ❌ Order intelligence classification
* ❌ Dashboard‑level intelligence
* ❌ Cross‑module reasoning
* ❌ System confidence scoring
* ❌ Session coverage
* ❌ Recommendations
* ❌ “Why this matters”

These require **explicit future contracts**.

---

## 7. Enhancement Roadmap (When Truth Is Ready)

### Phase 1 — Products (Low Risk)

* Ensure `statusCounts.*` are never `null` when rows exist
* Unlock Products outcome exposure automatically

### Phase 2 — Orders (Medium Risk)

* Define **explicit, test‑backed** intelligence thresholds
* Set `margin.status` deterministically
* Expose outcome via existing FTEP (no changes there)

### Phase 3 — System Health Aggregation (Optional)

* Introduce a **Dashboard FTEP**
* Downgrade multiple outcomes → system‑level signals
* Still no inference, no recommendations

---

## 8. Non‑Negotiables (Seal)

* Dashboard FT2 never guesses
* Absence of data is rendered honestly
* Intelligence must earn exposure
* UI never compensates for backend gaps
* Any change requires:

  1. Scan evidence
  2. Tests
  3. Explicit contract update

---

## 9. Final Assessment

What exists now is **architecturally correct, honest, and stable**.

This dashboard shows *what the system knows* — not what it hopes.

Truth is preserved. Future capability is unlocked deliberately.
