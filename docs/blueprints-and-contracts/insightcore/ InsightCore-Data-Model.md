# InsightCore – Data Model & Warehouse Schema

## **Data Architecture Principles**

### **Logical vs. Physical Schema**
This document defines the **logical schema** for InsightCore's data warehouse. Physical implementations may vary (data warehouse, OLAP database, etc.), but column names, types, and relationships are locked for v1.

### **Core Design Principles:**
1. **Event Sourcing:** All analytics data originates from immutable events
2. **Read-Optimized:** Schema designed for analytical queries, not transactions
3. **Time-Series First:** All fact tables include temporal dimensions
4. **Canonical Dimensions:** Shared dimension tables across all facts
5. **Opaque Enums:** Returns quality fields treated as opaque from source

## **Fact Tables**

### **1. Fact: Orders Profitability (`fact_orders`)**

```sql
-- LOCKED – insight-core warehouse schema
CREATE TABLE fact_orders (
  -- Primary Key & Identification
  shop_id INTEGER NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  
  -- Temporal Dimensions
  order_date TIMESTAMPTZ NOT NULL,   -- from OrderAnalyticsEvent.orderDate
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Financial Metrics (from OrderNexus)
  revenue_total DECIMAL(10,2) NOT NULL,
  net_profit DECIMAL(10,2) NOT NULL,
  margin_percent DECIMAL(5,2) NOT NULL,
  
  -- Business Context
  profit_status VARCHAR(16) NOT NULL,        -- 'HEALTHY' | 'AT_RISK' | 'UNPROFITABLE'
  customer_profit_tier VARCHAR(32),
  channel VARCHAR(64),
  
  -- Optional: Cost Model Version
  cost_model_version VARCHAR(64),            -- join with fact_cost_model_events

  PRIMARY KEY (shop_id, order_id)
);

-- Indexing Strategy
CREATE INDEX idx_fact_orders_shop_date
  ON fact_orders (shop_id, order_date);

CREATE INDEX idx_fact_orders_shop_status
  ON fact_orders (shop_id, profit_status);

CREATE INDEX idx_fact_orders_channel
  ON fact_orders (shop_id, channel);
```

### **2. Fact: Nudges (`fact_nudges`)**

```sql
CREATE TABLE fact_nudges (
  -- Primary Key & Identification
  shop_id INTEGER NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  displayed_at TIMESTAMPTZ NOT NULL,
  
  -- Temporal
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Nudge Attributes (from Specter)
  nudge_type VARCHAR(32) NOT NULL,      -- 'REMINDER' (v1)
  offer_type VARCHAR(32) NOT NULL,      -- 'NONE' (v1)
  message_key VARCHAR(128) NOT NULL,
  
  -- Interaction Metrics
  clicked BOOLEAN NOT NULL,
  converted BOOLEAN NOT NULL,
  
  -- Conversion Attribution
  order_id VARCHAR(64),

  PRIMARY KEY (shop_id, session_id, displayed_at)
);

-- Indexing Strategy
CREATE INDEX idx_fact_nudges_shop_displayed
  ON fact_nudges (shop_id, displayed_at);

CREATE INDEX idx_fact_nudges_conversion
  ON fact_nudges (shop_id, clicked, converted);
```

### **3. Fact: Product Health (`fact_product_health`)**

```sql
CREATE TABLE fact_product_health (
  -- Primary Key & Identification
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  recalculated_at TIMESTAMPTZ NOT NULL,   -- from ProductHealthAnalyticsEvent.recalculatedAt
  
  -- Temporal
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Health Metrics (from SKU OS)
  health_score DECIMAL(5,2) NOT NULL,     -- 0–100
  stockout_risk DECIMAL(4,3) NOT NULL,    -- 0–1
  
  -- Margin Health Classification
  margin_health VARCHAR(16) NOT NULL,     -- 'healthy' | 'at_risk' | 'critical' | 'unknown'
  
  -- Data Quality
  confidence VARCHAR(16) NOT NULL,        -- 'low' | 'medium' | 'high'

  PRIMARY KEY (shop_id, product_id, recalculated_at)
);

-- Indexing Strategy
CREATE INDEX idx_fact_product_health_latest
  ON fact_product_health (shop_id, product_id, recalculated_at DESC);

CREATE INDEX idx_fact_product_health_score
  ON fact_product_health (shop_id, health_score, recalculated_at DESC);
```

### **4. Fact: Cost Model Events (`fact_cost_model_events`)**

