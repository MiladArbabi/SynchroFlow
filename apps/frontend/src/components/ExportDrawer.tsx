// apps/frontend/src/components/ExportDrawer.tsx
//
// EXPORT DRAWER — module-level export CTA (GH #1014)
// Page-level slide-in (position: fixed + backdrop) — unlike BinLogDrawer,
// which docks inside a relative canvas. Lets the operator pick a report +
// format instead of a hardcoded single download. Reuses config/exportReports
// — never redefine reports here. v1 scope: CSV + PDF only, no .xlsx yet.

import { useState } from 'react';
import { Box, Typography, IconButton, CircularProgress } from '@mui/material';
import { X, Download, Lock } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { QUICK_REPORTS, isTierSufficient, MIME, type QuickReport } from '../config/exportReports';
import { FormatBadge } from './ExportFormatBadge';

interface ExportDrawerProps {
  open: boolean;
  onClose: () => void;
  userTier: string;
  /** Restrict which canonical reports show here. Omit to show all. */
  reportIds?: string[];
}

function ExportRow({ report, userTier }: { report: QuickReport; userTier: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = isTierSufficient(userTier, report.tier);

  const handleDownload = async () => {
    if (!eligible || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axiosInstance.post(report.endpoint, report.body ?? {}, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: MIME[report.format] }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.filename}-${new Date().toISOString().split('T')[0]}.${report.format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      onClick={handleDownload}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 2, py: 1.5, borderRadius: '8px',
        border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
        opacity: eligible ? 1 : 0.55,
        cursor: eligible ? 'pointer' : 'not-allowed',
        '&:hover': eligible ? { borderColor: 'var(--accent-border)' } : {},
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
              {report.tier}+
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
          {report.description}
        </Typography>
        {error && (
          <Typography sx={{ fontSize: 11, color: '#E5484D', mt: '3px' }}>
            {error}
          </Typography>
        )}
      </Box>
      {loading
        ? <CircularProgress size={14} sx={{ color: 'var(--accent)', flexShrink: 0 }} />
        : <Download size={14} strokeWidth={1.6} color={eligible ? 'var(--accent)' : 'var(--ink-4)'} style={{ flexShrink: 0 }} />}
    </Box>
  );
}

export function ExportDrawer({ open, onClose, userTier, reportIds }: ExportDrawerProps) {
  const reports = reportIds ? QUICK_REPORTS.filter(r => reportIds.includes(r.id)) : QUICK_REPORTS;
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
            Choose a report to download. CSV gives raw rows; PDF gives a formatted summary.
          </Typography>
          {reports.map(report => <ExportRow key={report.id} report={report} userTier={userTier} />)}
        </Box>
      </Box>
    </>
  );
}
