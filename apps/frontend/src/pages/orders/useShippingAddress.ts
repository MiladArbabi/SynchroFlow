// apps/frontend/src/pages/orders/useShippingAddress.ts
//
// useUpdateShippingAddress
// --------------------------
// Backs the in-app "correct shipping address" form (OF-08, 2026-07-02)
// — the primary resolution path for customer/incomplete_address blocks,
// instead of sending operators to Shopify. See
// orders.shipping-address.controller.ts for the backend side and why
// this is a direct write, not a domain event.
//
// No optimistic removal from the constrained list (unlike
// useExecuteOrderDecision) — deliberately: writing a corrected address
// doesn't synchronously clear the constraint. reconcileOrderFulfillment
// re-evaluates on its own poll cycle (~200ms, projection.db.worker.ts)
// and the constraint clears itself once it runs — optimistically
// removing the row here would be lying about state we don't actually
// know yet. The settled + delayed invalidation below (same 4s pattern
// as useExecuteOrderDecision) gives reconciliation time to catch up
// before the UI re-fetches.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface UpdateShippingAddressPayload {
  orderId: string;
  name?: string;
  address1: string;
  address2?: string;
  city: string;
  zip: string;
  phone?: string;
  province?: string;
  countryCode: string;
}

export function useUpdateShippingAddress() {
  const queryClient = useQueryClient();

  return useMutation<{ message: string }, Error, UpdateShippingAddressPayload>({
    mutationFn: async ({ orderId, ...body }) => {
      const { data } = await axiosInstance.patch(
        `/api/v1/orders/${orderId}/shipping-address`,
        body
      );
      return data;
    },
    onSettled: (_data, _error, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['orders', 'constrained'] });
      queryClient.invalidateQueries({ queryKey: ['order-nexus', 'ft2'] });
      queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders', 'decision', orderId] });

      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['orders', 'constrained'] });
        queryClient.invalidateQueries({ queryKey: ['order-nexus', 'ft2'] });
        queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
        queryClient.invalidateQueries({ queryKey: ['orders', 'decision', orderId] });
      }, 4000);
    },
  });
}