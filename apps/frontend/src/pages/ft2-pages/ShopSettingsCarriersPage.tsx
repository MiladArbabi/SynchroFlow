// apps/frontend/src/pages/ft2-pages/ShopSettingsCarriersPage.tsx
//
// Settings → Carriers tab
// -----------------------
// Carrier Pickup Time (CPT) + Carrier Integration (WM-38)

import { useState, useEffect } from 'react';
import { Box, TextField, Typography, Switch, Skeleton, FormControl, Select, MenuItem } from '@mui/material';
import { Clock, Truck, Eye, EyeOff } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { SettingsCard, SectionLabel, SaveButton, SettingsPageWrapper, InlineConfirm } from './ShopSettingsShared';
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
function useCarrierWebhookToken(carrierCode: string) {
  return useQuery<{ token: WebhookTokenRow | null }>({
    queryKey: ['carrier-webhook-token', carrierCode],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/carrier-webhook-tokens', {
        params: { carrier_code: carrierCode },
      });
      return data;
    },
  });
}

function useCreateWebhookToken(carrierCode: string) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; raw_token: string }, Error, void>({
    mutationFn: async () => {
      const { data } = await axiosInstance.put('/api/v1/wms/carrier-webhook-tokens', {
        carrier_code: carrierCode,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-webhook-token', carrierCode] });
    },
  });
}

function useRotateWebhookToken(carrierCode: string) {
  const queryClient = useQueryClient();
  return useMutation<{ raw_token: string }, Error, string>({
    mutationFn: async (id) => {
      const { data } = await axiosInstance.post(`/api/v1/wms/carrier-webhook-tokens/${id}/rotate`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-webhook-token', carrierCode] });
    },
  });
}

function useRevokeWebhookToken(carrierCode: string) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await axiosInstance.delete(`/api/v1/wms/carrier-webhook-tokens/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carrier-webhook-token', carrierCode] });
      show('Webhook URL revoked', 'success');
    },
    onError: () => show('Failed to revoke webhook URL.', 'error'),
  });
}

// NEW BACKEND ENDPOINT NEEDED — see note above.
function useSetWebhookSecret(carrierCode: string) {
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (secret) => {
      await axiosInstance.patch(`/api/v1/wms/carrier-settings/${carrierCode}/webhook-secret`, {
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
  return useMutation<void, Error, { carrier_code: string; public_key?: string; private_key?: string; api_token?: string }>({
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

// ─── HOOKS: SENDER ADDRESS ───────────────────────────────────

type SenderAddressRow = {
  id: string; name: string; street1: string; street2: string | null;
  city: string; state: string | null; postal_code: string;
  country_code: string; phone: string; email: string | null; is_default: boolean;
};

function useSenderAddresses() {
  return useQuery<{ addresses: SenderAddressRow[] }>({
    queryKey: ['sender-addresses'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/sender-addresses');
      return data;
    },
  });
}

function useCreateSenderAddress() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, Omit<SenderAddressRow, 'id'>>({
    mutationFn: async (body) => {
      await axiosInstance.post('/api/v1/wms/sender-addresses', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-addresses'] });
      show('Sender address saved', 'success');
    },
    onError: () => show('Failed to save sender address.', 'error'),
  });
}

function useDeleteSenderAddress() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      await axiosInstance.delete(`/api/v1/wms/sender-addresses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-addresses'] });
      show('Sender address removed', 'success');
    },
    onError: () => show('Failed to remove sender address.', 'error'),
  });
}

// ─── SECTION: SENDER ADDRESS ─────────────────────────────────
// ─── SENDER ADDRESS FORM CONSTANTS ───────────────────────────

const COUNTRY_OPTIONS = [
  { code: 'SE', label: 'Sweden' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'DE', label: 'Germany' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'DK', label: 'Denmark' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'BE', label: 'Belgium' },
  { code: 'AT', label: 'Austria' },
  { code: 'FI', label: 'Finland' },
  { code: 'NO', label: 'Norway' },
  { code: 'CA', label: 'Canada' },
  { code: 'IE', label: 'Ireland' },
  { code: 'PL', label: 'Poland' },
];

// E.164-ish: optional leading +, 7–15 digits total, spaces/dashes allowed
const PHONE_PATTERN = /^\+?[0-9\s-]{7,20}$/;