```sql
CREATE TABLE fact_cost_model_events (
  -- Primary Key & Identification
  shop_id INTEGER NOT NULL,
  cost_model_version_id VARCHAR(128) NOT NULL,   -- CostModelVersioning.versionId
  
  -- Temporal
  activated_at TIMESTAMPTZ NOT NULL,      -- from CostModelAnalyticsEvent.activatedAt
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Cost Model Attributes
  source VARCHAR(16) NOT NULL,            -- 'finance' | 'local'
  recomputation_scope VARCHAR(32) NOT NULL, -- 'none' | 'new_orders_only' | 'all_orders_since'
  recomputation_since TIMESTAMPTZ,        -- optional: when recomputation scope requires it

  PRIMARY KEY (shop_id, cost_model_version_id)
);

-- Indexing Strategy
CREATE INDEX idx_cost_model_events_shop_time
  ON fact_cost_model_events (shop_id, activated_at);

CREATE INDEX idx_cost_model_events_scope
  ON fact_cost_model_events (shop_id, recomputation_scope, activated_at);
```

### **5. Fact: Returns & Quality (`fact_returns`)**

```sql
CREATE TABLE fact_returns (
  -- Primary Key & Identification
  shop_id INTEGER NOT NULL,
  return_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,        -- product identifier (string)
  
  -- Transaction Relationships
  order_id VARCHAR(64) NOT NULL,
  quantity INTEGER NOT NULL,
  
  -- Temporal
  processed_at TIMESTAMPTZ NOT NULL,      -- when return was financially closed
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Return Reasons (Opaque Enums - DO NOT REINTERPRET)
  reason_category VARCHAR(64) NOT NULL,      -- ReturnReasonCategory (string enum)
  inspection_result VARCHAR(64) NOT NULL,    -- InspectionResult (string enum)
  issue_root_cause VARCHAR(64) NOT NULL,     -- IssueRootCause (string enum)
  
  -- Financial Impact
  refund_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  
  -- Inventory Impact
  restockable BOOLEAN NOT NULL,

  PRIMARY KEY (shop_id, return_id, product_id)
);

-- Indexing Strategy
CREATE INDEX idx_fact_returns_shop_processed
  ON fact_returns (shop_id, processed_at);

CREATE INDEX idx_fact_returns_shop_order
  ON fact_returns (shop_id, order_id);

CREATE INDEX idx_fact_returns_reason_category
  ON fact_returns (shop_id, reason_category, processed_at);

CREATE INDEX idx_fact_returns_issue_root_cause
  ON fact_returns (shop_id, issue_root_cause, processed_at);
```

**Important:** The fields `reason_category`, `inspection_result`, and `issue_root_cause` are **opaque enums** from the shared `returns-quality-contract`. No relabeling or reinterpretation is allowed in the data layer.

## **Dimension Tables**

### **1. Date Dimension (`dim_date`)**

```sql
CREATE TABLE dim_date (
  date_key DATE PRIMARY KEY,
  
  -- Hierarchical decomposition
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  month INTEGER NOT NULL,
  week INTEGER NOT NULL,
  day INTEGER NOT NULL,
  
  -- Business calendar attributes
  is_weekend BOOLEAN NOT NULL,
  is_holiday BOOLEAN NOT NULL,
  holiday_name VARCHAR(64),
  
  -- ISO standards
  iso_year INTEGER NOT NULL,
  iso_week INTEGER NOT NULL,
  iso_day_of_week INTEGER NOT NULL,
  
  -- Labels
  month_name VARCHAR(16),
  day_name VARCHAR(16),
  quarter_name VARCHAR(8)
);

-- Indexing Strategy
CREATE INDEX idx_dim_date_year_month
  ON dim_date (year, month);

CREATE INDEX idx_dim_date_year_week
  ON dim_date (iso_year, iso_week);
```

**Usage Note:** Pre-populated with historical and future dates to support time-series analysis.

### **2. Product Dimension (`dim_product`)**

```sql
CREATE TABLE dim_product (
  -- Primary Key
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  
  -- Basic Attributes
  product_name VARCHAR(255),
  sku VARCHAR(64),
  
  -- Categorization
  product_type VARCHAR(64),
  vendor VARCHAR(128),
  
  -- Temporal Tracking
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  
  -- Business Attributes
  default_price DECIMAL(10,2),
  cost_basis DECIMAL(10,2),
  
  -- Metadata
  tags JSONB,                        -- flexible categorization
  custom_attributes JSONB,           -- shop-specific extensions

  PRIMARY KEY (shop_id, product_id)
);

-- Indexing Strategy
CREATE INDEX idx_dim_product_shop_sku
  ON dim_product (shop_id, sku);

CREATE INDEX idx_dim_product_shop_vendor
  ON dim_product (shop_id, vendor);
```

### **3. Channel Dimension (`dim_channel`)**

