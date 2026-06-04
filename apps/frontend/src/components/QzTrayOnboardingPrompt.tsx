// apps/frontend/src/components/QzTrayOnboardingPrompt.tsx
//
// WM-47 — QZ Tray onboarding prompt
// -----------------------------------
// Shown once per device on the first label print trigger when QZ Tray
// is not detected. Dismissed to localStorage — never shown again on
// this device once dismissed.
//
// Never blocks the print flow — the print action always proceeds
// regardless of what the operator does with this prompt.

import { Box, Typography } from '@mui/material';
import { Printer, X } from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';

export type { };

interface Props {
  onDismiss: () => void;
}

export function QzTrayOnboardingPrompt({ onDismiss }: Props) {
  const pal = useAppTheme();

  return (
    <Box sx={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 1400,
      maxWidth: 340,
      bgcolor: pal.surface,
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '10px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      p: 2,
    }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Printer size={15} color="var(--accent)" />
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            Want labels to print automatically?
          </Typography>
        </Box>
        <Box
          onClick={onDismiss}
          sx={{ cursor: 'pointer', color: 'var(--ink-4)', ml: 1, flexShrink: 0, '&:hover': { color: 'var(--ink)' } }}
        >
          <X size={14} />
        </Box>
      </Box>

      <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mb: 1.5, lineHeight: 1.5 }}>
        Install QZ Tray on this computer — a free background app that routes labels
        directly to your thermal printer without any manual steps.
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
        <Box
          component="a"
          href="https://qz.io/download"
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: 'inline-flex', alignItems: 'center',
            px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600,
            bgcolor: 'var(--accent)', color: '#fff',
            borderRadius: '6px', cursor: 'pointer', textDecoration: 'none',
            '&:hover': { opacity: 0.88 },
          }}
        >
          Download QZ Tray →
        </Box>
        <Box
          onClick={onDismiss}
          sx={{
            display: 'inline-flex', alignItems: 'center',
            px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500,
            color: 'var(--ink-3)', border: `0.5px solid ${pal.rule}`,
            borderRadius: '6px', cursor: 'pointer',
            '&:hover': { opacity: 0.75 },
          }}
        >
          Not now — use browser
        </Box>
      </Box>
    </Box>
  );
}