# InsightCore – Analytics & Metrics Module (v1 Locked Blueprint)

> **Mission:** Be the **single source of truth** for **metrics, analytics events, and dashboards** across LaSyncro – powered by other modules' intelligence, **never re-implementing** their domain logic.

Any change to **locked types or interfaces** in this blueprint requires:

* A versioned contract (`v2`) and
* A data / API migration plan.

No ad-hoc edits.

> All references to *"Analytics Core"* in other module blueprints map to this module: **InsightCore**.

---

## 0. Role, Mission & Boundaries

### 0.1 Role in LaSyncro CNS

* **Module Name:** InsightCore – Analytics & Metrics
* **Role:** CNS **cortex** for:

  * Canonical business metrics (profit, margin, stockout risk, etc.)
  * Cross-module analytics (products × orders × customers × cost models × returns)
  * Dashboards & data access (read-only)

### 0.2 Mission

> **InsightCore Mission (v1–v3):**
> Make the merchant’s business *legible* by identifying the drivers behind outcomes  
> (profit, sales, retention, stock health, refunds), quantifying their impact, and  
> directing the merchant toward the module that owns the fix.  
>
> InsightCore does NOT compute domain logic.  
> It explains the system — transforming fragmented module data into  
> relationships, drivers, and business narratives.

**v1 (FT0–FT1)**  
InsightCore provides foundational intelligence:

* Event ingestion + warehouse schema  
* Baseline metrics (orders, products, returns, nudges, health events)  
* Simple correlations across modules  
* “Top Driver This Week” heuristic (lightweight, no causality)  
* Dashboard delivery and readiness signals  

**v2 (CNS Driver Engine)**  
InsightCore becomes multivariate:

* Cross-module driver weights
* Driver ranking and contribution scoring  
* Business fingerprinting  
* Weekly “What Changed and Why” narratives  

**v3 (Predictive CNS Cortex)**  
InsightCore becomes forward-looking:

* Scenario simulation (“what if” engine)  
* Predictive driver shifts  
* Intervention recommendations  
* Closed-loop learning based on merchant actions

### 0.3 Owns vs Does Not Own

**InsightCore OWNS:**

* **Analytics primitives that no other module may implement**
  * Structural primitives:
    * order_count
    * product_count
    * sku_breadth
    * catalog_depth
  * Temporal primitives:
    * moving_average
    * delta
    * volatility
    * lag
  * Relationship primitives (v1):
    * correlation(x, y)
    * relative_contribution(x → outcome)
  * Driver primitives (v2):
    * driver_weight
    * driver_rank
    * driver_saturation
    * cross_module_impact
  * System primitives (v3):
    * business_state_vector
    * anomaly_score
    * simulation_effect

* **Metric & dimension registry**
  * Canonical metric definitions
  * Canonical dimension definitions
  * Metric versioning and lineage

* **Analytics ingestion & normalization**
  * Order, product health, nudges, cost model, returns

* **Warehouse schema**
  * fact_orders, fact_product_health, fact_nudges, fact_cost_model_events, fact_returns
  * dim_product, dim_channel, dim_customer_tier, dim_date

* **Query Engine**
  * Validates metric & dimension IDs
  * Executes AnalyticsQuery → AnalyticsQueryResult
  * Computes metricVersions map

* **Driver interpretation (v1 lightweight)**
  * Identify the top correlated driver per outcome
  * Expose “Top Driver This Week” for FT0/FT1

* **Dashboard delivery**
  * Opinionated v1 dashboards
  * Widget configuration mapping to queries

* **Readiness computation (analytics readiness only)**
  * Base signals for data presence, freshness, and module coverage

**InsightCore DOES NOT OWN:**

* Order-level profitability computation → **OrderNexus**
* Cost models, financial policy, recomputation rules → **MarginCore**
* Customer behavior & signals → **Specter**
* SKU-level inventory health & playbooks → **SKU OS**
* Return decisions, refund logic → **ReturnNexus**
* Fulfillment, workflows, tasks → **WMS Lite**, **Echo Hub**
* Operational decisions (no "change price", "auto-reorder", "send email")

If InsightCore starts mutating other modules' state or recomputing profit, returns, or product health, you've broken the architecture.

### 0.4 Clear Path Actions (InsightCore → Action Surface)

InsightCore is read-only and MUST NOT execute fixes. Its job is to map insights to the owning module and present a precise, prioritized action path (the "Clear Path") that the merchant can take.

