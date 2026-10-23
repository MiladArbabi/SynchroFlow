// apps/frontend/src/pages/ft2-pages/ShopSettingsGeneralPage.tsx
//
// Settings → General tab
// ----------------------
// Fulfillment SLA

import { useState, useEffect } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
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
      const { data } = await axiosInstance.get('/api/v1/settings/shop/fulfillment-sla');
      return data;
    },
  });
}

function usePatchShopSettings() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, Partial<ShopSettings>>({
    mutationFn: async (body) => {
      await axiosInstance.patch('/api/v1/settings/shop/fulfillment-sla', body);
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
  const { data: settings, isLoading: loadingSla, isError: slaLoadError, isSuccess: slaLoaded } = useShopSettings();
  const { mutate: patch, isPending: saving } = usePatchShopSettings();
  const { show } = useToast();

  const [sla, setSla]         = useState('24');
  const [dirty, setDirty]     = useState(false);
  const [slaError, setSlaError] = useState<string | null>(null);

  // SLA-SETTINGS-SAVE-FEEDBACK-01 — minimal local success feedback for this
  // one Save CTA only (not the shared SaveButton, so Returns Aging's Save is
  // untouched). 'saved' shows "Saved ✓"; 'leaving' plays a short fade/scale
  // out before the button unmounts (or reverts to plain "Save" if the field
  // is dirty again by then).
  const [slaSaveFeedback, setSlaSaveFeedback] = useState<'idle' | 'saved' | 'leaving'>('idle');

  useEffect(() => {
    if (slaLoadError) show('Failed to load fulfillment SLA. Please refresh and try again.', 'error');
  }, [slaLoadError, show]);

  useEffect(() => {
    // Only seed from real data — never conflate "no data yet" (loading/error)
    // with "the value happens to be 24" (the shared default).
    if (slaLoaded && settings?.fulfillment_sla_hours != null) {
      setSla(String(settings.fulfillment_sla_hours));
      setDirty(false);
    }
  }, [slaLoaded, settings?.fulfillment_sla_hours]);

  useEffect(() => {
    if (slaSaveFeedback !== 'saved') return;
    const t = setTimeout(() => setSlaSaveFeedback('leaving'), 600);
    return () => clearTimeout(t);
  }, [slaSaveFeedback]);

  useEffect(() => {
    if (slaSaveFeedback !== 'leaving') return;
    const t = setTimeout(() => setSlaSaveFeedback('idle'), 150);
    return () => clearTimeout(t);
  }, [slaSaveFeedback]);

  const handleSaveSla = () => {
    const val = Number(sla);
    if (!Number.isInteger(val) || val < 1 || val > 720) {
      setSlaError('Hours to fulfill must be a whole number between 1 and 720.');
      return;
    }
    setSlaError(null);
    patch(
      { fulfillment_sla_hours: val },
      { onSuccess: () => setSlaSaveFeedback('saved') }
    );
  };

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
          {loadingSla ? (
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }} data-testid="sla-loading">
              Loading…
            </Typography>
          ) : slaLoadError ? (
            <Typography sx={{ fontSize: 12, color: 'error.main' }} data-testid="sla-load-error">
              Failed to load fulfillment SLA. Please refresh and try again.
            </Typography>
          ) : (
            <>
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
              {slaError && (
                <Typography sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
                  {slaError}
                </Typography>
              )}
              {(dirty || slaSaveFeedback !== 'idle') && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                  <Button
                    size="small" variant="contained"
                    onClick={handleSaveSla}
                    disabled={saving || slaSaveFeedback !== 'idle'}
                    data-testid="sla-save-button"
                    sx={{
                      bgcolor: slaSaveFeedback !== 'idle' ? 'success.main' : 'var(--accent)',
                      color: slaSaveFeedback !== 'idle' ? 'success.contrastText' : 'var(--accent-ink)',
                      '&:hover': {
                        bgcolor: slaSaveFeedback !== 'idle' ? 'success.main' : 'var(--accent)',
                        opacity: 0.88,
                      },
                      '&:active': {
                        transform: slaSaveFeedback === 'idle' ? 'scale(0.97)' : undefined,
                      },
                      transition: 'transform 150ms ease, opacity 150ms ease, background-color 150ms ease',
                      opacity: slaSaveFeedback === 'leaving' ? 0 : 1,
                      transform: slaSaveFeedback === 'leaving' ? 'scale(0.95)' : 'scale(1)',
                      fontSize: 12,
                    }}
                  >
                    {slaSaveFeedback !== 'idle' ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
                  </Button>
                </Box>
              )}
            </>
          )}
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
