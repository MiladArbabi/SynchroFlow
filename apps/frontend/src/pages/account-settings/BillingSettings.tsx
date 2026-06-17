// apps/frontend/src/pages/account-settings/BillingSettings.tsx
//
// BILLING SETTINGS (UX-02)
// -------------------------
// Shows current plan, usage meters, 3 account-status states, and
// a recommended-upgrade sidebar.
//
// Data:
//   GET  /api/v1/billing/subscription → SubscriptionData
//   GET  /api/v1/billing/usage        → UsageData (non-fatal)
//   POST /api/v1/billing/checkout     → Stripe/Shopify checkout redirect
//   POST /api/v1/billing/portal       → Stripe customer portal redirect

import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Button, Alert, CircularProgress, Divider,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { ExternalLink, Check, Users } from 'lucide-react';
import { axiosInstance } from '../../api/axiosConfig';
import {
  TIER_MONTHLY_ORDER_CAP, TIER_SHIPPED_ORDER_CAP, type Tier,
} from '../../config/tiers';
import {
  PEGGED_DISPLAY_PRICES, formatDisplayPrice, annualSavings, type BillingCurrency,
} from '../../config/pricingDisplay';
import { useEntitlements } from '../../contexts/EntitlementsContext';

// ─────────────────────────────────────────────
// Static plan metadata (aligns with design system)
// ─────────────────────────────────────────────

const PLAN_FEATURES: Record<string, string[]> = {
  starter: ['Orders & fulfillment queue', 'Real-time stock alerts', '1 sales channel', 'Email support'],
  core:    ['Everything in Starter', 'WMS — pick / pack / stow', 'Barcode scanning', 'Returns management', 'Product catalog'],
  growth:  ['Everything in Core', 'Cash flow & runway', 'Demand forecasting', 'Customer LTV', 'Supplier scorecards'],
  scale:   ['Everything in Growth', 'Warehouse floor planning', 'Unlimited seats', 'Specter intelligence', 'Priority support'],
};

const PLAN_BLURBS: Record<string, string> = {
  starter: 'For shops getting their first orders under control.',
  core:    'Run the warehouse — scan, pick, pack, return.',
  growth:  'See the money — forecasting, cash flow, LTV.',
  scale:   'No limits — floor planning and unlimited team.',
};

const PLAN_SEATS: Record<string, string> = {
  starter: '0 extra seats',
  core:    '2 non-owner seats',
  growth:  '5 non-owner seats',
  scale:   'Unlimited seats',
};

// Next recommended tier given the current one
const NEXT_TIER: Partial<Record<string, string>> = {
  starter: 'growth',
  core:    'growth',
  growth:  'scale',
};

const UPGRADE_TIERS = ['core', 'growth', 'scale'] as const;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SubscriptionData {
  tier: string;
  status: string;
  billing_interval: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
}

interface UsageData {
  ingested_orders: number;
  shipped_orders: number;
  tier: string;
  period_starts_at: string | null;
}

// ─────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────
// Status chip  (active · trialing · past due)
// ─────────────────────────────────────────────

function StatusChip({
  label, color, dot = false,
}: { label: string; color: 'success' | 'warning' | 'error'; dot?: boolean }) {
  const theme = useTheme();
  const main = theme.palette[color].main;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
      fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: main,
      background: alpha(main, 0.1),
      border: '0.5px solid var(--rule)',
      borderRadius: '100px', px: 1.25, py: 0.5,
    }}>
      {dot && <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: main, flexShrink: 0 }} />}
      {label}
    </Box>
  );
}

// ─────────────────────────────────────────────
// Usage meter
// ─────────────────────────────────────────────