Rules:
* InsightCore **only recommends** actions. All actions must include:
  * targetModule: one of 'order-nexus' | 'sku-os' | 'specter' | 'return-nexus' | 'wms-lite' | 'problem-center'
  * actionId: string (canonical action identifier owned by the target module)
  * rationale: short human-readable explanation (1–2 sentences)
  * urgency: 'survival' | 'growth' | 'architect'
  * expectedImpactEstimate: optional numeric estimate (percent or absolute depending on metric)
  * evidence: array of one-line pointers to the driver(s) and metrics that motivated the action (e.g. ['stockout_rate ↑ 32% (SKU-OS)', 'net_profit volatility ↑ (OrderNexus)'])

* InsightCore must present a ranked list of recommended actions (score + urgency). Ranking is derived from driver_weight × expected_impact_estimate × confidence.

* InsightCore must **not** perform the action or change state in other modules. It may only:
  * Provide a deep link (module route) to the owning module UI with context (shopId, affectedProductIds, affectedOrders sample, timeframe).
  * Emit an `InsightActionRecommended` event (read-only) for audit and automation consumers.

* Canonical Clear Path schema (read-only contract):
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
  context: Record<string, any>; // deep-link context: { productIds?: number[], orderIds?: string[], timeframe?: {from,to} }
  recommendedAt: string; // ISO
}
````

* UX guidance:

  * Survival-level recommendations should surface as primary CTAs in the dashboard and link the user to the owning module's remediation workflow.
  * Growth-level recommendations are surfaced in the Growth pane and may be suggested as experiments.
  * Architect-level recommendations are surfaced with an option to create a Problem Center task and route to WMS/Echo Hub.

* Observability & audit:

  * Each `InsightActionRecommendation` must be logged (immutable) and traceable to the metricVersions used when the recommendation was generated.

This "Clear Path" contract makes InsightCore the CNS traffic controller — it points to the owning module, gives evidence, ranks urgency, and never mutates other modules' data.

---

## 1. Locked External Contracts

These are **externally visible** and must be implemented exactly.

### 1.1 Inbound Analytics Events

#### 1.1.1 From OrderNexus → InsightCore

Already defined in OrderNexus blueprint:

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

InsightCore **must not** reinterpret or recompute `netProfit` or `marginPercent`.

#### 1.1.2 From Specter → InsightCore (Nudges)

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

#### 1.1.3 From SKU OS → InsightCore (Product Health)

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

#### 1.1.4 From MarginCore → InsightCore (Cost Models)

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

#### 1.1.5 From ReturnNexus → InsightCore (Returns & Quality)

ReturnNexus emits a **row-per-return-line** analytics event **after** the financial decision and (if required) physical inspection are final.

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

**Rules:**

InsightCore **must not**:

* Re-map `reasonCategory` into new categories,
* Merge or split `InspectionResult` values,
* Re-label `IssueRootCause`,
* Re-derive `restockable`.

These fields must be treated as opaque enums coming from the shared `returns-quality-contract`. Any conceptual grouping (e.g. chart buckets) must be done purely at the presentation layer, without emitting new enum values or persisting alternative category systems.

---

### 1.2 Public Query Contract

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

Changing `AnalyticsQuery` or `AnalyticsQueryResult` requires `v2` and migration.

---

### 1.3 Metric & Dimension Registry Contract

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

**Rules:**

* Exposed read-only via `/metrics` and `/dimensions`.
* Old metric definitions are **immutable**; new logic requires new `versionId` (and possibly new `id`).

---

### 1.4 Dashboard Config Contract (Frontend & Backend)

Dashboards are *configuration*, not hard-coded UI. InsightCore provides a small set of canonical widget types that map directly to InsightCore primitives (v1–v3), plus a query template that the UI hydrates with shop/time/filters.

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

