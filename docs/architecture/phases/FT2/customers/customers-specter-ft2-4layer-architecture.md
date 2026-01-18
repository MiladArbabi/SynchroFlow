# 🧠 Customers / Specter — 4-Layer FT2 Architecture

**As-built, locked, FT2-grade implementation**

This document describes the **current production reality** of FT2 for
Customers and Specter.

No roadmap.
No intent.
No speculation.

---

## 🎯 Purpose

Enable **FT2-grade observability of customer behavior** while guaranteeing:

* No PII leakage
* No behavioral explanations
* No recommendations
* No inference
* No lifecycle coupling
* No escalation beyond FT2

Specter **knows**.
Customers **renders**.

---

## 🧩 Role Separation

### Specter (Backend Engine)

Specter is the **exclusive source of behavioral truth**.

It is responsible for:

* Anonymous session ingestion
* Behavioral fact extraction
* Internal classification (intelligence)
* FT2-safe truth exposure (FTEP)

Specter:

* Never renders UI
* Never explains behavior
* Never exposes raw metrics beyond FT2

---

### Customers (Frontend Surface)

Customers is a **pure FT2 presentation surface**.

It is responsible for:

* Rendering FTEP-sanitized truth
* Preserving backend null semantics
* Enforcing visibility (free vs paid)

Customers:

* Never computes
* Never infers
* Never upgrades truth
* Never compensates for missing data

---

## 🧱 Specter FT2 Pipeline (Canonical)

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

This pipeline is **strictly one-way**.

---

## 1️⃣ Specter Facts (Layer 1)

**Raw, interpretation-free behavioral truth**

### Inputs

* Anonymous sessions from `SessionStore`

### Outputs (As Implemented)

| Fact Field                      | Type           | Semantics      |
| ------------------------------- | -------------- | -------------- |
| `sessionsObserved`              | number | null  | Null if none   |
| `exitIntentSessions`            | number | null  | Count only     |
| `funnelsDetected`               | boolean | null | Existence      |
| `multiStepSessionsPresent`      | boolean | null | Existence      |
| `surfaceBreadthPresent`         | boolean | null | Existence      |
| `returningSessionsPresent`      | boolean | null | Existence      |
| `exitWithoutInteractionPresent` | boolean | null | Existence      |
| `averageSessionDepthPresent`    | boolean | null | Existence      |
| `period.from / to`              | string         | Always present |
| `extractedAt`                   | ISO string     | Always present |

### Guarantees

* Nulls are preserved
* Counts are never inferred
* Averages are **never exposed**
* All non-count signals are **existence-only**

Facts **do not explain**.

---

## 2️⃣ Specter Intelligence (Layer 2)

**Internal-only classification**

### Responsibilities

* Classify engagement state
* Determine directional movement
* Handle missing data deterministically

### Outputs

| Field                | Values                        |
| -------------------- | ----------------------------- |
| `engagement.status`  | positive | negative | unknown |
| `behavior.direction` | up | down | flat | unknown    |
| `behavior.trend`     | stable | volatile | unknown   |

### Constraints

* No persistence access
* No frontend exposure
* No use of:

  * `averageSessionDepthPresent`
  * `exitWithoutInteractionPresent`

These remain **Facts-only signals**.

---

## 3️⃣ Specter FTEP (Layer 3)

**Truth Exposure Policy — the security boundary**

### Purpose

Downgrade Facts + Intelligence into **FT2-safe observability**.

### Exposure Rules

* Intelligence is reduced to:

  * Outcome status
  * Directional arrow
* All signals are:

  * Boolean
  * Existence-only
* Missing intelligence → `null`
* No magnitude, no ratios, no confidence

### Exposed Signal Set (FT2)

1. Activity direction
2. Exit intent detected
3. Funnels detected
4. Multi-step sessions present
5. Surface breadth present
6. Returning sessions present
7. Exit without interaction present
8. Average session depth present
9. Data coverage

This list is **closed**.

---

## 4️⃣ FT2 Transport (Specter)

### Endpoint

```
GET /api/v1/specter/ft2
```

### Characteristics

* Read-only
* Deterministic
* FTEP-enforced
* No mutation
* No lifecycle awareness
* No readiness logic

Lifecycle and entitlement live **outside** FT2.

---

## 5️⃣ Customers FT2 Adapter

### Rules

* `undefined → null`
* Preserve backend shape
* No derived fields
* No defaults
* No interpretation

The adapter is a **pipe**, not a processor.

---

## 6️⃣ CustomersModuleFT2 UI

### Role

* Render exactly what FT2 exposes
* Hide nothing except `null`
* Show “Unknown” only when explicitly allowed

### Guarantees

* No inference
* No fallback logic
* No cross-surface synthesis

Each surface = **one truth**.

---

## 🧱 OpsConsole — Explicitly Out of Scope

* OpsConsole is **not FT2**
* OpsConsole has:

  * No Facts layer
  * No Intelligence layer
  * No FTEP rules
  * No FT2 guarantees

Any OpsConsole is a **separate contract**.

Until defined, it **does not exist**.

---

## 🔒 Non-Negotiable Invariants

1. Specter never explains behavior
2. Customers never infers meaning
3. FTEP is the only exposure boundary
4. Lifecycle controls availability, not truth
5. FT2 is observability, not insight
6. FT2 has no higher tier

---

## ✅ Status

Customers / Specter FT2 is:

* Implemented
* Evidence-backed
* Leak-proof
* Deterministic
* Contract-sealed

This document is **locked**.

---

### Final call-out (important)

You now have **exactly nine FT2 surfaces**, plus a **non-FT2 OpsConsole placeholder**.

That means:

* FT2 is complete
* No more signals should be added without breaking the contract
* Any future expansion **must** be a new layer, not FT2