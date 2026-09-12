import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  Box,
  CircularProgress,
  Typography,
} from '@mui/material';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone } from '@lasyncro/shared/ui';

import {
  type PickBatch,
  type PickBatchLineItem,
  usePickBatchLineItems,
  usePickBatchOrders,
} from '../wms/usePickBatches';
import { useFloorPlanning } from '../floor-planning/useFloorPlanning';
import { useCommercialAccess } from '../../runtime/commercialContext';

interface BatchDetailModalBodyProps {
  batch: PickBatch;
  onNavigateToOrder: (orderId: string) => void;
}

const DEFAULT_VISIBLE_ORDERS = 4;

const formatMoney = (
  value: number,
  currency: string,
): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(value);

const formatStatus = (status: string | null): string => {
  if (!status) return 'No warehouse status';

  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const formatTimestamp = (
  value: string | null,
): string => {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const uniqueLocationCodes = (lineItems: PickBatchLineItem[]) => {
  const seen = new Set<string>();

  for (const item of lineItems) {
    const code = item.location_code?.trim();
    if (code) seen.add(code);
  }

  return [...seen];
};

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

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        border: '1px solid var(--rule)',
        borderRadius: '8px',
        px: 1.25,
        py: 1,
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
          mt: 0.25,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function BatchDetailModalBody({
  batch,
  onNavigateToOrder,
}: BatchDetailModalBodyProps) {
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const ordersQuery = usePickBatchOrders(batch.pick_batch_id);
  const lineItemsQuery = usePickBatchLineItems(batch.pick_batch_id);
  const { decide, isResolved } = useCommercialAccess();
  const floorDecision = decide('warehouse.floor_planning');
  const hasSpatialAccess = isResolved && floorDecision.allowed;
  const floorPlanning = useFloorPlanning(hasSpatialAccess);
  const orders = ordersQuery.data?.orders ?? [];
  const lineItems = lineItemsQuery.data?.line_items ?? [];
  const locationCodes = useMemo(
    () => uniqueLocationCodes(lineItems),
    [lineItems],
  );
  const floorZones: WarehouseZone[] = floorPlanning.data?.zones ?? [];
  const positionedZones = useMemo(
    () =>
      floorZones.filter(
        (zone) => zone.position_x != null && zone.position_y != null,
      ),
    [floorZones],
  );
  const positionedCodes = useMemo(
    () => new Set(positionedZones.map((zone) => zone.location_code)),
    [positionedZones],
  );
  const focusedBins = locationCodes.filter((code) => positionedCodes.has(code));
  const unmappedCodes = locationCodes.filter((code) => !positionedCodes.has(code));
  const spatialLoading = hasSpatialAccess && floorPlanning.isLoading;
  const visibleOrders = ordersExpanded
    ? orders
    : orders.slice(0, DEFAULT_VISIBLE_ORDERS);
  const hiddenOrderCount = Math.max(orders.length - visibleOrders.length, 0);

  const activateOrder = (
    orderId: string,
    event?: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
    }

    onNavigateToOrder(orderId);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 1,
        }}
      >
        <SummaryMetric
          label="Picking progress"
          value={`${batch.units_picked} / ${batch.total_units} units`}
        />
        <SummaryMetric
          label="Packing progress"
          value={`${batch.units_packed} / ${batch.total_units} units`}
        />
        <SummaryMetric
          label="Picker"
          value={batch.picker_name ?? 'Unassigned'}
        />
        <SummaryMetric
          label="Packer"
          value={batch.packer_name ?? 'Unassigned'}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: 'minmax(0, 0.9fr) minmax(300px, 1.1fr)',
          },
          gap: 1.5,
          alignItems: 'start',
          pt: 1.25,
          borderTop: '1px solid var(--rule)',
        }}
      >

      <Box
        sx={{
          minWidth: 0,
        }}
      >
        <Typography
          sx={{
            mb: 1,
            fontSize: 10,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--ink-4)',
          }}
        >
          Lifecycle
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1fr)',
            columnGap: 1.25,
            rowGap: 0.5,
          }}
        >
          {[
            ['Released', batch.released_at],
            ['Pick claimed', batch.pick_claimed_at],
            ['Pick completed', batch.pick_completed_at],
            ['Pack claimed', batch.pack_claimed_at],
            ['Pack completed', batch.pack_completed_at],
          ].map(([label, value]) => (
            <Box
              key={label}
              sx={{
                display: 'contents',
              }}
            >
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 300,
                  color: 'var(--ink-4)',
                }}
              >
                {label}
              </Typography>
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 300,
                  color: 'var(--ink-2)',
                  textAlign: 'right',
                }}
              >
                {formatTimestamp(value)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        sx={{
          minWidth: 0,
        }}
      >
        <Typography
          sx={{
            mb: 0.25,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink)',
          }}
        >
          Pick footprint
        </Typography>
        <Typography
          sx={{
            mb: 1,
            fontSize: 11,
            fontWeight: 300,
            color: 'var(--ink-4)',
          }}
        >
          Warehouse locations this batch is picking from.
        </Typography>

        {!isResolved && (
          <SpatialMessage>Warehouse map availability is still resolving.</SpatialMessage>
        )}
        {isResolved && !hasSpatialAccess && (
          <SpatialMessage>Warehouse map is not available on this plan.</SpatialMessage>
        )}
        {hasSpatialAccess && spatialLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={22} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}
        {hasSpatialAccess && !spatialLoading && floorPlanning.isError && (
          <SpatialMessage>Warehouse pick footprint is temporarily unavailable.</SpatialMessage>
        )}
        {hasSpatialAccess &&
          !spatialLoading &&
          !floorPlanning.isError &&
          locationCodes.length === 0 && (
            <SpatialMessage>No pick locations are assigned to this batch.</SpatialMessage>
          )}
        {hasSpatialAccess &&
          !spatialLoading &&
          !floorPlanning.isError &&
          locationCodes.length > 0 &&
          positionedZones.length === 0 && (
            <SpatialMessage>Warehouse locations exist, but no mapped floor is available.</SpatialMessage>
          )}
        {hasSpatialAccess &&
          !spatialLoading &&
          !floorPlanning.isError &&
          locationCodes.length > 0 &&
          positionedZones.length > 0 &&
          focusedBins.length > 0 && (
            <Box
              sx={{
                height: 205,
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
                fitPadding={0.84}
              />
            </Box>
          )}
        {hasSpatialAccess &&
          !spatialLoading &&
          !floorPlanning.isError &&
          locationCodes.length > 0 &&
          positionedZones.length > 0 &&
          focusedBins.length === 0 && (
            <SpatialMessage>Pick locations are not positioned on the mapped floor.</SpatialMessage>
          )}

        {hasSpatialAccess &&
          !spatialLoading &&
          !floorPlanning.isError &&
          locationCodes.length > 0 && (
          <Box sx={{ mt: 1.25, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {locationCodes.map((code) => (
              <Box
                key={code}
                sx={{
                  px: 1,
                  py: 0.375,
                  border: '1px solid var(--rule)',
                  borderRadius: '6px',
                  bgcolor: 'var(--bg)',
                }}
              >
                <Typography sx={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-3)' }}>
                  {code}
                  {unmappedCodes.includes(code) ? ' · not mapped' : ''}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      </Box>

      <Box
        sx={{
          pt: 1.25,
          borderTop: '1px solid var(--rule)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 2,
            mb: 1,
          }}
        >
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink)',
            }}
          >
            {orders.length} {orders.length === 1 ? 'order' : 'orders'}
          </Typography>

          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 300,
              color: 'var(--ink-4)',
            }}
          >
            {batch.total_line_items} lines · {batch.total_units} units
          </Typography>
        </Box>

        {ordersQuery.isLoading && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              py: 3,
            }}
          >
            <CircularProgress
              size={22}
              sx={{ color: 'var(--accent)' }}
            />
          </Box>
        )}

        {!ordersQuery.isLoading && ordersQuery.isError && (
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 300,
              color: 'var(--ink-3)',
              py: 1,
            }}
          >
            Could not load member orders.
          </Typography>
        )}

        {!ordersQuery.isLoading &&
          !ordersQuery.isError &&
          visibleOrders.map((order) => {
            const unitCount = order.line_items.reduce(
              (sum, line) => sum + Number(line.quantity),
              0,
            );

            return (
              <Box
                key={order.lasyncro_order_id}
                role="button"
                tabIndex={0}
                aria-label={`Order #${order.external_order_id}`}
                onClick={() =>
                  onNavigateToOrder(order.lasyncro_order_id)
                }
                onKeyDown={(event) =>
                  activateOrder(order.lasyncro_order_id, event)
                }
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 1,
                  alignItems: 'center',
                  p: '8px 10px',
                  mb: 0.5,
                  border: '1px solid var(--rule)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  '&:hover': {
                    borderColor: 'var(--accent-border)',
                  },
                  '&:focus-visible': {
                    outline: '2px solid var(--accent)',
                    outlineOffset: '2px',
                  },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'var(--ink)',
                    }}
                  >
                    Order #{order.external_order_id}
                  </Typography>

                  <Typography
                    sx={{
                      mt: 0.25,
                      fontSize: 10.5,
                      fontWeight: 300,
                      color: 'var(--ink-4)',
                    }}
                  >
                    {formatStatus(order.warehouse_status)}
                    {' · '}
                    {order.line_items.length}{' '}
                    {order.line_items.length === 1 ? 'line' : 'lines'}
                    {' · '}
                    {unitCount} {unitCount === 1 ? 'unit' : 'units'}
                  </Typography>
                </Box>

                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--ink-2)',
                  }}
                >
                  {formatMoney(
                    Number(order.total_price),
                    order.currency,
                  )}
                </Typography>
              </Box>
            );
          })}
        {!ordersQuery.isLoading &&
          !ordersQuery.isError &&
          hiddenOrderCount > 0 && (
            <Box
              component="button"
              type="button"
              onClick={() => setOrdersExpanded(true)}
              sx={{
                mt: 0.25,
                px: 1,
                py: 0.5,
                border: '1px solid var(--rule)',
                borderRadius: '6px',
                bgcolor: 'transparent',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                '&:hover': {
                  bgcolor: 'var(--bg)',
                },
              }}
            >
              Show {hiddenOrderCount} more
            </Box>
          )}
      </Box>
    </Box>
  );
}
