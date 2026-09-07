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
//
// DECISION-DRIVEN PATH (COMMERCIAL-ACCESS-ARCH-01 P0-A2B):
//   Migrated callers (Sidenav, ModuleTabBar, CommercialGate) pass a `decision`
//   (AccessDecision) instead of a raw `requiredTier` string. When `decision`
//   is present it is AUTHORITATIVE and the ONLY source of the required tier /
//   denial reason — never a fabricated tier step:
//     TIER_TOO_LOW                      -> upgrade CTA to the EXACT decision.requiredTier
//     MODULE_NOT_INCLUDED / FEATURE_NOT_INCLUDED (no requiredTier) -> no tier step at all
//     ROLE_FORBIDDEN                    -> no billing / upgrade CTA
//   Legacy `requiredTier` prop stays supported for non-migrated P0-A3 callers.

import React, { useEffect } from 'react';
import {
  Box, Button, Dialog, DialogContent, IconButton,
  Stack, Typography, useTheme, alpha,
} from '@mui/material';
import { Lock, X, ArrowRight, Check } from 'lucide-react';
import { useUiEvents } from '../analytics/useUiEvents';
import { useEntitlements } from '../contexts/EntitlementsContext';
import {
  PEGGED_DISPLAY_PRICES,
  formatDisplayPrice,
  type BillingCurrency,
} from '../config/pricingDisplay';
import type { AccessDecision } from '@lasyncro/commercial-policy';

const TIER_LABELS: Record<string, string> = {
  starter: 'Starter',
  core:    'Core',
  growth:  'Growth',
  scale:   'Scale',
};

// Legacy default tier label for the pre-A2B no-requiredTier call shape
// (non-migrated callers only — a `decision` never falls back to this).
const FALLBACK_TIER_LABEL = 'Growth';

const BILLING_URL = '/settings/billing';

