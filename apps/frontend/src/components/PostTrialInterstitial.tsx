// apps/frontend/src/components/PostTrialInterstitial.tsx
//
// POST-TRIAL INTERSTITIAL (UX-07)
// ---------------------------------
// Shown once after Growth trial expires and user lands on Starter.
// One-time dismissal stored in localStorage (persists across sessions).
// Shows what was lost + upgrade CTA.
//
// Trigger: tier === 'starter' AND trial_ends_at was set within last 7 days.

import { useState } from 'react';
import {
  Dialog, DialogContent, Box, Typography, Button,
  Chip, useTheme, alpha,
} from '@mui/material';
import { ArrowRight, Zap } from 'lucide-react';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { PEGGED_DISPLAY_PRICES, formatDisplayPrice, annualSavings, type BillingCurrency } from '../config/pricingDisplay';

const DISMISSED_KEY = 'post_trial_interstitial_dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // ignore
  }
}

const LOST_FEATURES = [
  { label: 'Cash Flow Intelligence', desc: 'Real-time 60-day projection' },
  { label: 'Customer LTV', desc: 'RFM segments and churn signals' },
  { label: 'Demand Forecasting', desc: 'Reorder alerts and velocity trends' },
  { label: 'Specter', desc: 'Full session intelligence suite' },
];

interface PostTrialInterstitialProps {
  show: boolean;
}

export function PostTrialInterstitial({ show }: PostTrialInterstitialProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(() => show && !isDismissed());
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  if (!show || !open) return null;

  const handleDismiss = () => {
    setDismissed();
    setOpen(false);
  };

  const handleUpgrade = () => {
    setDismissed();
    setOpen(false);
    window.location.href = '/account/settings?tab=billing';
  };

  return (
    <Dialog
      open={open}
      onClose={handleDismiss}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: theme.palette.background.paper,
        },
      }}
    >
      <DialogContent sx={{ p: 4 }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: '50%', mb: 2,
            background: alpha(theme.palette.warning.main, 0.1),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.25)}`,
          }}>
            <Zap size={22} color={theme.palette.warning.main} />
          </Box>
          <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
            Your Growth trial has ended
          </Typography>
          <Typography variant="body2" color="text.secondary">
            You've been moved to the free Starter plan. Here's what you've lost access to:
          </Typography>
        </Box>

        {/* Lost features */}
        <Box sx={{
          mb: 3, p: 2, borderRadius: '10px',
          background: alpha(theme.palette.error.main, 0.04),
          border: `1px solid ${alpha(theme.palette.error.main, 0.12)}`,
        }}>
          {LOST_FEATURES.map((f, i) => (
            <Box key={f.label} sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              py: 1, borderBottom: i < LOST_FEATURES.length - 1 ? `1px solid ${theme.palette.divider}` : 'none',
            }}>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>{f.label}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{f.desc}</Typography>
              </Box>
              <Chip label="Lost" size="small" color="error" sx={{ fontSize: 10, height: 20 }} />
            </Box>
          ))}
        </Box>

        {/* CTA */}
        <Box sx={{ textAlign: 'center' }}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            endIcon={<ArrowRight size={16} />}
            onClick={handleUpgrade}
            sx={{
              borderRadius: '10px', fontWeight: 700, mb: 1.5, py: 1.5,
              bgcolor: theme.palette.primary.main,
            }}
          >
            Restore Growth — {formatDisplayPrice(PEGGED_DISPLAY_PRICES.growth[currency].monthly, currency)}/mo
          </Button>
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
            Or save {formatDisplayPrice(annualSavings('growth', currency), currency)}/year with annual billing
          </Typography>
          <Button
            variant="text"
            size="small"
            onClick={handleDismiss}
            sx={{ color: 'text.secondary', fontSize: 11 }}
          >
            Continue on Starter
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

export default PostTrialInterstitial;