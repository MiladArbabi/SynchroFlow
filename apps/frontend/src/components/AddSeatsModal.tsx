// apps/frontend/src/components/AddSeatsModal.tsx
//
// AddSeatsModal (AUD-C16)
// -------------------------
// Seat-limit modal for Core/Growth shops — offers two paths side by
// side, matching the ShippedOrderCapBanner pattern (pay-per-order +
// upgrade-plan as parallel CTAs, not a forced either/or):
//
//   1. Add N extra seats to the existing subscription (stepper + CTA)
//   2. Upgrade to the next tier (secondary link)
//
// Starter shops do NOT use this component — no seat add-on product
// exists for Starter (confirmed live in Stripe, 2026-07-14). Starter
// hitting its seat limit should continue to use the generic
// UpgradePrompt modal (tier-upgrade only).
//
// Does not modify shop_subscriptions.extra_seats directly — that is
// derived server-side from the Stripe subscription's item list on the
// next customer.subscription.updated webhook (handleSubscriptionUpsert).

import { useState } from 'react';
import {
  Box, Button, Dialog, DialogContent, IconButton,
  Stack, Typography, useTheme, alpha, CircularProgress,
} from '@mui/material';
import { Lock, X, Minus, Plus } from 'lucide-react';
import { axiosInstance } from '../api/axiosConfig';
import { useEntitlements } from '../contexts/EntitlementsContext';
import {
  SEAT_DISPLAY_PRICES,
  formatDisplayPrice,
  type BillingCurrency,
  type SeatTier,
} from '../config/pricingDisplay';

const NEXT_TIER: Record<SeatTier, string> = {
  core: 'Growth',
  growth: 'Scale',
};

const BILLING_URL = '/settings/billing';

export interface AddSeatsModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful add-seats request, before the modal closes. */
  onSuccess?: () => void;
}

export function AddSeatsModal({ open, onClose, onSuccess }: AddSeatsModalProps) {
  const theme = useTheme();
  const { tier, billingCurrency } = useEntitlements();
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: this component should only ever render for core/growth —
  // MembersPage picks the right modal based on tier. Defensive fallback
  // avoids a crash if ever mounted with an unsupported tier.
  const seatTier = (tier === 'core' || tier === 'growth') ? tier as SeatTier : null;
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const unitPrice = seatTier ? SEAT_DISPLAY_PRICES[seatTier][currency] : 0;
  const totalPrice = unitPrice * quantity;

  const handleAdd = async () => {
    if (!seatTier) return;
    setSubmitting(true);
    setError(null);
    try {
      await axiosInstance.post('/api/v1/billing/add-seats', { quantity });
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('[AddSeatsModal] add-seats failed', err);
      setError('Could not add seats. Please try again or contact support.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpgrade = () => {
    onClose();
    window.location.href = BILLING_URL;
  };

  if (!seatTier) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: { width: 440, maxWidth: '100%', borderRadius: '14px' },
      }}
    >
      <DialogContent sx={{ p: 3.5, position: 'relative' }}>
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', top: 12, right: 12, color: 'text.secondary' }}
        >
          <X size={18} />
        </IconButton>

        <Box sx={{
          width: 44, height: 44, borderRadius: '10px',
          bgcolor: alpha(theme.palette.primary.main, 0.1),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2,
        }}>
          <Lock size={20} color={theme.palette.primary.main} strokeWidth={1.8} />
        </Box>

        <Typography sx={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 27, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2,
          color: 'text.primary', mb: 1.25,
        }}>
          Add team seats
        </Typography>

        <Typography sx={{ fontSize: 14.5, fontWeight: 300, lineHeight: 1.6, color: 'text.secondary', mb: 2.75 }}>
          You've reached your seat limit. Add more seats to your current plan, or upgrade for more headroom.
        </Typography>

        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          p: 2, borderRadius: '10px', border: `1px solid ${theme.palette.divider}`, mb: 2,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton
              size="small"
              disabled={quantity <= 1}
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: '6px' }}
            >
              <Minus size={14} />
            </IconButton>
            <Typography sx={{ fontSize: 16, fontWeight: 600, width: 24, textAlign: 'center' }}>
              {quantity}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setQuantity(q => Math.min(20, q + 1))}
              sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: '6px' }}
            >
              <Plus size={14} />
            </IconButton>
          </Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'text.secondary' }}>
            {formatDisplayPrice(totalPrice, currency)}/mo
          </Typography>
        </Box>

        {error && (
          <Typography sx={{ fontSize: 12.5, color: 'error.main', mb: 1.5 }}>
            {error}
          </Typography>
        )}

        <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={handleAdd}
            disabled={submitting}
            sx={{ borderRadius: '8px', fontWeight: 600, fontSize: 14, height: 44 }}
          >
            {submitting
              ? <CircularProgress size={18} color="inherit" />
              : `Add ${quantity} seat${quantity > 1 ? 's' : ''} — ${formatDisplayPrice(totalPrice, currency)}/mo`}
          </Button>
        </Stack>

        <Typography
          component="a"
          href={BILLING_URL}
          onClick={(e) => { e.preventDefault(); handleUpgrade(); }}
          sx={{
            fontSize: 13, fontWeight: 500, color: 'primary.main', cursor: 'pointer',
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
            pb: '1px', textDecoration: 'none', display: 'inline-block',
            '&:hover': { borderBottomColor: 'primary.main' },
          }}
        >
          Or upgrade to {NEXT_TIER[seatTier]} for more headroom
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

export default AddSeatsModal;