export interface UpgradePromptProps {
  /** Legacy caller shape — required for non-migrated P0-A3 callers. Ignored when `decision` is present. */
  requiredTier?: string;
  /** Canonical AccessDecision (P0-A2B). When present, authoritative — supersedes `requiredTier`. */
  decision?: AccessDecision;
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
// Decision resolution — the ONLY place tier/denial-kind is derived
// ─────────────────────────────────────────────

type DenialKind = 'TIER' | 'MODULE' | 'ROLE';

interface ResolvedDenial {
  kind: DenialKind;
  /** Raw tier key, e.g. 'core' — present only for kind 'TIER'. */
  requiredTierValue?: string;
  /** Display label — present only for kind 'TIER'. */
  tierLabel?: string;
}

function resolveDenial(props: Pick<UpgradePromptProps, 'decision' | 'requiredTier'>): ResolvedDenial {
  const { decision, requiredTier } = props;

  if (decision) {
    if (decision.reason === 'ROLE_FORBIDDEN') {
      return { kind: 'ROLE' };
    }
    if (decision.requiredTier) {
      return {
        kind: 'TIER',
        requiredTierValue: decision.requiredTier,
        tierLabel: TIER_LABELS[decision.requiredTier],
      };
    }
    // MODULE_NOT_INCLUDED / FEATURE_NOT_INCLUDED carrying no tier step —
    // never fabricate one.
    return { kind: 'MODULE' };
  }

  // Legacy path (no decision) — preserves the pre-A2B default-to-Growth
  // behaviour for non-migrated callers that omit requiredTier entirely.
  return {
    kind: 'TIER',
    requiredTierValue: requiredTier,
    tierLabel: (requiredTier ? TIER_LABELS[requiredTier] : undefined) ?? FALLBACK_TIER_LABEL,
  };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function resolvePrice(requiredTier: string | undefined, currency: BillingCurrency): string | null {
  if (requiredTier && requiredTier in PEGGED_DISPLAY_PRICES) {
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
  tierLabel, featureName, featureBlurb, children, requiredTierValue,
}: { tierLabel: string; requiredTierValue?: string } & Pick<UpgradePromptProps, 'featureName' | 'featureBlurb' | 'children'>) {
  const theme = useTheme();
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const tierPrice = resolvePrice(requiredTierValue, currency);
  const { emit } = useUiEvents();

  useEffect(() => {
    emit('upgrade_prompt.shown', { requiredTier: requiredTierValue, featureName: featureName ?? null, mode: 'teased' });
  }, [requiredTierValue, featureName, emit]);

  const handleUpgrade = () => {
    emit('upgrade_prompt.clicked', { requiredTier: requiredTierValue, featureName: featureName ?? null });
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
  tierLabel, requiredTierValue, featureName, featureBlurb,
}: { tierLabel: string; requiredTierValue?: string } & Pick<UpgradePromptProps, 'featureName' | 'featureBlurb'>) {
  const theme = useTheme();
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const tierPrice = resolvePrice(requiredTierValue, currency);
  const { emit } = useUiEvents();

  useEffect(() => {
    emit('upgrade_prompt.shown', { requiredTier: tierLabel, featureName: featureName ?? null, mode: 'locked' });
  }, [tierLabel, featureName, emit]);

  const handleUpgrade = () => {
    emit('upgrade_prompt.clicked', { requiredTier: tierLabel, featureName: featureName ?? null });
    window.location.href = BILLING_URL;
  };

  const handleSeePlans = (e: React.MouseEvent) => {
    e.preventDefault();
    emit('upgrade_prompt.see_plans', { requiredTier: tierLabel });
    window.location.href = BILLING_URL;
  };

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 300, width: '100%',
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: '14px',
      background: 'var(--surface)',
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
  tierLabel, requiredTierValue, featureName, benefits, open, onClose,
}: { tierLabel: string; requiredTierValue?: string } &
  Required<Pick<UpgradePromptProps, 'open'>> &
  Pick<UpgradePromptProps, 'featureName' | 'benefits' | 'onClose'>) {
  const theme = useTheme();
  const { tier: currentTier, billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const currentTierLabel = TIER_LABELS[currentTier ?? 'starter'] ?? 'Starter';
  const tierPrice = resolvePrice(requiredTierValue, currency);
  const { emit } = useUiEvents();

  useEffect(() => {
    if (open) {
      emit('upgrade_prompt.shown', { requiredTier: requiredTierValue, featureName: featureName ?? null, mode: 'modal' });
    }
  }, [open, requiredTierValue, featureName, emit]);

  const handleUpgrade = () => {
    emit('upgrade_prompt.clicked', { requiredTier: requiredTierValue, featureName: featureName ?? null });
    onClose?.();
    window.location.href = BILLING_URL;
  };

  const handleDismiss = () => {
    emit('upgrade_prompt.dismissed', { requiredTier: requiredTierValue, featureName: featureName ?? null });
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
          {featureName ? `Unlock ${featureName}` : `${tierLabel} required`}
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
// Module/feature denial (no tier step) — decision-driven only
// ─────────────────────────────────────────────

function ModuleDenialModal({
  featureName, open, onClose,
}: Required<Pick<UpgradePromptProps, 'open'>> & Pick<UpgradePromptProps, 'featureName' | 'onClose'>) {
  const theme = useTheme();
  const { emit } = useUiEvents();

  useEffect(() => {
    if (open) emit('upgrade_prompt.shown', { requiredTier: null, featureName: featureName ?? null, mode: 'modal' });
  }, [open, featureName, emit]);

  const handleSeePlans = () => {
    emit('upgrade_prompt.clicked', { requiredTier: null, featureName: featureName ?? null });
    onClose?.();
    window.location.href = BILLING_URL;
  };

  const handleDismiss = () => {
    emit('upgrade_prompt.dismissed', { requiredTier: null, featureName: featureName ?? null });
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={handleDismiss}
      maxWidth={false}
      PaperProps={{
        sx: { width: 440, maxWidth: '100%', borderRadius: '14px', border: `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' },
      }}
    >
      <DialogContent sx={{ p: '26px', position: 'relative' }}>
        <IconButton
          onClick={handleDismiss}
          size="small"
          aria-label="close"
          sx={{ position: 'absolute', top: 18, right: 18, width: 28, height: 28, borderRadius: '7px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
        >
          <X size={16} strokeWidth={1.8} />
        </IconButton>

        <LockTile size={42} />

        <Typography sx={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2,
          color: 'text.primary', mt: 1.75, mb: 0.875,
        }}>
          {featureName ? `${featureName} isn't on your plan` : "This isn't on your plan"}
        </Typography>

        <Typography sx={{ fontSize: 13.5, fontWeight: 300, lineHeight: 1.55, color: 'text.secondary', mb: 2.25 }}>
          {featureName ?? 'This feature'} isn't included in your current plan. Contact billing to add it.
        </Typography>

        <Button
          fullWidth
          variant="contained"
          onClick={handleSeePlans}
          sx={{ height: 46, borderRadius: '8px', fontWeight: 600, fontSize: 14, bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.light' } }}
        >
          See plan options
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// Module/feature denial — inline (locked/teased), no tier step
// ─────────────────────────────────────────────

function ModuleDenialLocked({ featureName, featureBlurb }: Pick<UpgradePromptProps, 'featureName' | 'featureBlurb'>) {
  const theme = useTheme();
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
          {featureName ? `${featureName} isn't on your plan` : "This isn't on your plan"}
        </Typography>
        <Typography sx={{ fontSize: 14.5, fontWeight: 300, lineHeight: 1.6, color: 'text.secondary' }}>
          {featureBlurb ?? "This isn't included in your current plan. Contact billing to add it."}
        </Typography>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// Role/permission denial — no billing CTA at all
// ─────────────────────────────────────────────

function RoleForbiddenLocked() {
  const theme = useTheme();
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
          Restricted to your role
        </Typography>
        <Typography sx={{ fontSize: 14.5, fontWeight: 300, lineHeight: 1.6, color: 'text.secondary' }}>
          You don't have permission to access this. Ask an owner or admin on your team for access.
        </Typography>
      </Box>
    </Box>
  );
}

function RoleForbiddenModal({
  open, onClose,
}: Required<Pick<UpgradePromptProps, 'open'>> & Pick<UpgradePromptProps, 'onClose'>) {
  const theme = useTheme();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: { width: 380, maxWidth: '100%', borderRadius: '14px', border: `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' },
      }}
    >
      <DialogContent sx={{ p: '26px', position: 'relative' }}>
        <IconButton
          onClick={onClose}
          size="small"
          aria-label="close"
          sx={{ position: 'absolute', top: 18, right: 18, width: 28, height: 28, borderRadius: '7px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
        >
          <X size={16} strokeWidth={1.8} />
        </IconButton>

        <LockTile size={42} />

        <Typography sx={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1.2,
          color: 'text.primary', mt: 1.75, mb: 0.875,
        }}>
          Restricted to your role
        </Typography>

        <Typography sx={{ fontSize: 13.5, fontWeight: 300, lineHeight: 1.55, color: 'text.secondary' }}>
          You don't have permission to access this. Ask an owner or admin on your team for access.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export const UpgradePrompt: React.FC<UpgradePromptProps> = ({
  requiredTier,
  decision,
  mode,
  featureName,
  featureBlurb,
  benefits,
  children,
  open = false,
  onClose,
}) => {
  const resolvedMode = mode === 'overlay' ? 'teased' : mode;
  const denial = resolveDenial({ decision, requiredTier });

  if (denial.kind === 'ROLE') {
    if (resolvedMode === 'modal') {
      return <RoleForbiddenModal open={open} onClose={onClose} />;
    }
    // teased/locked: inline denial, no billing CTA — a role denial is never buyable.
    return <RoleForbiddenLocked />;
  }

  if (denial.kind === 'MODULE') {
    if (resolvedMode === 'modal') {
      return <ModuleDenialModal featureName={featureName} open={open} onClose={onClose} />;
    }
    // teased/locked without a tier step — inline denial, no fabricated tier.
    return <ModuleDenialLocked featureName={featureName} featureBlurb={featureBlurb} />;
  }

  const tierLabel = denial.tierLabel!;

  if (resolvedMode === 'modal') {
    return (
      <UpgradeModal
        tierLabel={tierLabel}
        requiredTierValue={denial.requiredTierValue}
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
        tierLabel={tierLabel}
        requiredTierValue={denial.requiredTierValue}
        featureName={featureName}
        featureBlurb={featureBlurb}
      />
    );
  }

  return (
    <TeasedOverlay
      tierLabel={tierLabel}
      requiredTierValue={denial.requiredTierValue}
      featureName={featureName}
      featureBlurb={featureBlurb}
    >
      {children}
    </TeasedOverlay>
  );
};

export default UpgradePrompt;
