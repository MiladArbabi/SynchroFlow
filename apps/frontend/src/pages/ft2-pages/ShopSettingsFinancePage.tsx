// apps/frontend/src/pages/ft2-pages/ShopSettingsFinancePage.tsx
//
// Settings → Finance tab
// ----------------------
// Cash Flow Inputs

import { useState, useEffect } from 'react';
import { Box, TextField, Typography, Divider } from '@mui/material';
import { TrendingUp } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import { SettingsCard, SectionLabel, SaveButton, SettingsPageWrapper } from './ShopSettingsShared';

type ShopSettings = {
  monthly_overhead_amount: number | null;
  starting_cash_balance: number | null;
  starting_cash_balance_set_at: string | null;
};

function useShopSettings() {
  return useQuery<ShopSettings>({
    queryKey: ['shop-settings', 'operational'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/cashflow/settings');
      return data;
    },
  });
}

function usePatchShopSettings() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, Partial<ShopSettings>>({
    mutationFn: async (body) => {
      await axiosInstance.patch('/api/v1/modules/cashflow/settings', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop-settings', 'operational'] });
      queryClient.invalidateQueries({ queryKey: ['wms', 'analytics', 'live'] });
      show('Settings saved', 'success');
    },
    onError: () => show('Failed to save settings. Please try again.', 'error'),
  });
}

export default function ShopSettingsFinancePage() {
  const { data: settings } = useShopSettings();
  const { mutate: patch, isPending: saving } = usePatchShopSettings();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  const [overhead, setOverhead] = useState('');
  const [balance,  setBalance]  = useState('');
  const [dirty,    setDirty]    = useState(false);

  useEffect(() => {
    setOverhead(settings?.monthly_overhead_amount != null ? String(settings.monthly_overhead_amount) : '');
    setBalance(settings?.starting_cash_balance != null ? String(settings.starting_cash_balance) : '');
    setDirty(false);
  }, [settings?.monthly_overhead_amount, settings?.starting_cash_balance]);

  return (
    <SettingsPageWrapper>
      <SettingsCard
        icon={<TrendingUp size={16} />}
        title="Cash Flow Inputs"
        description="Fixed monthly costs and starting balance used for cash flow projection in the Cash Flow module."
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box>
            <SectionLabel>Monthly overhead</SectionLabel>
            <TextField
              type="number" size="small" value={overhead}
              placeholder="e.g. 5000"
              onChange={(e) => { setOverhead(e.target.value); setDirty(true); }}
              inputProps={{ min: 0, step: 0.01, style: { fontSize: 13 } }}
              sx={{ width: 200 }}
            />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }}>
              Fixed monthly costs (rent, salaries, etc.) deducted in projections.
            </Typography>
          </Box>
          <Divider sx={{ borderColor: 'var(--rule)' }} />
          <Box>
            <SectionLabel>Starting cash balance</SectionLabel>
            <TextField
              type="number" size="small" value={balance}
              placeholder="e.g. 20000"
              onChange={(e) => { setBalance(e.target.value); setDirty(true); }}
              inputProps={{ step: 0.01, style: { fontSize: 13 } }}
              sx={{ width: 200 }}
            />
            {settings?.starting_cash_balance_set_at && (
              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }}>
                Last set {new Date(settings.starting_cash_balance_set_at).toLocaleDateString()}
              </Typography>
            )}
          </Box>
          <SaveButton
            dirty={dirty} saving={saving}
            onSave={() => patch({
              monthly_overhead_amount: overhead ? Number(overhead) : undefined,
              starting_cash_balance:   balance  !== '' ? Number(balance) : undefined,
            })}
          />
        </Box>
      </SettingsCard>
    </SettingsPageWrapper>
  );
}
