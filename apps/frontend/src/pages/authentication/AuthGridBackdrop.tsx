// apps/frontend/src/pages/authentication/AuthGridBackdrop.tsx
//
// AUTH-V2 C3': reusable animated grid backdrop for auth pages (Login,
// Register, ConnectStore). Spec source: LaSyncro Auth.dc.html bundle,
// showGridBackdrop state — see auth_blueprint "Target Design — Auth v2".
//
// - 44px grid lines (rgba(255,255,255,0.045)) masked to a soft ellipse
// - 8 deterministic faded orange cells hugging the edges, flaring clockwise
//   (lsCell: 9s cycle, 1.125s stagger) — deliberately NOT random, so the
//   motion reads as one slow circuit rather than noise
// - faint orange radial glow
// - pointer-events: none, position: absolute — parent must be positioned
// - honors prefers-reduced-motion (cells render static at base opacity)
import React from 'react';
import Box from '@mui/material/Box';
import { keyframes } from '@mui/system';

// C3' tuning (2026-07-19): calmer pulse — 16s cycle, peak 0.55 (was 9s / 1.0),
// slow symmetric rise/fall so cells breathe rather than flash.
const lsCell = keyframes`
  0%, 100% { opacity: 0.25; }
  9%       { opacity: 0.55; }
  18%      { opacity: 0.25; }
`;

// [gridCol, gridRow, fillOpacity] — fixed edge-hugging positions; pulse
// timing is randomized per mount (C3' 2026-07-19), not sequential.
const CELLS: Array<[number, number, number]> = [
  [4, 2, 0.12], [14, 1, 0.14], [25, 3, 0.12], [28, 8, 0.13],
  [24, 14, 0.12], [13, 16, 0.13], [3, 13, 0.12], [1, 7, 0.13],
];

export function AuthGridBackdrop() {

// Random pulse timing, generated once per mount: delay anywhere in the
// cycle, duration jittered 14–20s so cells drift out of phase over time.
  const timings = React.useMemo(
    () =>
      CELLS.map(() => ({
        delay: Math.random() * 16,
        duration: 14 + Math.random() * 6,
      })),
    []
  );

  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {/* grid lines, ellipse-masked */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          // C3' fix: INVERTED mask vs design source — transparent center, visible edges.
          // The form sits at ~50%/45%; grid must not run under inputs. Cells already hug edges.
          WebkitMaskImage: 'radial-gradient(ellipse 62% 55% at 50% 45%, transparent 42%, black 82%)',
          maskImage: 'radial-gradient(ellipse 62% 55% at 50% 45%, transparent 42%, black 82%)',
        }}
      />
      
      {/* flaring cells */}
      {CELLS.map(([cx, cy, o], i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            left: cx * 44,
            top: cy * 44,
            width: 44,
            height: 44,
            bgcolor: `rgba(255,107,43,${o})`,
            opacity: 0.25,
            animation: `${lsCell} ${timings[i].duration}s ease-in-out infinite`,
            animationDelay: `${timings[i].delay}s`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      ))}
      {/* faint glow */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          // C3' fix: glow moved up/off the form area, slightly fainter
          background: 'radial-gradient(ellipse 55% 30% at 50% 8%, rgba(255,107,43,0.04), transparent 70%)',
        }}
      />
    </Box>
  );
}