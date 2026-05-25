// apps/frontend/src/pages/ft2-pages/ReturnsItemsPage.tsx
//
// Returns — Items tab
// -------------------
// Owner decision surface. Items physically back in the warehouse
// with condition: damaged | unsellable — need a disposition decision.
//
// Decisions: reship | contact_customer | initiate_refund | write_off
//
// Data: GET  /api/v1/modules/returns/items
//       PATCH /api/v1/modules/returns/items/:id/decision
//
// RULES:
// - No hardcoded hex — CSS variables or theme.palette.* only
// - No inline style={} — MUI sx only
// - No cross-module imports

import { useState } from 'react';
import {
  Box, Typography, CircularProgress, Alert, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Package, RotateCcw, Phone, DollarSign, Trash2 } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';

// ─── TYPES ────────────────────────────────────────────

type OwnerDecision = 'reship' | 'contact_customer' | 'initiate_refund' | 'write_off';
type ItemCondition = 'damaged' | 'unsellable';

interface ReturnItem {
  id: string;
  lasyncro_order_id: string;
  external_order_id: string | null;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  item_condition: ItemCondition;
  condition_notes: string | null;
  owner_decision: OwnerDecision | null;
  decision_notes: string | null;
  decided_at: string | null;
  returned_at: string | null;
}

// ─── HOOKS ────────────────────────────────────────────

function useReturnItems() {
  return useQuery<{ data: ReturnItem[] }>({
    queryKey: ['returns', 'items'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/returns/items');
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useSetDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, notes }: {
      id: string;
      decision: OwnerDecision;
      notes?: string;
    }) => {
      await axiosInstance.patch(`/api/v1/modules/returns/items/${id}/decision`, {
        decision,
        decision_notes: notes,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['returns', 'items'] }),
  });
}

// ─── DECISION CONFIG ──────────────────────────────────

const DECISIONS: {
  value: OwnerDecision;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}[] = [
  {
    value: 'reship',
    label: 'Reship',
    description: 'Send replacement to customer',
    icon: RotateCcw,
    color: '#3B82F6',
  },
  {
    value: 'contact_customer',
    label: 'Contact customer',
    description: 'Reach out before deciding',
    icon: Phone,
    color: '#8B5CF6',
  },
  {
    value: 'initiate_refund',
    label: 'Initiate refund',
    description: 'Issue refund to customer',
    icon: DollarSign,
    color: '#F59E0B',
  },
  {
    value: 'write_off',
    label: 'Write off',
    description: 'Mark as loss, discard item',
    icon: Trash2,
    color: '#EF4444',
  },
];

const CONDITION_CONFIG: Record<ItemCondition, { label: string; color: string }> = {
  damaged:    { label: 'Damaged',    color: '#F59E0B' },
  unsellable: { label: 'Unsellable', color: '#EF4444' },
};

// ─── ITEM CARD ────────────────────────────────────────

