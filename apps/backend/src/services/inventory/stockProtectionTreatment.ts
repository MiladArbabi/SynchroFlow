// apps/backend/src/services/inventory/stockProtectionTreatment.ts
//
// STOCK-PROTECT-03 Slice 1 — pure Stock Protection treatment decision rule.
// ============================================================================
// deriveStockProtectionTreatment(input) is a PURE function: no DB, no
// network, no transaction, no clock. It performs NO quantity estimation, NO
// inbound subtraction, NO PO quantity aggregation, and NO urgency
// derivation — those all remain the responsibility of
// computeVariantPlanning (canonical Demand planning authority) and, for
// action evidence (pending reorder requests / draft POs / committed POs /
// receiving-boundary POs), a separate monitoring/evidence service not yet
// introduced in this slice.
//
// This module deliberately does not import computeVariantPlanning, any DB
// module, alerts services, reorder request services, PO services, or worker
// modules — the input contract below is a small local type describing only
// the canonical facts this function is allowed to branch on.
//
// MERCHANT-FACING VOCABULARY ONLY: the five StockProtectionTreatment values
// are the only outputs. Internal lifecycle terms (draft/committed/receiving
// boundary/pending) are evidence inputs, never returned or exposed.

export type ReorderUrgency =
  | 'critical'
  | 'warning'
  | 'healthy'
  | 'planning_data_required'
  | 'no_velocity';

export type StockProtectionTreatment =
  | 'none'
  | 'reorder_now'
  | 'finish_reorder'
  | 'receive_inbound'
  | 'complete_setup';

export interface StockProtectionActionEvidence {
  hasPendingReorderRequest: boolean;
  hasDraftPo: boolean;
  hasCommittedPo: boolean;
  hasReceivingBoundaryPo: boolean;
}

export interface StockProtectionTreatmentInput {
  reorderUrgency: ReorderUrgency;
  suggestedReorderQty: number | null;
  actionEvidence: StockProtectionActionEvidence;
}

export function deriveStockProtectionTreatment(
  input: StockProtectionTreatmentInput,
): StockProtectionTreatment {
  const { reorderUrgency, suggestedReorderQty, actionEvidence } = input;

  if (reorderUrgency === 'planning_data_required') {
    return 'complete_setup';
  }

  if (reorderUrgency === 'healthy' || reorderUrgency === 'no_velocity') {
    return 'none';
  }

  if (actionEvidence.hasReceivingBoundaryPo) {
    return 'receive_inbound';
  }

  if (
    actionEvidence.hasCommittedPo &&
    suggestedReorderQty !== null &&
    suggestedReorderQty <= 0
  ) {
    return 'none';
  }

  if (actionEvidence.hasPendingReorderRequest || actionEvidence.hasDraftPo) {
    return 'finish_reorder';
  }

  return 'reorder_now';
}
