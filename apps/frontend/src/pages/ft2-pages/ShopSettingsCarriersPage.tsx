// apps/frontend/src/pages/ft2-pages/ShopSettingsCarriersPage.tsx
//
// Settings → Carriers tab
// -----------------------
// Carrier Pickup Time (CPT) + Carrier Integration (WM-38)

import { useState, useEffect } from 'react';
import { Box, TextField, Typography, Switch, Skeleton } from '@mui/material';
import { Clock, Truck, Eye, EyeOff } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { SettingsCard, SectionLabel, SaveButton, SettingsPageWrapper } from './ShopSettingsShared';
import { useAppTheme } from '../../hooks/useAppTheme';

// ─── TYPES ────────────────────────────────────────────────────

type ShopSettings = {
  daily_cpt_local: string | null;
};

type WmsSettings = {
  include_return_label: boolean;
};

type CarrierRow = {
  carrier_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type WebhookTokenRow = {
  id: string;
  carrier_code: string;
  created_at: string;
  rotated_at: string | null;
  last_seen_at: string | null;
};

// ─── HOOKS ────────────────────────────────────────────────────
function useCarrierWebhookToken() {
  return useQuery<{ token: WebhookTokenRow | null }>({
    queryKey: ['carrier-webhook-token', 'sendcloud'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/carrier-webhook-tokens', {
        params: { carrier_code: 'sendcloud' },
      });
      return data;
    },
  });
}

function useCreateWebhookToken() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; raw_token: string }, Error, void>({
    mutationFn: async () => {
      const { data } = await axiosInstance.put('/api/v1/wms/carrier-webhook-tokens', {
        carrier_code: 'sendcloud',
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-webhook-token', 'sendcloud'] });
    },
  });
}

function useRotateWebhookToken() {
  const queryClient = useQueryClient();
  return useMutation<{ raw_token: string }, Error, string>({
    mutationFn: async (id) => {
      const { data } = await axiosInstance.post(`/api/v1/wms/carrier-webhook-tokens/${id}/rotate`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-webhook-token', 'sendcloud'] });
    },
  });
}

function useRevokeWebhookToken() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await axiosInstance.delete(`/api/v1/wms/carrier-webhook-tokens/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-webhook-token', 'sendcloud'] });
      show('Webhook URL revoked', 'success');
    },
    onError: () => show('Failed to revoke webhook URL.', 'error'),
  });
}

// NEW BACKEND ENDPOINT NEEDED — see note above.
function useSetWebhookSecret() {
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (secret) => {
      await axiosInstance.patch('/api/v1/wms/carrier-settings/sendcloud/webhook-secret', {
        webhook_secret: secret,
      });
    },
    onSuccess: () => show('Webhook secret saved', 'success'),
    onError: () => show('Failed to save webhook secret.', 'error'),
  });
}

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

function useWmsSettings() {
  return useQuery<WmsSettings>({
    queryKey: ['wms-settings'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/settings');
      return data.settings;
    },
  });
}

function usePatchWmsSettings() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, Partial<WmsSettings>>({
    mutationFn: async (body) => {
      await axiosInstance.patch('/api/v1/wms/settings', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wms-settings'] });
      show('Settings saved', 'success');
    },
    onError: () => show('Failed to save settings. Please try again.', 'error'),
  });
}

function useCarrierSettings() {
  return useQuery<{ carriers: CarrierRow[] }>({
    queryKey: ['carrier-settings'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/carrier-settings');
      return data;
    },
  });
}

function useUpsertCarrier() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, { carrier_code: string; public_key: string; private_key: string }>({
    mutationFn: async (body) => {
      await axiosInstance.put('/api/v1/wms/carrier-settings', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-settings'] });
      show('Carrier connected', 'success');
    },
    onError: () => show('Failed to connect carrier. Check your credentials.', 'error'),
  });
}

function useDeleteCarrier() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (carrierCode) => {
      await axiosInstance.delete(`/api/v1/wms/carrier-settings/${carrierCode}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-settings'] });
      show('Carrier disconnected', 'success');
    },
    onError: () => show('Failed to disconnect carrier.', 'error'),
  });
}

// ─── SECTION: CARRIER PICKUP TIME ────────────────────────────

