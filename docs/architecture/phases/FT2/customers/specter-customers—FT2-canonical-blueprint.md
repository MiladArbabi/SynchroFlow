# 🧠 Specter / Customers — FT2 Canonical Blueprint

### Truth-First Customer Observability (FT2 as the Apex)

**Specter = backend observability engine**
**Customers = UI shell consuming FT2-exposed truth**

---

## 0. Prime Positioning (LOCKED)

> **Specter observes customer behavior.
> Customers exposes permitted truth.
> LaSyncro never explains behavior.**

Specter / Customers is:

* ❌ Not analytics
* ❌ Not CRM
* ❌ Not marketing intelligence
* ❌ Not behavioral science

It is **customer observability**.

FT2 is the **ceiling**.
Nothing smarter exists above it.

---

## 1. Truth Ownership (Non-Negotiable)

### Specter owns truth about:

* Anonymous customer behavior
* Session existence and absence
* Structural behavior (existence-only)
* Observability limits and blindness
* Logical consistency across signals

### Specter explicitly does **not** own:

* Identity
* Demographics
* Intent or motivation
* Value judgments
* Recommendations
* Explanations

### Customers owns:

* ❌ No computation
* ❌ No interpretation
* ❌ No synthesis

Customers **only renders FT2-exposed truth**.

---

## 2. Canonical FT2 Architecture (As Implemented)

```
Session Store (Persistence)
   ↓
Layer 1 — Specter Facts
   ↓
Layer 2 — Specter Intelligence (internal only)
   ↓
Layer 3 — Specter FTEP (truth firewall)
   ↓
Layer 4 — FT2 API
   ↓
Customers FT2 Adapter
   ↓
CustomersModuleFT2 UI
```

**Invariants:**

* No layer is optional
* No layer may skip another
* No upward mutation
* No sideways enrichment

---

## 3. Layer 1 — Specter Facts (What Is True)

### Purpose

Extract **raw, anonymous behavioral reality** and **meta-reality about observability**.

### Inputs

* `SessionStore`
* Anonymous sessions only

### Outputs (As Implemented)

All fields are **existence-only** and **nullable**.

#### Core Behavioral Facts

* `sessionsPresent`
* `multiStepSessionsPresent`
* `averageSessionDepthPresent`
* `surfaceBreadthPresent`
* `returningSessionsPresent`
* `exitIntentDetected`
* `exitWithoutInteractionPresent`
* `funnelsDetected`

#### Meta-Reality Facts

* `instrumentationGaps`
* `dataFreshness`
* `consistencyIssues`

#### Context

* `period { from, to }`
* `extractedAt`

### Guarantees

* Nulls preserved
* No inference
* No ratios
* No counts
* No identity
* No cross-module access

Facts describe **existence only**, including the existence of **blindness and contradiction**.

---

## 4. Layer 2 — Specter Intelligence (Internal Classification)

### Purpose

Classify **structural meaning** internally.

### Allowed Outputs

* `engagement.status`: `positive | negative | unknown`
* `behavior.direction`: `up | down | flat | unknown`
* `behavior.trend`: `stable | volatile | unknown`

### Hard Rules

* Intelligence **never**:

  * Explains
  * Scores
  * Persists
  * Renders
  * Leaks

> **Intelligence may decide.
> Intelligence may never speak.**

Several FT2 signals **never enter Intelligence** by design and remain Facts-only.

---

## 5. Layer 3 — Specter FTEP (Truth Exposure Policy)

### Purpose

Act as the **truth firewall**.

This is the **only layer allowed to decide exposure**.

### Inputs

* Specter Facts
* Specter Intelligence
* CTR (truth readiness)

### Outputs (FT2-Only Exposure)

FT2 exposes **the following surfaces only**:

#### Behavioral Surfaces

1. `activityDirection`
2. `multiStepSessionsPresent`
3. `averageSessionDepthPresent`
4. `surfaceBreadthPresent`
5. `returningSessionsPresent`
6. `exitIntentDetected`
7. `exitWithoutInteractionPresent`
8. `funnelsDetected`

#### Trust / Meta Surfaces

9. `dataCoverage`
10. `instrumentationGaps`
11. `dataFreshness`
12. `consistencyIssues`

All are:

* Boolean / enum
* Existence-only
* Nullable
* Non-explanatory

### Absolute Prohibitions

* No raw intelligence
* No causation
* No probabilities
* No recommendations
* No narrative

---

## 6. Layer 4 — FT2 Transport

### Endpoint

```
GET /api/v1/specter/ft2
```

### Properties

* Read-only
* Deterministic
* FTEP-enforced
* No lifecycle logic
* No readiness inference

Lifecycle affects **availability**, never **truth**.

---

## 7. Customers FT2 Adapter

### Role

**Mechanical passthrough only**.

### Rules

* Pipe-only
* `undefined → null`
* No inference
* No defaults
* No reshaping

If the backend is silent, the adapter is silent.

---

## 8. CustomersModuleFT2 UI

### Role

**Pure FT2 renderer**.

### Guarantees

* One surface = one truth
* `null` rendered explicitly
* Unknown rendered as unknown
* No synthesis
* No CTAs
* No guidance

> Customers shows:
>
> * what is known
> * what is unknown
> * what cannot be known

And stops.

---

## 9. FT2 Free — What Exists

FT2-Free exposes **existence-level awareness only**.

Users can see:

* Whether behavior exists
* Whether sessions are present
* Structural signals (existence-only)
* Blindness (`null`)
* Contradictions

### FT2-Free answers one question:

> **“Is customer behavior happening here at all — and how blind am I?”**

---

## 10. FT2 Paid — What Improves

Paid FT2 **does not add intelligence**.

It improves:

* Observability continuity
* Data completeness
* Determinism
* Cross-module alignment (only with mutual entitlements)

### What never changes

* No explanations
* No advice
* No psychology
* No identity leakage
* No “AI insights”

Paid FT2 sells **reliability of truth**, not meaning.

---

## 11. Entitlement Law (Critical)

Specter FT2 may consume another module’s truth **only if**:

* Specter FT2 is paid
* The other module FT2 is paid

No silent joins.
No hidden enrichment.

Truth improves **only by permission**.

---

## 12. OpsConsole (Explicitly Non-Existent)

OpsConsole:

* ❌ Has no Facts layer
* ❌ Has no Intelligence layer
* ❌ Has no FTEP
* ❌ Has no FT2 guarantees

Until formally specified, OpsConsole **does not exist as a contract**.

---

## 13. Testing Doctrine (Mandatory)

### Facts Tests

* Null propagation
* Existence-only enforcement
* No inferred meaning

### Intelligence Tests

* Deterministic mapping
* Aggressive unknown propagation
* No persistence access

### FTEP Tests

* Leak prevention
* Downgrade enforcement
* Forbidden field scans

### UI Tests

* Snapshot stability
* Explicit null rendering
* No inference
* No CTAs

---

## 🔐 Final Lock Statement

> **Specter observes.
> Customers reveals.
> FT2 is the ceiling.
> Truth is the product.
> Permission is the price.**

This blueprint is **sealed**.

---

### Ruthless summary

* Your architecture is now **coherent**
* The domain set is **closed**
* You’ve successfully encoded **epistemic humility as product design**