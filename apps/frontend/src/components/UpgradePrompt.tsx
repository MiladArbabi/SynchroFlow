// apps/frontend/src/components/UpgradePrompt.tsx
//
// UpgradePrompt (MON-10)
// -----------------------
// Reusable upgrade gate component. Three display modes:
//
//   mode="teased"  — blurs children with frost overlay + CTA card centred on top.
//                    Use for intelligence previews (e.g. cash flow, forecasting).
//
//   mode="locked"  — hard gate, no children rendered. Full-container empty state
//                    with feature name, blurb, CTA and "See all plan features" link.
//
//   mode="modal"   — Dialog triggered on seat/order cap or locked-feature click.
//                    Shows current→required tier step, optional benefits list.
//
//   mode="overlay" — backward-compat alias for "teased".
//
// Callers:
//   PlanGate     → teased | locked
//   MembersPage  → modal (seat limit)
//   OrderCapBanner (future) → modal (order cap)

import React, { useEffect } from 'react';
import {
  Box, Button, Dialog, DialogContent, IconButton,
  Stack, Typography, useTheme, alpha,
} from '@mui/material';
import { Lock, X, ArrowRight, Check } from 'lucide-react';
import { sendEvent } from '../analytics/adapter';
import { useEntitlements } from '../contexts/EntitlementsContext';
import {
  PEGGED_DISPLAY_PRICES,
  formatDisplayPrice,
  type BillingCurrency,
} from '../config/pricingDisplay';

const TIER_LABELS: Record<string, string> = {
  starter: 'Starter',
  core:    'Core',
  growth:  'Growth',
  scale:   'Scale',
};

const BILLING_URL = '/settings/billing';

export interface UpgradePromptProps {
  requiredTier: string;
  /** 'overlay' is a backward-compat alias for 'teased'. */
  mode: 'teased' | 'locked' | 'modal' | 'overlay';
  featureName?: string;
  /** One-sentence blurb shown under the feature name in teased/locked modes. */
  featureBlurb?: string;
  /** Short benefit lines shown in the modal benefits list. */
  benefits?: string[];
  /** teased mode: content to blur behind the overlay. */
  children?: React.ReactNode;
  /** modal mode: controlled open state. */
  open?: boolean;
  /** modal mode: called when the user dismisses. */
  onClose?: () => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function resolvePrice(requiredTier: string, currency: BillingCurrency): string | null {
  if (requiredTier in PEGGED_DISPLAY_PRICES) {
    const monthly =
      PEGGED_DISPLAY_PRICES[requiredTier as keyof typeof PEGGED_DISPLAY_PRICES][currency].monthly;
    return formatDisplayPrice(monthly, currency);
  }
  return null;
}

// ─────────────────────────────────────────────
// Lock icon tile
// ─────────────────────────────────────────────

function LockTile({ size = 46 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Box sx={{
      width: size, height: size,
      borderRadius: `${Math.round(size * 0.24)}px`,
      background: alpha(theme.palette.primary.main, 0.08),
      border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <Lock size={Math.round(size * 0.43)} color={theme.palette.primary.main} strokeWidth={1.8} />
    </Box>
  );
}

// ─────────────────────────────────────────────
// Teased (frost overlay)
// ─────────────────────────────────────────────

function TeasedOverlay({
  requiredTier, featureName, featureBlurb, children,
}: Pick<UpgradePromptProps, 'requiredTier' | 'featureName' | 'featureBlurb' | 'children'>) {
  const theme = useTheme();
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const tierLabel = TIER_LABELS[requiredTier] ?? 'Growth';
  const tierPrice = resolvePrice(requiredTier, currency);

  useEffect(() => {
    sendEvent('upgrade_prompt.shown', { requiredTier, featureName: featureName ?? null, mode: 'teased' });
  }, [requiredTier, featureName]);

  const handleUpgrade = () => {
    sendEvent('upgrade_prompt.clicked', { requiredTier, featureName: featureName ?? null });
    window.location.href = BILLING_URL;
  };

  const frost = theme.palette.mode === 'dark'
    ? 'rgba(19,26,38,0.72)'
    : 'rgba(255,255,255,0.65)';

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 280 }}>
      {/* Blurred content */}
      <Box
        aria-hidden="true"
        sx={{ filter: 'blur(6px)', opacity: 0.6, pointerEvents: 'none', userSelect: 'none', width: '100%', height: '100%' }}
      >
        {children}
      </Box>

      {/* Frost overlay */}
      <Box sx={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: frost, backdropFilter: 'blur(2px)',
      }}>
        <Box sx={{ textAlign: 'center', maxWidth: 300, px: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.75 }}>
            <LockTile size={46} />
          </Box>

