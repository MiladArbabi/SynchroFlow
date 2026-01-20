# 🧠 Customers / Specter — 4-Layer FT2 Architecture

### As-Built · Evidence-Backed · FT2-Grade · Locked

This document describes the **actual production reality** of FT2 for
Specter and Customers.

No roadmap.
No intent.
No speculation.

---

## 🎯 Purpose

Provide **FT2-grade customer observability** while guaranteeing:

* No PII leakage
* No behavioral explanations
* No recommendations
* No inference
* No lifecycle coupling
* No escalation beyond FT2

**Specter observes.**
**Customers renders.**

---

## 🧩 Role Separation (Strict)

### Specter (Backend Engine)

Specter is the **exclusive source of customer behavioral truth**.

It is responsible for:

* Anonymous session ingestion
* Behavioral fact extraction
* Internal classification (Intelligence)
* Truth exposure control (FTEP)

Specter **never**:

* Renders UI
* Explains behavior
* Exposes raw metrics
* Exposes counts or ratios

---

### Customers (Frontend Surface)

Customers is a **pure FT2 rendering shell**.

It is responsible for:

* Rendering FTEP-approved truth
* Preserving null semantics
* Enforcing visibility (free vs paid)

Customers **never**:

* Computes
* Infers
* Upgrades truth
* Fills gaps

---

## 🧱 Canonical FT2 Pipeline (One-Way)

```
Session Store
   ↓
Specter Facts
   ↓
Specter Intelligence
   ↓
Specter FTEP
   ↓
FT2 Provider (HTTP)
   ↓
Customers FT2 Adapter
   ↓
CustomersModuleFT2 UI
```

No layer may be skipped.
No backward flow exists.

---

## 1️⃣ Specter Facts — Layer 1

**Raw, interpretation-free reality**

### Inputs

* Anonymous sessions from `SessionStore`

### Outputs (As Implemented)

All fields are **existence-only** and **nullable**.

#### Behavioral Facts

* `sessionsPresent`
* `multiStepSessionsPresent`
* `averageSessionDepthPresent`
* `surfaceBreadthPresent`
* `returningSessionsPresent`
* `exitIntentDetected`
* `exitWithoutInteractionPresent`
* `funnelsDetected`

#### Meta / Trust Facts

* `instrumentationGaps`
* `dataFreshness`
* `consistencyIssues`

#### Context

* `period { from, to }`
* `extractedAt`

### Guarantees

* Nulls preserved
* No counts
* No ratios
* No averages
* No identity
* No inference

Facts describe **what exists** and **what cannot be seen**.

---

## 2️⃣ Specter Intelligence — Layer 2

**Internal classification only**

### Purpose

Classify **structural meaning**, never behavior intent.

### Outputs

* `engagement.status`: `positive | negative | unknown`
* `behavior.direction`: `up | down | flat | unknown`
* `behavior.trend`: `stable | volatile | unknown`

### Constraints

* No persistence access
* No UI exposure
* No explanations

Several FT2 domains **bypass Intelligence entirely** and remain Facts-only.

> Intelligence may decide.
> Intelligence may never speak.

---

## 3️⃣ Specter FTEP — Layer 3

**Truth Exposure Policy (Security Boundary)**

### Purpose

Downgrade Facts + Intelligence into **FT2-safe truth**.

### FT2-Exposed Domains (Closed Set)

#### Behavioral Domains

1. Activity direction
2. Engagement structure (classified)
3. Multi-step sessions present
4. Average session depth present
5. Surface breadth present
6. Returning sessions present
7. Exit intent detected
8. Exit without interaction present
9. Funnels detected

#### Trust / Meta Domains

10. Data coverage
11. Instrumentation gaps
12. Data freshness
13. Cross-domain consistency

> These are **existence-level**, not explanatory.

### Prohibitions

* No raw intelligence
* No causation
* No probabilities
* No recommendations
* No narrative

FTEP is the **only escape hatch for truth**.

---

## 4️⃣ FT2 Transport — Layer 4

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

Availability ≠ truth.

---

## 5️⃣ Customers FT2 Adapter

### Rules

* Pipe-only
* `undefined → null`
* Preserve backend shape
* No defaults
* No inference

The adapter is **mechanical**, not semantic.

---

## 6️⃣ CustomersModuleFT2 UI

### Role

Render **exactly one truth per surface**.

### Guarantees

* Null rendered explicitly
* Unknown rendered only when allowed
* No fallback logic
* No cross-surface synthesis
* No CTAs

If truth is missing, the UI **shows absence**.

---

## 🧱 OpsConsole — Explicitly Out of Scope

OpsConsole:

* Is **not FT2**
* Has no Facts
* Has no Intelligence
* Has no FTEP guarantees

Until formally defined, **it does not exist as a contract**.

---

## 🔒 Non-Negotiable Invariants

1. Specter never explains behavior
2. Customers never infers meaning
3. FTEP is the only exposure boundary
4. Lifecycle controls availability, not truth
5. FT2 is observability, not insight
6. FT2 has **no higher tier**

---

## ✅ Status

Customers / Specter FT2 is:

* Implemented
* Deterministic
* Leak-proof
* Epistemically clean
* Contract-sealed

This document is **locked**.

---

### Final correction (important)

FT2 now contains **12 domains**.
Any future value **must not extend FT2**.

It must be:

* A new layer, or
* A new product, or
* OpsConsole (separate doctrine)

Anything else is a contract violation.

---