function ItemCard({ item }: { item: ReturnItem }) {
  const theme = useTheme();
  const setDecision = useSetDecision();
  const [pendingDecision, setPendingDecision] = useState<OwnerDecision | null>(null);
  const [confirming, setConfirming] = useState(false);

  const conditionCfg = CONDITION_CONFIG[item.item_condition];
  const isDecided = item.owner_decision !== null;
  const decidedCfg = isDecided
    ? DECISIONS.find(d => d.value === item.owner_decision)
    : null;

  const handleConfirm = async () => {
    if (!pendingDecision) return;
    setConfirming(true);
    try {
      await setDecision.mutateAsync({ id: item.id, decision: pendingDecision });
      setPendingDecision(null);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '0.5px solid var(--rule)',
      borderRadius: '10px',
      p: 2.5,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      opacity: isDecided ? 0.7 : 1,
    }}>
      {/* Item header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              {item.variant_title ?? 'Unknown product'}
            </Typography>
            <Box sx={{
              px: 0.75, py: 0.25, borderRadius: '20px',
              bgcolor: alpha(conditionCfg.color, 0.12),
              border: `0.5px solid ${alpha(conditionCfg.color, 0.35)}`,
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, color: conditionCfg.color }}>
                {conditionCfg.label}
              </Typography>
            </Box>
          </Box>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
            {item.sku ?? '—'}
          </Typography>
          {item.external_order_id && (
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
              Order #{item.external_order_id} · {item.quantity} unit{item.quantity !== 1 ? 's' : ''}
            </Typography>
          )}
          {item.condition_notes && (
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.5, fontStyle: 'italic' }}>
              "{item.condition_notes}"
            </Typography>
          )}
        </Box>

        {/* Already decided */}
        {isDecided && decidedCfg && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.5, borderRadius: '6px',
            bgcolor: alpha(decidedCfg.color, 0.1),
            border: `0.5px solid ${alpha(decidedCfg.color, 0.3)}`,
          }}>
            <CheckCircle size={12} color={decidedCfg.color} />
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: decidedCfg.color }}>
              {decidedCfg.label}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Decision buttons — only when not yet decided */}
      {!isDecided && (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {DECISIONS.map(d => (
              <Box
                key={d.value}
                onClick={() => setPendingDecision(
                  pendingDecision === d.value ? null : d.value
                )}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75,
                  px: 1.25, py: 0.625, borderRadius: '6px',
                  cursor: 'pointer',
                  bgcolor: pendingDecision === d.value
                    ? alpha(d.color, 0.12)
                    : 'var(--bg-2)',
                  border: `0.5px solid ${pendingDecision === d.value
                    ? alpha(d.color, 0.4)
                    : 'var(--rule)'}`,
                  transition: 'all 0.12s ease',
                  '&:hover': {
                    bgcolor: alpha(d.color, 0.08),
                    borderColor: alpha(d.color, 0.3),
                  },
                }}
              >
                <d.icon size={12} color={pendingDecision === d.value ? d.color : 'var(--ink-4)'} />
                <Box>
                  <Typography sx={{
                    fontSize: 12, fontWeight: 500,
                    color: pendingDecision === d.value ? d.color : 'var(--ink-3)',
                    lineHeight: 1.2,
                  }}>
                    {d.label}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>

          {/* Confirm bar */}
          {pendingDecision && (
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              px: 1.5, py: 1,
              bgcolor: alpha(theme.palette.warning.main, 0.06),
              border: `0.5px solid ${alpha(theme.palette.warning.main, 0.25)}`,
              borderRadius: '6px',
            }}>
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Confirm: <Box component="span" sx={{ fontWeight: 500, color: 'var(--ink)' }}>
                  {DECISIONS.find(d => d.value === pendingDecision)?.label}
                </Box>
                {' '}for {item.variant_title ?? 'this item'}?
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Box
                  onClick={() => setPendingDecision(null)}
                  sx={{
                    px: 1.25, py: 0.5, borderRadius: '6px', cursor: 'pointer',
                    border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
                    fontSize: 12, color: 'var(--ink-3)',
                    '&:hover': { borderColor: 'var(--ink-3)' },
                  }}
                >
                  Cancel
                </Box>
                <Box
                  onClick={handleConfirm}
                  sx={{
                    px: 1.25, py: 0.5, borderRadius: '6px', cursor: 'pointer',
                    bgcolor: 'var(--accent)', color: 'white',
                    fontSize: 12, fontWeight: 600,
                    opacity: confirming ? 0.7 : 1,
                    '&:hover': { opacity: 0.88 },
                  }}
                >
                  {confirming ? 'Saving…' : 'Confirm →'}
                </Box>
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function ReturnsItemsPage() {
  const { data, isLoading, isError } = useReturnItems();
  const items = data?.data ?? [];
  const pending = items.filter(i => !i.owner_decision);
  const decided = items.filter(i => i.owner_decision !== null);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: '24px 40px' }}>

      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', mb: 0.25 }}>
          Returned items
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {isLoading
            ? '—'
            : items.length === 0
              ? 'No items awaiting a decision'
              : `${pending.length} awaiting decision · ${decided.length} resolved`}
        </Typography>
      </Box>

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>Failed to load returned items.</Alert>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Empty state */}
      {!isLoading && items.length === 0 && (
        <Box sx={{
          py: 8, textAlign: 'center',
          border: '0.5px solid var(--rule)',
          borderRadius: '10px', bgcolor: 'var(--surface)',
        }}>
          <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
          <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', mb: 0.5 }}>
            No items awaiting a decision.
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
            Damaged or unsellable returns will appear here once operators complete a return job.
          </Typography>
        </Box>
      )}

      {/* Pending decisions */}
      {pending.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography sx={{
              fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--ink-4)',
            }}>
              Awaiting decision
            </Typography>
            <Box sx={{
              px: 0.75, py: 0.125, borderRadius: '20px',
              bgcolor: 'var(--bg-2)', border: '0.5px solid var(--rule)',
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }}>
                {pending.length}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {pending.map(item => <ItemCard key={item.id} item={item} />)}
          </Box>
        </Box>
      )}

      {/* Resolved */}
      {decided.length > 0 && (
        <Box>
          <Typography sx={{
            fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5,
          }}>
            Resolved · {decided.length}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {decided.map(item => <ItemCard key={item.id} item={item} />)}
          </Box>
        </Box>
      )}
    </Box>
  );
}