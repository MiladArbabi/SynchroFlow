// apps/frontend/src/pages/authentication/AuthPageChrome.tsx
//
// AUTH-013 + AUTH-014: Shared auth page chrome
// - "All systems green" status pill (top-right nav)
// - Scrolling social-proof ticker (bottom)
//
// STATS: match target design A1-A5 exactly.
// Future: replace TICKER_STATS with live API data when /api/v1/system/stats is available.

import React from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { keyframes } from '@mui/system';

const TICKER_STATS = [
  { value: '2.1M', label: 'TRACKED ACROSS WAITLIST STORES' },
  { value: '91.2 hrs', label: 'SPREADSHEET WORK REMOVED / MONTH' },
  { value: '4.2 days', label: 'AVERAGE STOCK-OUT LEAD TIME' },
  { value: '99.4%', label: 'PICK ACCURACY IN CONNECTED WAREHOUSES' },
  { value: '73%', label: 'FEWER ANGRY-CUSTOMER EMAILS' },
  { value: '2.5 hr', label: 'SAVED PER OPERATOR PER DAY' },
];

// Duplicate for seamless loop
const TICKER_ITEMS = [...TICKER_STATS, ...TICKER_STATS];

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
        border: '1px solid rgba(74,222,128,0.3)',
        bgcolor: 'rgba(74,222,128,0.08)',
      }}
    >
      {/* Pulsing green dot */}
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: '#4ADE80',
          boxShadow: '0 0 0 0 rgba(74,222,128,0.4)',
          animation: 'pulse 2s ease-in-out infinite',
          '@keyframes pulse': {
            '0%':   { boxShadow: '0 0 0 0 rgba(74,222,128,0.4)' },
            '70%':  { boxShadow: '0 0 0 5px rgba(74,222,128,0)' },
            '100%': { boxShadow: '0 0 0 0 rgba(74,222,128,0)' },
          },
        }}
      />
      <Typography
        sx={{
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: '#4ADE80',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}
      >
        All systems green
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