import { Box, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import type { BinOccupancy, LiveBinState, GridMode, GridVariant } from './WarehouseGrid.types.js';

/**
 * BinCell — single bin in the warehouse grid.
 *
 * States (priority order):
 *   live     — pick/stow in progress (pulsing indicator)
 *   selected — solid accent border, triggers right panel in 'full' variant
 *   focused  — bright; used in 'focus' mode (product/PO detail)
 *   dimmed   — non-focused bins in 'focus' mode
 *   occupied — has stock (green alpha fill)
 *   empty    — no stock (var(--bg-3) fill)
 *
 * Colour tokens: CSS variables only — no hardcoded hex.
 */

interface BinCellProps {
  locationCode: string;
  occupancy?: BinOccupancy;
  isHighlighted?: boolean;  // pick path / accent border
  isSelected?: boolean;
  isFocused?: boolean;      // focus mode — this bin is relevant
  isDimmed?: boolean;       // focus mode — this bin is not relevant
  liveState?: LiveBinState;
  mode?: GridMode;
  variant?: GridVariant;
  onClick?: (locationCode: string) => void;
}

const CELL_SIZE: Record<GridVariant, number> = {
  full:   64,
  mini:   44,
  inline: 32,
};

const FONT_SIZE: Record<GridVariant, number> = {
  full:   10,
  mini:   8,
  inline: 7,
};

const LIVE_COLOUR: Record<string, string> = {
  picking:  'var(--accent)',
  stowing:  'var(--accent-hover)',
  reserved: 'var(--accent-border)',
};

export function BinCell({
  locationCode,
  occupancy,
  isHighlighted,
  isSelected,
  isFocused,
  isDimmed,
  liveState,
  mode = 'map',
  variant = 'full',
  onClick,
}: BinCellProps) {
  const size = CELL_SIZE[variant];
  const fontSize = FONT_SIZE[variant];
  const hasStock = (occupancy?.on_hand_quantity ?? 0) > 0;
  const theme = useTheme();

  // ── Background fill ──────────────────────────────────────────
  let bg = 'var(--bg-3)';
  if (hasStock && mode === 'heatmap') {
    const qty = occupancy!.on_hand_quantity;
    bg = qty > 10
      ? alpha(theme.palette.success.main, 0.15)
      : qty > 3
      ? alpha(theme.palette.warning.main, 0.15)
      : alpha(theme.palette.error.main, 0.15);
  } else if (hasStock) {
    bg = alpha(theme.palette.success.main, 0.10);
  }
  if (isDimmed) bg = 'var(--bg-2)';

  // ── Border ───────────────────────────────────────────────────
  let border = '1px solid var(--rule)';
  if (isSelected)    border = '2px solid var(--accent)';
  if (isHighlighted) border = '2px solid var(--accent)';
  if (isFocused)     border = '2px solid var(--accent)';
  if (liveState)     border = `2px solid ${LIVE_COLOUR[liveState.status] ?? 'var(--accent)'}`;

  // ── Tooltip content ──────────────────────────────────────────
  const tooltipLines = occupancy?.variants.map(
    (v) => `${v.sku ?? v.lasyncro_variant_id.slice(0, 8)} · ${v.on_hand_quantity} units`
  ) ?? [];
  if (liveState?.operator) tooltipLines.unshift(`🔄 ${liveState.operator} — ${liveState.status}`);
  const tooltipText = tooltipLines.length ? tooltipLines.join('\n') : 'Empty bin';

  return (
    <Tooltip
      title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipText}</span>}
      placement="top"
      arrow
      disableHoverListener={variant === 'inline'}
    >
      <Box
        onClick={() => onClick?.(locationCode)}
        sx={{
          width: size,
          height: size,
          minWidth: size,
          background: bg,
          border,
          borderRadius: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: onClick ? 'pointer' : 'default',
          opacity: isDimmed ? 0.35 : 1,
          transition: 'border 0.15s, opacity 0.15s, background 0.15s',
          position: 'relative',
          '&:hover': onClick ? { borderColor: 'var(--accent)', opacity: 1 } : {},
        }}
      >
        <Typography
          sx={{
            fontSize,
            fontFamily: 'monospace',
            lineHeight: 1.2,
            textAlign: 'center',
            color: isDimmed ? 'text.disabled' : 'text.primary',
            userSelect: 'none',
            px: 0.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: size - 4,
          }}
        >
          {locationCode}
        </Typography>

        {/* Live activity dot */}
        {liveState && (
          <Box sx={{
            position: 'absolute',
            top: 3, right: 3,
            width: 6, height: 6,
            borderRadius: '50%',
            background: LIVE_COLOUR[liveState.status] ?? 'var(--accent)',
            animation: 'pulse 1.5s infinite',
            '@keyframes pulse': {
              '0%,100%': { opacity: 1 },
              '50%': { opacity: 0.3 },
            },
          }} />
        )}

        {/* Stock dot (map/focus mode) */}
        {hasStock && !liveState && mode !== 'heatmap' && variant !== 'inline' && (
          <Box sx={{
            position: 'absolute',
            bottom: 3, right: 3,
            width: 5, height: 5,
            borderRadius: '50%',
            background: alpha(theme.palette.success.main, 0.75),
          }} />
        )}
      </Box>
    </Tooltip>
  );
}