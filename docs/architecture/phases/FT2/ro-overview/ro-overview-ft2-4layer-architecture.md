# 🧱 RO-Overview FT2 — 4-Layer Architecture (Formalized Absence)

**Module:** RO-Overview (Read-Only Overview)
**Phase:** FT2 (Terminal)
**Status:** Canonical · Locked · Consortium-Sealed

---

## 0. Purpose of This Document

This document exists to **formally specify what RO-Overview does *not* have**.

RO-Overview is an FT2 surface **without internal layers**.

Formalizing this absence is critical to prevent future semantic creep.

---

## 1. Canonical FT2 Layering (Explicitly Absent)

RO-Overview implements **none** of the following:

* ❌ Facts Layer
* ❌ Intelligence Layer
* ❌ FTEP Layer
* ❌ Persistence Layer

There is no internal pipeline.

---

## 2. Actual Architecture (Canonical)

```
[Upstream FT2 APIs]
   ↓
Pure Adapters (mechanical passthrough)
   ↓
RO-Overview FT2 UI
```

That is the **entire system**.

---

## 3. Adapter Contract (Non-Negotiable)

Adapters used by RO-Overview must:

* Be pure functions
* Perform no inference
* Perform no aggregation
* Convert `undefined → null`
* Preserve source module semantics

Adapters are pipes, not brains.

---

## 4. Trust Gating (Inherited)

RO-Overview does **not** evaluate trust.

It consumes:

* `trustEligible` from Trust / Data Health FT2

### Mandatory Behavior

If `trustEligible = null`:

* RO-Overview renders **nothing**
* No partial composition
* No degraded mode

Silence is the only valid output.

---

## 5. Layer Violation Scenarios (Invalid States)

RO-Overview becomes invalid if:

* It computes summaries
* It derives roll-ups
* It introduces scores
* It ranks modules
* It highlights urgency

Any of the above constitutes an **implicit intelligence layer**.

---

## 6. UI Boundary Rules

RO-Overview UI must:

* Render FT2 outputs verbatim
* Respect `null` everywhere
* Avoid semantic emphasis

### Render Rules

* `null` → `—`
* `unknown` → `—`
* `insufficient` → literal string

No colors.
No icons.
No alerts.

---

## 🔐 Final Seal

This document locks RO-Overview as a **layerless orientation surface**.

Its power comes from what it refuses to do.

Any attempt to add layers to RO-Overview is an architectural violation and requires rollback.