type SenderAddressFormErrors = Partial<Record<'name' | 'street1' | 'city' | 'postal_code' | 'country_code' | 'phone' | 'email', string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSenderAddressForm(form: {
  name: string; street1: string; city: string;
  postal_code: string; country_code: string; phone: string; email: string;
}): SenderAddressFormErrors {
  const errors: SenderAddressFormErrors = {};

  if (!form.name.trim()) errors.name = 'Required — this appears on the shipping label.';
  if (!form.street1.trim()) errors.street1 = 'Required.';
  if (!form.city.trim()) errors.city = 'Required.';
  if (!form.postal_code.trim()) errors.postal_code = 'Required.';

  if (!form.country_code) {
    errors.country_code = 'Select a country.';
  }

  if (!form.phone.trim()) {
    errors.phone = 'Required by some carriers for international shipments.';
  } else if (!PHONE_PATTERN.test(form.phone.trim())) {
    errors.phone = 'Enter a valid phone number, e.g. +46 70 123 45 67 — include the country dialing code.';
  }

  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = 'Enter a valid email address, or leave blank.';
  }

  return errors;
}

function useSetDefaultSenderAddress() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await axiosInstance.patch(`/api/v1/wms/sender-addresses/${id}`, { is_default: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-addresses'] });
      show('Default sender address updated', 'success');
    },
    onError: () => show('Failed to update default address.', 'error'),
  });
}

// ─── SECTION: SENDER ADDRESS ─────────────────────────────────

