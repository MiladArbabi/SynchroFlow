# 📦 Products / SKU-OS — FT2 Domain Map (Canonical)

**Phase:** FT2
**Module:** Products / SKU-OS
**Status:** Canonical · Forward-Compatible
**Purpose:** Define all **product reality domains** eligible for FT2 exposure
**Scope:** Observability only (no insight, no advice, no control)

---

## 1. Why Domains Exist (FT2 Framing)

Products in SMB systems do not fail in one dimension.

They fail because **multiple realities drift out of alignment**.

FT2 does not optimize products.
FT2 exposes **where reality exists, where it is missing, and where it disagrees**.

To do this safely, Products FT2 is decomposed into **orthogonal reality domains**.

Each domain:

* Owns **one kind of observable truth**
* Has its own Facts → Intelligence → FTEP pipeline
* Produces **lossy, policy-safe exposure**
* Never explains *why*
* Never suggests *what to do*

---

## 2. Canonical Product Reality Domains

### 2.1 Structural Reality (FOUNDATIONAL)

**Question answered:**

> *Does this product exist correctly and unambiguously?*

**Owns:**

* Product identity
* SKU presence
* Variant structure
* Status (active / inactive / archived)

**Does NOT own:**

* Inventory
* Sales
* Costs
* Operations

**Exposure examples (FT2-safe):**

* counts
* coverage signals
* structure complexity flags

**Status:** ✅ Implemented & sealed

---

### 2.2 Operational Reality (EXECUTION FLOW)

**Question answered:**

> *Can this product move through the system without breaking?*

**Owns:**

* Inventory visibility presence
* Fulfillment signal presence
* Operational stability indicators

**Does NOT own:**

* Optimization
* Root causes
* Recommendations

**Exposure examples:**

* `inventory: ok | gaps | unknown`
* `fulfillment: visible | missing | unknown`
* `stability: stable | fragile | unknown`

**Status:** 🟡 Implemented (initial exposure)

---

### 2.3 Economic Reality (MONEY VISIBILITY)

**Question answered:**

> *Is the financial reality of this product observable?*

**Owns:**

* Cost coverage
* Revenue presence
* Profit visibility (observed, not calculated)

**Does NOT own:**

* Margins as judgments
* Profitability advice
* Pricing strategy

**Exposure examples:**

* cost coverage ratios
* revenue vs profit distributions
* price vs cost time series

**Status:** 🟡 Implemented (observational)

---

## 3. Critical Future Domains (Planned, FT2-Eligible)

The following domains are **architecturally approved** for FT2 but not yet implemented.

They are listed here to prevent semantic drift and ad-hoc expansion.

---

### 3.1 Supply & Replenishment Reality

**Question answered:**

> *Can this product be replenished in time?*

**Owns:**

* Replenishment signal presence
* Lead-time observability
* Reorder signal existence

**Explicitly does NOT:**

* Forecast demand
* Recommend reorder quantities
* Optimize stock levels

**FT2 Exposure Pattern:**

* `replenishment: observable | missing | unknown`
* `leadTimeCoverage: complete | partial | missing | unknown`

---

### 3.2 Dependency & Blast Radius Reality

**Question answered:**

> *What breaks if this product changes?*

**Owns:**

* Number of systems touching a product
* Coupling density
* Single-point-of-failure presence

**Does NOT:**

* Simulate failures
* Rank risk
* Advise architectural changes

**FT2 Exposure Pattern:**

* `dependencySurface: isolated | coupled | unknown`
* `blastRadius: contained | wide | unknown`

---

### 3.3 Data Freshness & Trust Latency Reality

**Question answered:**

> *Is this data still true right now?*

**Owns:**

* Last observed update per domain
* Sync coverage
* Staleness presence

**Does NOT:**

* Predict future freshness
* Explain delays
* Trigger syncs

**FT2 Exposure Pattern:**

* `dataFreshness: fresh | stale | unknown`
* `syncCoverage: complete | partial | missing | unknown`

---

### 3.4 Compliance & Policy Reality

**Question answered:**

> *Is this product allowed to exist as represented?*

**Owns:**

* Required attribute presence
* Policy coverage visibility
* Platform compliance signals

**Does NOT:**

* Provide legal advice
* Recommend remediation
* Interpret regulations

**FT2 Exposure Pattern:**

* `policyCoverage: compliant | gaps | unknown`

---

### 3.5 Lifecycle Presence Reality (Observational Only)

**Question answered:**

> *Is this product actually alive across systems?*

**Owns:**

* Cross-domain activity presence
* Dormancy observability
* Structural vs operational divergence

**Does NOT:**

* Change lifecycle state
* Recommend sunsetting
* Control activation

**FT2 Exposure Pattern:**

* `activityPresence: active | inactive | unknown`
* `crossDomainPresence: aligned | divergent | unknown`

---

### 3.6 Cross-Domain Alignment Reality (META-DOMAIN)

**Question answered:**

> *Do these product realities agree with each other?*

**Owns:**

* Agreement / disagreement signals between domains

**Does NOT:**

* Explain misalignment
* Rank severity
* Attribute causes

**FT2 Exposure Pattern:**

* `alignment: aligned | misaligned | unknown`

---

## 4. Domain Design Laws (Non-Negotiable)

All current and future product domains MUST:

1. Have a **single truth domain**
2. Implement **Facts → Intelligence → FTEP**
3. Collapse to `unknown` on missing facts
4. Expose **lossy, non-semantic signals only**
5. Never recommend, optimize, or explain
6. Never leak raw facts or intelligence
7. Remain independently testable

Violation of any rule invalidates FT2 compliance.

---

## 5. Why This Domain Map Matters

This structure ensures that:

* Products FT2 scales without semantic debt
* New domains add **clarity**, not noise
* Monetization lifts **constraints**, not truth
* SMBs gain certainty without manipulation

FT2 does not tell users what to do.
It makes **ignorance visible**.

---

## 🔒 STATUS: CANONICAL · FUTURE-SAFE

This document defines **all allowed product reality domains** for FT2.

Any new domain proposal requires:

* explicit truth ownership
* domain-level scans
* FT2 compliance review

No silent expansion permitted.