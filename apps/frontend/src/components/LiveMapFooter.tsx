// apps/frontend/src/components/LiveMapFooter.tsx
//
// LiveMapFooter
// -------------
// CROSS-SCREEN-UX-01 — the footer bar under every LIVE warehouse map
// (Overview, Orders, Inventory). Page-owned status on the left; domain
// actions, then the one canonical spatial-edit shortcut, on the right.
//
// PURELY PRESENTATIONAL. The caller owns navigation and passes handlers in.
// Only the live map uses this footer — missing-floor, loading and error map
// states keep their own setup CTAs.

import type { ReactNode } from 'react';
import { Box } from '@mui/material';

/** The single spatial-edit destination shared by every live map. */
export const EDIT_FLOOR_MAP_ROUTE = '/floor-planning?tab=setup&view=canvas';

const FOOTER_ACTION_SX = {
  appearance: 'none', border: 'none', bgcolor: 'transparent', p: 0, fontFamily: 'inherit',
  fontSize: 12, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', flexShrink: 0,
  '&:hover': { opacity: 0.75 },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
} as const;

export interface LiveMapFooterAction {
  label: string;
  onClick: () => void;
}

export interface LiveMapFooterProps {
  /** Page-owned live status; omitted when the domain has none to show. */
  status?: ReactNode;
  /** Domain workflow actions, rendered before the spatial-edit shortcut. */
  actions?: LiveMapFooterAction[];
  onEditFloorMap: () => void;
}

export function LiveMapFooter({ status, actions = [], onEditFloorMap }: LiveMapFooterProps) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: '10px', px: '16px', py: '11px',
      borderTop: '0.5px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0,
    }}>
      {status}
      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
        {actions.map((action) => (
          <Box key={action.label} component="button" type="button" onClick={action.onClick} sx={FOOTER_ACTION_SX}>
            {action.label}
          </Box>
        ))}
        <Box component="button" type="button" onClick={onEditFloorMap} sx={FOOTER_ACTION_SX}>
          Edit floor map →
        </Box>
      </Box>
    </Box>
  );
}
