# LaSyncro CNS – Merchant Modes & Unified CNS Context Contract

**Version:** v1 (LOCKED)  
**Status:** Approved Architectural Contract  
**Scope:** Platform-wide (ALL Modules)  
**Owners:** CNS Architecture / InsightCore / OrderNexus / SKU-OS / Specter

---

## 0. Purpose

This blueprint defines the canonical behavioral and contextual model used by LaSyncro’s CNS (Central Nervous System).

It codifies:

* Merchant Maturity Modes (Survival → Growth → Architect)
* Revenue Band Classification (Scale Context)
* Business Stage (UI Styling Context)
* CNS Business Context Contract shared by all modules
* CNS Context Snapshot emitted by the system
* Rules for mode progression and contextual governance

These constructs are shared, locked system primitives.  
No module may redefine or reinterpret them without a versioned upgrade (v2).

---

## 1. Merchant Maturity Mode

*(Behavior Classification – CNS responsibility)*

This expresses how the business behaves, not what plan they're on and not what number of employees they have.  
This is the backbone of LaSyncro’s adaptive interpretation layer.

```typescript
export type MerchantMaturityMode =
  | 'survival'
  | 'growth'
  | 'architect';
```

### 1.1 Behavioral Summary

**Survival Mode**

* Firefighting operations
* Cash-flow stress
* Volatile demand
* Immature operational systems
* **CNS Priority:** reduce cognitive load & prevent disaster

**Growth Mode**

* Demand increasing
* More channels performing
* Consistent retention / CAC balance
* **CNS Priority:** amplify leverage, surface opportunities

**Architect Mode**

* Stable profitable engine
* Operational workflows
* Team structure or automation in place
* **CNS Priority:** optimize systems, automate execution, minimize inefficiencies

---

## 2. Revenue Band

*(Scale Context – determines formatting & sensitivity)*

This is NOT a behavioral mode.  
It ensures widgets, thresholds, numbers, and risk models scale correctly.

```typescript
export type RevenueBand =
  | '0-100k'
  | '100k-1m'
  | '1m-5m'
  | '5m-10m'
  | '10m+';
```

**Used for:**

* formatting (currency precision, abbreviations)
* sensitivity of thresholds (e.g., what counts as “large loss”)
* severity scaling in insights
* deciding density of widget layouts

---

## 3. Business Stage

*(UI Styling Context – Appearance Layer)*

This governs presentation, tone, and visual semantics:

```typescript
export type BusinessStage =
  | 'survival-stage'
  | 'growth-stage'
  | 'architect-stage'
  | 'enterprise-stage';
```

**Examples:**

* **Survival-stage** → red/orange urgency semantics
* **Growth-stage** → blue/green opportunity semantics
* **Architect-stage** → neutral/systemic semantics

---

## 4. Unified CNS Business Context Contract

*(Injected into ALL widgets, insights, modules)*

This is the root object used by the CNS to tune interpretation, severity, and actionability.

```typescript
export interface CnsBusinessContext {
  // Behavioral mode (CNS-inferred)
  mode: MerchantMaturityMode;

  // Scale calibration
  revenueBand: RevenueBand;

  // UI styling context
  stage: BusinessStage;

  // Current top operational risk or leverage point
  burningPriority:
    | 'cash-flow'
    | 'inventory'
    | 'acquisition'
    | 'retention'
    | 'profitability'
    | 'none';

  // How the CNS frames the temporal narrative for insights
  timeContext: 'realtime' | 'daily' | 'weekly' | 'monthly';
}
```

Widgets MUST accept this object.  
Modules MUST NOT override or mutate it.

---

## 5. CNS Context Snapshot (Emitted System Context)

This snapshot is what all modules subscribe to, and what the frontend receives to render adaptive widgets.

```typescript
export interface CnsContextSnapshot {
  shopId: number;
  mode: MerchantMaturityMode;
  revenueBand: RevenueBand;
  stage: BusinessStage;
  burningPriority: CnsBusinessContext['burningPriority'];
  timeContext: CnsBusinessContext['timeContext'];
  updatedAt: string; // ISO
}
```

**Rules:**

* CNS alone computes `mode`
* CNS alone computes `burningPriority`
* `stage` is derived from `mode` unless enterprise rules override
* All modules treat this snapshot as READ-ONLY truth

---

## 6. Mode Advancement Logic (Hysteresis-Based)

To avoid oscillation and instability, mode advancement is sticky and evidence-based.

**Locked v1 rules:**

1. Merchant must satisfy the next-mode criteria for **≥14 consecutive days**
2. A single negative spike cannot downgrade mode
3. User override (if enabled in UI later) has highest weight but decays over 30 days
4. CNS logs all transitions in `cns_mode_history`

---

## 7. Module Responsibilities (Consumers)

### 7.1 OrderNexus

* **Inputs:**
  * Profit stability
  * Leakage rates
  * Cost-to-serve
* **Outputs to CNS:**
  * Profitability variation scores
  * Stability indicators

### 7.2 SKU-OS

* **Inputs:**
  * Inventory health
  * Stockout risk
  * Margin health per product
* **Outputs to CNS:**
  * Inventory risk severity → influences `burningPriority`

### 7.3 Specter

* **Inputs:**
  * Consumer conversion
  * Session behavior trends
* **Outputs:**
  * Acquisition / Retention signals → influence `burningPriority`

### 7.4 InsightCore

* **Consumes:** Entire `CnsBusinessContext`
* **Must** change phrasing, severity, and depth of explanation based on `mode`

---

## 8. Widget Contract (UI Layer – Required Standard)

All widgets **MUST**:

1. Accept a CNS context object
2. Change semantics accordingly
3. Opt-in to “lens control UI” (not mode override)

**Example:**

```jsx
<ProfitLeakageWidget
  data={...}
  context={cnsContext}
/>
```

---

## 9. Error Prevention (Locked Guardrails)

1. No module may infer mode independently
2. No widget may override the system mode
3. `RevenueBand` MUST NOT influence business logic, only presentation
4. Insight phrasing MUST reflect `mode` and `burningPriority`

---

## 10. Versioning Declaration

Any conceptual change to:

* `MerchantMaturityMode`
* `RevenueBand`
* `BusinessStage`
* `CnsBusinessContext`
* `CnsContextSnapshot`

**Requires:**

1. `MerchantModesAndCnsContext_v2.md`
2. Migration plan
3. CNS backward compatibility mapping

---

✅ **END OF DOCUMENT (LOCKED v1)**
