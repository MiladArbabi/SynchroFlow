import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import type { CustomersFT2Contract } from '@lasyncro/customers';

/**
 * useCustomersFt2Snapshot
 * ----------------------
 * Fetches authoritative FT2 Customers snapshot.
 *
 * Rules:
 * - Backend-owned facts
 * - Explicit time range
 * - Read-only
 * - No inference
 * - No transformation
 */
export function useCustomersFt2Snapshot(range: FT2DateRange) {
  return useQuery<CustomersFT2Contract>({
    queryKey: [
      'customers',
       'ft2',
        range.preset,
        range.from,
        range.to,
      ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/customers/ft2',
        {
        params:
          range.preset === 'custom'
            ? {
                preset: 'custom',
                from: range.from,
                to: range.to,
              }
            : {
                preset: range.preset,
            },
        });
      return data;
    },
  });
}