## **Document 3: InsightCore-External-Contracts.md**

```markdown
# InsightCore – External Contracts & APIs

## **Contract Stability & Versioning**

> **Warning:** These are **locked contracts** for v1. Any changes require:
> - A versioned contract (`v2`, `v3`, etc.)
> - A data/API migration plan
> - No ad-hoc edits

All references to *"Analytics Core"* in other module blueprints map to **InsightCore**.

## **1. Inbound Analytics Events**

### **1.1 From OrderNexus → InsightCore**

```typescript
// LOCKED – from order-nexus/src/contracts/analytics-contract.ts

export type ProfitStatus = 'HEALTHY' | 'AT_RISK' | 'UNPROFITABLE';

export interface OrderAnalyticsEvent {
  shopId: number;
  orderId: string;
  orderDate: string;       // ISO
  revenue: number;
  netProfit: number;
  marginPercent: number;
  profitStatus: ProfitStatus;
  customerProfitTier: string | null;
  channel: string | null;
}
```

**Rule:** InsightCore **must not** reinterpret or recompute `netProfit` or `marginPercent`.

### **1.2 From Specter → InsightCore (Nudges)**

```typescript
// LOCKED – specter → insight-core

export interface NudgeAnalyticsEvent {
  shopId: number;
  sessionId: string;
  nudgeType: 'REMINDER';       // v1
  offerType: 'NONE';           // v1
  messageKey: string;
  displayedAt: string;         // ISO
  clicked: boolean;
  convertedToOrder: boolean;
  orderId?: string;
}
```

### **1.3 From SKU OS → InsightCore (Product Health)**

```typescript
// LOCKED – sku-os → insight-core

export interface ProductHealthAnalyticsEvent {
  shopId: number;
  productId: number;
  healthScore: number;          // 0–100
  stockoutRisk: number;         // 0–1
  marginHealth: 'healthy' | 'at_risk' | 'critical' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
  recalculatedAt: string;       // ISO
}
```

### **1.4 From MarginCore → InsightCore (Cost Models)**

```typescript
// LOCKED – margincore → insight-core

export interface CostModelAnalyticsEvent {
  shopId: number;
  costModelVersionId: string;   // CostModelVersioning.versionId
  source: 'finance' | 'local';
  activatedAt: string;          // ISO
  recomputationScope: 'none' | 'new_orders_only' | 'all_orders_since';
  recomputationSince?: string;  // ISO when applicable
}
```

### **1.5 From ReturnNexus → InsightCore (Returns & Quality)**

```typescript
// LOCKED – return-nexus → insight-core

import {
  ReturnReasonCategory,
  InspectionResult,
  IssueRootCause
} from '@lasyncro/shared/contracts/returns-quality-contract';

export interface ReturnAnalyticsEvent {
  shopId: number;
  returnId: string;
  orderId: string;
  productId: string;
  quantity: number;

  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;

  refundAmount: number;  // for this product line
  currency: string;
  restockable: boolean;

  processedAt: string;   // ISO – when the return was financially closed
}
```

#### **Rules for Returns & Quality Analytics:**
- InsightCore **must not**:
  - Re-map `reasonCategory` into new categories
  - Merge or split `InspectionResult` values
  - Re-label `IssueRootCause`
  - Re-derive `restockable`

- These fields must be treated as **opaque enums** from the shared `returns-quality-contract`
- Any conceptual grouping (chart buckets) must be done purely at presentation layer
- No new enum values or alternative category systems may be persisted

## **2. Public Query Contract**

```typescript
// LOCKED – public API contract for insight-core

export type TimeGrain = 'day' | 'week' | 'month';

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'between';

export interface AnalyticsFilter {
  dimension: string;             // registered DimensionDefinition.id
  operator: FilterOperator;
  value: any | any[];            // semantics depend on dimension type
}

export interface AnalyticsTimeRange {
  from: string;                  // ISO
  to: string;                    // ISO
  grain: TimeGrain;
}

export interface AnalyticsQuery {
  shopId: number;
  metrics: string[];             // MetricDefinition.id[]
  dimensions?: string[];         // DimensionDefinition.id[]
  filters?: AnalyticsFilter[];
  timeRange: AnalyticsTimeRange;
  limit?: number;
  orderBy?: { metric: string; direction: 'asc' | 'desc' }[];
}

export interface AnalyticsRow {
  dimensions: Record<string, string | number | null>;
  metrics: Record<string, number | null>;
}

