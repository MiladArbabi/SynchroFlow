// apps/frontend/src/components/OpsConsole/OpsConsoleGlyph.tsx
//
// GH-1158 — the Ops Console trigger glyph. Closed it is the prompt ">_";
// open, the two chevron arms slide to the centre and stretch into a close "×"
// while the cursor collapses. Same duration and curve as the theme toggle.
// Purely presentational: open state and attention stay owned by
// OpsConsoleButton.

import { Box } from '@mui/material';
import { REDUCED_MOTION_QUERY, shellTransition } from '../ThemeToggle/shellMotion';

export function OpsConsoleGlyph({ open, size = 18 }: { open: boolean; size?: number }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-state={open ? 'open' : 'closed'}
      sx={{
        width: size, height: size, display: 'block', overflow: 'visible',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round',
        '& line': {
          transformBox: 'view-box',
          transformOrigin: '0 0',
          transition: `${shellTransition('transform')}, opacity 200ms ease`,
        },
        '& .ops-glyph-a': { transform: 'translate(8px, 9px) rotate(45deg)' },
        '& .ops-glyph-b': { transform: 'translate(8px, 15px) rotate(-45deg)' },
        '& .ops-glyph-c': { transform: 'translate(16px, 18px)' },
        '&[data-state="open"] .ops-glyph-a': { transform: 'translate(12px, 12px) rotate(45deg) scaleX(1.55)' },
        '&[data-state="open"] .ops-glyph-b': { transform: 'translate(12px, 12px) rotate(-45deg) scaleX(1.55)' },
        '&[data-state="open"] .ops-glyph-c': { transform: 'translate(12px, 18px) scaleX(0)', opacity: 0 },
        [`@media ${REDUCED_MOTION_QUERY}`]: {
          '& line': { transition: 'none' },
        },
      }}
    >
      <line className="ops-glyph-a" x1="-4.24" y1="0" x2="4.24" y2="0" />
      <line className="ops-glyph-b" x1="-4.24" y1="0" x2="4.24" y2="0" />
      <line className="ops-glyph-c" x1="-3" y1="0" x2="3" y2="0" />
    </Box>
  );
}
