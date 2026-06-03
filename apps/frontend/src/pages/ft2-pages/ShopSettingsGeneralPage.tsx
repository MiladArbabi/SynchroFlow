// apps/frontend/src/pages/ft2-pages/ShopSettingsGeneralPage.tsx
//
// Settings → General tab
// ----------------------
// Fulfillment SLA

import { useState, useEffect } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { Package } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { SettingsCard, SectionLabel, SaveButton, SettingsPageWrapper } from './ShopSettingsShared';

type ShopSettings = {
  fulfillment_sla_hours: number;
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
      show('Settings saved', 'success');
    },
    onError: () => show('Failed to save settings. Please try again.', 'error'),
  });
}

export default function ShopSettingsGeneralPage() {
  const { data: settings } = useShopSettings();
  const { mutate: patch, isPending: saving } = usePatchShopSettings();

  const [sla, setSla]     = useState('24');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings?.fulfillment_sla_hours != null) setSla(String(settings.fulfillment_sla_hours));
    setDirty(false);
  }, [settings?.fulfillment_sla_hours]);

  return (
    <SettingsPageWrapper>
      <SettingsCard
        icon={<Package size={16} />}
        title="Fulfillment SLA"
        description="Maximum hours allowed between payment and fulfillment. Orders exceeding this are flagged as SLA-breached in the Orders module."
      >
        <Box>
          <SectionLabel>Hours to fulfill</SectionLabel>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TextField
              type="number" size="small" value={sla}
              onChange={(e) => { setSla(e.target.value); setDirty(true); }}
              inputProps={{ min: 1, max: 720, style: { fontSize: 13 } }}
              sx={{ width: 100 }}
            />
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>hours</Typography>
          </Box>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }}>
            Default: 24 hours. Max: 720 hours (30 days).
          </Typography>
          <SaveButton
            dirty={dirty} saving={saving}
            onSave={() => patch({ fulfillment_sla_hours: Number(sla) })}
          />
        </Box>
      </SettingsCard>
    </SettingsPageWrapper>
  );
}
