// OVERAGE_DISABLED is resolved by changing the merchant's allow_overage
// preference, not by upgrading. Telling that merchant to upgrade would be wrong.
// ACTION_FORBIDDEN / NO_ROLE_ASSIGNED / FORBIDDEN / CANNOT_REVOKE_OWNER are
// role denials. Upgrading does not resolve them. Tracked as
// ENT-MEMBERS-403-BLANK-151.

export const ENTITLEMENT_DENIAL_CODES = Object.freeze([
  'TIER_INSUFFICIENT',
  'TIER_INSUFFICIENT_FIELD',
  'COLUMN_SELECTION_REQUIRES_GROWTH',
  'SEAT_LIMIT_REACHED',
  'SHIPPED_ORDER_CAP_REACHED',
] as const);

type EntitlementDenialCode = typeof ENTITLEMENT_DENIAL_CODES[number];

type ErrorWithResponse = {
  response?: {
    status?: unknown;
    data?: {
      error?: unknown;
    };
  };
};

function hasResponse(error: unknown): error is ErrorWithResponse {
  return typeof error === 'object' && error !== null && 'response' in error;
}

export function isEntitlementDenial(error: unknown): boolean {
  if (!hasResponse(error)) return false;
  if (error.response?.status !== 403) return false;

  const code = error.response.data?.error;
  return ENTITLEMENT_DENIAL_CODES.includes(code as EntitlementDenialCode);
}
