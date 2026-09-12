import { useMemo } from 'react';
import {
  Box,
  CircularProgress,
  Typography,
} from '@mui/material';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone } from '@lasyncro/shared/ui';

import type { CatalogVariant } from '../products/useProductsCatalog';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useVariantWarehouseBins } from '../floor-planning/useVariantWarehouseBins';
import type { VariantWarehouseBin } from '../floor-planning/useVariantWarehouseBins';
import { useCommercialAccess } from '../../runtime/commercialContext';

interface VariantDetailModalBodyProps {
  variant: CatalogVariant;
}

const formatLabel = (value: string | null | undefined, fallback: string) =>
  value && value.trim() ? value : fallback;

const uniqueBins = (bins: VariantWarehouseBin[]) => {
  const byCode = new Map<string, VariantWarehouseBin>();

  for (const bin of bins) {
    const code = bin.location_code?.trim();
    if (!code) continue;

    const existing = byCode.get(code);
    byCode.set(code, {
      location_code: code,
      available_quantity:
        Number(existing?.available_quantity ?? 0) +
        Number(bin.available_quantity ?? 0),
    });
  }

  return [...byCode.values()];
};

function Fact({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Box
      sx={{
        border: '1px solid var(--rule)',
        borderRadius: '8px',
        p: 1.25,
        minWidth: 0,
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          mt: 0.5,
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--ink)',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function SpatialMessage({ children }: { children: string }) {
  return (
    <Box
      sx={{
        border: '1px solid var(--rule)',
        borderRadius: '8px',
        p: 1.5,
        bgcolor: 'var(--bg)',
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
        {children}
      </Typography>
    </Box>
  );
}

export function VariantDetailModalBody({
  variant,
}: VariantDetailModalBodyProps) {
  const { decide, isResolved } = useCommercialAccess();
  const inventoryMapDecision = decide('inventory.live_map');
  const floorPlanningDecision = decide('warehouse.floor_planning');
  const spatialAllowed =
    isResolved &&
    inventoryMapDecision.allowed &&
    floorPlanningDecision.allowed;

  const floorPlanning = useFloorPlanning(spatialAllowed);
  const binsQuery = useVariantWarehouseBins(
    variant.lasyncro_variant_id,
    spatialAllowed,
  );

  const floorZones: WarehouseZone[] = floorPlanning.data?.zones ?? [];
  const positionedZones = useMemo(
    () =>
      floorZones.filter(
        (zone) => zone.position_x != null && zone.position_y != null,
      ),
    [floorZones],
  );
  const bins = useMemo(
    () => uniqueBins(binsQuery.data?.bins ?? []),
    [binsQuery.data?.bins],
  );
  const positionedCodes = useMemo(
    () => new Set(positionedZones.map((zone) => zone.location_code)),
    [positionedZones],
  );
  const focusedBins = bins
    .map((bin) => bin.location_code)
    .filter((code) => positionedCodes.has(code));
  const unpositionedBins = bins.filter(
    (bin) => !positionedCodes.has(bin.location_code),
  );

  const hasSpatialError = floorPlanning.isError || binsQuery.isError;
  const spatialLoading =
    spatialAllowed && (floorPlanning.isLoading || binsQuery.isLoading);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: 2 }}>
        <Box
          sx={{
            width: 96,
            height: 96,
            borderRadius: '8px',
            border: '1px solid var(--rule)',
            bgcolor: 'var(--bg)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {variant.image_url ? (
            <img
              src={variant.image_url}
              alt={formatLabel(variant.product_title, 'Product')}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Typography sx={{ fontSize: 28, fontWeight: 500, color: 'var(--ink-4)' }}>
              {formatLabel(variant.product_title, 'P').charAt(0).toUpperCase()}
            </Typography>
          )}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
            {formatLabel(variant.product_title, 'Unknown product')}
          </Typography>
          <Typography sx={{ mt: 0.375, fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
            {formatLabel(variant.variant_title, 'Default variant')}
          </Typography>
          <Box sx={{ mt: 1.25, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
            <Fact label="SKU" value={formatLabel(variant.sku, 'No SKU')} />
            <Fact label="Status" value={variant.status} />
            <Fact label="Type" value={variant.product_type} />
          </Box>
        </Box>
      </Box>

      <Box>
        <Typography
          sx={{
            mb: 1,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          Inventory truth
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          <Fact label="On hand" value={variant.on_hand_quantity} />
          <Fact label="Available" value={variant.available_quantity} />
          <Fact label="Sellable" value={variant.sellable_quantity} />
        </Box>
        {!variant.has_inventory_record && (
          <Typography sx={{ mt: 1, fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
            No inventory record exists for this variant yet. It has not been received into warehouse stock.
          </Typography>
        )}
        {variant.has_inventory_record &&
          variant.on_hand_quantity === 0 &&
          variant.available_quantity === 0 &&
          variant.sellable_quantity === 0 && (
            <Typography sx={{ mt: 1, fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
              Inventory exists for this variant, but all current quantities are zero.
            </Typography>
          )}
      </Box>

      <Box sx={{ pt: 1.5, borderTop: '1px solid var(--rule)' }}>
        <Typography
          sx={{
            mb: 0.25,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink)',
          }}
        >
          Warehouse locations
        </Typography>
        <Typography sx={{ mb: 1.25, fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
          Sellable stock locations for this variant.
        </Typography>

        {!isResolved && (
          <SpatialMessage>Warehouse map availability is still resolving.</SpatialMessage>
        )}
        {isResolved && !spatialAllowed && (
          <SpatialMessage>Warehouse map is not available on this plan.</SpatialMessage>
        )}
        {spatialLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}
        {spatialAllowed && !spatialLoading && hasSpatialError && (
          <SpatialMessage>Warehouse location context is temporarily unavailable.</SpatialMessage>
        )}
        {spatialAllowed && !spatialLoading && !hasSpatialError && bins.length === 0 && (
          <SpatialMessage>No sellable stock is currently assigned to a warehouse location.</SpatialMessage>
        )}
        {spatialAllowed &&
          !spatialLoading &&
          !hasSpatialError &&
          bins.length > 0 &&
          positionedZones.length === 0 && (
            <SpatialMessage>Warehouse locations exist, but no mapped floor is available.</SpatialMessage>
          )}
        {spatialAllowed &&
          !spatialLoading &&
          !hasSpatialError &&
          bins.length > 0 &&
          positionedZones.length > 0 &&
          focusedBins.length > 0 && (
            <Box
              sx={{
                height: 260,
                border: '1px solid var(--rule)',
                borderRadius: '8px',
                overflow: 'hidden',
                bgcolor: 'var(--bg)',
              }}
            >
              <IsometricCanvas
                zones={floorZones}
                focusedBins={focusedBins}
                focusTone="risk"
                focusDimOpacity={0.45}
                showLegend={false}
                showControls={false}
                disablePan
                autoFit
                fitPadding={0.82}
              />
            </Box>
          )}
        {spatialAllowed &&
          !spatialLoading &&
          !hasSpatialError &&
          bins.length > 0 &&
          positionedZones.length > 0 &&
          focusedBins.length === 0 && (
            <SpatialMessage>Stocked locations are not positioned on the mapped floor.</SpatialMessage>
          )}

        {spatialAllowed && !spatialLoading && !hasSpatialError && bins.length > 0 && (
          <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {bins.map((bin) => (
              <Box
                key={bin.location_code}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 2,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-2)' }}>
                  {bin.location_code}
                </Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {bin.available_quantity} available
                  {unpositionedBins.some((item) => item.location_code === bin.location_code)
                    ? ' · not mapped'
                    : ''}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
