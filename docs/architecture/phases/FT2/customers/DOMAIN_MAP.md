# 🔒 Customers / Specter FT2 Canon

## + Alignment Planes Handoff (Authoritative)

**Status:** 🔒 LOCKED
**Applies to:** Backend · Modules · Frontend · Product · Monetization
**FT Level:** **FT2 is terminal**
**Last Updated:** Now
**Change Policy:** Explicit RFC only

---

## 0. Executive Intent (Read First)

Customers / Specter FT2 is **not** an analytics module.

It is the **Customer Nervous System (CNS)** for SMBs.

Its job is not to:

* optimize
* advise
* predict
* recommend
* persuade

Its only job is to:

> **Make customer reality observable, bounded, and undeniable — including what is *not* observable.**

FT2 is the epistemic floor of the product.
Everything above it either respects this truth or becomes manipulation.

This document locks that floor.

---

## 1. FT2 Is the Top (Non-Negotiable)

There is:

* ❌ no FT3
* ❌ no FT2+
* ❌ no hidden “advanced” semantics

There is only:

| Tier           | Meaning                         |
| -------------- | ------------------------------- |
| **FT2 (Free)** | More downgrades, more blindness |
| **FT2 (Paid)** | Fewer downgrades, same truth    |

### Absolute Rule

> **Monetization may remove blindness.
> Monetization may never add truth.**

If a signal cannot exist in **FT2-Free in downgraded form**, it must not exist at all.

---

## 2. Customers & Specter FT2 — Canonical Domains (LOCKED)

FT2 consists of **12 canonical domains**.

They are final.
They are atomic.
They are non-overlapping.

No additions.
No merges.
No silent expansion.

---

### **Domain 1 — Identity Presence Reality**

**Question:**
Do customers exist as identifiable entities?

**Truth owned:**

* entity existence
* identity observability

**FT2 Signals:**

* `customersPresent: boolean | null`
* `identityCoverage: complete | partial | unknown`

**Notes:**

* In Specter FT2, this domain is **permanently downgraded**
* In Customers FT2, it exists but is currently **not rendered**

---

### **Domain 2 — Activity Presence Reality**

**Question:**
Is there *any* observable customer activity?

**Truth owned:**

* existence of activity
* silence as a signal

**FT2 Signals:**

* `sessionsPresent: boolean | null`
* `activityObserved: boolean | null`

**Hard rule:**
`false` ≠ `null`
Silence is meaningful **only if observable**.

---

### **Domain 3 — Engagement Structure Reality**

**Question:**
Is customer behavior structurally meaningful?

**Truth owned:**

* depth existence only

**FT2 Signals:**

* `multiStepSessionsPresent: boolean | null`
* `averageSessionDepthPresent: boolean | null`

No averages.
No scores.
No engagement “quality”.

---

### **Domain 4 — Surface Breadth Reality**

**Question:**
Do customers explore more than one surface?

**Truth owned:**

* cross-surface existence

**FT2 Signal:**

* `surfaceBreadthPresent: boolean | null`

---

### **Domain 5 — Returning Behavior Reality**

**Question:**
Do customers come back?

**Truth owned:**

* returning existence

**FT2 Signal:**

* `returningSessionsPresent: boolean | null`

No cohorts.
No retention math.
No attribution.

---

### **Domain 6 — Exit & Abandonment Reality**

**Question:**
Do customers leave without engaging?

**Truth owned:**

* early disengagement existence

**FT2 Signals:**

* `exitIntentDetected: boolean | null`
* `exitWithoutInteractionPresent: boolean | null`

No severity.
No cause.
No blame.

---

### **Domain 7 — Journey Structure Reality**

**Question:**
Do customer journeys exhibit *any* structure?

**Truth owned:**

* funnel marker existence

**FT2 Signal:**

* `funnelsDetected: boolean | null`

This is **not** funnel performance.
It is structural observability only.

---

### **Domain 8 — Observability Coverage Reality (TRUST)**

**Question:**
Is activity absence meaningful or unknowable?

**Truth owned:**

* observability certainty

**FT2 Signal:**

