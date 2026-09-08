import type { KeyboardEvent } from 'react';
import {
  Box,
  CircularProgress,
  Typography,
} from '@mui/material';

import {
  type PickBatch,
  usePickBatchOrders,
} from '../wms/usePickBatches';

interface BatchDetailModalBodyProps {
  batch: PickBatch;
  onNavigateToOrder: (orderId: string) => void;
}

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

export function BatchDetailModalBody({
  batch,
  onNavigateToOrder,
}: BatchDetailModalBodyProps) {
  const ordersQuery = usePickBatchOrders(batch.pick_batch_id);
  const orders = ordersQuery.data?.orders ?? [];

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
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            border: '1px solid var(--rule)',
            borderRadius: '10px',
            p: 1.5,
          }}
        >
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
            }}
          >
            Picking progress
          </Typography>

          <Typography
            sx={{
              mt: 0.5,
              fontSize: 18,
              fontWeight: 500,
              color: 'var(--ink)',
            }}
          >
            {batch.units_picked} / {batch.total_units} units
          </Typography>
        </Box>

        <Box
          sx={{
            border: '1px solid var(--rule)',
            borderRadius: '10px',
            p: 1.5,
          }}
        >
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
            }}
          >
            Packing progress
          </Typography>

          <Typography
            sx={{
              mt: 0.5,
              fontSize: 18,
              fontWeight: 500,
              color: 'var(--ink)',
            }}
          >
            {batch.units_packed} / {batch.total_units} units
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 1.5,
        }}
      >
        <Box>
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--ink-4)',
            }}
          >
            Picker
          </Typography>
          <Typography
            sx={{
              mt: 0.375,
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--ink)',
            }}
          >
            {batch.picker_name ?? 'Unassigned'}
          </Typography>
        </Box>

        <Box>
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--ink-4)',
            }}
          >
            Packer
          </Typography>
          <Typography
            sx={{
              mt: 0.375,
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--ink)',
            }}
          >
            {batch.packer_name ?? 'Unassigned'}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          pt: 1.5,
          borderTop: '1px solid var(--rule)',
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 1.25,
          }}
        >
          {[
            ['Released', batch.released_at],
            ['Pick claimed', batch.pick_claimed_at],
            ['Pick completed', batch.pick_completed_at],
            ['Pack claimed', batch.pack_claimed_at],
            ['Pack completed', batch.pack_completed_at],
          ].map(([label, value]) => (
            <Box key={label}>
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 400,
                  color: 'var(--ink-4)',
                }}
              >
                {label}
              </Typography>
              <Typography
                sx={{
                  mt: 0.25,
                  fontSize: 11,
                  fontWeight: 300,
                  color: 'var(--ink-2)',
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
          pt: 1.5,
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
          orders.map((order) => {
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
                  gap: 1.5,
                  alignItems: 'center',
                  p: '10px 12px',
                  mb: 0.75,
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
                      fontSize: 11,
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
      </Box>
    </Box>
  );
}