```sql
CREATE TABLE dim_channel (
  channel VARCHAR(64) PRIMARY KEY,
  
  -- Classification
  channel_type VARCHAR(32),           -- 'online', 'in_store', 'marketplace'
  platform VARCHAR(64),               -- 'shopify', 'amazon', 'ebay', etc.
  
  -- Descriptive Metadata
  description VARCHAR(255),
  
  -- Business Rules
  supports_returns BOOLEAN DEFAULT TRUE,
  requires_inspection BOOLEAN DEFAULT FALSE,
  
  -- Integration Metadata
  external_system_id VARCHAR(128),
  last_synced_at TIMESTAMPTZ
);
```

### **4. Customer Tier Dimension (`dim_customer_tier`)**

```sql
CREATE TABLE dim_customer_tier (
  tier VARCHAR(32) PRIMARY KEY,
  
  -- Classification
  tier_level INTEGER,                 -- 1=lowest, 5=highest
  tier_type VARCHAR(32),              -- 'profit', 'loyalty', 'segment'
  
  -- Descriptive Metadata
  description VARCHAR(255),
  min_threshold DECIMAL(10,2),        -- minimum value for tier
  max_threshold DECIMAL(10,2),        -- maximum value for tier
  
  -- Business Rules
  retention_target_days INTEGER,
  expected_order_frequency_days INTEGER,
  
  -- Versioning
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_active BOOLEAN DEFAULT TRUE
);

-- Indexing Strategy
CREATE INDEX idx_dim_customer_tier_level
  ON dim_customer_tier (tier_level, is_active);
```

### **5. Return Reason Reference (`dim_return_reason_category`)**

```sql
CREATE TABLE dim_return_reason_category (
  reason_category VARCHAR(64) PRIMARY KEY,   -- matches fact_returns.reason_category
  
  -- Classification
  category_group VARCHAR(64),                -- 'customer', 'product', 'logistics'
  severity VARCHAR(16),                      -- 'low', 'medium', 'high', 'critical'
  
  -- Descriptive Metadata
  display_name VARCHAR(128),
  description TEXT,
  
  -- Business Impact
  typical_refund_rate DECIMAL(5,2),         -- 0-100%
  typical_restock_rate DECIMAL(5,2),        -- 0-100%
  
  -- Mitigation Pathways
  recommended_action_module VARCHAR(32),     -- 'sku-os', 'wms-lite', 'specter'
  recommended_action_id VARCHAR(64),
  
  -- Version Tracking
  added_in_version VARCHAR(32),
  deprecated_in_version VARCHAR(32),
  is_active BOOLEAN DEFAULT TRUE
);

-- Indexing Strategy
CREATE INDEX idx_dim_return_reason_group
  ON dim_return_reason_category (category_group, severity);
```

**Note:** This table is a **reference dimension** only. It provides metadata about reason categories but does not alter the opaque enum values in `fact_returns`.

### **6. Issue Root Cause Reference (`dim_issue_root_cause`)**

```sql
CREATE TABLE dim_issue_root_cause (
  issue_root_cause VARCHAR(64) PRIMARY KEY,   -- matches fact_returns.issue_root_cause
  
  -- Classification
  responsibility_area VARCHAR(64),            -- 'supplier', 'warehouse', 'transport', 'customer'
  is_preventable BOOLEAN,
  requires_supplier_notification BOOLEAN,
  
  -- Descriptive Metadata
  display_name VARCHAR(128),
  description TEXT,
  
  -- Quality Metrics
  typical_occurrence_rate DECIMAL(5,2),       -- per 1000 units
  average_resolution_cost DECIMAL(10,2),
  
  -- Corrective Actions
  corrective_action_owner VARCHAR(64),
  time_to_resolve_days INTEGER,
  
  -- Version Tracking
  added_in_version VARCHAR(32),
  deprecated_in_version VARCHAR(32),
  is_active BOOLEAN DEFAULT TRUE
);
```

## **Derived Tables (v2+)** 

### **1. Driver Weights (`fact_driver_weights`)**

