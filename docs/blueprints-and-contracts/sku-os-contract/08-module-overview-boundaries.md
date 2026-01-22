# `08-module-overview-boundaries.md`

## SKU OS — Product Health & Inventory Intelligence (CNS Module Blueprint v1.1)

### Mission Statement
> **Mission:** Serve as the CNS layer responsible for *product-level health, risk detection, and attention prioritization*, powered by normalized demand, returns-quality, and issue-quality signals.

---

### Version Information
**Document Version:** 1.1  
**Status:** Locked Contract  
**Effective Date:** Upon Publication

### Scope & Purpose
This document defines the **locked v1.1 contract** between:

| Module | Responsibility |
|--------|---------------|
| **SKU OS** | Product health engine |
| **OrderNexus** | Demand & returns-rate signals |
| **ReturnNexus** | Returns-quality truth |
| **ProblemCenter** | Canonical warehouse issue model |
| **InsightCore** | Analytics propagation |
| **WMS Lite** | Optional read-only context |

### Contract Stability
Any change to locked interfaces requires:
1. Creating `SKU-OS_v2.md` document
2. Formal migration plan
3. Version bump in InsightCore compatibility matrix
4. Cross-module coordination

---

## Role, Mission & Module Boundaries

### 0.1 Role in the CNS Architecture

#### Module Identification
- **Module ID:** `sku-os`
- **Module Layer:** CNS Intelligence → Inventory Domain
- **Dependencies:** OrderNexus, ReturnNexus, ProblemCenter, InsightCore
- **Optional Dependencies:** WMS Lite

#### Core Purpose
Answer the critical merchant questions:

> "Which products need attention today?"
> "Why are they at risk?"
> "What should I do next?"

#### Capabilities Provided
1. **Product Health Scores** (0–100 composite rating)
2. **Stockout Risk** (0–1 probability)
3. **Returns & Defect Risk Integrations** (via upstream modules)
4. **Attention Rankings & Reasoning** (prioritized action list)
5. **Upstream Analytics Events** (for InsightCore consumption)

### 0.2 SKU OS *Owns* (v1.1)

#### Primary Responsibilities

##### 1. Product Health Intelligence
- **Scoring Engine:** Complete implementation of health scoring algorithms
- **HealthScore Decomposition:** Breakdown of composite score into components
- **Confidence Rules:** Determination of calculation reliability
- **Degradation Model:** Framework for health deterioration over time

##### 2. Degradation Mapping Logic (Locked)
- **Deterministic Mapping:** From upstream signals to health impact
- **Input Sources:**
  - Return quality (`InspectionResult × IssueRootCause`)
  - Warehouse issues (`IssueType × IssueSeverity`)
- **Version Control:** Controlled evolution under explicit versioning

##### 3. Product Attention API
- **Ranking Algorithm:** Prioritization of at-risk products
- **Attention Reasons:** Clear explanation for prioritization
- **Confidence Summary:** Aggregated reliability metrics
- **Empty-state Semantics:** Behavior when no products are at risk

##### 4. ProductHealthAnalyticsEvent
- **Sole Producer:** SKU-OS is the *only* producer of this analytics signal
- **Contract Compliance:** Must emit exactly the specified format
- **Delivery Guarantees:** Must meet SLA requirements

### 0.3 SKU OS *Does NOT Own* (v1.1)

#### Strict Boundaries - Read-Only Consumption

SKU OS consumes — but **NEVER reinterprets** — the following domains:

| Domain | Owner | SKU OS Rule |
|--------|-------|-------------|
| **Order profitability** | OrderNexus | MUST NOT recompute or override |
| **Returns lifecycle/decisions** | ReturnNexus | MUST treat quality enums as canonical |
| **Warehouse operations & inventory ledger** | WMS Lite | Read-only; does not mutate stock |
| **Warehouse issue detection** | ProblemCenter | MUST consume canonical issue taxonomy |
| **Customer intent, cohorts, or LTV** | Specter | MUST NOT infer customer attributes |
| **Global analytics warehouse** | InsightCore | Only publishes analytics events |

#### Boundary Enforcement Rules

##### Primary Rule
> SKU OS decides *"Product X is at risk and here's why"* using standardized degradation tables.
> 
> SKU OS MUST NOT invent alternative root-cause mappings or its own version of returns or issue taxonomies.

##### Implementation Constraints
1. **No Reinterpretation:** Consume signals as-is
2. **No Override:** Respect upstream module ownership
3. **No Inference:** Avoid deriving secondary meanings
4. **No Mutation:** Never modify source data

