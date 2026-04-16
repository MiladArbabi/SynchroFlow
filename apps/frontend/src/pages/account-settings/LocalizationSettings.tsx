/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/account-settings/LocalizationSettings.tsx
import React, { useState } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
  Alert,
  SelectChangeEvent,
} from '@mui/material';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { updateCurrencyPreference } from 'api/members';
import { useAuth } from 'contexts/AuthContext';

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
      <Box sx={{ p: 2 }}>
        <Alert severity="info">
          Currency settings can only be changed by shop owners and admins.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Display Currency
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          All monetary values across the dashboard will be displayed in this currency.
          Your shop's base currency is stored in the database — this setting controls display only.
        </Typography>

        <FormControl fullWidth>
          <InputLabel id="currency-select-label">Currency</InputLabel>
          <Select
            labelId="currency-select-label"
            value={selected}
            label="Currency"
            onChange={handleChange}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.code} — {c.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {success && (
        <Alert severity="success">
          Currency preference updated. All monetary values now display in {selected}.
        </Alert>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Button
        variant="contained"
        disabled={!isDirty || saving}
        onClick={handleSave}
        sx={{ alignSelf: 'flex-start' }}
      >
        {saving ? 'Saving…' : 'Save Preference'}
      </Button>
    </Box>
  );
};

export default LocalizationSettings;