```sql
-- v2 Feature: Multivariate driver analysis
CREATE TABLE fact_driver_weights (
  shop_id INTEGER NOT NULL,
  outcome_metric VARCHAR(64) NOT NULL,        -- e.g., 'net_profit', 'return_rate'
  driver_metric VARCHAR(64) NOT NULL,         -- e.g., 'stockout_risk', 'nudge_conversion_rate'
  
  -- Temporal Scope
  calculation_window_start DATE NOT NULL,
  calculation_window_end DATE NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  
  -- Driver Analysis
  driver_weight DECIMAL(6,4) NOT NULL,        -- -1 to 1, normalized contribution
  driver_rank INTEGER NOT NULL,               -- 1 = highest impact
  confidence_score DECIMAL(4,3) NOT NULL,     -- 0-1, statistical confidence
  
  -- Impact Metrics
  absolute_impact DECIMAL(10,2),              -- estimated absolute impact
  relative_impact DECIMAL(5,2),               -- estimated percentage impact
  
  -- Cross-Module Context
  driver_module VARCHAR(32),                  -- 'sku-os', 'specter', 'return-nexus'
  outcome_module VARCHAR(32),                 -- 'order-nexus', 'return-nexus'
  
  -- Metadata
  calculation_method VARCHAR(32),             -- 'correlation', 'regression', 'causal'
  sample_size INTEGER,
  
  PRIMARY KEY (shop_id, outcome_metric, driver_metric, calculation_window_end)
);

-- Indexing Strategy
CREATE INDEX idx_fact_driver_weights_shop_outcome
  ON fact_driver_weights (shop_id, outcome_metric, calculated_at DESC);

CREATE INDEX idx_fact_driver_weights_driver_module
  ON fact_driver_weights (shop_id, driver_module, calculated_at DESC);
```

### **2. Business State Vector (`fact_business_state`)**

```sql
-- v3 Feature: Predictive simulation basis
CREATE TABLE fact_business_state (
  shop_id INTEGER NOT NULL,
  snapshot_date DATE NOT NULL,
  
  -- State Dimensions
  state_vector JSONB NOT NULL,                -- encoded business state
  state_hash VARCHAR(64) NOT NULL,            -- deterministic hash of vector
  
  -- Key Metrics Snapshot
  revenue_30d DECIMAL(12,2),
  profit_30d DECIMAL(12,2),
  return_rate_30d DECIMAL(5,2),
  customer_count INTEGER,
  active_sku_count INTEGER,
  
  -- Derived Indicators
  growth_trajectory VARCHAR(16),              -- 'accelerating', 'stable', 'decelerating'
  risk_profile VARCHAR(16),                   -- 'low', 'medium', 'high'
  health_score DECIMAL(5,2),
  
  -- Temporal Context
  days_in_operation INTEGER,
  seasonality_factor DECIMAL(4,3),
  
  -- Prediction Context
  predicted_next_30d JSONB,                   -- forecasted metrics
  prediction_confidence DECIMAL(4,3),
  
  PRIMARY KEY (shop_id, snapshot_date)
);
```

## **Data Quality & Governance Tables**

### **1. Metric Lineage (`metric_lineage`)**

```sql
CREATE TABLE metric_lineage (
  metric_id VARCHAR(64) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  
  -- Lineage Tracking
  parent_metric_id VARCHAR(64),
  parent_version_id VARCHAR(64),
  change_type VARCHAR(32),                    -- 'created', 'modified', 'deprecated'
  change_reason TEXT,
  
  -- Technical Metadata
  calculation_sql TEXT,
  dependencies JSONB,                         -- dependent tables/columns
  data_freshness_requirements INTERVAL,
  
  -- Business Metadata
  business_owner VARCHAR(128),
  data_steward VARCHAR(128),
  compliance_tags JSONB,
  
  -- Temporal
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  
  PRIMARY KEY (metric_id, version_id)
);
```

### **2. Data Freshness Monitoring (`data_freshness_monitor`)**

```sql
CREATE TABLE data_freshness_monitor (
  shop_id INTEGER NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  metric_name VARCHAR(64) NOT NULL,
  
  -- Freshness Metrics
  last_record_at TIMESTAMPTZ,
  expected_frequency INTERVAL,
  actual_frequency INTERVAL,
  
  -- Quality Scores
  freshness_score DECIMAL(4,2),               -- 0-100
  completeness_score DECIMAL(4,2),            -- 0-100
  consistency_score DECIMAL(4,2),             -- 0-100
  
  -- Alerting
  is_stale BOOLEAN DEFAULT FALSE,
  staleness_reason VARCHAR(128),
  last_alert_sent_at TIMESTAMPTZ,
  
  -- Temporal
  measured_at TIMESTAMPTZ NOT NULL,
  
  PRIMARY KEY (shop_id, table_name, metric_name, measured_at)
);
```

## **Schema Evolution Rules**

### **Locked for v1:**
1. Column names, types, and primary keys in all `fact_*` tables
2. The existence and structure of `dim_date`, `dim_product`, `dim_channel`, `dim_customer_tier`
3. The opaque enum treatment of returns quality fields

### **Extensible for v1:**
1. Adding new columns with default values
2. Creating new derived tables for v2/v3 features
3. Adding reference dimensions (like `dim_return_reason_category`)
4. Adding indexes for performance optimization

### **Migration Requirements:**
Any breaking schema changes require:
1. New versioned table names (e.g., `fact_orders_v2`)
2. Migration scripts for existing data
3. Dual-write period during transition
4. Updated metric definitions pointing to new tables
```