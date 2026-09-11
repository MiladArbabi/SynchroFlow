// apps/frontend/src/pages/orders/useAddressResolutionOrders.ts
//
// AUTHORITATIVE ADDRESS RESOLUTION SESSION CANDIDATES (OPS-RESOLVE-01, Slice C)
// ----------------------------------------------------------------------------
// Reads GET /api/v1/orders/address-resolution — the unelected server contract
// from Slice A — and maps its rows into the candidate shape
// AddressResolutionSessionModal accepts.
//
// NO BLOCKER OR ELECTION LOGIC LIVES HERE. Membership is decided entirely by
// the backend (is_active + constraint_type 'customer' + block_type
// 'incomplete_address', with no Flow election), so this hook must never filter,
// re-rank or second-guess the rows it receives. Duplicating that predicate in
// the frontend is exactly how the two surfaces would drift.
//
// Read-only: no mutation, no optimistic update. Address writes continue to
// invalidate through useShippingAddress's existing onSettled keys; this query is
// invalidated alongside them rather than being patched locally.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { axiosInstance } from 'api/axiosConfig';

import type { AddressResolutionCandidate } from './AddressResolutionSessionModal';

/**
 * Stable query key, following the ['orders', <surface>, …] convention used by
 * useConstrainedOrders (['orders', 'constrained', …]).
 */
export const ADDRESS_RESOLUTION_QUERY_KEY = ['orders', 'address-resolution'] as const;

/** One row exactly as the Slice A controller selects it. */
interface AddressResolutionRow {
  lasyncro_order_id: string;
  external_order_id: string | null;
  currency: string | null;
  total_price: string | number | null;
  blocked_since: string | null;
  shipping_name: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_zip: string | null;
  shipping_province: string | null;
  shipping_country_code: string | null;
  shipping_phone: string | null;
}

interface AddressResolutionResponse {
  data: AddressResolutionRow[];
}

/**
 * Authoritative order identity is the canonical lasyncro_order_id — the value
 * every downstream write (PATCH /orders/:orderId/shipping-address) and every
 * per-order oracle (GET /orders/:orderId/decision) is keyed by. The external
 * order number is display only, so it is never substituted for identity.
 */
function toCandidate(row: AddressResolutionRow): AddressResolutionCandidate {
  return {
    lasyncroOrderId: row.lasyncro_order_id,
    orderNumber: row.external_order_id ? `#${row.external_order_id}` : null,
  };
}

export function useAddressResolutionOrders(enabled = true) {
  const query = useQuery<AddressResolutionResponse>({
    queryKey: ADDRESS_RESOLUTION_QUERY_KEY,
    queryFn: async () => {
      // Unpaginated on purpose — the session's contract is "every currently
      // affected order", so a page boundary would silently redefine membership.
      const { data } = await axiosInstance.get('/api/v1/orders/address-resolution');
      return data;
    },
    enabled,
  });

  const candidates: AddressResolutionCandidate[] = (query.data?.data ?? []).map(toCandidate);

  return {
    candidates,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Invalidates the candidate query so membership is re-derived from the server.
 * Used when a session closes: canonical resolution must refresh authoritative
 * queries, never be simulated by locally removing rows or decrementing counts.
 */
export function useInvalidateAddressResolutionOrders() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ADDRESS_RESOLUTION_QUERY_KEY });
  }, [queryClient]);
}