function CarrierCutoffSection({ settings, saving, onSave }: {
  settings: ShopSettings | undefined;
  saving: boolean;
  onSave: (v: Partial<ShopSettings>) => void;
}) {
  const [cpt, setCpt]     = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setCpt(settings?.daily_cpt_local ? settings.daily_cpt_local.slice(0, 5) : '');
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
              <Box onClick={() => { setCpt(''); setDirty(true); }}
                sx={{ fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { color: 'var(--ink)' } }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Clear</Typography>
              </Box>
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

// ─── SECTION: CARRIER INTEGRATION ────────────────────────────

function CarrierIntegrationSection() {
  const pal = useAppTheme();
  const { data, isLoading } = useCarrierSettings();
  const { data: wmsSettings, isLoading: wmsLoading } = useWmsSettings();
  const { mutate: upsert, isPending: connecting } = useUpsertCarrier();
  const { mutate: remove, isPending: disconnecting } = useDeleteCarrier();
  const { mutate: patchWms } = usePatchWmsSettings();

  const [publicKey,  setPublicKey]  = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [showPub,    setShowPub]    = useState(false);
  const [showPriv,   setShowPriv]   = useState(false);

  const connected = data?.carriers?.find(c => c.carrier_code === 'sendcloud');
  const returnLabel = wmsSettings?.include_return_label ?? false;

  const handleConnect = () => {
    if (!publicKey.trim() || !privateKey.trim()) return;
    upsert({ carrier_code: 'sendcloud', public_key: publicKey.trim(), private_key: privateKey.trim() }, {
      onSuccess: () => { setPublicKey(''); setPrivateKey(''); },
    });
  };

  const handleDisconnect = () => {
    if (!window.confirm('Disconnect Sendcloud? Label generation will stop working until reconnected.')) return;
    remove('sendcloud');
  };

  return (
    <SettingsCard
      icon={<Truck size={16} />}
      title="Carrier Integration"
      description="Connect your shipping provider to generate labels at pack time and pass tracking numbers to Shopify."
    >
      {isLoading || wmsLoading ? (
        <Skeleton height={80} sx={{ borderRadius: '6px' }} />
      ) : connected ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* CONNECTED STATE */}
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            p: 1.5, bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
            borderRadius: '6px',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Sendcloud
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
                Connected
              </Typography>
            </Box>
            <Box
              onClick={handleDisconnect}
              sx={{
                px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500,
                color: 'error.main', border: '0.5px solid', borderColor: 'error.main',
                borderRadius: '6px', cursor: 'pointer',
                '&:hover': { opacity: 0.75 },
              }}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Box>
          </Box>

          {/* RETURN LABEL TOGGLE */}
          <Box sx={{
            p: 1.5, bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
            borderRadius: '6px',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  Include return slip
                </Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: '2px' }}>
                  Prints a peel-off return label on the bottom half of the A4 invoice.
                </Typography>
              </Box>
              <Switch
                checked={returnLabel}
                onChange={(e) => patchWms({ include_return_label: e.target.checked })}
                size="small"
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--accent)' },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'var(--accent)' },
                }}
              />
            </Box>
          </Box>
        </Box>
      ) : (
        /* NOT CONNECTED STATE */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Enter your Sendcloud API credentials. Found in Sendcloud → Settings → Integrations → API.
          </Typography>

          <Box>
            <SectionLabel>Public key</SectionLabel>
            <Box sx={{ position: 'relative', width: '100%' }}>
              <TextField
                size="small" fullWidth
                type={showPub ? 'text' : 'password'}
                placeholder="Sendcloud public key"
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                inputProps={{ style: { fontSize: 13, paddingRight: 36 } }}
              />
              <Box
                onClick={() => setShowPub(v => !v)}
                sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}
              >
                {showPub ? <EyeOff size={14} /> : <Eye size={14} />}
              </Box>
            </Box>
          </Box>

          <Box>
            <SectionLabel>Private key</SectionLabel>
            <Box sx={{ position: 'relative', width: '100%' }}>
              <TextField
                size="small" fullWidth
                type={showPriv ? 'text' : 'password'}
                placeholder="Sendcloud private key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                inputProps={{ style: { fontSize: 13, paddingRight: 36 } }}
              />
              <Box
                onClick={() => setShowPriv(v => !v)}
                sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}
              >
                {showPriv ? <EyeOff size={14} /> : <Eye size={14} />}
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Box
              onClick={handleConnect}
              sx={{
                px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600,
                bgcolor: (!publicKey.trim() || !privateKey.trim() || connecting) ? 'var(--bg-3)' : 'var(--accent)',
                color: (!publicKey.trim() || !privateKey.trim() || connecting) ? 'var(--ink-3)' : 'white',
                borderRadius: '6px', cursor: (!publicKey.trim() || !privateKey.trim() || connecting) ? 'not-allowed' : 'pointer',
                '&:hover': { opacity: (!publicKey.trim() || !privateKey.trim() || connecting) ? 1 : 0.88 },
              }}
            >
              {connecting ? 'Connecting…' : 'Connect Sendcloud'}
            </Box>
          </Box>
        </Box>
      )}
    </SettingsCard>
  );
}

