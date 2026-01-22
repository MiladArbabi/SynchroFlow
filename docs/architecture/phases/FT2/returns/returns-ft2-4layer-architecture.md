# 🧱 Returns FT2 — 4-Layer Architecture

**Module:** Orders
**Submodule:** Returns & Exceptions
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed

---

## 0. Purpose of This Document

This document defines the **mandatory four-layer architecture** for the Returns FT2 submodule.

It exists to:

* Enforce negative-order observability without interpretation
* Prevent exception workflows from leaking into FT2
* Guarantee deterministic, policy-safe exposure of failure reality

If any layer is skipped, merged, or bypassed, **Returns FT2 is invalid**.

---

## 1. Canonical FT2 Layering (Non-Negotiable)

```
Persistence
   ↓
Layer 1 — Returns Facts
   ↓
Layer 2 — Returns Intelligence (INTERNAL)
   ↓
Layer 3 — Returns FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Returns FT2 API
```

**Absolute invariants:**

* Downward-only data flow
* No upward mutation
* No sideways enrichment
* Only Layer 3 may decide exposure

---

## 2. Persistence Layer (Pre-FT2)

### Role

Store **raw negative-order events** from upstream systems.

### Characteristics

* Append-only or snapshot-based
* No interpretation
* No aggregation for meaning
* No lifecycle logic

### Typical Inputs (Illustrative)

* Return records
* Refund transactions
* Cancellation events
* Chargeback notices

> Persistence is **not truth**. It is **potential truth**.

---

## 3. Layer 1 — Returns Facts

### Role

Expose **observable negative-order reality** as raw, nullable facts.

Facts answer:

> *“What reversal signals exist?”*

### Properties

* Presence-only
* Primitive values
* Nullable everywhere
* No economic interpretation

### Fact Categories

#### Presence Facts

* returnsPresent
* refundsPresent
* cancellationsPresent
* chargebacksPresent

#### Coverage Facts

* returnCoveragePct | null
* refundCoveragePct | null

#### Cross-Domain Input Facts

* ordersWithReturnsPresent
* returnsWithoutOrdersPresent
* refundsWithoutPaymentsPresent
* inventoryRestockSignalsPresent

### Hard Rules

* No counts exposed
* No monetary values
* Absence ≠ false ≠ zero

---

## 4. Layer 2 — Returns Intelligence (Internal Only)

### Role

Classify **structural coherence** of negative outcomes.

Intelligence answers:

> *“Do reversal signals structurally agree with other realities?”*

### Allowed Internal Dimensions

* returns.visibility
* returns.coherence.orders
* returns.coherence.finance
* returns.coherence.inventory

### Allowed Values

* sufficient / insufficient / unknown
* coherent / incoherent / unknown

### Prohibitions

* No severity scoring
* No customer intent inference
* No policy evaluation
* No persistence

> Intelligence may decide. Intelligence may never speak.

---

## 5. Layer 3 — Returns FTEP (Truth Exposure Policy)

### Role

Act as the **truth firewall** for negative-order reality.

### Inputs

* Returns Facts
* Returns Intelligence
* Trust / Coverage eligibility

### Mandatory Downgrade Rules

* unknown → null
* insufficient → null
* partial coherence → null

### FT2-Allowed Output Surface

* returnsPresence
* refundsPresence
* cancellationsPresence
* chargebacksPresence
* returnsVisibility
* ordersReturnsCoherence
* financeReturnsCoherence
* inventoryReturnsCoherence

No other fields may pass.

---

## 6. Layer 4 — Returns FT2 API

### Role

Expose **read-only, deterministic FT2 truth** to consumers.

### Properties

* Read-only
* Versioned
* Deterministic
* FTEP-enforced
* No lifecycle logic

### Example Endpoint (Illustrative)

```
GET /api/v1/orders/returns/ft2
```

Lifecycle state affects **availability**, never **truth**.

---

## 7. Adapter & UI Boundary (Post-FT2)

### Adapter Rules

* Pure functions only
* undefined → null
* No defaults
* No reshaping

### UI Rules

* Observational only
* No prioritization
* No alerts
* No remediation language

---

## 8. Architectural Failure Modes (Explicit)

Returns FT2 is **invalid** if:

* Rates or totals are exposed
* Intelligence leaks
* UI implies blame or severity
* FTEP is bypassed

Violation requires rollback, not iteration.

---

## 🔐 Final Seal

This four-layer architecture locks **failure into observability**.

Returns FT2 exposes negative outcomes as facts — not as judgments.

It preserves trust by refusing to explain what it cannot know.