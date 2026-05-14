// apps/frontend/src/pages/ft2-pages/ReturnsSuppliersPage.tsx
//
// Returns — Suppliers tab (growth tier)
// --------------------------------------
// Supplier return rate scorecard + per-batch drill-down.
// Shows which suppliers are sending stock that comes back.
// STUB — full implementation pending supplier rollup endpoint.

import { Box, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';

function useReturnsTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    pageBg:      isDark ? '#151D29' : '#F8F9FA',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
  };
}

export default function ReturnsSuppliersPage() {
  const pal = useReturnsTheme();
  return (
    <Box sx={{ background: pal.pageBg, minHeight: '100%', p: 3 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 700, color: pal.textPrimary }}>Suppliers</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textSecond, mt: 0.5 }}>
        Return rate by supplier and batch — see which suppliers are sending stock that comes back.
      </Typography>
    </Box>
  );
}