export interface AnalyticsQueryResult {
  rows: AnalyticsRow[];
  meta: {
    queryId: string;
    generatedAt: string;         // ISO
    metricVersions: Record<string, string>; // metricId -> MetricDefinition.versionId
  };
}
```

## **3. Metric & Dimension Registry Contract**

```typescript
// LOCKED – internal & external (read-only) registry contract

export type MetricAggregation =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'
  | 'distinct_count';

export type MetricUnit = 'currency' | 'percent' | 'count' | 'ratio' | 'days';

export interface MetricDefinition {
  id: string;                     // 'net_profit', 'margin_percent_avg'
  versionId: string;              // 'metrics:2025-01-10T12:00:00Z'
  name: string;
  description: string;
  sourceTable: string;            // e.g. 'fact_orders', 'fact_nudges', 'fact_returns'
  expression: string;             // e.g. 'sum(net_profit)'
  aggregation: MetricAggregation;
  unit: MetricUnit;
  createdAt: string;              // ISO
  deprecatedAt?: string;          // ISO
}

export type DimensionDataType = 'string' | 'number' | 'date' | 'enum';

export interface DimensionDefinition {
  id: string;                     // 'channel', 'product_id', 'return_reason_category'
  name: string;
  description: string;
  dataType: DimensionDataType;
  sourceTable: string;            // 'fact_orders', 'dim_products', 'fact_returns', etc.
  column: string;                 // physical column name
  createdAt: string;              // ISO
}
```

#### **Registry Rules:**
- Exposed read-only via `/metrics` and `/dimensions` endpoints
- Old metric definitions are **immutable**
- New logic requires new `versionId` (and possibly new `id`)

## **4. Dashboard Config Contract**

```typescript
// LOCKED – dashboard configuration contract

export type WidgetKind =
  | 'line'
  | 'bar'
  | 'stacked_bar'
  | 'pie'
  | 'table'
  | 'scatter'
  | 'funnel'
  // InsightCore-specific semantic widgets:
  | 'business_baseline'    // small summary cards for counts & freshness
  | 'top_driver'           // single highlighted driver (FT0 Aha)
  | 'correlation_panel'    // 3-7 strongest bivariate correlations
  | 'causal_graph'         // v2: directed dependency graph (read-only)
  | 'driver_ranking'       // v2: multivariate driver ranking
  | 'storyboard'           // v2: narrative "what changed and why"
  | 'simulator'            // v3: intervention simulator (read-only config)

export interface DashboardWidgetConfig {
  id: string;                  // 'profit_time_series', 'returns_by_reason'
  kind: WidgetKind;
  title: string;
  description?: string;

  // AnalyticsQuery is a template; UI fills timeRange/filters/shopId etc.
  query?: AnalyticsQuery;

  // Semantic widget extras (optional and widget-specific)
  // For 'top_driver' widgets: which outcome metric to explain (e.g. 'revenue_total', 'net_profit')
  outcomeMetric?: string;

  // For 'top_driver' or 'driver_ranking' widgets: top N to return (default 3)
  topN?: number;

  // For 'correlation_panel': max correlations to show (default 5)
  correlationLimit?: number;

  // For 'business_baseline': list of primitives to surface (e.g. ['order_count','product_count'])
  primitives?: string[];

  // For 'simulator': list of allowed levers and constraints (read-only)
  simulatorSpec?: Record<string, any>;

  // Presentation hints (UI-only; cannot change semantics)
  display?: {
    chartType?: 'line' | 'bar' | 'table' | 'bigNumber';
    emphasize?: boolean;
  };

  // Whether the widget requires special module presence to be meaningful.
  requiredModules?: Array<'order-nexus' | 'margincore' | 'specter' | 'sku-os' | 'return-nexus'>;
}

