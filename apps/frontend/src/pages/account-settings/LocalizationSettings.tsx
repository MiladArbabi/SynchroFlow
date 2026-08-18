/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/account-settings/LocalizationSettings.tsx
import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  Alert,
  SelectChangeEvent,
  CircularProgress,
} from '@mui/material';
import { Globe } from 'lucide-react';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { updateCurrencyPreference } from 'api/members';
import { getShopTimezone, updateShopTimezone } from 'api/shopSettings';
import { useAuth } from 'contexts/AuthContext';
import {
  SettingsCard,
  SectionLabel,
  SaveButton,
  SettingsPageWrapper,
} from '../ft2-pages/ShopSettingsShared';

/**
 * SUPPORTED CURRENCIES
 * --------------------
 * Extend this list as new markets are added.
 * Each entry: { code: ISO 4217, label, locale: Intl locale tag }
 *
 * Access: owner + admin only (enforced in AccountSettingsPage via role check)
 * Operators cannot access this panel.
 */
const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', label: 'Euro', locale: 'de-DE' },
  { code: 'GBP', label: 'British Pound', locale: 'en-GB' },
  { code: 'CAD', label: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'AUD', label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'SEK', label: 'Swedish Krona', locale: 'sv-SE' },
  { code: 'NOK', label: 'Norwegian Krone', locale: 'nb-NO' },
  { code: 'DKK', label: 'Danish Krone', locale: 'da-DK' },
  { code: 'CHF', label: 'Swiss Franc', locale: 'de-CH' },
  { code: 'JPY', label: 'Japanese Yen', locale: 'ja-JP' },
];

const LocalizationSettings: React.FC = () => {
  const { displayCurrency, locale, refresh, tier } = useEntitlements();
  const { user } = useAuth();

  const [selected, setSelected] = useState<string>(displayCurrency);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SRC-05a: shop timezone. Unlike currency this is not cosmetic — it decides
  // when scheduled reports fire and how daily cut-off times are read.
  const [timezone, setTimezone] = useState<string | null>(null);
  const [tzSelected, setTzSelected] = useState<string>('');
  const [tzDetected, setTzDetected] = useState<string>('');
  const [tzLoading, setTzLoading] = useState(true);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSuccess, setTzSuccess] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);

  // Built from the runtime's own IANA data rather than a hardcoded list —
  // zones get added and renamed, and a stale list would omit real warehouses.
  const TIMEZONES = React.useMemo<string[]>(() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    return supported ? supported('timeZone') : ['UTC'];
  }, []);

  useEffect(() => {
    getShopTimezone()
      .then((tz) => {
        setTimezone(tz.timezone);
        setTzSelected(tz.timezone);
        setTzDetected(tz.detected_default);
      })
      .catch(() => setTzError('Could not load the shop timezone.'))
      .finally(() => setTzLoading(false));
  }, []);

  const handleTzSave = async () => {
    setTzSaving(true);
    setTzError(null);
    try {
      const saved = await updateShopTimezone(tzSelected);
      setTimezone(saved.timezone);
      setTzSuccess(true);
    } catch {
      setTzError('Failed to save timezone. Please try again.');
    } finally {
      setTzSaving(false);
    }
  };

  // Gate: operator role cannot change currency settings
  const canEdit = user?.role === 'owner' || user?.role === 'admin';

  const handleChange = (e: SelectChangeEvent) => {
    setSelected(e.target.value);
    setSuccess(false);
    setError(null);
  };

  const handleSave = async () => {
    const match = SUPPORTED_CURRENCIES.find((c) => c.code === selected);
    if (!match) return;

    setSaving(true);
    setError(null);
    try {
      await updateCurrencyPreference(match.code, match.locale);
      // Refresh entitlements so displayCurrency + locale update globally
      refresh();
      setSuccess(true);
    } catch {
      setError('Failed to save currency preference. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = selected !== displayCurrency;

  if (!canEdit) {
    return (
      <SettingsPageWrapper>
        <Alert severity="info">
          Currency settings can only be changed by shop owners and admins.
        </Alert>
      </SettingsPageWrapper>
    );
  }

  return (
    <SettingsPageWrapper>
      <SettingsCard
        icon={<Globe size={16} />}
        title="Display Currency"
        description="All monetary values across the dashboard will be displayed in this currency. Your shop's base currency is stored in the database — this setting controls display only."
      >
        <Box>
          <SectionLabel>Currency</SectionLabel>
          <FormControl size="small" sx={{ width: 240 }}>
            <Select
              value={selected}
              onChange={handleChange}
              sx={{ fontSize: 13 }}
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <MenuItem key={c.code} value={c.code} sx={{ fontSize: 13 }}>
                  {c.code} — {c.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {success && (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            Currency preference updated. All monetary values now display in {selected}.
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}

        <SaveButton dirty={isDirty} saving={saving} onSave={handleSave} />
      </SettingsCard>
      {/* SRC-05a: shop timezone. Deliberately worded to signal that this is
          behavioural, not cosmetic — a merchant who reads it as a display
          preference will leave it wrong and get their reports at 5am UTC. */}
      <SettingsCard
        icon={<Globe size={16} />}
        title="Shop Timezone"
        description="Used for daily cut-off times and scheduled reports. Set this to your warehouse's local timezone, which may differ from where your storefront is registered."
      >
        {tzLoading ? (
          <CircularProgress size={18} />
        ) : (
          <>
            <Box>
              <SectionLabel>Timezone</SectionLabel>
              <FormControl size="small" sx={{ width: 320 }}>
                <Select
                  value={tzSelected}
                  onChange={(e: SelectChangeEvent) => {
                    setTzSelected(e.target.value);
                    setTzSuccess(false);
                    setTzError(null);
                  }}
                  sx={{ fontSize: 13 }}
                  MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
                >
                  {TIMEZONES.map((tz) => (
                    <MenuItem key={tz} value={tz} sx={{ fontSize: 13 }}>
                      {tz}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {tzDetected && tzDetected !== tzSelected && (
                <Typography sx={{ fontSize: 12, mt: 1 }}>
                  Your device is in {tzDetected}.{' '}
                  <Box
                    component="button"
                    onClick={() => { setTzSelected(tzDetected); setTzSuccess(false); }}
                    sx={{ fontSize: 12, background: 'none', border: 'none', p: 0, cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }}
                  >
                    Use this
                  </Box>
                </Typography>
              )}
            </Box>

            {tzSuccess && (
              <Alert severity="success" sx={{ mt: 1.5 }}>
                Timezone set to {timezone}. Scheduled reports and cut-off times now use it.
              </Alert>
            )}
            {tzError && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {tzError}
              </Alert>
            )}

            <SaveButton dirty={tzSelected !== timezone} saving={tzSaving} onSave={handleTzSave} />
          </>
        )}
      </SettingsCard>
    </SettingsPageWrapper>
  );
};

export default LocalizationSettings;