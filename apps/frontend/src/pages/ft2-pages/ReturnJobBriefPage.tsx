// apps/frontend/src/pages/ft2-pages/ReturnJobBriefPage.tsx
//
// Return Job Brief — WEB-RETURN-01, first vertical slice
// --------------------------------------------------------
// Minimal brief screen for a single return job. Shows what's known,
// lets an operator/owner/admin claim it. Full condition-assessment
// (the "frisk" step) is mobile-only today — this page does not yet
// replicate that; claiming here surfaces confirmation, not the
// full physical-intake workflow. See WEB-RETURN-01 in
// docs/blueprints/ReturnsResolutionModule.md for the phased plan.

import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { Package, Clock, RotateCcw } from 'lucide-react';
import { useReturnJob, useClaimReturnJob } from '../returns/useReturnJob';

const fmt = (n: number) =>
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const formatAge = (isoDate: string) => {
  const hours = (Date.now() - new Date(isoDate).getTime()) / 3600000;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export default function ReturnJobBriefPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useReturnJob(id ?? '');
  const { mutate: claim, isPending: claiming, isSuccess: claimed } = useClaimReturnJob(id ?? '');

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (isError || !data?.data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Return job not found.</Alert>
      </Box>
    );
  }

  const job = data.data;
  const isPending = job.status === 'pending';
  const isInProgress = job.status === 'in_progress';
  const totalUnits = job.lines.reduce((sum, l) => sum + l.refunded_quantity, 0);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: 3 }}>
      <Box
        onClick={() => navigate('/returns')}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12 }}
      >
        ← Back to Returns
      </Box>

      <Box sx={{ maxWidth: 640 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', mb: 0.5 }}>
          Return job {job.external_order_id ? `— Order #${job.external_order_id}` : ''}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 3 }}>
          {job.origin === 'customer_return' ? 'Customer return' : 'Undelivered / return to sender'}
          {' · '}Created {formatAge(job.created_at)}
        </Typography>

        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden', mb: 2 }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Job details</Typography>
          </Box>

          <Box sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <RotateCcw size={16} color="var(--ink-3)" />
              <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                {fmt(Number(job.total_refund_amount))} refunded · {totalUnits} {totalUnits === 1 ? 'unit' : 'units'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Clock size={16} color="var(--ink-3)" />
              <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                Status: {job.status.replace('_', ' ')}
                {job.claimed_by && job.claimed_at ? ` · claimed ${formatAge(job.claimed_at)}` : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Package size={16} color="var(--ink-3)" />
              <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                {job.lines.length} line {job.lines.length === 1 ? 'item' : 'items'}
              </Typography>
            </Box>
          </Box>
        </Box>

        {job.lines.length > 0 && (
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden', mb: 2 }}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Line items</Typography>
            </Box>
            {job.lines.map((line) => (
              <Box key={line.lasyncro_refund_line_item_id} sx={{ px: 2.5, py: 1.5, borderBottom: '0.5px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
                <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                  {line.variant_title ?? 'Unknown product'} · qty {line.refunded_quantity}
                </Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: 0.25 }}>
                  {line.item_condition ? `Condition: ${line.item_condition}` : 'Awaiting physical inspection'}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {isPending && (
          <Box
            onClick={() => !claiming && claim()}
            sx={{
              display: 'inline-flex', alignItems: 'center', px: 2, py: 1,
              fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)',
              bgcolor: 'var(--accent)', borderRadius: '6px', cursor: claiming ? 'default' : 'pointer',
              opacity: claiming ? 0.6 : 1,
              '&:hover': { opacity: claiming ? 0.6 : 0.88 },
            }}
          >
            {claiming ? 'Claiming…' : 'Claim this job'}
          </Box>
        )}

        {(isInProgress || claimed) && (
          <Alert severity="info" sx={{ mt: 1 }}>
            This job is claimed. Physical inspection (condition assessment, frisking) continues on the LaSyncro mobile app — web condition-assessment is coming in a future update.
          </Alert>
        )}
      </Box>
    </Box>
  );
}