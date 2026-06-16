// apps/frontend/src/components/PostTrialInterstitial.tsx
//
// POST-TRIAL INTERSTITIAL (UX-07)
// ---------------------------------
// Shown once after Growth trial expires and user lands on Starter.
// One-time dismissal stored in localStorage (persists across sessions).
// Shows what was lost on the left, upgrade paths on the right.
//
// Trigger: tier === 'starter' AND trial_ends_at was set within last 7 days.

import { useState } from 'react';
import { Dialog, Box, Typography, useTheme, alpha } from '@mui/material';
import { Lock, ChevronRight } from 'lucide-react';
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

// Dark panel uses its own fixed palette — identical in both light and dark themes.
const SPACE_BG = '#151D29';
const ON_SPACE = '#F0EEE8';
const ON_SPACE_2 = '#C8C4BB';
const ON_SPACE_3 = '#8B8F9A';
const ON_SPACE_RULE = 'rgba(255,255,255,0.10)';

const LOST_FEATURES = [
  'WMS — pick / pack / stow',
  'Cash flow & runway',
  'Demand forecasting',
  'Customer LTV',
  'Supplier scorecards',
];

interface PostTrialInterstitialProps {
  show: boolean;
}

export function PostTrialInterstitial({ show }: PostTrialInterstitialProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(() => show && !isDismissed());
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;

  if (!show || !open) return null;

  const growthPrice = formatDisplayPrice(PEGGED_DISPLAY_PRICES.growth[currency][billingInterval], currency);
  const scalePrice = formatDisplayPrice(PEGGED_DISPLAY_PRICES.scale[currency][billingInterval], currency);
  const growthSaving = annualSavings('growth', currency);

  const handleDismiss = () => {
    setDismissed();
    setOpen(false);
  };

  const handleUpgradeGrowth = () => {
    setDismissed();
    setOpen(false);
    window.location.href = '/settings/billing';
  };

  const handleUpgradeScale = () => {
    setDismissed();
    setOpen(false);
    window.location.href = '/settings/billing';
  };

  return (
    <Dialog
      open={open}
      onClose={handleDismiss}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: 840,
          maxWidth: '100%',
          m: 2,
          borderRadius: '16px',
          border: `1px solid ${theme.palette.divider}`,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
        },
      }}
    >
      {/* Left — dark panel */}
      <Box sx={{ background: SPACE_BG, p: '34px 32px' }}>
        <Typography sx={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: theme.palette.primary.main,
        }}>
          Trial ended
        </Typography>
        <Typography sx={{
          fontFamily: '"Instrument Serif", serif',
          fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.01em',
          color: ON_SPACE, mt: '14px',
        }}>
          Your Growth trial has ended
        </Typography>
        <Typography sx={{
          fontSize: 13.5, fontWeight: 300, lineHeight: 1.6,
          color: ON_SPACE_2, mt: '10px',
        }}>
          You've been moved to Starter. These are the tools you were using that are now switched off:
        </Typography>
        <Box sx={{ height: '1px', background: ON_SPACE_RULE, my: '20px' }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
          {LOST_FEATURES.map(f => (
            <Box key={f} sx={{ display: 'flex', alignItems: 'flex-start', gap: '11px' }}>
              <Lock
                size={17}
                color={ON_SPACE_3}
                strokeWidth={1.7}
                style={{ flexShrink: 0, marginTop: 1 }}
              />
              <Typography sx={{ fontSize: 13, fontWeight: 300, lineHeight: 1.4, color: ON_SPACE_2 }}>
                {f}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Right — upgrade panel */}
      <Box sx={{
        p: '30px 30px 24px',
        display: 'flex', flexDirection: 'column',
        background: theme.palette.background.paper,
      }}>
        {/* Header: title + billing toggle */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{
            fontFamily: '"Instrument Serif", serif',
            fontSize: 20, color: 'text.primary',
          }}>
            Keep your momentum
          </Typography>
          <Box sx={{
            display: 'flex',
            background: theme.palette.action.hover,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '9px',
            p: '3px',
          }}>
            {(['monthly', 'annual'] as const).map(iv => (
              <Box
                key={iv}
                onClick={() => setBillingInterval(iv)}
                sx={{
                  px: '11px', py: '5px',
                  borderRadius: '6px',
                  fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all .12s',
                  background: billingInterval === iv ? theme.palette.background.paper : 'transparent',
                  color: billingInterval === iv ? 'text.primary' : 'text.secondary',
                }}
              >
                {iv === 'monthly' ? 'Monthly' : 'Annual'}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Growth — primary recommended card */}
        <Box sx={{
          mt: '16px',
          background: alpha(theme.palette.primary.main, 0.07),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
          borderRadius: '12px',
          p: '18px',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary' }}>
                Growth
              </Typography>
              <Box sx={{
                fontSize: 9, fontWeight: 600, letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: '#FFF', background: theme.palette.primary.main,
                px: '8px', py: '3px', borderRadius: '100px',
                whiteSpace: 'nowrap',
              }}>
                Recommended
              </Box>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Box component="span" sx={{
                fontFamily: '"Instrument Serif", serif',
                fontSize: 24, color: 'text.primary',
              }}>
                {growthPrice}
              </Box>
              <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary' }}>
                /{billingInterval === 'monthly' ? 'mo' : 'yr'}
              </Box>
            </Box>
          </Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.45, color: 'text.secondary', mt: '8px' }}>
            Everything you just had — forecasting, cash flow, LTV and 5 seats.
          </Typography>
          <Box
            onClick={handleUpgradeGrowth}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 44, mt: '14px',
              background: theme.palette.primary.main,
              color: '#FFF',
              borderRadius: '8px',
              fontSize: 13.5, fontWeight: 600,
              cursor: 'pointer',
              '&:hover': { background: alpha(theme.palette.primary.main, 0.85) },
            }}
          >
            Continue on Growth
          </Box>
          {billingInterval === 'annual' && (
            <Typography sx={{
              textAlign: 'center', mt: '9px',
              fontSize: 11, fontWeight: 600, color: theme.palette.primary.main,
            }}>
              Save {formatDisplayPrice(growthSaving, currency)}/yr
            </Typography>
          )}
        </Box>

        {/* Scale — secondary card */}
        <Box
          onClick={handleUpgradeScale}
          sx={{
            mt: '12px',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '12px',
            px: '18px', py: '15px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer',
            '&:hover': { borderColor: theme.palette.text.secondary },
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>
              Scale
            </Typography>
            <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'text.secondary', mt: '2px' }}>
              Floor planning · unlimited seats
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Box component="span" sx={{
                fontFamily: '"Instrument Serif", serif',
                fontSize: 18, color: 'text.primary',
              }}>
                {scalePrice}
              </Box>
              <Box component="span" sx={{ fontSize: 10, fontWeight: 500, color: 'text.secondary' }}>
                /{billingInterval === 'monthly' ? 'mo' : 'yr'}
              </Box>
            </Box>
            <ChevronRight size={16} color={theme.palette.text.disabled} />
          </Box>
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Continue on Starter */}
        <Box sx={{ textAlign: 'center', mt: '18px' }}>
          <Box
            component="span"
            onClick={handleDismiss}
            sx={{ fontSize: 12.5, fontWeight: 500, color: 'text.disabled', cursor: 'pointer' }}
          >
            Continue on Starter (free)
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}

export default PostTrialInterstitial;
