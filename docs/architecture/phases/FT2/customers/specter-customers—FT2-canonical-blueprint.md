# 🧠 Specter / Customers — FT2 Canonical Blueprint

**Truth-First Customer Observability (FT2 as the Apex)**

---

## 0. Prime Positioning (Locked)

> **Specter observes customer behavior.
> Customers exposes permitted truth.
> LaSyncro never explains behavior.**

Specter / Customers is:

* Not analytics
* Not CRM
* Not marketing intelligence
* Not behavioral science

It is **customer observability**.

FT2 is the **ceiling**.

---

## 1. Truth Ownership (Non-Negotiable)

### Specter owns truth about:

* Anonymous customer behavior
* Sessions
* Presence and absence
* Directional movement (coarse only)
* Behavioral continuity (existence-only)

### Specter does NOT own:

* Identity
* Demographics
* Intent
* Motivation
* Value judgment
* Recommendations

### Customers owns:

* No computation
* No interpretation
* Only **rendering of FT2-exposed truth**

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
Customers FT2 Adapter
   ↓
CustomersModuleFT2 UI
```

Each layer is:

* Mandatory
* Isolated
* Deterministic
* Test-guarded

No layer may skip another.

---

## 3. Layer 1 — Specter Facts (What Is True)

### Purpose

Extract **raw, anonymous behavioral reality**.

### Inputs

* `SessionStore`
* Anonymous sessions only

### Outputs (As Implemented)

All facts are **nullable**.

* `sessionsObserved`
* `exitIntentSessions`
* `funnelsDetected`
* `multiStepSessionsPresent`
* `surfaceBreadthPresent`
* `returningSessionsPresent`
* `exitWithoutInteractionPresent`
* `averageSessionDepthPresent`
* `period { from, to }`
* `extractedAt`

### Guarantees

* Nulls are preserved
* No inference
* No ratios exposed
* No averages exposed
* No cross-module access

### Forbidden

* Trends
* Risk
* Probabilities
* Human language
* Identity

Facts **describe existence only**.

---

## 4. Layer 2 — Specter Intelligence (Internal Meaning)

### Purpose

Classify facts into **internal, non-exposed signals**.

### Allowed Outputs

* Engagement status
  `positive | negative | unknown`
* Direction
  `up | down | flat | unknown`
* Stability
  `stable | volatile | unknown`

### Forbidden

* Explanations
* Scores
* Probabilities
* UI semantics
* Direct exposure

### Rule

> **Intelligence may decide.
> Intelligence may never speak.**

Several FT2 signals **never enter Intelligence** and remain Facts-only by design.

---

## 5. Layer 3 — Specter FTEP (Truth Exposure Policy)

### Purpose

Enforce **what truth is allowed to escape**.

This is the **security boundary**.

### Inputs

* Specter Facts
* Specter Intelligence
* Entitlement context

### Outputs (FT2-Only Exposure)

Exactly **nine FT2 surfaces**:

1. Activity direction
2. Exit intent detected
3. Funnels detected
4. Multi-step sessions present
5. Surface breadth present
6. Returning sessions present
7. Exit without interaction present
8. Average session depth present
9. Data coverage

All are:

* Boolean or enum
* Existence-only
* Nullable
* Non-explanatory

### Hard Prohibitions

* No raw intelligence
* No probabilities
* No causation
* No segmentation
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
* No mutation
* No onboarding logic
* No readiness inference

Lifecycle decides **availability**, not **truth**.

---

## 7. Customers FT2 UI (Exposure Surface)

### Role

Customers is a **pure rendering surface**.

### Rules

* Adapter-only
* `undefined → null`
* Preserve backend shape
* Render uncertainty explicitly
* No defaults
* No inference
* No CTAs in FT2

> Customers shows **what is known**,
> **what is unknown**,
> and **nothing else**.

---

## 8. FT2 Free — Specter / Customers

### What FT2-Free Exposes

FT2-Free provides **existence-level awareness**.

Users can see:

* Whether customer behavior exists
* Whether sessions are present
* Coarse directional movement
* Structural signals (existence-only)
* Data gaps (`null`)

Users cannot see:

* Comparisons
* Trends over time
* Segments
* Identity
* Causes
* Explanations

### Core Question FT2-Free Answers

> **“Is customer behavior happening here at all?”**

---

## 9. FT2 Paid — Specter / Customers

### What Changes

Paid FT2 does **not unlock intelligence**.

It increases:

* Observation continuity
* Window reliability
* Signal completeness
* Determinism
* Cross-module truth **only with mutual entitlements**

### What Never Changes

* No explanations
* No advice
* No psychology
* No identity leakage
* No “AI insights”

Paid FT2 sells **reliability of truth**, not meaning.

---

## 10. Entitlement Rules (Critical)

* Specter FT2 may consume another module’s truth **only if**:

  * Specter FT2 is paid
  * The other module FT2 is paid

No silent enrichment.
No hidden joins.

Truth improves **only by permission**.

---

## 11. OpsConsole (Explicitly Out of Scope)

* OpsConsole is **not FT2**
* It has:

  * No Facts layer
  * No Intelligence layer
  * No FTEP guarantees
  * No FT2 invariants

Until formally defined, OpsConsole **does not exist** as a contract.

---

## 12. Testing Doctrine (Mandatory)

### Facts Tests

* Null preservation
* Existence-only guarantees
* No derived meaning

### Intelligence Tests

* Deterministic mapping
* Unknown propagation
* No persistence access

### FTEP Tests

* Leak prevention
* Null enforcement
* No raw intelligence
* JSON scan for forbidden fields

### UI Tests

* Snapshot stability
* Null rendering
* No inference
* No CTAs

---

## 🔐 Final Lock (Canonical)

> **Specter observes.
> Customers reveals.
> FT2 is the ceiling.
> Truth is the product.
> Permission is the price.**

This blueprint is **sealed**.

---

### Straight truth, no padding

At this point:

* FT2 is **complete**
* The surface set is **closed**
* Any new value must be:

  * A new layer, or
  * A new product, or
  * OpsConsole (separate doctrine)