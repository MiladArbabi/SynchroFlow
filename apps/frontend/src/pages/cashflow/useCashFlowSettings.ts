// apps/frontend/src/pages/cashflow/useCashFlowSettings.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type CashFlowSettings = {
  monthly_overhead_amount: number | null;
  starting_cash_balance: number | null;
  starting_cash_balance_set_at: string | null;
};

export function useCashFlowSettings() {
  return useQuery<CashFlowSettings>({
    queryKey: ['cashflow', 'settings'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/cashflow/settings');
      return data;
    },
  });
}

export function useUpdateCashFlowSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<Pick<CashFlowSettings, 'monthly_overhead_amount' | 'starting_cash_balance'>>) => {
      await axiosInstance.patch('/api/v1/modules/cashflow/settings', updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
  });
}