Notes / Rules:
* The 'top_driver' widget is the FT0 Aha and must compute a single driver using InsightCore's lightweight v1 heuristic (lag-correlation × contribution magnitude) when used in FT0 dashboards.
* Widgets are configuration only. Any widget that requires post-processing (driver ranking, causal graph, simulator) must be implemented as read-only transformations on AnalyticsQuery results or separate read endpoints on InsightCore; they must NOT reimplement upstream domain logic.
* DashboardConfig objects are versioned and immutable once published for a given versionId; changes require a new version.
* UIs may disable widgets if the shop's Module Readiness indicates missing required modules.
```

---

### 1.5 Backward-Compatibility Note – Returns & Quality Analytics

InsightCore ingests:

* `ReturnAnalyticsEvent` from ReturnNexus, and
* `WmsIssueAnalyticsEvent` from WMS-Lite

under the assumption that all quality-related enums and buckets are normalized according to `docs/shared/returns-quality-mapping.md`.

Specifically:

* `reasonCategory`, `inspectionResult`, and `issueRootCause`
  MUST match the shared types in `packages/shared/src/contracts/returns-quality-contract.ts`
  and their semantics in `docs/shared/returns-quality-mapping.md`.

Any change that adds or reinterprets these enums MUST:

1. Update `docs/shared/returns-quality-mapping.md`, and  
2. Introduce a versioned analytics schema / metrics definition (`v2`) as needed.

InsightCore MUST NOT implement its own alternative mapping or silently reinterpret the meaning of quality-related enums.

---

## 2. Internal Architecture (InsightCore)

### 2.1 Subsystems

1. **Event Ingestion & Normalization**
   * Consumers for:
     * `OrderAnalyticsEvent`
     * `NudgeAnalyticsEvent`
     * `ProductHealthAnalyticsEvent`
     * `CostModelAnalyticsEvent`
     * `ReturnAnalyticsEvent`
   * Writes to staging tables → ETL → analytics warehouse (`fact_*` tables).

2. **Metrics Registry Service**
   * Stores `MetricDefinition`, `DimensionDefinition`.
   * Validates metric expressions and tables.
   * Provides lookups for Query Engine.

3. **Query Engine**
   * Accepts `AnalyticsQuery`.
   * Validates against registry (metric & dimension IDs).
   * Generates warehouse queries (SQL or equivalent).
   * Returns `AnalyticsQueryResult` with `metricVersions`.

4. **Dashboard Service**
   * Stores `DashboardConfig` for v1 dashboards.
   * Exposes `/dashboards/:id` → list of widgets with hydrated queries.

5. **Export / Integration Service (Optional v1)**
   * CSV export for any `AnalyticsQuery`.
   * Simple API for external BI tools (limited, read-only).

---

## 3. Data Model (Warehouse Schema)

> This is the **logical** schema; physical implementation can be a data warehouse, but column names & types are locked.

### 3.1 Fact: Orders Profitability

```sql
-- LOCKED – insight-core warehouse schema

CREATE TABLE fact_orders (
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,   -- from OrderAnalyticsEvent.orderDate

  revenue_total DECIMAL(10,2) NOT NULL,
  net_profit DECIMAL(10,2) NOT NULL,
  margin_percent DECIMAL(5,2) NOT NULL,
  profit_status VARCHAR(16) NOT NULL,
  customer_profit_tier VARCHAR(32),
  channel VARCHAR(64),

  cost_model_version VARCHAR(64),    -- optional: join with cost model events
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, order_id)
);

CREATE INDEX idx_fact_orders_shop_date
  ON fact_orders (shop_id, order_date);

CREATE INDEX idx_fact_orders_shop_status
  ON fact_orders (shop_id, profit_status);
```

### 3.2 Fact: Nudges

```sql
CREATE TABLE fact_nudges (
  shop_id INTEGER NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  displayed_at TIMESTAMPTZ NOT NULL,
  nudge_type VARCHAR(32) NOT NULL,
  offer_type VARCHAR(32) NOT NULL,
  message_key VARCHAR(128) NOT NULL,
  clicked BOOLEAN NOT NULL,
  converted BOOLEAN NOT NULL,
  order_id VARCHAR(64),

  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, session_id, displayed_at)
);

CREATE INDEX idx_fact_nudges_shop_displayed
  ON fact_nudges (shop_id, displayed_at);
```

### 3.3 Fact: Product Health

```sql
CREATE TABLE fact_product_health (
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  health_score DECIMAL(5,2) NOT NULL,
  stockout_risk DECIMAL(4,3) NOT NULL,
  margin_health VARCHAR(16) NOT NULL,
  confidence VARCHAR(16) NOT NULL,
  recalculated_at TIMESTAMPTZ NOT NULL,

  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, product_id, recalculated_at)
);

CREATE INDEX idx_fact_product_health_latest
  ON fact_product_health (shop_id, product_id, recalculated_at DESC);
