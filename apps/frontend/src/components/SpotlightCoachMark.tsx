// apps/frontend/src/components/SpotlightCoachMark.tsx
//
// T8 — Spotlight coach mark component.
// Anchors to primary action on first visit. Floats gently to draw attention.
// Dismissed permanently via useSpotlight(key).
//
// Animation: subtle translateY float, stops on hover, respects prefers-reduced-motion.
// See docs/playbooks/onboarding-progressive-disclosure-playbook.md §2 Layer 2.
//
// Usage:
//   <SpotlightCoachMark
//     spotlightKey="order_flow_wave"
//     title="Release wave to floor"
//     body="Select orders above, then release — operators pick and ship immediately."
//     step={1}
//     totalSteps={2}
//   />

import { Box, Typography } from '@mui/material';
import { X } from 'lucide-react';
import { useSpotlight } from '../hooks/useSpotlight';
import { useAppTheme } from '../hooks/useAppTheme';

interface SpotlightCoachMarkProps {
  spotlightKey: string;
  title: string;
  body: string;
  step?: number;
  totalSteps?: number;
}

export function SpotlightCoachMark({ spotlightKey, title, body, step, totalSteps }: SpotlightCoachMarkProps) {
  const pal = useAppTheme();
  const { isDismissed, isLoading, dismiss } = useSpotlight(spotlightKey);

  if (isLoading || isDismissed) return null;

  return (
    <Box
      sx={{
        // Inline rendering — sits in document flow above its coached action.
        // No position:absolute; parent layout determines placement.
        width: '100%',
        bgcolor: 'var(--accent-ghost)',
        border: `1px solid var(--accent-border)`,
        borderRadius: '8px',
        p: '10px 12px',
        mb: 1,
        // Float animation — draws eye without aggression.
        // Stops on hover so user can read without distraction.
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
      {/* Progress + dismiss row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
        {step && totalSteps ? (
          <Typography sx={{ fontSize: 10, fontWeight: 500, color: pal.ink4 }}>
            ● {step} of {totalSteps}
          </Typography>
        ) : <Box />}
        <Box
          onClick={() => dismiss()}
          sx={{ cursor: 'pointer', color: pal.ink4, display: 'flex', alignItems: 'center', '&:hover': { color: pal.ink } }}
        >
          <X size={12} />
        </Box>
      </Box>

      {/* Title */}
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: pal.ink, lineHeight: 1.35, mb: '4px' }}>
        {title}
      </Typography>

      {/* Body */}
      <Typography sx={{ fontSize: 12, fontWeight: 300, color: pal.ink3, lineHeight: 1.5, mb: '10px' }}>
        {body}
      </Typography>

      {/* Got it CTA — Tier 2 ghost pill per modules-ux-playbook §2 */}
      <Box
        onClick={() => dismiss()}
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