function UsageMeter({
  label, used, cap, unit,
}: { label: string; used: number; cap: number; unit: string }) {
  const theme = useTheme();
  const infinite = cap === Infinity || cap <= 0;
  const pct = infinite ? 0 : Math.min(100, Math.round((used / cap) * 100));

  let fill: string, note: string, noteColor: string;
  if (pct >= 100) {
    fill = theme.palette.error.main; note = 'Limit reached'; noteColor = theme.palette.error.main;
  } else if (pct >= 80) {
    fill = theme.palette.warning.main; note = 'Approaching limit'; noteColor = theme.palette.warning.main;
  } else {
    fill = theme.palette.success.main; note = 'On track'; noteColor = theme.palette.text.secondary;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary' }}>{label}</Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>
          {used.toLocaleString('en-US')}{' '}
          <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
            / {infinite ? '∞' : cap.toLocaleString('en-US')} {unit}
          </Box>
        </Typography>
      </Box>
      <Box sx={{ height: 8, borderRadius: '100px', background: 'var(--bg)', overflow: 'hidden' }}>
        {!infinite && (
          <Box sx={{
            height: '100%', width: `${pct}%`,
            borderRadius: '100px', background: fill, transition: 'width 0.4s ease',
          }} />
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.875 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: noteColor }}>{note}</Typography>
        {!infinite && (
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'text.disabled' }}>
            · {pct}% used
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Annual savings callout (inside usage panel)
// ─────────────────────────────────────────────

function AnnualSavingsCallout({
  currency, tierId, onSwitch,
}: { currency: BillingCurrency; tierId: Exclude<Tier, 'starter'>; onSwitch: () => void }) {
  const theme = useTheme();
  const savings = annualSavings(tierId, currency);
  if (!savings) return null;

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, mt: 3, px: 2, py: 1.75,
      background: alpha(theme.palette.primary.main, 0.08),
      border: '0.5px solid var(--rule)',
      borderRadius: '10px',
    }}>
      {/* Dollar-sign icon (inline SVG — no extra dep) */}
      <Box
        component="svg" width={18} height={18} viewBox="0 0 24 24"
        fill="none" stroke={theme.palette.primary.main}
        strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
        sx={{ flexShrink: 0 }}
      >
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'text.primary' }}>
          Switch to annual and save {formatDisplayPrice(savings, currency)}/year
        </Typography>
        <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'text.secondary', mt: 0.125 }}>
          Same plan, ~20% off — billed once a year.
        </Typography>
      </Box>
      <Typography
        onClick={onSwitch}
        sx={{ fontSize: 12, fontWeight: 600, color: 'primary.main', cursor: 'pointer', flexShrink: 0 }}
      >
        Switch
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Recommended upgrade card (right sidebar)
// ─────────────────────────────────────────────

