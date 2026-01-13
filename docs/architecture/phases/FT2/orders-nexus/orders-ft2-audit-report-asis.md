# 📊 FT2 AUDIT REPORT — ORDERS (ORDER-NEXUS)

**(Enhanced with Live UI Reconciliation)**

**Audit Scope:** Orders FT2 (end-to-end)
**Audit Method:** SCAN → DIGEST → COLLECT → REGISTER
**Audit Status:** ✅ **COMPLETE & CLOSED**
**Code Changes:** ❌ None
**Assumptions:** ❌ None

---

## 1. Audit Coverage (Exhaustive)

### Backend (Authoritative Truth Path)

* `order-facts/*` — Layer 1 (Facts)
* `order-intelligence/*` — Layer 2 (Intelligence)
* `order-ftep/*` — Layer 3 (Truth Exposure Policy)
* `order-nexus-ft2/orderNexusFt2.resolver.ts` — FT2 orchestration

### Frontend (FT2 UI Path)

* `useOrdersFt2Snapshot.ts` — FT2 snapshot fetch
* `useOrdersFt2Adapter.ts` — FT2 adapter
* `OrdersModuleFT2.tsx` — FT2 UI surface

➡️ **No remaining file can augment, suppress, or reshape Orders FT2 truth without violating declared architecture.**

---

## 2. Reference Architecture Compliance

Orders FT2 strictly follows the canonical FT2 architecture:

Persistence (Canonical DB)
   ↓
Layer 1 — Facts
   ↓
Layer 2 — Intelligence
   ↓
Layer 3 — FTEP
   ↓
Layer 4 — FT2 UI

**Invariant validated:**

> The FT2 UI consumes **only Layer-3 (FTEP) exposure** — never Facts or Intelligence directly.

---

## 3. Layer-by-Layer Findings

### 3.1 Layer 1 — Facts (Order Facts Service)

**Sources**

* `canonical_orders`
* `canonical_order_line_items`

**Extracted facts**

* `ordersObserved` (count)
* `revenueTotal` (sum)
* `costTotal` → **always null (structural absence)**
* `currency` → null
* `dataCoverage.completenessPct`
* `period`, `shopId`, `extractedAt`

**Null semantics**

* Zero ≠ null (preserved)
* Nulls propagated exactly
* No defaults introduced

**Assessment**

* ✅ Purely observational
* ✅ No interpretation or intelligence
* ✅ Clean separation of counts vs sums vs coverage

---

### 3.2 Layer 2 — Intelligence (Order Intelligence Service)

**Observed behavior**

* All intelligence fields initialized
* All classifications remain `'unknown'`
* No thresholds, no branching, no state transitions

**Assessment**

* ❌ No active intelligence
* ✅ Deterministic, conservative, intentional
* ⚠️ Intelligence exists structurally but is **fully inert**

---

### 3.3 Layer 3 — FTEP (Truth Exposure Policy)

**Exposure rules**

* Facts exposed verbatim
* Intelligence downgraded when `unknown`

**Result**

* `outcome` → always `null`
* `trend` → always `null`
* Coverage preserved

**Assessment**

* ✅ No intelligence leaks
* ✅ Deterministic downgrade
* ✅ Exposure boundary enforced exactly

---

### 3.4 Backend FT2 Resolver (Order-Nexus)

**Behavior**

* Linear orchestration: Facts → Intelligence → FTEP
* No enrichment, mutation, or reshaping

**Assessment**

* ✅ Transparent pass-through
* ✅ Cannot alter truth surface

---

### 3.5 FT2 Snapshot (Frontend)

**Endpoint**

* `/api/v1/modules/order-nexus/ft2`

**Behavior**

* No params
* Backend-owned period
* No transformation

**Assessment**

* ✅ Verbatim transport
* ✅ No inference or defaults

---

### 3.6 FT2 Adapter (Frontend)

**Primary behavior**

* Normalizes `undefined → null`
* Enforces stable FT2 UI shape

**Observed deviation**

* Injects `{ from: '', to: '' }` when `context.period` is missing

**Assessment**

* 🟡 Mostly pure
* ⚠️ Controlled semantic deviation (period placeholder only)
* ❌ Comment claims stricter purity than implementation

---

### 3.7 FT2 UI (OrdersModuleFT2)

**Rendering rules**

* `null` → `—`
* Values rendered verbatim
* No computation, inference, or masking

**Assessment**

* ✅ Honest observability surface
* ✅ No compensation for missing intelligence
* ✅ Empty strings (if present) rendered transparently

---

## 4. Live UI Reconciliation (Observed Output)

**Rendered UI**

Period: 2025-12-14T11:43:07.479Z → 2026-01-13T11:43:07.479Z
Orders observed: 1
Total revenue: 1226.91
Total cost: —
Net outcome: —
Trend: —
Data coverage: 0%

### Field-by-Field Truth Reconciliation

| Field              | Source of Truth                                       | Reconciliation                           |
| ------------------ | ----------------------------------------------------- | ---------------------------------------- |
| Period             | Backend FT2 input                                     | ✅ Verbatim ISO timestamps; backend-owned |
| Orders observed    | COUNT(canonical_order_id)                             | ✅ Exact factual count                    |
| Total revenue      | SUM(total_price)                                      | ✅ Pure fact; currency absent honestly    |
| Total cost         | Structural null                                       | ✅ Correctly rendered as `—`              |
| Net outcome        | Intelligence unknown → FTEP null                      | ✅ Correct suppression                    |
| Trend              | Intelligence unknown → FTEP null                      | ✅ Correct suppression                    |
| Data coverage (0%) | Line items present, all missing `estimated_unit_cost` | ✅ Mathematically correct                 |

**Key insight:**
The UI is **not incomplete** — it is **precisely as complete as the truth allows**.

---

## 5. Cross-Surface Alignment Matrix — Orders

| Module | Fact Exists | Intelligence Active | FTEP Exposes                 | Dashboard Consumes | UI Shows     |
| ------ | ----------- | ------------------- | ---------------------------- | ------------------ | ------------ |
| Orders | Yes         | ❌ (always unknown)  | Outcome = null, Trend = null | Yes (verbatim)     | Honest (`—`) |

---

## 6. Intentional vs Accidental Gaps

### Intentional (Architectural)

* Intelligence inert by design
* Outcome suppressed when intelligence unknown
* Trend suppressed when intelligence unknown
* Cost absent at order level
* Currency unresolved at this layer

### Accidental / Deviations

* **Synthetic period placeholder (`''`) in FT2 adapter**

  * Visible
  * Non-deceptive
  * Does not affect analytical truth
  * Architecturally notable

---

## 7. Final Verdict — Orders FT2

**Orders FT2 is fully audited, closed, and truth-preserving.**

* No truth leaks
* No hidden intelligence
* No UI compensation
* Deterministic behavior end-to-end
* One minor, explicit contract deviation (period placeholder)

**Status**

* 🟢 FT2-Compliant
* 🟢 Epistemically Honest
* 🟢 Audit-Closed

If the output feels unsatisfying, that discomfort is **the system doing its job**.
FT2 is not here to reassure — it is here to tell the truth, and stop exactly there.
