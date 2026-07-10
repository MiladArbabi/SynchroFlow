// apps/frontend/src/components/ActivationChecklist.tsx
//
// T6 — Activation checklist popover.
// Triggered by ListChecks icon in topnav (left of bell).
// See docs/playbooks/onboarding-progressive-disclosure-playbook.md §2 Layer 1.
//
// Rules:
// - Same Popover shell as alerts (380px, borderRadius 10px, var(--surface))
// - Completed items use --confirm-* tokens (persisted state, not action — §10 modules-ux-playbook)
// - Incomplete items show Tier 2 ghost pill CTA
// - "Dismiss checklist" footer only when allComplete === true
// - Owner/admin only — gated by caller in TopnavbarContent

import { Box, Typography, Popover, IconButton, Tooltip, Badge } from '@mui/material';
import { ListChecks, CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActivationChecklist } from '../hooks/useActivationChecklist';
import { useAppTheme } from '../hooks/useAppTheme';
import { axiosInstance } from '../api/axiosConfig';

function useChecklistDismissed() {
  return useQuery<Record<string, boolean>>({
    queryKey: ['user-state', 'onboarding-flags'],
    queryFn: async () => (await axiosInstance.get('/api/v1/user-state/onboarding-flags')).data,
    staleTime: 60_000,
  });
}

function useDismissChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => axiosInstance.post('/api/v1/user-state/checklist/dismiss'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-state', 'onboarding-flags'] }),
  });
}

export function ActivationChecklistButton() {
  const pal = useAppTheme();
  const nav = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(anchor);

  const { items, completedCount, allComplete, isLoading } = useActivationChecklist();
  const { data: flags } = useChecklistDismissed();
  const { mutate: dismiss } = useDismissChecklist();

  // Hide entirely if dismissed
  if (flags?.['checklist:completed']) return null;

  const remaining = items.length - completedCount;

  return (
    <>
      <Tooltip title={open ? '' : 'Getting started'}>
        <IconButton
          size="small"
          onClick={e => setAnchor(e.currentTarget)}
          sx={{ color: remaining > 0 ? 'var(--accent)' : 'text.secondary' }}
          aria-label={`Activation checklist — ${completedCount} of ${items.length} done`}
        >
          <Badge
            badgeContent={remaining > 0 ? remaining : undefined}
            max={9}
            color="error"
            sx={{ '& .MuiBadge-badge': { fontSize: 9, minWidth: 16, height: 16 } }}
          >
            <ListChecks size={18} strokeWidth={remaining > 0 ? 2.5 : 1.75} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            width: 380,
            bgcolor: pal.surface,
            border: `0.5px solid ${pal.rule}`,
            boxShadow: pal.shadowMd,
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            mt: 0.75,
          },
        }}
      >
        {/* Header */}
        <Box sx={{ px: 1.5, py: 1.25, borderBottom: `0.5px solid ${pal.rule}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.ink }}>
            Getting started
          </Typography>
          <Typography sx={{ fontSize: 11, color: pal.ink4 }}>
            {completedCount} of {items.length} done
          </Typography>
        </Box>

        {/* Items */}
        <Box sx={{ flex: 1 }}>
          {isLoading ? (
            <Box sx={{ px: 2, py: 2 }}>
              <Typography sx={{ fontSize: 12, color: pal.ink4 }}>Loading…</Typography>
            </Box>
          ) : (
            items.map(item => (
              <Box
                key={item.key}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  px: 1.5, py: 1.125,
                  borderBottom: `0.5px solid ${pal.rule}`,
                  bgcolor: item.complete ? 'var(--confirm-ghost)' : pal.surface,
                  '&:last-of-type': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {item.complete
                    ? <CheckCircle2 size={14} color="var(--confirm-ink)" />
                    : <Circle size={14} color={pal.ink4} />
                  }
                  <Typography sx={{
                    fontSize: 12, fontWeight: item.complete ? 300 : 500,
                    color: item.complete ? 'var(--confirm-ink)' : pal.ink,
                    textDecoration: item.complete ? 'line-through' : 'none',
                  }}>
                    {item.label}
                  </Typography>
                </Box>

                {!item.complete && item.actionRoute && (
                  <Box
                    onClick={() => { nav(item.actionRoute!); setAnchor(null); }}
                    sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.4,
                      px: 1, py: 0.375, fontSize: 11, fontWeight: 500,
                      color: 'var(--accent)', border: '0.5px solid var(--accent-border)',
                      borderRadius: '6px', cursor: 'pointer', flexShrink: 0,
                      '&:hover': { bgcolor: 'var(--accent-ghost)' },
                    }}
                  >
                    Go <ArrowRight size={10} />
                  </Box>
                )}
              </Box>
            ))
          )}
        </Box>

        {/* Footer — dismiss only when all complete */}
        {allComplete && (
          <Box
            onClick={() => { dismiss(); setAnchor(null); }}
            sx={{
              px: 1.5, py: 1.25,
              borderTop: `0.5px solid ${pal.rule}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
              color: pal.ink4,
              '&:hover': { bgcolor: 'var(--bg-2)' },
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: pal.ink4 }}>
              Dismiss checklist
            </Typography>
          </Box>
        )}
      </Popover>
    </>
  );
}