function RecommendedUpgrade({
  tierId, currency, billingInterval, onUpgrade, upgrading,
}: {
  tierId: string;
  currency: BillingCurrency;
  billingInterval: 'monthly' | 'annual';
  onUpgrade: (id: string) => void;
  upgrading: string | null;
}) {
  const theme = useTheme();
  if (!(tierId in PEGGED_DISPLAY_PRICES)) return null;

  const tierKey = tierId as keyof typeof PEGGED_DISPLAY_PRICES;
  const isAnnual = billingInterval === 'annual';
  const monthly = PEGGED_DISPLAY_PRICES[tierKey][currency].monthly;
  const annual  = PEGGED_DISPLAY_PRICES[tierKey][currency].annual / 12;
  const displayPrice = formatDisplayPrice(isAnnual ? annual : monthly, currency);
  const tierLabel = tierId.charAt(0).toUpperCase() + tierId.slice(1);
  const isFeatured = tierId === 'growth';

  return (
    <Box sx={{ px: 3, py: 3, background: 'var(--bg)' }}>
      <Typography sx={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'text.secondary', mb: 1.5,
      }}>
        Recommended upgrade
      </Typography>

      <Box sx={{
        background: 'var(--surface)',
        border: '0.5px solid var(--rule)',
        borderRadius: '12px', p: 2.25,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>{tierLabel}</Typography>
          {isFeatured && (
            <Box component="span" sx={{
              fontSize: '9px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: 'primary.main',
              background: alpha(theme.palette.primary.main, 0.08),
              border: '0.5px solid var(--rule)',
              borderRadius: '100px', px: 1, py: 0.375, whiteSpace: 'nowrap',
            }}>
              Most popular
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.375, mb: 2 }}>
          <Typography sx={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 30, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.02em', color: 'text.primary',
          }}>
            {displayPrice}
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary' }}>/mo</Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.125, mb: 2 }}>
          {(PLAN_FEATURES[tierId] ?? []).map((f) => (
            <Box key={f} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box
                component="svg" width={13} height={13} viewBox="0 0 24 24"
                fill="none" stroke={theme.palette.primary.main}
                strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                sx={{ flexShrink: 0, mt: '2px' }}
              >
                <path d="M20 6L9 17l-5-5" />
              </Box>
              <Typography sx={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.35, color: 'text.secondary' }}>
                {f}
              </Typography>
            </Box>
          ))}
        </Box>

        <Button
          fullWidth variant="contained"
          disabled={upgrading !== null}
          onClick={() => onUpgrade(tierId)}
          endIcon={upgrading === tierId ? <CircularProgress size={12} color="inherit" /> : undefined}
          sx={{
            height: 40, borderRadius: '8px', fontWeight: 600, fontSize: 13,
            bgcolor: 'var(--accent)', color: theme.palette.common.white,
            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
          }}
        >
          {upgrading === tierId ? 'Redirecting…' : `Upgrade to ${tierLabel}`}
        </Button>

        <Typography sx={{ textAlign: 'center', mt: 1.25, fontSize: 11.5, fontWeight: 300, color: 'text.secondary' }}>
          {PLAN_SEATS[tierId]}
        </Typography>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Tier card (plan selector grid)
// ─────────────────────────────────────────────

function TierCard({
  tierId, currency, billingInterval, isCurrent, onUpgrade, upgrading,
}: {
  tierId: string;
  currency: BillingCurrency;
  billingInterval: 'monthly' | 'annual';
  isCurrent: boolean;
  onUpgrade: (id: string) => void;
  upgrading: string | null;
}) {
  const theme = useTheme();
  const isFeatured = tierId === 'growth';
  const isAnnual   = billingInterval === 'annual';
  const tierLabel  = tierId.charAt(0).toUpperCase() + tierId.slice(1);
  const hasPricing = tierId in PEGGED_DISPLAY_PRICES;
  const tierKey    = tierId as keyof typeof PEGGED_DISPLAY_PRICES;

  const priceDisplay = hasPricing
    ? formatDisplayPrice(
        isAnnual
          ? PEGGED_DISPLAY_PRICES[tierKey][currency].annual / 12
          : PEGGED_DISPLAY_PRICES[tierKey][currency].monthly,
        currency,
      )
    : 'Free';

  const annualSaveAmt: number | null = hasPricing && isAnnual
    ? annualSavings(tierId as Exclude<Tier, 'starter'>, currency)
    : null;

  const cardBg     = isFeatured ? alpha(theme.palette.primary.main, 0.06) : 'var(--surface)';

  return (
    <Box sx={{
      position: 'relative', display: 'flex', flexDirection: 'column',
      background: cardBg, border: '0.5px solid var(--rule)',
      borderRadius: '12px', p: '22px 20px', flex: 1, minWidth: 0,
    }}>
      {/* "Most popular" badge */}
      {isFeatured && !isCurrent && (
        <Box sx={{
          position: 'absolute', top: -10, left: 20,
          fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: theme.palette.common.white, background: 'var(--accent)',
          px: 1.25, py: 0.5, borderRadius: '100px', whiteSpace: 'nowrap',
        }}>
          Most popular
        </Box>
      )}

      <Typography sx={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.01em', color: 'text.primary' }}>
        {tierLabel}
      </Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 300, lineHeight: 1.5, color: 'text.secondary', mt: 0.875, minHeight: 54 }}>
        {PLAN_BLURBS[tierId] ?? ''}
      </Typography>

      {/* Price */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.375, mt: 0.75 }}>
        <Typography sx={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 38, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.02em', color: 'text.primary',
        }}>
          {priceDisplay}
        </Typography>
        {hasPricing && (
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary' }}>/mo</Typography>
        )}
      </Box>

      {/* Annual save badge or spacer */}
      <Box sx={{ height: 18, mt: 0.625 }}>
        {annualSaveAmt != null && (
          <Box component="span" sx={{
            fontSize: '11px', fontWeight: 600, color: 'primary.main',
            background: alpha(theme.palette.primary.main, 0.08),
            px: 1, py: 0.375, borderRadius: '100px',
          }}>
            Save {formatDisplayPrice(annualSaveAmt, currency)}/yr
          </Box>
        )}
      </Box>

      {/* Seats */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875, mt: 2 }}>
        <Users size={14} color={theme.palette.text.disabled} />
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary' }}>
          {PLAN_SEATS[tierId]}
        </Typography>
      </Box>

      {/* CTA */}
      <Box sx={{ mt: 2 }}>
        {isCurrent ? (
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.875, height: 40,
            border: '0.5px solid var(--rule)',
            background: alpha(theme.palette.success.main, 0.08),
            borderRadius: '8px',
          }}>
            <Check size={14} color={theme.palette.success.main} strokeWidth={2} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'success.main' }}>Current plan</Typography>
          </Box>
        ) : (
          <Button
            fullWidth
            variant={isFeatured ? 'contained' : 'outlined'}
            size="small"
            disabled={upgrading !== null}
            onClick={() => onUpgrade(tierId)}
            endIcon={upgrading === tierId ? <CircularProgress size={12} color="inherit" /> : undefined}
            sx={{
              height: 40, borderRadius: '8px', fontWeight: 600, fontSize: 13,
              ...(isFeatured
                ? { bgcolor: 'var(--accent)', color: theme.palette.common.white, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }
                : { borderColor: 'var(--rule)', color: 'text.primary', '&:hover': { borderColor: 'text.disabled' } }),
            }}
          >
            {upgrading === tierId ? 'Redirecting…' : `Upgrade to ${tierLabel}`}
          </Button>
        )}
      </Box>

      {/* Feature list */}
      <Box sx={{ borderTop: `1px solid ${'var(--rule)'}`, mt: 2.25, pt: 1.875, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {(PLAN_FEATURES[tierId] ?? []).map((f) => (
          <Box key={f} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box
              component="svg" width={14} height={14} viewBox="0 0 24 24"
              fill="none" stroke={theme.palette.primary.main}
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
              sx={{ flexShrink: 0, mt: '2px' }}
            >
              <path d="M20 6L9 17l-5-5" />
            </Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.35, color: 'text.secondary' }}>
              {f}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Plan header  (3 status states)
// ─────────────────────────────────────────────

function PlanHeader({
  sub, currentTier, currency, onPortal, openingPortal, onUpgrade,
}: {
  sub: SubscriptionData;
  currentTier: string;
  currency: BillingCurrency;
  onPortal: () => void;
  openingPortal: boolean;
  onUpgrade: (tierId: string) => void;
}) {
  const theme = useTheme();
  const tierLabel   = currentTier.charAt(0).toUpperCase() + currentTier.slice(1);
  const isTrialing  = sub.status === 'trialing';
  const isPastDue   = sub.status === 'past_due';
  const hasPricing  = currentTier in PEGGED_DISPLAY_PRICES;
  const tierKey     = currentTier as keyof typeof PEGGED_DISPLAY_PRICES;

  const monthlyPrice = hasPricing
    ? formatDisplayPrice(PEGGED_DISPLAY_PRICES[tierKey][currency].monthly, currency)
    : null;

  const billingLine = hasPricing && sub.billing_interval && sub.current_period_end
    ? `${monthlyPrice}/mo · billed ${sub.billing_interval} · renews ${fmtDate(sub.current_period_end)}`
    : null;

  const daysLeft = isTrialing && sub.trial_ends_at ? daysUntil(sub.trial_ends_at) : 0;

  return (
    <Box sx={{ border: '0.5px solid var(--rule)', borderRadius: '16px', overflow: 'hidden' }}>
      {/* Plan name row */}
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 2.5, px: 3.5, py: 3,
        borderBottom: (isTrialing || isPastDue) ? `1px solid ${'var(--rule)'}` : 'none',
      }}>
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'text.secondary' }}>
            Your plan
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.375, mt: 0.875 }}>
            <Typography sx={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 26, fontWeight: 400, color: 'text.primary',
            }}>
              {tierLabel}
            </Typography>
            {isPastDue ? (
              <StatusChip label="Past due" color="error" />
            ) : isTrialing ? (
              <StatusChip label="Trialing" color="warning" />
            ) : (
              <StatusChip label="Active" color="success" dot />
            )}
          </Box>
          {billingLine && !isTrialing && !isPastDue && (
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'text.secondary', mt: 1 }}>
              {billingLine}
            </Typography>
          )}
        </Box>

        <Button
          size="small" variant="outlined"
          startIcon={<ExternalLink size={14} />}
          disabled={openingPortal}
          onClick={onPortal}
          sx={{
            flexShrink: 0, height: 40, borderRadius: '8px', fontWeight: 600, fontSize: 13,
            borderColor: 'divider', color: 'text.secondary',
            '&:hover': { borderColor: 'text.disabled' },
          }}
        >
          {openingPortal ? 'Opening…' : 'Manage billing'}
        </Button>
      </Box>

      {/* Trialing alert */}
      {isTrialing && sub.trial_ends_at && (
        <Box sx={{ px: 3.5, py: 2.5 }}>
          <Box sx={{
            p: '14px 16px',
            background: alpha(theme.palette.warning.main, 0.08),
            border: '0.5px solid var(--rule)',
            borderRadius: '10px',
          }}>
            <Typography sx={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 22, color: 'text.primary',
            }}>
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 300, lineHeight: 1.45, color: 'text.secondary', mt: 0.375 }}>
              on your {tierLabel} trial. Add a payment method to keep forecasting, cash flow and LTV.
            </Typography>
            <Button
              variant="contained" size="small" onClick={() => onUpgrade(currentTier)} disabled={openingPortal}
              sx={{
                mt: 1.5, height: 34, borderRadius: '8px', fontWeight: 600, fontSize: 12,
                bgcolor: 'var(--accent)', color: theme.palette.common.white, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
              }}
            >
              Add payment method
            </Button>
          </Box>
        </Box>
      )}

      {/* Past due alert */}
      {isPastDue && (
        <Box sx={{ px: 3.5, py: 2.5 }}>
          <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1, p: '14px 16px',
            background: alpha(theme.palette.error.main, 0.08),
            border: '0.5px solid var(--rule)',
            borderRadius: '10px',
          }}>
            {/* Warning triangle SVG */}
            <Box
              component="svg" width={16} height={16} viewBox="0 0 24 24"
              fill="none" stroke={theme.palette.error.main}
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
              sx={{ flexShrink: 0, mt: '1px' }}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.5, color: 'text.secondary' }}>
                Payment failed. Update your card to avoid losing access.
              </Typography>
              <Button
                variant="contained" size="small" onClick={onPortal} disabled={openingPortal}
                sx={{
                  mt: 1.5, height: 34, borderRadius: '8px', fontWeight: 600, fontSize: 12,
                  bgcolor: 'error.main', color: theme.palette.common.white, '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.9) },
                }}
              >
                Update payment
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────
// Billing interval toggle
// ─────────────────────────────────────────────