export interface DashboardConfig {
  id: string;                  // 'profitability_overview', 'returns_and_quality_overview'
  name: string;
  description?: string;
  requiredModules: Array<'order-nexus' | 'margincore' | 'specter' | 'sku-os' | 'return-nexus'>;
  widgets: DashboardWidgetConfig[];
}
```

#### **Dashboard Rules:**
- The `top_driver` widget is the FT0 Aha moment
- Must compute using InsightCore's lightweight v1 heuristic (lag-correlation × contribution magnitude)
- Widgets are configuration only
- Any required post-processing must be implemented as read-only transformations
- DashboardConfig objects are versioned and immutable once published
- UIs may disable widgets based on Module Readiness

## **5. Backward-Compatibility Contract – Returns & Quality Analytics**

### **5.1 Data Ingestion Sources:**
InsightCore ingests:
1. `ReturnAnalyticsEvent` from ReturnNexus
2. `WmsIssueAnalyticsEvent` from WMS-Lite

### **5.2 Enum Normalization Requirement:**
All quality-related enums and buckets must be normalized according to:
- `docs/shared/returns-quality-mapping.md`
- Shared types in `packages/shared/src/contracts/returns-quality-contract.ts`

### **5.3 Compatibility Rules:**
- `reasonCategory`, `inspectionResult`, and `issueRootCause` MUST match shared types
- Any change that adds or reinterprets these enums MUST:
  1. Update `docs/shared/returns-quality-mapping.md`
  2. Introduce versioned analytics schema (`v2`) as needed

### **5.4 Strict Enforcement:**
InsightCore MUST NOT implement its own alternative mapping or silently reinterpret the meaning of quality-related enums.

## **6. Public API Endpoints**

### **6.1 Query Endpoints:**
- `POST /api/analytics/v1/query` → Execute `AnalyticsQuery`
- `GET /api/analytics/v1/dashboards` → List available dashboards
- `GET /api/analytics/v1/dashboards/:id` → Get dashboard config

### **6.2 Metadata Endpoints:**
- `GET /api/analytics/v1/metrics` → List all metric definitions
- `GET /api/analytics/v1/dimensions` → List all dimension definitions
- `GET /api/analytics/v1/readiness/:shopId` → Get analytics readiness state

### **6.3 Export Endpoints (Optional v1):**
- `POST /api/analytics/v1/export/csv` → CSV export for any `AnalyticsQuery`
- `GET /api/analytics/v1/export/schema` → Data warehouse schema documentation

## **7. Event Emission Contracts**

### **7.1 InsightCore Emits:**
```typescript
export interface InsightActionRecommended {
  recommendationId: string;
  shopId: number;
  targetModule: string;
  actionId: string;
  urgency: 'survival' | 'growth' | 'architect';
  recommendedAt: string;
  // ... other fields from InsightActionRecommendation
}
```

### **7.2 InsightCore Consumes (for closed-loop learning):**
```typescript
export interface InsightActionOutcome {
  recommendationId: string;
  shopId: number;
  status: 'executed' | 'partially_executed' | 'ignored' | 'failed';
  executedAt?: string;
  measuredMetricDeltas?: Record<string, number>;
  evidenceWindow?: { from: string; to: string };
  reportedAt: string;
}
```

## **8. Observability Contracts**

### **8.1 Required Metrics:**
```typescript
const INSIGHT_CORE_METRICS = {
  ingestion: {
    events_received_total: 'Counter',
    events_failed_total: 'Counter',
    ingestion_lag_ms: 'Histogram' // event timestamp → ingested_at
  },
  queries: {
    query_latency_ms: 'Histogram',
    query_errors_total: 'Counter'
  },
  dashboards: {
    dashboard_loads_total: 'Counter',
    dashboard_query_failures_total: 'Counter'
  },
  returns: {
    return_events_received_total: 'Counter',
    return_events_failed_total: 'Counter',
    return_ingestion_lag_ms: 'Histogram'
  }
};
```

### **8.2 Service Level Agreements (SLAs):**
```typescript
export const INSIGHT_CORE_SLAS = {
  ingestion: {
    // 99% of OrderAnalyticsEvent and ReturnAnalyticsEvent rows available within 5 minutes
    maxIngestionLagMs: 5 * 60 * 1000
  },
  queries: {
    // 95% of dashboard queries under 3 seconds
    p95LatencyMs: 3000
  }
};
```

## **9. Contract Evolution Guidelines**

### **9.1 Breaking Changes Require:**
1. New versioned contract (e.g., `v2` prefix on APIs)
2. Migration plan for existing data
3. Deprecation timeline for old contracts
4. Updated documentation across all referencing modules

### **9.2 Non-Breaking Changes Allowed:**
1. Adding new optional fields to existing interfaces
2. Adding new endpoints
3. Adding new metric/dimension definitions
4. Performance optimizations that don't change semantics

### **9.3 Strictly Prohibited:**
1. Removing or renaming existing fields in locked contracts
2. Changing enum values or their semantics
3. Changing calculation logic for existing metric definitions
4. Ad-hoc modifications without versioning
```