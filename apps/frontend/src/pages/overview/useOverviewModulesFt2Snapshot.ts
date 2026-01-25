import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { FT2DateRange } from '@lasyncro/ui-ft2';


export type OverviewModulesFt2Snapshot = {
  orders: {
    context?: {
      ordersObserved?: number | null;
    };
    totals?: {
      revenueTotal?: number | null;
      /**
       * Orders FT2 does not expose currency.
       * Overview must not reintroduce it.
       */
      // currency removed per FT2 contract
      /* currency?: string | null; */
    };
  } | null;

  products: {
    context?: {
      productsObserved?: number | null;
    };
  } | null;

  customers: {
    context?: {
      customersPresent?: boolean | null;
    };
  } | null;
};

export function useOverviewModulesFt2Snapshot(range: FT2DateRange) {
  return useQuery<OverviewModulesFt2Snapshot>({
    queryKey: ['overview', 'modules-ft2', range.preset],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/overview/modules-ft2',{
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