function BillingToggle({
  value, onChange,
}: { value: 'monthly' | 'annual'; onChange: (v: 'monthly' | 'annual') => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}>Billing</Typography>
      <Box sx={{
        display: 'flex',
        background: 'var(--bg)',
        border: '0.5px solid var(--rule)',
        borderRadius: '10px', p: '3px',
      }}>
        {(['monthly', 'annual'] as const).map((iv) => (
          <Box
            key={iv}
            onClick={() => onChange(iv)}
            sx={{
              px: 2, py: 0.875, borderRadius: '7px', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 600,
              color: value === iv ? 'text.primary' : 'text.secondary',
              background: value === iv ? 'var(--surface)' : 'transparent',
              transition: 'all 0.12s',
            }}
          >
            {iv.charAt(0).toUpperCase() + iv.slice(1)}
          </Box>
        ))}
      </Box>
      {value === 'annual' && (
        <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.03em', color: 'primary.main' }}>
          Save ~20% billed annually
        </Typography>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

const BillingSettings: React.FC = () => {
  const { tier: currentTier, billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;

  const [sub, setSub]                   = useState<SubscriptionData | null>(null);
  const [usage, setUsage]               = useState<UsageData | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [billingInterval, setBilling]   = useState<'monthly' | 'annual'>('monthly');
  const [upgrading, setUpgrading]       = useState<string | null>(null);
  const [openingPortal, setOpPortal]    = useState(false);
  const planCardsRef                    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    axiosInstance.get('/api/v1/billing/subscription')
      .then((r) => {
        setSub(r.data);
        if (r.data.billing_interval === 'annual') setBilling('annual');
      })
      .catch(() => setError('Failed to load billing information.'))
      .finally(() => setLoading(false));

    axiosInstance.get('/api/v1/billing/usage')
      .then((r) => setUsage(r.data))
      .catch(() => {}); // non-fatal
  }, []);

  const handleUpgrade = async (tierId: string) => {
    setUpgrading(tierId);
    try {
      const { data } = await axiosInstance.post('/api/v1/billing/checkout', {
        tier: tierId, interval: billingInterval,
      });
      if (data.url) window.location.href = data.url;
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'APP_STORE_MERCHANT') {
        setError("Paid plans aren't available yet for stores installed via the Shopify App Store — you'll keep full access on the Starter plan in the meantime.");
      } else {
        setError('Failed to start checkout. Please try again.');
      }
      setUpgrading(null);
    }
  };

  const handlePortal = async () => {
    setOpPortal(true);
    try {
      const { data } = await axiosInstance.post('/api/v1/billing/portal');
      if (data.url) window.location.href = data.url;
    } catch (err) {
      // NO_STRIPE_CUSTOMER = trial user, no payment added yet — direct to checkout
      // APP_STORE_MERCHANT = no Shopify-side paid plans exist yet (Starter is free fallback)
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'NO_STRIPE_CUSTOMER') {
        setOpPortal(false);
        setError('No billing account yet — add a payment method first.');
      } else if (code === 'APP_STORE_MERCHANT') {
        setOpPortal(false);
        setError("Paid plans aren't available yet for stores installed via the Shopify App Store — you'll keep full access on the Starter plan in the meantime.");
      } else {
        setError('Failed to open billing portal.');
        setOpPortal(false);
      }
    }
  };

  const handleSwitchAnnual = () => {
    setBilling('annual');
    planCardsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const tier       = currentTier ?? 'starter';
  const nextTierId = NEXT_TIER[tier];
  const isMonthly  = billingInterval === 'monthly';

  const ingestedCap = TIER_MONTHLY_ORDER_CAP[tier as Tier] ?? Infinity;
  const shippedCap  = TIER_SHIPPED_ORDER_CAP[tier as Tier] ?? 0;

  const periodLabel = usage?.period_starts_at && sub?.current_period_end
    ? `${fmtShortDate(usage.period_starts_at)} – ${fmtShortDate(sub.current_period_end)}, ${new Date(sub.current_period_end).getFullYear()}`
    : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      )}

      {/* Plan header — status-aware */}
      {sub && (
        <PlanHeader
          sub={sub}
          currentTier={tier}
          currency={currency}
          onPortal={handlePortal}
          openingPortal={openingPortal}
          onUpgrade={handleUpgrade}
        />
      )}

      {/* Two-column: usage meters + recommended upgrade */}
      {usage && (
        <Box sx={{
          border: '0.5px solid var(--rule)',
          borderRadius: '16px', overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.55fr 1fr' },
        }}>
          {/* Left: usage */}
          <Box sx={{ px: 3.5, py: 3, borderRight: { md: `1px solid ${'var(--rule)'}` }, borderBottom: { xs: `1px solid ${'var(--rule)'}`, md: 'none' } }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2.5 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>
                Usage this period
              </Typography>
              {periodLabel && (
                <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'text.secondary' }}>
                  {periodLabel}
                </Typography>
              )}
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <UsageMeter
                label="Orders ingested"
                used={usage.ingested_orders}
                cap={ingestedCap}
                unit="orders"
              />
              {shippedCap > 0 && (
                <UsageMeter
                  label="Shipped orders"
                  used={usage.shipped_orders}
                  cap={shippedCap}
                  unit="shipments"
                />
              )}
            </Box>

            {isMonthly && tier !== 'starter' && tier in PEGGED_DISPLAY_PRICES && (
              <AnnualSavingsCallout
                currency={currency}
                tierId={tier as Exclude<Tier, 'starter'>}
                onSwitch={handleSwitchAnnual}
              />
            )}
          </Box>

          {/* Right: recommended upgrade */}
          {nextTierId && (
            <RecommendedUpgrade
              tierId={nextTierId}
              currency={currency}
              billingInterval={billingInterval}
              onUpgrade={handleUpgrade}
              upgrading={upgrading}
            />
          )}
        </Box>
      )}

      <Divider />

      {/* Billing toggle + plan cards */}
      <Box ref={planCardsRef}>
        <Box sx={{ mb: 3 }}>
          <BillingToggle value={billingInterval} onChange={setBilling} />
        </Box>

        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: 1.75, alignItems: 'start',
        }}>
          {UPGRADE_TIERS.map((tierId) => (
            <TierCard
              key={tierId}
              tierId={tierId}
              currency={currency}
              billingInterval={billingInterval}
              isCurrent={tier === tierId}
              onUpgrade={handleUpgrade}
              upgrading={upgrading}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export default BillingSettings;
