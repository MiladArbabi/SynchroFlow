import { Box, Typography } from '@mui/material';

/**
 * Work tally — everything waiting on the floor, at a glance.
 *
 * WHY: the Warehouse page said "Pick and pack active batches", but four other
 * kinds of work queue up here — putting away, receiving, counting. An operator
 * landing on this page could not see what was waiting without scrolling
 * through sections that render empty most of the time.
 *
 * The five rows are FIXED and never reorder. Position becomes memory: an
 * operator learns where Counting sits and stops reading labels. Rows at zero
 * stay visible and go quiet rather than disappearing — a row that vanishes
 * teaches nothing, and discoverability is the whole point for work types a
 * merchant may not know exist yet.
 *
 * Counts are TASKS, not units. This answers "how many things need an
 * operator", not "how much volume is on the floor".
 *
 * VOCABULARY: merchant-facing words only. "Putting away", not stow.
 * "Counting", not recount or stocktake. No variance, no reconciliation.
 */

export interface WorkTallyCounts {
  picking: number;
  packing: number;
  puttingAway: number;
  receiving: number;
  counting: number;
}

export interface WorkTallyProps {
  counts: WorkTallyCounts;
  /**
   * Counting is Core-tier: a Starter tenant gets 403 from the recount routes
   * rather than an empty list. Locked renders the row as unavailable instead
   * of as zero — a zero would be a lie about work that may exist.
  */
  countingLocked?: boolean;
  onSelect?: (key: keyof WorkTallyCounts) => void;
}

const ROWS: { key: keyof WorkTallyCounts; label: string }[] = [
  { key: 'picking', label: 'Picking' },
  { key: 'packing', label: 'Packing' },
  { key: 'puttingAway', label: 'Putting away' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'counting', label: 'Counting' },
];

export function WorkTally({ counts, countingLocked, onSelect }: WorkTallyProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        bgcolor: 'var(--surface)',
        border: '1px solid var(--rule)',
        borderRadius: '14px',
        overflow: 'hidden',
        mb: 2.75,
      }}
    >
      {ROWS.map((row, i) => {
        const locked = row.key === 'counting' && countingLocked;
        const value = counts[row.key];
        const active = !locked && value > 0;

        return (
          <Box
            key={row.key}
            component={onSelect && active ? 'button' : 'div'}
            onClick={active && onSelect ? () => onSelect(row.key) : undefined}
            sx={{
              flex: 1,
              px: 2,
              py: 1.75,
              border: 'none',
              borderLeft: i === 0 ? 'none' : '1px solid var(--rule)',
              bgcolor: 'transparent',
              textAlign: 'left',
              font: 'inherit',
              cursor: active && onSelect ? 'pointer' : 'default',
              transition: 'background-color 120ms ease',
              // No --surface-2 token exists in this design system; the raw
              // rgba is deliberate rather than a fallback for a missing var.
              '&:hover': active && onSelect
                ? { bgcolor: 'rgba(255,255,255,0.03)' }
                : undefined,
            }}
          >
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: active ? 'var(--ink-3)' : 'var(--ink-4)',
                mb: 0.5,
                whiteSpace: 'nowrap',
              }}
            >
              {row.label}
            </Typography>
            <Typography
              sx={{
                fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                fontSize: 20,
                fontWeight: 500,
                lineHeight: 1,
                color: active ? 'var(--ink)' : 'var(--ink-4)',
                opacity: active ? 1 : 0.45,
              }}
            >
              {locked ? '—' : value}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** True when nothing anywhere is waiting — drives the "All clear" subtitle. */
export function isAllClear(counts: WorkTallyCounts): boolean {
  return (
    counts.picking === 0 &&
    counts.packing === 0 &&
    counts.puttingAway === 0 &&
    counts.receiving === 0 &&
    counts.counting === 0
  );
}