```

### 3.4 Fact: Cost Model Events

```sql
CREATE TABLE fact_cost_model_events (
  shop_id INTEGER NOT NULL,
  cost_model_version_id VARCHAR(128) NOT NULL,
  source VARCHAR(16) NOT NULL,      -- 'finance' | 'local'
  activated_at TIMESTAMPTZ NOT NULL,
  recomputation_scope VARCHAR(32) NOT NULL,
  recomputation_since TIMESTAMPTZ,

  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, cost_model_version_id)
);

CREATE INDEX idx_cost_model_events_shop_time
  ON fact_cost_model_events (shop_id, activated_at);
```

### 3.5 Fact: Returns & Quality

```sql
CREATE TABLE fact_returns (
  shop_id INTEGER NOT NULL,
  return_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  quantity INTEGER NOT NULL,

  reason_category VARCHAR(64) NOT NULL,      -- ReturnReasonCategory (string enum)
  inspection_result VARCHAR(64) NOT NULL,    -- InspectionResult (string enum)
  issue_root_cause VARCHAR(64) NOT NULL,     -- IssueRootCause (string enum)

  refund_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  restockable BOOLEAN NOT NULL,

  processed_at TIMESTAMPTZ NOT NULL,         -- from ReturnAnalyticsEvent.processedAt
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, return_id, product_id)
);

CREATE INDEX idx_fact_returns_shop_processed
  ON fact_returns (shop_id, processed_at);

CREATE INDEX idx_fact_returns_shop_order
  ON fact_returns (shop_id, order_id);
```

> **Rule:** InsightCore treats `reason_category`, `inspection_result`, and `issue_root_cause` as **opaque enums** coming from the shared `returns-quality-contract` – no relabeling.

### 3.6 Dimension Tables (Recommended)

```sql
CREATE TABLE dim_date (
  date_key DATE PRIMARY KEY,
  year INTEGER,
  month INTEGER,
  day INTEGER,
  week INTEGER
);

CREATE TABLE dim_product (
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name VARCHAR(255),
  PRIMARY KEY (shop_id, product_id)
);

CREATE TABLE dim_channel (
  channel VARCHAR(64) PRIMARY KEY,
  description VARCHAR(255)
);

CREATE TABLE dim_customer_tier (
  tier VARCHAR(32) PRIMARY KEY,
  description VARCHAR(255)
);
```

> v1 may later add `dim_return_reason_category`, `dim_issue_root_cause` as **reference dimensions**, but `fact_returns.reason_category` and `fact_returns.issue_root_cause` are already canonical.

---

## 4. Core Services & Flows

### 4.1 EventIngestionService

```typescript
export interface OrderAnalyticsEventConsumer {
  handle(event: OrderAnalyticsEvent): Promise<void>;
}

export class OrderAnalyticsEventConsumerImpl
  implements OrderAnalyticsEventConsumer
{
  constructor(private readonly db: DbClient, private readonly logger: Logger) {}

  async handle(event: OrderAnalyticsEvent): Promise<void> {
    await this.db.query(
      `
      INSERT INTO fact_orders (
        shop_id, order_id, order_date,
        revenue_total, net_profit, margin_percent,
        profit_status, customer_profit_tier, channel
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (shop_id, order_id) DO UPDATE SET
        revenue_total = EXCLUDED.revenue_total,
        net_profit = EXCLUDED.net_profit,
        margin_percent = EXCLUDED.margin_percent,
        profit_status = EXCLUDED.profit_status,
        customer_profit_tier = EXCLUDED.customer_profit_tier,
        channel = EXCLUDED.channel,
        ingested_at = NOW()
      `,
      [
        event.shopId,
        event.orderId,
        event.orderDate,
        event.revenue,
        event.netProfit,
        event.marginPercent,
        event.profitStatus,
        event.customerProfitTier,
        event.channel
      ]
    );
  }
}
```

Similar consumers exist for:

* `NudgeAnalyticsEvent` → `fact_nudges`
* `ProductHealthAnalyticsEvent` → `fact_product_health`
* `CostModelAnalyticsEvent` → `fact_cost_model_events`

And for **returns**:

```typescript
export interface ReturnAnalyticsEventConsumer {
  handle(event: ReturnAnalyticsEvent): Promise<void>;
}

