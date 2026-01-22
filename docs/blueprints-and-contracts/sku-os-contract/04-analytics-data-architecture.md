# `04-analytics-data-architecture.md`

## Analytics Primitives SKU-OS Owns

### Core Health Metrics
SKU-OS is responsible for computing and maintaining the following analytics primitives:

| Metric | Description | Range/Values | Purpose |
|--------|-------------|--------------|---------|
| `healthScore` | Composite health indicator | 0–100 | Overall product health assessment |
| `stockoutRisk` | Probability of stockout | 0–1 | Stockout likelihood estimation |
| `turnoverRate` | Inventory turns per period | Units per period | Velocity measurement |
| `daysOfCover` | Projected days until stockout | Number of days | Inventory sufficiency metric |
| `marginHealth` | Categorical margin assessment | `healthy` \| `at_risk` \| `critical` \| `unknown` | Margin risk classification |
| `degradationReasons` | Tags for health issues | Set of tags (e.g., `low_velocity`, `high_return_rate`) | Issue identification |
| `confidence` | Data reliability indicator | `low` \| `medium` \| `high` | Signal quality assessment |

### Usage in InsightCore
These primitives become metric/dimension seeds for InsightCore, including:
* `health_score_latest`
* `stockout_risk_latest`
* `days_of_cover`
* `turnover_rate_30d`
* `margin_health_status`

---

## Data Model (Canonical & Warehouse)

### Canonical Inputs (Already Present)

#### 1. `canonical_products`
```sql
-- Primary product identification
-- Used for: product metadata, SKU count, basic product info
-- Migration: 20251203092225_create_canonical_products.ts
```

#### 2. `canonical_order_line_items`
```sql
-- Line-level transaction data
-- Used for: sales velocity, unit prices, estimated_unit_cost
-- Contains: quantity, unit_price, estimated_unit_cost
```

#### 3. Future: `inventory_truth` / WMS receipts
```sql
-- Inventory level tracking (migrations exist)
-- Used for: stockout risk calculations, days of cover
```

### SKU-OS Warehouse (Logical Fact Table)

The following logical fact table is seeded into InsightCore as `fact_product_health`:

```sql
CREATE TABLE fact_product_health (
  shop_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  health_score DECIMAL(5,2),        -- 0.00 to 100.00
  stockout_risk DECIMAL(4,3),       -- 0.000 to 1.000
  margin_health VARCHAR(16),        -- 'healthy', 'at_risk', 'critical', 'unknown'
  confidence VARCHAR(16),           -- 'low', 'medium', 'high'
  recalculated_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Primary key for unique identification per shop/product/time
  PRIMARY KEY (shop_id, product_id, recalculated_at)
);

-- Indexing strategy:
CREATE INDEX idx_fact_product_health_shop_product 
  ON fact_product_health (shop_id, product_id, recalculated_at DESC);
CREATE INDEX idx_fact_product_health_recalculated 
  ON fact_product_health (recalculated_at);
CREATE INDEX idx_fact_product_health_health_score 
  ON fact_product_health (shop_id, health_score);
```

**Note:** InsightCore blueprint already has this table; SKU-OS writes to it via events.

### Data Flow Architecture

```
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐
│   Canonical     │    │     SKU-OS        │    │   InsightCore   │
│     Sources     │───▶│   Processing      │───▶│    Warehouse    │
│                 │    │    Engine         │    │                 │
├─────────────────┤    ├───────────────────┤    ├─────────────────┤
│• canonical_     │    │• Health Score     │    │• fact_product_  │
│  products       │    │  Calculation      │    │  health         │
│• canonical_     │    │• Risk Assessment  │    │• Aggregated     │
│  order_line_    │    │• Event Emission   │    │  views          │
│  items          │    │                   │    │                 │
│• inventory_     │    │                   │    │                 │
│  truth (future) │    │                   │    │                 │
└─────────────────┘    └───────────────────┘    └─────────────────┘
```

### Key Relationships

#### 1. Product Identification
```sql
-- Link between canonical products and health data
SELECT 
  cp.product_id,
  cp.product_title,
  fph.health_score,
  fph.stockout_risk
FROM canonical_products cp
LEFT JOIN fact_product_health fph 
  ON cp.product_id = fph.product_id 
  AND cp.shop_id = fph.shop_id
WHERE fph.recalculated_at = (
  SELECT MAX(recalculated_at) 
  FROM fact_product_health 
  WHERE product_id = cp.product_id 
    AND shop_id = cp.shop_id
);
```

#### 2. Velocity Calculation Source
```sql
-- Example: Sales velocity from canonical order line items
SELECT 
  li.canonical_product_id AS product_id,
  COUNT(DISTINCT o.platform_order_id) AS order_count_30d,
  SUM(li.quantity) AS unit_sales_30d,
  SUM(li.quantity) / 30.0 AS avg_units_per_day
FROM canonical_order_line_items li
JOIN canonical_orders o 
  ON o.platform_order_id = li.platform_order_id 
  AND o.shop_id = li.shop_id
WHERE li.shop_id = :shopId 
  AND o.order_created_at >= NOW() - INTERVAL '30 days'
GROUP BY li.canonical_product_id;
```

#### 3. Inventory Integration (Future)
```sql
-- Days of cover calculation (requires inventory_truth)
SELECT 
  p.product_id,
  inv.on_hand,
  vel.avg_units_per_day,
  inv.on_hand / NULLIF(vel.avg_units_per_day, 0) AS days_of_cover
FROM (
  -- velocity subquery from above
  SELECT ... 
) vel
JOIN inventory_truth inv ON inv.sku = p.sku;
```

### Data Quality Requirements

#### 1. Completeness Rules
* All active products must have a `healthScore`
* Missing data should result in appropriate confidence levels
* Null values must be handled according to contract specifications

#### 2. Timeliness Requirements
* Daily recalculation for all products
* Event-driven updates within 2 minutes of relevant events
* Historical data retention: 90+ days for paid tiers

#### 3. Consistency Rules
* Health scores must be deterministic for identical inputs
* Confidence levels must reflect data availability and quality
* Historical trends must be preserved and queryable

### Performance Considerations

#### 1. Indexing Strategy
```sql
-- Critical indexes for performance:
-- 1. Product demand queries
CREATE INDEX idx_canonical_order_line_items_shop_product 
  ON canonical_order_line_items (shop_id, canonical_product_id, platform_order_id);

-- 2. Health fact table lookups
CREATE INDEX idx_fact_product_health_latest 
  ON fact_product_health (shop_id, product_id, recalculated_at DESC);

-- 3. Temporal queries
CREATE INDEX idx_fact_product_health_temporal 
  ON fact_product_health (recalculated_at, shop_id);
```

#### 2. Query Optimization
* Batch processing for large catalogs
* Incremental updates instead of full recalculations
* Materialized views for commonly accessed aggregations

#### 3. Storage Considerations
* Partitioning by `shop_id` for multi-tenant isolation
* Time-based partitioning for historical data
* Compression for older health records

### Migration & Evolution

#### 1. Schema Changes
* All schema changes require backward compatibility
* New fields must be nullable with default values
* Deprecated fields must be maintained during migration period

#### 2. Data Backfilling
* Automated backfilling for historical data
* Graceful handling of missing source data
* Progress tracking and resume capability

#### 3. Versioning Strategy
* Major version changes require new event contracts
* Minor updates maintain existing interfaces
* Deprecation warnings for upcoming changes

---