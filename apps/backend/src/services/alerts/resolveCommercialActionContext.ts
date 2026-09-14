// apps/backend/src/services/alerts/resolveCommercialActionContext.ts
//
// STOCK-PROTECT-03 Slice 3A — derives the small CommercialActionContext
// alertActionResolver needs from an already-built canonical AccessContext.
//
// Every decision here is delegated to @lasyncro/commercial-policy's
// evaluateAccess() + CAPABILITY_REQUIREMENTS — the single physical source of
// capability rules. No local tier hierarchy, no duplicated capability rule,
// no DB access. Callers build the AccessContext ONCE (per HTTP request, or
// once per shop for the Morning Brief) and pass it in here once — this
// function must never be called per alert row.

import { evaluateAccess, CAPABILITY_REQUIREMENTS } from '@lasyncro/commercial-policy';
import type { AccessContext } from '@lasyncro/commercial-policy';
import type { CommercialActionContext } from './alertActionResolver.js';

export function resolveCommercialActionContext(context: AccessContext): CommercialActionContext {
  return {
    stockProtectionAllowed: evaluateAccess(CAPABILITY_REQUIREMENTS['demand.forecasting'], context).allowed,
    sourcingAllowed: evaluateAccess(CAPABILITY_REQUIREMENTS['purchasing.sourcing'], context).allowed,
    purchasingCoreAllowed: evaluateAccess(CAPABILITY_REQUIREMENTS['purchasing.core'], context).allowed,
  };
}