export class ReturnAnalyticsEventConsumerImpl
  implements ReturnAnalyticsEventConsumer
{
  constructor(private readonly db: DbClient, private readonly logger: Logger) {}

  async handle(event: ReturnAnalyticsEvent): Promise<void> {
    await this.db.query(
      `
      INSERT INTO fact_returns (
        shop_id, return_id, order_id, product_id, quantity,
        reason_category, inspection_result, issue_root_cause,
        refund_amount, currency, restockable,
        processed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (shop_id, return_id, product_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        reason_category = EXCLUDED.reason_category,
        inspection_result = EXCLUDED.inspection_result,
        issue_root_cause = EXCLUDED.issue_root_cause,
        refund_amount = EXCLUDED.refund_amount,
        currency = EXCLUDED.currency,
        restockable = EXCLUDED.restockable,
        processed_at = EXCLUDED.processed_at,
        ingested_at = NOW()
      `,
      [
        event.shopId,
        event.returnId,
        event.orderId,
        event.productId,
        event.quantity,
        event.reasonCategory,
        event.inspectionResult,
        event.issueRootCause,
        event.refundAmount,
        event.currency,
        event.restockable,
        event.processedAt
      ]
    );
  }
}
```

---

### 4.2 MetricsRegistryService

*(unchanged contract; now just includes returns-related metrics & dimensions in seeded data)*

```typescript
export interface MetricsRegistry {
  getMetric(id: string): Promise<MetricDefinition | null>;
  listMetrics(): Promise<MetricDefinition[]>;
  getDimension(id: string): Promise<DimensionDefinition | null>;
  listDimensions(): Promise<DimensionDefinition[]>;
}

export class MetricsRegistryImpl implements MetricsRegistry {
  constructor(private readonly db: DbClient) {}

  async getMetric(id: string): Promise<MetricDefinition | null> {
    // read-only, from metrics_definitions table
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    // ...
  }

  async getDimension(id: string): Promise<DimensionDefinition | null> {
    // ...
  }

  async listDimensions(): Promise<DimensionDefinition[]> {
    // ...
  }
}
```

---

### 4.3 QueryService / Engine

*(unchanged contract; returns metrics are just new rows in `MetricDefinition`)*

```typescript
export interface AnalyticsQueryService {
  execute(query: AnalyticsQuery): Promise<AnalyticsQueryResult>;
}

// ... implementation as in previous version ...
```

---

### 4.4 DashboardService

```typescript
export interface DashboardService {
  getDashboardConfig(id: string, shopId: number): Promise<DashboardConfig>;
  listDashboards(shopId: number): Promise<DashboardConfig[]>;
}

export class DashboardServiceImpl implements DashboardService {
  constructor(
    private readonly modulePresence: ModulePresenceManager
  ) {}

  async getDashboardConfig(id: string, shopId: number): Promise<DashboardConfig> {
    const baseConfig = DASHBOARD_REGISTRY[id];
    if (!baseConfig) throw new Error(`UnknownDashboard: ${id}`);

    const presence = await this.modulePresence.getModulePresence(shopId);
    const missing = baseConfig.requiredModules.filter(
      (m) => !presence[this.mapModuleKey(m)]
    );
    // Option: throw or mark widgets disabled if required modules missing

    return baseConfig;
  }

  async listDashboards(shopId: number): Promise<DashboardConfig[]> {
    const presence = await this.modulePresence.getModulePresence(shopId);
    return Object.values(DASHBOARD_REGISTRY).filter((d) =>
      d.requiredModules.every((m) => presence[this.mapModuleKey(m)])
    );
  }