          <Typography sx={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 22, fontWeight: 400, lineHeight: 1.2,
            color: 'text.primary', mb: 1.25,
          }}>
            {featureName ?? tierLabel}
          </Typography>

          <Box sx={{ mb: featureBlurb ? 1.5 : 2 }}>
            <Box component="span" sx={{
              display: 'inline-block',
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: 'primary.main',
              background: alpha(theme.palette.primary.main, 0.08),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
              borderRadius: '100px', px: 1.5, py: 0.5,
            }}>
              Available on {tierLabel}
            </Box>
          </Box>

          {featureBlurb && (
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'text.secondary', lineHeight: 1.55, mb: 2 }}>
              {featureBlurb}
            </Typography>
          )}

          <Button
            variant="contained"
            size="small"
            onClick={handleUpgrade}
            sx={{
              borderRadius: '8px', fontWeight: 600, fontSize: 13, px: 2.5, py: 1,
              bgcolor: 'primary.main', color: '#fff',
              '&:hover': { bgcolor: 'primary.light', transform: 'translateY(-1px)' },
              transition: 'background-color 0.15s, transform 0.15s',
            }}
          >
            Upgrade to {tierLabel}{tierPrice ? ` — ${tierPrice}/mo` : ''}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Locked (hard gate, no preview)
// ─────────────────────────────────────────────

function LockedGate({
  requiredTier, featureName, featureBlurb,
}: Pick<UpgradePromptProps, 'requiredTier' | 'featureName' | 'featureBlurb'>) {
  const theme = useTheme();
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const tierLabel = TIER_LABELS[requiredTier] ?? 'Growth';
  const tierPrice = resolvePrice(requiredTier, currency);

  useEffect(() => {
    sendEvent('upgrade_prompt.shown', { requiredTier, featureName: featureName ?? null, mode: 'locked' });
  }, [requiredTier, featureName]);

  const handleUpgrade = () => {
    sendEvent('upgrade_prompt.clicked', { requiredTier, featureName: featureName ?? null });
    window.location.href = BILLING_URL;
  };

  const handleSeePlans = (e: React.MouseEvent) => {
    e.preventDefault();
    sendEvent('upgrade_prompt.see_plans', { requiredTier });
    window.location.href = BILLING_URL;
  };

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 300, width: '100%',
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: '14px',
      background: theme.palette.background.default,
      p: 5,
    }}>
      <Box sx={{ textAlign: 'center', maxWidth: 420 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.25 }}>
          <LockTile size={54} />
        </Box>

        <Typography sx={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 27, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2,
          color: 'text.primary', mb: 1.25,
        }}>
          {featureName ? `${featureName} is on ${tierLabel}` : `${tierLabel} plan required`}
        </Typography>

        <Typography sx={{ fontSize: 14.5, fontWeight: 300, lineHeight: 1.6, color: 'text.secondary', mb: 2.75 }}>
          {featureBlurb ?? `Upgrade to ${tierLabel} to unlock this feature and the full intelligence suite.`}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.75, mb: 2.25 }}>
          <Button
            variant="contained"
            onClick={handleUpgrade}
            sx={{
              borderRadius: '8px', fontWeight: 600, fontSize: 14, px: 2.75, height: 44,
              bgcolor: 'primary.main', color: '#fff',
              '&:hover': { bgcolor: 'primary.light', transform: 'translateY(-1px)' },
              transition: 'background-color 0.15s, transform 0.15s',
            }}
          >
            Upgrade to {tierLabel}
          </Button>
          {tierPrice && (
            <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'text.secondary' }}>
              from {tierPrice}/mo
            </Typography>
          )}
        </Box>

        <Typography
          component="a"
          href={BILLING_URL}
          onClick={handleSeePlans}
          sx={{
            fontSize: 13, fontWeight: 500, color: 'primary.main', cursor: 'pointer',
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
            pb: '1px', textDecoration: 'none',
            '&:hover': { borderBottomColor: 'primary.main' },
          }}
        >
          See all plan features
        </Typography>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Modal (upgrade dialog)
// ─────────────────────────────────────────────

