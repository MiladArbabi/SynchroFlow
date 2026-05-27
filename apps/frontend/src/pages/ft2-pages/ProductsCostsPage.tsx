// apps/frontend/src/pages/ft2-pages/ProductsCostsPage.tsx
//
// ProductsCostsPage
// -----------------
// Cost entry and bulk CSV upload surface.
// Period-independent — cost data is not time-ranged.
import CostEntryPanel from 'components/CostEntryPanel';
import { Box, Typography } from '@mui/material';

export default function ProductsCostsPage() {
  return (
    <Box sx={{ p: '24px 40px', bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <Box sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.25 }}>
          Costs
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Enter unit cost per SKU to unlock accurate margin and COGS reporting.
        </Typography>
      </Box>
      <CostEntryPanel />
    </Box>
  );
}