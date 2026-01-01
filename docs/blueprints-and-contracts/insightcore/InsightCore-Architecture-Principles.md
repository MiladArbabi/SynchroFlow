## **Document 2: InsightCore-Architecture-Principles.md**

```markdown
# InsightCore – Architecture Principles & Boundaries

## **Role in LaSyncro CNS**

* **Module Name:** InsightCore – Analytics & Metrics
* **Role:** CNS **cortex** for:
  * Canonical business metrics (profit, margin, stockout risk, etc.)
  * Cross-module analytics (products × orders × customers × cost models × returns)
  * Dashboards & data access (read-only)

## **Core Architecture Principles**

### **1. Read-Only Observer Principle**
InsightCore **never recomputes or second-guesses** domain logic from other modules. It observes canonical signals and correlates them without mutation.

### **2. Single Source of Truth**
InsightCore is the **"single source of truth"** for metrics, analytics events, and dashboards across LaSyncro – powered by other modules' intelligence.

### **3. Non-Invasive Integration**
InsightCore ingests structured events from other modules without requiring changes to their core logic or data models.

### **4. Versioned Contracts**
All changes to locked types or interfaces require:
- A versioned contract (`v2`, `v3`, etc.)
- A data/API migration plan
- No ad-hoc edits allowed

## **Ownership Boundaries**

### **InsightCore OWNS:**

#### **Analytics Primitives (No other module may implement these):**

**Structural Primitives:**
- `order_count`
- `product_count`
- `sku_breadth`
- `catalog_depth`

**Temporal Primitives:**
- `moving_average`
- `delta`
- `volatility`
- `lag`

**Relationship Primitives (v1):**
- `correlation(x, y)`
- `relative_contribution(x → outcome)`

**Driver Primitives (v2):**
- `driver_weight`
- `driver_rank`
- `driver_saturation`
- `cross_module_impact`

**System Primitives (v3):**
- `business_state_vector`
- `anomaly_score`
- `simulation_effect`

#### **Registry & Definitions:**
- **Metric & dimension registry** (canonical definitions)
- **Metric versioning and lineage** (audit trail for KPI calculations)

#### **Ingestion & Processing:**
- **Analytics ingestion & normalization** from all modules
- **Warehouse schema** (fact tables, dimension tables)
- **Query Engine** execution

#### **Intelligence Layer:**
- **Driver interpretation** (v1 lightweight)
- **Dashboard delivery** with readiness signals
- **Readiness computation** for analytics only

### **InsightCore DOES NOT OWN:**

* **Order-level profitability computation** → **OrderNexus**
* **Cost models, financial policy, recomputation rules** → **MarginCore**
* **Customer behavior & signals** → **Specter**
* **SKU-level inventory health & playbooks** → **SKU OS**
* **Return decisions, refund logic** → **ReturnNexus**
* **Fulfillment, workflows, tasks** → **WMS Lite**, **Echo Hub**
* **Operational decisions** (no "change price", "auto-reorder", "send email")

**Architectural Violation:** If InsightCore starts mutating other modules' state or recomputing profit, returns, or product health, you've broken the architecture.

## **Clear Path Actions (InsightCore → Action Surface)**

InsightCore is read-only and MUST NOT execute fixes. Its job is to map insights to the owning module and present a precise, prioritized action path.

### **Rules for Action Recommendations:**

1. **Recommendation Only:** InsightCore only recommends actions
2. **Complete Action Specification:** All actions must include:
   - `targetModule`: One of 'order-nexus' | 'sku-os' | 'specter' | 'return-nexus' | 'wms-lite' | 'problem-center'
   - `actionId`: String (canonical action identifier owned by the target module)
   - `rationale`: Short human-readable explanation (1–2 sentences)
   - `urgency`: 'survival' | 'growth' | 'architect'
   - `expectedImpactEstimate`: Optional numeric estimate (percent or absolute)
   - `evidence`: Array of pointers to drivers and metrics

3. **Ranked Presentation:** Actions are ranked by `driver_weight × expected_impact_estimate × confidence`

4. **No State Changes:** InsightCore must not perform actions or change state in other modules

### **Clear Path Schema:**

```typescript
export interface InsightActionRecommendation {
  id: string; // insightcore:uuid
  shopId: number;
  targetModule: 'order-nexus' | 'sku-os' | 'specter' | 'return-nexus' | 'wms-lite' | 'problem-center';
  actionId: string; // e.g. 'fix_missing_cost', 'create_reorder_protect', 'review_bleed_feed'
  title: string;
  rationale: string;
  urgency: 'survival' | 'growth' | 'architect';
  expectedImpactEstimate?: number;
  confidence: 'low' | 'medium' | 'high';
  evidence: string[]; // human-readable short evidences
  context: Record<string, any>; // deep-link context
  recommendedAt: string; // ISO
}
```

### **UX Implementation:**

* **Survival-level recommendations:** Surface as primary CTAs in dashboards
* **Growth-level recommendations:** Surface in Growth pane as experiments
* **Architect-level recommendations:** Option to create Problem Center tasks

### **Observability & Audit:**
- Each `InsightActionRecommendation` is logged immutably
- Traceable to metric versions used when generated
- Emits `InsightActionRecommended` event (read-only) for audit/automation

## **Closed-Loop Learning System**

InsightCore is not passive—it measures whether recommendations change outcomes and uses this signal to improve future recommendations.

### **Outcome Tracking Contract:**

```typescript
export type InsightActionOutcomeStatus = 'executed' | 'partially_executed' | 'ignored' | 'failed';

