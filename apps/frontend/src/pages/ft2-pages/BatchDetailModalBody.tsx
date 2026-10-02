import { useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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

/**
 * BATCH-DETAIL-HANDOFF-01 — stage model shared with the Order Flow
 * fulfillment card. Position derives from canonical batch.status only.
 */
const STAGES = [
  { key: 'picking', label: 'Picking' },
  { key: 'pick_complete', label: 'Picked' },
  { key: 'packing', label: 'Packing' },
  { key: 'pack_complete', label: 'Packed' },
] as const;

const currentStageIndex = (status: PickBatch['status']): number => {
  switch (status) {
    case 'pending':
    case 'picking':
      return 0;
    case 'pick_complete':
      return 1;
    case 'packing':
      return 2;
    case 'pack_complete':
      return 3;
    default:
      return -1;
  }
};

/**
 * Execution handoff is navigation only (Tier 2). Pick work deep-links the
 * exact batch into WMS Operations (?batchId= → Pick Brief, which owns the
 * claim). Pack work is item-centric free-scan, so it lands on Operations.
 */
const executionTarget = (
  batch: PickBatch,
): { label: string; to: string } | null => {
  const pickTarget = `/wms?batchId=${encodeURIComponent(batch.pick_batch_id)}`;

  switch (batch.status) {
    case 'pending':
      return { label: 'Continue to Pick →', to: pickTarget };
    case 'picking':
      return { label: 'Resume Picking →', to: pickTarget };
    case 'pick_complete':
      return { label: 'Go to Packing →', to: '/wms' };
    case 'packing':
      return { label: 'Resume Packing →', to: '/wms' };
    default:
      return null;
  }
};

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

/** Labelled region with the body's standard section heading. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <Box component="section" aria-labelledby={headingId} sx={{ minWidth: 0 }}>
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
          id={headingId}
          sx={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink)',
          }}
        >
          {title}
        </Typography>
        {aside}
      </Box>
      {children}
    </Box>
  );
}

function WorkFact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-2)' }}>
        {value}
      </Typography>
    </Box>
  );
}

function CurrentWorkContent({ batch }: { batch: PickBatch }) {
  const picker = batch.picker_name ?? 'Unassigned';
  const packer = batch.packer_name ?? 'Unassigned';

  let headline: string;
  let detail: string | null = null;
  let facts: Array<[string, string]>;

  switch (batch.status) {
    case 'pending':
      headline = 'Waiting to be picked';
      facts = [['Picker', picker], ['Packer', packer]];
      break;
    case 'picking':
      headline = 'Picking in progress';
      facts = [
        ['Picker', picker],
        ['Picked', `${batch.units_picked} / ${batch.total_units} units`],
      ];
      break;
    case 'pick_complete':
      headline = 'Picking complete';
      detail = 'Waiting for packing';
      facts = [['Picker', picker], ['Packer', packer]];
      break;
    case 'packing':
      headline = 'Packing in progress';
      facts = [
        ['Packer', packer],
        ['Packed', `${batch.units_packed} / ${batch.total_units} units`],
      ];
      break;
    case 'pack_complete':
      headline = 'Packing complete';
      facts = [
        ['Packer', packer],
        ['Completed', formatTimestamp(batch.pack_completed_at)],
      ];
      break;
    default:
      headline = formatStatus(batch.status);
      facts = [];
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
        {headline}
      </Typography>
      {detail && (
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
          {detail}
        </Typography>
      )}
      <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {facts.map(([label, value]) => (
          <WorkFact key={label} label={label} value={value} />
        ))}
      </Box>
    </Box>
  );
}

const SECTION_DIVIDER_SX = {
  pt: 1.25,
  borderTop: '1px solid var(--rule)',
} as const;

const ITEM_GRID_COLUMNS =
  'minmax(56px, 0.8fr) minmax(0, 2fr) minmax(0, 1.1fr) 36px minmax(0, 1.2fr)';

export function BatchDetailModalBody({
  batch,
  onNavigateToOrder,
}: BatchDetailModalBodyProps) {
  const navigate = useNavigate();
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
  const externalOrderIds = useMemo(
    () =>
      new Map(
        orders.map((order) => [order.lasyncro_order_id, order.external_order_id]),
      ),
    [orders],
  );

  // Facts that depend on a query stay unknown ('—') rather than a misleading
  // operational zero while that query is loading or failed.
  const ordersKnown = !ordersQuery.isLoading && !ordersQuery.isError;
  const lineItemsKnown = !lineItemsQuery.isLoading && !lineItemsQuery.isError;
  const stageIndex = currentStageIndex(batch.status);
  const execution = executionTarget(batch);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {/* STAGE */}
      <Box
        component="ol"
        aria-label="Batch stages"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 1,
        }}
      >
        {STAGES.map((stage, index) => {
          const isCurrent = index === stageIndex;
          const isComplete =
            index < stageIndex ||
            (batch.status === 'pack_complete' && index === stageIndex);

          return (
            <Box
              component="li"
              key={stage.key}
              aria-current={isCurrent ? 'step' : undefined}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  height: 4,
                  borderRadius: '2px',
                  bgcolor:
                    isComplete || isCurrent ? 'var(--accent)' : 'var(--rule)',
                  opacity: isCurrent && !isComplete ? 0.55 : 1,
                }}
              />
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: isCurrent ? 500 : 300,
                  color: isCurrent
                    ? 'var(--ink)'
                    : isComplete
                      ? 'var(--ink-2)'
                      : 'var(--ink-4)',
                }}
              >
                {stage.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* FACTS */}
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
          label="Orders"
          value={ordersKnown ? String(orders.length) : '—'}
        />
        <SummaryMetric label="Lines" value={String(batch.total_line_items)} />
        <SummaryMetric label="Units" value={String(batch.total_units)} />
        <SummaryMetric
          label="Locations"
          value={lineItemsKnown ? String(locationCodes.length) : '—'}
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
          ...SECTION_DIVIDER_SX,
        }}
      >
      <Section title="Current work">
        <CurrentWorkContent batch={batch} />

        {execution && (
          <Box
            component="button"
            type="button"
            onClick={() => navigate(execution.to)}
            sx={{
              mt: 1.5,
              display: 'inline-flex',
              alignItems: 'center',
              px: 1.25,
              py: 0.5,
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--accent)',
              bgcolor: 'transparent',
              border: '0.5px solid var(--accent)',
              borderRadius: '6px',
              cursor: 'pointer',
              '&:hover': { opacity: 0.75 },
              '&:focus-visible': {
                outline: '2px solid var(--accent)',
                outlineOffset: '2px',
              },
            }}
          >
            {execution.label}
          </Box>
        )}
      </Section>

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

      {/* ITEMS TO PICK — canonical batch line-item truth only */}
      <Box sx={SECTION_DIVIDER_SX}>
        <Section title="Items to pick">
          {lineItemsQuery.isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={22} sx={{ color: 'var(--accent)' }} />
            </Box>
          )}

          {!lineItemsQuery.isLoading && lineItemsQuery.isError && (
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', py: 1 }}>
              Could not load items to pick.
            </Typography>
          )}

          {lineItemsKnown && lineItems.length === 0 && (
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', py: 1 }}>
              No items are assigned to this batch.
            </Typography>
          )}

          {lineItemsKnown && lineItems.length > 0 && (
            <Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: ITEM_GRID_COLUMNS,
                  gap: 1,
                  px: 1.25,
                  pb: 0.5,
                }}
              >
                {['Location', 'Item', 'SKU', 'Qty', 'Order'].map((heading) => (
                  <Typography
                    key={heading}
                    sx={{
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-4)',
                      textAlign: heading === 'Qty' ? 'right' : 'left',
                    }}
                  >
                    {heading}
                  </Typography>
                ))}
              </Box>

              <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
                {lineItems.map((item) => {
                  const externalOrderId = externalOrderIds.get(item.lasyncro_order_id);
                  const location = item.location_code?.trim();

                  return (
                    <Box
                      key={`${item.lasyncro_line_item_id}:${item.reservation_allocation_id ?? item.location_code}`}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: ITEM_GRID_COLUMNS,
                        gap: 1,
                        alignItems: 'center',
                        px: 1.25,
                        py: 0.75,
                        borderTop: '1px solid var(--rule)',
                      }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-2)' }}>
                        {location || '—'}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 12,
                          fontWeight: 300,
                          color: 'var(--ink)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.title}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 11,
                          fontWeight: 300,
                          color: 'var(--ink-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.sku ?? '—'}
                      </Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', textAlign: 'right' }}>
                        {item.quantity}
                      </Typography>
                      <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
                        {externalOrderId ? `#${externalOrderId}` : '—'}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Section>
      </Box>

      {/* MEMBER ORDERS */}
      <Box sx={SECTION_DIVIDER_SX}>
        <Section
          title="Member orders"
          aside={
            ordersKnown ? (
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 300,
                  color: 'var(--ink-4)',
                }}
              >
                {orders.length} {orders.length === 1 ? 'order' : 'orders'}
              </Typography>
            ) : undefined
          }
        >
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

        {ordersKnown &&
          visibleOrders.map((order) => {
            const unitCount = order.line_items.reduce(
              (sum, line) => sum + Number(line.quantity),
              0,
            );

            return (
              <Box
                key={order.lasyncro_order_id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                  gap: 1.5,
                  alignItems: 'center',
                  p: '8px 10px',
                  mb: 0.5,
                  border: '1px solid var(--rule)',
                  borderRadius: '8px',
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

                <Box
                  component="button"
                  type="button"
                  aria-label={`View order #${order.external_order_id}`}
                  onClick={() => onNavigateToOrder(order.lasyncro_order_id)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    px: 1,
                    py: 0.375,
                    fontFamily: 'inherit',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--accent)',
                    bgcolor: 'var(--surface)',
                    border: '0.5px solid var(--accent-border)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    '&:hover': { opacity: 0.75 },
                    '&:focus-visible': {
                      outline: '2px solid var(--accent)',
                      outlineOffset: '2px',
                    },
                  }}
                >
                  View →
                </Box>
              </Box>
            );
          })}
        {ordersKnown &&
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
        </Section>
      </Box>
    </Box>
  );
}
