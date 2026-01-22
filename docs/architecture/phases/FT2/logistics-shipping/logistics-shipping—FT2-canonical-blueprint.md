# 🔒 Logistics / Shipping FT2 — Canonical Blueprint (LaSyncro)

**Module:** Logistics / Shipping
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed
**Applies to:** Backend · Architecture · Product · UI · Monetization

---

## 0. Prime Intent (Non-Negotiable)

Logistics / Shipping FT2 exists to expose **shipping reality as it is observable**, not as it is promised, optimized, or explained.

Shipping FT2:

* ❌ does not predict delivery
* ❌ does not compute SLAs
* ❌ does not rank carriers
* ❌ does not explain delays
* ❌ does not recommend actions

Shipping FT2 answers only:

> **“Do shipping signals exist, are delays observable, and does shipping agree with orders, fulfillment, and customer promises?”**

FT2 is the ceiling. There is no FT3.

---

## 1. Truth Ownership (Locked)

### Shipping FT2 Owns Truth About

* Shipping signal presence
* Delay signal presence (existence only)
* Carrier observability (presence only)
* Structural coherence with:

  * Orders
  * Fulfillment
  * Customers (promise presence)
  * Inventory (where applicable)

### Shipping FT2 Explicitly Does NOT Own

* Delivery estimates
* Transit duration
* On-time performance
* Carrier scoring
* Cost optimization

---

## 2. Canonical 4-Layer FT2 Architecture

```
Persistence (shipping records, carrier events)
   ↓
Layer 1 — Shipping Facts
   ↓
Layer 2 — Shipping Intelligence (internal only)
   ↓
Layer 3 — Shipping FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Shipping FT2 API
   ↓
Adapters (pure)
   ↓
Observational UI
```

**Invariants:**

* No layer may be skipped
* Intelligence never leaks
* FTEP is the sole exposure gate

---

## 3. Layer 1 — Shipping Facts (Observable Truth)

Facts are **existence-only**, **nullable**, and **non-semantic**.

### Core Facts

* `shippingRecordsPresent`
* `carrierSignalPresent`
* `shipmentIdentifiersPresent`

### Delay Facts

* `delaySignalPresent`
* `exceptionEventPresent`

### Coverage Facts

* `shippingCoveragePct | null`
* `carrierCoveragePct | null`

### Cross-Domain Input Facts

* `ordersWithShippingButNoFulfillmentPresent`
* `fulfilledOrdersWithoutShippingPresent`
* `shippingWithoutInventoryReferencePresent`

**Rules:**

* No timestamps exposed
* No durations
* No blame

---

## 4. Layer 2 — Shipping Intelligence (Internal Only)

### Purpose

Classify **structural coherence** internally.

### Allowed Internal Classifications

* `shipping.visibility`: `sufficient | insufficient | unknown`
* `shipping.delayPresence`: `present | absent | unknown`
* `shipping.coherence.orders`: `coherent | incoherent | unknown`
* `shipping.coherence.fulfillment`: `coherent | incoherent | unknown`
* `shipping.coherence.promise`: `coherent | incoherent | unknown`

### Hard Rules

* Intelligence never exposed
* Missing facts collapse to `unknown`
* No carrier comparison logic

---

## 5. Layer 3 — Shipping FTEP (Truth Exposure Policy)

### Purpose

Downgrade internal classifications into **FT2-safe signals**.

### Exposed FT2 Signals (Only)

* `shippingPresence: boolean | null`
* `shippingVisibility: sufficient | insufficient | null`
* `shippingDelaySignal: present | absent | null`
* `ordersShippingCoherence: aligned | divergent | null`
* `fulfillmentShippingCoherence: aligned | divergent | null`
* `promiseShippingCoherence: aligned | divergent | null`

### Mandatory Downgrades

* `unknown → null`
* Partial coherence → `null`

---

## 6. Shipping FT2 — Free vs Paid

### FT2 Free

* Shipping presence
* Delay signal presence (downgraded)
* Explicit blindness (`null`)
* Short observation window

### FT2 Paid

* Longer historical window
* Higher coverage eligibility
* Full alignment planes enabled

**Paid removes blindness. Paid never adds truth.**

---

## 7. Alignment Planes (Post-FTEP)

Alignment planes classify **structural agreement only**.

### Active Planes

* Shipping ↔ Orders
* Shipping ↔ Fulfillment
* Shipping ↔ Customer Promise
* Shipping ↔ Inventory
* Cross-Domain Trust (META)

**Rules:**

* Deterministic
* Read-only
* Fail closed
* No narrative

---

## 8. UI Contract (Shipping FT2)

* Observational only
* No timelines
* No countdowns
* No alerts
* No urgency semantics

Render states:

* `null` → `—`
* `unknown` → `—`
* `insufficient` → literal string

---

## 9. Explicit Non-Capabilities (Sealed)

Shipping FT2 contains **no**:

* ETA calculations
* SLA compliance
* Carrier ranking
* Delivery guarantees
* Performance metrics

---

## 🔐 Final Seal

Logistics / Shipping FT2 exposes **what is observable** about shipping — and nothing more.

It prevents SMBs from mistaking **carrier data for certainty**.

This blueprint is **canonical and locked**.
Any deviation requires explicit RFC and consortium review.