  private mapModuleKey(m: DashboardConfig['requiredModules'][number]): keyof ModulePresence {
    // map 'order-nexus' -> 'orderNexus', 'return-nexus' -> 'returnNexus', etc.
    throw new Error('not implemented');
  }
}
```

Where `DASHBOARD_REGISTRY` now includes a **Returns & Quality** dashboard, e.g.:

* `returns_and_quality_overview` – widgets for:

  * return_rate over time
  * refunds_amount over time
  * returns by `reason_category`
  * returns by `issue_root_cause`
  * restockable vs non-restockable share

---

## 5. Public APIs (Admin & Internal)

*(unchanged – they automatically support returns once metrics/dimensions are registered)*

* `/api/analytics/v1/query`
* `/api/analytics/v1/dashboards`
* `/api/analytics/v1/metrics`
* `/api/analytics/v1/dimensions`
* finance helper endpoints.

---

## 6. Observability & Metrics

InsightCore must expose at least:

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

### 6.1 Closed Loop & Continuous Learning (InsightCore)

InsightCore is not a passive read-only store — v2+ must measure whether the Clear Path recommendations changed outcomes and use that signal to improve driver weights, confidence, and future recommendations.

Rules and contracts:

* InsightCore emits `InsightActionRecommended` events (read-only) when recommendations are created (see 0.4 Clear Path Actions).
* Consumers (module UIs, merchant interactions) must emit back an `InsightActionOutcome` event to inform InsightCore whether the recommended action was executed, partially executed, or ignored, and any observed short-term outcome.

Canonical `InsightActionOutcome` (read-only contract):
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
  evidenceWindow?: { from: string; to: string }; // timeframe used for measuredMetricDeltas
  reportedAt: string; // ISO
}
````

* **Measurement contract**: InsightCore must evaluate `measuredMetricDeltas` against the driver and outcome that motivated the recommendation. It must store:

  * preWindow and postWindow snapshots for the outcome metric(s), anchored to `evidenceWindow`.
  * the delta and percent-change with ingestion timestamps.

* **Attribution rules (v1 lightweight)**:

  * Attribution is built on time-windowed comparison + simple heuristics (e.g. trend reversal within X days). No causal engine required in v1.
  * InsightCore must store attribution confidence: 'low'|'medium'|'high'.

* **Learning update (v2)**:

  * InsightCore updates `driver_weight` and `confidence` for features when consistent `InsightActionOutcome` evidence is received across multiple shops or repeated experiments within the same shop.
  * Learning updates must be versioned and auditable (metricDefinition.versionId changes).

* **Data flow & privacy**:

  * `InsightActionOutcome` events are optional. If not provided, InsightCore still measures using raw events it ingests (orders, nudges, returns, product health) but attribution confidence will be lower.
  * InsightCore must never request or persist PCD. Any context in `InsightActionOutcome.context` must exclude raw customer identifiers.

* **Observability**:

  * Track counts: `insightcore.recommendations_issued_total`, `insightcore.recommendation_outcomes_reported_total`, `insightcore.recommendation_success_rate`.
  * Track time-to-outcome: histogram `insightcore.time_to_outcome_ms`.

* **UX & audit**:

  * Each recommendation and its outcome must be discoverable in a read-only audit trail (immutable).
  * UI must surface whether a recommendation has an outcome reported, the measured delta, and attribution confidence.

This Closed Loop contract ensures InsightCore becomes a learning cortex: it issues evidence-driven recommendations, measures actual outcomes, and uses those measurements (with conservative heuristics v1 → robust updates v2) to tighten driver estimates and improve future recommendations.

---

## 7. Phase 1 Scope (What v1 Actually Includes)

### Included (v1 – Locked)

* **Event ingestion** for:

  * `OrderAnalyticsEvent`
  * `NudgeAnalyticsEvent`
  * `ProductHealthAnalyticsEvent`
  * `CostModelAnalyticsEvent`
  * `ReturnAnalyticsEvent`
* **Warehouse schema**

  * `fact_orders`, `fact_nudges`, `fact_product_health`, `fact_cost_model_events`, `fact_returns`
  * `dim_date`, `dim_product`, `dim_channel`, `dim_customer_tier`
* **Metric & dimension registry**

  * Seeded definitions for:

    * `revenue_total`, `net_profit`, `margin_percent_avg`, `orders_count`
    * `nudge_impressions`, `nudge_clicks`, `nudge_conversions`, `nudge_conversion_rate`
    * `stockout_risk_latest`, `health_score_latest`, etc.
    * `returns_count`, `return_rate`, `refund_amount_total`, `returns_by_reason_category`, `returns_by_issue_root_cause`
* **Query API** (`/query`)
* **Dashboard configs** for:

  * Profitability Overview
  * Product Profit & Health
  * Cost Model Impact
  * Specter Nudge Performance
  * Returns & Quality Overview
* **Read-only metrics/dimensions APIs**
* **Basic observability** (metrics for ingestion & queries, including returns)

### Explicitly NOT Included in v1

* Arbitrary user-defined metrics & formulas via UI
* Real-time streaming dashboards (< 10s latency)
* ML-based anomaly detection
* Direct connectors to every external BI tool
* Any operational hooks (no direct writes to other modules)

Trying to bolt any of these into v1 is how you end up with a half-baked blob instead of a clean analytic core.

---

## 8. Developer Contract – Final Locked Statement

> **InsightCore Developer Contract**
>
> Given:
>
> * `OrderAnalyticsEvent` from OrderNexus
> * `ProductHealthAnalyticsEvent` from SKU OS
> * `CostModelAnalyticsEvent` from MarginCore
> * `NudgeAnalyticsEvent` from Specter
> * `ReturnAnalyticsEvent` from ReturnNexus
>
> **InsightCore guarantees**:
>
> * A **canonical analytics warehouse schema** (`fact_*` + `dim_*`) with stable columns, including `fact_returns` for line-level returns quality & refund data.
> * A **versioned registry** of metrics and dimensions, with explicit units and formulas.
> * A **single query interface** (`AnalyticsQuery` → `AnalyticsQueryResult`) for all dashboards and external consumers.
> * **Opinionated v1 dashboards**:
>
>   * Profitability overview (by time, channel, customer tier)
>   * Product profit × inventory health
>   * Cost model activation impact & recomputation view
>   * Specter nudge impact (funnel, conversion rate, margin context)
>   * Returns & quality overview (return rates, reasons, root causes, refund burden)
> * **Strict boundaries**:
>
>   * No recomputation of core domain logic (profit, cost models, product health, returns decisions, customer signals).
>   * Read-only: no operational decisions, no orders, no pricing, no reorders, no refunds.
> * **Auditability & lineage**:
>
>   * Metric definitions are versioned and immutable.
>   * Each `AnalyticsQueryResult` explicitly states which metric versions were used.

---

## 9. Onboarding & Readiness (Shop-Level Contract)

**Goal:** Prevent "fake confidence" dashboards. InsightCore must expose a clear, machine-readable readiness state per shop so the UI and onboarding flows know when analytics is safe to rely on, and what's still missing.

### 9.1 Readiness Scope

InsightCore readiness is evaluated per shopId and per capability:

* Core profitability analytics → requires OrderAnalyticsEvent
* Returns & quality analytics → requires ReturnAnalyticsEvent
* Nudge funnel analytics → requires NudgeAnalyticsEvent
* Product health analytics → requires ProductHealthAnalyticsEvent
* Cost model / recomputation analytics → requires CostModelAnalyticsEvent

InsightCore never blocks data ingestion; readiness only governs:

* Which dashboards/cards are shown vs hidden/soft-disabled
* What the OnboardingTaskListTracker treats as "done", "warming up", or "blocked"
* Which metrics can be surfaced without "this is probably lying" disclaimers

### 9.2 Readiness States (Per Shop)

At the shop-level, InsightCore MUST expose a coarse readiness state:

```typescript
export type InsightCoreShopState =
  | 'NOT_INSTALLED'          // module not provisioned for this shop
  | 'INSTALLED_NO_DATA'      // migrations done, zero analytics events ingested
  | 'LEARNING'               // some data, below healthy thresholds
  | 'READY'                  // healthy coverage for installed modules
  | 'DEGRADED';              // data gaps or stale feeds detected