function WebhookIntegrationSection() {
  const pal = useAppTheme();
  const { show } = useToast();
  const { data, isLoading } = useCarrierWebhookToken();
  const { mutate: createToken, isPending: creating } = useCreateWebhookToken();
  const { mutate: rotateToken, isPending: rotating } = useRotateWebhookToken();
  const { mutate: revokeToken, isPending: revoking } = useRevokeWebhookToken();
  const { mutate: setSecret, isPending: savingSecret } = useSetWebhookSecret();

  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const token = data?.token;
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const buildUrl = (rawToken: string) =>
    `${API_BASE_URL}/api/v1/webhooks/carriers/sendcloud/tracking/${rawToken}`;

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url).then(() => show('Copied to clipboard', 'success'));
  };

  const handleCreate = () => {
    createToken(undefined, {
      onSuccess: (res) => setRevealedUrl(buildUrl(res.raw_token)),
    });
  };

  const handleRotate = () => {
    if (!token) return;
    if (!window.confirm('Rotating will invalidate the current URL. You must update it in Sendcloud immediately, or tracking updates will stop.')) return;
    rotateToken(token.id, {
      onSuccess: (res) => setRevealedUrl(buildUrl(res.raw_token)),
    });
  };

  const handleRevoke = () => {
    if (!token) return;
    if (!window.confirm('Revoke this webhook URL? Tracking updates will stop until a new one is created and configured in Sendcloud.')) return;
    revokeToken(token.id);
    setRevealedUrl(null);
  };

  return (
    <Box sx={{
      p: 1.5, bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
      borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: 1.5,
    }}>
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          Live tracking updates
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: '2px' }}>
          Register this URL in Sendcloud → Settings → Webhooks to get live parcel status in Outbound.
        </Typography>
      </Box>

      {isLoading ? (
        <Skeleton height={36} sx={{ borderRadius: '6px' }} />
      ) : !token ? (
        <Box
          onClick={handleCreate}
          sx={{
            display: 'inline-flex', alignSelf: 'flex-start',
            px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600,
            bgcolor: 'var(--accent)', color: 'white',
            borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 },
          }}
        >
          {creating ? 'Generating…' : 'Generate webhook URL'}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {revealedUrl && (
            <Box sx={{
              p: 1.25, bgcolor: 'rgba(34,197,94,0.06)',
              border: '0.5px solid rgba(34,197,94,0.3)', borderRadius: '6px',
            }}>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#22C55E', mb: 0.5 }}>
                Copy this URL now — it won't be shown again.
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography sx={{
                  fontSize: 11, color: 'var(--ink)', fontFamily: 'monospace', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {revealedUrl}
                </Typography>
                <Box onClick={() => handleCopy(revealedUrl)} sx={{ cursor: 'pointer', color: 'var(--accent)', flexShrink: 0 }}>
                  Copy
                </Box>
              </Box>
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: token.last_seen_at ? '#22C55E' : 'var(--ink-4)' }} />
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {token.last_seen_at
                  ? `Last event received ${new Date(token.last_seen_at).toLocaleString()}`
                  : 'Configured — no events received yet'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box onClick={handleRotate} sx={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
                {rotating ? 'Rotating…' : 'Rotate'}
              </Box>
              <Box onClick={handleRevoke} sx={{ fontSize: 12, color: 'error.main', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
                {revoking ? 'Revoking…' : 'Revoke'}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      <Box sx={{ mt: 0.5 }}>
        <SectionLabel>Webhook signing secret</SectionLabel>
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mb: 0.75 }}>
          Set when you register the webhook in Sendcloud — used to verify incoming events.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Box sx={{ position: 'relative', flex: 1 }}>
            <TextField
              size="small" fullWidth
              type={showSecret ? 'text' : 'password'}
              placeholder="Sendcloud webhook secret"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              inputProps={{ style: { fontSize: 13, paddingRight: 36 } }}
            />
            <Box
              onClick={() => setShowSecret(v => !v)}
              sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}
            >
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </Box>
          </Box>
          <Box
            onClick={() => secretInput.trim() && setSecret(secretInput.trim(), { onSuccess: () => setSecretInput('') })}
            sx={{
              px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600,
              bgcolor: !secretInput.trim() || savingSecret ? 'var(--bg-3)' : 'var(--accent)',
              color: !secretInput.trim() || savingSecret ? 'var(--ink-3)' : 'white',
              borderRadius: '6px', cursor: !secretInput.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            {savingSecret ? 'Saving…' : 'Save'}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────

export default function ShopSettingsCarriersPage() {
  const { data: settings } = useShopSettings();
  const { mutate: patch, isPending: saving } = usePatchShopSettings();

  return (
    <SettingsPageWrapper>
      <CarrierCutoffSection settings={settings} saving={saving} onSave={patch} />
      <CarrierIntegrationSection />
      <WebhookIntegrationSection />
    </SettingsPageWrapper>
  );
}
