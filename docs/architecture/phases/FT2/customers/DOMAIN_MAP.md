# 🔒 Customers / Specter FT2 Canon

## + Alignment Planes Handoff (Authoritative)

**Status:** 🔒 LOCKED
**Applies to:** Backend · Modules · Frontend · Product · Monetization
**Last Updated:** Now
**Change Policy:** Explicit RFC only

---

## 0. Executive Intent (Read First)

Customers / Specter FT2 is not an analytics module.

It is the **Customer Nervous System (CNS)** for SMBs.

Its job is not to:

* optimize
* advise
* predict
* recommend
* persuade

Its job is to:

> **Make customer reality observable, comparable, and undeniable across silos.**

All future vertical intelligence depends on this layer being:

* semantically pure
* horizontally extensible
* immune to monetization pressure

This document locks that foundation.

---

## 1. FT2 Is the Top (Non-Negotiable)

There is:

* ❌ no FT3
* ❌ no FT2+
* ❌ no hidden “advanced tier” semantics

There is only:

| Tier           | Meaning                                 |
| -------------- | --------------------------------------- |
| **FT2 (Free)** | Limited exposure of truth               |
| **FT2 (Paid)** | Less lossy exposure of the *same* truth |

### Implication

* **All domains are designed first**
* **FTEP decides visibility, not existence**
* Monetization NEVER introduces new truth
* Monetization only *removes downgrades*

If a signal cannot exist in FT2-free in *some* form, it must not exist at all.

---

## 2. Customers FT2 Canonical Domains (Locked)

These **9 domains are final** for Customers FT2.

No additions.
No mergers.
No silent expansion.

---

### 1. Identity Presence Reality (FOUNDATIONAL)

**Question:**

> Do customers exist as identifiable entities?

**Truth owned:**

* customer record existence
* identity observability

**FT2 Exposure:**

* `customersPresent: boolean | null`
* `identityCoverage: complete | partial | unknown`

---

### 2. Activity Presence Reality

**Question:**

> Are customers doing anything at all?

**Truth owned:**

* activity existence
* directional movement (lossy)

**Exposure:**

* `activityObserved: boolean | null`
* `activityDirection: up | down | flat | unknown`

---

### 3. Engagement Structure Reality

**Question:**

> Is customer behavior structurally meaningful?

**Truth owned:**

* depth existence

**Exposure:**

* `multiStepSessionsPresent: boolean | null`
* `averageSessionDepthPresent: boolean | null`

---

### 4. Surface Breadth Reality

**Question:**

> Do customers explore more than one surface?

**Truth owned:**

* cross-surface existence

**Exposure:**

* `surfaceBreadthPresent: boolean | null`

---

### 5. Returning Behavior Reality

**Question:**

> Do customers come back?

**Truth owned:**

* returning presence

**Exposure:**

* `returningSessionsPresent: boolean | null`

---

### 6. Exit & Abandonment Reality

**Question:**

> Do customers leave without engaging?

**Truth owned:**

* early exit existence

**Exposure:**

* `exitIntentDetected: boolean | null`
* `exitWithoutInteractionPresent: boolean | null`

---

### 7. Journey Structure Reality

**Question:**

> Do customer journeys have any structure?

**Truth owned:**

* funnel marker existence

**Exposure:**

* `funnelsDetected: boolean | null`

---

### 8. Observability Coverage Reality (TRUST DOMAIN)

**Question:**

> Is customer data observable or guessed?

**Truth owned:**

* data coverage certainty

**Exposure:**

* `dataCoverage: complete | insufficient | unknown`

---

### 9. Cross-Signal Coherence Reality (META)

**Question:**

> Do customer signals agree with each other?

**Truth owned:**

* agreement vs contradiction

**Exposure:**

* `signalCoherence: aligned | divergent | unknown`

> May be free, paid, or internal-only
> But MUST be computed once domains exist

---

## 3. Architectural Laws (Reinforced)

These apply to **every Customers domain**.

1. One domain → one question
2. Facts are raw and dumb
3. Intelligence classifies only
4. FTEP downgrades only
5. `null` is first-class
6. Unknown propagates aggressively
7. No lifecycle mutation
8. No advice
9. No optimization
10. No “helpfulness”

Violation = rollback.

---

## 4. Free vs Paid (Policy, Not Architecture)

### Principle

> **Paid removes blindfolds.
> Free never lies.**

### Examples (Illustrative, not final)

| Signal              | Free    | Paid      |
| ------------------- | ------- | --------- |
| `activityDirection` | unknown | up / down |
| `signalCoherence`   | hidden  | exposed   |
| `identityCoverage`  | partial | complete  |
| `funnelsDetected`   | yes     | yes       |
| Raw counts          | ❌       | ❌ (never) |

Counts, ratios, and explanations are **never exposed**, even paid.

---

## 5. Alignment Planes (Post-Domain Phase)

Once **all 9 Customers domains exist**, the system graduates from *vertical truth* to **horizontal coherence**.

Alignment Planes are **meta-truth layers**.

They do not add signals.
They compare existing ones.

---

## Alignment Plane Definition

> An Alignment Plane exposes whether two vertical realities **agree, diverge, or cannot be compared**.

No causes.
No blame.
No resolution.

---

## Alignment Plane #1 — Demand Reality

**Customers ↔ Orders**

**Question:**

> Do customer signals align with actual orders?

**Examples:**

* Customers active, orders absent
* Orders present, customers dormant

**Exposure:**

* `demandAlignment: aligned | divergent | unknown`

---

## Alignment Plane #2 — Engagement ↔ Revenue

**Customers ↔ Finance**

**Question:**

> Does engagement correspond to money movement?

**Exposure:**

* `engagementRevenueAlignment`

---

## Alignment Plane #3 — Customer ↔ Product Reality

**Question:**

> Are customers interacting with products that operationally exist?

**Exposure:**

* `customerProductAlignment`

---

## Alignment Plane #4 — Trust Alignment Plane (META)

**Question:**

> Are these realities even based on comparable data coverage?

**Exposure:**

* `crossDomainTrust: aligned | divergent | unknown`

---

## 6. Why This Creates a Must-Have SaaS

Most SMB tools answer:

> “What happened?”

This system answers:

> **“What do you *not* actually know?”**

That is the moment users stop trusting spreadsheets, dashboards, and gut feeling.

Once alignment planes light up contradictions, churn risk collapses.

They cannot unsee it.

---

## 7. Build Order (Mandatory)

1. Lock Customers FT2 domains (this doc)
2. Implement all 9 Facts layers
3. Implement Intelligence (classification-only)
4. Implement FTEP (downgrade-only)
5. Stabilize UI rendering (boring by design)
6. THEN introduce Alignment Planes
7. THEN decide Free vs Paid exposure

Skipping steps creates semantic debt.

---

## 8. Enforcement Checklist (Required)

* [ ] No new Customers signal without domain
* [ ] No paid-only signal without free downgraded form
* [ ] No frontend inference
* [ ] No backend explanation strings
* [ ] No counts exposed
* [ ] No ratios exposed
* [ ] No optimization language
* [ ] No “recommendation” UI

---

## 9. Final Lock Statement

> Customers FT2 is the **epistemic foundation** of the SaaS.

If this layer lies, everything above it becomes manipulation.

If this layer is clean, the platform becomes unavoidable.

This canon is **locked**.

---