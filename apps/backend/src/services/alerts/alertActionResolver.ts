// apps/backend/src/services/alerts/alertActionResolver.ts
//
// STOCK-PROTECT-03 Slice 3A — shared, pure Stock Protection alert-action
// resolver. Owns the ENTIRE alert_type='stock_protection' treatment-to-
// action-and-eligibility boundary. Consumed by BOTH GET /api/v1/alerts
// (alerts.controller.ts) and overviewMorningBrief.resolver.ts — there must
// never be a second, independently-maintained treatment→route map anywhere.
//
// Pure: no DB access, no Express dependency, no Knex dependency, no local
// tier-rank implementation. Callers resolve CommercialActionContext once
// (per request, or once per shop for the Morning Brief) via
// resolveCommercialActionContext.ts + @lasyncro/commercial-policy, then pass
// it in here — this module never re-derives tier/module/feature access
// itself.
//
// DARK: this module does not write anything and is not itself a producer of
// stock_protection alert rows.

export type CommercialActionContext = {
  stockProtectionAllowed: boolean;
  sourcingAllowed: boolean;
  purchasingCoreAllowed: boolean;
};

export type StockProtectionTreatment =
  | 'none'
  | 'reorder_now'
  | 'finish_reorder'
  | 'receive_inbound'
  | 'complete_setup';

export type StockProtectionActionKey =
  | 'stock_protection_reorder_now'
  | 'stock_protection_finish_reorder'
  | 'stock_protection_receive_inbound';

export type AlertAction = Readonly<{
  key: StockProtectionActionKey;
  label: string;
  route: string;
  module: 'suppliers-portal';
}>;

/** Minimal shape of an `alerts` row this resolver needs. */
export type AlertActionInput = {
  alert_type: string;
  treatment: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_active: boolean;
  resolved_at: string | Date | null;
};

/**
 * Pure eligibility predicate shared with resolveAlertAction below — the SAME
 * two booleans gate both "which treatments may enter a Morning Brief
 * candidate query" (getActionableStockProtectionTreatments) and "does THIS
 * row currently resolve to a real action" (resolveAlertAction). Kept as one
 * small set of named predicates so the two call sites cannot drift.
 */
function isReorderNowOrFinishReorderEligible(context: CommercialActionContext): boolean {
  return context.stockProtectionAllowed && context.sourcingAllowed;
}

function isReceiveInboundEligible(context: CommercialActionContext): boolean {
  return context.stockProtectionAllowed && context.purchasingCoreAllowed;
}

/**
 * Which Stock Protection treatments could currently produce a non-null
 * action for this shop's commercial context — used to constrain a candidate
 * query BEFORE ranking/LIMIT, never to decide a specific row's action
 * (that's resolveAlertAction's job, and every admitted row must still pass
 * through it — see overviewMorningBrief.resolver.ts).
 *
 * complete_setup is NEVER included: no capable configuration destination
 * exists yet. 'none' is never included: it does not correspond to an active
 * alert row at all. Unknown treatments are never included by construction —
 * this is an explicit enumeration, not a pass-through.
 */
export function getActionableStockProtectionTreatments(
  context: CommercialActionContext,
): readonly StockProtectionTreatment[] {
  if (!context.stockProtectionAllowed) return [];

  const treatments: StockProtectionTreatment[] = [];
  if (isReorderNowOrFinishReorderEligible(context)) {
    treatments.push('reorder_now', 'finish_reorder');
  }
  if (isReceiveInboundEligible(context)) {
    treatments.push('receive_inbound');
  }
  return treatments;
}

/**
 * Resolves the merchant-facing action for one alert row. Returns null
 * whenever: the row isn't stock_protection, it's inactive/resolved, its
 * entity identity is malformed, its treatment is complete_setup/none/
 * unrecognized, or the shop's commercial context doesn't currently permit
 * the destination that treatment implies.
 *
 * finish_reorder resolves to the SAME route as reorder_now (targeted
 * Sourcing already resolves pending-request-vs-draft-PO internally once the
 * merchant lands there — ratified STOCK-PROTECT-03 Slice 3 design) — only
 * the action key/label differ.
 */
export function resolveAlertAction(
  alert: AlertActionInput,
  commercialContext: CommercialActionContext,
): AlertAction | null {
  if (alert.alert_type !== 'stock_protection') return null;
  if (alert.is_active !== true) return null;
  if (alert.resolved_at != null) return null;
  if (alert.entity_type !== 'variant') return null;
  if (!alert.entity_id) return null;

  const variantId = encodeURIComponent(alert.entity_id);

  switch (alert.treatment as StockProtectionTreatment | null) {
    case 'reorder_now':
      if (!isReorderNowOrFinishReorderEligible(commercialContext)) return null;
      return {
        key: 'stock_protection_reorder_now',
        label: 'Reorder now',
        route: `/suppliers-portal/sourcing?variantId=${variantId}`,
        module: 'suppliers-portal',
      };

    case 'finish_reorder':
      if (!isReorderNowOrFinishReorderEligible(commercialContext)) return null;
      return {
        key: 'stock_protection_finish_reorder',
        label: 'Finish reorder',
        route: `/suppliers-portal/sourcing?variantId=${variantId}`,
        module: 'suppliers-portal',
      };

    case 'receive_inbound':
      if (!isReceiveInboundEligible(commercialContext)) return null;
      return {
        key: 'stock_protection_receive_inbound',
        label: 'Receive inbound',
        route: '/suppliers-portal',
        module: 'suppliers-portal',
      };

    case 'complete_setup':
    case 'none':
    default:
      // complete_setup: no capable configuration UI exists yet.
      // none: not an active-alert-worthy state.
      // anything else: unrecognized treatment — fail safe, never guess.
      return null;
  }
}
