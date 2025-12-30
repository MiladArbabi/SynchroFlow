# 📘 `docs/blueprints/CnsModuleIntegration.md`

### **CNS ↔ Module Integration Contract (v1 LOCKED)**

**Version:** v1
**Status:** Mandatory for all modules
**Owners:** CNS Core Team, Module Leads
**Purpose:** Define how OrderNexus, SKU-OS, Specter, InsightCore, ReturnNexus, MarginCore, WMS-Lite, and Echo Hub must interact with the CNS Core.

---

# 0. Mission

This document standardizes how every module in LaSyncro:

1. **Provides signals to the CNS Core**, and
2. **Consumes CNS context** to adjust insights, severity, recommendations, or UI behavior.

> **No module is allowed to compute or override the merchant mode, burning priority, revenue band, or business stage internally.**
> The CNS Core is the single source of truth.

---

# 1. Terminology

* **CNS Core** – the central nervous system computing context and behavioral profiles.
* **CnsContextSnapshot** – the output context consumed by all modules.
* **Module Signals** – normalized inputs that modules emit to the CNS scoring engine.
* **Mode-Aware Behavior** – module logic adapting itself using CNS context.

---

# 2. CNS Context Contract (Imported by Modules)

All modules read a shared CNS context shape:

```ts
export interface CnsContextSnapshot {
  shopId: number;
  mode: 'survival' | 'growth' | 'architect';
  revenueBand: RevenueBand;
  stage: BusinessStage;
  burningPriority: BurningPriority;
  timeContext: 'realtime' | 'daily' | 'weekly' | 'monthly';
  updatedAt: string;
}
```

Modules must pull this snapshot via CNS Client SDK:

```ts
const context = await cnsClient.getContext(shopId);
```

Caching allowed for 5–30 seconds depending on module type.

---

# 3. Module Signal Contribution (What Modules Must Emit to CNS)

Each module must publish a minimal, normalized signal set for CNS scoring.

## 3.1 OrderNexus → CNS

**Purpose:** Profit stability, leakage severity, margin pattern recognition.

```ts
interface OrderNexusSignal {
  profitStabilityScore: number;     // 0–1
  leakageSeverityScore: number;     // 0–1
  fulfillmentCostVolatility: number;// 0–1
  revenueTrendScore: number;        // 0–1
}
```

**Emission frequency:**

* On ingestion,
* Hourly rollup.

---

## 3.2 SKU-OS → CNS

**Purpose:** Inventory health, stockout risk, overstock severity.

```ts
interface sku-osSignal {
  stockoutRiskScore: number;       // 0–1
  overstockSeverityScore: number;  // 0–1
  marginHealthScore: number;       // 0–1
}
```

**Emission frequency:**

* On each ProductHealth update (SKU-OS v1 contract),
* Daily rollup.

---

## 3.3 Specter → CNS

**Purpose:** Acquisition efficiency, conversion patterns, retention signals.

```ts
interface SpecterSignal {
  acquisitionDropScore: number;    // 0–1
  conversionVolatilityScore: number; // 0–1
  retentionDeclineScore: number;   // 0–1
}
```

**Emission frequency:**

* Every NudgeAnalyticsEvent aggregated hourly.

---

## 3.4 InsightCore → CNS

**Purpose:** Global insight consumption & time-to-value.

```ts
interface InsightCoreSignal {
  insightEngagementScore: number; // 0–1  (based on feedback)
  dashboardAbsorptionRate: number;// 0–1
}
```

---

## 3.5 Integration Gateway → CNS

**Purpose:** Operational maturity.

```ts
interface IntegrationSignal {
  platformCount: number;  // Shopify, Stripe, GA4, etc.
  syncHealthScore: number; // 0–1
}
```

---

## 3.6 ReturnNexus, MarginCore, ProblemCenter (optional v1)

Not required for mode scoring but may contribute in future versions.

---

# 4. Module Behavior Adaptation (How Modules Must Respond to CNS)

Every module must conform to the same rule:

> **Module computations remain constant. Interpretation must adapt to CNS context.**

Meaning:

* A profit leakage of $200 looks different in Survival mode (critical) than in Architect mode (informational).
* A stockout event suggests different actions depending on mode.
* A conversion drop yields different insight severity depending on burning priority.

---

# 4.1 OrderNexus Mode-Aware Behavior (LOCKED)

OrderNexus computes profit and leakage without knowing mode.
**But interpretation MUST depend on CNS mode.**

### Survival Mode

* Show **red severity** on leakage > $0.
* Provide **simple-level insights** (“You’re losing money here.”)
* Prioritize **cash-flow** suggestions.

### Growth Mode

* Show **orange severity** on leakage spikes.
* Provide **funnel-level insights** (“Increase AOV to offset this.”)

### Architect Mode

* Show **low severity** unless margin health crosses threshold.
* Provide **system recommendations** (workflow suggestions, playbooks).

---

# 4.2 SKU-OS Mode-Aware Behavior

### Survival

Keep messages extremely simple, e.g.:

> “You are about to stock out of 4 products.”

### Growth

Show opportunity framing:

> “Reorder these SKUs to maintain sales velocity.”

### Architect

Show systemic orchestration insights:

> “Generate a PO to stabilize forecasted demand.”

---

# 4.3 Specter Mode-Aware Behavior

Specter does NOT compute mode, but MUST read CNS context.

### Survival

* Recommend **simple retention wins**, not long-term tactics.

### Growth

* Recommend **acquisition optimization**.

### Architect

* Recommend **team workflows and audience automation**.

---

# 4.4 InsightCore Mode-Aware Behavior

Widgets must follow:

* **Tone changes** (C1: Context)
* **Causation depth** changes (C2)
* **Action type** changes (C3)
* **Frequency adjustment** based on feedback (C4)

---

# 5. CNS Feedback Requirements for All Modules

Every actionable module MUST implement:

```ts
function submitCnsFeedback(event: FeedbackEvent): Promise<void>;
```

With:

```ts
interface FeedbackEvent {
  insightId: string;
  action: 'accepted' | 'ignored' | 'dismissed';
  context?: { reason: 'not_relevant' | 'incorrect' | 'already_resolved' };
}
```

Modules must log feedback and forward to CNS Core.

---

# 6. Persistence Contracts (Locked)

### 6.1 `cns_signals` table

Stores the latest signal set per module per shop.

### 6.2 `cns_mode_history`

Tracks mode transitions.

### 6.3 `cns_feedback`

Stores insight-level feedback.

These tables are mandatory for cross-module consistency.

---

# 7. Versioning Rules

Any modification to:

* Signal structure
* Weighting
* Mode ranges
* Burning priority values
* How modules must react

Requires committing:

✔ `CnsModuleIntegration_v2.md`
✔ Database migration scripts
✔ Backward compatibility matrix

---

# 8. Summary

This contract forces:

1. **Uniform signal flow into CNS**
2. **Uniform context flow out of CNS**
3. **Unified behavior across modules**
4. **Single intelligent brain for the entire platform**

This ensures LaSyncro behaves as a **Central Nervous System**, not a disconnected ecosystem of dashboards.

---
