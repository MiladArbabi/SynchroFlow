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
}

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
}: SpotlightCoachMarkProps) {
  if (isDismissed) return null;

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        bgcolor: 'var(--accent-ghost)',
        border: '1px solid var(--accent-border)',
        borderRadius: '8px',
        p: '10px 12px',
        mb: 1,
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
          onClick={onDismiss}
          sx={{ cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', '&:hover': { color: 'var(--ink)' } }}
        >
          <X size={12} />
        </Box>
      </Box>

      {/* Title */}
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, mb: '4px' }}>
        {title}
      </Typography>

      {/* Body */}
      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.5, mb: '10px' }}>
        {body}
      </Typography>

      {/* Got it — Tier 2 ghost pill per modules-ux-playbook §2 */}
      <Box
        onClick={onDismiss}
        sx={{
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
        Got it
      </Box>
    </Box>
  );
}