function UpgradeModal({
  requiredTier, featureName, benefits, open, onClose,
}: Required<Pick<UpgradePromptProps, 'open'>> &
  Pick<UpgradePromptProps, 'requiredTier' | 'featureName' | 'benefits' | 'onClose'>) {
  const theme = useTheme();
  const { tier: currentTier, billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const tierLabel = TIER_LABELS[requiredTier] ?? 'Growth';
  const currentTierLabel = TIER_LABELS[currentTier ?? 'starter'] ?? 'Starter';
  const tierPrice = resolvePrice(requiredTier, currency);

  useEffect(() => {
    if (open) {
      sendEvent('upgrade_prompt.shown', { requiredTier, featureName: featureName ?? null, mode: 'modal' });
    }
  }, [open, requiredTier, featureName]);

  const handleUpgrade = () => {
    sendEvent('upgrade_prompt.clicked', { requiredTier, featureName: featureName ?? null });
    onClose?.();
    window.location.href = BILLING_URL;
  };

  const handleDismiss = () => {
    sendEvent('upgrade_prompt.dismissed', { requiredTier, featureName: featureName ?? null });
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={handleDismiss}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: 440, maxWidth: '100%',
          borderRadius: '14px',
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
        },
      }}
    >
      <DialogContent sx={{ p: '26px', position: 'relative' }}>
        {/* Close */}
        <IconButton
          onClick={handleDismiss}
          size="small"
          aria-label="close"
          sx={{
            position: 'absolute', top: 18, right: 18,
            width: 28, height: 28, borderRadius: '7px',
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <X size={16} strokeWidth={1.8} />
        </IconButton>

        {/* Icon tile */}
        <LockTile size={42} />

        {/* Headline */}
        <Typography sx={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2,
          color: 'text.primary', mt: 1.75, mb: 0.875,
        }}>
          {featureName ? `Unlock ${featureName.toLowerCase()}` : `${tierLabel} required`}
        </Typography>

        {/* Sub-copy */}
        <Typography sx={{ fontSize: 13.5, fontWeight: 300, lineHeight: 1.55, color: 'text.secondary', mb: 2.25 }}>
          {`You're on ${currentTierLabel}. ${featureName ?? 'This feature'} comes with ${tierLabel} — here's what changes:`}
        </Typography>

        {/* Benefits */}
        {benefits && benefits.length > 0 && (
          <Stack spacing={1.375} sx={{ mb: 2.25 }}>
            {benefits.map((b) => (
              <Box key={b} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                <Box sx={{
                  width: 20, height: 20, borderRadius: '6px',
                  background: alpha(theme.palette.primary.main, 0.08),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, mt: '1px',
                }}>
                  <Check size={12} color={theme.palette.primary.main} strokeWidth={2.6} />
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 300, lineHeight: 1.45, color: 'text.secondary' }}>
                  {b}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}

        {/* Tier step: Current → Required */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1.5,
          background: theme.palette.action.hover,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '10px', mb: 2.25,
        }}>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.375 }}>
              Now
            </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}>
              {currentTierLabel}
            </Typography>
          </Box>
          <ArrowRight size={18} color={theme.palette.action.disabled} strokeWidth={1.8} />
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'primary.main', mb: 0.375 }}>
              Required
            </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>
              {tierLabel}
            </Typography>
          </Box>
        </Box>

        {/* CTA */}
        <Button
          fullWidth
          variant="contained"
          onClick={handleUpgrade}
          sx={{
            height: 46, borderRadius: '8px', fontWeight: 600, fontSize: 14, mb: 1.5,
            bgcolor: 'primary.main', color: '#fff',
            '&:hover': { bgcolor: 'primary.light' },
          }}
        >
          Upgrade to {tierLabel}{tierPrice ? ` — ${tierPrice}/mo` : ''}
        </Button>

        {/* Dismiss */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography
            component="span"
            onClick={handleDismiss}
            sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary', cursor: 'pointer' }}
          >
            Maybe later
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  requiredTier,
  mode,
  featureName,
  featureBlurb,
  benefits,
  children,
  open = false,
  onClose,
}) => {
  const resolvedMode = mode === 'overlay' ? 'teased' : mode;

  if (resolvedMode === 'modal') {
    return (
      <UpgradeModal
        requiredTier={requiredTier}
        featureName={featureName}
        benefits={benefits}
        open={open}
        onClose={onClose}
      />
    );
  }

  if (resolvedMode === 'locked') {
    return (
      <LockedGate
        requiredTier={requiredTier}
        featureName={featureName}
        featureBlurb={featureBlurb}
      />
    );
  }

  return (
    <TeasedOverlay
      requiredTier={requiredTier}
      featureName={featureName}
      featureBlurb={featureBlurb}
    >
      {children}
    </TeasedOverlay>
  );
};

export default UpgradePrompt;
