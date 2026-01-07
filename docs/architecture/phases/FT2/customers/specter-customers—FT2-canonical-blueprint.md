# 🧠 Specter / Customers — FT2 Canonical Blueprint

**Truth-First Customer Observability (FT2 as the Apex)**

---

## 0. Prime Positioning (Locked)

> **Specter observes customer behavior.
> Customers exposes permitted truth.
> LaSyncro never explains behavior.**

Specter/Customers is **not analytics**, **not CRM**, **not marketing intelligence**.

It is **customer observability**.

---

## 1. Truth Ownership (Non-Negotiable)

### Specter owns truth about:

* Anonymous customer behavior
* Sessions
* Presence / absence
* Movement (directional only)
* Behavioral continuity

### Specter does NOT own:

* Identity
* Demographics
* Intent
* Value judgment
* Motivation
* Recommendations

### Customers owns:

* **Nothing computational**
* Only rendering of **FT2-exposed truth**

---

## 2. Canonical FT2 Architecture (Specter)

```
Session Store (Persistence)
   ↓
Layer 1 — Specter Facts
   ↓
Layer 2 — Specter Intelligence
   ↓
Layer 3 — Specter FTEP
   ↓
Layer 4 — FT2 API
   ↓
Customers FT2 Adapter (UI)
```

Each layer is **mandatory**, isolated, and test-guarded.

---

## 3. Layer 1 — Specter Facts (What Is True)

### Purpose

Extract **raw, anonymous behavioral reality**.

### Inputs

* `SessionStore`
* Anonymous session events only

### Outputs (examples, nullable)

* `sessionsObserved`
* `exitIntentSessions`
* `period { from, to }`
* `extractedAt`

### Guarantees

* Nulls preserved
* No inference
* No percentages unless stored
* No cross-module access

### Forbidden

* Trends
* Risk
* Probabilities
* Human language
* Identity

---

## 4. Layer 2 — Specter Intelligence (Internal Meaning)

### Purpose

Classify facts into **internal, non-exposed signals**.

### Allowed

* Status enums: `positive | negative | unknown`
* Direction enums: `up | down | flat | unknown`
* Boolean existence flags

### Forbidden

* Strings
* Explanations
* Advice
* UI semantics
* Exposure

### Rule

> **Intelligence may decide. It may never speak.**

---

## 5. Layer 3 — Specter FTEP (Truth Exposure Policy)

### Purpose

Enforce **what truth is allowed to escape**.

This is the **security boundary**.

### Inputs

* Specter Facts
* Specter Intelligence
* Entitlement context

### Outputs (FT2 Exposure Only)

* Neutral observability
* Coarse outcomes
* Direction without explanation
* Explicit `null` where truth is missing or forbidden

### Hard Prohibitions

* No raw intelligence
* No probabilities
* No segmentation
* No causation
* No recommendations

---

## 6. Layer 4 — FT2 Transport

### Endpoint

```
GET /api/v1/specter/ft2
```

### Characteristics

* Read-only
* Deterministic
* FTEP-enforced
* No lifecycle mutation
* No onboarding logic

Lifecycle decides **availability**, not **truth**.

---

## 7. Customers FT2 UI (Exposure Surface)

### Role

Customers is a **dumb surface**.

### Rules

* Adapter only
* `undefined → null`
* Preserve shape
* Render uncertainty visibly
* No defaults
* No inference
* No CTAs in FT2

> Customers shows **what is known**, **what is unknown**, and **nothing else**.

---

## 8. FT2 Free (Scoped) — Specter / Customers

### What FT2-Free Exposes

FT2-Free provides **existential awareness**.

Users can see:

* Whether customer behavior exists
* Whether sessions are present or absent
* Coarse directional change (non-comparative)
* Data gaps and nulls

Users cannot see:

* History
* Comparisons
* Trends over time
* Segments
* Identity
* Causes

### Why FT2-Free Exists

FT2-Free answers one question:

> **“Is there customer behavior here at all?”**

It builds trust by:

* Showing uncertainty
* Not overselling
* Not interpreting

---

## 9. FT2 Paid (Unlimited) — Specter / Customers

### What Changes

Paid FT2 **removes truth constraints**.

It increases:

* Observation window
* Behavioral continuity
* Data completeness
* Resolution (still coarse, still non-explanatory)
* Cross-module enrichment **only with mutual entitlements**

### What Never Changes

* No explanations
* No advice
* No psychology
* No identity leakage
* No “AI insights”

### Why Users Upgrade

Because:

* Partial awareness creates risk
* Intermittent truth causes anxiety
* Reliable observability becomes operationally valuable

Paid FT2 sells **continuity and reliability**, not intelligence.

---

## 10. Entitlement Rules (Critical)

* Specter FT2 may consume **no other module’s truth** unless:

  * Specter FT2 is paid
  * The other module FT2 is also paid

No silent enrichment.
No hidden joins.

Truth improves **only when both sides are permitted**.

---

## 11. Testing Doctrine (Mandatory)

### Facts Tests

* Raw values only
* Null preservation
* No derived fields

### Intelligence Tests

* Deterministic mapping
* Unknown handling
* No persistence access

### FTEP Leak-Prevention Tests

* Intelligence not exposed
* No causation language
* No percentages
* JSON string scan

### UI Tests

* Snapshot stability
* Null rendering
* No inference
* No CTAs

---

## 12. What This Enables (Strategically)

* Trust without explanation
* Awareness without manipulation
* Upgrade pressure without dark patterns
* A foundation that scales **truth**, not dashboards

---

## Final Lock (Canonical)

> **Specter observes.
> Customers reveals.
> FT2 is the ceiling.
> Truth is the product.
> Permission is the price.**