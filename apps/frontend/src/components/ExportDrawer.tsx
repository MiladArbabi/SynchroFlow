// apps/frontend/src/components/ExportDrawer.tsx
//
// EXPORT DRAWER — module-level export CTA (GH #1014)
// Page-level slide-in (position: fixed + backdrop) — unlike BinLogDrawer,
// which docks inside a relative canvas. Lets the operator pick a report +
// format instead of a hardcoded single download. Reuses config/exportReports
// — never redefine reports here. v1 scope: CSV + PDF only, no .xlsx yet.
//
// CROSS-SCREEN-UX-01: every consumer inherits one quiet persistent footer,
// "Go to Reports →" (/settings/reports) — the deeper Reports hub handoff,
// mirroring the Ops Console footer grammar. Never a competing primary CTA.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, IconButton, CircularProgress } from '@mui/material';
import { X, Download, Lock } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { isEntitlementDenial } from 'api/entitlementDenial';
import { QUICK_REPORTS, MIME, type QuickReport } from '../config/exportReports';
import { useCommercialAccess } from '../runtime/commercialContext';
import { FormatBadge } from './ExportFormatBadge';
import { ColumnPicker, type ColumnPickerSelection } from './ColumnPicker';

const ALL_COLUMNS_SELECTED: ColumnPickerSelection = { columns: undefined, isEmpty: false };

interface ExportDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Restrict which canonical reports show here. Omit to show all. */
  reportIds?: string[];
}

function ExportRow({
  report, pickerOpen, onTogglePicker,
}: {
  report: QuickReport; pickerOpen: boolean; onTogglePicker: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columnSelection, setColumnSelection] = useState<ColumnPickerSelection>(ALL_COLUMNS_SELECTED);
  const { decide } = useCommercialAccess();
  const decision = decide(report.capabilityId);
  const eligible = decision.allowed;
  const downloadDisabled = !eligible || loading || columnSelection.isEmpty;

  const handleDownload = async () => {
    if (downloadDisabled) return;
    setLoading(true);
    setError(null);
    try {
      const baseBody = (report.body ?? {}) as { filters?: Record<string, unknown> };
      const body = columnSelection.columns
        ? { ...baseBody, filters: { ...(baseBody.filters ?? {}), columns: columnSelection.columns } }
        : baseBody;
      const res = await axiosInstance.post(report.endpoint, body, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: MIME[report.format] }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.filename}-${new Date().toISOString().split('T')[0]}.${report.format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (isEntitlementDenial(err)) {
        setError('Custom column selection is available on Growth. Export the standard columns, or upgrade to continue.');
      } else {
        setError('Export failed — please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 2, py: 1.5, borderRadius: '8px',
        border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
        opacity: eligible ? 1 : 0.55,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: '2px' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            {report.title}
          </Typography>
          <FormatBadge format={report.format} />
          {!eligible && (
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              px: '6px', py: '2px', fontSize: 9, fontWeight: 600,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--ink-3)', bgcolor: 'var(--bg)',
              border: '0.5px solid var(--rule)', borderRadius: '4px',
            }}>
              <Lock size={8} />
              {/* Never fabricate a tier — only the decision's own requiredTier, or neutral wording. */}
              {decision.requiredTier ? `${decision.requiredTier}+` : 'Locked'}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
          {report.description}
        </Typography>
        {error && (
          <Typography sx={{ fontSize: 11, color: 'var(--critical-text)', mt: '3px' }}>
            {error}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <ColumnPicker
          endpoint={report.endpoint}
          open={pickerOpen}
          onToggle={onTogglePicker}
          onSelectionChange={setColumnSelection}
        />
        <Box
          onClick={handleDownload}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '6px',
            cursor: downloadDisabled ? 'not-allowed' : 'pointer',
            '&:hover': !downloadDisabled ? { bgcolor: 'var(--bg)' } : {},
          }}
        >
          {loading
            ? <CircularProgress size={14} sx={{ color: 'var(--accent-text)' }} />
            : <Download size={14} strokeWidth={1.6} color={downloadDisabled ? 'var(--ink-4)' : 'var(--accent)'} />}
        </Box>
      </Box>
    </Box>
  );
}

export function ExportDrawer({ open, onClose, reportIds }: ExportDrawerProps) {
  const navigate = useNavigate();
  const reports = reportIds ? QUICK_REPORTS.filter(r => reportIds.includes(r.id)) : QUICK_REPORTS;
  // Only one picker open at a time across the drawer.
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);

  // Keep guidance truthful when a module exposes only a subset of report formats.
  const formats = new Set(reports.map(report => report.format));
  const guidance = formats.has('csv') && formats.has('pdf')
    ? 'Choose a report to download. CSV gives raw rows; PDF gives a formatted summary.'
    : formats.has('pdf')
      ? 'Choose a formatted PDF summary to download.'
      : 'Choose a CSV report to download as raw rows.';

  return (
    <>
      <Box
        onClick={onClose}
        sx={{
          position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.32)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s ease', zIndex: 1200,
        }}
      />
      <Box
        sx={{
          position: 'fixed', top: 0, right: 0, height: '100%',
          width: 400, maxWidth: '90vw', bgcolor: 'var(--bg)',
          borderLeft: '1px solid var(--rule)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column', zIndex: 1201,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, py: 2.5, borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Export data</Typography>
          <IconButton onClick={onClose} size="small" sx={{ color: 'var(--ink-3)' }}><X size={16} /></IconButton>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mb: 0.5 }}>
            {guidance}
          </Typography>
          {reports.map(report => (
            <ExportRow
              key={report.id}
              report={report}
              pickerOpen={openPickerId === report.id}
              onTogglePicker={() => setOpenPickerId(prev => (prev === report.id ? null : report.id))}
            />
          ))}
        </Box>
        {/* FOOTER — the single, non-primary handoff to the full Reports hub. */}
        <Box
          component="button"
          type="button"
          onClick={() => { onClose(); navigate('/settings/reports'); }}
          sx={{
            flexShrink: 0, width: '100%', textAlign: 'left', boxSizing: 'border-box',
            px: 3, py: 1.5, cursor: 'pointer',
            bgcolor: 'transparent', border: 'none', borderTop: '1px solid var(--rule)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 500, color: 'var(--ink-3)',
            '&:hover': { color: 'var(--ink)', bgcolor: 'var(--surface)' },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
          }}
        >
          Go to Reports →
        </Box>
      </Box>
    </>
  );
}