```

### 9.3 Readiness Contract (Per Shop)

```typescript
export interface InsightCoreReadiness {
  shopId: number;
  state: InsightCoreShopState;

  // Per-capability booleans (based purely on ingested events)
  hasOrderAnalytics: boolean;          // any OrderAnalyticsEvent for this shop
  hasReturnAnalytics: boolean;         // any ReturnAnalyticsEvent
  hasNudgeAnalytics: boolean;          // any NudgeAnalyticsEvent
  hasProductHealthAnalytics: boolean;  // any ProductHealthAnalyticsEvent
  hasCostModelAnalytics: boolean;      // any CostModelAnalyticsEvent

  // Data coverage & freshness (per capability)
  lastOrderEventAt?: string;           // ISO
  lastReturnEventAt?: string;
  lastNudgeEventAt?: string;
  lastProductHealthEventAt?: string;
  lastCostModelEventAt?: string;

  ordersLast30d: number;               // count of OrderAnalyticsEvent in last 30d
  returnsLast30d: number;              // count of ReturnAnalyticsEvent in last 30d;

  // Derived flags for UX / onboarding
  canShowProfitabilityDashboards: boolean;
  canShowReturnsDashboards: boolean;
  canShowNudgesDashboards: boolean;
  canShowProductHealthDashboards: boolean;

