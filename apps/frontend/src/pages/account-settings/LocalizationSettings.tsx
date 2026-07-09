/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/account-settings/LocalizationSettings.tsx
import React, { useState } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  Alert,
  SelectChangeEvent,
} from '@mui/material';
import { Globe } from 'lucide-react';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { updateCurrencyPreference } from 'api/members';
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
    </SettingsPageWrapper>
  );
};

export default LocalizationSettings;