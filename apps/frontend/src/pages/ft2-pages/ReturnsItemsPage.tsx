// apps/frontend/src/pages/ft2-pages/ReturnsItemsPage.tsx
//
// Returns — Items tab
// -------------------
// Order-level cards → EntityDetailModal → per-line owner decisions.
// Decisions are per LINE ITEM as of the multi-line rework (2026-07-07):
// a job stays awaiting_decision until every damaged/unsellable line has
// a decision, so one order can have some lines resolved and others still
// pending — the modal shows all of them together, not just the open ones.
//
// Decisions: reship | contact_customer | initiate_refund | write_off
//
// Data: GET   /api/v1/modules/returns/items            (order groups)
//       PATCH /api/v1/modules/returns/items/:lineId/decision
//
// RULES:
// - No hardcoded hex — CSS variables or theme.palette.* only
// - No inline style={} — MUI sx only

import { useEffect, useState } from 'react';
import {
  Box, Typography, CircularProgress, Alert, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Package, RotateCcw, Phone, DollarSign, Trash2, Clock } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { EntityDetailModal } from '@lasyncro/shared/ui';

// ─── TYPES ────────────────────────────────────────────

type OwnerDecision = 'reship' | 'contact_customer' | 'initiate_refund' | 'write_off';
type ItemCondition = 'damaged' | 'unsellable';

interface ReturnDecisionLine {
  id: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number | null;
  item_condition: ItemCondition;
  condition_notes: string | null;
  owner_decision: OwnerDecision | null;
  decision_notes: string | null;
  decided_at: string | null;
}

interface ReturnDecisionGroup {
  return_job_id: string;
  external_order_id: string | null;
  created_at: string;
  total_refund_amount: number;
  lines: ReturnDecisionLine[];
}

// ─── HOOKS ────────────────────────────────────────────

