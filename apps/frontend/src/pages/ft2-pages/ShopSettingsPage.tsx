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
import { Box, Typography, TextField, Button, Skeleton, Divider, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Clock, Package, TrendingUp, Monitor, Copy, RotateCcw, Trash2, Plus } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import { useToast } from '../../contexts/ToastContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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

// ─── FLOOR DISPLAY TOKENS ─────────────────────────────────────

type DisplayToken = {
  id: string;
  label: string | null;
  created_at: string;
  rotated_at: string | null;
  last_seen_at: string | null;
  active: boolean;
};

function useDisplayTokens() {
  return useQuery<{ tokens: DisplayToken[] }>({
    queryKey: ['display-tokens'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/analytics/display-tokens');
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useCreateDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<{ id: string; raw_token: string; label: string | null }, Error, { label: string }>({
    mutationFn: async (body) => {
      const { data } = await axiosInstance.post('/api/v1/wms/analytics/display-tokens', body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: (err) => { console.error('[DisplayTokens] create failed', err); show('Failed to create token', 'error'); },
  });
}

function usePatchDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, { id: string; label: string }>({
    mutationFn: async ({ id, label }) => { await axiosInstance.patch(`/api/v1/wms/analytics/display-tokens/${id}`, { label }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: (err) => { console.error('[DisplayTokens] patch failed', err); show('Failed to rename token', 'error'); },
  });
}

function useRotateDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<{ raw_token: string }, Error, string>({
    mutationFn: async (id) => {
      const { data } = await axiosInstance.post(`/api/v1/wms/analytics/display-tokens/${id}/rotate`);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: (err) => { console.error('[DisplayTokens] rotate failed', err); show('Failed to rotate token', 'error'); },
  });
}

function useRevokeDisplayToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => { await axiosInstance.delete(`/api/v1/wms/analytics/display-tokens/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['display-tokens'] }),
    onError: (err) => { console.error('[DisplayTokens] revoke failed', err); show('Failed to revoke token', 'error'); },
  });
}

function FloorDisplaySection() {
  const pal = useAppTheme();
  const theme = useTheme();
  const { show } = useToast();
  const { data, isLoading } = useDisplayTokens();
  const { mutate: createToken, isPending: isCreating, data: newTokenData, reset: resetCreate } = useCreateDisplayToken();
  const { mutate: patchToken } = usePatchDisplayToken();
  const { mutate: rotateToken, data: rotatedData, reset: resetRotate } = useRotateDisplayToken();
  const { mutate: revokeToken } = useRevokeDisplayToken();

  const [newLabel, setNewLabel] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [revealedToken, setRevealedToken] = useState<{ id: string; raw: string } | null>(null);

  const tokens = data?.tokens ?? [];
  const activeCount = tokens.filter(t => t.active).length;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => show('Copied to clipboard', 'success'));
  };

  const buildDisplayUrl = (raw: string) =>
    `${window.location.origin}/wms/analytics/display?token=${encodeURIComponent(raw)}`;

  const handleCreate = () => {
    createToken({ label: newLabel || 'Display TV' }, {
      onSuccess: (d) => {
        setRevealedToken({ id: d.id, raw: d.raw_token });
        setNewLabel('');
        setShowCreate(false);
      },
    });
  };

  const handleRotate = (id: string) => {
    if (!window.confirm('Rotating will immediately invalidate the current URL on all displays using this token. Continue?')) return;
    rotateToken(id, {
      onSuccess: (d) => setRevealedToken({ id, raw: d.raw_token }),
    });
  };

  const handleRevoke = (id: string) => {
    if (!window.confirm('This will permanently revoke this display URL. Any TV using it will stop updating.')) return;
    revokeToken(id);
    if (revealedToken?.id === id) setRevealedToken(null);
  };

  return (
    <SettingsCard
      icon={<Monitor size={16} />}
      title="Floor Display"
      description="Generate token-bound URLs for warehouse TVs. Displays show team pace and pipeline — no operator names."
    >
      {/* ACTIVE COUNTER */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: activeCount > 0 ? 'success.main' : 'var(--ink-4)', flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {activeCount > 0 ? `${activeCount} display${activeCount > 1 ? 's' : ''} active` : 'No active displays'}
          </Typography>
        </Box>
        <Box
          onClick={() => setShowCreate(true)}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.8 } }}
        >
          <Plus size={13} strokeWidth={2} />
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>New display URL</Typography>
        </Box>
      </Box>

      {/* CREATE FORM */}
      {showCreate && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, p: 1.25, bgcolor: 'var(--bg-2)', borderRadius: '6px', border: `0.5px solid ${pal.rule}` }}>
          <TextField
            size="small" placeholder="Label (e.g. Warehouse main)" value={newLabel} autoFocus
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            inputProps={{ style: { fontSize: 12 } }}
            sx={{ flex: 1 }}
          />
          <Button size="small" variant="contained" onClick={handleCreate} disabled={isCreating}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12, flexShrink: 0 }}>
            {isCreating ? 'Creating…' : 'Create'}
          </Button>
          <Button size="small" onClick={() => setShowCreate(false)} sx={{ fontSize: 12, flexShrink: 0 }}>Cancel</Button>
        </Box>
      )}

      {/* REVEALED TOKEN — shown once after create or rotate */}
      {revealedToken && (
        <Box sx={{ mb: 1.5, p: 1.25, bgcolor: 'rgba(34,197,94,0.06)', border: '0.5px solid rgba(34,197,94,0.3)', borderRadius: '6px' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#22C55E', mb: 0.5 }}>
            Copy this URL now — it won't be shown again.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: 11, color: 'var(--ink)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {buildDisplayUrl(revealedToken.raw)}
            </Typography>
            <Box onClick={() => copyToClipboard(buildDisplayUrl(revealedToken.raw))}
              sx={{ cursor: 'pointer', color: 'var(--accent)', flexShrink: 0, '&:hover': { opacity: 0.8 } }}>
              <Copy size={13} />
            </Box>
            <Box onClick={() => setRevealedToken(null)}
              sx={{ cursor: 'pointer', color: 'var(--ink-4)', flexShrink: 0, '&:hover': { color: 'var(--ink)' } }}>
              <Trash2 size={13} />
            </Box>
          </Box>
        </Box>
      )}

      {/* TOKEN LIST */}
      {isLoading && <Skeleton height={48} sx={{ borderRadius: '6px' }} />}

      {!isLoading && tokens.length === 0 && !showCreate && (
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
          No display URLs yet. Create one to cast to a warehouse TV.
        </Typography>
      )}

      {!isLoading && tokens.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {tokens.map(token => (
            <Box key={token.id} sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              p: 1, borderRadius: '6px',
              bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
            }}>
              {/* ACTIVE DOT */}
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: token.active ? 'success.main' : 'var(--rule)', flexShrink: 0 }} />

              {/* LABEL */}
              {editingId === token.id ? (
                <TextField
                  size="small" value={editingLabel} autoFocus
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={() => { patchToken({ id: token.id, label: editingLabel }); setEditingId(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { patchToken({ id: token.id, label: editingLabel }); setEditingId(null); } if (e.key === 'Escape') setEditingId(null); }}
                  inputProps={{ style: { fontSize: 12, padding: '2px 6px' } }}
                  sx={{ flex: 1 }}
                />
              ) : (
                <Typography
                  onClick={() => { setEditingId(token.id); setEditingLabel(token.label ?? ''); }}
                  sx={{ fontSize: 12, color: 'var(--ink)', flex: 1, cursor: 'text', '&:hover': { color: 'var(--accent)' } }}
                >
                  {token.label || 'Unlabelled display'}
                </Typography>
              )}

              {/* LAST SEEN */}
              <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
                {token.last_seen_at
                  ? `seen ${new Date(token.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'never seen'}
              </Typography>

              {/* ACTIONS */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Tooltip title="Rotate token (invalidates current URL)">
                  <Box onClick={() => handleRotate(token.id)} sx={{ cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
                    <RotateCcw size={13} strokeWidth={1.75} />
                  </Box>
                </Tooltip>
                <Tooltip title="Revoke permanently">
                  <Box onClick={() => handleRevoke(token.id)} sx={{ cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: theme.palette.error.main } }}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </Box>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SettingsCard>
  );
}

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
          <FloorDisplaySection />
        </Box>
      )}
    </Box>
  );
}