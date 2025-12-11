# LaSyncro CNS Core – Central Nervous System Engine Blueprint (v1 LOCKED)

**Version:** v1 (LOCKED)  
**Status:** Canonical Architecture Contract  
**Owners:** CNS Architecture, OrderNexus, SKU-OS, InsightCore, Specter  
**Purpose:** Define the single, unified intelligence layer for interpreting commerce operations across all modules.

---

## 0. Mission

LaSyncro's CNS Core is the **interpretation brain** of the platform.

> **It transforms raw operational signals into an adaptive, contextual, personalized system experience.**

The CNS Core computes:

* **Merchant Maturity Mode (Survival → Growth → Architect)**
* **Burning Priority** (current operational risk/opportunity)
* **Revenue Band classification**
* **Business Stage** (UI styling tone)
* **CNS Context Snapshot** (system-wide interpretation layer)

This context becomes the **lens** through which every widget, insight, banner, alert, and automation behaves.

**Nothing in LaSyncro (widgets, modules, insights) is allowed to "guess the mode" or bypass CNS context.**

---

## 1. CNS Core Responsibilities (What It OWNS)

### The CNS Core OWNS:

1. **Behavior Mode Classification**
2. **Operational Risk Prioritization (Burning Priority)**
3. **Scale Calibration (Revenue Band)**
4. **Business Stage UI Context**
5. **Emitting the CnsContextSnapshot**
6. **Historical Mode Tracking (`cns_mode_history`)**
7. **Versioning of CNS contracts**

### The CNS Core DOES NOT OWN:

* Profit computation → **OrderNexus**
* Inventory health scoring → **SKU-OS**
* Customer/Intent scoring → **Specter**
* Insight rendering → **InsightCore**
* Workflow execution → **Echo Hub**
* Data ingestion → **Integration Gateway**
* Product health → **SKU-OS**
* Return lifecycle → **ReturnNexus**

CNS Core does **interpretation, not computation.**

---

## 2. CNS Signal Graph (Modules → CNS → Output)

The CNS Core receives **normalized signals** from 5 contributing modules:

```
OrderNexus  ─┐
SKU-OS      ─┤
Specter     ─┤──►  CNS Core  ───►  CnsContextSnapshot
InsightCore ─┤
Integrations─┘
```

Each contributes its part:

### **OrderNexus**
* Revenue stability
* Leakage index
* Margin volatility
* Cost-to-serve score

### **SKU-OS**
* Inventory health composite score
* Stockout risk
* Margin health by SKU

### **Specter**
* Acquisition efficiency
* Retention stability
* Conversion funnel health

### **Integrations**
* Platform connections
* Sync health
* Merchant operational maturity

### **InsightCore**
* Aggregated widget metrics
* Trending severity levels

---

## 3. CNS Scoring Model (v1 LOCKED)

The CNS Core uses a **scoring matrix** to compute:

### **MerchantMaturityMode**
```typescript
export type MerchantMaturityMode = 'survival' | 'growth' | 'architect';
```

### **Burning Priority**
```typescript
'burningPriority' ∈ 
  'cash-flow' | 'inventory' | 'acquisition' | 'retention' | 'profitability' | 'none';
```

### **Revenue Band**
(Scale context; does not affect behavior)

### **Business Stage**
(Styling tier derived from mode)

---

## 4. Merchant Mode Decision Engine (v1)

### 4.1 Input Scoring Table

| Module       | Metric                   | Meaning                        | Weight |
| ------------ | ------------------------ | ------------------------------ | ------ |
| OrderNexus   | Profit Stability         | How chaotic net profit is      | ★★★★★  |
| SKU-OS       | Inventory Stability      | Avoiding stockouts, oversupply | ★★★★☆  |
| Specter      | Conversion Stability     | Healthy acquisition/retention  | ★★★☆☆  |
| Integrations | Operational Completeness | Systems hooked up              | ★★☆☆☆  |
| InsightCore  | Time-to-Value Signals    | Insights being absorbed        | ★☆☆☆☆  |

### 4.2 Scoring Formula (locked)
```typescript
modeScore = 
  (profitStability * 0.40) +
  (inventoryStability * 0.25) +
  (conversionStability * 0.20) +
  (integrationMaturity * 0.10) +
  (insightEngagement * 0.05);
```

