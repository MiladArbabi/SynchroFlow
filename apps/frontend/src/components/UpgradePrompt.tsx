// apps/frontend/src/components/UpgradePrompt.tsx
//
// UpgradePrompt (MON-10)
// -----------------------
// Reusable upgrade gate component. Two display modes:
//
//   mode="overlay"  — renders children with blur + upgrade CTA on top.
//                     Use for intelligence module previews (MON-06).
//
//   mode="modal"    — renders a standalone Dialog with upgrade CTA.
//                     Use for hard gates (seat limit, order cap).
//
// Usage:
//   <UpgradePrompt requiredTier="growth" mode="overlay">
//     <CashFlowChart />
//   </UpgradePrompt>
//
//   <UpgradePrompt requiredTier="growth" mode="modal" open={atLimit} onClose={...} />
//
// Theming: uses useTheme() exclusively — no hardcoded colors.
// Palette source of truth: apps/frontend/src/themes/palette.ts

import React, { useEffect } from 'react';
import { sendEvent } from '../analytics/adapter';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { PEGGED_DISPLAY_PRICES, formatDisplayPrice, type BillingCurrency } from '../config/pricingDisplay';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

// ─────────────────────────────────────────────
// Tier display metadata (must stay in sync with tiers.ts)
// ─────────────────────────────────────────────
const TIER_LABELS: Record<string, string> = {
  starter: 'Starter',
  core:    'Core',
  growth:  'Growth',
  scale:   'Scale',
};

const BILLING_URL = '/settings/billing';

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface UpgradePromptProps {
  /** Minimum tier required to access the gated feature */
  requiredTier: string;
  /** Display mode */
  mode: 'overlay' | 'modal';
  /** Human-readable feature name shown in CTA copy */
  featureName?: string;
  /** overlay mode: content to blur behind the prompt */
  children?: React.ReactNode;
  /** modal mode: controlled open state */
  open?: boolean;
  /** modal mode: called when user dismisses */
  onClose?: () => void;
}

// ─────────────────────────────────────────────
// Shared CTA content
// ─────────────────────────────────────────────
function UpgradeCTAContent({
  requiredTier,
  featureName,
  onClose,
}: {
  requiredTier: string;
  featureName?: string;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const tierLabel = TIER_LABELS[requiredTier] ?? 'Growth';
  const tierPrice = requiredTier !== 'starter' && requiredTier in PEGGED_DISPLAY_PRICES
    ? `${formatDisplayPrice(PEGGED_DISPLAY_PRICES[requiredTier as keyof typeof PEGGED_DISPLAY_PRICES][currency].monthly, currency)}/mo`
    : 'Free';
  const tier = { label: tierLabel, price: tierPrice };

  // Track impression on mount
  useEffect(() => {
    sendEvent('upgrade_prompt.shown', { requiredTier, featureName: featureName ?? null });
  }, [requiredTier, featureName]);

  return (
    <Stack spacing={2} alignItems="center" textAlign="center" sx={{ py: 2 }}>
      {/* Lock icon badge */}
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          bgcolor: theme.palette.action.hover,
          border: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LockOutlinedIcon sx={{ color: theme.palette.text.secondary }} />
      </Box>

      <Typography
        variant="h6"
        fontWeight={700}
        sx={{ color: theme.palette.text.primary }}
      >
        {featureName
          ? `${featureName} requires ${tier.label}`
          : `${tier.label} plan required`}
      </Typography>

      <Typography
        variant="body2"
        sx={{ color: theme.palette.text.secondary, maxWidth: 320 }}
      >
        Upgrade to <strong>{tier.label}</strong> ({tier.price}) to unlock this
        feature and the full intelligence suite.
      </Typography>

      <Button
        variant="contained"
        size="large"
        endIcon={<ArrowForwardIcon />}
        href={BILLING_URL}
        onClick={() => sendEvent('upgrade_prompt.clicked', { requiredTier, featureName: featureName ?? null })}
        sx={{
          mt: 1,
          px: 4,
          borderRadius: 2,
          fontWeight: 700,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          '&:hover': {
            bgcolor: theme.palette.action.active,
          },
        }}
      >
        Upgrade to {tier.label}
      </Button>

      {onClose && (
        <Button
          variant="text"
          size="small"
          onClick={() => {
            sendEvent('upgrade_prompt.dismissed', { requiredTier, featureName: featureName ?? null });
            onClose();
          }}
          sx={{ color: theme.palette.action.disabled }}
        >
          Maybe later
        </Button>
      )}
    </Stack>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  requiredTier,
  mode,
  featureName,
  children,
  open = false,
  onClose,
}) => {
  const theme = useTheme();

  if (mode === 'modal') {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            bgcolor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'flex-end', pb: 0 }}>
          {onClose && (
            <IconButton size="small" onClick={onClose} aria-label="close">
              <CloseIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent>
          <UpgradeCTAContent
            requiredTier={requiredTier}
            featureName={featureName}
            onClose={onClose}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // overlay mode
  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Blurred content preview */}
      <Box
        sx={{
          filter: 'blur(4px)',
          pointerEvents: 'none',
          userSelect: 'none',
          opacity: 0.5,
          width: '100%',
          height: '100%',
        }}
        aria-hidden="true"
      >
        {children}
      </Box>

      {/* Upgrade CTA overlay */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: theme.palette.mode === 'dark'
            ? 'rgba(11,18,32,0.75)'   // neutralSurface dark with opacity
            : 'rgba(248,250,252,0.75)', // neutralSurface light with opacity
          backdropFilter: 'blur(2px)',
          borderRadius: 2,
          zIndex: 10,
        }}
      >
        <Box
          sx={{
            bgcolor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 3,
            boxShadow: theme.shadows[6],
            px: 4,
            py: 3,
            maxWidth: 360,
            width: '100%',
          }}
        >
          <UpgradeCTAContent
            requiredTier={requiredTier}
            featureName={featureName}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default UpgradePrompt;