# 🔒 Returns FT2 — Canonical Blueprint (Orders Submodule)

**Module:** Orders
**Submodule:** Returns & Exceptions
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed
**Entitlement:** Paid-only (removes blindness)

---

## 0. Prime Intent (Non-Negotiable)

Returns FT2 exists to expose **negative order reality** as it is observable — not to diagnose failure, assign blame, or recommend remediation.

Returns FT2:

* ❌ does not explain why returns happen
* ❌ does not calculate rates or severities
* ❌ does not optimize policies
* ❌ does not suggest fixes

Returns FT2 answers only:

> **“Do order reversals and failures exist, and are they structurally coherent with order and financial reality?”**

FT2 is the ceiling. There is no FT3.

---

## 1. Truth Ownership (Locked)

### Returns FT2 Owns Truth About

* Return signal presence
* Refund signal presence
* Cancellation signal presence
* Chargeback signal presence
* Observability & coverage of negative outcomes
* Structural coherence with:

  * Orders
  * Finance
  * Inventory

### Returns FT2 Explicitly Does NOT Own

* Root causes
* Severity ranking
* Customer intent
* Policy effectiveness
* Financial optimization

---

## 2. Canonical 4-Layer FT2 Architecture

```
Persistence (returns, refunds, cancellations, chargebacks)
   ↓
Layer 1 — Returns Facts
   ↓
Layer 2 — Returns Intelligence (INTERNAL)
   ↓
Layer 3 — Returns FTEP (Truth Exposure Policy)
   ↓
Layer 4 — Returns FT2 API
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

## 3. Layer 1 — Returns Facts (Observable Truth)

Facts are **presence-only**, **nullable**, and **non-semantic**.

### Core Facts

* `returnsPresent`
* `refundsPresent`
* `cancellationsPresent`
* `chargebacksPresent`

### Coverage Facts

* `returnCoveragePct | null`
* `refundCoveragePct | null`

### Cross-Domain Input Facts

* `ordersWithReturnsPresent`
* `returnsWithoutOrdersPresent`
* `refundsWithoutPaymentsPresent`
* `inventoryRestockSignalsPresent`

**Rules:**

* No counts exposed
* No monetary values
* Absence ≠ zero ≠ false

---

## 4. Layer 2 — Returns Intelligence (Internal Only)

### Purpose

Classify **structural meaning** from negative order facts.

### Allowed Internal Classifications

* `returns.visibility`: `sufficient | insufficient | unknown`
* `returns.coherence.orders`: `coherent | incoherent | unknown`
* `returns.coherence.finance`: `coherent | incoherent | unknown`
* `returns.coherence.inventory`: `coherent | incoherent | unknown`

### Hard Rules

* Intelligence never exposed
* Missing facts collapse to `unknown`
* No severity scoring

---

## 5. Layer 3 — Returns FTEP (Truth Exposure Policy)

### Purpose

Downgrade internal classifications into **FT2-safe exposure**.

### Exposed FT2 Signals (Only)

* `returnsPresence: boolean | null`
* `refundsPresence: boolean | null`
* `cancellationsPresence: boolean | null`
* `chargebacksPresence: boolean | null`
* `returnsVisibility: sufficient | insufficient | null`
* `ordersReturnsCoherence: aligned | divergent | null`
* `financeReturnsCoherence: aligned | divergent | null`
* `inventoryReturnsCoherence: aligned | divergent | null`

### Mandatory Downgrades

* `unknown → null`
* Partial coherence → `null`

---

## 6. Returns FT2 — Entitlement Rules

Returns FT2 is **paid-only**.

### Rationale

* Returns truth is operationally expensive
* It exposes uncomfortable failure reality
* It removes blindness without adding meaning

Free tier renders all returns signals as `null`.

---

## 7. Alignment Planes (Post-FTEP)

Alignment planes classify **structural agreement only**.

### Active Planes

* Orders ↔ Returns
* Finance ↔ Returns
* Inventory ↔ Returns
* Cross-Domain Trust (META)

---

## 8. UI Contract (Returns FT2)

* Observational only
* No prioritization
* No alerts
* No remediation language

Render states:

* `null` → `—`
* `unknown` → `—`
* `insufficient` → literal string

---

## 9. Explicit Non-Capabilities (Sealed)

Returns FT2 contains **no**:

* Return rates
* Refund totals
* Loss metrics
* Customer blame
* Policy analysis

---

## 🔐 Final Seal

Returns FT2 exposes **failure as fact**, not as judgment.

It prevents SMBs from ignoring the economic shadow of orders.

This blueprint is **canonical and locked**.
Any deviation requires explicit RFC and consortium review.