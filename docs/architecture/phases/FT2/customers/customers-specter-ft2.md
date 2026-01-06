# 🧠 Customers / Specter — FT2 Architecture

**As-built, locked, FT2-grade implementation**

This document describes the **current, production reality** of FT2 for
Customers and Specter.

No future intent. No roadmap. No speculation.

---

## 🎯 Purpose

Enable **FT2 observability of customer behavior** while guaranteeing:

* No PII leakage
* No behavioral explanations
* No recommendations
* No UI inference
* No lifecycle coupling

Specter **knows**.  
Customers **shows**.

---

## 🧩 Role Separation

### Specter (Backend Engine)

Specter is the **source of truth** for customer behavior.

It is responsible for:

* Session ingestion (anonymous)
* Behavioral fact extraction
* Internal intelligence classification
* Leak-proof FT2 exposure

Specter is **never** a UI module.

---

### Customers (Frontend Surface)

Customers is a **pure presentation layer**.

It is responsible for:

* Rendering FT2 observability
* Preserving backend semantics
* Avoiding inference or logic

Customers **never computes**.

---

## 🧱 Specter FT2 Pipeline (Canonical)

Session Store
↓
Specter Facts
↓
Specter Intelligence
↓
Specter FTEP
↓
FT2 HTTP Endpoint
↓
Customers FT2 Adapter

yaml
Copy code

---

## 1️⃣ Specter Facts (Layer 1)

**Raw behavioral truth**

### Inputs

* Anonymous sessions from `SessionStore`

### Outputs

* Session counts
* Exit-intent presence
* Observation period
* Extraction timestamp

### Guarantees

* Preserves nulls
* No derived meaning
* No percentages beyond stored facts

---

## 2️⃣ Specter Intelligence (Layer 2)

**Internal-only classification**

### Responsibilities

* Classify presence vs absence
* Determine basic directional signals
* Handle missing data deterministically

### Prohibitions

* No persistence access
* No explanations
* No frontend exposure

---

## 3️⃣ Specter FTEP (Layer 3)

**Truth Exposure Policy**

### Purpose

Downgrade Specter intelligence into **FT2-safe observability**.

### Exposure Rules

* Intelligence is reduced to:
  * `positive | negative | unknown`
  * `up | down | flat | unknown`
* Raw scores, risks, probabilities are **never exposed**
* Missing intelligence returns `null`

This is the **security boundary**.

---

## 4️⃣ FT2 Transport (Specter)

### Endpoint

GET /api/v1/specter/ft2

yaml
Copy code

### Characteristics

* Read-only
* Deterministic
* FTEP-enforced
* No lifecycle mutation
* No onboarding or readiness coupling

Lifecycle gating occurs **outside** this endpoint.

---

## 5️⃣ Customers FT2 Adapter

### Rules

* Normalize `undefined → null`
* Preserve backend shape
* No derived fields
* No defaults
* No logic

The adapter is a **pipe**, not a processor.

---

## 🔒 Non-Negotiable Invariants

1. Specter never explains behavior
2. Customers never infers meaning
3. FTEP is the security boundary
4. Lifecycle controls availability, not truth
5. FT2 is observability, not insight

---

## ✅ Status

Customers / Specter FT2 is:

* Implemented
* Tested
* Leak-proof
* Lifecycle-safe
* Canonical

This document is **locked** until FT3.