  blockingReasons: string[];           // Hard blockers for state !== 'READY'
  warnings: string[];                  // Non-blocking issues (e.g. low volume)
}
```

**Contract rule:** InsightCore is the only module allowed to compute `InsightCoreReadiness`. Other modules (OrderNexus, ReturnNexus, Specter, SKU OS, MarginCore) may hint or emit events, but they must not self-declare analytics readiness.

### 9.4 Minimum Thresholds (Opinionated Defaults)

These thresholds are deliberately simple and must be treated as v1 locked until a versioned update:

**Core module presence**

* `hasOrderAnalytics` is required for:
  * `canShowProfitabilityDashboards = true`
  * `state` to ever become `'READY'`
* If a shop has zero OrderAnalyticsEvent rows:
  * `state` MUST be `'INSTALLED_NO_DATA'` or `'LEARNING'`
  * Profitability dashboards MUST NOT be marked "ready" in onboarding.

**Minimal viability for profitability**

InsightCore SHOULD consider profitability analytics minimally viable when:

* `ordersLast30d >= 10`
* AND `lastOrderEventAt` within past 7 days

When this holds:

* `canShowProfitabilityDashboards = true`
* If no other hard blockers exist:
  * `state` MAY be `'READY'`

**Returns & quality analytics**

* Returns analytics SHOULD be treated as add-on:
  * `canShowReturnsDashboards = hasReturnAnalytics`
* `returnsLast30d` is used for chart messaging only, not for global readiness.
* Low return volume MUST NOT block `state = 'READY'` if orders are healthy.

**Nudge / Specter analytics**

* `canShowNudgesDashboards = hasNudgeAnalytics`
* Absence of NudgeAnalyticsEvent MUST NOT block `state = 'READY'` if core order analytics is healthy.

**Product health analytics (SKU OS)**

* `canShowProductHealthDashboards = hasProductHealthAnalytics`
* Absence of SKU OS data MUST NOT block `state = 'READY'`.

**Degraded state**

* `state` MUST be `'DEGRADED'` when:
  * Any capability previously active has gone stale, e.g.
    * `lastOrderEventAt` older than 72 hours and `ordersLast30d > 0`, or
  * Any ingestion error budget for this shop is exhausted (implementation detail).
* In degraded state:
  * Dashboards MAY still render, but
  * Onboarding / UI MUST show "data freshness" warnings,
  * OnboardingTaskListTracker MUST NOT present "Unlock analytics" tasks as fully complete.

### 9.5 Onboarding Tasks – How InsightCore Feeds FT0

InsightCore itself does not own header tasks, but it MUST expose enough signal for the onboarding system to derive them.

At minimum, the following task predicates must be derivable:

**"Unlock Profitability Dashboard"**

* Completed when:
  * `InsightCoreReadiness.state` in `['LEARNING', 'READY', 'DEGRADED']`
  * AND `InsightCoreReadiness.hasOrderAnalytics = true`

*Recommended UX:*

* In `'LEARNING'`: show a chip like "Warming up – limited history".
* In `'READY'`: mark step as Done.
* In `'DEGRADED'`: mark step as Done but show a warning icon with "Data stale".

**"Unlock Returns & Quality Analytics"** (only if ReturnNexus installed)

* Completed when:
  * `InsightCoreReadiness.hasReturnAnalytics = true`

*Not having returns MUST NOT block profitability onboarding.*

**"Unlock Nudge Funnel Analytics"** (only if Specter installed)

* Completed when:
  * `InsightCoreReadiness.hasNudgeAnalytics = true`

**"Unlock Product Health Analytics"** (only if SKU OS installed)

* Completed when:
  * `InsightCoreReadiness.hasProductHealthAnalytics = true`

### 9.6 Observability & SLAs (Analytics Ingestion)

InsightCore MUST track, per shop:

* `insightcore_events_ingested_total{event_type}`
* `insightcore_events_lag_ms{event_type}` – ingestion lag vs event timestamp
* `insightcore_readiness_state{state}` – gauge per shop

**SLA intention (v1):**

* 99% of analytics events ingested within 60 seconds of receipt from upstream module.
* Readiness updates (`InsightCoreReadiness`) reflect underlying data in < 30 seconds under normal load.

---

> * **Contract stability**:
>
>   * `OrderAnalyticsEvent`, `NudgeAnalyticsEvent`, `ProductHealthAnalyticsEvent`, `CostModelAnalyticsEvent`, `ReturnAnalyticsEvent`, `AnalyticsQuery`, `AnalyticsQueryResult`, `MetricDefinition`, `DimensionDefinition`, and the warehouse schemas in this blueprint are **locked** for v1.
>   * Any changes require a versioned contract (`v2`) and migration plan – not ad-hoc modifications.
>
> If anyone builds something that violates these contracts, they're not building **InsightCore**. They're building some random analytics thing that will fight the CNS instead of powering it.