function SenderAddressSection() {
  const pal = useAppTheme();
  const { data, isLoading } = useSenderAddresses();
  const { mutate: create, isPending: creating } = useCreateSenderAddress();
  const { mutate: remove } = useDeleteSenderAddress();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', street1: '', street2: '', city: '', state: '',
    postal_code: '', country_code: '', phone: '', email: '',
  });
  const [errors, setErrors] = useState<SenderAddressFormErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const addresses = data?.addresses ?? [];
  const { mutate: setDefault } = useSetDefaultSenderAddress();

  const markTouched = (field: string) => setTouched(prev => new Set(prev).add(field));

  const handleFieldChange = (field: keyof typeof form, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched.has(field)) {
      setErrors(validateSenderAddressForm(next));
    }
  };

  const handleCreate = () => {
    const validationErrors = validateSenderAddressForm(form);
    setErrors(validationErrors);
    setTouched(new Set(['name', 'street1', 'city', 'postal_code', 'country_code', 'phone']));

    if (Object.keys(validationErrors).length > 0) return;

    create(
      {
        ...form,
        street2: form.street2 || null,
        state: form.state || null,
        is_default: addresses.length === 0,
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm({ name: '', street1: '', street2: '', city: '', state: '', postal_code: '', country_code: '', phone: '', email: '' });
          setErrors({});
          setTouched(new Set());
        },
      }
    );
  };

  const hasErrors = Object.keys(errors).length > 0;
  const errorText = (field: keyof SenderAddressFormErrors) =>
    touched.has(field) && errors[field] ? (
      <Typography sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>{errors[field]}</Typography>
    ) : null;

  const fieldSx = (field: keyof SenderAddressFormErrors) => ({
    '& .MuiOutlinedInput-root': touched.has(field) && errors[field]
      ? { '& fieldset': { borderColor: 'error.main' } }
      : {},
  });

  return (
    <SettingsCard
      icon={<Truck size={16} />}
      title="Sender address"
      description="Where your labels ship from. Required by some carriers (Shippo) to generate a label — Sendcloud uses the address configured in your Sendcloud account instead."
    >
      {isLoading ? (
        <Skeleton height={60} sx={{ borderRadius: '6px' }} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {addresses.map(addr => (
            <Box key={addr.id}>
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                p: 1.5, bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`, borderRadius: '6px',
              }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    {addr.name} {addr.is_default && <Box component="span" sx={{ fontSize: 10, color: 'var(--accent)', ml: 0.5 }}>DEFAULT</Box>}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: '2px' }}>
                    {addr.street1}, {addr.city} {addr.postal_code}, {addr.country_code}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  {!addr.is_default && (
                    <Box onClick={() => setDefault(addr.id)} sx={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                      Make default
                    </Box>
                  )}
                  <Box onClick={() => setConfirmingRemoveId(addr.id)} sx={{ fontSize: 11, color: 'error.main', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
                    Remove
                  </Box>
                </Box>
              </Box>
              <InlineConfirm
                open={confirmingRemoveId === addr.id}
                message={`Remove "${addr.name}"? Carriers that rely on this address won't be able to generate labels until you add a new one.`}
                confirmLabel="Remove"
                destructive
                onConfirm={() => { remove(addr.id); setConfirmingRemoveId(null); }}
                onCancel={() => setConfirmingRemoveId(null)}
              />
            </Box>
          ))}

          {!showForm ? (
            <Box
              onClick={() => setShowForm(true)}
              sx={{ display: 'inline-flex', alignSelf: 'flex-start', px: 1.5, py: 0.625, fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
            >
              + Add sender address
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box>
                <TextField
                  size="small" fullWidth placeholder="Warehouse / company name"
                  value={form.name}
                  onChange={e => handleFieldChange('name', e.target.value)}
                  onBlur={() => { markTouched('name'); setErrors(validateSenderAddressForm(form)); }}
                  sx={fieldSx('name')}
                />
                {errorText('name')}
              </Box>

              <Box>
                <TextField
                  size="small" fullWidth placeholder="Street address"
                  value={form.street1}
                  onChange={e => handleFieldChange('street1', e.target.value)}
                  onBlur={() => { markTouched('street1'); setErrors(validateSenderAddressForm(form)); }}
                  sx={fieldSx('street1')}
                />
                {errorText('street1')}
              </Box>

              <TextField
                size="small" fullWidth placeholder="Apartment, suite, etc. (optional)"
                value={form.street2}
                onChange={e => handleFieldChange('street2', e.target.value)}
              />

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Box sx={{ flex: 2 }}>
                  <TextField
                    size="small" fullWidth placeholder="City"
                    value={form.city}
                    onChange={e => handleFieldChange('city', e.target.value)}
                    onBlur={() => { markTouched('city'); setErrors(validateSenderAddressForm(form)); }}
                    sx={fieldSx('city')}
                  />
                  {errorText('city')}
                </Box>
                <TextField
                  size="small" placeholder="State/region"
                  value={form.state}
                  onChange={e => handleFieldChange('state', e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Box sx={{ flex: 1 }}>
                  <TextField
                    size="small" fullWidth placeholder="Postal code"
                    value={form.postal_code}
                    onChange={e => handleFieldChange('postal_code', e.target.value)}
                    onBlur={() => { markTouched('postal_code'); setErrors(validateSenderAddressForm(form)); }}
                    sx={fieldSx('postal_code')}
                  />
                  {errorText('postal_code')}
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <FormControl size="small" fullWidth error={touched.has('country_code') && !!errors.country_code}>
                    <Select
                      displayEmpty
                      value={form.country_code}
                      onChange={e => {
                        const next = { ...form, country_code: e.target.value };
                        setForm(next);
                        setTouched(prev => new Set(prev).add('country_code'));
                        setErrors(validateSenderAddressForm(next));
                      }}
                      sx={{ fontSize: 13 }}
                    >
                      <MenuItem value="" disabled><em style={{ opacity: 0.6 }}>Country</em></MenuItem>
                      {COUNTRY_OPTIONS.map(c => (
                        <MenuItem key={c.code} value={c.code} sx={{ fontSize: 13 }}>{c.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {errorText('country_code')}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <TextField
                    size="small" fullWidth placeholder="Phone, e.g. +46 70 123 45 67"
                    value={form.phone}
                    onChange={e => handleFieldChange('phone', e.target.value)}
                    onBlur={() => { markTouched('phone'); setErrors(validateSenderAddressForm(form)); }}
                    sx={fieldSx('phone')}
                  />
                  {errorText('phone')}
                </Box>
                 <Box>
                    <TextField
                      size="small" fullWidth placeholder="Email (optional — some carriers require it)"
                      value={form.email}
                      onChange={e => handleFieldChange('email', e.target.value)}
                      onBlur={() => { markTouched('email'); setErrors(validateSenderAddressForm(form)); }}
                      sx={fieldSx('email')}
                    />
                    {errorText('email')}
                  </Box>
              </Box>

              {hasErrors && touched.size > 0 && (
                <Typography sx={{ fontSize: 11, color: 'error.main' }}>
                  Fix the highlighted fields before saving.
                </Typography>
              )}

              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                <Box onClick={() => { setShowForm(false); setErrors({}); setTouched(new Set()); }} sx={{ px: 1.5, py: 0.625, fontSize: 12, color: 'var(--ink-3)', border: `0.5px solid ${pal.rule}`, borderRadius: '6px', cursor: 'pointer' }}>
                  Cancel
                </Box>
                <Box
                  onClick={handleCreate}
                  sx={{ px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600, border: 'none', bgcolor: creating ? 'var(--bg-3)' : 'var(--accent)', color: creating ? 'var(--ink-3)' : 'var(--accent-ink)', borderRadius: '6px', cursor: creating ? 'wait' : 'pointer' }}
                >
                  {creating ? 'Saving…' : 'Save address'}
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </SettingsCard>
  );
}

// ─── SECTION: CARRIER INTEGRATION ────────────────────────────
type CarrierDef = {
  code: string;
  label: string;
  authMode: 'two-key' | 'single-token';
  credentialsHint: string;
  webhookHint: string;
  buildWebhookUrl: (rawToken: string) => string;
  showWebhookSecret: boolean;
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const CARRIERS: CarrierDef[] = [
  {
    code: 'sendcloud',
    label: 'Sendcloud',
    authMode: 'two-key',
    credentialsHint: 'Enter your Sendcloud API credentials. Found in Sendcloud → Settings → Integrations → API.',
    webhookHint: 'Register this URL in Sendcloud → Settings → Webhooks to get live parcel status in Outbound.',
    buildWebhookUrl: (rawToken) => `${API_BASE_URL}/api/v1/webhooks/carriers/sendcloud/tracking/${rawToken}`,
    showWebhookSecret: true,
  },
  {
    code: 'shippo',
    label: 'Shippo',
    authMode: 'single-token',
    credentialsHint: 'Enter your Shippo API token. Found in Shippo → API configuration → Developer keys.',
    webhookHint: 'Paste this URL into Shippo → API configuration → Webhooks → Create webhook (Event Type: Track Updated).',
    buildWebhookUrl: (rawToken) => `${API_BASE_URL}/api/v1/webhooks/carriers/shippo/tracking?token=${rawToken}`,
    showWebhookSecret: false,
  },
];

function SingleCarrierCard({ carrier }: { carrier: CarrierDef }) {
  const pal = useAppTheme();
  const { data, isLoading } = useCarrierSettings();
  const { data: wmsSettings, isLoading: wmsLoading } = useWmsSettings();
  const { mutate: upsert, isPending: connecting } = useUpsertCarrier();
  const { mutate: remove, isPending: disconnecting } = useDeleteCarrier();
  const { mutate: patchWms } = usePatchWmsSettings();

  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [showPub, setShowPub] = useState(false);
  const [showPriv, setShowPriv] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const connected = data?.carriers?.find(c => c.carrier_code === carrier.code);
  const returnLabel = wmsSettings?.include_return_label ?? false;

  const canConnect = carrier.authMode === 'two-key'
    ? publicKey.trim() && privateKey.trim()
    : apiToken.trim();

  const handleConnect = () => {
    if (!canConnect) return;
    const body = carrier.authMode === 'two-key'
      ? { carrier_code: carrier.code, public_key: publicKey.trim(), private_key: privateKey.trim() }
      : { carrier_code: carrier.code, api_token: apiToken.trim() };
    upsert(body, {
      onSuccess: () => { setPublicKey(''); setPrivateKey(''); setApiToken(''); },
    });
  };

  const handleDisconnect = () => {
    remove(carrier.code);
    setConfirmingDisconnect(false);
  };

  return (
    <SettingsCard
      icon={<Truck size={16} />}
      title={carrier.label}
      description={carrier.code === 'sendcloud'
        ? 'Connect your shipping provider to generate labels at pack time and pass tracking numbers to Shopify.'
        : `Connect ${carrier.label} to generate labels and get live tracking, using your own ${carrier.label} account.`}
    >
      {isLoading || wmsLoading ? (
        <Skeleton height={80} sx={{ borderRadius: '6px' }} />
      ) : connected ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`, borderRadius: '6px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{carrier.label}</Typography>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>Connected</Typography>
            </Box>
            <Box onClick={() => setConfirmingDisconnect(true)} sx={{ px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'error.main', border: '0.5px solid', borderColor: 'error.main', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Box>
            <InlineConfirm
              open={confirmingDisconnect}
              message={`Disconnect ${carrier.label}? Label generation will stop working until reconnected.`}
              confirmLabel="Disconnect"
              destructive
              onConfirm={handleDisconnect}
              onCancel={() => setConfirmingDisconnect(false)}
            />
          </Box>

          {carrier.code === 'sendcloud' && (
            <Box sx={{ p: 1.5, bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`, borderRadius: '6px' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Include return slip</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: '2px' }}>Prints a peel-off return label on the bottom half of the A4 invoice.</Typography>
                </Box>
                <Switch checked={returnLabel} onChange={(e) => patchWms({ include_return_label: e.target.checked })} size="small"
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--accent)' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'var(--accent)' } }}
                />
              </Box>
            </Box>
          )}

          <WebhookIntegrationSection
            carrierCode={carrier.code}
            registrationHint={carrier.webhookHint}
            buildUrl={carrier.buildWebhookUrl}
            showSecretField={carrier.showWebhookSecret}
          />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{carrier.credentialsHint}</Typography>

          {carrier.authMode === 'two-key' ? (
            <>
              <Box>
                <SectionLabel>Public key</SectionLabel>
                <Box sx={{ position: 'relative', width: '100%' }}>
                  <TextField size="small" fullWidth type={showPub ? 'text' : 'password'} placeholder={`${carrier.label} public key`} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} inputProps={{ style: { fontSize: 13, paddingRight: 36 } }} />
                  <Box onClick={() => setShowPub(v => !v)} sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
                    {showPub ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Box>
                </Box>
              </Box>
              <Box>
                <SectionLabel>Private key</SectionLabel>
                <Box sx={{ position: 'relative', width: '100%' }}>
                  <TextField size="small" fullWidth type={showPriv ? 'text' : 'password'} placeholder={`${carrier.label} private key`} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }} inputProps={{ style: { fontSize: 13, paddingRight: 36 } }} />
                  <Box onClick={() => setShowPriv(v => !v)} sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
                    {showPriv ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Box>
                </Box>
              </Box>
            </>
          ) : (
            <Box>
              <SectionLabel>API token</SectionLabel>
              <Box sx={{ position: 'relative', width: '100%' }}>
                <TextField size="small" fullWidth type={showToken ? 'text' : 'password'} placeholder={`${carrier.label} API token`} value={apiToken} onChange={(e) => setApiToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }} inputProps={{ style: { fontSize: 13, paddingRight: 36 } }} />
                <Box onClick={() => setShowToken(v => !v)} sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </Box>
              </Box>
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Box
              onClick={handleConnect}
              sx={{ px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600, border: 'none', bgcolor: canConnect && !connecting ? 'var(--accent)' : 'var(--bg-3)', color: canConnect && !connecting ? 'var(--accent-ink)' : 'var(--ink-3)', borderRadius: '6px', cursor: canConnect && !connecting ? 'pointer' : 'not-allowed', '&:hover': { opacity: canConnect && !connecting ? 0.88 : 1 } }}
            >
              {connecting ? 'Connecting…' : `Connect ${carrier.label}`}
            </Box>
          </Box>
        </Box>
      )}
    </SettingsCard>
  );
}

function CarrierIntegrationSection() {
  return (
    <>
      {CARRIERS.map(carrier => <SingleCarrierCard key={carrier.code} carrier={carrier} />)}
    </>
  );
}

function WebhookIntegrationSection({
  carrierCode,
  registrationHint,
  buildUrl,
  showSecretField,
}: {
  carrierCode: string;
  registrationHint: string;
  buildUrl: (rawToken: string) => string;
  showSecretField: boolean;
}) {
  const pal = useAppTheme();
  const { show } = useToast();
  const { data, isLoading } = useCarrierWebhookToken(carrierCode);
  const { mutate: createToken, isPending: creating } = useCreateWebhookToken(carrierCode);
  const { mutate: rotateToken, isPending: rotating } = useRotateWebhookToken(carrierCode);
  const { mutate: revokeToken, isPending: revoking } = useRevokeWebhookToken(carrierCode);
  const { mutate: setSecret, isPending: savingSecret } = useSetWebhookSecret(carrierCode);

  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const token = data?.token;

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url).then(() => show('Copied to clipboard', 'success'));
  };

  const handleCreate = () => {
    createToken(undefined, { onSuccess: (res) => setRevealedUrl(buildUrl(res.raw_token)) });
  };

  const handleRotate = () => {
    if (!token) return;
    rotateToken(token.id, { onSuccess: (res) => setRevealedUrl(buildUrl(res.raw_token)) });
    setConfirmingRotate(false);
  };

  const handleRevoke = () => {
    if (!token) return;
    revokeToken(token.id);
    setRevealedUrl(null);
    setConfirmingRevoke(false);
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
          {registrationHint}
        </Typography>
      </Box>

      {isLoading ? (
        <Skeleton height={36} sx={{ borderRadius: '6px' }} />
      ) : !token ? (
        <Box
          onClick={handleCreate}
          sx={{ display: 'inline-flex', alignSelf: 'flex-start', px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600, border: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
        >
          {creating ? 'Generating…' : 'Generate webhook URL'}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {revealedUrl && (
            <Box sx={{ p: 1.25, bgcolor: 'rgba(34,197,94,0.06)', border: '0.5px solid rgba(34,197,94,0.3)', borderRadius: '6px' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#22C55E', mb: 0.5 }}>
                Copy this URL now — it won't be shown again.
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography sx={{ fontSize: 11, color: 'var(--ink)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {revealedUrl}
                </Typography>
                <Box onClick={() => handleCopy(revealedUrl)} sx={{ cursor: 'pointer', color: 'var(--accent)', flexShrink: 0 }}>Copy</Box>
              </Box>
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: token.last_seen_at ? '#22C55E' : 'var(--ink-4)' }} />
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {token.last_seen_at ? `Last event received ${new Date(token.last_seen_at).toLocaleString()}` : 'Configured — no events received yet'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box onClick={() => setConfirmingRotate(true)} sx={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
                {rotating ? 'Rotating…' : 'Rotate'}
              </Box>
              <Box onClick={() => setConfirmingRevoke(true)} sx={{ fontSize: 12, color: 'error.main', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
                {revoking ? 'Revoking…' : 'Revoke'}
              </Box>
            </Box>
            <InlineConfirm
              open={confirmingRotate}
              message="Rotating will invalidate the current URL. You must update it with your carrier immediately, or tracking updates will stop."
              confirmLabel="Rotate"
              onConfirm={handleRotate}
              onCancel={() => setConfirmingRotate(false)}
            />
            <InlineConfirm
              open={confirmingRevoke}
              message="Revoke this webhook URL? Tracking updates will stop until a new one is created and configured."
              confirmLabel="Revoke"
              destructive
              onConfirm={handleRevoke}
              onCancel={() => setConfirmingRevoke(false)}
            />
          </Box>
        </Box>
      )}

      {showSecretField && (
        <Box sx={{ mt: 0.5 }}>
          <SectionLabel>Webhook signing secret</SectionLabel>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mb: 0.75 }}>
            Set when you register the webhook with your carrier — used to verify incoming events.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Box sx={{ position: 'relative', flex: 1 }}>
              <TextField
                size="small" fullWidth
                type={showSecret ? 'text' : 'password'}
                placeholder="Webhook secret"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                inputProps={{ style: { fontSize: 13, paddingRight: 36 } }}
              />
              <Box onClick={() => setShowSecret(v => !v)} sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' } }}>
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </Box>
            </Box>
            <Box
              onClick={() => secretInput.trim() && setSecret(secretInput.trim(), { onSuccess: () => setSecretInput('') })}
              sx={{ px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600, border: 'none', bgcolor: !secretInput.trim() || savingSecret ? 'var(--bg-3)' : 'var(--accent)', color: !secretInput.trim() || savingSecret ? 'var(--ink-3)' : 'var(--accent-ink)', borderRadius: '6px', cursor: !secretInput.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
            >
              {savingSecret ? 'Saving…' : 'Save'}
            </Box>
          </Box>
        </Box>
      )}
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
      <SenderAddressSection />
      <CarrierIntegrationSection />
    </SettingsPageWrapper>
  );
}
