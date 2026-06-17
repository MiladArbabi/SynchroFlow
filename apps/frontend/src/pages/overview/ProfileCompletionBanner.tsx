// apps/frontend/src/pages/overview/ProfileCompletionBanner.tsx
import { useState, useEffect } from 'react';
import { Box, Typography, Button, IconButton, TextField } from '@mui/material';
import { X } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';

/**
 * PROFILE COMPLETION BANNER (App Store ghost users)
 * ----------------------------------------------------
 * Shown once, on first FT2 landing, only for merchants who installed
 * via the Shopify App Store (entry_channel = 'shopify_app_store') and
 * haven't yet acted on this prompt (profile_prompt_dismissed_at IS NULL).
 *
 * Skippable by design — never blocks access to the dashboard.
 * Both "Save" and "Skip" permanently dismiss via the same backend call
 * (PATCH /api/v1/user-state/profile), so this never reappears once
 * acted on, matching the FirstInsightBanner dismissal pattern but with
 * durable (DB-backed) rather than session-only persistence.
 */
export function ProfileCompletionBanner() {
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axiosInstance
      .get('/api/v1/user-state/state')
      .then(({ data }) => {
        if (cancelled) return;
        const u = data?.user;
        if (u?.entry_channel === 'shopify_app_store' && !u?.profile_prompt_dismissed_at) {
          setVisible(true);
        }
      })
      .catch(() => {
        // Non-fatal — banner simply doesn't show if this fails
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = async (withNames: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      await axiosInstance.patch('/api/v1/user-state/profile', {
        ...(withNames && firstName ? { firstName } : {}),
        ...(withNames && lastName ? { lastName } : {}),
      });
    } catch {
      // Non-fatal — don't block the merchant on a failed save
    } finally {
      setSaving(false);
      setVisible(false);
    }
  };

  if (!checked || !visible) return null;

  return (
    <Box
      sx={{
        mx: 3,
        mt: 2,
        p: 2.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'primary.light',
        borderLeft: '4px solid',
        borderLeftColor: 'primary.main',
        bgcolor: 'primary.50',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 240 }}>
        <Typography variant="body1" fontWeight={600}>
          Add your name to personalize your workspace
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Optional — you can always update this later in Settings.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          sx={{ width: 140 }}
        />
        <TextField
          size="small"
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          sx={{ width: 140 }}
        />
        <Button
          variant="contained"
          size="small"
          disabled={saving}
          onClick={() => dismiss(true)}
        >
          Save
        </Button>
        <IconButton size="small" disabled={saving} onClick={() => dismiss(false)}>
          <X size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}