export interface InsightActionOutcome {
  recommendationId: string; // InsightActionRecommendation.id
  shopId: number;
  reportedByModule?: 'order-nexus' | 'sku-os' | 'specter' | 'return-nexus' | 'wms-lite' | 'ui';
  status: InsightActionOutcomeStatus;
  executedAt?: string; // ISO
  outcomeSummary?: string; // human short summary
  measuredMetricDeltas?: Record<string, number>; // e.g. { "net_profit": -12.3, "stockout_rate": -0.12 }
  evidenceWindow?: { from: string; to: string }; // timeframe for measured deltas
  reportedAt: string; // ISO
}
```

### **Learning Mechanism:**

1. **Measurement:** Evaluate `measuredMetricDeltas` against original outcome metrics
2. **Attribution (v1 lightweight):** Time-windowed comparison + trend heuristics
3. **Confidence Scoring:** Store attribution confidence: 'low'|'medium'|'high'
4. **Learning Updates (v2):** Update `driver_weight` and `confidence` based on evidence
5. **Versioned Learning:** All learning updates are versioned and auditable

### **Data Flow & Privacy:**
- `InsightActionOutcome` events are optional
- If not provided, InsightCore measures using raw events (lower confidence)
- **Never persist PCD:** Exclude raw customer identifiers from context

### **Observability Metrics:**
- `insightcore.recommendations_issued_total`
- `insightcore.recommendation_outcomes_reported_total`
- `insightcore.recommendation_success_rate`
- `insightcore.time_to_outcome_ms` (histogram)

### **Audit Trail:**
- Each recommendation and outcome is discoverable in read-only audit trail
- UI surfaces outcome status, measured deltas, and attribution confidence

## **Evolutionary Architecture**

### **v1 (FT0–FT1) – Foundational Intelligence:**
- Event ingestion + warehouse schema
- Baseline metrics (orders, products, returns, nudges, health)
- Simple correlations across modules
- "Top Driver This Week" heuristic
- Dashboard delivery and readiness signals

### **v2 – CNS Driver Engine:**
- Cross-module driver weights
- Driver ranking and contribution scoring
- Business fingerprinting
- Weekly "What Changed and Why" narratives

### **v3 – Predictive CNS Cortex:**
- Scenario simulation ("what if" engine)
- Predictive driver shifts
- Intervention recommendations
- Closed-loop learning based on merchant actions

## **Architectural Integrity Check**

**If you find InsightCore:**
1. Computing profit instead of ingesting from OrderNexus → **VIOLATION**
2. Changing prices or inventory levels → **VIOLATION**
3. Creating its own cost models → **VIOLATION**
4. Making return decisions → **VIOLATION**
5. Modifying customer data → **VIOLATION**

**Correct Pattern:** InsightCore observes, correlates, explains, and routes—it never operates.

This architectural discipline ensures InsightCore remains the trusted "business explanation engine" rather than becoming another operational system with conflicting logic.