### 4.3 Scoring Ranges
```typescript
if score < 0.45 → 'survival'
else if score < 0.75 → 'growth'
else → 'architect'
```

### 4.4 Stability Hysteresis (locked)

Transition requires:
* **≥14 days** above threshold for upgrades
* **≥14 days** below threshold for downgrades
* Sudden spikes do not cause flips

Reason: Avoid oscillation ("flapping").

---

## 5. Burning Priority Decision Engine

Burning Priority helps the CNS decide *what matters today*.

### Priorities (v1 locked)
```typescript
type BurningPriority =
  'cash-flow' |
  'inventory' |
  'acquisition' |
  'retention' |
  'profitability' |
  'none';
```

### Selection Rules (v1)

Priority chosen by the **highest severity**:
```typescript
priority = max([
  leakageSeverity,
  stockoutRisk,
  conversionDrop,
  churnSpike,
  negativeMarginRun,
  none
])
```

Severity is normalized (0–1).

Example:
* If conversion dropped 40% → burningPriority = 'acquisition'
* If inventory hit critical → 'inventory'
* If profit leakage spike → 'profitability'

---

## 6. Revenue Band Classification (Scale Context)

RevenueBand is technical formatting and scaling:
```typescript
'0-100k' | '100k-1m' | '1m-5m' | '5m-10m' | '10m+'
```

Derived from:
* Trailing 12-month revenue
* Fallback: last 90-day revenue * 4

Revenue band affects:
* Chart formatting
* Thresholds (what counts as "large")
* Widget layout density

Revenue band **never changes behavior logic**.

---

## 7. Business Stage Derivation (UI Styling)

Derived from Merchant Mode:

| Mode      | Stage           | UI Tone              |
| --------- | --------------- | -------------------- |
| survival  | survival-stage  | urgent, protective   |
| growth    | growth-stage    | opportunity-driven   |
| architect | architect-stage | systemic, analytical |

Enterprise customers may override to `enterprise-stage`.

---

## 8. CNS Context Snapshot (System Output)

```typescript
export interface CnsContextSnapshot {
  shopId: number;

  mode: MerchantMaturityMode;     // behavioral
  revenueBand: RevenueBand;       // scale
  stage: BusinessStage;           // UI tone
  burningPriority: BurningPriority;
  timeContext: 'realtime' | 'daily' | 'weekly' | 'monthly';

  updatedAt: string; // ISO
}
```

### Usage Rules (LOCKED)
1. Widgets MUST accept this snapshot.
2. Modules MUST NOT recompute mode internally.
3. Insight phrasing MUST depend on mode + burning priority.
4. Layout engine MUST reorder widgets based on burning priority.

---

## 9. CNS Feedback Loop (Phase 1)

CNS logs:
* Ignored insights
* Accepted insights
* Dismissed recommendations

```typescript
interface FeedbackEvent {
  insightId: string;
  action: 'accepted' | 'ignored' | 'dismissed';
  context?: {
    reason: 'not_relevant' | 'incorrect' | 'already_resolved';
  };
}
```

This data feeds into:
* Mode scoring
* Severity tuning
* Insight frequency dampening

Locked requirement:
**CNS must store feedback but must not perform predictive weighting (until v2).**

---

## 10. Contract Versioning (Locked)

Any change to:
* Formula
* Thresholds
* Mode labels
* Burning priority set
* CnsContextSnapshot structure

Requires:
1. **CnsCore_v2.md**
2. Migration scripts for:
   * `cns_mode_history`
   * `cns_feedback`
3. Mapping table for backward compatibility

---

## 11. Developer Obligations (MUST / MUST NOT)

### MUST:
* Use CNS context in every widget
* Use burning priority for insight severity
* Submit feedback events
* Treat mode as truth

### MUST NOT:
* Infer mode from revenue alone
* Hardcode severity levels
* Display uncontextualized metrics
* Skip Closed Loop feedback

---

## 12. Summary

The CNS Core is the **brain** that:
1. Reads signals
2. Computes mode
3. Determines what matters
4. Emits adaptive context
5. Powers every widget, banner, insight, and automation

This blueprint makes LaSyncro not a dashboard — but a **living nervous system** that adapts to the business.

---