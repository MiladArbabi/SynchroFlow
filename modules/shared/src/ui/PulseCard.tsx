import React from 'react';
import { Box, Typography } from '@mui/material';

export type PulseTone = 'critical' | 'warning' | 'good' | 'neutral';

const TONE_SEVERITY: Record<PulseTone, number> = { critical: 0, warning: 1, neutral: 2, good: 3 };

// Pulse severity tokens — see modules-ux-playbook.md §18.
// Scope: live risk/status metrics only. Not for persisted state (--confirm-*,
// §10) or day-over-day deltas (--ft2-infoblock-diff-up).
const TONE_COLOR: Record<PulseTone, string> = {
  critical: 'var(--critical-ink)',
  warning: 'var(--warning-ink)',
  good: 'var(--good-ink)',
  neutral: 'var(--ink-2)',
};

export interface PulseCardRowData {
  id: string;
  label: string;
  value: string | number;
  tone?: PulseTone;
  subtext?: string;
  subtextTone?: PulseTone;
  progress?: { value: number; max: number };
  action?: { label: string; onClick: () => void };
  onClick?: () => void;
  group?: string;
  /**
   * Escape hatch for domain-specific colors with no tone equivalent
   * (e.g. pipeline-stage colors — see OrdersModuleFT2.tsx STAGE_COLORS,
   * tracked in B-08). Wins over TONE_COLOR[tone] for dot/bar/value color.
   * `tone` still governs severity-sort placement even when this is set.
   */
  colorOverride?: string;
}

export interface PulseCardHeadline {
  value: string;
  tone: PulseTone;
  subtext?: string;
  colorOverride?: string; // see PulseCardRowData.colorOverride
}

export interface PulseCardProps {
  title: string;
  headline?: PulseCardHeadline;
  rows: PulseCardRowData[];
  footerNote?: React.ReactNode; // plain descriptive line above footerCta, e.g. "10 shipped today · $37,453 collected"
  footerCta?: { label: string; onClick: () => void };
  updatedAt?: string;
  onRefresh?: () => void;
  variant?: 'card' | 'embedded'; // 'embedded' suppresses outer shell — for composing inside a larger card
}

function sortRowsBySeverity(rows: PulseCardRowData[]): PulseCardRowData[] {
  return [...rows].sort((a, b) => TONE_SEVERITY[a.tone ?? 'neutral'] - TONE_SEVERITY[b.tone ?? 'neutral']);
}

function PulseCardRow({ row }: { row: PulseCardRowData }) {
  const tone = row.tone ?? 'neutral';
  const clickable = typeof row.onClick === 'function';

  const content = (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        py: 1, px: clickable ? 1 : 0, mx: clickable ? -1 : 0,
        borderRadius: clickable ? '6px' : 0, cursor: clickable ? 'pointer' : 'default',
        transition: 'background-color 0.12s',
        '&:hover': clickable ? { bgcolor: 'var(--bg-3)' } : undefined,
        '&:focus-visible': clickable ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined,
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: row.colorOverride ?? TONE_COLOR[tone], flexShrink: 0 }} />
          <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'var(--ink-3)' }}>{row.label}</Typography>
        </Box>

        {row.subtext && (
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: row.subtextTone ? TONE_COLOR[row.subtextTone] : 'var(--ink-4)', pl: '14px' }}>{row.subtext}</Typography>
        )}

        {row.progress && (
          <Box sx={{ height: 4, borderRadius: '2px', bgcolor: 'var(--rule)', overflow: 'hidden', ml: '14px', mt: 0.5 }}>
            <Box sx={{ height: '100%', width: `${Math.max(Math.min(100, (row.progress.value / row.progress.max) * 100), row.progress.value > 0 ? 8 : 0)}%`, bgcolor: row.colorOverride ?? TONE_COLOR[tone], transition: 'width 0.2s' }} />
          </Box>
        )}
      </Box>

      {row.action ? (
        <Box
          component="button"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); row.action!.onClick(); }}
          sx={{
            fontSize: 11, fontWeight: 500, color: 'var(--accent)',
            bgcolor: 'transparent', border: '0.5px solid var(--accent)',
            borderRadius: '6px', px: 1.25, py: 0.5, cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.75 },
          }}
        >
          {row.action.label}
        </Box>
      ) : (
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: row.colorOverride ?? (tone === 'neutral' ? 'var(--ink)' : TONE_COLOR[tone]), flexShrink: 0, pl: 1 }}>
          {row.value}
        </Typography>
      )}
    </Box>
  );

  if (!clickable) return content;

  return (
    <Box
      role="button" tabIndex={0} onClick={row.onClick}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.onClick!(); } }}
    >
      {content}
    </Box>
  );
}

export function PulseCard({ 
  title, 
  headline, 
  rows, 
  footerNote, 
  footerCta, 
  updatedAt, 
  onRefresh, 
  variant = 'card' 
}: PulseCardProps) {
  const sortedRows = sortRowsBySeverity(rows);

  const groups: { key: string | undefined; rows: PulseCardRowData[] }[] = [];
  for (const row of sortedRows) {
    const last = groups[groups.length - 1];
    if (last && last.key === row.group) last.rows.push(row);
    else groups.push({ key: row.group, rows: [row] });
  }

  const shellSx = variant === 'embedded'
    ? {}
    : { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' };

  return (
    <Box sx={{ ...shellSx, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {title}
      </Typography>

      {headline && (
        <Box sx={{ pb: 1, mb: 0.5, borderBottom: '1px solid var(--rule)' }}>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: headline.colorOverride ?? TONE_COLOR[headline.tone], lineHeight: 1.1 }}>
            {headline.value}
          </Typography>
          {headline.subtext && (
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', mt: 0.5 }}>{headline.subtext}</Typography>
          )}
        </Box>
      )}

      {groups.map((group, gi) => (
        <Box key={group.key ?? `group-${gi}`} sx={{ pb: gi < groups.length - 1 ? 1 : 0, mb: gi < groups.length - 1 ? 1 : 0, borderBottom: gi < groups.length - 1 ? '1px solid var(--rule)' : 'none' }}>
          {group.rows.map((row) => <PulseCardRow key={row.id} row={row} />)}
        </Box>
      ))}

      {footerNote && (
        <Box sx={{ pt: 1.5, mt: 0.5, borderTop: '1px solid var(--rule)' }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>{footerNote}</Typography>
        </Box>
      )}
      {(footerCta || updatedAt) && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1, mt: 0.5, borderTop: footerCta && updatedAt && !footerNote ? '1px solid var(--rule)' : 'none' }}>
          {footerCta && (
            <Box
              component="button" onClick={footerCta.onClick}
              sx={{
                fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)',
                borderRadius: '6px', px: 1.25, py: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 },
                width: footerCta && !updatedAt ? '100%' : 'auto', textAlign: 'center',
              }}
            >
              {footerCta.label} →
            </Box>
          )}
          {updatedAt && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{updatedAt}</Typography>
              {onRefresh && (
                <Box component="button" onClick={onRefresh} aria-label="Refresh" sx={{ bgcolor: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'flex' }}>
                  ↻
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}