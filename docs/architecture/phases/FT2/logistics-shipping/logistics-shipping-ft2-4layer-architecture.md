# 🧱 Logistics / Shipping FT2 — 4‑Layer Architecture

**Module:** Logistics / Shipping
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium‑Sealed

---

## 0. Purpose of This Document

This document defines the **mandatory four‑layer architecture** for the Logistics / Shipping FT2 module.

Its purpose is to:

* Enforce strict observability semantics
* Prevent delivery analytics creep
* Guarantee deterministic, policy‑safe truth exposure

If any layer is skipped, merged, or bypassed, **Shipping FT2 is invalid**.

---

## 1. Canonical FT2 Layering (Non‑Negotiable)

```
Persistence
   ↓
Layer 1 — Shipping Facts
   ↓
Layer 2 — Shipping Intelligence (INTERNAL)
   ↓
Layer 3 — Shipping FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Shipping FT2 API
```

**Absolute invariants:**

* Downward‑only data flow
* No upward mutation
* No sideways enrichment
* Only Layer 3 may decide exposure

---

## 2. Persistence Layer (Pre‑FT2)

### Role

Store **raw shipping and carrier observations** from upstream systems.

### Characteristics

* Event‑based or snapshot‑based
* Append‑only
* No interpretation
* No derived metrics

### Typical Inputs (Illustrative)

* Carrier event payloads
* Shipment creation records
* Exception / delay events

> Persistence is **not truth**. It is **potential truth**.

---

## 3. Layer 1 — Shipping Facts

### Role

Expose **observable shipping reality** as raw, nullable facts.

Facts answer:

> *“What shipping signals exist?”*

### Properties

* Existence‑only
* Primitive values
* Nullable everywhere
* No timing semantics

### Fact Categories

#### Presence Facts

* shippingRecordsPresent
* carrierSignalPresent
* shipmentIdentifiersPresent

#### Delay & Exception Facts

* delaySignalPresent
* exceptionEventPresent

#### Coverage Facts

* shippingCoveragePct | null
* carrierCoveragePct | null

#### Cross‑Domain Input Facts

* ordersWithShippingButNoFulfillmentPresent
* fulfilledOrdersWithoutShippingPresent
* shippingWithoutInventoryReferencePresent

### Hard Rules

* No timestamps exposed
* No durations or SLAs
* Absence ≠ false ≠ zero

---

## 4. Layer 2 — Shipping Intelligence (Internal Only)

### Role

Classify **structural coherence** internally.

Intelligence answers:

> *“Do shipping signals structurally agree with other realities?”*

### Allowed Internal Dimensions

* shipping.visibility
* shipping.delayPresence
* shipping.coherence.orders
* shipping.coherence.fulfillment
* shipping.coherence.promise
* shipping.coherence.inventory

### Allowed Values

* sufficient / insufficient / unknown
* present / absent / unknown
* coherent / incoherent / unknown

### Prohibitions

* No carrier comparison
* No performance scoring
* No persistence
* No UI exposure

> Intelligence may decide. Intelligence may never speak.

---

## 5. Layer 3 — Shipping FTEP (Truth Exposure Policy)

### Role

Act as the **truth firewall** for shipping reality.

### Inputs

* Shipping Facts
* Shipping Intelligence
* Trust / Coverage eligibility

### Mandatory Downgrade Rules

* unknown → null
* insufficient → null
* partial coherence → null

### FT2‑Allowed Output Surface

* shippingPresence
* shippingVisibility
* shippingDelaySignal
* ordersShippingCoherence
* fulfillmentShippingCoherence
* promiseShippingCoherence
* inventoryShippingCoherence

No other fields may pass.

---

## 6. Layer 4 — Shipping FT2 API

### Role

Expose **read‑only, deterministic FT2 truth** to consumers.

### Properties

* Read‑only
* Versioned
* Deterministic
* FTEP‑enforced
* No lifecycle logic

### Example Endpoint (Illustrative)

```
GET /api/v1/logistics/shipping/ft2
```

Lifecycle state affects **availability**, never **truth**.

---

## 7. Adapter & UI Boundary (Post‑FT2)

### Adapter Rules

* Pure functions only
* undefined → null
* No defaults
* No reshaping

### UI Rules

* Observational only
* No timelines or countdowns
* No alerts or urgency cues
* Equal visual weight

---

## 8. Architectural Failure Modes (Explicit)

Shipping FT2 is **invalid** if:

* ETAs or timestamps are exposed
* Intelligence leaks
* UI infers urgency or performance
* FTEP is bypassed

Violation requires rollback, not iteration.

---

## 🔐 Final Seal

This four‑layer architecture **locks shipping into observability**.

It prevents SMBs from mistaking **carrier telemetry for certainty**.

Logistics / Shipping FT2 remains factual, silent, and trustworthy — by design.