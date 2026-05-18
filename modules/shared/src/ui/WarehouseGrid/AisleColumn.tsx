import { Box, Typography } from '@mui/material';
import { BinCell } from './BinCell.js';
import type {
  WarehouseLocation,
  BinOccupancy,
  LiveBinState,
  GridMode,
  GridVariant,
} from './WarehouseGrid.types.js';

/**
 * AisleColumn — one vertical column in the warehouse grid.
 *
 * Derives aisle label from the first bin's location_code prefix
 * (e.g. "A" from "A-1", "A-2"). Bins are ordered by location_code ASC
 * which matches the existing pick-route sort in wms.controller.ts.
 *
 * Each cell = one bin at an aisle/shelf intersection.
 */

interface AisleColumnProps {
  aisleLabel: string;
  bins: WarehouseLocation[];
  occupancy?: Record<string, BinOccupancy>;
  highlightedBins?: Set<string>;
  focusedBins?: Set<string>;
  selectedBin?: string;
  liveActivity?: Record<string, LiveBinState>;
  mode?: GridMode;
  variant?: GridVariant;
  onBinSelect?: (locationCode: string) => void;
}

const LABEL_SIZE: Record<GridVariant, number> = {
  full:   11,
  mini:   9,
  inline: 8,
};

export function AisleColumn({
  aisleLabel,
  bins,
  occupancy,
  highlightedBins,
  focusedBins,
  selectedBin,
  liveActivity,
  mode = 'map',
  variant = 'full',
  onBinSelect,
}: AisleColumnProps) {
  const hasFocusSet = focusedBins && focusedBins.size > 0;
  const gap = variant === 'full' ? 6 : 4;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${gap}px` }}>
      {/* Aisle header label */}
      <Typography
        sx={{
          fontFamily: 'monospace',
          color: 'var(--ink-4)',
          fontSize: 10,
          fontWeight: 500,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
          mb: 0.5,
          userSelect: 'none',
        }}
      >
        {aisleLabel}
      </Typography>

      {/* Bin cells — ordered by location_code ASC (matches pick route sort) */}
      {[...bins].sort((a, b) => a.location_code.localeCompare(b.location_code)).map((bin) => (
        <BinCell
          key={bin.location_code}
          locationCode={bin.location_code}
          occupancy={occupancy?.[bin.location_code]}
          isHighlighted={highlightedBins?.has(bin.location_code)}
          isSelected={selectedBin === bin.location_code}
          isFocused={hasFocusSet ? focusedBins.has(bin.location_code) : undefined}
          isDimmed={hasFocusSet ? !focusedBins.has(bin.location_code) : undefined}
          liveState={liveActivity?.[bin.location_code]}
          mode={mode}
          variant={variant}
          onClick={onBinSelect}
        />
      ))}
    </Box>
  );
}