function useReturnItems() {
  return useQuery<{ data: ReturnDecisionGroup[] }>({
    queryKey: ['returns', 'items'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/returns/items');
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useSetLineDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, decision, notes }: {
      lineId: string;
      decision: OwnerDecision;
      notes?: string;
    }) => {
      await axiosInstance.patch(`/api/v1/modules/returns/items/${lineId}/decision`, {
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
  { value: 'reship', label: 'Reship', description: 'Send replacement to customer', icon: RotateCcw, color: '#3B82F6' },
  { value: 'contact_customer', label: 'Contact customer', description: 'Reach out before deciding', icon: Phone, color: '#8B5CF6' },
  { value: 'initiate_refund', label: 'Initiate refund', description: 'Issue refund to customer', icon: DollarSign, color: '#F59E0B' },
  { value: 'write_off', label: 'Write off', description: 'Mark as loss, discard item', icon: Trash2, color: '#EF4444' },
];

const CONDITION_CONFIG: Record<ItemCondition, { label: string; color: string }> = {
  damaged:    { label: 'Damaged',    color: '#F59E0B' },
  unsellable: { label: 'Unsellable', color: '#EF4444' },
};

const fmt = (n: number) =>
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ─── LINE ROW (inside modal) ──────────────────────────

function LineDecisionRow({ line }: { line: ReturnDecisionLine }) {
  const theme = useTheme();
  const setDecision = useSetLineDecision();
  const [pendingDecision, setPendingDecision] = useState<OwnerDecision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conditionCfg = CONDITION_CONFIG[line.item_condition];
  const isDecided = line.owner_decision !== null;
  const decidedCfg = isDecided ? DECISIONS.find(d => d.value === line.owner_decision) : null;

  const handleConfirm = async () => {
    if (!pendingDecision) return;
    setConfirming(true);
    setError(null);
    try {
      await setDecision.mutateAsync({ lineId: line.id, decision: pendingDecision });
      setPendingDecision(null);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? 'Failed to save decision');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Box sx={{
      bgcolor: 'var(--bg)',
      border: '0.5px solid var(--rule)',
      borderRadius: '10px',
      p: 2,
      display: 'flex',
      flexDirection: 'column',
      gap: 1.5,
      opacity: isDecided ? 0.75 : 1,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
              {line.variant_title ?? 'Unknown product'}
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
            {line.sku ?? '—'} · {line.quantity ?? 0} unit{line.quantity !== 1 ? 's' : ''}
          </Typography>
          {line.condition_notes && (
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.5, fontStyle: 'italic' }}>
              "{line.condition_notes}"
            </Typography>
          )}
        </Box>
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

      {error && <Alert severity="error" sx={{ py: 0.25, fontSize: 12 }}>{error}</Alert>}

      {!isDecided && (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {DECISIONS.map(d => (
              <Box
                key={d.value}
                onClick={() => setPendingDecision(pendingDecision === d.value ? null : d.value)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75,
                  px: 1.25, py: 0.625, borderRadius: '6px', cursor: 'pointer',
                  bgcolor: pendingDecision === d.value ? alpha(d.color, 0.12) : 'var(--bg-2)',
                  border: `0.5px solid ${pendingDecision === d.value ? alpha(d.color, 0.4) : 'var(--rule)'}`,
                  transition: 'all 0.12s ease',
                  '&:hover': { bgcolor: alpha(d.color, 0.08), borderColor: alpha(d.color, 0.3) },
                }}
              >
                <d.icon size={12} color={pendingDecision === d.value ? d.color : 'var(--ink-4)'} />
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: pendingDecision === d.value ? d.color : 'var(--ink-3)' }}>
                  {d.label}
                </Typography>
              </Box>
            ))}
          </Box>

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
                {' '}for {line.variant_title ?? 'this line'}?
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Box onClick={() => setPendingDecision(null)} sx={{
                  px: 1.25, py: 0.5, borderRadius: '6px', cursor: 'pointer',
                  border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
                  fontSize: 12, color: 'var(--ink-3)',
                  '&:hover': { borderColor: 'var(--ink-3)' },
                }}>
                  Cancel
                </Box>
                <Box onClick={handleConfirm} sx={{
                  px: 1.25, py: 0.5, borderRadius: '6px', cursor: 'pointer',
                  bgcolor: 'var(--accent)', color: 'var(--accent-ink)',
                  fontSize: 12, fontWeight: 600,
                  opacity: confirming ? 0.7 : 1,
                  '&:hover': { opacity: 0.88 },
                }}>
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

// ─── ORDER CARD (list view) ───────────────────────────

function OrderCard({ group, onClick }: { group: ReturnDecisionGroup; onClick: () => void }) {
  const pendingCount = group.lines.filter(l => !l.owner_decision).length;
  const formatAge = (iso: string) => {
    const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  return (
    <Box
      onClick={onClick}
      sx={{
        bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)',
        borderRadius: '10px',
        p: 2.5,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
        '&:hover': { borderColor: 'var(--accent-border)' },
      }}
    >
      <Box>
        <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
          Order {group.external_order_id ? `#${group.external_order_id}` : '—'}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', mt: 0.25 }}>
          {group.lines.length} line{group.lines.length !== 1 ? 's' : ''} · {fmt(group.total_refund_amount)} refunded
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'var(--ink-4)' }}>
          <Clock size={12} />
          <Typography sx={{ fontSize: 11 }}>{formatAge(group.created_at)}</Typography>
        </Box>
        {pendingCount > 0 ? (
          <Box sx={{
            px: 1, py: 0.375, borderRadius: '20px',
            bgcolor: alpha('#F59E0B', 0.12), border: '0.5px solid rgba(245,158,11,0.35)',
          }}>
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: '#F59E0B' }}>
              {pendingCount} pending
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            px: 1, py: 0.375, borderRadius: '20px',
            bgcolor: alpha('#22C55E', 0.12), border: '0.5px solid rgba(34,197,94,0.35)',
          }}>
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: '#22C55E' }}>
              All decided
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function ReturnsItemsPage() {
  const { data, isLoading, isError } = useReturnItems();
  const groups = data?.data ?? [];
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedGroup = groups.find(g => g.return_job_id === selectedJobId) ?? null;

  // Close the modal automatically once its job drops out of the awaiting-
  // decision list (all lines decided → job no longer awaiting_decision).
  // Without this, the modal stays open showing nothing, since entityId
  // is still set but the group it referenced no longer exists.
  useEffect(() => {
    if (selectedJobId && !isLoading && !selectedGroup) {
      setSelectedJobId(null);
    }
  }, [selectedJobId, isLoading, selectedGroup]);

  const totalPending = groups.reduce((sum, g) => sum + g.lines.filter(l => !l.owner_decision).length, 0);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: '24px 40px' }}>
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
          Returned items
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {isLoading
            ? '—'
            : groups.length === 0
              ? 'No orders awaiting a decision'
              : `${groups.length} order${groups.length !== 1 ? 's' : ''} · ${totalPending} line${totalPending !== 1 ? 's' : ''} pending`}
        </Typography>
      </Box>

      {isError && <Alert severity="error" sx={{ mb: 3 }}>Failed to load returned items.</Alert>}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!isLoading && groups.length === 0 && (
        <Box sx={{ py: 8, textAlign: 'center', border: '0.5px solid var(--rule)', borderRadius: '10px', bgcolor: 'var(--surface)' }}>
          <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
          <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', mb: 0.5 }}>
            No items awaiting a decision.
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
            Damaged or unsellable returns will appear here once operators complete a return job.
          </Typography>
        </Box>
      )}

      {groups.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {groups.map(group => (
            <OrderCard key={group.return_job_id} group={group} onClick={() => setSelectedJobId(group.return_job_id)} />
          ))}
        </Box>
      )}

      <EntityDetailModal
        entityId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
        title={selectedGroup ? `Order ${selectedGroup.external_order_id ? `#${selectedGroup.external_order_id}` : ''}` : ''}
        subtitle={selectedGroup ? `${selectedGroup.lines.length} line${selectedGroup.lines.length !== 1 ? 's' : ''} · ${fmt(selectedGroup.total_refund_amount)} refunded` : undefined}
      >
        {selectedGroup && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {selectedGroup.lines.map(line => (
              <LineDecisionRow key={line.id} line={line} />
            ))}
          </Box>
        )}
      </EntityDetailModal>
    </Box>
  );
}