### 0.4 Module Integration Matrix

#### Data Flow Direction
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ OrderNexus  │────▶│   SKU OS    │────▶│ InsightCore │
│   (Demand)  │     │ (Health)    │     │ (Analytics) │
└─────────────┘    └─────────────┘    └─────────────┘
        ▲                   ▲                   ▲
        │                   │                   │
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ReturnNexus  │────┘             └────┘   WMS Lite │
│ (Quality)   │                                 (RO)│
└─────────────┘                                    │
        ▲                                          │
        │                                          │
┌─────────────┐                             ┌─────────────┐
│ProblemCenter│                             │   Specter   │
│  (Issues)   │                             │(Customer)   │
└─────────────┘                             └─────────────┘
```

#### Signal Processing Layers
```typescript
interface SKUOSProcessingLayer {
  // Layer 1: Signal Ingestion (Read-Only)
  ingestDemand(signal: DemandSignal): void;
  ingestReturns(signal: ReturnsSignal): void;
  ingestIssues(signal: IssueSignal): void;
  
  // Layer 2: Canonical Mapping (Locked)
  applyDegradationMappings(): DegradationEffect;
  
  // Layer 3: Health Computation (Owned)
  computeHealthScore(): HealthSnapshot;
  
  // Layer 4: Output Generation (Contractual)
  emitAnalyticsEvent(): ProductHealthAnalyticsEvent;
  generateAttentionList(): ProductAttention[];
}
```

### 0.5 Error Handling & Boundary Violations

#### Detection Mechanisms
1. **Schema Validation:** Verify incoming signals match expected formats
2. **Ownership Checks:** Ensure no mutation of upstream data
3. **Taxonomy Compliance:** Validate against canonical enums
4. **Cross-Module Auditing:** Log all boundary interactions

#### Violation Responses
```typescript
enum BoundaryViolation {
  UNKNOWN_ENUM = "Received enum value not in canonical set",
  DATA_MUTATION = "Attempted to modify upstream data",
  SIGNAL_OVERRIDE = "Attempted to reinterpret upstream signal",
  OWNERSHIP_ENCROACHMENT = "Performed action owned by another module"
}

function handleBoundaryViolation(violation: BoundaryViolation): void {
  // 1. Log violation with full context
  // 2. Raise alert to monitoring system
  // 3. Fall back to safe default behavior
  // 4. Increment violation counter for metrics
}
```

### 0.6 Module Evolution Path

#### Versioning Strategy
1. **Patch Releases (v1.1.x):** Bug fixes, performance improvements
2. **Minor Releases (v1.x):** Internal algorithm improvements
3. **Major Releases (v2.x):** Contract changes requiring migration

#### Upgrade Requirements
Major version upgrades require:
1. **New Contract Document:** `SKU-OS_v2.md`
2. **Migration Toolkit:** Data transformation utilities
3. **Compatibility Layer:** Graceful degradation during transition
4. **Rollback Capability:** Ability to revert to previous version

### 0.7 Key Performance Indicators (KPIs)

#### Module Health Metrics
| Metric | Target | Measurement |
|--------|--------|-------------|
| **Signal Processing Latency** | < 2 minutes | Time from event → health update |
| **Calculation Accuracy** | > 95% | Agreement with manual assessment |
| **Uptime** | 99.9% | Module availability |
| **Boundary Violations** | 0 | Number of ownership violations |

#### Business Impact Metrics
| Metric | Target | Purpose |
|--------|--------|---------|
| **Stockout Prevention** | > 20% reduction | Measure risk mitigation |
| **Attention-to-Action Rate** | > 40% | Measure usability |
| **False Positive Rate** | < 5% | Measure accuracy |
| **Merchant Satisfaction** | > 4/5 | Measure value delivery |

### 0.8 Compliance Checklist

#### Required for v1.1 Compliance
- [ ] Respects all module ownership boundaries
- [ ] Uses only canonical degradation mappings
- [ ] Never mutates upstream data
- [ ] Emits exactly the specified analytics event format
- [ ] Processes all signals within SLA requirements
- [ ] Provides clear attention rankings
- [ ] Handles empty states appropriately
- [ ] Supports free-tier gating requirements

#### Verification Methods
1. **Automated Testing:** Unit tests for boundary compliance
2. **Integration Testing:** Cross-module scenario validation
3. **Audit Logs:** Record of all module interactions
4. **Monitoring Alerts:** Real-time violation detection

---