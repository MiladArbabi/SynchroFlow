/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/ShopSettingsReportsPage.tsx
//
// REPORTS HUB — /settings/reports (GH #1014 Sprint 2)
// -----------------------------------------------------
// Centralised export surface inside ShopSettingsPage.
//
// Sections:
//   1. Quick Reports — one-click pre-built templates
//   2. Report History — last 30 exports (Sprint 3: needs backend history endpoint)
//
// Tier gating:
//   Core+   → CSV exports
//   Growth+ → PDF exports (brief)
//
// See: docs/playbooks/export_system_playbook.md

import { useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { FileText, Download, Lock } from 'lucide-react';
import { axiosInstance } from 'api/axiosConfig';
import { isEntitlementDenial } from 'api/entitlementDenial';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { SectionLabel, SettingsPageWrapper } from './ShopSettingsShared';
import { QUICK_REPORTS, isTierSufficient, MIME, type ExportFormat, type QuickReport } from '../../config/exportReports';
import { FormatBadge } from 'components/ExportFormatBadge';
import { ColumnPicker, type ColumnPickerSelection } from 'components/ColumnPicker';

const ALL_COLUMNS_SELECTED: ColumnPickerSelection = { columns: undefined, isEmpty: false };

// ─── QUICK REPORT CARD ────────────────────────────────────────────────────────

function QuickReportCard({
  report, userTier, pickerOpen, onTogglePicker,
}: {
  report: QuickReport; userTier: string; pickerOpen: boolean; onTogglePicker: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columnSelection, setColumnSelection] = useState<ColumnPickerSelection>(ALL_COLUMNS_SELECTED);
  const eligible = isTierSufficient(userTier, report.tier);
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
      const res = await axiosInstance.post(
        report.endpoint,
        body,
        { responseType: 'blob' }
      );
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
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 2,
      px: 2.5, py: 2,
      bgcolor: 'var(--surface)',
      border: '0.5px solid var(--rule)',
      borderRadius: '8px',
      opacity: eligible ? 1 : 0.55,
    }}>
      {/* Icon */}
      <Box sx={{
        width: 36, height: 36, borderRadius: '8px',
        bgcolor: 'var(--bg)', border: '0.5px solid var(--rule)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <FileText size={16} color="var(--ink-3)" strokeWidth={1.6} />
      </Box>

      {/* Text */}
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

      {/* Column picker + CTA */}
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
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            px: '12px', py: '6px',
            fontSize: 12, fontWeight: 500,
            color: downloadDisabled ? 'var(--ink-4)' : 'var(--accent)',
            border: `0.5px solid ${downloadDisabled ? 'var(--rule)' : 'var(--accent-border)'}`,
            borderRadius: '6px',
            cursor: downloadDisabled ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            '&:hover': !downloadDisabled ? { opacity: 0.75 } : {},
          }}
        >
          {loading
            ? <CircularProgress size={12} sx={{ color: 'var(--accent)' }} />
            : <Download size={13} strokeWidth={1.6} />}
          <span>{loading ? 'Exporting…' : 'Download'}</span>
        </Box>
      </Box>
    </Box>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ShopSettingsReportsPage() {
  const { tier } = useEntitlements();
  // Only one picker open at a time across the Quick Reports list.
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);

  return (
    <SettingsPageWrapper>
      {/* QUICK REPORTS */}
      <Box>
        <SectionLabel>Quick Reports</SectionLabel>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mb: 2 }}>
          One-click exports pre-built for the most common operational needs.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {QUICK_REPORTS.map(report => (
            <QuickReportCard
              key={report.id}
              report={report}
              userTier={tier}
              pickerOpen={openPickerId === report.id}
              onTogglePicker={() => setOpenPickerId(prev => (prev === report.id ? null : report.id))}
            />
          ))}
        </Box>
      </Box>

      {/* REPORT HISTORY — Sprint 3 */}
      <Box>
        <SectionLabel>Report History</SectionLabel>
        <Box sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', py: 6, gap: 1,
          border: '0.5px dashed var(--rule)', borderRadius: '8px',
        }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            Coming in Sprint 3
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Last 30 exports with re-download links — 7-day file retention.
          </Typography>
        </Box>
      </Box>
    </SettingsPageWrapper>
  );
}
