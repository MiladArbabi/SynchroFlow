// apps/frontend/src/components/LiveMapTeaser.tsx
//
// LiveMapTeaser
// -------------
// INV-UX-01 Slice 2B — full-size teaser for the live warehouse map slot.
//
// PURELY PRESENTATIONAL. This component must never import commercial policy
// or a real warehouse data hook: the caller owns the AccessDecision and passes
// the outcome in. That keeps the decision in one place (the page) and keeps
// this component reusable by any surface that leases a map slot.
//
// It also never receives real floor geometry or occupancy. A denied tenant
// must not ACQUIRE that data at all, so the preview below is synthetic
// geometry defined locally and drawn blurred behind the upgrade card.

import { Box, Typography } from '@mui/material';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone } from '@lasyncro/shared/ui';

function teaserZone(
  locationCode: string,
  type: WarehouseZone['type'],
  parentLocationCode: string | null,
  x: number,
  y: number,
  width: number,
  depth: number,
  rackLevels: number | null,
  zoneType: string
): WarehouseZone {
  return {
    location_code: locationCode,
    type,
    parent_location_code: parentLocationCode,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: x,
    position_y: y,
    width,
    depth,
    orientation: 0,
    rack_levels: rackLevels,
    zone_type: zoneType,
    last_printed_at: null,
    warehouse_name: type === 'warehouse' ? 'Preview warehouse' : null,
  };
}

/**
 * Synthetic geometry only — never a real tenant floor. Shaped to read as a
 * plausible warehouse at a glance while blurred.
 */
const TEASER_ZONES: WarehouseZone[] = [
  teaserZone('PREVIEW', 'warehouse', null, 0, 0, 7, 6, null, 'storage'),

  teaserZone('A', 'lane', 'PREVIEW', 0.7, 0.6, 3.3, 0.8, null, 'pick'),
  teaserZone('A-1', 'bin', 'A', 0.8, 1.1, 0.9, 0.5, 3, 'pick'),
  teaserZone('A-2', 'bin', 'A', 1.85, 1.1, 0.9, 0.5, 3, 'pick'),
  teaserZone('A-3', 'bin', 'A', 2.9, 1.1, 0.9, 0.5, 3, 'pick'),

  teaserZone('B', 'lane', 'PREVIEW', 0.7, 3, 3.3, 0.8, null, 'pick'),
  teaserZone('B-1', 'bin', 'B', 0.8, 3.5, 0.9, 0.5, 3, 'pick'),
  teaserZone('B-2', 'bin', 'B', 1.85, 3.5, 0.9, 0.5, 3, 'pick'),
  teaserZone('B-3', 'bin', 'B', 2.9, 3.5, 0.9, 0.5, 3, 'pick'),

  teaserZone('PACK', 'bin', 'PREVIEW', 5, 1.1, 1.3, 1.1, 1, 'pack'),
  teaserZone('RECEIVE', 'bin', 'PREVIEW', 5, 3.4, 1.3, 1.1, 1, 'receive'),
];

/** Synthetic occupancy only — no real stock is represented here. */
const TEASER_OCCUPANCY = {
  'A-1': { on_hand_quantity: 5 },
  'A-2': { on_hand_quantity: 18 },
  'A-3': { on_hand_quantity: 27 },
  'B-1': { on_hand_quantity: 8 },
  'B-2': { on_hand_quantity: 20 },
  'B-3': { on_hand_quantity: 29 },
};

export interface LiveMapTeaserProps {
  /**
   * The canonical AccessDecision's own requiredTier. Never inferred or
   * hardcoded here — when the denial carries no tier step the copy falls back
   * to neutral wording rather than inventing one.
   */
  requiredTier?: string | null;
  onUpgrade: () => void;
  /** Slot title. Defaults to the Inventory surface's own wording. */
  title?: string;
  description?: string;
}

export function LiveMapTeaser({
  requiredTier,
  onUpgrade,
  title = 'Inventory live map',
  description =
    'See exactly where every unit sits on your floor — occupancy by bin, ' +
    'dead zones, and the aisles your stock is actually moving through.',
}: LiveMapTeaserProps) {
  const tierLabel = requiredTier
    ? requiredTier[0].toUpperCase() + requiredTier.slice(1)
    : null;

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: 520,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
        border: '0.5px solid var(--rule)',
        bgcolor: 'var(--surface)',
      }}
    >
      {/* Decorative synthetic floor. Inert: no pointer interaction, hidden
          from assistive tech, and labels suppressed so blurred placeholder
          text is never mistaken for real location codes. */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          userSelect: 'none',
          filter: 'blur(6px)',
          opacity: 0.5,
          bgcolor: 'var(--bg-2)',
          '& svg text': { display: 'none' },
        }}
      >
        <IsometricCanvas
          zones={TEASER_ZONES}
          occupancy={TEASER_OCCUPANCY}
          showLegend={false}
          showControls={false}
          disablePan
          autoFit
          fitPhysicalFloorFirst
          fitPadding={0.88}
        />
      </Box>

      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <Box
          sx={{
            maxWidth: 380,
            textAlign: 'center',
            px: 3,
            py: 2.75,
            borderRadius: '12px',
            border: '0.5px solid var(--rule)',
            bgcolor: 'var(--surface)',
          }}
        >
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              mb: 0.75,
            }}
          >
            {tierLabel ? `Available on ${tierLabel}` : 'Available on a higher plan'}
          </Typography>

          <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', mb: 0.75 }}>
            {title}
          </Typography>

          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', mb: 2 }}>
            {description}
          </Typography>

          {/* Tier-1 action. Ink token, never a hardcoded white. */}
          <Box
            component="button"
            type="button"
            onClick={onUpgrade}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              px: '14px',
              py: '7px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              color: 'var(--accent-ink)',
              bgcolor: 'var(--accent)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              '&:hover': { opacity: 0.88 },
            }}
          >
            {tierLabel ? `Upgrade to ${tierLabel}` : 'Upgrade plan'}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default LiveMapTeaser;
