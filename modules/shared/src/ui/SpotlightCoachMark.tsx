// modules/shared/src/ui/SpotlightCoachMark.tsx
//
// Portable spotlight coach mark — usable in any FT2 module.
// Renders inline above the action it coaches. Floats gently on mount.
// Dismissed permanently per-user via the dismiss() callback (useSpotlight in app layer).
//
// Design: onboarding-progressive-disclosure-playbook.md §2 Layer 2.
//
// Usage:
//   <SpotlightCoachMark
//     title="These products have no supplier yet"
//     body="Assign a supplier to each one — so when stock runs low, you already know who to order from."
//     isDismissed={spotlights.neverOrdered.isDismissed}
//     onDismiss={spotlights.neverOrdered.dismiss}
//     step={1}
//     totalSteps={3}
//   />

import { Box, Typography } from '@mui/material';
import { X } from 'lucide-react';

interface SpotlightCoachMarkProps {
  title: string;
  body: string;
  /** Controlled externally — resolved via useSpotlight() at page/app level */
  isDismissed: boolean;
  onDismiss: () => void;
  step?: number;
  totalSteps?: number;
  /** Optional pointer — renders a small triangle on the given edge, aimed at the coached element. */
  direction?: 'up' | 'down' | 'left' | 'right';
  /**
   * Rendered outside a content column (e.g. beside a rail, over a dimmed
   * canvas): opaque surface under the accent tint, no trailing margin.
   */
  floating?: boolean;
  /**
   * Optional primary action rendered in place of "Got it". Both must be set;
   * the X control stays dismiss-only.
   */
  actionLabel?: string;
  onAction?: () => void;
}

// Controls are real buttons (keyboard reachable); these reset UA button chrome
// so they keep the original compact look.
const BUTTON_RESET_SX = {
  bgcolor: 'transparent',
  font: 'inherit',
  outline: 'none',
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
} as const;

const ARROW_SX_BY_DIRECTION = {
  left:  { left: -7, top: '50%', transform: 'translateY(-50%)', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderRight: '7px solid var(--accent-border)' },
  right: { right: -7, top: '50%', transform: 'translateY(-50%)', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderLeft: '7px solid var(--accent-border)' },
  up:    { top: -7, left: '50%', transform: 'translateX(-50%)', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: '7px solid var(--accent-border)' },
  down:  { bottom: -7, left: '50%', transform: 'translateX(-50%)', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: '7px solid var(--accent-border)' },
} as const;

export function SpotlightCoachMark({
  title,
  body,
  isDismissed,
  onDismiss,
  step,
  totalSteps,
  direction,
  floating = false,
  actionLabel,
  onAction,
}: SpotlightCoachMarkProps) {
  if (isDismissed) return null;
  const hasAction = actionLabel != null && onAction != null;

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        bgcolor: 'var(--accent-ghost)',
        ...(floating && {
          background: 'linear-gradient(var(--accent-ghost), var(--accent-ghost)), var(--surface)',
        }),
        border: '1px solid var(--accent-border)',
        borderRadius: '8px',
        p: '10px 12px',
        mb: floating ? 0 : 1,
        // Float animation — draws eye without aggression.
        // Stops on hover so user can read without distraction.
        // Respects prefers-reduced-motion.
        '@keyframes spotlight-float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':       { transform: 'translateY(-5px)' },
        },
        '@media (prefers-reduced-motion: no-preference)': {
          animation: 'spotlight-float 2s ease-in-out infinite',
          '&:hover': { animation: 'none' },
        },
      }}
    >
      {direction && <Box sx={{ position: 'absolute', width: 0, height: 0, ...ARROW_SX_BY_DIRECTION[direction] }} />}
      {/* Progress + dismiss row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
        {step && totalSteps ? (
          <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }}>
            ● {step} of {totalSteps}
          </Typography>
        ) : <Box />}
        <Box
          component="button"
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          sx={{ ...BUTTON_RESET_SX, border: 'none', p: 0, cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', '&:hover': { color: 'var(--ink)' } }}
        >
          <X size={12} />
        </Box>
      </Box>

      {/* Title */}
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, mb: '4px' }}>
        {title}
      </Typography>

      {/* Body — wraps explicitly: hosts such as the top-nav cluster set
          whiteSpace:nowrap, which a floating coach would otherwise inherit. */}
      <Typography
        sx={{
          fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.5, mb: '10px',
          whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'normal', maxWidth: '100%',
        }}
      >
        {body}
      </Typography>

      {/* Got it (or the optional action) — Tier 2 ghost pill per modules-ux-playbook §2 */}
      <Box
        component="button"
        type="button"
        onClick={hasAction ? onAction : onDismiss}
        sx={{
          ...BUTTON_RESET_SX,
          display: 'inline-flex', alignItems: 'center',
          px: 1.25, py: 0.375,
          fontSize: 11, fontWeight: 500,
          color: 'var(--accent)',
          border: '0.5px solid var(--accent-border)',
          borderRadius: '6px',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--accent-ghost)' },
        }}
      >
        {hasAction ? actionLabel : 'Got it'}
      </Box>
    </Box>
  );
}