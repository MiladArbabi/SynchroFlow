// apps/frontend/src/pages/ft2-pages/ShopSettingsGeneralPage.tsx
//
// Settings → General tab
// ----------------------
// Fulfillment SLA

import { useState, useEffect } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { Package, RotateCcw } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { SettingsCard, SectionLabel, SaveButton, SettingsPageWrapper } from './ShopSettingsShared';
type ShopSettings = {
  fulfillment_sla_hours: number;
};
type ReturnsSettings = {
  returns_aging_warning_hours: number;
  returns_aging_critical_hours: number;
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

function useReturnsSettings() {
  return useQuery<ReturnsSettings>({
    queryKey: ['shop-settings', 'returns'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/returns/settings');
      return data;
    },
  });
}
function usePatchReturnsSettings() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, Partial<ReturnsSettings>>({
    mutationFn: async (body) => {
      await axiosInstance.patch('/api/v1/modules/returns/settings', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop-settings', 'returns'] });
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

  const { data: returnsSettings } = useReturnsSettings();
  const { mutate: patchReturns, isPending: savingReturns } = usePatchReturnsSettings();

  const [warningHours, setWarningHours]   = useState('48');
  const [criticalHours, setCriticalHours] = useState('168');
  const [returnsDirty, setReturnsDirty]   = useState(false);
  const [returnsError, setReturnsError]   = useState<string | null>(null);

  useEffect(() => {
    if (returnsSettings?.returns_aging_warning_hours != null) {
      setWarningHours(String(returnsSettings.returns_aging_warning_hours));
    }
    if (returnsSettings?.returns_aging_critical_hours != null) {
      setCriticalHours(String(returnsSettings.returns_aging_critical_hours));
    }
    setReturnsDirty(false);
  }, [returnsSettings?.returns_aging_warning_hours, returnsSettings?.returns_aging_critical_hours]);

  const handleSaveReturns = () => {
    const w = Number(warningHours);
    const c = Number(criticalHours);
    if (c <= w) {
      setReturnsError('Critical threshold must be greater than warning threshold.');
      return;
    }
    setReturnsError(null);
    patchReturns({ returns_aging_warning_hours: w, returns_aging_critical_hours: c });
  };

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

      <SettingsCard
        icon={<RotateCcw size={16} />}
        title="Returns Aging"
        description="How long an unclaimed return can sit before it's flagged as needing attention in the Returns module."
      >
        <Box>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <SectionLabel>Warning after</SectionLabel>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <TextField
                  type="number" size="small" value={warningHours}
                  onChange={(e) => { setWarningHours(e.target.value); setReturnsDirty(true); }}
                  inputProps={{ min: 1, max: 720, style: { fontSize: 13 } }}
                  sx={{ width: 100 }}
                />
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>hours</Typography>
              </Box>
            </Box>
            <Box>
              <SectionLabel>Critical after</SectionLabel>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <TextField
                  type="number" size="small" value={criticalHours}
                  onChange={(e) => { setCriticalHours(e.target.value); setReturnsDirty(true); }}
                  inputProps={{ min: 1, max: 2160, style: { fontSize: 13 } }}
                  sx={{ width: 100 }}
                />
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>hours</Typography>
              </Box>
            </Box>
          </Box>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 1 }}>
            Default: 48 hours warning, 168 hours (7 days) critical.
          </Typography>
          {returnsError && (
            <Typography sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
              {returnsError}
            </Typography>
          )}
          <SaveButton
            dirty={returnsDirty} saving={savingReturns}
            onSave={handleSaveReturns}
          />
        </Box>
      </SettingsCard>
    </SettingsPageWrapper>
  );
}