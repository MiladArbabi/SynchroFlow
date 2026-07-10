// apps/frontend/src/pages/authentication/AuthPageChrome.tsx
//
// AUTH-013 + AUTH-014 + AUTH-015: Shared auth page chrome
// - Static auth trust pill (top-right nav)
// - Scrolling auth ticker (bottom)
//
// Trust rule: auth chrome must not show unverified numeric or system-health claims.
// Replace ticker messages or status copy only after a real auth-safe endpoint exists.

import React from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { keyframes } from '@mui/system';

const AUTH_TICKER_MESSAGES = [
  { value: 'Receive', label: 'SCAN STOCK IN WHEN IT ARRIVES' },
  { value: 'Pick', label: 'VERIFY ITEMS BEFORE THEY LEAVE THE SHELF' },
  { value: 'Pack', label: 'CATCH ORDER MISMATCHES BEFORE SHIPPING' },
  { value: 'Sync', label: 'KEEP SHOPIFY INVENTORY CONNECTED TO FLOOR EVENTS' },
  { value: 'Trace', label: 'SEE WHAT CHANGED, WHERE, AND WHY' },
  { value: 'Operate', label: 'BUILT FOR SMALL COMMERCE TEAMS' },
];

// Duplicate for seamless loop
const TICKER_ITEMS = [...AUTH_TICKER_MESSAGES, ...AUTH_TICKER_MESSAGES];

const scroll = keyframes`
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
`;

export function SystemStatusPill() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.625,
        borderRadius: 99,
        border: '1px solid var(--rule)',
        bgcolor: 'var(--surface)',
      }}
    >
      {/* Neutral auth trust marker; not a live system-health indicator. */}
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: 'var(--accent)',
        }}
      />
      <Typography
        sx={{
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: 'var(--ink-2)',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}
      >
        Secure access
      </Typography>
    </Box>
  );
}

export function SocialProofTicker() {
  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        overflow: 'hidden',
        borderTop: '1px solid var(--rule)',
        bgcolor: 'var(--bg)',
        zIndex: 10,
        py: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          width: 'max-content',
          animation: `${scroll} 50s linear infinite`,
          '&:hover': { animationPlayState: 'paused' },
        }}
      >
        {TICKER_ITEMS.map((stat, i) => (
          <Stack
            key={i}
            direction="row"
            alignItems="center"
            sx={{ px: 4, borderRight: '1px solid var(--rule)', flexShrink: 0 }}
          >
            <Typography
              sx={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--accent)',
                mr: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {stat.value}
            </Typography>
            <Typography
              sx={{
                fontSize: '0.7rem',
                fontWeight: 500,
                color: 'var(--ink-3)',
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}
            >
              {stat.label}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}