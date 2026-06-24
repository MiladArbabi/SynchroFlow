// apps/frontend/src/components/ExportFormatBadge.tsx
import { Box } from '@mui/material';
import type { ExportFormat } from 'config/exportReports';

export function FormatBadge({ format }: { format: ExportFormat }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center',
      px: '6px', py: '2px',
      fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: format === 'pdf' ? 'var(--accent)' : 'var(--ink-3)',
      bgcolor: format === 'pdf' ? 'var(--accent-ghost)' : 'var(--bg)',
      border: `0.5px solid ${format === 'pdf' ? 'var(--accent-border)' : 'var(--rule)'}`,
      borderRadius: '4px',
    }}>
      {format}
    </Box>
  );
}
