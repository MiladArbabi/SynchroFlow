// modules/shared/src/ui/OperationalContextShell.tsx
//
// OperationalContextShell
// -----------------------
// Composition only: a primary workspace track plus a secondary rail track,
// using Overview's certified body grammar (3fr / minmax(260px, 1fr) from lg,
// a single column below lg).
//
// - The caller decides rail suppression (e.g. the app shell's Ops Console
//   state) and passes it in; this component reads no app or domain state.
// - suppressRail withdraws only the rail CONTENT. Both grid tracks stay
//   mounted, so the primary keeps the first track and toggling suppression
//   never remounts the primary subtree. From lg the empty secondary track
//   stays allocated; below lg it is display:none so the stack gains no empty
//   row or extra gap. Withdrawal is immediate — no transition or motion.

import type { ReactNode } from 'react';
import { Box } from '@mui/material';

export interface OperationalContextShellProps {
  primary: ReactNode;
  rail: ReactNode;
  suppressRail?: boolean;
}

export function OperationalContextShell({
  primary,
  rail,
  suppressRail = false,
}: OperationalContextShellProps) {
  return (
    <Box
      data-operational-context-shell=""
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(260px, 1fr)' },
        gap: 2.25,
        alignItems: 'stretch',
        minWidth: 0,
      }}
    >
      <Box data-shell-track="primary" sx={{ minWidth: 0 }}>
        {primary}
      </Box>
      <Box
        data-shell-track="rail"
        data-rail-suppressed={suppressRail ? 'true' : 'false'}
        sx={{ minWidth: 0, display: suppressRail ? { xs: 'none', lg: 'block' } : 'block' }}
      >
        {!suppressRail && rail}
      </Box>
    </Box>
  );
}
