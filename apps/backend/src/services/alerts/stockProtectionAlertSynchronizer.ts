import type { Knex } from 'knex';
import { evaluateStockProtectionForShop } from '../inventory/stockProtectionMonitoring.js';

const HISTORICAL_REPLENISHMENT_ALERT_TYPES = [
  'low_stock_reorder',
  'stockout_risk',
  'reorder_warning',
] as const;

type StockProtectionSeverity = 'critical' | 'warning' | 'info';

type StockProtectionEvaluation = Awaited<ReturnType<typeof evaluateStockProtectionForShop>>[number];
type ActiveStockProtectionTreatment = Extract<
  StockProtectionEvaluation['treatment'],
  'reorder_now' | 'finish_reorder' | 'receive_inbound' | 'complete_setup'
>;

const ACTIVE_STOCK_PROTECTION_TREATMENTS: ReadonlySet<ActiveStockProtectionTreatment> = new Set([
  'reorder_now',
  'finish_reorder',
  'receive_inbound',
  'complete_setup',
]);

function severityForUrgency(reorderUrgency: StockProtectionEvaluation['reorder_urgency']): StockProtectionSeverity {
  if (reorderUrgency === 'critical') return 'critical';
  if (reorderUrgency === 'warning' || reorderUrgency === 'planning_data_required') return 'warning';
  return 'info';
}

function isActiveTreatment(treatment: StockProtectionEvaluation['treatment'] | string): boolean {
  return ACTIVE_STOCK_PROTECTION_TREATMENTS.has(treatment as ActiveStockProtectionTreatment);
}

function titleForEvaluation(evaluation: StockProtectionEvaluation): string {
  switch (evaluation.treatment) {
    case 'reorder_now':
      return 'Stock protection needs reorder';
    case 'finish_reorder':
      return 'Stock protection reorder in progress';
    case 'receive_inbound':
      return 'Stock protection inbound ready';
    case 'complete_setup':
      return 'Stock protection setup needed';
    default:
      return 'Stock protection healthy';
  }
}

function messageForEvaluation(evaluation: StockProtectionEvaluation): string {
  switch (evaluation.treatment) {
    case 'reorder_now':
      return 'This variant needs replenishment to protect future orders.';
    case 'finish_reorder':
      return 'This variant already has replenishment work in progress.';
    case 'receive_inbound':
      return 'This variant has inbound stock ready to receive.';
    case 'complete_setup':
      return 'This variant needs planning data before Stock Protection can recommend replenishment.';
    default:
      return 'This variant no longer needs a Stock Protection action.';
  }
}

async function resolveCanonicalRows(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[],
): Promise<number> {
  const query = trx('alerts')
    .where({
      shop_id: shopId,
      alert_type: 'stock_protection',
      entity_type: 'variant',
      is_active: true,
    })
    .update({
      is_active: false,
      resolved_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

  if (variantIds !== undefined) {
    if (variantIds.length === 0) return 0;
    query.whereIn('entity_id', variantIds);
  }

  return query;
}

async function resolveHistoricalRows(trx: Knex.Transaction, shopId: number): Promise<number> {
  return trx('alerts')
    .where({ shop_id: shopId, is_active: true })
    .whereIn('alert_type', HISTORICAL_REPLENISHMENT_ALERT_TYPES)
    .update({
      is_active: false,
      resolved_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
}

export async function syncStockProtectionAlertsForShop(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[],
): Promise<void> {
  if (variantIds !== undefined && variantIds.length === 0) {
    return;
  }

  const evaluations = await evaluateStockProtectionForShop(trx, shopId, variantIds);
  const evaluatedVariantIds = evaluations.map((evaluation) => evaluation.lasyncro_variant_id);

  for (const evaluation of evaluations) {
    const variantId = evaluation.lasyncro_variant_id;
    const active = isActiveTreatment(evaluation.treatment);

    await trx('alerts')
      .insert({
        shop_id: shopId,
        alert_key: `stock_protection:${variantId}`,
        source: 'stock_protection',
        alert_type: 'stock_protection',
        severity: severityForUrgency(evaluation.reorder_urgency),
        title: titleForEvaluation(evaluation),
        message: messageForEvaluation(evaluation),
        entity_type: 'variant',
        entity_id: variantId,
        treatment: evaluation.treatment,
        is_active: active,
        resolved_at: active ? null : trx.fn.now(),
        category: 'stock_reorder',
        audience: 'all',
        updated_at: trx.fn.now(),
      })
      .onConflict(['shop_id', 'alert_key'])
      .merge({
        source: 'stock_protection',
        alert_type: 'stock_protection',
        severity: severityForUrgency(evaluation.reorder_urgency),
        title: titleForEvaluation(evaluation),
        message: messageForEvaluation(evaluation),
        entity_type: 'variant',
        entity_id: variantId,
        treatment: evaluation.treatment,
        is_active: active,
        resolved_at: active ? null : trx.fn.now(),
        dismissed_at: active ? null : trx.raw('"alerts"."dismissed_at"'),
        category: 'stock_reorder',
        audience: 'all',
        updated_at: trx.fn.now(),
      });
  }

  const staleQuery = trx('alerts')
    .where({
      shop_id: shopId,
      alert_type: 'stock_protection',
      entity_type: 'variant',
      is_active: true,
    })
    .update({
      is_active: false,
      resolved_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

  if (variantIds !== undefined) {
    staleQuery.whereIn('entity_id', variantIds);
  }
  if (evaluatedVariantIds.length > 0) {
    staleQuery.whereNotIn('entity_id', evaluatedVariantIds);
  }
  if (evaluatedVariantIds.length > 0 || variantIds === undefined) {
    await staleQuery;
  } else {
    await resolveCanonicalRows(trx, shopId, variantIds);
  }

  if (variantIds === undefined) {
    await resolveHistoricalRows(trx, shopId);
  }
}
