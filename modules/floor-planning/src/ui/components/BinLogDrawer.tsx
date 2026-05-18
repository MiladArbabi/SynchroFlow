// modules/floor-planning/src/ui/components/BinLogDrawer.tsx
import { Box, Typography, Divider, IconButton, CircularProgress } from '@mui/material';
import { X, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import type { BinLogEvent } from '@lasyncro/shared/ui';

/**
 * BinLogDrawer — slide-in activity timeline for a selected bin.
 *
 * Shows merged inventory_movements + pick_scan_log events for the bin,
 * sorted newest first.
 *
 * operator_name is null for pre-traceability or system-driven movements —
 * shown as "System" until traceability sprint writers are updated (0107).
 *
 * TRACEABILITY SPRINT: enrich with picks 7D, reorder signal, ghost stock flag.
 */

const MOVEMENT_LABELS: Record<string, { label: string; inbound: boolean }> = {
  inbound_purchase:       { label: 'Received',      inbound: true  },
  sale:                   { label: 'Sold',           inbound: false },
  pick_scan:              { label: 'Picked',         inbound: false },
  refund_return:          { label: 'Return',         inbound: true  },
  damage:                 { label: 'Damaged',        inbound: false },
  shrinkage:              { label: 'Shrinkage',      inbound: false },
  manual_adjustment:      { label: 'Adjustment',     inbound: true  },
  reservation_hold:       { label: 'Reserved',       inbound: false },
  reservation_release:    { label: 'Released',       inbound: true  },
  opening_balance:        { label: 'Opening stock',  inbound: true  },
  reconciliation_correction: { label: 'Correction', inbound: true  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

interface BinLogDrawerProps {
  locationCode: string;
  events: BinLogEvent[];
  isLoading: boolean;
  open: boolean;
  onClose: () => void;
}

export function BinLogDrawer({ locationCode, events, isLoading, open, onClose }: BinLogDrawerProps) {
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        height: '100%',
        width: open ? 360 : 0,
        minWidth: open ? 360 : 0,
        overflow: 'hidden',
        transition: 'width 0.25s ease, min-width 0.25s ease',
        bgcolor: 'var(--bg)',
        borderLeft: open ? '1px solid var(--rule)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, py: 2.5, borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.25 }}>
            Bin Activity
          </Typography>
          <Typography sx={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: 'var(--ink)' }}>
            {locationCode}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: 'var(--ink-3)' }}>
          <X size={16} />
        </IconButton>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2 }}>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}

        {!isLoading && events.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>No activity recorded for this bin yet.</Typography>
          </Box>
        )}

        {!isLoading && events.map((event, i) => {
          const meta    = MOVEMENT_LABELS[event.movement_type] ?? { label: event.movement_type, inbound: event.quantity_delta > 0 };
          const inbound = event.quantity_delta > 0;
          const qty     = Math.abs(event.quantity_delta);
          const operator = event.operator_name?.trim() || 'System';

          return (
            <Box key={event.id}>
              <Box sx={{ display: 'flex', gap: 1.5, py: 1.5, alignItems: 'flex-start' }}>
                <Box sx={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: inbound ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
                }}>
                  {inbound
                    ? <ArrowDown size={13} color="rgba(34,197,94,0.9)" />
                    : <ArrowUp size={13} color="rgba(239,68,68,0.8)" />
                  }
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                      {meta.label}
                      <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, color: inbound ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.8)', ml: 0.75 }}>
                        {inbound ? '+' : '-'}{qty}
                      </Typography>
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0, ml: 1 }}>
                      {timeAgo(event.event_at)}
                    </Typography>
                  </Box>
                  {event.sku && (
                    <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-3)', mb: 0.25 }}>
                      {event.sku}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{operator}</Typography>
                    {event.reference_type && (
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>· {event.reference_type.replace(/_/g, ' ')}</Typography>
                    )}
                  </Box>
                </Box>
              </Box>
              {i < events.length - 1 && <Divider />}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <RefreshCw size={11} />
          Last 50 events · refreshes every 30s
        </Typography>
      </Box>
    </Box>
  );
}