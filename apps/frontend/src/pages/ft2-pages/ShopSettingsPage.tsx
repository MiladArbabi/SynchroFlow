/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/ShopSettingsPage.tsx
//
// SHOP SETTINGS PAGE — /settings
// --------------------------------
// Consolidates all operational settings in one place.
// Sections: Carrier Cutoff · Fulfillment SLA · Cash Flow
//
// RULES:
// - No hardcoded hex. CSS variables or theme.palette.* only.
// - No inline style={}. MUI sx prop only.
// - Owner/admin only — enforced at route level.

import { useState, useEffect } from 'react';
import { Box, Typography, TextField, Button, Skeleton, Divider } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Clock, Package, TrendingUp } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import { useToast } from '../../contexts/ToastContext';

// ─── TYPES ────────────────────────────────────────────────────

type ShopSettings = {
  daily_cpt_local: string | null;
  fulfillment_sla_hours: number;
  monthly_overhead_amount: number | null;
  starting_cash_balance: number | null;
  starting_cash_balance_set_at: string | null;
};

// ─── HOOKS ────────────────────────────────────────────────────

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
    onError: (err) => {
      console.error('[ShopSettings] patch failed', err);
      show('Failed to save settings. Please try again.', 'error');
    },
  });
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: 11, fontWeight: 700, color: 'var(--ink-3)',
      textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75,
    }}>
      {children}
    </Typography>
  );
}

function SettingsCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const pal = useAppTheme();
  return (
    <Box sx={{
      background: pal.surface,
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <Box sx={{ px: 2.5, py: 1.75, borderBottom: `0.5px solid ${pal.rule}`, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ color: 'var(--ink-3)', flexShrink: 0 }}>{icon}</Box>
        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
            {title}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '1px' }}>
            {description}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ px: 2.5, py: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

function SaveButton({ dirty, saving, onSave }: { dirty: boolean; saving: boolean; onSave: () => void }) {
  const theme = useTheme();
  if (!dirty) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
      <Button
        size="small" variant="contained" onClick={onSave} disabled={saving}
        sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12 }}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Box>
  );
}

// ─── SECTION: CARRIER CUTOFF ──────────────────────────────────

function CarrierCutoffSection({ settings, saving, onSave }: {
  settings: ShopSettings | undefined;
  saving: boolean;
  onSave: (v: Partial<ShopSettings>) => void;
}) {
  const [cpt, setCpt] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings?.daily_cpt_local) {
      setCpt(settings.daily_cpt_local.slice(0, 5));
    } else {
      setCpt('');
    }
    setDirty(false);
  }, [settings?.daily_cpt_local]);

  return (
    <SettingsCard
      icon={<Clock size={16} />}
      title="Carrier Pickup Time"
      description="The daily cutoff time when your carrier collects. Drives the Zone 1 countdown and required UPH in Warehouse Analytics."
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box>
          <SectionLabel>Cutoff time (shop local time)</SectionLabel>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TextField
              type="time" size="small" value={cpt}
              onChange={(e) => { setCpt(e.target.value); setDirty(true); }}
              inputProps={{ style: { fontSize: 13 } }}
              sx={{ width: 140 }}
            />
            {cpt && (
              <Typography
                onClick={() => { setCpt(''); setDirty(true); }}
                sx={{ fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { color: 'var(--ink)' } }}
              >
                Clear
              </Typography>
            )}
          </Box>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }}>
            e.g. 16:00 for a 4pm carrier collection. Leave blank to hide CPT countdown.
          </Typography>
        </Box>
        <SaveButton
          dirty={dirty} saving={saving}
          onSave={() => onSave({ daily_cpt_local: cpt || null })}
        />
      </Box>
    </SettingsCard>
  );
}

// ─── SECTION: FULFILLMENT SLA ─────────────────────────────────

function FulfillmentSlaSection({ settings, saving, onSave }: {
  settings: ShopSettings | undefined;
  saving: boolean;
  onSave: (v: Partial<ShopSettings>) => void;
}) {
  const [sla, setSla] = useState('24');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings?.fulfillment_sla_hours != null) {
      setSla(String(settings.fulfillment_sla_hours));
    }
    setDirty(false);
  }, [settings?.fulfillment_sla_hours]);

  return (
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
          onSave={() => onSave({ fulfillment_sla_hours: Number(sla) })}
        />
      </Box>
    </SettingsCard>
  );
}

// ─── SECTION: CASH FLOW ───────────────────────────────────────

function CashFlowSection({ settings, saving, onSave, fmt }: {
  settings: ShopSettings | undefined;
  saving: boolean;
  onSave: (v: Partial<ShopSettings>) => void;
  fmt: (n: number | null) => string;
}) {
  const [overhead, setOverhead] = useState('');
  const [balance, setBalance] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setOverhead(settings?.monthly_overhead_amount != null ? String(settings.monthly_overhead_amount) : '');
    setBalance(settings?.starting_cash_balance != null ? String(settings.starting_cash_balance) : '');
    setDirty(false);
  }, [settings?.monthly_overhead_amount, settings?.starting_cash_balance]);

  return (
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
          onSave={() => onSave({
            monthly_overhead_amount: overhead ? Number(overhead) : undefined,
            starting_cash_balance: balance !== '' ? Number(balance) : undefined,
          })}
        />
      </Box>
    </SettingsCard>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────

export default function ShopSettingsPage() {
  const { data: settings, isLoading } = useShopSettings();
  const { mutate: patch, isPending: saving } = usePatchShopSettings();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const fmt = (n: number | null) => formatCurrencyCompact(n, displayCurrency, locale, rates);

  const handleSave = (updates: Partial<ShopSettings>) => {
    patch(updates);
  };

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: 2.5 }}>
      <Box sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
          Shop Settings
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '2px' }}>
          Operational configuration for your shop.
        </Typography>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} height={160} sx={{ borderRadius: '8px' }} />)}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}>
          <CarrierCutoffSection settings={settings} saving={saving} onSave={handleSave} />
          <FulfillmentSlaSection settings={settings} saving={saving} onSave={handleSave} />
          <CashFlowSection settings={settings} saving={saving} onSave={handleSave} fmt={fmt} />
        </Box>
      )}
    </Box>
  );
}