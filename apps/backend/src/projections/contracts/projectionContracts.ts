export type ProjectionContract = {
  projection: string;
  table: string;
  requiredColumns: string[];
};

export const projectionContracts: ProjectionContract[] = [

  {
    projection: 'orderAgeProjection',
    table: 'order_age_snapshot',
    requiredColumns: [
      'lasyncro_order_id',
      'aggregate_version',
      'age_since_creation_seconds',
      'age_since_paid_seconds',
      'age_since_fulfillment_seconds',
      'snapshot_generated_at'
    ]
  },

  {
    projection: 'orderMarginProjection',
    table: 'order_margin_snapshot',
    requiredColumns: [
      'lasyncro_order_id',
      'aggregate_version',
      'shop_id',
      'gross_revenue',
      'estimated_cost',
      'gross_margin',
      'margin_pct',
      'evaluated_at'
    ]
  },

  {
    projection: 'orderRiskProjection',
    table: 'order_risk_snapshot',
    requiredColumns: [
      'lasyncro_order_id',
      'shop_id',
      'order_health_score',
      'is_inventory_blocked',
      'is_customer_blocked',
      'is_operational_blocked',
      'is_at_risk',
      'fraud_score',
      'return_probability',
      'evaluated_at'
    ]
  },

  {
    projection: 'orderRevenueDailyProjection',
    table: 'revenue_projection_daily',
    requiredColumns: [
      'shop_id',
      'revenue_date',
      'gross_revenue',
      'order_count',
      'at_risk_revenue',
      'evaluated_at'
    ]
  },

  {
    projection: 'dailyOperationalBriefProjection',
    table: 'daily_operational_brief_snapshot',
    requiredColumns: [
      'shop_id',
      'brief_date',
      'inventory_blocked_revenue',
      'cash_realized_today',
      'refund_exposure',
      'top_10_priority_order_ids',
      'evaluated_at'
    ]
  }

];