* `dataCoverage: complete | insufficient | unknown`

This is **not data quality**.
It is epistemic confidence.

---

### **Domain 9 — Directional Movement Reality (LOSSY)**

**Question:**
Is activity directionally changing?

**Truth owned:**

* directional movement without magnitude

**FT2 Signal:**

* `activityDirection: up | down | flat | unknown | null`

**Current state:**

* Always `null` in FT2 due to no continuity
* Structurally present, informationally empty

---

### **Domain 10 — Instrumentation Gaps Reality (META-OBSERVABILITY)**

**Question:**
What *could not* be observed due to missing instrumentation?

**Truth owned:**

* observability blind spots

**FT2 Signal:**

* `instrumentationGaps: InstrumentationGap[] | null`

**Examples:**

* `page_depth`
* `surface_breadth`
* `returning_flag`
* `exit_intent`
* `funnels`

> Signals describe customers.
> Gaps describe **our eyesight**.

---

### **Domain 11 — Data Freshness Reality**

**Question:**
Is the extracted data temporally valid for this window?

**Truth owned:**

* freshness vs staleness

**FT2 Signal:**

* `dataFreshness: boolean | null`

No SLAs.
No urgency.
No alarms.

---

### **Domain 12 — Cross-Domain Consistency Reality**

**Question:**
Do observed signals logically contradict each other?

**Truth owned:**

* internal coherence

**FT2 Signal:**

* `consistencyIssues: ConsistencyIssue[] | null`

**Examples:**

* depth without sessions
* funnels without activity
* returning without sessions

No diagnosis.
No resolution.
Just contradiction.

---

## 3. Architectural Laws (Absolute)

These apply to **every FT2 domain**:

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

**Principle**

> Paid removes blindfolds.
> Free never lies.

### Examples (Illustrative)

| Signal                | Free    | Paid      |
| --------------------- | ------- | --------- |
| `activityDirection`   | unknown | up / down |
| `instrumentationGaps` | hidden  | exposed   |
| `consistencyIssues`   | hidden  | exposed   |
| Counts                | ❌       | ❌ (never) |

Paid **never** adds:

* counts
* ratios
* explanations
* recommendations

---

## 5. Alignment Planes (Post-FT2 Phase)

Alignment Planes activate **only after FT2 is complete and stable**.

They:

* add **no new signals**
* compare existing truths across modules

---

### Alignment Plane Definition

> An Alignment Plane exposes whether two realities **agree, diverge, or cannot be compared**.

No causes.
No blame.
No fixes.

---

### Alignment Plane #1 — Demand Reality

**Customers ↔ Orders**

* `demandAlignment`

---

### Alignment Plane #2 — Engagement ↔ Revenue

**Customers ↔ Finance**

* `engagementRevenueAlignment`

---

### Alignment Plane #3 — Customer ↔ Product Reality

* `customerProductAlignment`

---

### Alignment Plane #4 — Cross-Domain Trust Plane

* `crossDomainTrust`

---

## 6. Why This Becomes a Must-Have SaaS

Most tools answer:

> “What happened?”

FT2 answers:

> **“What do you *not actually know*?”**

That moment collapses false confidence.

Once contradictions, gaps, and blindness are visible, users cannot unsee them.

That is the lock-in.

---

## 7. Mandatory Build Order

1. Lock FT2 domains (this document)
2. Implement all Facts layers
3. Implement Intelligence (classification only)
4. Implement FTEP (downgrade only)
5. Stabilize boring UI rendering
6. Introduce Alignment Planes
7. Decide Free vs Paid exposure

Skipping steps creates semantic debt.

---

## 8. Enforcement Checklist

* [ ] No new signal without domain
* [ ] No paid-only truth
* [ ] No frontend inference
* [ ] No backend explanations
* [ ] No counts
* [ ] No ratios
* [ ] No optimization language
* [ ] No recommendations

---

## 🔐 Final Lock Statement

FT2 is the **epistemic foundation** of the platform.

If this layer lies, everything above it manipulates.
If this layer is clean, the product becomes unavoidable.

This canon is **locked**.

---